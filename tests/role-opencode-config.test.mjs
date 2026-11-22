import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRoleOpenCodeLaunch} from '../scripts/role-opencode-config.mjs';

const policy={executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'};
const runId='76b07a34-dc94-4290-8c5a-b99fa0e6e055',key='fixture-opaque-run-token';
const options={permit:{runId,runtimeProfileId:'deepseek_opencode',model:'deepseek/deepseek-flash',executionPolicy:policy},
 client:'/private/task/client',cwd:'/private/task/workspace',endpoint:'https://127.0.0.1:45678/backend-api',key};
const make=(changes={})=>createRoleOpenCodeLaunch({...options,...changes});
const code=expected=>error=>error.code===expected&&error.message===expected&&!error.message.includes(key);

test('DeepSeek uses its canonical model, native SDK and an opaque per-run environment credential',()=>{
 const result=make(),entry=result.config.provider.deepseek;
 assert.deepEqual(result.args,['run','--pure','--format','json','--model','deepseek/deepseek-flash','--dir',options.cwd,'--agent','paperclip']);
 assert.equal(result.config.model,'deepseek/deepseek-flash');assert.equal(result.config.small_model,result.config.model);
 assert.equal(entry.npm,'@ai-sdk/deepseek');assert.equal(entry.options.baseURL,options.endpoint+'/model/v1');
 assert.equal(entry.options.apiKey,'{env:PAPERCLIP_ROLE_PROVIDER_TOKEN}');
 assert.deepEqual(entry.options.headers,{'x-paperclip-run-id':runId});
 assert.equal(result.env.PAPERCLIP_ROLE_PROVIDER_TOKEN,key);assert.equal(result.env.CODEX_CONNECTORS_TOKEN,key);
 assert.equal(result.args.some(value=>value.includes(key)),false);assert.equal(JSON.stringify(result.config).includes(key),false);
 assert.equal(result.config.permission,'allow');assert.equal(result.config.autoupdate,false);
 assert.deepEqual(result.config.enabled_providers,['deepseek']);
 assert.deepEqual(result.config.instructions,[]);assert.deepEqual(result.config.plugin,[]);assert.deepEqual(result.config.mcp,{});
 assert.equal(result.args.includes('--session'),false);assert.equal(result.args.includes('--continue'),false);
});

test('MiniMax uses the Anthropic broker route with the exact canonical Coding Plan model',()=>{
 const permit={...options.permit,runtimeProfileId:'minimax_opencode',model:'minimax-cn-coding-plan/MiniMax-M3.1-Flash'};
 const result=make({permit}),entry=result.config.provider['minimax-cn-coding-plan'];
 assert.equal(result.args[result.args.indexOf('--model')+1],permit.model);
 assert.equal(entry.npm,'@ai-sdk/anthropic');assert.equal(entry.options.baseURL,options.endpoint+'/model/anthropic/v1');
 assert.deepEqual(Object.keys(entry.models),['MiniMax-M3.1-Flash']);
 assert.equal(result.config.small_model,permit.model);assert.deepEqual(result.config.enabled_providers,['minimax-cn-coding-plan']);
});

test('only explicit host tools, connectors and trusted skill paths are configured',()=>{
 const skillPaths=['/trusted/skills','/trusted/skills'],hostTools=[{name:'host.network_observe'}];
 const before=JSON.stringify({skillPaths,hostTools,permit:options.permit});
 const result=make({skillPaths,hostTools,connectors:true,nodePath:'/usr/local/bin/node',mcpScriptPath:'/trusted/role-host-mcp-server.mjs',mcpTimeoutMs:900000});
 assert.deepEqual(result.config.skills.paths,['/trusted/skills']);
 assert.deepEqual(result.config.mcp.role_host,{type:'local',command:['/usr/local/bin/node','/trusted/role-host-mcp-server.mjs'],
  environment:{CODEX_CONNECTORS_TOKEN:'{env:CODEX_CONNECTORS_TOKEN}',ROLE_HOST_MCP_ENDPOINT:'{env:ROLE_HOST_MCP_ENDPOINT}'},enabled:true,timeout:900000});
 assert.deepEqual(result.config.mcp.paperclip_connectors,{type:'remote',url:options.endpoint+'/ps/mcp',
  headers:{Authorization:'Bearer {env:PAPERCLIP_ROLE_PROVIDER_TOKEN}'},oauth:false,enabled:true,timeout:900000});
 assert.equal(JSON.stringify({skillPaths,hostTools,permit:options.permit}),before);
 assert.equal(JSON.stringify(result.config).includes('api.deepseek.com'),false);
});

test('all configuration and state paths are private and global/project discovery is disabled',()=>{
 const result=make();
 assert.equal(result.env.HOME,options.client+'/home');assert.equal(result.env.OPENCODE_CONFIG,options.client+'/opencode.json');
 for(const name of ['XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_CACHE_HOME','OPENCODE_CONFIG_DIR'])assert.ok(result.env[name].startsWith(options.client+'/'));
 assert.equal(result.env.OPENCODE_DISABLE_PROJECT_CONFIG,'1');assert.equal(result.env.OPENCODE_DISABLE_EXTERNAL_SKILLS,'1');
 assert.equal(result.env.OPENCODE_DISABLE_CLAUDE_CODE,'1');assert.equal(result.env.OPENCODE_DISABLE_AUTOUPDATE,'1');
 assert.equal(result.env.ROLE_HOST_MCP_ENDPOINT,options.endpoint+'/role-host-mcp');
 assert.equal(result.env.NODE_TLS_REJECT_UNAUTHORIZED,undefined);
});

test('builder rejects wrong runtime, policy, model, endpoint and malformed launch data without echoing input',()=>{
 for(const permit of [{...options.permit,runtimeProfileId:'codex_subscription'},{...options.permit,runtimeProfileId:'unknown'},
  {...options.permit,runId:'wrong'},{...options.permit,model:'other/model'},
  {...options.permit,executionPolicy:{executor:'docker',sandbox:'workspace-write',approvalPolicy:'never',docker:'required'}}]){
  assert.throws(()=>make({permit}),code('ROLE_OPENCODE_CONFIG_INVALID'));
 }
 for(const endpoint of ['http://127.0.0.1:1/backend-api','https://foreign.invalid/backend-api','https://user@127.0.0.1:1/backend-api',
  options.endpoint+'?',options.endpoint+'#',options.endpoint+'/other'])assert.throws(()=>make({endpoint}),code('ROLE_OPENCODE_ENDPOINT_DENIED'));
 for(const changes of [{client:'relative'},{cwd:'relative'},{key:''},{hostTools:[{name:'foreign.tool'}]},{skillPaths:['relative']},
  {nodePath:'node'},{mcpScriptPath:'relative'},{connectors:'yes'},{mcpTimeoutMs:0}])assert.throws(()=>make(changes),code('ROLE_OPENCODE_CONFIG_INVALID'));
});

test('the builder does not create its private directories or configuration file',t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'opencode-launch-pure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const client=path.join(root,'not-created');make({client,cwd:root});assert.equal(fs.existsSync(client),false);
});

