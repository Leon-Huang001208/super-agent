import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,mkdirSync,chmodSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createIsolatedAcceptance,CSV_IMPLEMENTATION,CSV_TESTS,publicRunEvidence,assertDelegatedAuth,snapshotAcceptanceHandoff,verifyAcceptanceHandoff,rehydrateAcceptancePlan,prepareKnownBootstrapRepair,reserveAcceptanceTask,readAcceptanceArtifactJson} from '../scripts/multi-runtime-acceptance.mjs';
import {DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {selectTaskRuntimeProfile} from '../bridge/task-runtime-policy.mjs';
import {privateJson,isolatedRuntimeBinding,knownBootstrapClosure,roleRunMaterialName,validateReleasedBootstrapClosure,reconcileCancelledBootstrapResult,archivePrivateSnapshot,assertIsolatedIdentityReprovision,repairIdentityUnderLock,validateCompletedMultiRuntimeState,verifyCompletedFiles,projectCompletedRosterMigration,assertAcceptanceTaskNamespace,assertAcceptanceRoleTransfer,assertAcceptanceTaskBody,createAcceptanceDelegationManager,validateCurrent13SuccessPrefix,validateHistoricalPrefixSourceTransition,inspectCurrent13PreclaimAttempt,projectCurrent13PreclaimRepair,validateCurrent13PreclaimRepairHistory} from './helpers/multi-runtime-native-fixture.mjs';
import {taskRuntimeImplementationFiles,computeTaskRuntimeImplementationBinding} from '../bridge/task-runtime-router.mjs';
import {TEAM_ROLES} from '../bridge/team-roles.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';

function delegationFixture(t,{fresh=false,respond}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'sa-short-delegation-')),home=root+'/provider';mkdirSync(home);mkdirSync(root+'/runtime-secrets');t.after(()=>rmSync(root,{recursive:true,force:true}));
 let now=1000000,checks=0;const step={runtimeProfileId:'codex_subscription',role:'qa',operationId:randomUUID(),taskId:randomUUID(),agentId:randomUUID()},tokens={access_token:'SYNTHETIC_ACCESS_OLD',id_token:'SYNTHETIC_ID_OLD',account_id:'same-holder',refresh_token:'ISOLATED_NO_REFRESH'};
 const put=(file,value)=>writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});put(home+'/auth.json',{auth_mode:'chatgpt',delegatedExpiresAt:now+(fresh?600000:1000),tokens});
 const manager=createAcceptanceDelegationManager({root,providerHome:home,holderAccountId:'same-holder',companyId:randomUUID(),rootTaskId:randomUUID(),clock:()=>now,
  verifyBoundary:async()=>{checks++;},wait:async ms=>{now+=ms;if(respond)respond({root,step,now,put});}});
 return{root,home,step,tokens,manager,get checks(){return checks;}};
}
test('a sufficiently fresh short delegation needs no RPC and never changes the stable home',async t=>{
 const f=delegationFixture(t,{fresh:true}),before=readFileSync(f.home+'/auth.json');const result=await f.manager(f.step);
 assert.equal(result.status,'CURRENT');assert.deepEqual(readFileSync(f.home+'/auth.json'),before);assert.equal(f.checks,1);
 const audit=readFileSync(f.root+'/delegation-audit/'+f.step.operationId+'.jsonl','utf8');assert.ok(!audit.includes(f.tokens.access_token));assert.ok(!audit.includes(f.tokens.id_token));
});
test('expired delegation uses nonce-bound private response and removes consumed request/response without logging tokens',async t=>{
 const f=delegationFixture(t,{respond:({root,step,now,put})=>{const request=privateJson(root+'/delegation-requests/'+step.operationId+'.json');put(root+'/runtime-secrets/delegation-'+step.operationId+'.json',
  {schemaVersion:1,nonce:request.nonceUUID,operationId:step.operationId,auth:{expiresAt:now+600000,tokens:{access_token:'SYNTHETIC_ACCESS_NEW',id_token:'SYNTHETIC_ID_NEW',account_id:'same-holder',refresh_token:'ISOLATED_NO_REFRESH'}}});}});
 const result=await f.manager(f.step);assert.equal(result.status,'RENEWED');assert.equal(privateJson(f.home+'/auth.json').tokens.access_token,'SYNTHETIC_ACCESS_NEW');assert.ok(f.checks>=3);
 assert.throws(()=>readFileSync(f.root+'/delegation-requests/'+f.step.operationId+'.json'),{code:'ENOENT'});assert.throws(()=>readFileSync(f.root+'/runtime-secrets/delegation-'+f.step.operationId+'.json'),{code:'ENOENT'});
 const audit=readFileSync(f.root+'/delegation-audit/'+f.step.operationId+'.jsonl','utf8');for(const token of ['SYNTHETIC_ACCESS_OLD','SYNTHETIC_ID_OLD','SYNTHETIC_ACCESS_NEW','SYNTHETIC_ID_NEW','same-holder'])assert.ok(!audit.includes(token));
});
test('unknown nonce, different holder, real refresh or excessive TTL never update delegation; timeout preserves request',async t=>{
 for(const wrong of ['nonce','holder','refresh','expiry']){
  const f=delegationFixture(t,{respond:({root,step,now,put})=>{const request=privateJson(root+'/delegation-requests/'+step.operationId+'.json');put(root+'/runtime-secrets/delegation-'+step.operationId+'.json',
   {schemaVersion:1,nonce:wrong==='nonce'?randomUUID():request.nonceUUID,operationId:step.operationId,auth:{expiresAt:now+(wrong==='expiry'?1800001:600000),tokens:{access_token:'SYNTHETIC_NEW',id_token:'SYNTHETIC_ID',account_id:wrong==='holder'?'different':'same-holder',refresh_token:wrong==='refresh'?'REAL_REFRESH_MUST_NOT_COPY':'ISOLATED_NO_REFRESH'}}});}});
  await assert.rejects(f.manager(f.step),{code:'MULTI_RUNTIME_DELEGATION_RESPONSE_DENIED'});assert.equal(privateJson(f.home+'/auth.json').tokens.access_token,'SYNTHETIC_ACCESS_OLD');
  assert.equal(privateJson(f.root+'/delegation-requests/'+f.step.operationId+'.json').operationId,f.step.operationId);
  if(wrong==='nonce')assert.equal(privateJson(f.root+'/runtime-secrets/delegation-'+f.step.operationId+'.json').operationId,f.step.operationId);
 }
 const f=delegationFixture(t);await assert.rejects(f.manager(f.step,{timeoutMs:1000}),{code:'MULTI_RUNTIME_DELEGATION_TIMEOUT'});assert.equal(privateJson(f.root+'/delegation-requests/'+f.step.operationId+'.json').operationId,f.step.operationId);
});

