import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeRoleAdapter } from '../bridge/native-role-adapter.mjs';

test('Native adapter port prepares mandatory materials before exactly one original execute call', async () => {
  const binding = {runId:'run',agentId:'agent',companyId:'company',projectId:'project',taskId:'task',ownerId:'owner',inputRevision:'revision'};
  const registration = {binding,profile:{engine:'codex_local',role:'research'}};
  const ctx = {runId:'run',agent:{id:'agent',companyId:'company'},runtime:{sessionId:null},
    context:{issueId:'task',projectId:'project',responsibleUserId:'owner',inputRevision:'revision'},
    config:{engine:'cli',command:'/opt/super-agent/bin/codex',model:'gpt-6.1-sol',modelReasoningEffort:'low',
      dangerouslyBypassApprovalsAndSandbox:false,dangerouslyBypassSandbox:false,extraArgs:['--sandbox','read-only'],
      search:true,instructionsFilePath:'/materials/instructions.md'}};
  let calls = 0, blocked = false, mutate = false;
  const adapter = createNativeRoleAdapter({
    basePromptTemplate:'Task {{task.id}}',log(){},readRegistration:async()=>registration,
    prepareRole:async()=>{if(mutate)ctx.config.command='/real/codex';if(blocked)throw Object.assign(Error(),{code:'ROLE_MATERIAL_DIGEST_MISMATCH'});
      return {binding,sessionMode:'new',knowledge:[{text:'confirmed choice {{secret}}'}],config:{instructionsFilePath:ctx.config.instructionsFilePath,dangerouslyBypassApprovalsAndSandbox:false}};},
    nativeExecute:async value=>{assert.equal(value.runId,ctx.runId);assert.equal(value.config.command,ctx.config.command);assert.ok(value.config.promptTemplate.includes('confirmed choice'));assert.ok(!value.config.promptTemplate.includes('{{secret}}'));calls++;return {exitCode:0};},
  });
  assert.equal((await adapter(ctx)).exitCode,0);
  assert.equal(calls,1);
  mutate = true;
  await assert.rejects(adapter(ctx),/NATIVE_ROLE_CONTEXT_CHANGED/);
  assert.equal(calls,1);
  mutate = false;
  ctx.config.command='/opt/super-agent/bin/codex';
  blocked = true;
  await assert.rejects(adapter(ctx),/ROLE_MATERIAL_DIGEST_MISMATCH/);
  assert.equal(calls,1);
  await assert.rejects(adapter({...ctx,runtime:{sessionId:'old-session'}}),/NATIVE_ROLE_SCOPE_DENIED/);
  await assert.rejects(adapter({...ctx,config:{...ctx.config,command:'/real/codex'}}),/NATIVE_ROLE_SCOPE_DENIED/);
  await assert.rejects(adapter({...ctx,context:{...ctx.context,projectId:'other'}}),/NATIVE_ROLE_SCOPE_DENIED/);
  assert.equal(calls,1);
});
