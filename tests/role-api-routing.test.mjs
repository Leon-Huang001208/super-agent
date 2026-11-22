import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoleApiRequestAuthorizer} from '../bridge/role-api-routing.mjs';

const runId='8bd986d1-a6ea-4f9f-a361-134536f3bf53';
const key='synthetic-opaque-run-token';
const apiKey='synthetic-upstream-api-secret';
const definitions={
 deepseek_opencode:{path:'/backend-api/model/v1/chat/completions',model:'deepseek-flash',url:'https://api.deepseek.com/v1/chat/completions'},
 minimax_opencode:{path:'/backend-api/model/anthropic/v1/messages',model:'MiniMax-M3.1-Flash',url:'https://api.minimax.cn/anthropic/v1/messages'},
 deepseek_claude:{path:'/backend-api/model/anthropic/v1/messages',model:'deepseek-flash',url:'https://api.deepseek.com/anthropic/v1/messages'},
 minimax_claude:{path:'/backend-api/model/anthropic/v1/messages',model:'MiniMax-M3.1-Flash',url:'https://api.minimax.cn/anthropic/v1/messages'},
};
const authorize=(profileId='deepseek_opencode',overrides={})=>createRoleApiRequestAuthorizer({profileId,runId,key,apiKey,expiresAt:2000,now:()=>1000,...overrides});
const request=(profileId='deepseek_opencode',overrides={})=>({method:'POST',path:definitions[profileId].path,
 headers:{authorization:'Bearer '+key,'x-paperclip-run-id':runId},
 body:JSON.stringify({model:definitions[profileId].model,messages:[{role:'user',content:'你好'}],stream:true}),...overrides});
const code=expected=>error=>error.code===expected&&error.message===expected&&!JSON.stringify(error).includes(apiKey);

test('fixed DeepSeek route preserves request bytes and forwards only provider credentials',()=>{
 const body=Buffer.from('{"model":"deepseek-flash","messages":[{"role":"assistant","reasoning_content":"preserve this","content":"你好"}],"tools":[],"stream":true}');
 const result=authorize()(request('deepseek_opencode',{body,headers:{Authorization:'Bearer '+key,'X-Paperclip-Run-Id':runId,'x-local-secret':key,cookie:'private-cookie'}}));
 assert.equal(result.url,definitions.deepseek_opencode.url);assert.equal(result.method,'POST');
 assert.deepEqual(result.body,body);assert.equal(result.headers.authorization,'Bearer '+apiKey);
 assert.equal(JSON.stringify(result.headers).includes(key),false);assert.equal(result.headers.cookie,undefined);
 assert.equal(result.headers['x-local-secret'],undefined);assert.equal(result.headers['x-paperclip-run-id'],undefined);
 assert.deepEqual(result.audit,{code:'ROLE_API_REQUEST_AUTHORIZED',profileId:'deepseek_opencode',runId,provider:'deepseek',model:'deepseek-flash',requestCount:1});
 assert.equal(JSON.stringify(result.audit).includes(apiKey),false);assert.equal(JSON.stringify(result.audit).includes('preserve this'),false);
});

test('fixed MiniMax route preserves thinking/tool-use and the Anthropic protocol headers',()=>{
 const body=JSON.stringify({model:'MiniMax-M3.1-Flash',max_tokens:4096,thinking:{type:'enabled',budget_tokens:1024},messages:[{role:'assistant',content:[{type:'tool_use',id:'tool-one',name:'read',input:{}}]}],stream:true});
 const result=authorize('minimax_opencode')(request('minimax_opencode',{body,headers:{'x-api-key':key,'x-paperclip-run-id':runId,'anthropic-version':'2023-06-01','anthropic-beta':'interleaved-thinking-2025-05-14'}}));
 assert.equal(result.url,definitions.minimax_opencode.url);assert.equal(result.body,body);
 assert.equal(result.headers['x-api-key'],apiKey);assert.equal(result.headers.authorization,undefined);
 assert.equal(result.headers['anthropic-version'],'2023-06-01');assert.equal(result.headers['anthropic-beta'],'interleaved-thinking-2025-05-14');
 assert.equal(JSON.stringify(result.headers).includes(key),false);assert.equal(result.audit.model,'MiniMax-M3.1-Flash');
});

test('Claude Anthropic profiles accept opaque SDK auth and run headers, preserving thinking and rejecting alias fallback',()=>{
 for(const profileId of ['deepseek_claude','minimax_claude']){
  const body=JSON.stringify({model:definitions[profileId].model,max_tokens:512,thinking:{type:'adaptive'},messages:[],tools:[{name:'Read',input_schema:{type:'object'}}],stream:true});
  const result=authorize(profileId)(request(profileId,{body,headers:{'x-api-key':key,'x-paperclip-run-id':runId,'anthropic-version':'2023-06-01'}}));
  assert.equal(result.url,definitions[profileId].url);assert.equal(result.body,body);assert.equal(result.headers['x-api-key'],apiKey);
  assert.equal(result.headers['x-paperclip-run-id'],undefined);assert.equal(result.audit.profileId,profileId);
  assert.throws(()=>authorize(profileId)(request(profileId,{body:'{"model":"claude-opus"}'})),code('ROLE_API_MODEL_DENIED'));
 }
});

