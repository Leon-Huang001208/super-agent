import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {planQualityResume,qualityResumeTransaction} from '../bridge/team-quality-resume.mjs';
import {qualityResumeArgs} from '../scripts/resume-team-quality.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {grantComplexTaskBudget} from '../bridge/task-call-policy.mjs';

function fixture(){
 const task={id:randomUUID(),title:'Original goal',description:'Original input unchanged',companyId:'company',projectId:'project',responsibleUserId:'owner',assigneeUserId:'owner',assigneeAgentId:null,status:'blocked'};
 let registry={companyId:'company',ownerId:'owner',team:{enabled:false},tasks:[task.id],taskRoots:{[task.id]:task.id}};
 registry=grantComplexTaskBudget(registry,{task,approvalSource:'owner-tier-policy'});
 const qa={taskId:randomUUID(),runId:randomUUID(),file:'quality-r1.json',sha256:'a'.repeat(64),verdict:'NEEDS_WORK'};
 const flow={rootTaskId:task.id,projectId:task.projectId,inputRevision:taskInputRevision(task),artifacts:{quality:qa},qaBlocked:{code:'TEAM_QA_REPAIR_BUDGET_EXHAUSTED',sourceQa:qa},qaRepair:{stage:'complete',round:1,qaKey:'quality'},summary:{kind:'controller-quality-block',noModelCall:true},notification:{status:'sent',messageId:'original-receipt'},qaRepairHistory:[{round:1}],dispatches:{quality:{operationId:randomUUID()}}};
 return {registry,task,flow,flowSha256:'b'.repeat(64),expectedFlowSha256:'b'.repeat(64),resumeId:randomUUID(),used:5,activeRuns:[],leases:[],callLock:false};
}
test('explicit owner resume preserves the original root, inputs, failed QA, spent calls and two-round bound',()=>{
 const f=fixture(),before=structuredClone(f),plan=planQualityResume(f);
 assert.equal(plan.kind,'resume');assert.deepEqual(f,before);assert.equal(plan.flow.rootTaskId,f.task.id);assert.equal(plan.flow.inputRevision,f.flow.inputRevision);
 assert.deepEqual(plan.flow.artifacts,f.flow.artifacts);assert.deepEqual(plan.flow.dispatches,f.flow.dispatches);assert.deepEqual(plan.flow.qaRepairHistory,f.flow.qaRepairHistory);
 assert.equal(plan.flow.qaBlocked,undefined);assert.equal(plan.flow.summary,undefined);assert.equal(plan.flow.notification,undefined);
 assert.equal(plan.flow.qualityResumeHistory[0].usedCalls,5);assert.equal(plan.flow.qualityResumeHistory[0].maximum,20);
 assert.equal(plan.flow.qualityResumeHistory[0].notification.messageId,'original-receipt');assert.equal(plan.flow.qaRepair.round,1);
});
test('a committed Native owner event reconciles only its original filesystem projection without another Native transition',()=>{
 const f=fixture(),plan=planQualityResume(f);f.nativeEvent=plan.event;f.task.status='in_review';
 const reconciliation=planQualityResume(f);assert.equal(reconciliation.kind,'reconcile_projection');assert.deepEqual(reconciliation.flow,plan.flow);
 assert.equal(planQualityResume({...f,flow:plan.flow,flowSha256:'c'.repeat(64)}).kind,'reused');
 assert.throws(()=>planQualityResume({...f,nativeEvent:{...plan.event,resumeId:randomUUID()}}),/EVENT_CHANGED/);
});
test('busy execution, goal drift, missing delivery proof, exhausted root and third repair cannot resume',()=>{
 for(const mutate of [f=>f.registry.team.enabled=true,f=>f.callLock=true,f=>f.activeRuns.push({id:'running'}),f=>f.leases.push({releasedAt:null}),
  f=>f.task.description='changed',f=>f.task.status='done',f=>f.task.assigneeAgentId='other',f=>f.flow.notification.status='unknown',f=>f.flow.qaRepair.round=2,
  f=>f.flow.qaBlocked.sourceQa={...f.flow.qaBlocked.sourceQa,runId:'changed'},f=>f.expectedFlowSha256='c'.repeat(64),f=>f.used=18]){
  const f=fixture();mutate(f);assert.throws(()=>planQualityResume(f),/TEAM_QUALITY_RESUME_/);
 }
 const f=fixture();delete f.registry.taskCallBudgets;assert.equal(planQualityResume(f).kind,'resume');f.used=18;assert.throws(()=>planQualityResume(f),/BUDGET_EXHAUSTED/);
});
test('quality resume reads a preserved twelve-call allocation without silently upgrading its historical authority',()=>{
 const f=fixture();f.registry.taskCallBudgets[f.task.id].maximum=12;
 assert.equal(planQualityResume(f).flow.qualityResumeHistory[0].maximum,12);
 f.used=10;assert.throws(()=>planQualityResume(f),/BUDGET_EXHAUSTED/);
});
test('resume is read-only by default and mutations require the exact root, resume identity and observed flow hash',()=>{
 const f=fixture();assert.deepEqual(qualityResumeArgs(['--task-id',f.task.id]),{apply:false,taskId:f.task.id});
 assert.equal(qualityResumeArgs(['--task-id',f.task.id,'--resume-id',f.resumeId,'--expected-flow-sha256',f.flowSha256,'--apply']).apply,true);
 for(const args of [['--apply','--task-id',f.task.id],['--task-id','../root'],['--task-id',f.task.id,'--force'],['--task-id',f.task.id,'--task-id',f.task.id]])assert.throws(()=>qualityResumeArgs(args),/ARGUMENTS_INVALID/);
});
test('Native resume events and post-commit actions publish only after the actual transaction commits',async()=>{
 const effects=[];let commit=false;
 const ports={transaction:async mutate=>{const result=await mutate({native:true});if(!commit)throw Error('Native commit rejected');effects.push('commit');return result;},
  mutate:async(tx,publications,actions)=>{assert.equal(tx.native,true);publications.push('root-updated','quality-resumed');actions.push('Native-action');assert.deepEqual(effects,[]);return 'result';},
  publishActivity:value=>effects.push(value),runPostCommitActions:async values=>effects.push(...values)};
 await assert.rejects(qualityResumeTransaction(ports),/Native commit rejected/);assert.deepEqual(effects,[]);
 commit=true;assert.equal(await qualityResumeTransaction(ports),'result');assert.deepEqual(effects,['commit','root-updated','quality-resumed','Native-action']);
});
