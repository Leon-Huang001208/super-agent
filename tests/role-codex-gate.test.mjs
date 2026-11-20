import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoleCall } from '../docker/role-codex-gate.mjs';
import { NATIVE_ROLE_MANAGED_ARGS } from '../bridge/native-role-adapter.mjs';
import {createHash} from 'node:crypto';

test('M2 permit binds its complete selected material manifest and rejects legacy workspace aliases',()=>{
 const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',other='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
 const instructions='beta/pm/instructions.md';
 const manifest={schemaVersion:1,project:'beta',role:'pm',instructionsFilePath:instructions,requiredReferences:['beta/shared/context.md'],
  files:[{path:instructions,sha256:'a'.repeat(64)},{path:'beta/shared/context.md',sha256:'b'.repeat(64)}]};
 const snapshot={schemaVersion:1,companyId:id,ownerId:'owner',projectId:id,projectKey:'beta',role:'pm',runId:id,manifest,
  manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
 const permit={schemaVersion:1,credentialGrantId:id,projectId:id,role:'pm',runId:id,taskId:id,agentId:id,companyId:id,ownerId:'owner',
  model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:200000,
  cwd:'/paperclip/instances/default/projects/'+id+'/'+id+'/_default',instructionsFilePath:'/paperclip/control/research-pm/materials/'+instructions,
  materialSha256:'a'.repeat(64),materialSnapshot:snapshot};
 const args=['--search','exec','--json','--model',permit.model,'-c','model_reasoning_effort="low"',...NATIVE_ROLE_MANAGED_ARGS,'-'];
 const env={PAPERCLIP_RUN_ID:id,PAPERCLIP_AGENT_ID:id,PAPERCLIP_COMPANY_ID:id,PAPERCLIP_TASK_ID:id,CODEX_HOME:'/tmp/paperclip-ai-'+id+'-'+id+'-abcdef/provider'};
 const input={permit,args,env,cwd:permit.cwd,now:100000};assert.equal(validateRoleCall(input),permit);
 const workspaceId='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa',scopedPermit={...permit,projectWorkspaceId:workspaceId,materialSnapshot:{...snapshot,projectWorkspaceId:workspaceId}};
 assert.equal(validateRoleCall({...input,permit:scopedPermit}),scopedPermit);
 assert.throws(()=>validateRoleCall({...input,permit:{...scopedPermit,materialSnapshot:{...scopedPermit.materialSnapshot,projectWorkspaceId:other}}}),/MATERIAL|SNAPSHOT/);
 assert.throws(()=>validateRoleCall({...input,permit:{...permit,materialSnapshot:{...snapshot,projectId:other}}}),/MATERIAL|SNAPSHOT|SCOPE/);
 assert.throws(()=>validateRoleCall({...input,permit:{...permit,materialSnapshot:{...snapshot,manifestSha256:'0'.repeat(64)}}}),/MATERIAL|SNAPSHOT/);
 const shared='/paperclip/control/research-pm/workspaces/pm';
 assert.throws(()=>validateRoleCall({...input,cwd:shared,permit:{...permit,cwd:shared}}),/MATERIAL|SNAPSHOT|SCOPE/);
});

test('role gate rejects expanded tools, old sessions, API fallback and mismatched Native run', () => {
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const permit={schemaVersion:1,credentialGrantId:id,projectId:id,role:'research',runId:id,taskId:id,agentId:id,companyId:id,model:'gpt-6.1-sol',
    reasoningEffort:'low',apiFallback:false,expiresAt:200000,cwd:'/paperclip/control/research-pm/workspaces/demo',
    instructionsFilePath:'/paperclip/control/research-pm/materials/'+id+'.md',materialSha256:'a'.repeat(64)};
  const args=['--search','exec','--json','--model',permit.model,'-c','model_reasoning_effort="low"',...NATIVE_ROLE_MANAGED_ARGS,'-'];
  const env={PAPERCLIP_RUN_ID:id,PAPERCLIP_AGENT_ID:id,PAPERCLIP_COMPANY_ID:id,PAPERCLIP_TASK_ID:id,
    CODEX_HOME:'/tmp/paperclip-ai-'+id+'-'+id+'-abcdef/provider'};
  const input={permit,args,env,cwd:permit.cwd,now:100000};
  assert.equal(validateRoleCall(input),permit);
  const networkPermit={...permit,role:'network-engineer'};
  assert.equal(validateRoleCall({...input,permit:networkPermit}),networkPermit);
  const resourcePermit={...permit,role:'system-resource-engineer'};
  assert.equal(validateRoleCall({...input,permit:resourcePermit}),resourcePermit);
  const prefix=['-c','features.shell_snapshot=false','-c','shell_environment_policy.inherit="all"','-c',
    'shell_environment_policy.ignore_default_excludes=true','-c','shell_environment_policy.include_only=["PATH","HOME"]'];
  assert.equal(validateRoleCall({...input,args:[...prefix,...args]}),permit);
  assert.throws(()=>validateRoleCall({...input,args:[...prefix.slice(0,7),'shell_environment_policy.include_only=["INVALID=VALUE"]',...args]}),/ARGUMENTS_DENIED/);
  assert.throws(()=>validateRoleCall({...input,env:{...env,CODEX_HOME:env.CODEX_HOME.replace('paperclip-ai-','paperclip-ai-foreign-')}}),/SCOPE_DENIED/);
  for(const badArgs of [[...args,'resume',id],args.filter(x=>x!=='workspace-write'),[...args,'--dangerously-bypass-approvals-and-sandbox']]){
    assert.throws(()=>validateRoleCall({...input,args:badArgs}),/ARGUMENTS_DENIED/);
  }
  assert.throws(()=>validateRoleCall({...input,env:{...env,OPENAI_API_KEY:'synthetic'}}),/SCOPE_DENIED/);
  assert.throws(()=>validateRoleCall({...input,env:{...env,PAPERCLIP_RUN_ID:'other'}}),/SCOPE_DENIED/);
  assert.throws(()=>validateRoleCall({...input,now:200001}),/SCOPE_DENIED/);
});

test('role gate accepts an exact managed role entry and pins its run copy', () => {
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const source='/paperclip/instances/default/companies/'+id+'/agents/'+id+'/instructions/research/AGENTS.md';
  const permit={schemaVersion:1,credentialGrantId:id,projectId:id,role:'research',runId:id,taskId:id,agentId:id,companyId:id,
    model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:200000,
    cwd:'/paperclip/control/research-pm/workspaces/research',materialSha256:'a'.repeat(64),
    instructionsFilePath:'/paperclip/instances/default/companies/'+id+'/agents/'+id+'/file-sync/runs/'+id+'/live/research/AGENTS.md',
    materialSourcePath:source};
  const args=['--search','exec','--json','--model',permit.model,'-c','model_reasoning_effort="low"',...NATIVE_ROLE_MANAGED_ARGS,'-'];
  const env={PAPERCLIP_RUN_ID:id,PAPERCLIP_AGENT_ID:id,PAPERCLIP_COMPANY_ID:id,PAPERCLIP_TASK_ID:id,
    CODEX_HOME:'/tmp/paperclip-ai-'+id+'-'+id+'-abcdef/provider'};
  const input={permit,args,env,cwd:permit.cwd,now:100000};
  assert.equal(validateRoleCall(input),permit);
  const bundle={...permit,materialRoot:permit.instructionsFilePath.slice(0,-'/research/AGENTS.md'.length),materialFiles:[{path:'research/AGENTS.md',sha256:'a'.repeat(64)},{path:'research/CAPABILITIES.md',sha256:'b'.repeat(64)}],projectContext:{id},effectiveCapabilities:{role:'research',capabilityIds:['research'],hostAllowedTools:[]}};
  assert.equal(validateRoleCall({...input,permit:bundle}),bundle);
  assert.throws(()=>validateRoleCall({...input,permit:{...bundle,materialFiles:[...bundle.materialFiles,{path:'../other-role.md',sha256:'c'.repeat(64)}]}}),/SCOPE_DENIED/);
  assert.throws(()=>validateRoleCall({...input,permit:{...bundle,projectContext:{id:'foreign'}}}),/SCOPE_DENIED/);
  assert.throws(()=>validateRoleCall({...input,permit:{...bundle,effectiveCapabilities:{role:'qa',capabilityIds:['qa']}}}),/SCOPE_DENIED/);
  for(const change of [
    {role:'pm'},
    {materialSourcePath:source.replace('/research/','/pm/')},
    {materialSourcePath:source.replace('/agents/'+id,'/agents/11111111-2222-4333-8444-555555555555')},
    {instructionsFilePath:permit.instructionsFilePath.replace('/research/','/research/../research/')},
  ]) assert.throws(()=>validateRoleCall({...input,permit:{...permit,...change}}),/SCOPE_DENIED/);
});
