import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import {resolveRoleCapabilities} from '../bridge/role-capabilities.mjs';
import {assertRoleMcpCall,filterMcpTools,transformMcpCatalogBody} from '../bridge/role-mcp-policy.mjs';
import {requestHostCapability} from '../bridge/role-host-call-queue.mjs';
const configRoot=process.env.SUPER_AGENT_ROLE_PROXY_ROOT??'/proxy';
const auditRoot=process.env.SUPER_AGENT_ROLE_PROXY_AUDIT??'/audit';
const config=JSON.parse(fs.readFileSync(configRoot+'/config.json','utf8'));
const auth=JSON.parse(fs.readFileSync(process.env.SUPER_AGENT_ROLE_PROXY_AUTH_FILE??configRoot+'/auth.json','utf8'));
const fail=(res,status,code)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:code,type:'role_scope'}}));};
const audit=event=>fs.appendFileSync(auditRoot+'/provider.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
const claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString());
const account=auth.tokens.account_id??claims['https://api.openai.com/auth']?.chatgpt_account_id;
if(!account||!auth.tokens.access_token)throw Error('ROLE_PROXY_AUTH_REQUIRED');
let session=null,count=0,mcpCount=0;
const admittedTools=[...(config.effectiveCapabilities?.mcpAllowedTools??config.mcpAllowedTools??[])];
let allowedTools=config.readOnlyToolsOnly===true?[]:[...admittedTools];
for(const tool of config.hostTools??[])if(!allowedTools.includes(tool.name))allowedTools.push(tool.name);
const publicIp=ip=>/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)&&
 !/^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|224\.|255\.)/.test(ip);
const handler=async(req,res)=>{
 try{
  if(!req.url?.startsWith('/'))return fail(res,403,'ROLE_PROXY_ABSOLUTE_URL_DENIED');
  if(req.headers.authorization!=='Bearer '+config.key){audit({code:'ROLE_PROXY_TOKEN_DENIED',method:req.method,path:new URL(req.url,'http://local').pathname});return fail(res,403,'ROLE_PROXY_TOKEN_DENIED');}
  if(Date.now()>config.expiresAt)return fail(res,403,'ROLE_PROXY_EXPIRED');
  const url=new URL(req.url,'http://local');
  const modelPath=req.method==='POST'&&url.pathname==='/backend-api/codex/responses';
  const hostMcpPath=req.method==='POST'&&url.pathname==='/backend-api/role-host-mcp';
  const mcpPath=hostMcpPath||['GET','POST','DELETE'].includes(req.method)&&url.pathname==='/backend-api/ps/mcp';
  const metadata=(req.method==='GET'&&['/backend-api/codex/models','/backend-api/wham/usage'].includes(url.pathname))||
    (['GET','POST'].includes(req.method)&&url.pathname==='/backend-api/wham/accounts/check')||
    (req.method==='GET'&&['/backend-api/ps/plugins/suggested/codex','/backend-api/wham/settings/user',
      '/backend-api/ps/plugins/installed','/backend-api/ps/plugins/list','/backend-api/plugins/featured'].includes(url.pathname));
  if(req.method==='POST'&&url.pathname==='/backend-api/codex/analytics-events/events'){res.writeHead(204);res.end();return;}
  if(!modelPath&&!metadata&&!mcpPath){audit({code:'ROLE_PROXY_PATH_DENIED',path:url.pathname});return fail(res,403,'ROLE_PROXY_PATH_DENIED');}
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
        timeoutMs:Math.max(1,Math.min(300000,config.expiresAt-Date.now()))});
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
  const controller=new AbortController();req.once('aborted',()=>controller.abort());
  const upstream=await fetch('https://chatgpt.com'+url.pathname+url.search,{method:req.method,headers,
    ...(body.length?{body}:{}),signal:controller.signal,redirect:'error'});
  const out={};for(const [k,v]of upstream.headers)if(!['content-encoding','transfer-encoding','content-length','connection','set-cookie'].includes(k))out[k]=v;
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
if(!['0.0.0.0','127.0.0.1'].includes(listenHost)||!Number.isInteger(listenPort)||listenPort<0||listenPort>65535)throw Error('ROLE_PROXY_LISTEN_DENIED');
server.listen(listenPort,listenHost,()=>{
 const address=server.address();audit({code:'ROLE_PROXY_READY',runId:config.runId,host:listenHost,port:address.port});
 if(process.env.SUPER_AGENT_ROLE_PROXY_READY_FILE)fs.writeFileSync(process.env.SUPER_AGENT_ROLE_PROXY_READY_FILE,JSON.stringify({runId:config.runId,host:listenHost,port:address.port})+'\n',{mode:0o600,flag:'wx'});
});
tls?.listen(Number(process.env.SUPER_AGENT_ROLE_PROXY_TLS_PORT??8091),listenHost,()=>audit({code:'ROLE_PROXY_TLS_READY',runId:config.runId}));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{tls?.close();server.close(()=>process.exit(0));});
setTimeout(()=>process.exit(1),700000).unref();
