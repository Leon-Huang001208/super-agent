import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import {resolveRoleCapabilities} from '../bridge/role-capabilities.mjs';
import {assertRoleMcpCall,filterMcpTools,transformMcpCatalogBody} from '../bridge/role-mcp-policy.mjs';
import {requestHostCapability,hostCapabilityTimeoutMs} from '../bridge/role-host-call-queue.mjs';
import {rwbReleaseBrokerLifetimeMs} from '../bridge/rwb-release.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {createRoleApiRequestAuthorizer} from '../bridge/role-api-routing.mjs';
const configRoot=process.env.SUPER_AGENT_ROLE_PROXY_ROOT??'/proxy';
const auditRoot=process.env.SUPER_AGENT_ROLE_PROXY_AUDIT??'/audit';
const config=JSON.parse(fs.readFileSync(configRoot+'/config.json','utf8'));
const fail=(res,status,code)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:code,type:'role_scope'}}));};
const auditSecrets=new Set();
const audit=event=>{let line=JSON.stringify({at:new Date().toISOString(),...event});for(const value of auditSecrets)line=line.replaceAll(JSON.stringify(value).slice(1,-1),'[redacted]');fs.appendFileSync(auditRoot+'/provider.jsonl',line+'\n',{mode:0o600});};
const startupFail=code=>{audit({code});throw Object.assign(Error(code),{code});};
const profileId=config.runtimeProfileId===undefined?'codex_subscription':config.runtimeProfileId;
if(typeof profileId!=='string'||!Object.hasOwn(RUNTIME_PROFILES,profileId))startupFail('ROLE_PROXY_PROFILE_DENIED');
const apiProfile=['opencode','claude'].includes(RUNTIME_PROFILES[profileId].runtime);
if(apiProfile&&typeof config.key==='string'&&config.key)auditSecrets.add(config.key);
let session=null,count=0,mcpCount=0;
const admittedTools=[...(config.effectiveCapabilities?.mcpAllowedTools??config.mcpAllowedTools??[])];
let auth=null,account,apiCredential=null,authorizeApi=null;
const authFile=process.env.SUPER_AGENT_ROLE_PROXY_AUTH_FILE??configRoot+'/auth.json';
if(fs.existsSync(authFile)){
 try{
  auth=JSON.parse(fs.readFileSync(authFile,'utf8'));
  if(apiProfile)for(const field of ['access_token','refresh_token','id_token'])if(typeof auth.tokens?.[field]==='string'&&auth.tokens[field])auditSecrets.add(auth.tokens[field]);
  const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString());
  account=auth.tokens.account_id??claims['https://api.openai.com/auth']?.chatgpt_account_id;
  if(!account||!auth.tokens.access_token)throw Error();
 }catch{startupFail(apiProfile?'ROLE_PROXY_APPS_AUTH_REQUIRED':'ROLE_PROXY_AUTH_REQUIRED');}
}
if(!auth&&!apiProfile)startupFail('ROLE_PROXY_AUTH_REQUIRED');
// A role's Cloud Apps catalog is not a connected subscription. Host MCP has its own authorized tools.
if(apiProfile&&!auth)admittedTools.length=0;
if(apiProfile){
 const filename=process.env.SUPER_AGENT_ROLE_API_AUTH_FILE??configRoot+'/api-auth.json';
 try{
  const info=fs.lstatSync(filename);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)||info.uid!==process.getuid())throw Error();
  apiCredential=JSON.parse(fs.readFileSync(filename,'utf8'));
 }catch(error){startupFail(error.code==='ENOENT'?'ROLE_API_AUTH_REQUIRED':'ROLE_API_AUTH_DENIED');}
 if(apiCredential?.runId!==config.runId||apiCredential?.runtimeProfileId!==profileId)startupFail('ROLE_API_AUTH_DENIED');
 if(typeof apiCredential.apiKey==='string'&&apiCredential.apiKey)auditSecrets.add(apiCredential.apiKey);
 try{authorizeApi=createRoleApiRequestAuthorizer({profileId,runId:config.runId,key:config.key,apiKey:apiCredential.apiKey,expiresAt:config.expiresAt});}
 catch(error){startupFail(/^ROLE_API_[A-Z_]+$/.test(error.code??'')?error.code:'ROLE_API_AUTH_DENIED');}
}
let allowedTools=config.readOnlyToolsOnly===true?[]:[...admittedTools];
for(const tool of config.hostTools??[])if(!allowedTools.includes(tool.name))allowedTools.push(tool.name);
const apiControllers=new Set();
async function handleApiRequest(req,res){
 const bearer=req.headers.authorization,apiToken=req.headers['x-api-key'];
 if((bearer===undefined&&apiToken===undefined)||(bearer!==undefined&&bearer!=='Bearer '+config.key)||(apiToken!==undefined&&apiToken!==config.key))return fail(res,403,'ROLE_API_TOKEN_DENIED');
 if(req.headers['x-paperclip-run-id']!==config.runId)return fail(res,403,'ROLE_API_RUN_DENIED');
 const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!res.writableEnded)abort();};
 const stopInput=()=>{if(!req.complete)req.destroy();};
 controller.signal.addEventListener('abort',stopInput,{once:true});apiControllers.add(controller);
 req.once('aborted',abort);res.once('close',closed);
 const timer=setTimeout(abort,Math.max(0,config.expiresAt-Date.now()));timer.unref();
 let authorized;
 try{
  let body=Buffer.alloc(0);
  for await(const chunk of req){if(body.length+chunk.length>4*1024*1024)return fail(res,413,'ROLE_API_INPUT_LIMIT');body=Buffer.concat([body,chunk]);}
  if([...auditSecrets].some(value=>body.includes(value)))throw Object.assign(Error('ROLE_API_BODY_SECRET_DENIED'),{code:'ROLE_API_BODY_SECRET_DENIED',statusCode:403});
  authorized=authorizeApi({method:req.method,path:req.url,headers:req.headers,body});audit(authorized.audit);
  const upstream=await fetch(authorized.url,{method:authorized.method,headers:authorized.headers,body:authorized.body,signal:controller.signal,redirect:'manual'});
  if(!upstream.ok){
   await upstream.body?.cancel().catch(()=>{});
   audit({...authorized.audit,code:'ROLE_API_UPSTREAM_HTTP_ERROR',status:upstream.status});
   return fail(res,upstream.status,'ROLE_API_UPSTREAM_HTTP_ERROR');
  }
  const out={};for(const[k,v]of upstream.headers){
   if(!['content-encoding','transfer-encoding','content-length','connection','set-cookie','authorization','x-api-key'].includes(k)&&![...auditSecrets].some(value=>v.includes(value)))out[k]=v;
  }
  res.writeHead(upstream.status,out);
  if(upstream.body)for await(const bytes of upstream.body){if(res.destroyed){abort();break;}res.write(Buffer.from(bytes));}
  res.end();audit({...authorized.audit,code:'ROLE_API_COMPLETED',status:upstream.status});
 }catch(error){
  const code=/^ROLE_API_[A-Z_]+$/.test(error.code??'')?error.code:controller.signal.aborted?'ROLE_API_UPSTREAM_ABORTED':'ROLE_API_UPSTREAM_UNKNOWN';
  const status=/^ROLE_API_[A-Z_]+$/.test(error.code??'')?error.statusCode:controller.signal.aborted?504:502;
  audit({...(authorized?.audit??{runId:config.runId,profileId}),code,status});
  if(!res.destroyed){if(!res.headersSent)fail(res,status??502,code);else res.destroy();}
 }finally{
  clearTimeout(timer);req.off('aborted',abort);res.off('close',closed);controller.signal.removeEventListener('abort',stopInput);apiControllers.delete(controller);
 }
}
const publicIp=ip=>/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)&&
 !/^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|224\.|255\.)/.test(ip);