test('ordinary QA JSON is hash-bound without weakening private credential input permissions',t=>{
 const cwd=mkdtempSync(path.join(os.tmpdir(),'qa-artifact-reader-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const bytes=JSON.stringify({verdict:'PASS',findings:[],notRun:['production']});writeFileSync(cwd+'/qa.json',bytes);chmodSync(cwd+'/qa.json',0o644);
 const reference={file:'qa.json',sha256:createHash('sha256').update(bytes).digest('hex')};
 assert.equal(readAcceptanceArtifactJson({cwd,reference}).verdict,'PASS');
 assert.throws(()=>privateJson(cwd+'/qa.json'),/PRIVATE_INPUT_DENIED/);
 assert.throws(()=>readAcceptanceArtifactJson({cwd,reference:{...reference,sha256:'0'.repeat(64)}}),/REVIEWED_ARTIFACT_CHANGED/);
 assert.throws(()=>readAcceptanceArtifactJson({cwd,reference:{...reference,file:'../qa.json'}}),/ARTIFACT_DENIED/);
 chmodSync(cwd+'/qa.json',0o666);assert.throws(()=>readAcceptanceArtifactJson({cwd,reference}),/ARTIFACT_DENIED/);
});

function completedState(){
 const plan=createIsolatedAcceptance(),owner='isolated-owner',rootTask={id:plan.rootTaskId,companyId:plan.companyId,projectId:plan.projectId,responsibleUserId:owner,title:'Fixed root',description:'Unchanged input'};
 plan.rootInputRevision=taskInputRevision(rootTask);plan.status='PASS';plan.callsSpent=5;
 for(const step of plan.steps){step.status='PASS';step.runId=randomUUID();step.artifacts=[{taskId:step.taskId,runId:step.runId,file:step.key+'.md',sha256:'a'.repeat(64)}];}
 const registry={companyId:plan.companyId,projectId:plan.projectId,taskId:plan.rootTaskId,ownerId:owner,team:{ids:plan.agentIds},tasks:[plan.rootTaskId,...plan.steps.map(step=>step.taskId)],
  taskRoots:Object.fromEntries(plan.steps.map(step=>[step.taskId,plan.rootTaskId])),operations:plan.steps.map(step=>({id:step.operationId,kind:'run',taskId:step.taskId,rootTaskId:plan.rootTaskId,agentId:step.agentId,role:step.role}))};
 const agents=Object.entries(TEAM_ROLES).map(([role,definition])=>({id:plan.agentIds[role],companyId:plan.companyId,reportsTo:definition.parent?plan.agentIds[definition.parent]:null}));
 const runs=plan.steps.map(step=>({id:step.runId,status:'succeeded',finishedAt:new Date(),issueId:step.taskId,agentId:step.agentId,companyId:plan.companyId,responsibleUserId:owner}));
 const budget=registry.operations.map(operation=>({...operation,operationId:operation.id,sha256:'b'.repeat(64)}));return{plan,registry,rootTask,agents,runs,budget};
}
function prefixState(){
 const state=completedState(),specs=[['fullstack-feature','full-stack-engineer','minimax_opencode'],['backend-transfer','backend-engineer','codex_subscription'],['minimax-claude-preferences','full-stack-engineer','minimax_claude'],
  ['deepseek-claude-crosscheck','research','deepseek_claude'],['deepseek-opencode-crosscheck','research','deepseek_opencode'],['qa13','qa','codex_subscription']],taskId=randomUUID();
 const steps=specs.map(([key,role,runtimeProfileId],index)=>({key,role,runtimeProfileId,agentId:state.plan.agentIds[role],taskId:index<2?taskId:index===5?state.plan.steps[4].taskId:randomUUID(),operationId:randomUUID(),
  ...(index<2?{runId:randomUUID(),status:'PASS',modelEvidence:{observed:true},artifacts:[{file:key+'.json'}]}:{status:'NOT_RUN'})}));
 const budget=[...state.budget,...steps.slice(0,2).map(step=>({operationId:step.operationId,taskId:step.taskId,agentId:step.agentId,role:step.role,sha256:'c'.repeat(64)}))];
 const current={schemaVersion:1,kind:'isolated-native-current13',status:'PARTIAL_VALIDATED',sourceRoleCount:13,companyId:state.plan.companyId,projectId:state.plan.projectId,workspaceId:state.plan.workspaceId,rootTaskId:state.plan.rootTaskId,
  rootInputRevision:state.plan.rootInputRevision,agentIds:state.plan.agentIds,steps,callsSpent:budget.length,budgetRecords:structuredClone(budget),postExecutionPrefixFinalization:{schemaVersion:1,kind:'closed-success-prefix',modelCallsAdded:0,sourceReportSha256:'a'.repeat(64),successfulPrefix:2,budgetUsedBefore:budget.length,budgetUsedAfter:budget.length}};
 return{...state,current,budget,runs:[...state.runs,...steps.slice(0,2).map(step=>({id:step.runId,issueId:step.taskId,agentId:step.agentId,companyId:state.plan.companyId,responsibleUserId:state.registry.ownerId,status:'succeeded',exitCode:0,finishedAt:new Date()}))],
  pendingEvidence:steps.slice(2).map(step=>({operationId:step.operationId,nativeRunIds:[],operationFile:false,budgetSlot:false,orphanControl:false}))};
}
function preclaimState(){
 const state=prefixState(),step=state.current.steps[2],owner=state.registry.ownerId;
 const rootTask={...state.rootTask},task={id:step.taskId,companyId:state.plan.companyId,projectId:state.plan.projectId,projectWorkspaceId:state.plan.workspaceId,parentId:state.plan.rootTaskId,responsibleUserId:owner,title:'Preferences',description:'Original immutable request'};
 const route={id:randomUUID(),profileId:'minimax_claude',inputRevision:taskInputRevision(task)},run={id:randomUUID(),companyId:state.plan.companyId,issueId:step.taskId,agentId:step.agentId,responsibleUserId:owner,status:'failed',errorCode:'adapter_failed',exitCode:1,finishedAt:new Date(),
  stderrExcerpt:JSON.stringify({code:'ROLE_CLAUDE_GATE_SCOPE_DENIED',claimed:false}),resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};
 Object.assign(step,{status:'RUNNING',runId:run.id,nativeStatus:'failed',taskRuntimeRoute:route,nativeEvidence:{status:'failed',runId:run.id}});state.current.status='FAILED';state.current.callsSpent=9;
 state.registry.operations.push({id:step.operationId,kind:'run',taskId:step.taskId,agentId:step.agentId,role:step.role,rootTaskId:state.plan.rootTaskId,inputRevision:route.inputRevision,taskRuntimeRoute:route});
 const slot={operationId:step.operationId,taskId:step.taskId,agentId:step.agentId,role:step.role,sha256:'d'.repeat(64)},budget=[...state.budget,{operationId:randomUUID(),sha256:'e'.repeat(64)},slot];
 const permitRef={file:'permits/'+run.id+'.json',sha256:'f'.repeat(64)},native={file:'current13-history/native.json',sha256:'b'.repeat(64)},releaseRef={file:'closed-phase-releases/'+step.operationId+'.json',sha256:'c'.repeat(64)};
 const release={schemaVersion:1,kind:'known-unstarted-current13-phase',companyId:state.plan.companyId,rootTaskId:state.plan.rootTaskId,taskId:step.taskId,operationId:step.operationId,runId:run.id,sourceReportSha256:'a'.repeat(64),modelCallsAdded:0,providerWorkStarted:false,gate:{code:'ROLE_CLAUDE_GATE_SCOPE_DENIED',claimed:false},budgetSpent:9,budgetRecords:budget.map(value=>({file:value.operationId+'.json',sha256:value.sha256})),permitSha256:permitRef.sha256,native};
 const permit={schemaVersion:1,runId:run.id,taskId:step.taskId,agentId:step.agentId,role:step.role,companyId:state.plan.companyId,projectId:state.plan.projectId,rootTaskId:state.plan.rootTaskId,runtimeProfileId:'minimax_claude',model:RUNTIME_PROFILES.minimax_claude.model,apiFallback:false,materialSha256:'9'.repeat(64),materialFiles:[{path:'instructions.md',sha256:'9'.repeat(64)}]};
 return{state,current:state.current,registry:state.registry,rootTask,task,agent:{id:step.agentId,companyId:state.plan.companyId,role:'engineer',reportsTo:state.plan.agentIds.architect,adapterType:'claude_local'},run,release,releaseRef,permit,permitRef,budget,
  markers:{claimExists:false,transportExists:false,providerAuditExists:false,callLockExists:false},nativeStopped:true,activeRunIds:[],sourceReportSha256:'a'.repeat(64),sourceRegistrySha256:'8'.repeat(64),materialDigests:[{instructions:true,sha256:'9'.repeat(64)},{path:'instructions.md',sha256:'9'.repeat(64)}],authorized:true};
}
test('one explicit Claude preclaim repair retains the failed slot and all successful work without a model retry loop',()=>{
 const input=preclaimState(),original=structuredClone(input.current),proof=inspectCurrent13PreclaimAttempt(input),next=projectCurrent13PreclaimRepair(input.current,proof);
 assert.equal(validateCurrent13PreclaimRepairHistory(next),1);assert.equal(next.callsSpent,9);assert.equal(next.steps[2].taskId,original.steps[2].taskId);assert.equal(next.steps[2].agentId,original.steps[2].agentId);assert.notEqual(next.steps[2].operationId,original.steps[2].operationId);
 assert.equal(next.steps[2].priorAttempts[0].operationId,original.steps[2].operationId);assert.equal(next.steps[2].priorAttempts[0].proof.budgetRecord.sha256,'d'.repeat(64));
 assert.deepEqual(next.steps.slice(0,2),original.steps.slice(0,2));assert.deepEqual(next.steps.slice(3),original.steps.slice(3));assert.deepEqual(next.postExecutionPrefixFinalization,original.postExecutionPrefixFinalization);assert.deepEqual(input.current,original);
 for(const change of [{authorized:false},{nativeStopped:false},{markers:{...input.markers,claimExists:true}},{run:{...input.run,resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:true}}}},
  {run:{...input.run,stderrExcerpt:JSON.stringify({code:'ROLE_CLAUDE_GATE_SCOPE_DENIED',claimed:true})}},{permitRef:{...input.permitRef,sha256:'0'.repeat(64)}}])assert.throws(()=>inspectCurrent13PreclaimAttempt({...input,...change}),/PRECLAIM|BOOTSTRAP/);
 const repeat=structuredClone(next);repeat.steps[2].priorAttempts.push(repeat.steps[2].priorAttempts[0]);assert.throws(()=>validateCurrent13PreclaimRepairHistory(repeat),/HISTORY_DENIED/);
});
function sourceTransitionState(){
 const {current,plan}=prefixState(),hash=value=>createHash('sha256').update(value).digest('hex'),ref=(file,bytes)=>({file:'current13-source-transition/'+file,sha256:hash(bytes)});
 const bridgeBefore=Buffer.from("const hygiene='old';\n if(name==='host.project_inspect'&&!hasWorkspace)return {workspace:null};\n"),bridgeAfter=Buffer.from("const hygiene='prepared';\n if(name==='host.project_inspect'&&!hasWorkspace)return {workspace:null};\n"),diff=Buffer.from('diff --git a/bridge/role-host-capabilities.mjs b/bridge/role-host-capabilities.mjs\n-hygiene old\n+hygiene prepared\n');
 const before={schemaVersion:1,profiles:{}},after={schemaVersion:1,preparedCommit:'a'.repeat(40),profiles:{}},implementations={},currentBindings={},observedBindings={},permits={};
 for(const step of current.steps.slice(0,2)){
  const cliSha256=hash('real-cli-fixture-'+step.runtimeProfileId),files=taskRuntimeImplementationFiles(step.runtimeProfileId).map(file=>({file,sha256:file==='bridge/role-host-capabilities.mjs'?hash(bridgeBefore):hash(file)}));
  before.profiles[step.runtimeProfileId]={files,cliSha256};after.profiles[step.runtimeProfileId]={files:files.map(file=>({...file,...(file.file==='bridge/role-host-capabilities.mjs'?{sha256:hash(bridgeAfter)}:{})})),cliSha256};
  implementations[step.runId]=computeTaskRuntimeImplementationBinding({profileId:step.runtimeProfileId,...before.profiles[step.runtimeProfileId]});
  currentBindings[step.runtimeProfileId]=computeTaskRuntimeImplementationBinding({profileId:step.runtimeProfileId,...after.profiles[step.runtimeProfileId]});observedBindings[step.runtimeProfileId]={...currentBindings[step.runtimeProfileId]};
  permits[step.runId]={schemaVersion:1,runId:step.runId,taskId:step.taskId,agentId:step.agentId,role:step.role,companyId:plan.companyId,projectId:plan.projectId,rootTaskId:plan.rootTaskId,model:RUNTIME_PROFILES[step.runtimeProfileId].model,apiFallback:false,executionPolicy:{executor:'macos_native'},projectContext:{repository:{hostPath:null},workspace:{hostPath:null},delivery:{maximumAction:'artifact'}}};
 }
 const descriptor={schemaVersion:1,kind:'historical-prefix-source-transition',id:randomUUID(),companyId:plan.companyId,rootTaskId:plan.rootTaskId,preparedCommit:after.preparedCommit,
  passed:current.steps.slice(0,2).map(step=>({taskId:step.taskId,operationId:step.operationId,runId:step.runId,profileId:step.runtimeProfileId,...implementations[step.runId]})),
  beforeManifest:ref('before.json',JSON.stringify(before)),afterManifest:ref('after.json',JSON.stringify(after)),bridgeBefore:ref('before.mjs',bridgeBefore),bridgeAfter:ref('after.mjs',bridgeAfter),diff:ref('runtime.diff',diff)};
 const reviewOutput=Buffer.from('Independent reviewer inspected this exact diff and found no issues.'),regressionStdout=Buffer.from('ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ skipped 1\n'),regressionStderr=Buffer.from('');
 const review={schemaVersion:1,kind:'independent-source-transition-review',preparedCommit:descriptor.preparedCommit,diffSha256:descriptor.diff.sha256,beforeManifestSha256:descriptor.beforeManifest.sha256,afterManifestSha256:descriptor.afterManifest.sha256,
  reviewerId:'/root/reviewer',developmentSessionId:'/root',reviewerSessionId:'/root/reviewer',verdict:'APPROVED',findings:[],output:ref('review.txt',reviewOutput)};
 const regression={schemaVersion:1,kind:'exact-offline-regression',preparedCommit:descriptor.preparedCommit,afterManifestSha256:descriptor.afterManifest.sha256,exitCode:0,signal:null,modelCalls:0,tests:3,pass:2,fail:0,skipped:1,
  command:['docker','--context','desktop-linux','run','--pull','never','--network','none','--read-only','node@sha256:a52166d89cfcc66ea62d10535ca712d161cece5d77ff4cfa758866b6b75ccb3f','node','--test','tests/*.test.mjs'],stdout:ref('stdout',regressionStdout),stderr:ref('stderr',regressionStderr)};
 return{descriptor,before,after,bridgeBefore,bridgeAfter,diff,review,reviewOutput,regression,regressionStdout,regressionStderr,current,plan,implementations,permits,currentBindings,observedBindings};
}
test('source transition preserves old proofs and grants only bounded historical-prefix continuation',async()=>{
 const state=sourceTransitionState(),original=structuredClone(state.implementations),result=await validateHistoricalPrefixSourceTransition(state);
 assert.equal(result.kind,'historical-prefix-only');assert.equal(result.poolEligibility,'HISTORICAL_ONLY');assert.deepEqual(state.implementations,original);
 for(const change of [{descriptor:{...state.descriptor,rootTaskId:randomUUID()}},{review:{...state.review,verdict:'NEEDS_WORK'}},{review:{...state.review,reviewerSessionId:'/root'}},
  {regression:{...state.regression,modelCalls:1}},{regression:{...state.regression,preparedCommit:'b'.repeat(40)}},
  {permits:{...state.permits,[state.current.steps[0].runId]:{...state.permits[state.current.steps[0].runId],projectContext:{repository:{hostPath:'/business'},workspace:{hostPath:null},delivery:{maximumAction:'artifact'}}}}}])await assert.rejects(validateHistoricalPrefixSourceTransition({...state,...change}),/SOURCE_TRANSITION_/);
 const cli=structuredClone(state);cli.after.profiles.minimax_opencode.cliSha256='0'.repeat(64);await assert.rejects(validateHistoricalPrefixSourceTransition(cli),/BINDING_DENIED/);
 const files=structuredClone(state),name='bridge/role-runtime-profiles.mjs';for(const profile of Object.keys(files.after.profiles)){files.after.profiles[profile].files.find(file=>file.file===name).sha256='0'.repeat(64);const binding=computeTaskRuntimeImplementationBinding({profileId:profile,...files.after.profiles[profile]});files.currentBindings[profile]=binding;files.observedBindings[profile]=binding;}
 await assert.rejects(validateHistoricalPrefixSourceTransition(files),/FILES_DENIED/);
 const inspect=sourceTransitionState();inspect.bridgeAfter=Buffer.from(inspect.bridgeAfter.toString().replace('return {workspace:null}','return {workspace:"changed"}'));inspect.descriptor.bridgeAfter.sha256=createHash('sha256').update(inspect.bridgeAfter).digest('hex');
 for(const profile of Object.keys(inspect.after.profiles)){inspect.after.profiles[profile].files.find(file=>file.file==='bridge/role-host-capabilities.mjs').sha256=inspect.descriptor.bridgeAfter.sha256;const binding=computeTaskRuntimeImplementationBinding({profileId:profile,...inspect.after.profiles[profile]});inspect.currentBindings[profile]=binding;inspect.observedBindings[profile]=binding;}
 await assert.rejects(validateHistoricalPrefixSourceTransition(inspect),/INSPECT_CHANGED/);
});
test('partial current13 recovery accepts only the proven successful contiguous prefix and untouched future operations',()=>{
 const state=prefixState(),original=structuredClone(state.current);assert.equal(validateCurrent13SuccessPrefix(state),2);assert.deepEqual(state.current,original);
 for(const mutate of [value=>{value.current.status='FAILED';},value=>{value.runs.at(-1).status='failed';},value=>{value.current.steps[2].runId=randomUUID();},
  value=>{value.pendingEvidence[0].operationFile=true;},value=>{value.pendingEvidence[0].budgetSlot=true;},value=>{value.pendingEvidence[0].nativeRunIds=[randomUUID()];},
  value=>{value.current.steps[2].status='PASS';},value=>{value.current.budgetRecords[0].sha256='0'.repeat(64);},value=>{value.current.postExecutionPrefixFinalization.modelCallsAdded=1;}]){
  const changed=structuredClone(state);mutate(changed);assert.throws(()=>validateCurrent13SuccessPrefix(changed),/CURRENT13_/);
 }
});
function ownerCase(){
 const state=completedState(),step=state.plan.steps[0],owner=state.registry.ownerId;
 const root={...state.rootTask,parentId:null,projectWorkspaceId:state.plan.workspaceId,status:'in_review',assigneeAgentId:null,assigneeUserId:owner};
 const task={id:step.taskId,companyId:state.plan.companyId,projectId:state.plan.projectId,projectWorkspaceId:state.plan.workspaceId,parentId:root.id,responsibleUserId:owner,title:'Original child',description:'Keep this exact description',status:'in_review',assigneeAgentId:null,assigneeUserId:owner};
 Object.assign(state.registry.operations.find(op=>op.id===step.operationId),{inputRevision:taskInputRevision(task),rootInputRevision:state.plan.rootInputRevision});
 return{...state,root,task,step,expected:{expectedAgentId:null,expectedAssigneeUserId:owner,expectedStatus:'in_review',inputRevision:taskInputRevision(task)},scopeClosed:{closed:true,taskId:task.id,agentId:step.agentId,activeRunIds:[]}};
}
test('Native task creation identity/body is idempotent without overwriting an existing description',()=>{
 const value=ownerCase(),input={task:value.task,plan:value.plan,ownerId:value.registry.ownerId,step:value.step,title:value.task.title,description:value.task.description};
 assert.equal(assertAcceptanceTaskBody(input),value.task);
 for(const change of [{description:'handoff must stay in the operation'},{task:{...value.task,companyId:randomUUID()}},{task:{...value.task,parentId:randomUUID()}},{task:{...value.task,projectWorkspaceId:randomUUID()}}])assert.throws(()=>assertAcceptanceTaskBody({...input,...change}),/BODY_CHANGED/);
});
test('fresh assignment and owner handback compare original namespace, revision and exact observed owner',()=>{
 const value=ownerCase();assert.equal(assertAcceptanceTaskNamespace(value).target,value.step.agentId);
 for(const change of [{root:{...value.root,description:'scope drift'}},{expected:{...value.expected,inputRevision:'0'.repeat(64)}},{scopeClosed:{...value.scopeClosed,closed:false}},
  {task:{...value.task,assigneeUserId:'third-party'},expected:{...value.expected,expectedAssigneeUserId:'third-party'}},
  {task:{...value.task,assigneeAgentId:value.plan.agentIds.architect,assigneeUserId:null},expected:{...value.expected,expectedAgentId:value.plan.agentIds.architect,expectedAssigneeUserId:null}}])assert.throws(()=>assertAcceptanceTaskNamespace({...value,...change}),/OWNER_CAS/);
 const stale=structuredClone(value);stale.registry.operations[0].inputRevision='0'.repeat(64);assert.throws(()=>assertAcceptanceTaskNamespace(stale),/OWNER_CAS/);
 assert.equal(assertAcceptanceTaskNamespace({...value,step:{...value.step,agentId:null,userId:value.registry.ownerId}}).user,value.registry.ownerId);
});
test('role transfer accepts the real owner/in_review queue or the closed previous Agent and refuses fake ownership',()=>{
 const value=ownerCase(),oldAgent=value.plan.agentIds['full-stack-engineer'],oldOperationId=randomUUID(),previousRouteId=randomUUID(),runId=randomUUID();
 const route={id:randomUUID(),operationId:value.step.operationId,taskId:value.task.id,rootTaskId:value.plan.rootTaskId,agentId:value.step.agentId,role:value.step.role,inputRevision:value.expected.inputRevision,
  handoff:{handoffKind:'role-transfer',fromAgentId:oldAgent,fromRole:'full-stack-engineer',fromRunId:runId,previousRouteId,budgetUsedBefore:7}};
 value.registry.operations.find(op=>op.id===value.step.operationId).taskRuntimeRoute=route;value.registry.taskRuntimeRoutes=[{id:previousRouteId,agentId:oldAgent,role:'full-stack-engineer',taskId:value.task.id,operationId:oldOperationId}];
 const input={...value,route,budgetUsed:7,scopeClosed:{...value.scopeClosed,agentId:oldAgent},previousRun:{id:runId,issueId:value.task.id,agentId:oldAgent,companyId:value.plan.companyId,status:'succeeded',finishedAt:new Date()}};
 assert.equal(assertAcceptanceRoleTransfer(input),true);assert.doesNotThrow(()=>assertAcceptanceTaskNamespace(input));
 assert.equal(assertAcceptanceRoleTransfer({...input,task:{...input.task,assigneeAgentId:oldAgent,assigneeUserId:null,status:'in_progress'}}),true);
 for(const change of [{budgetUsed:6},{scopeClosed:{...input.scopeClosed,closed:false}},{previousRun:{...input.previousRun,agentId:value.step.agentId}},
  {task:{...input.task,assigneeUserId:'third-party'}},{task:{...input.task,status:'todo'}}])assert.throws(()=>assertAcceptanceRoleTransfer({...input,...change}),/ROLE_TRANSFER/);
});
test('completed 12-role history migrates to 13 without changing existing identities, source evidence or calls',()=>{
 const {plan,registry}=completedState(),role='full-stack-engineer';delete plan.agentIds[role];delete plan.runtimeAssignments[role];registry.team.ids={...plan.agentIds};registry.runtimeAssignments={...plan.runtimeAssignments};
 registry.agents=Object.entries(plan.agentIds).map(([key,agentId])=>({profile:{role:key,agentId}}));
 const original=structuredClone({plan,registry}),newAgentId=randomUUID(),entry={profile:{role,agentId:newAgentId,projectId:plan.projectId},manifest:{files:[]}};
 const result=projectCompletedRosterMigration({plan,registry,newAgentId,entry,migrationId:randomUUID(),sourcePlanSha256:'a'.repeat(64),sourceRegistrySha256:'b'.repeat(64),budget:[{file:'retained.json',sha256:'c'.repeat(64)}]});
 assert.equal(Object.keys(result.plan.agentIds).length,13);assert.equal(result.registry.team.ids[role],newAgentId);assert.equal(result.registry.runtimeAssignments[role],'codex_subscription');
 for(const [key,id]of Object.entries(original.plan.agentIds))assert.equal(result.plan.agentIds[key],id);
 assert.deepEqual(result.plan.steps,original.plan.steps);assert.equal(result.plan.callsSpent,original.plan.callsSpent);assert.deepEqual(result.registry.operations,original.registry.operations);
 assert.deepEqual(result.plan.rosterHistory[0].agentIds,original.plan.agentIds);assert.equal(result.plan.rosterMigration.businessAcceptance,'NOT_RUN');assert.deepEqual({plan,registry},original);
 assert.throws(()=>projectCompletedRosterMigration({plan,registry,newAgentId:plan.agentIds.chief,entry,migrationId:randomUUID()}),/MIGRATION_DENIED/);
});
test('completed resume keeps the original accepted matrix, identities, root input and spent-call records',()=>{
 const state=completedState();assert.equal(validateCompletedMultiRuntimeState(state),true);
 for(const change of [{plan:{...state.plan,status:'FAILED'}},{registry:{...state.registry,lease:{taskId:state.plan.rootTaskId}}},{activeRunIds:[randomUUID()]},{callLock:true},
  {rootTask:{...state.rootTask,description:'Changed scope'}},{runs:state.runs.slice(1)},{budget:state.budget.slice(1)},
  {agents:state.agents.map((agent,index)=>index?agent:{...agent,reportsTo:randomUUID()})}])assert.throws(()=>validateCompletedMultiRuntimeState({...state,...change}),/COMPLETED_/);
 const prior={runId:randomUUID(),agentId:state.plan.steps[0].agentId,taskId:state.plan.steps[0].taskId,nativeEvidence:{status:'failed'}};
 state.plan.steps[0].priorAttempts=[prior];assert.throws(()=>validateCompletedMultiRuntimeState(state),/HISTORY_MISSING/);
});
test('completed resume rechecks actual artifact, output and Host termination bytes without re-running models',()=>{
 const temp=mkdtempSync(path.join(os.tmpdir(),'sa-completed-')),root=temp+'/control',cwd=temp+'/artifacts',{plan}=completedState();mkdirSync(cwd,{recursive:true});
 const digest=value=>createHash('sha256').update(value).digest('hex'),put=(file,value)=>writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
 try{
  put(cwd+'/csv.test.mjs',CSV_TESTS);
  for(const step of plan.steps){const dir=root+'/transport/'+step.runId;mkdirSync(dir,{recursive:true});const text='accepted '+step.key;put(cwd+'/'+step.artifacts[0].file,text);step.artifacts[0].sha256=digest(text);
   put(dir+'/stdout','{}\n');put(dir+'/stderr','');put(dir+'/result.json',{runId:step.runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:digest('{}\n'),stderrSha256:digest('')});
   put(dir+'/native-proof.json',{runId:step.runId,runtimeProfileId:step.runtimeProfileId,executor:'macos_native',platform:'darwin'});
   for(const name of ['process-cleanup.json','broker-process-cleanup.json'])put(dir+'/'+name,{status:'terminated'});
  }
  assert.equal(verifyCompletedFiles(plan,cwd,{root}).toString(),CSV_TESTS);
  const step=plan.steps[4];put(cwd+'/'+step.artifacts[0].file,'changed');assert.throws(()=>verifyCompletedFiles(plan,cwd,{root}),/ARTIFACT_CHANGED/);
  put(cwd+'/'+step.artifacts[0].file,'accepted '+step.key);put(root+'/transport/'+step.runId+'/broker-process-cleanup.json',{status:'unknown'});assert.throws(()=>verifyCompletedFiles(plan,cwd,{root}),/HOST_PROOF_DENIED/);
 }finally{rmSync(temp,{recursive:true});}
});

