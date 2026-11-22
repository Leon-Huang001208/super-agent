import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const runId='c1266c90-e4ec-40e8-b531-135b58d03c25',key='fixture-opaque-client-token',apiKey='fixture-real-api-secret';
const codexToken='fixture-codex-delegated-access',prompt='fixture-private-user-prompt';
const sse='data: {"type":"thinking","text":"preserved"}\n\ndata: [DONE]\n\n';
const definitions={deepseek_opencode:{path:'/backend-api/model/v1/chat/completions',model:'deepseek-flash',url:'https://api.deepseek.com/v1/chat/completions'},
 minimax_opencode:{path:'/backend-api/model/anthropic/v1/messages',model:'MiniMax-M3.1-Flash',url:'https://api.minimax.cn/anthropic/v1/messages'},
 deepseek_claude:{path:'/backend-api/model/anthropic/v1/messages',model:'deepseek-flash',url:'https://api.deepseek.com/anthropic/v1/messages'},
 minimax_claude:{path:'/backend-api/model/anthropic/v1/messages',model:'MiniMax-M3.1-Flash',url:'https://api.minimax.cn/anthropic/v1/messages'}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(t,{profile='deepseek_opencode',codex=false,apiAuth={},apiAuthName='api-auth.json',apiAuthMode=0o600,config={},mode='sse',failure=false,expiresIn=60000}={}){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-api-proxy-'));
 const write=(name,value)=>fs.writeFileSync(path.join(root,name),typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
 write('config.json',{runId,key,expiresAt:Date.now()+expiresIn,mcpAllowedTools:[],hostTools:[],...(profile===undefined?{}:{runtimeProfileId:profile}),...config});
 if(apiAuth!==null){write(apiAuthName,{runId,runtimeProfileId:profile,apiKey,...apiAuth});fs.chmodSync(path.join(root,apiAuthName),apiAuthMode);}
 if(codex){const jwt='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account'}})).toString('base64url')+'.eA';write('auth.json',{tokens:{access_token:codexToken,id_token:jwt,account_id:'fixture-account'}});}
 write('fetch.mjs',`import fs from 'node:fs';
const root=${JSON.stringify(root)},mode=${JSON.stringify(mode)},apiKey=${JSON.stringify(apiKey)},key=${JSON.stringify(key)},sse=${JSON.stringify(sse)};
globalThis.fetch=async(url,options)=>{
 fs.appendFileSync(root+'/requests.jsonl',JSON.stringify({url,headers:options.headers,redirect:options.redirect,body:Buffer.isBuffer(options.body)?options.body.toString():options.body})+'\\n');
 if(String(url).startsWith('https://chatgpt.com')){
  if(mode==='cloud-reject')return new Response(JSON.stringify({error:${JSON.stringify(codexToken)}+' '+apiKey}),{status:403});
  if(String(url).includes('/ps/mcp'))return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{tools:[{name:'github.get_repo',inputSchema:{type:'object',properties:{repository_full_name:{type:'string'}}},annotations:{readOnlyHint:true}}]}}),{headers:{'content-type':'application/json'}});
  return new Response(sse,{headers:{'content-type':'text/event-stream'}});
 }
 if(mode==='reject')return new Response(JSON.stringify({error:apiKey+' '+key+' '+${JSON.stringify(prompt)}}),{status:401,headers:{'x-secret':apiKey}});
 if(mode==='redirect')return new Response(apiKey,{status:302,headers:{location:'https://foreign.invalid/'+apiKey}});
 if(mode==='throw')throw Error(apiKey);
 if(mode==='slow')return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: first\\n\\n'));options.signal.addEventListener('abort',()=>{fs.writeFileSync(root+'/aborted','yes');controller.error(Object.assign(Error('aborted'),{name:'AbortError'}));},{once:true});}}),{headers:{'content-type':'text/event-stream'}});
 return new Response(sse,{headers:{'content-type':'text/event-stream','x-request-id':'fixture-request','x-secret':apiKey,authorization:'Bearer '+apiKey,'set-cookie':'private-cookie'}});
};`);
 const child=spawn(process.execPath,['--import',path.join(root,'fetch.mjs'),'docker/role-provider-proxy.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH,
  SUPER_AGENT_ROLE_PROXY_ROOT:root,SUPER_AGENT_ROLE_PROXY_AUDIT:root,SUPER_AGENT_ROLE_PROXY_LISTEN_HOST:'127.0.0.1',SUPER_AGENT_ROLE_PROXY_PORT:'0',SUPER_AGENT_ROLE_PROXY_READY_FILE:path.join(root,'ready.json'),
  ...(apiAuthName!=='api-auth.json'?{SUPER_AGENT_ROLE_API_AUTH_FILE:path.join(root,apiAuthName)}:{})},stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const exited=new Promise(resolve=>child.once('exit',resolve));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([exited,delay(2000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}fs.rmSync(root,{recursive:true,force:true});});
 let ready;
 for(let i=0;i<150;i++){
  if(fs.existsSync(path.join(root,'ready.json'))){ready=JSON.parse(fs.readFileSync(path.join(root,'ready.json')));break;}
  if(child.exitCode!==null||child.signalCode!==null)break;
  await delay(10);
 }
 if(failure){assert.equal(ready,undefined);await Promise.race([exited,delay(2000)]);assert.notEqual(child.exitCode,0);}
 else assert.ok(ready,stderr);
 const base=ready?'http://127.0.0.1:'+ready.port:null;
 const request=(overrides={})=>{
  const headers={authorization:'Bearer '+key,'x-paperclip-run-id':runId,'content-type':'application/json',...overrides.headers};
  for(const name of Object.keys(headers))if(headers[name]===undefined)delete headers[name];
  return fetch(base+(overrides.path??definitions[profile]?.path??'/backend-api/codex/responses'),{method:'POST',headers,
   body:overrides.body??JSON.stringify({model:definitions[profile]?.model??'gpt-6.1-sol',messages:[{role:'user',content:prompt}],stream:true}),signal:overrides.signal});
 };
 const read=name=>fs.existsSync(path.join(root,name))?fs.readFileSync(path.join(root,name),'utf8'):'';
 return{root,base,child,exited,request,read,stderr:()=>stderr,requests:()=>read('requests.jsonl').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};
}