const handler=async(req,res)=>{
 try{
  if(!req.url?.startsWith('/'))return fail(res,403,'ROLE_PROXY_ABSOLUTE_URL_DENIED');
  const url=new URL(req.url,'http://local');
  if(apiProfile&&url.pathname.startsWith('/backend-api/model/'))return await handleApiRequest(req,res);
  if(req.headers.authorization!=='Bearer '+config.key){audit({code:'ROLE_PROXY_TOKEN_DENIED',method:req.method,path:new URL(req.url,'http://local').pathname});return fail(res,403,'ROLE_PROXY_TOKEN_DENIED');}
  if(Date.now()>config.expiresAt)return fail(res,403,'ROLE_PROXY_EXPIRED');
  const modelPath=req.method==='POST'&&url.pathname==='/backend-api/codex/responses';
  const hostMcpPath=req.method==='POST'&&url.pathname==='/backend-api/role-host-mcp';
  const mcpPath=hostMcpPath||['GET','POST','DELETE'].includes(req.method)&&url.pathname==='/backend-api/ps/mcp';
  const metadata=(req.method==='GET'&&['/backend-api/codex/models','/backend-api/wham/usage'].includes(url.pathname))||
    (['GET','POST'].includes(req.method)&&url.pathname==='/backend-api/wham/accounts/check')||
    (req.method==='GET'&&['/backend-api/ps/plugins/suggested/codex','/backend-api/wham/settings/user',
      '/backend-api/ps/plugins/installed','/backend-api/ps/plugins/list','/backend-api/plugins/featured'].includes(url.pathname));
  if(req.method==='POST'&&url.pathname==='/backend-api/codex/analytics-events/events'){res.writeHead(204);res.end();return;}
  if(apiProfile&&modelPath)return fail(res,403,'ROLE_API_PATH_DENIED');
  if(!modelPath&&!metadata&&!mcpPath){audit({code:'ROLE_PROXY_PATH_DENIED',path:url.pathname});return fail(res,403,'ROLE_PROXY_PATH_DENIED');}
  if(!auth&&(metadata||mcpPath&&!hostMcpPath))return fail(res,403,'ROLE_PROXY_APPS_AUTH_REQUIRED');
  if(url.pathname.endsWith('/responses')){
   const current=req.headers['session-id']??req.headers.session_id??req.headers['x-codex-session-id'];
   if(typeof current!=='string'||!current||session&&session!==current){
    audit({code:'ROLE_PROXY_SESSION_DENIED',headerNames:Object.keys(req.headers)});
    return fail(res,403,'ROLE_PROXY_SESSION_DENIED');
   }
   session??=current;
   if(++count>64)return fail(res,429,'ROLE_PROXY_REQUEST_LIMIT');
  }
  let body=Buffer.alloc(0);
  for await(const chunk of req){if(body.length+chunk.length>4*1024*1024)return fail(res,413,'ROLE_PROXY_INPUT_LIMIT');body=Buffer.concat([body,chunk]);}
  let mcpMessage;
  if(mcpPath){
   if(++mcpCount>64)return fail(res,429,'ROLE_PROXY_MCP_LIMIT');
   if(req.method==='POST'){
    const message=JSON.parse(body),method=message.method;mcpMessage=message;
    if(hostMcpPath&&method==='tools/list'){
     res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:config.hostTools??[]}}));return;
    }
    if(hostMcpPath&&method!=='tools/call')return fail(res,403,'ROLE_PROXY_MCP_ACTION_DENIED');
    const catalogs=['initialize','notifications/initialized','ping','tools/list','resources/list','resources/templates/list','prompts/list'];
    if(!catalogs.includes(method)&&method!=='tools/call'){
     audit({code:'ROLE_PROXY_MCP_ACTION_DENIED'});return fail(res,403,'ROLE_PROXY_MCP_ACTION_DENIED');
    }
    if(method==='tools/call'){
     if(hostMcpPath&&!message.params?.name?.startsWith('host.'))return fail(res,403,'ROLE_PROXY_MCP_ACTION_DENIED');
     const callTools=message.params?.name?.startsWith('host.')?(config.hostTools??[]).map(tool=>tool.name):allowedTools;
     try{assertRoleMcpCall({name:message.params?.name,args:message.params?.arguments??{},allowedTools:callTools,projectContext:config.projectContext});}
     catch(error){audit({code:error.code??'ROLE_PROXY_MCP_ACTION_DENIED',tool:message.params?.name});return fail(res,403,error.code??'ROLE_PROXY_MCP_ACTION_DENIED');}
     if(message.params.name.startsWith('host.')){
      try{
       const result=await requestHostCapability({root:auditRoot+'/host-calls',runId:config.runId,taskId:config.taskId,projectId:config.projectId,
        requestId:message.params.arguments?.idempotencyKey??message.id,tool:message.params.name,args:message.params.arguments??{},
        timeoutMs:hostCapabilityTimeoutMs({config,tool:message.params.name,args:message.params.arguments??{}})});
       res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:Array.isArray(result?.content)?result:{content:[{type:'text',text:JSON.stringify(result)}]}}));
      }catch(error){const code=/^(?:HOST|ROLE_HOST)_[A-Z_]+$/.test(error.code??'')?error.code:'HOST_CALL_FAILED';audit({code,tool:message.params.name});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text:JSON.stringify({code,details:error.details})}]}}));}
      return;
     }
    }
    audit({code:'ROLE_PROXY_MCP_REQUEST',method,tool:method==='tools/call'?message.params.name:undefined});
   }
  }
  if(url.pathname.endsWith('/responses')){
   const parsed=JSON.parse(body);
   if(parsed.model!=='gpt-6.1-sol'||parsed.reasoning?.effort!=='low')return fail(res,403,'ROLE_PROXY_MODEL_DENIED');
  }
  const headers={...req.headers,authorization:'Bearer '+auth.tokens.access_token,'chatgpt-account-id':account};
  for(const key of ['host','connection','content-length','transfer-encoding'])delete headers[key];
  if(apiProfile)delete headers['x-api-key'];
  const controller=new AbortController();req.once('aborted',()=>controller.abort());
  const upstream=await fetch('https://chatgpt.com'+url.pathname+url.search,{method:req.method,headers,
    ...(body.length?{body}:{}),signal:controller.signal,redirect:apiProfile?'manual':'error'});
  if(apiProfile&&!upstream.ok){await upstream.body?.cancel().catch(()=>{});audit({code:'ROLE_PROXY_APPS_UPSTREAM_HTTP_ERROR',status:upstream.status});return fail(res,upstream.status,'ROLE_PROXY_APPS_UPSTREAM_HTTP_ERROR');}
  const out={};for(const [k,v]of upstream.headers)if(!['content-encoding','transfer-encoding','content-length','connection','set-cookie'].includes(k)&&
    (!apiProfile||!['authorization','x-api-key'].includes(k)&&![...auditSecrets].some(value=>v.includes(value))))out[k]=v;
  if(mcpMessage?.method==='tools/list'&&upstream.ok){
   const text=transformMcpCatalogBody(await upstream.text(),upstream.headers.get('content-type'),message=>{
    if(!Array.isArray(message.result?.tools))return message;
    const resolved=config.role?resolveRoleCapabilities({role:config.role,additionalCapabilities:config.additionalCapabilities??[],projectContext:config.projectContext??{},toolCatalog:message.result.tools}):{mcpAllowedTools:allowedTools};
    const admitted=new Set(admittedTools),dynamic=new Set(resolved.mcpAllowedTools);
    const ceiling=config.readOnlyToolsOnly===true?message.result.tools.filter(tool=>admitted.has(tool.name)&&dynamic.has(tool.name)&&tool.annotations?.readOnlyHint===true):message.result.tools;
    const tools=filterMcpTools(ceiling,{allowedTools:resolved.mcpAllowedTools,projectContext:config.projectContext});
    allowedTools=tools.map(tool=>tool.name);return{...message,result:{...message.result,tools}};
   });
   res.writeHead(upstream.status,out);res.end(text);audit({code:'ROLE_PROXY_MCP_CATALOG_FILTERED',runId:config.runId,toolCount:allowedTools.length});return;
  }
  res.writeHead(upstream.status,out);
  if(upstream.body)for await(const bytes of upstream.body){if(res.destroyed){controller.abort();break;}res.write(Buffer.from(bytes));}
  res.end();audit({code:'ROLE_PROXY_COMPLETED',path:url.pathname,status:upstream.status,requestCount:count});
 }catch(e){const code=/^ROLE_PROXY_[A-Z_]+$/.test(e.code??'')?e.code:'ROLE_PROXY_UPSTREAM_UNKNOWN';audit({code,path:new URL(req.url,'http://local').pathname,method:req.method,errorType:e.name});if(!res.headersSent)fail(res,502,code);else res.destroy();}
};
const server=http.createServer(handler);
const tls=fs.existsSync(configRoot+'/tls.key')?https.createServer({key:fs.readFileSync(configRoot+'/tls.key'),cert:fs.readFileSync(configRoot+'/tls.crt')},handler):null;
tls?.on('tlsClientError',error=>audit({code:'ROLE_PROXY_TLS_CLIENT_ERROR',errorCode:error.code}));
server.on('connect',async(req,client,head)=>{
 try{
  const value=new URL('https://'+req.url),port=Number(value.port||443);
  if(port!==443||value.username||value.password||Date.now()>config.expiresAt)throw Error();
  const addresses=await dns.resolve4(value.hostname);
  if(!addresses.length||addresses.some(ip=>!publicIp(ip)))throw Error();
  // Public TLS egress carries no provider credential. Model requests must use
  // the separately authenticated, fixed-model/session endpoint above.
  const remote=net.connect(port,addresses[0],()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);});
  remote.setTimeout(120000,()=>remote.destroy());
  remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());client.on('close',()=>remote.destroy());
 }catch{client.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
});
const listenHost=process.env.SUPER_AGENT_ROLE_PROXY_LISTEN_HOST??'0.0.0.0';
const listenPort=Number(process.env.SUPER_AGENT_ROLE_PROXY_PORT??8090);
const tlsPort=Number(process.env.SUPER_AGENT_ROLE_PROXY_TLS_PORT??8091);
const readyProtocol=process.env.SUPER_AGENT_ROLE_PROXY_READY_PROTOCOL??'http';
if(!['0.0.0.0','127.0.0.1'].includes(listenHost)||!Number.isInteger(listenPort)||listenPort<0||listenPort>65535||!Number.isInteger(tlsPort)||tlsPort<0||tlsPort>65535||!['http','https'].includes(readyProtocol))throw Error('ROLE_PROXY_LISTEN_DENIED');
if(readyProtocol==='https'&&(!tls||listenHost!=='127.0.0.1'))throw Error('ROLE_PROXY_TLS_REQUIRED');
if(readyProtocol==='http')server.listen(listenPort,listenHost,()=>{
 const address=server.address();audit({code:'ROLE_PROXY_READY',runId:config.runId,host:listenHost,port:address.port});
 if(process.env.SUPER_AGENT_ROLE_PROXY_READY_FILE)fs.writeFileSync(process.env.SUPER_AGENT_ROLE_PROXY_READY_FILE,JSON.stringify({runId:config.runId,host:listenHost,port:address.port})+'\n',{mode:0o600,flag:'wx'});
});
tls?.listen(tlsPort,listenHost,()=>{
 const address=tls.address();audit({code:'ROLE_PROXY_TLS_READY',runId:config.runId,host:listenHost,port:address.port});
 if(readyProtocol==='https'&&process.env.SUPER_AGENT_ROLE_PROXY_READY_FILE)fs.writeFileSync(process.env.SUPER_AGENT_ROLE_PROXY_READY_FILE,JSON.stringify({runId:config.runId,protocol:'https:',host:listenHost,port:address.port})+'\n',{mode:0o600,flag:'wx'});
});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
 for(const controller of apiControllers)controller.abort();
 const listeners=[server,tls].filter(listener=>listener?.listening);let remaining=listeners.length;
 if(!remaining)process.exit(0);
 for(const listener of listeners)listener.close(()=>{if(--remaining===0)process.exit(0);});
});
setTimeout(()=>{for(const controller of apiControllers)controller.abort();process.exit(1);},rwbReleaseBrokerLifetimeMs(config)).unref();
