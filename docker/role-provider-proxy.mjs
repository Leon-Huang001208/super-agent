import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
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
const publicIp=ip=>/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)&&
 !/^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|224\.|255\.)/.test(ip);
const handler=async(req,res)=>{
 try{
  if(!req.url?.startsWith('/'))return fail(res,403,'ROLE_PROXY_ABSOLUTE_URL_DENIED');
  if(req.headers.authorization!=='Bearer '+config.key){audit({code:'ROLE_PROXY_TOKEN_DENIED',method:req.method,path:new URL(req.url,'http://local').pathname});return fail(res,403,'ROLE_PROXY_TOKEN_DENIED');}
  if(Date.now()>config.expiresAt)return fail(res,403,'ROLE_PROXY_EXPIRED');
  const url=new URL(req.url,'http://local');
  const modelPath=req.method==='POST'&&url.pathname==='/backend-api/codex/responses';
  const mcpPath=['GET','POST','DELETE'].includes(req.method)&&url.pathname==='/backend-api/ps/mcp';
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
  if(mcpPath){
   if(++mcpCount>64)return fail(res,429,'ROLE_PROXY_MCP_LIMIT');
   if(req.method==='POST'){
    const message=JSON.parse(body),method=message.method;
    const catalogs=['initialize','notifications/initialized','ping','tools/list','resources/list','resources/templates/list','prompts/list'];
    const safeTools=['sites.check_slug_availability','plugin_management.search_plugins'];
    if(!catalogs.includes(method)&&!(method==='tools/call'&&safeTools.includes(message.params?.name)&&config.mcpAllowedTools?.includes(message.params.name))){
     audit({code:'ROLE_PROXY_MCP_ACTION_DENIED'});return fail(res,403,'ROLE_PROXY_MCP_ACTION_DENIED');
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
  res.writeHead(upstream.status,out);
  if(upstream.body)for await(const bytes of upstream.body){if(res.destroyed){controller.abort();break;}res.write(Buffer.from(bytes));}
  res.end();audit({code:'ROLE_PROXY_COMPLETED',path:url.pathname,status:upstream.status,requestCount:count});
 }catch(e){audit({code:'ROLE_PROXY_UPSTREAM_UNKNOWN',errorType:e.name});if(!res.headersSent)fail(res,502,'ROLE_PROXY_UPSTREAM_UNKNOWN');else res.destroy();}
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
server.listen(8090,'0.0.0.0',()=>audit({code:'ROLE_PROXY_READY',runId:config.runId}));
tls?.listen(8091,'0.0.0.0',()=>audit({code:'ROLE_PROXY_TLS_READY',runId:config.runId}));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{tls?.close();server.close(()=>process.exit(0));});
setTimeout(()=>process.exit(1),700000).unref();