test('identity is re-probed under row locks so an intervening good key is never deleted',async()=>{
 const {event}=identitySetupFixture();let repaired=0,probes=0;
 const ensure=async()=>{probes++;if(probes===1)throw Error(event.message);return{keyId:'concurrently-repaired'};};
 await assert.rejects(ensure());
 const result=await repairIdentityUnderLock({ensure,replace:async()=>{repaired++;}});
 assert.equal(result.reprovisioned,false);assert.equal(probes,2);assert.equal(repaired,0);
 assert.deepEqual(await repairIdentityUnderLock({ensure:async()=>{throw Error(event.message);},replace:async()=>{repaired++;}}),{reprovisioned:true});assert.equal(repaired,1);
 await assert.rejects(repairIdentityUnderLock({ensure:async()=>{throw Error('database unavailable');},replace:async()=>{repaired++;}}),{code:'MULTI_RUNTIME_IDENTITY_FAILURE_UNVERIFIED'});assert.equal(repaired,1);
});

function identitySetupFixture(){
 const plan=createIsolatedAcceptance(),step=plan.steps[0],run={id:randomUUID(),companyId:plan.companyId,issueId:step.taskId,agentId:step.agentId,status:'failed',errorCode:'setup_failed',finishedAt:new Date(),
  resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}},lastOutputBytes:0};step.runId=run.id;
 const event={runId:run.id,companyId:run.companyId,agentId:run.agentId,eventType:'error',stream:'system',level:'error',sourceEventId:null,payload:null,createdAt:new Date(run.finishedAt.getTime()+20),
  message:'Secret decryption failed (master key fingerprint: '+ 'a'.repeat(12)+'). This usually means the master key does not match the key used to encrypt the secret. Original error: Unsupported state or unable to authenticate data'};
 return{plan,run,event,markers:{claimExists:false,transportExists:false,providerAuditExists:false,callLockExists:false}};
}
test('identity setup failure is proven by exact Native setup error without inventing a Gate claim',()=>{
 const {run,event,markers}=identitySetupFixture(),proof=knownBootstrapClosure(run,markers,{executionEvents:[event]});
 assert.equal(proof.gateCode,'NATIVE_IDENTITY_SETUP_FAILED');assert.equal(proof.proofSource,'native_identity_setup');assert.equal(proof.claimed,undefined);
 for(const events of [[],[{...event,eventType:'adapter.invoke'}],[{...event,message:'provider started'}],[{...event,payload:{provider:true}}]])assert.throws(()=>knownBootstrapClosure(run,markers,{executionEvents:events}),/IDENTITY_SETUP/);
 assert.throws(()=>knownBootstrapClosure({...run,processPid:1},markers,{executionEvents:[event]}),/IDENTITY_SETUP/);
});
test('identity reprovision authorization is limited to the original Backend and every closed zero-provider run',()=>{
 const {plan,run,event,markers}=identitySetupFixture(),first={...run,id:randomUUID(),errorCode:'nonzero_exit',error:JSON.stringify({code:'ROLE_OPENCODE_GATE_SCOPE_DENIED',claimed:false})};
 const cancelled=[1,2].map(()=>({...run,id:randomUUID(),status:'cancelled',errorCode:null,resultJson:{}})),runs=[first,...cancelled,run];
 const closure={companyId:plan.companyId,rootTaskId:plan.rootTaskId,modelCalls:0,runs:runs.map(row=>({id:row.id,status:row.status,finishedAt:row.finishedAt.toISOString()}))};
 const input={authorized:true,identity:{companyId:plan.companyId,agentId:plan.steps[0].agentId,algorithm:'Ed25519',keyId:'public-old'},plan,closure,runs,
  eventsByRun:{[first.id]:[{eventType:'adapter.invoke'}],[cancelled[0].id]:[],[cancelled[1].id]:[],[run.id]:[event]},markersByRun:Object.fromEntries(runs.map(row=>[row.id,{...markers}]))};
 assert.equal(assertIsolatedIdentityReprovision(input),true);
 for(const change of [{authorized:false},{identity:{...input.identity,agentId:randomUUID()}},{closure:{...closure,modelCalls:1}},
  {eventsByRun:{...input.eventsByRun,[run.id]:[{...event,eventType:'adapter.invoke'}]}},{markersByRun:{...input.markersByRun,[run.id]:{...markers,claimExists:true}}}])assert.throws(()=>assertIsolatedIdentityReprovision({...input,...change}),/IDENTITY|BOOTSTRAP/);
});

