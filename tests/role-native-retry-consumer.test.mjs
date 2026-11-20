import test from 'node:test';
import assert from 'node:assert/strict';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {selectQueuedNativeRoleRetry,consumeQueuedNativeRoleRetry} from '../bridge/role-native-retry-consumer.mjs';

function fixture(){
 const root={id:'root',companyId:'company',projectId:'project',title:'Goal',description:'Original scope',status:'in_review',responsibleUserId:'owner',assigneeUserId:'owner',assigneeAgentId:null};
 const task={id:'child',parentId:root.id,companyId:'company',projectId:'project',title:'Work',description:'Child scope',status:'in_progress',responsibleUserId:'owner',assigneeAgentId:'agent'};
 const operation={id:'operation',kind:'run',phase:'work',role:'backend-engineer',taskId:task.id,rootTaskId:root.id,projectId:'project',agentId:'agent',inputRevision:taskInputRevision(task),rootInputRevision:taskInputRevision(root)};
 const registry={companyId:'company',ownerId:'owner',team:{enabled:true,ids:{'backend-engineer':'agent'}},agents:[{profile:{role:'backend-engineer',agentId:'agent'}}],lease:{taskId:task.id,projectId:'project',operationId:operation.id,nonce:'original-nonce'},tasks:[root.id,task.id],taskRoots:{root:root.id,child:root.id},operations:[operation]};
 const parentRun={id:'failed-parent',companyId:'company',agentId:'agent',issueId:task.id,status:'failed'};
 const run={id:'existing-native-retry',companyId:'company',agentId:'agent',issueId:task.id,responsibleUserId:'owner',status:'queued',retryOfRunId:parentRun.id,scheduledRetryAttempt:1};
 return {registry,activeRuns:[run],parentRun,tasks:[root,task]};
}

test('only the unique queued retry of the current registered work step is selected',()=>{
 const f=fixture(),before=structuredClone(f);
 assert.deepEqual(selectQueuedNativeRoleRetry(f),{companyId:'company',agentId:'agent',runId:'existing-native-retry',taskId:'child',rootTaskId:'root'});
 assert.deepEqual(f,before);
});
test('scheduled, foreign, ambiguous and stale work remains untouched',async()=>{
 const mutations=[f=>{f.registry.team.enabled=false;},f=>{f.activeRuns[0].status='scheduled_retry';},f=>{f.activeRuns[0].status='running';},f=>{f.activeRuns.push({...f.activeRuns[0],id:'other',status:'running'});},
  f=>{f.activeRuns[0].retryOfRunId='foreign-parent';},f=>{f.activeRuns[0].agentId='other';},f=>{f.activeRuns[0].companyId='other';},f=>{f.activeRuns[0].issueId='other';},f=>{f.activeRuns[0].scheduledRetryAttempt=3;},f=>{f.activeRuns[0].responsibleUserId='other';},f=>{f.parentRun=null;},
  f=>{f.registry.lease.operationId='foreign';},f=>{f.registry.operations[0].phase='plan';},f=>{f.registry.operations[0].role='chief';},f=>{f.registry.taskRoots.child='other';},f=>{f.registry.agents=[];},
  f=>{f.tasks[0].status='cancelled';},f=>{f.tasks[0].description='new scope';},f=>{f.tasks[1].description='changed';},f=>{f.tasks[1].projectId='other';},f=>{f.tasks[1].responsibleUserId='other';},f=>{f.tasks[1]=null;}];
 for(const change of mutations){const f=fixture();change(f);let calls=0;assert.equal(selectQueuedNativeRoleRetry(f),null);assert.equal(await consumeQueuedNativeRoleRetry({...f,resume:async()=>{calls++;},log(){}}),false);assert.equal(calls,0);}
});
test('the existing Native consumer receives company and agent, while run identity is verified',async()=>{
 const f=fixture(),before=structuredClone(f),calls=[],events=[];
 assert.equal(await consumeQueuedNativeRoleRetry({...f,resume:async(...args)=>{calls.push(args);return [{id:f.activeRuns[0].id}];},log:e=>events.push(e)}),true);
 assert.deepEqual(calls,[['company','agent']]);assert.equal(events[0].runId,'existing-native-retry');assert.deepEqual(f,before);
});
test('Native suppression keeps the queued row; unexpected claims fail visibly without correction',async()=>{
 const f=fixture();assert.equal(await consumeQueuedNativeRoleRetry({...f,resume:async()=>[],log(){}}),true);
 const events=[];await assert.rejects(consumeQueuedNativeRoleRetry({...f,resume:async()=>[{id:'other'}],log:e=>events.push(e)}),/TEAM_NATIVE_RETRY_CONSUMER_SCOPE_CHANGED/);
 assert.equal(events[0].status,'unknown');
 await assert.rejects(consumeQueuedNativeRoleRetry({...f,resume:async()=>{throw Error('Native consumer failed');},log(){}}),/Native consumer failed/);
});
