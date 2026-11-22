import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {teamRoleAdmissionFailure,prepareTeamRoleExecution} from '../bridge/chief-bootstrap-retry.mjs';
import {completedResumeChiefOperation,completedResumeChiefRetryEvidence,bindUnstartedCompletedResumeChiefRetry,completedResumeChiefRetryEvidenceCode} from '../bridge/role-native-retry.mjs';
import {selectQueuedNativeRoleRetry} from '../bridge/role-native-retry-consumer.mjs';
import {bindNativeRetryAttempt,startTeamCoordinator} from '../bridge/team-native-runtime.mjs';

import {fixture,nativeFixture,contents,controlledPreflight} from './helpers/completed-resume-chief-fixture.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),copy=value=>structuredClone(value);
test('the exact completed-root workspace refusal reuses its original operation and four spent slots',t=>{
 const f=fixture(t),before=copy({registry:f.registry,flow:f.flow,parentRun:f.parentRun,control:f.control,ctx:f.ctx}),files=contents(f.root);
 assert.equal(completedResumeChiefOperation(f.registry,f.parentRun),f.operation);
 assert.equal(bindUnstartedCompletedResumeChiefRetry(f),f.ctx);assert.equal(bindUnstartedCompletedResumeChiefRetry(f),f.ctx);
 assert.deepEqual({registry:f.registry,flow:f.flow,parentRun:f.parentRun,control:f.control,ctx:f.ctx},before);assert.deepEqual(contents(f.root),files);
 assert.equal(f.operation.acceptedRunId,undefined);assert.equal(fs.readdirSync(f.root+'/budget/'+f.task.id).length,4);
 assert.notEqual(f.nativeWorkspace.cwd,f.workspaceCwd);assert.equal(f.ctx.context.projectWorkspaceId,undefined);
});
test('queued selection requires the completed-resume proof and never claims scheduled rows',t=>{
 const f=fixture(t),queued={...f.run,status:'queued'},state={...f,run:queued,activeRuns:[queued],taskRuns:f.taskRuns.map(value=>value.id===queued.id?queued:value),ctx:{...f.ctx,context:queued.contextSnapshot},phase:'queued'};
 const proof=completedResumeChiefRetryEvidence(state),input={registry:f.registry,activeRuns:[queued],parentRun:f.parentRun,tasks:[f.task],chiefWorkspaceEvidence:proof};
 assert.equal(selectQueuedNativeRoleRetry(input).runId,queued.id);
 assert.equal(selectQueuedNativeRoleRetry({...input,chiefWorkspaceEvidence:undefined}),null);
 assert.equal(selectQueuedNativeRoleRetry({...input,activeRuns:[{...queued,status:'scheduled_retry'}]}),null);
});
test('wrong owner/resume/input/workspace, provider uncertainty and any physical evidence remain denied',t=>{
 const changes=[f=>f.parentRun.resultJson.executionRecovery.providerWorkStarted=null,f=>f.parentRun.logBytes=1,f=>delete f.parentRun.nativeSessionId,
  f=>f.parentRun.error='same words from another failure',f=>f.operation.acceptedRunId=randomUUID(),f=>f.operation.artifactGeneration=randomUUID(),f=>f.run.scheduledRetryAttempt=2,
  f=>f.control.completedResume.approvedBy='other',f=>f.control.resumeClaim.operationId=randomUUID(),f=>f.control.pauseRequested=true,f=>f.control.pendingInputs.push({text:'new input'}),
  f=>f.task.description='new goal',f=>f.nativeWorkspace.cwd='/other-source',f=>f.run.contextSnapshot.paperclipWorkspace.workspaceId=randomUUID(),
  f=>f.wakeup.requestedByActorType='user',f=>f.activeRuns.push({...f.run,id:randomUUID()}),f=>f.leases[0].releasedAt=null,f=>f.verifyPhaseLease=()=>false];
 for(const change of changes){const f=fixture(t);change(f);const files=contents(f.root),registry=copy(f.registry);assert.throws(()=>bindUnstartedCompletedResumeChiefRetry(f),/^Error: TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_/);assert.deepEqual(contents(f.root),files);assert.deepEqual(f.registry,registry);}
 for(const which of ['parentRun','run'])for(const prefix of ['permits','claims','results','transport']){const f=fixture(t);f.write(prefix+'/'+f[which].id+(prefix==='transport'?'/request.json':'.json'),{});assert.throws(()=>bindUnstartedCompletedResumeChiefRetry(f),/PHYSICAL_EVIDENCE_PRESENT/);}
 for(const write of [f=>f.write('call.lock',{}),f=>f.write('operations/'+f.operation.id+'.json',{}),f=>f.write('budget/'+f.task.id+'/'+f.operation.id+'.json',{})]){const f=fixture(t);write(f);assert.throws(()=>bindUnstartedCompletedResumeChiefRetry(f),/PHYSICAL_EVIDENCE_PRESENT/);}
});
test('missing physical or Native evidence stays reconciliation unknown and cannot fall into initial admission',async t=>{
 const f=fixture(t);fs.rmSync(f.root+'/budget',{recursive:true});let admissions=0,failure;
 try{await prepareTeamRoleExecution(f.ctx,{database:null,bindNativeRetryAttempt:async()=>{try{return bindUnstartedCompletedResumeChiefRetry(f);}catch(error){throw Object.assign(Error('unknown'),{code:completedResumeChiefRetryEvidenceCode(error)});}},admitChiefInput:async()=>{admissions++;}});}catch(error){failure=teamRoleAdmissionFailure(error);}
 assert.deepEqual(failure.resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});assert.equal(admissions,0);
});
test('the current Native successor must itself be pristine in both queue and running phases',t=>{
 const variants=[['nativeSessionId','observed-provider-session'],['sessionIdBefore','old-provider-session'],['sessionIdAfter','new-provider-session'],
  ['processPid',12345],['processGroupId',12345],['processStartedAt','2026-11-22T06:00:00Z'],['logBytes',1],['logSha256','a'.repeat(64)],
  ['stdoutExcerpt','provider output'],['stderrExcerpt','provider error'],['signal','SIGTERM'],['exitCode',1],['errorCode','interrupted'],['error','unknown execution'],['finishedAt','2026-11-22T06:00:00Z'],
  ['lastOutputSeq',1],['lastOutputAt','2026-11-22T06:00:00Z'],['lastOutputStream','stdout'],['lastOutputBytes',1],['usageJson',{inputTokens:1}],
  ['resultJson',{executionRecovery:{kind:'reconciliation',providerWorkStarted:true}}],['resultJson',{executionRecovery:{kind:'reconciliation',providerWorkStarted:null}}],
  ['resultJson',{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}],['resultJson',{timeoutFired:true}],['resultJson',{outputUnknown:true}],
  ['resultJson',{conversationContinuation:'unknown-policy'}],['resultJson',{conversationContinuation:'continue_conversation_v1',executionRecovery:{providerWorkStarted:true}}],
  ['usageJson',{}],['resultJson',[]]];
 for(const phase of ['queued','running'])for(const [key,value]of variants){
  const f=fixture(t);f.run.status=phase;f.run[key]=value;const before=contents(f.root);
  assert.throws(()=>completedResumeChiefRetryEvidence({...f,phase}),/SUCCESSOR_NOT_PRISTINE/,phase+':'+key);assert.deepEqual(contents(f.root),before);
 }
 for(const key of ['nativeSessionId','processPid','processStartedAt','logBytes','stdoutExcerpt','resultJson','usageJson']){
  const f=fixture(t);delete f.run[key];assert.throws(()=>completedResumeChiefRetryEvidence(f),/SUCCESSOR_NOT_PRISTINE/,'missing:'+key);
 }
 const f=fixture(t),queued={...f.run,status:'queued'},state={...f,run:queued,activeRuns:[queued],taskRuns:f.taskRuns.map(value=>value.id===queued.id?queued:value),ctx:{...f.ctx,context:queued.contextSnapshot},phase:'queued'},proof=completedResumeChiefRetryEvidence(state);
 for(const [key,value]of variants)assert.equal(selectQueuedNativeRoleRetry({registry:f.registry,parentRun:f.parentRun,tasks:[f.task],activeRuns:[{...queued,[key]:value}],chiefWorkspaceEvidence:proof}),null,'selector:'+key);
});
test('Native controller start time and exact continuation marker are not mistaken for provider work',t=>{
 for(const resultJson of [null,{}, {conversationContinuation:'continue_conversation_v1'}]){
  const f=fixture(t);f.run.resultJson=resultJson;f.run.startedAt=new Date('2026-11-22T06:00:00Z');
  assert.equal(completedResumeChiefRetryEvidence(f).spentBeforeCurrent,4);
 }
 const f=fixture(t);f.run.logBytes=0;f.run.logSha256=sha('');f.run.stdoutExcerpt='';f.run.stderrExcerpt='';f.run.lastOutputBytes=0;
 assert.equal(completedResumeChiefRetryEvidence(f).spentBeforeCurrent,4);
});
test('only the exact first controlled refusal plus readonly Native reconciliation permits the second existing successor',t=>{
 const f=controlledPreflight(fixture(t)),before=copy({initial:f.initialRun,parent:f.parentRun,registry:f.registry,flow:f.flow}),budget=contents(f.root+'/budget');
 assert.equal(bindUnstartedCompletedResumeChiefRetry(f),f.ctx);assert.equal(bindUnstartedCompletedResumeChiefRetry(f),f.ctx);
 assert.equal(f.parentRun.resultJson.executionRecovery.providerWorkStarted,null);
 assert.deepEqual({initial:f.initialRun,parent:f.parentRun,registry:f.registry,flow:f.flow},before);assert.deepEqual(contents(f.root+'/budget'),budget);
 const variants=[x=>delete x.reconciledPreflightRun,x=>x.reconciledPreflightRun.id=randomUUID(),x=>x.parentRun.errorCode='OTHER_ERROR',
  x=>x.parentRun.resultJson.executionRecovery.providerWorkStarted=false,x=>x.parentRun.retryOfRunId=randomUUID(),x=>x.parentRun.scheduledRetryAttempt=2,
  x=>x.initialRun.resultJson.executionRecovery.providerWorkStarted=null,x=>x.initialRun.errorCode='OTHER_ERROR',x=>x.run.scheduledRetryAttempt=3,
  x=>x.parentRun.nativeSessionId='observed',x=>x.parentRun.processStartedAt=new Date(),x=>x.parentRun.lastOutputSeq=1,
  x=>x.write('transport/'+x.initialRun.id+'/request.json',{}),x=>x.write('transport/'+x.parentRun.id+'/request.json',{})];
 for(const mutate of variants){const v=controlledPreflight(fixture(t));mutate(v);assert.throws(()=>completedResumeChiefRetryEvidence(v),/^Error: TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_/);}
});
test('only exact Native initial accounting matches the current trusted task scope',t=>{
 const f=fixture(t);Object.assign(f.run,{usageJson:{ledgerScope:{issueId:f.task.id,projectId:f.task.projectId,billingCode:null},accountingReceiptReady:false,accountingReceiptSequence:0,accountingReceiptSourceId:randomUUID()},
  costAccountingPending:true,costAccountedAt:null,accountingAttemptCount:0,accountingLastAttemptAt:null,accountingLastError:null,accountingProjectionVersion:null});
 assert.equal(completedResumeChiefRetryEvidence(f).spentBeforeCurrent,4);
 const variants=[x=>x.run.usageJson.inputTokens=0,x=>x.run.usageJson.accountingProviderWorkStarted=false,x=>x.run.usageJson.accountingReceiptSequence=1,
  x=>x.run.usageJson.accountingReceiptReady=true,x=>x.run.usageJson.accountingReceiptSourceId='unknown',x=>x.run.usageJson.ledgerScope.projectId=randomUUID(),
  x=>x.run.usageJson.ledgerScope.issueId=randomUUID(),x=>x.run.usageJson.ledgerScope.billingCode='other',x=>x.run.usageJson.ledgerScope.extra=true,
  x=>x.run.costAccountingPending=false,x=>x.run.accountingAttemptCount=1,x=>x.run.costAccountedAt=new Date(),x=>x.run.accountingLastError='unknown'];
 for(const mutate of variants){const v={...f,run:copy(f.run)};v.taskRuns=f.taskRuns.map(row=>row.id===v.run.id?v.run:row);mutate(v);assert.throws(()=>completedResumeChiefRetryEvidence(v),/SUCCESSOR_NOT_PRISTINE/);}
 f.run.status='queued';assert.throws(()=>completedResumeChiefRetryEvidence({...f,phase:'queued'}),/SUCCESSOR_NOT_PRISTINE/);
});
test('the full queue → actual Native parent → strict selector → production binder chain preserves the old root',async t=>{
 const f=fixture(t);f.run.status='queued';f.activeRuns=[f.run];
 const p=nativeFixture(t,f),budgetBefore=contents(f.root+'/budget'),before={registry:copy(f.registry),parent:copy(f.parentRun),control:copy(f.control)};
 const coordinator=startTeamCoordinator({database:async()=>p,nativePorts:async()=>p});t.after(()=>coordinator.stop());
 await Promise.all([coordinator.tick(),coordinator.tick()]);
 assert.deepEqual(p.resumes,[f.run.id],fs.readFileSync(f.root+'/events.jsonl','utf8'));assert.equal(p.lookups[0],f.parentRun.id);assert.equal(f.run.retryOfRunId,f.parentRun.id);
 const bound=await prepareTeamRoleExecution(f.ctx,{database:async()=>p,bindNativeRetryAttempt,admitChiefInput:async()=>assert.fail('must not readmit the owner root')});
 assert.equal(bound,f.ctx);assert.equal(bound.context.roleOperationId,f.operation.id);assert.equal(f.operation.acceptedRunId,undefined);
 assert.deepEqual(contents(f.root+'/budget'),budgetBefore);assert.deepEqual({registry:f.registry,parent:f.parentRun,control:f.control},before);
 for(const directory of ['permits','claims','results','transport','operations'])assert.equal(fs.existsSync(f.root+'/'+directory),false,directory);
 const events=fs.readFileSync(f.root+'/events.jsonl','utf8').trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(value=>value.code==='TEAM_NATIVE_RETRY_CONSUMER_RESUMED').length,1);
 assert.equal(events.filter(value=>value.code==='TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_VALIDATED').length,1);
});
test('the three-row queue selects the actual middle parent and preserves the original completed-resume operation',async t=>{
 const f=controlledPreflight(fixture(t));f.run.status='queued';f.activeRuns=[f.run];const p=nativeFixture(t,f),budget=contents(f.root+'/budget');
 const coordinator=startTeamCoordinator({database:async()=>p,nativePorts:async()=>p});t.after(()=>coordinator.stop());await coordinator.tick();
 assert.deepEqual(p.resumes,[f.run.id]);assert.deepEqual(p.lookups.slice(0,2),[f.parentRun.id,f.initialRun.id]);
 assert.equal(await bindNativeRetryAttempt(f.ctx,{database:async()=>p}),f.ctx);assert.deepEqual(contents(f.root+'/budget'),budget);
 assert.equal(f.parentRun.resultJson.executionRecovery.providerWorkStarted,null);assert.equal(f.operation.acceptedRunId,undefined);
 p.validateExecutionReconciliation=async()=>{throw Error('owned Native coordinator');};
 await assert.rejects(bindNativeRetryAttempt(f.ctx,{database:async()=>p}),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_EVIDENCE_UNAVAILABLE/);
});
