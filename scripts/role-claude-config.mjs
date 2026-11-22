import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {isMacNative} from '../bridge/role-execution-policy.mjs';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fail=(code='ROLE_CLAUDE_CONFIG_INVALID')=>{throw Object.assign(Error(code),{code});};
const absolute=value=>typeof value==='string'&&value.startsWith('/')&&!value.includes('\0')&&path.normalize(value)===value;
const MCP_SCRIPT=fileURLToPath(new URL('../docker/role-host-mcp-server.mjs',import.meta.url));

/** Pure host launch builder. The caller privately writes the two returned JSON files.
 * The only provider credential in the client is an opaque, expiring run token.
 * TLS trust and the bounded process lifecycle are supplied by the existing host transport.
 */
export function createRoleClaudeLaunch({permit,client,cwd,instructionPath,endpoint,key,hostTools=[],connectors=false,
 nodePath=process.execPath,mcpScriptPath=MCP_SCRIPT,mcpTimeoutMs=360000}={}){
 const profile=Object.hasOwn(RUNTIME_PROFILES,permit?.runtimeProfileId??'')?RUNTIME_PROFILES[permit.runtimeProfileId]:null;
 let native=false;try{native=isMacNative(permit);}catch{fail();}
 if(!profile||profile.runtime!=='claude'||profile.adapterType!=='claude_local'||!native||
  !UUID.test(permit?.runId??'')||permit.model!==profile.model||!absolute(client)||client==='/'||!absolute(cwd)||
  !absolute(instructionPath)||!absolute(nodePath)||!absolute(mcpScriptPath)||typeof key!=='string'||!key||/[\r\n]/.test(key)||
  typeof connectors!=='boolean'||!Number.isSafeInteger(mcpTimeoutMs)||mcpTimeoutMs<=0||
  !Array.isArray(hostTools)||hostTools.some(tool=>!/^host\.[a-z_]+$/.test(tool?.name??'')))fail();
 let address;
 try{
  if(typeof endpoint!=='string'||!/^https:\/\/127\.0\.0\.1(?::[0-9]+)?\/backend-api$/.test(endpoint))fail('ROLE_CLAUDE_ENDPOINT_DENIED');
  address=new URL(endpoint);if(address.port==='0')fail('ROLE_CLAUDE_ENDPOINT_DENIED');
 }catch{fail('ROLE_CLAUDE_ENDPOINT_DENIED');}
 const base=address.origin+'/backend-api',settingsPath=path.join(client,'claude-settings.json'),mcpConfigPath=path.join(client,'claude-mcp.json');
 const env={HOME:path.join(client,'home'),CLAUDE_CONFIG_DIR:path.join(client,'claude'),
  XDG_CONFIG_HOME:path.join(client,'config'),XDG_DATA_HOME:path.join(client,'data'),XDG_STATE_HOME:path.join(client,'state'),XDG_CACHE_HOME:path.join(client,'cache'),
  // --bare deliberately uses the API-key auth path, never subscription/OAuth/keychain.
  ANTHROPIC_API_KEY:key,ANTHROPIC_BASE_URL:base+'/model/anthropic',ANTHROPIC_CUSTOM_HEADERS:'x-paperclip-run-id: '+permit.runId,
  ANTHROPIC_MODEL:profile.providerModel,ANTHROPIC_DEFAULT_OPUS_MODEL:profile.providerModel,ANTHROPIC_DEFAULT_SONNET_MODEL:profile.providerModel,
  ANTHROPIC_DEFAULT_HAIKU_MODEL:profile.providerModel,CLAUDE_CODE_SUBAGENT_MODEL:profile.providerModel,
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1',CLAUDE_CODE_DISABLE_AGENT_VIEW:'1',CLAUDE_CODE_DISABLE_CRON:'1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',CLAUDE_CODE_DISABLE_CLAUDE_MDS:'1',
  CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY:'1',CLAUDE_CODE_SKIP_PROMPT_HISTORY:'1',CLAUDE_CODE_MAX_RETRIES:'0',
  CLAUDE_CODE_STARTUP_FAILURE_RESULTS:'1',DISABLE_AUTOUPDATER:'1',DISABLE_UPDATES:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',
  ENABLE_CLAUDEAI_MCP_SERVERS:'false',ENABLE_TOOL_SEARCH:'false',CI:'1',NO_COLOR:'1',
  CODEX_CONNECTORS_TOKEN:key,ROLE_HOST_MCP_ENDPOINT:base+'/role-host-mcp',MCP_TIMEOUT:String(mcpTimeoutMs),
 };
 const settings={model:profile.providerModel,availableModels:[profile.providerModel],disableAllHooks:true,hooks:{},
  autoMemoryEnabled:false,enableAllProjectMcpServers:false,enabledMcpjsonServers:[],enabledPlugins:{},
  syncClaudeAiSkills:false,syncClaudeAiPlugins:false,disableAgentView:true};
 const mcpConfig={mcpServers:{}};
 if(hostTools.length)mcpConfig.mcpServers.role_host={type:'stdio',command:nodePath,args:[mcpScriptPath],
  env:{CODEX_CONNECTORS_TOKEN:key,ROLE_HOST_MCP_ENDPOINT:base+'/role-host-mcp'}};
 if(connectors)mcpConfig.mcpServers.paperclip_connectors={type:'http',url:base+'/ps/mcp',headers:{Authorization:'Bearer '+key}};
 return {args:['--bare','--print','--input-format','text','--output-format','stream-json','--verbose',
  '--dangerously-skip-permissions','--model',profile.providerModel,'--max-turns','64','--no-session-persistence',
  '--setting-sources','','--settings',settingsPath,'--strict-mcp-config','--mcp-config',mcpConfigPath,
  '--disable-slash-commands','--append-system-prompt-file',instructionPath],env,settings,mcpConfig,settingsPath,mcpConfigPath};
}