test('admission wait retries only global busy with fresh storage evidence and unchanged identities',async()=>{
 const taskId=randomUUID(),projectId=randomUUID();let now=1000,reads=0,calls=0;
 const meter={reserveTask(input){calls++;assert.equal(input.taskId,taskId);assert.equal(input.projectId,projectId);assert.equal(input.storageReceipt.version,calls);if(calls<3)throw Object.assign(Error('busy'),{code:'ADMISSION_BUSY'});return{allowed:true,nonce:'owned'};}};
 const lease=await reserveAcceptanceTask({meter,taskId,projectId,readStorage:()=>({version:++reads})},{clock:()=>now,wait:async ms=>{now+=ms;}});
 assert.equal(lease.nonce,'owned');assert.equal(calls,3);assert.equal(reads,3);assert.equal(now,3000);
 for(const code of ['ADMISSION_STORAGE_DENIED','ADMISSION_DATABASE_FAILED'])await assert.rejects(reserveAcceptanceTask({meter:{reserveTask(){throw Object.assign(Error(code),{code});}},taskId,projectId,readStorage:()=>({})}),{code});
 await assert.rejects(reserveAcceptanceTask({meter:{reserveTask(){throw Object.assign(Error('busy'),{code:'ADMISSION_BUSY'});}},taskId,projectId,readStorage:()=>({})},{timeoutMs:1000,clock:()=>now,wait:async ms=>{now+=ms;}}),{code:'MULTI_RUNTIME_ADMISSION_BUSY_TIMEOUT'});
});