test('only Claude profiles allow the exact SDK beta query and preserve it upstream',()=>{
 for(const profileId of ['deepseek_claude','minimax_claude']){
  const result=authorize(profileId)(request(profileId,{path:definitions[profileId].path+'?beta=true'}));
  assert.equal(result.url,definitions[profileId].url+'?beta=true');
  for(const suffix of ['?beta=false','?beta=true&model=other','?beta=true&beta=true','?beta=%74rue','?Beta=true','?beta=true#x']){
   assert.throws(()=>authorize(profileId)(request(profileId,{path:definitions[profileId].path+suffix})),code('ROLE_API_PATH_DENIED'));
  }
 }
 assert.throws(()=>authorize('minimax_opencode')(request('minimax_opencode',{path:definitions.minimax_opencode.path+'?beta=true'})),code('ROLE_API_PATH_DENIED'));
});

test('rejects wrong, missing, conflicting or malformed local authentication',()=>{
 for(const headers of [
  {'x-paperclip-run-id':runId},
  {authorization:'Bearer wrong','x-paperclip-run-id':runId},
  {'x-api-key':'wrong','x-paperclip-run-id':runId},
  {authorization:'Bearer '+key,'x-api-key':'wrong','x-paperclip-run-id':runId},
  {authorization:['Bearer '+key],'x-paperclip-run-id':runId},
 ])assert.throws(()=>authorize()(request('deepseek_opencode',{headers})),code('ROLE_API_TOKEN_DENIED'));
 const valid={authorization:'Bearer '+key,'x-api-key':key,'x-paperclip-run-id':runId};
 assert.equal(authorize()(request('deepseek_opencode',{headers:valid})).audit.requestCount,1);
});

test('requires the run binding and checks expiry before authorizing',()=>{
 for(const value of [undefined,'another-run']){
  const headers={authorization:'Bearer '+key,...(value?{'x-paperclip-run-id':value}:{})};
  assert.throws(()=>authorize()(request('deepseek_opencode',{headers})),code('ROLE_API_RUN_DENIED'));
 }
 assert.throws(()=>authorize('deepseek_opencode',{now:()=>2000})(request()),code('ROLE_API_EXPIRED'));
 assert.throws(()=>authorize('deepseek_opencode',{now:()=>3000})(request()),code('ROLE_API_EXPIRED'));
});

test('denies other methods, protocol routes, absolute URLs, encoded paths and query strings',()=>{
 const paths=['/backend-api/codex/responses',definitions.minimax_opencode.path,'https://api.deepseek.com/v1/chat/completions','//foreign.invalid/path',definitions.deepseek_opencode.path+'?model=other','/backend-api/model/v1/%63hat/completions'];
 for(const path of paths)assert.throws(()=>authorize()(request('deepseek_opencode',{path})),code('ROLE_API_PATH_DENIED'));
 for(const method of ['GET','CONNECT','DELETE'])assert.throws(()=>authorize()(request('deepseek_opencode',{method})),code('ROLE_API_PATH_DENIED'));
});

test('model and input failures are stable, private and never rewrite a request to another model',()=>{
 for(const model of ['deepseek-v4-pro','gpt-6.1-sol',null,undefined]){
  assert.throws(()=>authorize()(request('deepseek_opencode',{body:JSON.stringify({model})})),code('ROLE_API_MODEL_DENIED'));
 }
 for(const body of ['not json','null','[]',{},undefined])assert.throws(()=>authorize()(request('deepseek_opencode',{body})),code('ROLE_API_INPUT_INVALID'));
 assert.throws(()=>authorize()(request('deepseek_opencode',{body:Buffer.alloc(4*1024*1024+1)})),code('ROLE_API_INPUT_LIMIT'));
 for(const secret of [key,apiKey])assert.throws(()=>authorize()(request('deepseek_opencode',{body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:secret}]})})),code('ROLE_API_BODY_SECRET_DENIED'));
});

test('the per-run request budget cannot exceed 64 or reset after an invalid model attempt',()=>{
 const check=authorize();
 assert.throws(()=>check(request('deepseek_opencode',{body:'{"model":"wrong"}'})),code('ROLE_API_MODEL_DENIED'));
 for(let i=2;i<=64;i++)assert.equal(check(request()).audit.requestCount,i);
 assert.throws(()=>check(request()),code('ROLE_API_REQUEST_LIMIT'));
 assert.throws(()=>check(request()),code('ROLE_API_REQUEST_LIMIT'));
});

test('rejects non-API profiles, arbitrary routing config, invalid identities and unsafe credentials',()=>{
 for(const overrides of [{profileId:'codex_subscription'},{profileId:'unknown'},{profileId:'toString'},{runId:'not-a-run'},{key:''},{apiKey:''},{key:apiKey},{apiKey:'bad\r\nheader'},{endpoint:'https://foreign.invalid'},{model:'other'}]){
  assert.throws(()=>authorize('deepseek_opencode',overrides),code('ROLE_API_CONFIG_INVALID'));
 }
});

test('optional vendor headers cannot carry local or upstream secrets',()=>{
 for(const value of [key,apiKey,'bad\r\nheader']){
  const headers={'x-api-key':key,'x-paperclip-run-id':runId,'anthropic-beta':value};
  assert.throws(()=>authorize('minimax_opencode')(request('minimax_opencode',{headers})),code('ROLE_API_HEADERS_DENIED'));
 }
});
