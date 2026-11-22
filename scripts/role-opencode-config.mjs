import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {isMacNative} from '../bridge/role-execution-policy.mjs';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fail=(code='ROLE_OPENCODE_CONFIG_INVALID')=>{throw Object.assign(Error(code),{code});};
const absolute=value=>typeof value==='string'&&value.startsWith('/')&&!value.includes('\0')&&path.normalize(value)===value;
const MCP_SCRIPT=fileURLToPath(new URL('../docker/role-host-mcp-server.mjs',import.meta.url));

/**
 * Build one fresh host invocation. No filesystem, credential-store or process
 * effects occur here. The caller writes config to env.OPENCODE_CONFIG privately
 * and merges its TLS trust/proxy environment. env's only credential is the run token;
 * it must not be logged. Real provider credentials remain at the broker.
 */
export function createRoleOpenCodeLaunch({permit,client,cwd,endpoint,key,hostTools=[],skillPaths=[],
 connectors=false,nodePath=process.execPath,mcpScriptPath=MCP_SCRIPT,mcpTimeoutMs=360000}={}){
 const profile=Object.hasOwn(RUNTIME_PROFILES,permit?.runtimeProfileId??'')?RUNTIME_PROFILES[permit.runtimeProfileId]:null;
 let native=false;
 try{native=isMacNative(permit);}catch{fail();}
 if(!profile||profile.runtime!=='opencode'||profile.adapterType!=='opencode_local'||!native||
    !UUID.test(permit?.runId??'')||(permit.model!==undefined&&permit.model!==profile.model)||
    !absolute(client)||client==='/'||!absolute(cwd)||!absolute(nodePath)||!absolute(mcpScriptPath)||
    typeof key!=='string'||!key||/[\r\n]/.test(key)||typeof connectors!=='boolean'||
    !Number.isSafeInteger(mcpTimeoutMs)||mcpTimeoutMs<=0||
    !Array.isArray(hostTools)||hostTools.some(tool=>!/^host\.[a-z_]+$/.test(tool?.name??''))||
    !Array.isArray(skillPaths)||skillPaths.some(value=>!absolute(value)))fail();
 let address;
 try{
  if(typeof endpoint!=='string'||!/^https:\/\/127\.0\.0\.1(?::[0-9]+)?\/backend-api$/.test(endpoint))fail('ROLE_OPENCODE_ENDPOINT_DENIED');
  address=new URL(endpoint);
  if(address.port==='0')fail('ROLE_OPENCODE_ENDPOINT_DENIED');
 }catch{fail('ROLE_OPENCODE_ENDPOINT_DENIED');}
 const base=address.origin+'/backend-api',namespace=profile.model.split('/')[0];
 const anthropic=profile.wireApi==='anthropic-messages';
 if(!anthropic&&profile.wireApi!=='chat-completions')fail();
 const env={
  HOME:path.join(client,'home'),XDG_CONFIG_HOME:path.join(client,'config'),
  XDG_DATA_HOME:path.join(client,'data'),XDG_STATE_HOME:path.join(client,'state'),XDG_CACHE_HOME:path.join(client,'cache'),
  OPENCODE_CONFIG:path.join(client,'opencode.json'),OPENCODE_CONFIG_DIR:path.join(client,'config','opencode'),
  OPENCODE_DISABLE_PROJECT_CONFIG:'1',OPENCODE_DISABLE_EXTERNAL_SKILLS:'1',OPENCODE_DISABLE_CLAUDE_CODE:'1',
  OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_TERMINAL_TITLE:'1',CI:'1',NO_COLOR:'1',
  PAPERCLIP_ROLE_PROVIDER_TOKEN:key,CODEX_CONNECTORS_TOKEN:key,ROLE_HOST_MCP_ENDPOINT:base+'/role-host-mcp',
 };
 const config={
  model:profile.model,small_model:profile.model,enabled_providers:[namespace],autoupdate:false,
  permission:'allow',instructions:[],plugin:[],skills:{paths:[...new Set(skillPaths)]},mcp:{},
  agent:{paperclip:{mode:'primary',model:profile.model}},
  provider:{[namespace]:{
   name:'Paperclip '+profile.provider,npm:anthropic?'@ai-sdk/anthropic':'@ai-sdk/deepseek',
   options:{baseURL:base+(anthropic?'/model/anthropic/v1':'/model/v1'),
    apiKey:'{env:PAPERCLIP_ROLE_PROVIDER_TOKEN}',headers:{'x-paperclip-run-id':permit.runId}},
   models:{[profile.providerModel]:{name:profile.providerModel}},
  }},
 };
 if(hostTools.length)config.mcp.role_host={type:'local',command:[nodePath,mcpScriptPath],
  environment:{CODEX_CONNECTORS_TOKEN:'{env:CODEX_CONNECTORS_TOKEN}',ROLE_HOST_MCP_ENDPOINT:'{env:ROLE_HOST_MCP_ENDPOINT}'},
  enabled:true,timeout:mcpTimeoutMs};
 if(connectors)config.mcp.paperclip_connectors={type:'remote',url:base+'/ps/mcp',
  headers:{Authorization:'Bearer {env:PAPERCLIP_ROLE_PROVIDER_TOKEN}'},oauth:false,enabled:true,timeout:mcpTimeoutMs};
 return {args:['run','--pure','--format','json','--model',profile.model,'--dir',cwd,'--agent','paperclip'],env,config};
}
