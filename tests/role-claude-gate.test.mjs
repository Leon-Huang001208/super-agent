import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClaudeRoleCall,claudeMetadata} from '../docker/role-claude-gate.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';

const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',other='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const bundle='/paperclip/instances/default/companies/'+id+'/claude-prompt-cache/'+'a'.repeat(64);
function sample(profileId='minimax_claude'){
 const model=profileId==='minimax_claude'?'MiniMax-M3.1-Flash':'deepseek-flash';
 const permit={schemaVersion:1,runtimeProfileId:profileId,credentialGrantId:id,projectId:id,role:'backend-engineer',runId:id,taskId:id,agentId:id,companyId:id,
  model,reasoningEffort:null,apiFallback:false,expiresAt:200000,cwd:'/paperclip/instances/default/projects/'+id+'/'+id+'/_default',
  instructionsFilePath:'/paperclip/control/research-pm/materials/'+id+'.md',materialSha256:'a'.repeat(64),executionPolicy:MACOS_NATIVE_EXECUTION_POLICY};
 return{permit,args:['--print','--output-format','stream-json','--verbose','--dangerously-skip-permissions','--model',model,
  '--max-turns','64','--append-system-prompt-file',bundle+'/agent-instructions.md','--add-dir',bundle],
  env:{PAPERCLIP_RUN_ID:id,PAPERCLIP_AGENT_ID:id,PAPERCLIP_COMPANY_ID:id,PAPERCLIP_TASK_ID:id},cwd:permit.cwd,now:100000};
}
test('both canonical Claude profiles accept the exact stock fresh Native invocation',()=>{
 for(const profileId of ['minimax_claude','deepseek_claude']){const input=sample(profileId);assert.equal(validateClaudeRoleCall(input),input.permit);}
});
test('Claude gate rejects stale runtime/model/effort, foreign identity, inherited credentials and nonnative policy',()=>{
 const input=sample();
 for(const change of [{runtimeProfileId:'minimax_opencode'},{runtimeProfileId:'codex_subscription'},{model:'claude-opus'},
  {reasoningEffort:'high'},{apiFallback:true},{expiresAt:100000},{credentialGrantId:'bad'},{cwd:'/tmp/arbitrary'},
  {executionPolicy:{...MACOS_NATIVE_EXECUTION_POLICY,sandbox:'workspace-write'}}])assert.throws(()=>validateClaudeRoleCall({...input,permit:{...input.permit,...change}}),/ROLE_CLAUDE_GATE_/);
 for(const name of ['PAPERCLIP_RUN_ID','PAPERCLIP_TASK_ID','PAPERCLIP_COMPANY_ID','PAPERCLIP_AGENT_ID'])assert.throws(()=>validateClaudeRoleCall({...input,env:{...input.env,[name]:other}}),/SCOPE_DENIED/);
 for(const name of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_CUSTOM_HEADERS','CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY','DEEPSEEK_API_KEY','MINIMAX_API_KEY','SUPER_AGENT_ROLE_PROVIDER_API_KEY','OPENCODE_CONFIG'])assert.throws(()=>validateClaudeRoleCall({...input,env:{...input.env,[name]:'untrusted'}}),/SCOPE_DENIED/);
});
test('Claude Native argv cannot introduce a different prompt file, tools, MCP, model, fallback or inherited session',()=>{
 const input=sample();
 for(const args of [[...input.args,'arbitrary-prompt'],[...input.args,'--resume',id],[...input.args,'--fallback-model','other'],
  [...input.args,'--mcp-config','/tmp/untrusted.json'],[...input.args,'--tools','Bash'],[...input.args,'--effort','high'],
  input.args.map(value=>value==='64'?'65':value),input.args.map(value=>value===bundle?bundle.replace(id,other):value),
  input.args.map(value=>value===bundle+'/agent-instructions.md'?'/tmp/instructions.md':value),
  input.args.map(value=>value===bundle?bundle+'/../escape':value)])assert.throws(()=>validateClaudeRoleCall({...input,args}),/ARGUMENTS_DENIED/);
});
test('Claude metadata comes only from a fresh trusted host CLI catalog and does not expose a model catalog',()=>{
 const catalog={schemaVersion:1,hostPlatform:'darwin',capturedAt:new Date(100000).toISOString(),expiresAt:200000,
  claude:{path:'/Users/leon/.local/bin/claude',version:'2.1.330'}};
 assert.equal(claudeMetadata(['--version'],catalog,{now:150000}),'2.1.330 (Claude Code)\n');
 assert.throws(()=>claudeMetadata(['models'],catalog,{now:150000}),/ARGUMENTS_DENIED/);
 for(const changed of [{...catalog,expiresAt:150000},{...catalog,hostPlatform:'linux'},{...catalog,claude:{...catalog.claude,path:'claude'}},
  {...catalog,claude:{...catalog.claude,version:'untrusted\ntext'}}])assert.throws(()=>claudeMetadata(['--version'],changed,{now:150000}),/CATALOG_DENIED/);
});
