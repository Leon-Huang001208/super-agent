import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoleCall } from '../docker/role-codex-gate.mjs';
import { NATIVE_ROLE_MANAGED_ARGS } from '../bridge/native-role-adapter.mjs';

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
  assert.throws(()=>validateRoleCall({...input,env:{...env,CODEX_HOME:env.CODEX_HOME.replace('paperclip-ai-','paperclip-ai-foreign-')}}),/SCOPE_DENIED/);
  for(const badArgs of [[...args,'resume',id],args.filter(x=>x!=='workspace-write'),[...args,'--dangerously-bypass-approvals-and-sandbox']]){
    assert.throws(()=>validateRoleCall({...input,args:badArgs}),/ARGUMENTS_DENIED/);
  }
  assert.throws(()=>validateRoleCall({...input,env:{...env,OPENAI_API_KEY:'synthetic'}}),/SCOPE_DENIED/);
  assert.throws(()=>validateRoleCall({...input,env:{...env,PAPERCLIP_RUN_ID:'other'}}),/SCOPE_DENIED/);
  assert.throws(()=>validateRoleCall({...input,now:200001}),/SCOPE_DENIED/);
});
