import{taskInputRevision}from'../bridge/task-input.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{settleNativeRole}from'../bridge/role-native-settlement.mjs';
test('successful role settles Native completion and durable handoff; changed input and failure never claim completion',async()=>{
 const binding={taskId:'t',companyId:'c',projectId:'p',ownerId:'u',agentId:'a',runId:'r',inputRevision:taskInputRevision({description:'goal'})};
 const task={id:'t',companyId:'c',projectId:'p',responsibleUserId:'u',assigneeAgentId:'a',description:'goal',status:'in_progress',executionRunId:'r',checkoutRunId:null};
 const run={id:'r',agentId:'a',status:'running'};
 let writes=[];const transaction=async fn=>fn({lock:async()=>({task,run}),addCompletion:async(...args)=>writes.push(['comment',...args]),handBack:async(...args)=>writes.push(['handoff',...args])});
 const base={binding,transaction,log(){},result:{exitCode:0,summary:'actual role artifact'}};
 await settleNativeRole(base);assert.deepEqual(writes.map(x=>x[0]),['comment','handoff']);assert.equal(writes[1][2].assigneeUserId,'u');
 writes=[];task.description='changed';await assert.rejects(settleNativeRole(base),/NATIVE_ROLE_SETTLEMENT_CHANGED/);assert.equal(writes.length,0);
 await settleNativeRole({...base,result:{exitCode:1}});assert.equal(writes.length,0);
 task.description='goal';
 for(const status of ['done','cancelled','in_review']){task.status=status;await assert.rejects(settleNativeRole(base),/NATIVE_ROLE_SETTLEMENT_CHANGED/);assert.equal(writes.length,0);}
 task.status='in_progress';task.executionRunId='other-run';await assert.rejects(settleNativeRole(base),/NATIVE_ROLE_SETTLEMENT_CHANGED/);assert.equal(writes.length,0);
 task.executionRunId='r';run.status='cancelled';await assert.rejects(settleNativeRole(base),/NATIVE_ROLE_SETTLEMENT_CHANGED/);assert.equal(writes.length,0);
});