test('cancelled preparing acknowledgement accepts only the exact Native cancellation receipt and changes only cancellation result data',()=>{
 const plan=createIsolatedAcceptance(),step=plan.steps[0],run={id:randomUUID(),companyId:plan.companyId,issueId:step.taskId,agentId:step.agentId,status:'cancelled',runtimeMode:'legacy',executionStage:'preparing',startedAt:new Date(),finishedAt:new Date(),resultJson:{original:'retained'},lastOutputBytes:0};
 const closure={companyId:plan.companyId,lease:{taskId:step.taskId},runs:[{id:run.id,status:run.status,finishedAt:run.finishedAt.toISOString()}]},input={run,closure,closureSha256:'a'.repeat(64),expectedAgentId:step.agentId,executionEvents:[],hostMarkers:[false,false,false]};
 const original=structuredClone(run),result=reconcileCancelledBootstrapResult(input);assert.equal(result.changed,true);assert.deepEqual(run,original);assert.equal(result.resultJson.original,'retained');
 assert.equal(result.resultJson.executionCancellation.state,'acknowledged');assert.equal(result.resultJson.executionCancellation.proof,'verified-no-provider-bootstrap');
 assert.equal(reconcileCancelledBootstrapResult({...input,run:{...run,resultJson:result.resultJson}}).changed,false);
 const event={runId:run.id,companyId:run.companyId,agentId:run.agentId,eventType:'lifecycle',stream:'system',level:'warn',message:'run cancelled',sourceEventId:null,
  payload:{cancellation:{expected:true,source:'control_plane'}},createdAt:new Date(run.finishedAt.getTime()+100)};
 assert.equal(reconcileCancelledBootstrapResult({...input,executionEvents:[event]}).changed,true);
 for(const change of [{message:'provider started'},{eventType:'adapter.invoke'},{sourceEventId:'foreign-event'},{runId:randomUUID()},
  {payload:{cancellation:{expected:true,source:'provider'}}},{createdAt:new Date(run.finishedAt.getTime()-1)},{createdAt:new Date(run.finishedAt.getTime()+60001)}]){
  assert.throws(()=>reconcileCancelledBootstrapResult({...input,executionEvents:[{...event,...change}]}),/BOOTSTRAP_STOP/);
 }
 for(const change of [{executionEvents:undefined},{executionEvents:[{eventType:'adapter.invoke'}]},{hostMarkers:[false,true,false]},
  {run:{...run,status:'running'}},{run:{...run,processPid:123}},{run:{...run,usageJson:{outputTokens:1}}}])assert.throws(()=>reconcileCancelledBootstrapResult({...input,...change}),/BOOTSTRAP_STOP/);
});

