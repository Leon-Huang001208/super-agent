import {RUNTIME_PROFILES} from './role-runtime-profiles.mjs';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const MAX_BODY_BYTES=4*1024*1024;
const ROUTES=Object.freeze({
 deepseek_opencode:Object.freeze({path:'/backend-api/model/v1/chat/completions',suffix:'/chat/completions'}),
 minimax_opencode:Object.freeze({path:'/backend-api/model/anthropic/v1/messages',suffix:'/messages'}),
 deepseek_claude:Object.freeze({path:'/backend-api/model/anthropic/v1/messages',suffix:'/messages'}),
 minimax_claude:Object.freeze({path:'/backend-api/model/anthropic/v1/messages',suffix:'/messages'}),
});
const OPTIONS=new Set(['profileId','runId','key','apiKey','expiresAt','now']);
const fail=(code,statusCode=403)=>{throw Object.assign(Error(code),{code,statusCode});};
const credential=value=>typeof value==='string'&&value.length>0&&value.trim()===value&&!/[\r\n]/.test(value);

function normalizedHeaders(headers){
 if(!headers||typeof headers!=='object'||Array.isArray(headers))fail('ROLE_API_TOKEN_DENIED');
 const result=Object.create(null);
 try{
  for(const[name,value]of Object.entries(headers)){
   const lower=name.toLowerCase();
   if(Object.hasOwn(result,lower)&&result[lower]!==value)fail('ROLE_API_HEADERS_DENIED');
   result[lower]=value;
  }
 }catch(error){
  if(error?.code==='ROLE_API_HEADERS_DENIED')throw error;
  fail('ROLE_API_HEADERS_DENIED');
 }
 return result;
}

/**
 * Authorize one fixed-profile model route. The caller owns HTTP, SSE, cancellation
 * and logging. Only result.audit is loggable; result.headers contains the real
 * upstream credential and result.body contains the private, unmodified prompt.
 * The opaque client key must be newly issued for this run, never the API key.
 */
export function createRoleApiRequestAuthorizer(options){
 if(!options||typeof options!=='object'||Array.isArray(options)||
    Object.keys(options).some(key=>!OPTIONS.has(key)))fail('ROLE_API_CONFIG_INVALID',500);
 const {profileId,runId,key,apiKey,expiresAt,now=Date.now}=options;
 if(!Object.hasOwn(ROUTES,profileId??'')||!Object.hasOwn(RUNTIME_PROFILES,profileId??'')||
    !UUID.test(runId??'')||!credential(key)||!credential(apiKey)||key===apiKey||
    !Number.isSafeInteger(expiresAt)||expiresAt<=0||typeof now!=='function'){
  fail('ROLE_API_CONFIG_INVALID',500);
 }
 const profile=RUNTIME_PROFILES[profileId],route=ROUTES[profileId];
 if(!['opencode','claude'].includes(profile.runtime)||profile.adapterType!==profile.runtime+'_local')fail('ROLE_API_CONFIG_INVALID',500);
 let count=0;
 return function authorize(request){
  const headers=normalizedHeaders(request?.headers);
  const bearer=headers.authorization,apiToken=headers['x-api-key'];
  if((bearer===undefined&&apiToken===undefined)||
     (bearer!==undefined&&bearer!=='Bearer '+key)||
     (apiToken!==undefined&&apiToken!==key))fail('ROLE_API_TOKEN_DENIED');
  if(headers['x-paperclip-run-id']!==runId)fail('ROLE_API_RUN_DENIED');
  let current;
  try{current=now();}catch{fail('ROLE_API_CLOCK_INVALID',500);}
  if(!Number.isFinite(current))fail('ROLE_API_CLOCK_INVALID',500);
  if(current>=expiresAt)fail('ROLE_API_EXPIRED');
  const sdkBeta=profile.runtime==='claude'&&request.path===route.path+'?beta=true';
  if(request.method!=='POST'||request.path!==route.path&&!sdkBeta)fail('ROLE_API_PATH_DENIED');
  // Authenticated model attempts remain spent even if the supplied body is bad.
  if(++count>64)fail('ROLE_API_REQUEST_LIMIT',429);
  if(typeof request.body!=='string'&&!Buffer.isBuffer(request.body))fail('ROLE_API_INPUT_INVALID',400);
  const bytes=Buffer.isBuffer(request.body)?request.body:Buffer.from(request.body);
  if(bytes.length>MAX_BODY_BYTES)fail('ROLE_API_INPUT_LIMIT',413);
  if(bytes.includes(key)||bytes.includes(apiKey))fail('ROLE_API_BODY_SECRET_DENIED');
  let message;
  try{message=JSON.parse(bytes.toString('utf8'));}catch{fail('ROLE_API_INPUT_INVALID',400);}
  if(!message||typeof message!=='object'||Array.isArray(message))fail('ROLE_API_INPUT_INVALID',400);
  if(message.model!==profile.providerModel)fail('ROLE_API_MODEL_DENIED');

  const upstreamHeaders={'content-type':'application/json',accept:'application/json, text/event-stream'};
  if(profile.wireApi==='chat-completions')upstreamHeaders.authorization='Bearer '+apiKey;
  else if(profile.wireApi==='anthropic-messages'){
   upstreamHeaders['x-api-key']=apiKey;
   for(const name of ['anthropic-version','anthropic-beta']){
    const value=headers[name]??(name==='anthropic-version'?'2023-06-01':undefined);
    if(value===undefined)continue;
    if(typeof value!=='string'||!value||/[\r\n]/.test(value)||value.includes(key)||value.includes(apiKey))fail('ROLE_API_HEADERS_DENIED');
    upstreamHeaders[name]=value;
   }
  }else fail('ROLE_API_CONFIG_INVALID',500);
  return Object.freeze({profileId,runId,url:profile.endpoint+route.suffix+(sdkBeta?'?beta=true':''),method:'POST',
   headers:Object.freeze(upstreamHeaders),body:Buffer.isBuffer(request.body)?Buffer.from(bytes):request.body,
   audit:Object.freeze({code:'ROLE_API_REQUEST_AUTHORIZED',profileId,runId,provider:profile.provider,
    model:profile.providerModel,requestCount:count})});
 };
}