const binary='/Users/leon/.npm-global/bin/opencode';
test('installed OpenCode pure mode retains explicit skills/MCP and ignores project discovery without a model call',
 {skip:process.platform!=='darwin'||!fs.existsSync(binary)?'Requires the installed macOS OpenCode CLI':false,timeout:30000},t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'opencode-launch-schema-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const client=path.join(root,'client'),cwd=path.join(root,'workspace'),skills=path.join(root,'trusted-skills'),mcp=path.join(root,'no-start.mjs');
 for(const dir of [cwd,path.join(skills,'approved-fixture'),path.join(cwd,'.agents/skills/untrusted-project'),path.join(cwd,'.opencode/skills/untrusted-opencode')])fs.mkdirSync(dir,{recursive:true});
 const skill=(name)=>`---\nname: ${name}\ndescription: Fixture skill\n---\n# Fixture\n`;
 fs.writeFileSync(path.join(skills,'approved-fixture/SKILL.md'),skill('approved-fixture'));
 fs.writeFileSync(path.join(cwd,'.agents/skills/untrusted-project/SKILL.md'),skill('untrusted-project'));
 fs.writeFileSync(path.join(cwd,'.opencode/skills/untrusted-opencode/SKILL.md'),skill('untrusted-opencode'));
 fs.writeFileSync(path.join(cwd,'opencode.json'),JSON.stringify({model:'foreign/wrong',provider:{foreign:{models:{wrong:{}}}}}));
 fs.writeFileSync(mcp,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root,'mcp-started'))},'started');process.exit(3);`);
 const launch=make({client,cwd,skillPaths:[skills],hostTools:[{name:'host.network_observe'}],connectors:true,mcpScriptPath:mcp});
 for(const dir of [launch.env.HOME,launch.env.OPENCODE_CONFIG_DIR])fs.mkdirSync(dir,{recursive:true});
 const homeSkill=path.join(launch.env.HOME,'.agents/skills/untrusted-home');fs.mkdirSync(homeSkill,{recursive:true});
 fs.writeFileSync(path.join(homeSkill,'SKILL.md'),skill('untrusted-home'));
 fs.writeFileSync(launch.env.OPENCODE_CONFIG,JSON.stringify(launch.config));
 // Config eagerly bootstraps its plugin dependency even in pure mode. This dummy
 // lock satisfies the metadata-only check without installing or executing it.
 fs.mkdirSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'node_modules'));
 fs.writeFileSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'package.json'),'{}');
 const lock=JSON.stringify({lockfileVersion:3,packages:{'':{dependencies:{'@opencode-ai/plugin':'1.19.6'}}}});
 fs.writeFileSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'package-lock.json'),lock);
 const env={PATH:process.env.PATH,LANG:'en_US.UTF-8',...launch.env,OPENCODE_DISABLE_MODELS_FETCH:'1',
  npm_config_registry:'http://127.0.0.1:9',npm_config_offline:'true',npm_config_fetch_retries:'0',npm_config_fetch_timeout:'500'};
 const run=what=>{const r=spawnSync(binary,['--pure','debug',what],{cwd,env,encoding:'utf8',timeout:12000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const resolved=run('config');assert.equal(resolved.model,'deepseek/deepseek-flash');assert.equal(resolved.provider.foreign,undefined);
 assert.equal(resolved.mcp.role_host.enabled,true);assert.equal(resolved.mcp.paperclip_connectors.enabled,true);
 assert.equal(resolved.mcp.role_host.command[1],mcp);assert.equal(resolved.mcp.paperclip_connectors.url,options.endpoint+'/ps/mcp');
 const names=run('skill').map(value=>value.name);assert.ok(names.includes('approved-fixture'));
 assert.ok(!names.includes('untrusted-project'));assert.ok(!names.includes('untrusted-opencode'));assert.ok(!names.includes('untrusted-home'));
 assert.equal(fs.existsSync(path.join(root,'mcp-started')),false);assert.deepEqual(fs.readdirSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'node_modules')),[]);
 assert.equal(fs.readFileSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'package.json'),'utf8'),'{}');
 assert.equal(fs.readFileSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'package-lock.json'),'utf8'),lock);
});