test('API profiles forward fixed models and SSE without requiring or leaking Codex credentials',async t=>{
 for(const profile of Object.keys(definitions)){
  const f=await fixture(t,{profile,...(profile==='minimax_opencode'?{apiAuthName:'caller-private-api-auth.json'}:{})});
  const response=await f.request({headers:profile==='minimax_opencode'?{'x-api-key':key,authorization:undefined}:{}});
  assert.equal(response.status,200);assert.equal(await response.text(),sse);
  assert.equal(response.headers.get('x-request-id'),'fixture-request');assert.equal(response.headers.get('x-secret'),null);assert.equal(response.headers.get('authorization'),null);assert.equal(response.headers.get('set-cookie'),null);
  const [upstream]=f.requests();assert.equal(upstream.url,definitions[profile].url);
  assert.equal(JSON.parse(upstream.body).model,definitions[profile].model);
  assert.equal(JSON.stringify(upstream.headers).includes(key),false);assert.equal(JSON.stringify(upstream.headers).includes(apiKey),true);
  const audit=f.read('provider.jsonl');for(const value of [key,apiKey,prompt])assert.equal(audit.includes(value),false);
 }
});

test('Claude SDK beta query is forwarded exactly and cannot carry arbitrary routing overrides',async t=>{
 for(const profile of ['deepseek_claude','minimax_claude']){
  const f=await fixture(t,{profile});
  const ok=await f.request({path:definitions[profile].path+'?beta=true',headers:{'x-api-key':key,authorization:undefined}});
  assert.equal(ok.status,200);await ok.text();assert.equal(f.requests()[0].url,definitions[profile].url+'?beta=true');
  const denied=await f.request({path:definitions[profile].path+'?beta=true&model=other'});
  assert.equal(denied.status,403);await denied.text();assert.equal(f.requests().length,1);
 }
});

test('API branch rejects wrong run, model, token and Codex fallback before any upstream request',async t=>{
 const f=await fixture(t);
 for(const changes of [{headers:{'x-paperclip-run-id':'other'}},{headers:{authorization:'Bearer wrong'}},{body:'{"model":"gpt-6.1-sol"}'},
  {path:'/backend-api/codex/responses',body:'{"model":"gpt-6.1-sol","reasoning":{"effort":"low"}}'}]){
  const r=await f.request(changes);assert.equal(r.status,403);await r.text();
 }
 const unknown=await f.request({path:'/backend-api/not-a-route/'+apiKey});assert.equal(unknown.status,403);await unknown.text();
 assert.equal(f.read('provider.jsonl').includes(apiKey),false);
 assert.equal(f.requests().length,0);
});

test('one per-run authorizer enforces the 64 request ceiling',async t=>{
 const f=await fixture(t);
 for(let i=0;i<64;i++){const r=await f.request();assert.equal(r.status,200);await r.text();}
 const denied=await f.request();assert.equal(denied.status,429);assert.match(await denied.text(),/ROLE_API_REQUEST_LIMIT/);
 assert.equal(f.requests().length,64);
});

test('upstream rejection and network failure never expose provider body or credentials and do not retry',async t=>{
 for(const[mode,status,code]of[['reject',401,'ROLE_API_UPSTREAM_HTTP_ERROR'],['redirect',302,'ROLE_API_UPSTREAM_HTTP_ERROR'],['throw',502,'ROLE_API_UPSTREAM_UNKNOWN']]){
  const f=await fixture(t,{mode});const r=await f.request();assert.equal(r.status,status);const body=await r.text();assert.match(body,new RegExp(code));
  for(const value of [apiKey,key,prompt]){assert.equal(body.includes(value),false);assert.equal(f.read('provider.jsonl').includes(value),false);}
  assert.equal(f.requests().length,1);
  assert.equal(f.requests()[0].redirect,'manual');assert.equal(r.headers.get('location'),null);
 }
});