test('private bootstrap archives reuse identical bytes and retain different recovery snapshots',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'sa-bootstrap-archive-'));
 try{const a=archivePrivateSnapshot(root,'registry-before-resume',Buffer.from('old')),again=archivePrivateSnapshot(root,'registry-before-resume',Buffer.from('old')),b=archivePrivateSnapshot(root,'registry-before-resume',Buffer.from('new'));
  assert.equal(a.file,again.file);assert.notEqual(a.file,b.file);assert.equal(readFileSync(a.file,'utf8'),'old');assert.equal(readFileSync(b.file,'utf8'),'new');
 }finally{rmSync(root,{recursive:true});}
});

test('run material names satisfy the existing UUID-only gate without weakening its path contract',()=>{
 const plan=createIsolatedAcceptance();assert.match(roleRunMaterialName(plan.steps[0]),/^[a-f0-9-]{36}\.md$/);
 assert.equal(roleRunMaterialName(plan.steps[0]),plan.steps[0].operationId+'.md');
});

test('known bootstrap closure requires authoritative no-provider, claimed-false and an absent host execution',()=>{
 const run={id:randomUUID(),status:'failed',finishedAt:new Date(),exitCode:1,error:JSON.stringify({code:'ROLE_OPENCODE_GATE_SCOPE_DENIED',claimed:false}),
  resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}},usageJson:{inputTokens:0,outputTokens:0}};
 const absent={claimExists:false,transportExists:false,providerAuditExists:false,callLockExists:false};
 assert.equal(knownBootstrapClosure(run,absent).gateCode,'ROLE_OPENCODE_GATE_SCOPE_DENIED');
 for(const change of [{claimExists:true},{transportExists:true},{providerAuditExists:true},{callLockExists:true}])assert.throws(()=>knownBootstrapClosure(run,{...absent,...change}),/BOOTSTRAP/);
 for(const change of [{status:'running'},{resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:true}}},{usageJson:{inputTokens:1}},
  {error:JSON.stringify({code:'ROLE_OPENCODE_GATE_SCOPE_DENIED',claimed:true})}])assert.throws(()=>knownBootstrapClosure({...run,...change},absent),/BOOTSTRAP/);
});

