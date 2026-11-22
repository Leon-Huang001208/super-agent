import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {selectQueuedNativeRoleRetry,consumeQueuedNativeRoleRetry} from '../bridge/role-native-retry-consumer.mjs';
import {startTeamCoordinator} from '../bridge/team-native-runtime.mjs';

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

test('the actual coordinator consumes the existing second retry using its Native parent rather than the operation initial wake',async t=>{
 const R='/paperclip/control/research-pm',temporary=fs.mkdtempSync(path.join(os.tmpdir(),'queued-parent-'));
 t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 let blockIdleCleanup=false;
 const mapped=file=>typeof file==='string'&&(file===R||file.startsWith(R+'/'))?temporary+file.slice(R.length):file;
 for(const name of ['mkdirSync','lstatSync','existsSync','readFileSync','appendFileSync']){
  const original=fs[name];t.mock.method(fs,name,(file,...args)=>name==='existsSync'&&file===R+'/call.lock'&&blockIdleCleanup?true:original(mapped(file),...args));
 }
 const f=fixture(),initial={...f.parentRun,id:'initial-bootstrap-f9'},retry=f.activeRuns[0];
 retry.scheduledRetryAttempt=2;retry.retryOfRunId=f.parentRun.id;
 const heartbeatRuns={id:'id',status:'status'},agentWakeupRequests={idempotencyKey:'idempotencyKey'},lookups=[],resumes=[];
 const orm={eq:(field,value)=>({kind:'eq',field,value}),inArray:(field,values)=>({kind:'in',field,values})};
 let mode='normal';
 const db={select:()=>({from:table=>({where:async condition=>{
  if(table===heartbeatRuns){
   if(condition.kind==='in')return mode==='ambiguous'?[retry,{...retry,id:'another-active-run'}]:[retry];
   lookups.push(condition.value);
   if(condition.value===f.parentRun.id){if(mode==='db-error')throw Object.assign(Error('Native parent read failed'),{code:'DB_READ_FAILED'});if(mode==='missing')return [];return [{...f.parentRun,...(mode==='foreign'?{issueId:'another-child'}:{})}];}
   return condition.value===initial.id?[initial]:[];
  }
  assert.equal(table,agentWakeupRequests);return condition.value==='team-operation:'+f.registry.operations[0].id?[{runId:initial.id}]:[];
 }})})};
 fs.writeFileSync(path.join(temporary,'registry.json'),JSON.stringify(f.registry),{mode:0o600});
 const before=structuredClone(f),coordinator=startTeamCoordinator({database:()=>{throw Error('unexpected direct Native access');},nativePorts:async()=>({db,schema:{heartbeatRuns,agentWakeupRequests},orm,
  issue:{getById:async id=>f.tasks.find(task=>task.id===id)},heartbeat:{resumeQueuedRunsForAgent:async(...args)=>{resumes.push(args);retry.status='running';return [{id:retry.id}];}}})});
 t.after(()=>coordinator.stop());
 await Promise.all([coordinator.tick(),coordinator.tick()]);
 assert.deepEqual(resumes,[[f.registry.companyId,retry.agentId]]);assert.deepEqual(lookups,[f.parentRun.id]);
 assert.equal(fs.existsSync(path.join(temporary,'operations')),false);assert.equal(fs.existsSync(path.join(temporary,'budget')),false);
 assert.equal(f.registry.operations[0].acceptedRunId,undefined);assert.equal(initial.id!==f.parentRun.id,true);
 assert.deepEqual(f.registry,before.registry);
 // Hold unrelated idle cleanup while exercising the unchanged selection rejection paths.
 blockIdleCleanup=true;
 for(const rejected of ['missing','foreign','db-error','ambiguous']){mode=rejected;retry.status='queued';const count=resumes.length;await coordinator.tick();assert.equal(resumes.length,count,rejected);}
 mode='normal';retry.status='scheduled_retry';await coordinator.tick();assert.equal(resumes.length,1);
 const events=fs.readFileSync(path.join(temporary,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(event=>event.code==='TEAM_NATIVE_RETRY_CONSUMER_RESUMED').length,1);
 assert.equal(events.some(event=>event.code==='TEAM_RUNTIME_FAILED'),true,'Native parent read errors are retained without dispatch');
});