test('host MCP works without Codex auth, while remote Apps require the existing delegated subscription',async t=>{
 const host=await fixture(t,{config:{hostTools:[{name:'host.network_observe',inputSchema:{type:'object'}}]}});
 const local=await host.request({path:'/backend-api/role-host-mcp',body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'});
 assert.equal(local.status,200);assert.equal((await local.json()).result.tools[0].name,'host.network_observe');
 const absent=await host.request({path:'/backend-api/ps/mcp',body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'});
 assert.equal(absent.status,403);assert.match(await absent.text(),/ROLE_PROXY_APPS_AUTH_REQUIRED/);assert.equal(host.requests().length,0);
 const cloud=await fixture(t,{codex:true,config:{mcpAllowedTools:['github.get_repo'],projectContext:{repository:{fullName:'fixture/repository'}}}});
 const remote=await cloud.request({path:'/backend-api/ps/mcp',headers:{'x-api-key':key},body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'});
 assert.equal(remote.status,200);assert.equal((await remote.json()).result.tools[0].name,'github.get_repo');
 assert.equal(cloud.requests()[0].headers.authorization,'Bearer '+codexToken);
 assert.equal(cloud.requests()[0].redirect,'manual');
 assert.equal(JSON.stringify(cloud.requests()[0].headers).includes(apiKey),false);
 assert.equal(JSON.stringify(cloud.requests()[0].headers).includes(key),false);
 assert.equal(cloud.read('provider.jsonl').includes(codexToken),false);
 const leakedCredential=await cloud.request({body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:codexToken}]})});
 assert.equal(leakedCredential.status,403);assert.match(await leakedCredential.text(),/ROLE_API_BODY_SECRET_DENIED/);assert.equal(cloud.requests().length,1);
 const rejected=await fixture(t,{codex:true,mode:'cloud-reject',config:{mcpAllowedTools:['github.get_repo']}});
 const denied=await rejected.request({path:'/backend-api/ps/mcp',body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'});
 assert.equal(denied.status,403);const text=await denied.text();assert.match(text,/ROLE_PROXY_APPS_UPSTREAM_HTTP_ERROR/);
 for(const secret of [key,apiKey,codexToken]){assert.equal(text.includes(secret),false);assert.equal(rejected.read('provider.jsonl').includes(secret),false);}
});

test('declared Apps capability, invalid API binding and unknown profiles fail closed before readiness',async t=>{
 for(const item of [{config:{mcpAllowedTools:['github.get_repo']},expected:'ROLE_PROXY_APPS_AUTH_REQUIRED'},
  {config:{mcpAllowedTools:['github.get_repo'],effectiveCapabilities:{mcpAllowedTools:[]}},expected:'ROLE_PROXY_APPS_AUTH_REQUIRED'},
  {apiAuth:{runId:'another-run'},expected:'ROLE_API_AUTH_DENIED'},
  {apiAuth:{runtimeProfileId:'minimax_opencode'},expected:'ROLE_API_AUTH_DENIED'},
  {apiAuthMode:0o644,expected:'ROLE_API_AUTH_DENIED'},
  {apiAuth:null,expected:'ROLE_API_AUTH_REQUIRED'},
  {profile:'unregistered',expected:'ROLE_PROXY_PROFILE_DENIED'}]){
  const f=await fixture(t,{...item,failure:true});assert.match(f.stderr(),new RegExp(item.expected));
  for(const secret of [key,apiKey,codexToken])assert.equal(f.stderr().includes(secret),false);
 }
});

test('no runtime profile retains the existing Codex fixed-model and session contract',async t=>{
 const f=await fixture(t,{profile:'codex_subscription',codex:true,config:{runtimeProfileId:undefined}});
 const request=(model,session)=>f.request({path:'/backend-api/codex/responses',headers:{'session-id':session},body:JSON.stringify({model,reasoning:{effort:'low'}})});
 const ok=await request('gpt-6.1-sol','one');assert.equal(ok.status,200);assert.equal(await ok.text(),sse);
 const otherSession=await request('gpt-6.1-sol','two');assert.equal(otherSession.status,403);await otherSession.text();
 const otherModel=await request('other','one');assert.equal(otherModel.status,403);await otherModel.text();
 assert.equal(f.requests().length,1);assert.equal(f.requests()[0].headers.authorization,'Bearer '+codexToken);
 assert.equal(f.requests()[0].redirect,'error');
});

test('client cancellation, grant expiry and broker termination abort in-flight API responses',{timeout:10000},async t=>{
 for(const action of ['client','expiry','terminate']){
  const f=await fixture(t,{mode:'slow',expiresIn:action==='expiry'?2000:60000});const abort=new AbortController();
  const response=await f.request({signal:abort.signal});const reader=response.body.getReader();await reader.read();
  if(action==='client')abort.abort();else if(action==='terminate')f.child.kill('SIGTERM');
  for(let i=0;i<300&&!f.read('aborted');i++)await delay(10);
  assert.equal(f.read('aborted'),'yes');await reader.cancel().catch(()=>{});
 }
});