test('explicit bootstrap repair preserves all task/agent/root identities, old attempt, evidence and spent budget',()=>{
 const original=createIsolatedAcceptance(),old=original.steps[0];old.runId=randomUUID();old.status='failed';old.nativeEvidence={runId:old.runId,status:'failed'};
 old.taskRuntimeRoute={id:randomUUID(),profileId:'minimax_opencode'};const saved=JSON.parse(JSON.stringify(original));for(const step of saved.steps)delete step.goal;
 const plan=rehydrateAcceptancePlan(saved),repair=prepareKnownBootstrapRepair(plan,{runId:old.runId,operationId:old.operationId,gateCode:'ROLE_OPENCODE_GATE_SCOPE_DENIED',budgetRecords:[{operationId:old.operationId,sha256:'a'.repeat(64)}]});
 assert.equal(repair.companyId,original.companyId);assert.equal(repair.rootTaskId,original.rootTaskId);assert.deepEqual(repair.agentIds,original.agentIds);
 assert.equal(repair.steps[0].taskId,old.taskId);assert.notEqual(repair.steps[0].operationId,old.operationId);assert.equal(repair.steps[0].runId,undefined);
 assert.equal(repair.steps[0].priorAttempts[0].runId,old.runId);assert.deepEqual(repair.steps[0].priorAttempts[0].taskRuntimeRoute,old.taskRuntimeRoute);
 assert.equal(repair.steps[1].handoffFromOperationId,repair.steps[0].operationId);assert.equal(repair.callsSpent,1);assert.equal(repair.steps[0].resumeKnownBootstrap,true);
 assert.equal(original.steps[0].operationId,old.operationId);assert.ok(repair.steps.every(step=>typeof step.goal==='string'&&step.goal));
});

test('released source lease closure must match every retained terminal Native run and budget byte hash',()=>{
 const plan=createIsolatedAcceptance(),first=plan.steps[0];first.runId=randomUUID();
 const runs=[{id:first.runId,status:'failed'},{id:randomUUID(),status:'cancelled'},{id:randomUUID(),status:'cancelled'}].map(run=>({...run,companyId:plan.companyId,issueId:first.taskId,agentId:first.agentId,finishedAt:new Date()}));
 const budget=[{operationId:first.operationId,sha256:'a'.repeat(64)}],closure={schemaVersion:1,kind:'known-unstarted-bootstrap-closure',companyId:plan.companyId,rootTaskId:plan.rootTaskId,modelCalls:0,
  lease:{taskId:first.taskId,projectId:plan.projectId,operationId:first.operationId,nonce:'b'.repeat(64)},runs:runs.map(({id,status,finishedAt})=>({id,status,finishedAt:finishedAt.toISOString()})),budget:[{file:first.operationId+'.json',sha256:'a'.repeat(64)}]};
 const input={closure,plan,registry:{},runs,budget};assert.equal(validateReleasedBootstrapClosure(input),closure);
 const promoted=runs.map((run,index)=>index===1?{...run,startedAt:new Date(),processPid:null,driverKind:null,lastOutputBytes:0}:run);
 assert.equal(validateReleasedBootstrapClosure({...input,runs:promoted}),closure);
 for(const change of [{registry:{lease:closure.lease}},{runs:runs.slice(0,2)},{budget:[{...budget[0],sha256:'c'.repeat(64)}]},
  {closure:{...closure,modelCalls:1}},{runs:runs.map((run,index)=>index===1?{...run,startedAt:new Date(),processPid:123}:run)}])assert.throws(()=>validateReleasedBootstrapClosure({...input,...change}),/BOOTSTRAP/);
});

test('fresh identities cover twelve roles, separate development and QA, and preserve the shared budget',()=>{
 const a=createIsolatedAcceptance(),b=createIsolatedAcceptance();
 assert.equal(Object.keys(a.agentIds).length,Object.keys(TEAM_ROLES).length);assert.equal(a.steps.length,5);
 assert.notEqual(a.companyId,b.companyId);assert.notEqual(a.rootTaskId,b.rootTaskId);
 assert.equal(new Set([a.companyId,a.projectId,a.workspaceId,a.rootTaskId,...Object.values(a.agentIds),...a.steps.flatMap(s=>[s.taskId,s.operationId])]).size,Object.keys(TEAM_ROLES).length+13);
 assert.deepEqual(a.runtimeAssignments,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS);
 assert.ok(Object.values(a.runtimeAssignments).every(value=>value==='codex_subscription'));
 assert.equal(a.maximumCalls,20);assert.equal(a.maximumResponsesPerRun,64);
 assert.deepEqual(a.steps.map(s=>s.role),['backend-engineer','backend-engineer','research','pm','qa']);
 assert.deepEqual(a.steps.map(s=>s.runtimeProfileId),['minimax_opencode','codex_subscription','deepseek_opencode','codex_subscription','codex_subscription']);
 for(const step of a.steps)assert.equal(selectTaskRuntimeProfile({role:step.role,...step.selection}).profile.id,step.runtimeProfileId);
 assert.equal(a.steps[0].agentId,a.steps[1].agentId);assert.equal(a.steps[0].taskId,a.steps[1].taskId);
 assert.notEqual(a.steps[0].operationId,a.steps[1].operationId);assert.notEqual(a.steps[0].agentId,a.steps[4].agentId);
 assert.equal(a.steps[1].handoffFromOperationId,a.steps[0].operationId);
 assert.equal(a.productionDeployment,'NOT_RUN');assert.equal(a.automaticDispatch,'NOT_RUN');
});

