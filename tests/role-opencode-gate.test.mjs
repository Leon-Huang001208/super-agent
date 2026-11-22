import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateOpenCodeRoleCall,validateHostRuntimeCatalog,openCodeMetadata} from '../docker/role-opencode-gate.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';

const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',other='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
function sample(profileId='deepseek_opencode'){
 const profile=RUNTIME_PROFILES[profileId],role=profileId==='deepseek_opencode'?'research':'pm';
 const permit={schemaVersion:1,runtimeProfileId:profileId,credentialGrantId:id,projectId:id,role,runId:id,taskId:id,agentId:id,companyId:id,
  model:profile.model,reasoningEffort:null,apiFallback:false,expiresAt:200000,cwd:'/paperclip/instances/default/projects/'+id+'/'+id+'/_default',
  instructionsFilePath:'/paperclip/control/research-pm/materials/'+id+'.md',materialSha256:'a'.repeat(64),executionPolicy:MACOS_NATIVE_EXECUTION_POLICY};
 return{permit,args:['run','--format','json','--model',permit.model,'--dir',permit.cwd],
  env:{PAPERCLIP_RUN_ID:id,PAPERCLIP_AGENT_ID:id,PAPERCLIP_COMPANY_ID:id,PAPERCLIP_TASK_ID:id},cwd:permit.cwd,now:100000};
}
test('exact Native API profile accepts both providers without a Codex auth home',()=>{
 for(const name of ['deepseek_opencode','minimax_opencode']){const input=sample(name);assert.equal(validateOpenCodeRoleCall(input),input.permit);}
});
test('gate binds every Native identity, canonical API profile, expiry and policy',()=>{
 const input=sample();
 for(const change of [{schemaVersion:2},{runtimeProfileId:'codex_subscription'},{runtimeProfileId:'unknown'},{model:'deepseek-flash'},
  {model:RUNTIME_PROFILES.minimax_opencode.model},{reasoningEffort:'low'},{apiFallback:true},{expiresAt:100000},{expiresAt:400001},
  {credentialGrantId:'invalid'},{executionPolicy:{...MACOS_NATIVE_EXECUTION_POLICY,sandbox:'workspace-write'}},{cwd:'/tmp/arbitrary'}]){
  assert.throws(()=>validateOpenCodeRoleCall({...input,permit:{...input.permit,...change}}),/ROLE_OPENCODE_GATE_/);
 }
 for(const key of ['PAPERCLIP_RUN_ID','PAPERCLIP_AGENT_ID','PAPERCLIP_COMPANY_ID','PAPERCLIP_TASK_ID'])assert.throws(()=>validateOpenCodeRoleCall({...input,env:{...input.env,[key]:other}}),/SCOPE_DENIED/);
 for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','SUPER_AGENT_ROLE_PROVIDER_API_KEY','DEEPSEEK_API_KEY','MINIMAX_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENCODE_CONFIG_CONTENT'])assert.throws(()=>validateOpenCodeRoleCall({...input,env:{...input.env,[key]:'private-value'}}),/SCOPE_DENIED/);
 assert.doesNotThrow(()=>validateOpenCodeRoleCall({...input,env:{...input.env,OPENCODE_CONFIG:'/paperclip/control/research-pm/opencode-clients/'+id+'/config.json'}}));
 assert.throws(()=>validateOpenCodeRoleCall({...input,env:{...input.env,OPENCODE_CONFIG:'/tmp/untrusted.json'}}),/SCOPE_DENIED/);
});
test('only the stock fresh-session OpenCode argv is allowed',()=>{
 const input=sample();
 for(const args of [[...input.args,'--continue'],[...input.args,'--session',id],[...input.args,'--variant','low'],['run',...input.args],
  input.args.filter(value=>value!=='--dir'),[...input.args.slice(0,3),'--dir',input.cwd,'--model',input.permit.model]]){
  assert.throws(()=>validateOpenCodeRoleCall({...input,args}),/ARGUMENTS_DENIED/);
 }
});
test('project/capability and bounded complete material snapshot checks match the Native scope',()=>{
 const input=sample(),file='isolated/research/AGENTS.md',manifest={schemaVersion:1,project:'isolated',role:'research',instructionsFilePath:file,requiredReferences:[],files:[{path:file,sha256:'a'.repeat(64)}]};
 const snapshot={schemaVersion:1,companyId:id,ownerId:'owner',projectId:id,projectKey:'isolated',role:'research',runId:id,manifest,
  manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
 const permit={...input.permit,ownerId:'owner',instructionsFilePath:'/paperclip/control/research-pm/materials/'+file,materialSnapshot:snapshot,
  projectContext:{id},effectiveCapabilities:{role:'research',capabilityIds:['research'],hostAllowedTools:['host.project_inspect']}};
 assert.doesNotThrow(()=>validateOpenCodeRoleCall({...input,permit}));
 for(const change of [{projectContext:{id:other}},{effectiveCapabilities:{role:'qa',capabilityIds:['qa']}},
  {materialSnapshot:{...snapshot,manifestSha256:'0'.repeat(64)}},{materialSnapshot:{...snapshot,projectId:other}}]){
  assert.throws(()=>validateOpenCodeRoleCall({...input,permit:{...permit,...change}}),/MATERIAL|SCOPE/);
 }
});
test('metadata uses only a fresh verified Darwin snapshot and never hardcodes a CLI version',()=>{
 const models=Object.values(RUNTIME_PROFILES).filter(profile=>['codex','opencode'].includes(profile.runtime)).map(profile=>profile.model),snapshot={schemaVersion:1,hostPlatform:'darwin',capturedAt:new Date(100000).toISOString(),expiresAt:200000,
  opencode:{path:'/Users/leon/.local/bin/opencode',version:'1.2.345'},models};
 assert.equal(validateHostRuntimeCatalog(snapshot,{now:150000}),snapshot);
 assert.equal(openCodeMetadata(['--version'],snapshot,{now:150000}),'1.2.345\n');
 assert.equal(openCodeMetadata(['-v'],snapshot,{now:150000}),'1.2.345\n');
 assert.equal(openCodeMetadata(['models'],snapshot,{now:150000}),models.join('\n')+'\n');
 for(const modified of [{...snapshot,expiresAt:150000},{...snapshot,hostPlatform:'linux'},{...snapshot,models:[...models,'evil/model']},{...snapshot,opencode:{...snapshot.opencode,version:'PRIVATE\nVALUE'}}])assert.throws(()=>validateHostRuntimeCatalog(modified,{now:150000}),/CATALOG_DENIED/);
 assert.throws(()=>openCodeMetadata(['models','--refresh'],snapshot,{now:150000}),/ARGUMENTS_DENIED/);
});
