import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRoleInstructionCopy,hostRoleInstructionPath} from '../bridge/role-instruction-paths.mjs';
import {createNativeRoleAdapter,NATIVE_ROLE_MANAGED_ARGS} from '../bridge/native-role-adapter.mjs';

test('Native prepared copy dispatches the admitted historical manifest after a webpage save',async()=>{
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',entry='research/AGENTS.md';
  const materialRoot='/paperclip/instances/default/companies/'+id+'/agents/'+id+'/instructions';
  const live=materialRoot.replace('/instructions','/file-sync/runs/'+id+'/live');
  const old={schemaVersion:1,project:'demo',role:'research',instructionsFilePath:entry,requiredReferences:[],files:[{path:entry,sha256:'a'.repeat(64)}]};
  const latest={...old,files:[{path:entry,sha256:'b'.repeat(64)}]};
  const role={profile:{agentId:id,role:'research',engine:'codex_local'},materialRoot,manifest:latest};
  const identity={companyId:id,agentId:id,runId:id,ownerId:'owner'};
  const workingCopy={...identity,entryFile:entry,localRoot:live,executionRoot:live,location:'local',state:'prepared',responsibleUserId:'owner'};
  const baseline={entries:new Map([['research',{kind:'dir'}],[entry,{kind:'file',hash:'a'.repeat(64)}]])};
  const input={role,identity,workingCopy,baseline,history:[{agentId:id,materialRoot,manifest:old}],executionPath:live+'/'+entry};
  const resolved=resolveRoleInstructionCopy(input);
  assert.equal(resolved.materialRoot,live);
  assert.deepEqual(resolved.manifest,old);
  assert.equal(resolved.sourceInstructionsFilePath,materialRoot+'/'+entry);
  assert.throws(()=>resolveRoleInstructionCopy({...input,workingCopy:{...workingCopy,agentId:'foreign'}}),/COPY_DENIED/);
  assert.throws(()=>resolveRoleInstructionCopy({...input,history:[]}),/BASELINE_CHANGED/);
  const binding={...identity,projectId:id,taskId:id,inputRevision:'revision'};
  const registration={binding,profile:role.profile,...resolved};
  const ctx={runId:id,agent:{id,companyId:id},runtime:{sessionId:null},
    context:{issueId:id,projectId:id,responsibleUserId:'owner',inputRevision:'revision'},
    config:{engine:'cli',command:'/opt/super-agent/bin/codex',model:'gpt-6.1-sol',modelReasoningEffort:'low',
      dangerouslyBypassApprovalsAndSandbox:false,dangerouslyBypassSandbox:false,extraArgs:[...NATIVE_ROLE_MANAGED_ARGS],search:true,instructionsFilePath:live+'/'+entry}};
  let calls=0;
  const execute=createNativeRoleAdapter({basePromptTemplate:'Role task',log(){},readRegistration:async()=>registration,
    prepareRole:async r=>({binding,sessionMode:'new',knowledge:[],config:{instructionsFilePath:r.materialRoot+'/'+r.manifest.instructionsFilePath,dangerouslyBypassApprovalsAndSandbox:false}}),
    nativeExecute:async value=>{calls++;assert.equal(value.config.instructionsFilePath,live+'/'+entry);return{exitCode:0};}});
  assert.equal((await execute(ctx)).exitCode,0);
  assert.equal(calls,1);
});

test('host transport maps the full admitted path instead of a colliding basename', () => {
  const file='/paperclip/instances/default/companies/a/agents/b/instructions/research/AGENTS.md';
  assert.equal(hostRoleInstructionPath(file,'/data'),'/data/state/instances/default/companies/a/agents/b/instructions/research/AGENTS.md');
  assert.throws(()=>hostRoleInstructionPath('/paperclip/../secrets/auth','/data'),/PATH_DENIED/);
});