test('explicit same-task handoff archives original artifacts and cumulative budget identities before switching',()=>{
 const cwd=mkdtempSync(path.join(os.tmpdir(),'sa-handoff-')),plan=createIsolatedAcceptance(),[from,to]=plan.steps;
 try{
  from.runId=randomUUID();from.status='PASS';writeFileSync(path.join(cwd,'csv.mjs'),'original CSV implementation\n');writeFileSync(path.join(cwd,'backend-result.json'),'{"tests":5}\n');
  const artifacts=['csv.mjs','backend-result.json'].map(file=>({taskId:from.taskId,runId:from.runId,file,sha256:createHash('sha256').update(readFileSync(path.join(cwd,file))).digest('hex')}));
  const budget=[{operationId:from.operationId,sha256:'a'.repeat(64)}];
  const receipt=snapshotAcceptanceHandoff({cwd,rootTaskId:plan.rootTaskId,from,to,artifacts,budget});
  assert.equal(receipt.taskId,to.taskId);assert.equal(receipt.rootTaskId,plan.rootTaskId);assert.equal(receipt.budget.callsSpent,1);assert.deepEqual(receipt.budget.records,budget);
  assert.equal(receipt.fromOperationId,from.operationId);assert.equal(receipt.toOperationId,to.operationId);
  writeFileSync(path.join(cwd,'csv.mjs'),'new candidate\n');assert.doesNotThrow(()=>verifyAcceptanceHandoff({cwd,receipt}));
  assert.equal(readFileSync(path.join(cwd,receipt.artifacts[0].file),'utf8'),'original CSV implementation\n');
  assert.throws(()=>snapshotAcceptanceHandoff({cwd,rootTaskId:plan.rootTaskId,from,to:{...to,taskId:randomUUID()},artifacts,budget}),/MULTI_RUNTIME_HANDOFF_DENIED/);
 }finally{rmSync(cwd,{recursive:true});}
});

test('per-task API and Codex settings replace auth/runtime fields completely while role defaults remain unchanged',()=>{
 const plan=createIsolatedAcceptance(),[step]=plan.steps,base={role:step.role,id:step.agentId,projectId:plan.projectId,cwd:'/isolated/artifacts',providerHome:'/tmp/delegated/provider',
  refs:{minimax:{type:'secret_ref',secretId:randomUUID(),version:1}},instructionsFilePath:'/isolated/materials/AGENTS.md'};
 const api=isolatedRuntimeBinding({...base,runtimeProfileId:'minimax_opencode'}),codex=isolatedRuntimeBinding({...base,runtimeProfileId:'codex_subscription'});
 assert.equal(api.adapterType,'opencode_local');assert.equal(api.profile.reasoningEffort,null);assert.equal(api.runtimeConfig.aiConnection,null);
 assert.equal(api.adapterConfig.modelReasoningEffort,undefined);assert.equal(api.adapterConfig.env.CODEX_HOME,undefined);
 assert.equal(api.adapterConfig.env.SUPER_AGENT_ROLE_PROVIDER_API_KEY.type,'secret_ref');
 assert.equal(codex.adapterType,'codex_local');assert.equal(codex.adapterConfig.modelReasoningEffort,'low');
 assert.equal(codex.adapterConfig.env.SUPER_AGENT_ROLE_PROVIDER_API_KEY,undefined);assert.equal(codex.adapterConfig.env.OPENCODE_CONFIG,undefined);
 assert.equal(codex.adapterConfig.env.CODEX_HOME,base.providerHome);assert.equal(codex.adapterConfig.dangerouslySkipPermissions,undefined);
 assert.ok(Object.values(plan.runtimeAssignments).every(profile=>'codex_subscription'===profile));
});
test('both Claude API profiles have isolated markers and no Codex or OpenCode auth/settings',()=>{
 const plan=createIsolatedAcceptance(),step=plan.steps[0],refs={deepseek:{type:'secret_ref',secretId:randomUUID(),version:1},minimax:{type:'secret_ref',secretId:randomUUID(),version:1}};
 for(const runtimeProfileId of ['deepseek_claude','minimax_claude']){
  const selected=isolatedRuntimeBinding({role:step.role,id:step.agentId,projectId:plan.projectId,cwd:'/isolated',providerHome:'/tmp/unused',runtimeProfileId,refs,instructionsFilePath:'/isolated/AGENTS.md'});
  assert.equal(selected.adapterType,'claude_local');assert.equal(selected.adapterConfig.command,'/opt/super-agent/bin/claude');assert.equal(selected.profile.reasoningEffort,null);
  assert.equal(selected.adapterConfig.env.CLAUDE_CONFIG_DIR,'/paperclip/control/research-pm/claude-clients/'+step.agentId+'/config');
  assert.equal(selected.adapterConfig.env.SUPER_AGENT_ROLE_PROVIDER_API_KEY.type,'secret_ref');assert.equal(selected.adapterConfig.maxTurnsPerRun,64);assert.equal(selected.adapterConfig.effort,'');assert.equal(selected.adapterConfig.chrome,false);
  assert.equal(selected.adapterConfig.dangerouslySkipPermissions,true);assert.deepEqual(selected.adapterConfig.extraArgs,[]);
  for(const key of ['CODEX_HOME','OPENCODE_CONFIG'])assert.equal(selected.adapterConfig.env[key],undefined);
  for(const key of ['modelReasoningEffort','search','dangerouslyBypassApprovalsAndSandbox','dangerouslyBypassSandbox'])assert.equal(selected.adapterConfig[key],undefined);
 }
});

test('fixed CSV suite contains five actual behavior checks and rejects the initial implementation',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'sa-csv-contract-'));
 try{
  writeFileSync(path.join(dir,'csv.mjs'),CSV_IMPLEMENTATION);writeFileSync(path.join(dir,'csv.test.mjs'),CSV_TESTS);
  assert.equal((CSV_TESTS.match(/test\('/g)??[]).length,5);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','csv.test.mjs'],{cwd:dir,encoding:'utf8',env});
  assert.notEqual(result.status,0);assert.match(result.stdout,/# fail [1-5]/);
  assert.equal(readFileSync(path.join(dir,'csv.test.mjs'),'utf8'),CSV_TESTS);
 }finally{rmSync(dir,{recursive:true});}
});

test('public evidence selects numeric usage, identity and hashes without exporting config, output or secret metadata',()=>{
 const runId=randomUUID(),value=publicRunEvidence({id:runId,issueId:randomUUID(),agentId:randomUUID(),status:'succeeded',exitCode:0,
  usageJson:{inputTokens:3,outputTokens:4,costUsd:0.1,apiKey:'SECRET'},adapterConfig:{env:{TOKEN:'SECRET'}},resultJson:{token:'SECRET'},
  summary:'private full prompt SECRET',sessionId:'s-123',secretKeys:['SECRET']},{provider:'deepseek',model:'deepseek/deepseek-flash',runtime:'opencode'});
 assert.equal(value.runId,runId);assert.deepEqual(value.usage,{inputTokens:3,outputTokens:4,costUsd:0.1});
 assert.equal(value.sessionId,'s-123');assert.match(value.resultSha256,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(value).includes('SECRET'));assert.equal(value.unknownCost,true);assert.equal(value.costSource,'runtime_reported_estimate');
 assert.equal(publicRunEvidence({id:runId,usageJson:{costUsd:0}},{provider:'minimax',model:'MiniMax-M3.1-Flash',runtime:'claude'}).unknownCost,true);
 assert.equal(publicRunEvidence({id:runId,usageJson:{}},{provider:'openai',model:'gpt-6.1-sol',runtime:'codex'}).unknownCost,true);
});

test('delegated subscription auth requires short TTL and never accepts a real refresh token',()=>{
 const now=Date.now(),auth={tokens:{access_token:'access',id_token:'id',account_id:'account',refresh_token:'ISOLATED_NO_REFRESH'},expiresAt:now+60000};
 assert.doesNotThrow(()=>assertDelegatedAuth(auth,{now}));
 for(const modified of [{...auth,expiresAt:now-1},{...auth,expiresAt:now+1800001},{...auth,tokens:{...auth.tokens,refresh_token:'real-refresh'}}]){
  assert.throws(()=>assertDelegatedAuth(modified,{now}),{code:'MULTI_RUNTIME_DELEGATED_AUTH_DENIED'});
 }
});
