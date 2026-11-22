import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoleClaudeLaunch} from '../scripts/role-claude-config.mjs';

const runId='76b07a34-dc94-4290-8c5a-b99fa0e6e055',key='synthetic-opaque-claude-token';
const policy={executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'};
const options={permit:{runId,runtimeProfileId:'minimax_claude',model:'MiniMax-M3.1-Flash',executionPolicy:policy},
 client:'/private/task/client',cwd:'/private/task/workspace',instructionPath:'/private/task/instructions.md',
 endpoint:'https://127.0.0.1:45678/backend-api',key};
const make=(changes={})=>createRoleClaudeLaunch({...options,...changes});
const code=expected=>error=>error.code===expected&&error.message===expected&&!error.message.includes(key);

test('Claude launch pins one canonical bare provider model and keeps its opaque credential out of argv/settings',()=>{
 for(const [runtimeProfileId,model]of [['minimax_claude','MiniMax-M3.1-Flash'],['deepseek_claude','deepseek-flash']]){
  const launch=make({permit:{...options.permit,runtimeProfileId,model}});
  assert.equal(launch.env.ANTHROPIC_MODEL,model);
  for(const field of ['ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','CLAUDE_CODE_SUBAGENT_MODEL'])assert.equal(launch.env[field],model);
  assert.equal(launch.env.ANTHROPIC_API_KEY,key);assert.equal(launch.env.ANTHROPIC_AUTH_TOKEN,undefined);
  assert.equal(launch.env.ANTHROPIC_BASE_URL,options.endpoint+'/model/anthropic');
  assert.equal(launch.env.ANTHROPIC_CUSTOM_HEADERS,'x-paperclip-run-id: '+runId);
  assert.equal(launch.args[launch.args.indexOf('--model')+1],model);
  assert.equal(JSON.stringify(launch.args).includes(key),false);assert.equal(JSON.stringify(launch.settings).includes(key),false);
  for(const flag of ['--bare','--print','--no-session-persistence','--strict-mcp-config','--disable-slash-commands'])assert.ok(launch.args.includes(flag));
  assert.equal(launch.args.includes('--resume'),false);assert.equal(launch.args.includes('--fallback-model'),false);
  assert.equal(launch.args[launch.args.indexOf('--append-system-prompt-file')+1],options.instructionPath);
  assert.equal(launch.args[launch.args.indexOf('--setting-sources')+1],'');
 }
});

test('fresh Claude configuration disables ambient hooks/skills/MCP and all background discovery',()=>{
 const launch=make();assert.equal(launch.env.HOME,options.client+'/home');assert.equal(launch.env.CLAUDE_CONFIG_DIR,options.client+'/claude');
 for(const field of ['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS','CLAUDE_CODE_DISABLE_AGENT_VIEW','CLAUDE_CODE_DISABLE_CRON',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','CLAUDE_CODE_DISABLE_AUTO_MEMORY','CLAUDE_CODE_DISABLE_CLAUDE_MDS','DISABLE_AUTOUPDATER','DISABLE_UPDATES','DISABLE_TELEMETRY','DISABLE_ERROR_REPORTING'])assert.equal(launch.env[field],'1');
 assert.equal(launch.env.CLAUDE_CODE_MAX_RETRIES,'0');assert.equal(launch.env.ENABLE_TOOL_SEARCH,'false');
 assert.deepEqual(launch.settings.hooks,{});assert.equal(launch.settings.disableAllHooks,true);assert.equal(launch.settings.autoMemoryEnabled,false);
 assert.deepEqual(launch.mcpConfig,{mcpServers:{}});assert.equal(launch.env.NODE_TLS_REJECT_UNAUTHORIZED,undefined);
 assert.equal(launch.settingsPath,options.client+'/claude-settings.json');assert.equal(launch.mcpConfigPath,options.client+'/claude-mcp.json');
});

test('only the explicit run host MCP and admitted connectors are added',()=>{
 const launch=make({hostTools:[{name:'host.project_inspect'}],connectors:true,nodePath:'/usr/local/bin/node',mcpScriptPath:'/trusted/mcp.mjs'});
 assert.deepEqual(launch.mcpConfig.mcpServers.role_host,{type:'stdio',command:'/usr/local/bin/node',args:['/trusted/mcp.mjs'],
  env:{CODEX_CONNECTORS_TOKEN:key,ROLE_HOST_MCP_ENDPOINT:options.endpoint+'/role-host-mcp'}});
 assert.deepEqual(launch.mcpConfig.mcpServers.paperclip_connectors,{type:'http',url:options.endpoint+'/ps/mcp',headers:{Authorization:'Bearer '+key}});
 assert.equal(launch.env.CODEX_CONNECTORS_TOKEN,key);assert.equal(launch.env.ROLE_HOST_MCP_ENDPOINT,options.endpoint+'/role-host-mcp');
 assert.equal(launch.args[launch.args.indexOf('--mcp-config')+1],launch.mcpConfigPath);
});

test('wrong runtime, model, policy, endpoint or unbounded paths fail with stable errors',()=>{
 for(const permit of [{...options.permit,runtimeProfileId:'minimax_opencode'},{...options.permit,runtimeProfileId:'codex_subscription'},
  {...options.permit,model:'claude-opus'},{...options.permit,runId:'bad'},
  {...options.permit,executionPolicy:{executor:'docker',sandbox:'workspace-write',approvalPolicy:'never',docker:'required'}}])assert.throws(()=>make({permit}),code('ROLE_CLAUDE_CONFIG_INVALID'));
 for(const endpoint of ['http://127.0.0.1:1/backend-api','https://external.invalid/backend-api',options.endpoint+'?',options.endpoint+'#',options.endpoint+'/wrong'])assert.throws(()=>make({endpoint}),code('ROLE_CLAUDE_ENDPOINT_DENIED'));
 for(const changes of [{client:'relative'},{cwd:'relative'},{instructionPath:'relative'},{key:'x\ny'},
  {hostTools:[{name:'untrusted.tool'}]},{connectors:'true'},{nodePath:'node'},{mcpScriptPath:'mcp.mjs'},{mcpTimeoutMs:0}])assert.throws(()=>make(changes),code('ROLE_CLAUDE_CONFIG_INVALID'));
});
