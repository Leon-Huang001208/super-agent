import test from 'node:test';
import assert from 'node:assert/strict';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {teamChildOperation,qaReviewedArtifacts,qaRepairOutputFile,planQaRepair,beginQaRepair,advanceQaRepair,qaRepairStep,validateQaRepairReopen,driveQaRepair} from '../bridge/team-qa-repair.mjs';
import {validateTeamQaResult} from '../bridge/team-plan.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(){
 const rootTaskId=id(1),companyId=id(2),projectId=id(3),ownerId='owner',inputRevision='a'.repeat(64);
 const task=(key,n,role)=>({key,id:id(n),agentId:id(n+10),role,title:key,goal:'Original '+key,outputFile:'team-'+rootTaskId+'-'+key+(role==='qa'?'.json':'.md'),dependsOn:role==='qa'?['backend']:[]});
 const entries=[task('backend',4,'backend-engineer'),task('quality',5,'qa')];
 const tasks=entries.map(entry=>({id:entry.id,parentId:rootTaskId,companyId,projectId,title:entry.title,description:entry.goal,status:'done',responsibleUserId:ownerId,assigneeUserId:ownerId,assigneeAgentId:null,executionRunId:null,checkoutRunId:null}));
 const operations=entries.map((entry,i)=>({id:id(i+20),kind:'run',taskId:entry.id,agentId:entry.agentId,rootTaskId,rootInputRevision:inputRevision,projectId,role:entry.role,phase:'work',inputRevision:taskInputRevision(tasks[i])}));
 const artifacts=Object.fromEntries(entries.map((entry,i)=>[entry.key,{taskId:entry.id,runId:id(i+30),sessionId:'session-'+i,file:entry.outputFile,sha256:String(i+1).repeat(64),bytes:200,...(entry.role==='qa'?{verdict:'NEEDS_WORK'}:{})}]));
 operations[1].reviewedArtifacts=[structuredClone(artifacts.backend)];
 operations[1].codeCandidate={taskId:entries[0].id,runId:artifacts.backend.runId,candidateSha:'c'.repeat(40)};
 const flow={rootTaskId,projectId,inputRevision,taskEntries:entries,artifacts,dispatches:Object.fromEntries(operations.map((op,i)=>[entries[i].key,{operationId:op.id,taskId:op.taskId,inputRevision:op.inputRevision}])),codeReview:{verdict:'PASS',candidateSha:'old'}};
 const registry={companyId,ownerId,operations};
 const runs=entries.map((entry,i)=>({id:id(i+30),issueId:entry.id,agentId:entry.agentId,companyId,status:'succeeded',finishedAt:'2026-11-20T15:00:00Z'}));
 const leases=runs.map(run=>({heartbeatRunId:run.id,status:'released',releasedAt:'2026-11-20T15:00:01Z',cleanupStatus:null}));
 let serial=50;const newId=()=>id(serial++);
 return{registry,flow,tasks,operations,runs,leases,newId};
}
const archiveArtifact=value=>({...value,archiveFile:'/archive/'+value.runId+'-'+value.file});

test('ordinary successful NEEDS_WORK repairs the original executor then reviews in a fresh round',()=>{
 const f=fixture(),before=structuredClone(f.flow);
 const decision=planQaRepair({...f,used:3,newId:f.newId});assert.equal(decision.kind,'repair');
 let flow=beginQaRepair(f.flow,decision.repair,{archiveArtifact});assert.deepEqual(f.flow,before);
 assert.equal(flow.codeReview,undefined);assert.deepEqual(flow.artifacts,{});assert.deepEqual(flow.dispatches,{});
 assert.equal(flow.taskEntries[0].id,f.tasks[0].id);assert.equal(flow.taskEntries[1].id,f.tasks[1].id);
 assert.equal(validateQaRepairReopen({...f,flow}).length,2);
 const fix=qaRepairStep(flow,flow.taskEntries[0]);assert.equal(fix.operationId,id(50));assert.match(fix.outputFile,/-fix-r1\.md$/);
 assert.equal(fix.qualityRepair.phase,'fix');assert.equal(fix.qualityRepair.sourceQaRunId,before.artifacts.quality.runId);
 assert.equal(fix.retryOfRunId,undefined);
 flow.qaRepair.nativePrepared=true;
 flow.artifacts.backend={...before.artifacts.backend,file:fix.outputFile,runId:id(60),sha256:'e'.repeat(64)};
 flow=advanceQaRepair(flow);assert.equal(flow.qaRepair.stage,'review');
 const recheck=qaRepairStep(flow,flow.taskEntries[1]);assert.equal(recheck.operationId,id(51));assert.match(recheck.outputFile,/-qa-r1\.json$/);
 assert.deepEqual(qaReviewedArtifacts(flow).map(ref=>ref.runId),[id(60)]);
 flow.artifacts.quality={...before.artifacts.quality,runId:id(61),file:recheck.outputFile,verdict:'PASS',sha256:'f'.repeat(64)};
 flow=advanceQaRepair(flow);assert.equal(flow.qaRepair.stage,'complete');assert.equal(flow.qaRepairHistory.length,1);
 assert.equal(flow.qaRepairHistory[0].sourceQa.runId,before.artifacts.quality.runId);
 assert.equal(flow.qaRepairHistory[0].result.runId,id(61));assert.equal(planQaRepair({...f,flow,used:5}).kind,'none');
 assert.deepEqual(advanceQaRepair(flow),flow);assert.deepEqual(f.flow,before);
});

test('collection uses the exact flow operation instead of a later operation from another generation',()=>{
 const f=fixture(),entry=f.flow.taskEntries[0],current=f.operations[0];
 f.operations.push({...current,id:id(99),rootInputRevision:'f'.repeat(64)});
 assert.equal(teamChildOperation({flow:f.flow,entry,operations:f.operations}).id,current.id);
 const changed=structuredClone(f.flow);changed.dispatches.backend.operationId=id(99);
 assert.throws(()=>teamChildOperation({flow:changed,entry,operations:f.operations}),/TEAM_CHILD_OPERATION_CHANGED/);
 f.operations=f.operations.slice(1);
 assert.throws(()=>teamChildOperation({flow:f.flow,entry,operations:f.operations}),/TEAM_DISPATCH_RECONCILIATION_REQUIRED/);
 assert.equal(teamChildOperation({flow:{...f.flow,dispatches:{}},entry,operations:f.operations}),null);
});

test('reserve one fix, independent recheck, remaining roles and summary without resetting spent calls',()=>{
 const f=fixture();assert.equal(planQaRepair({...f,used:3,newId:f.newId}).kind,'repair');
 for(const used of [4,5,6])assert.equal(planQaRepair({...f,used,newId:f.newId}).code,'TEAM_QA_REPAIR_BUDGET_EXHAUSTED');
 assert.equal(planQaRepair({...f,used:7,maximum:12,newId:f.newId}).kind,'repair');
 f.flow.taskEntries.push({key:'publish',role:'devops',dependsOn:['quality']});
 assert.equal(planQaRepair({...f,used:3,newId:f.newId}).code,'TEAM_QA_REPAIR_BUDGET_EXHAUSTED');
 assert.equal(planQaRepair({...f,used:7,maximum:12,newId:f.newId}).kind,'repair');
 f.operations.push({rootTaskId:f.flow.rootTaskId,qualityRepair:{round:2}});
 assert.equal(planQaRepair({...f,used:7,maximum:12,newId:f.newId}).code,'TEAM_QA_REPAIR_LIMIT');
});

test('unknown/current Native bindings and unsettled runs never reopen or manufacture a retry',()=>{
 const mutations=[f=>{f.operations.pop();},f=>{f.tasks[0].description='owner changed';},f=>{f.tasks[0].status='in_progress';},
  f=>{f.tasks[0].responsibleUserId='other';},f=>{f.runs[0].status='running';},f=>{f.runs.push({...f.runs[0],id:id(99),status:'scheduled_retry'});},
  f=>{f.leases[0].releasedAt=null;},f=>{f.leases[0].status='active';},f=>{f.leases[0].cleanupStatus='failed';},f=>{f.leases=[];}];
 for(const mutate of mutations){const f=fixture(),decision=planQaRepair({...f,used:3,newId:f.newId}),flow=beginQaRepair(f.flow,decision.repair,{archiveArtifact});mutate(f);
  assert.throws(()=>validateQaRepairReopen({...f,flow}),/TEAM_QA_REPAIR_(REOPEN_CHANGED|EXECUTION_UNSETTLED)/);}
 const f=fixture(),decision=planQaRepair({...f,used:3,newId:f.newId}),flow=beginQaRepair(f.flow,decision.repair,{archiveArtifact});
 assert.throws(()=>beginQaRepair(flow,decision.repair,{archiveArtifact}),/ALREADY_PENDING/);
 assert.deepEqual(advanceQaRepair(flow),flow);
 f.tasks.forEach(task=>{task.status='todo';});assert.equal(validateQaRepairReopen({...f,flow}).length,2);
});

test('a later repair round counts prior original-root operations even after flow replacement',()=>{
 const f=fixture();f.operations.push({rootTaskId:f.flow.rootTaskId,qualityRepair:{round:1}});
 const next=planQaRepair({...f,used:6,maximum:12,newId:f.newId});assert.equal(next.repair.round,2);assert.match(next.repair.targetOutputFile,/-fix-r2\.md$/);
 f.operations.push({rootTaskId:f.flow.rootTaskId,qualityRepair:{round:2}});
 assert.equal(planQaRepair({...f,used:7,maximum:12,newId:f.newId}).code,'TEAM_QA_REPAIR_LIMIT');
});

test('non-code tasks resolve only a unique reviewed executor or explicit reviewed repair task',()=>{
 const f=fixture();delete f.operations[1].codeCandidate;
 assert.equal(planQaRepair({...f,used:3,newId:f.newId}).repair.targetKey,'backend');
 f.flow.artifacts.quality.repairTaskKey='not-reviewed';assert.equal(planQaRepair({...f,used:3,newId:f.newId}).code,'TEAM_QA_REPAIR_TARGET_REQUIRED');
 f.flow.artifacts.quality.repairTaskKey='backend';assert.equal(planQaRepair({...f,used:3,newId:f.newId}).kind,'repair');
 const inherited={...f.flow.artifacts.backend,taskId:id(90),runId:id(91)};f.flow.taskEntries.push({key:'docs',role:'document-specialist',id:id(90),dependsOn:['backend']});f.flow.artifacts.docs=inherited;
 assert.equal(planQaRepair({...f,used:3,newId:f.newId}).code,'TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED');
});

test('QA recheck never includes a prior QA artifact as a reviewed input',()=>{
 const f=fixture();assert.deepEqual(qaReviewedArtifacts(f.flow),[f.flow.artifacts.backend]);
 assert.match(qaRepairOutputFile({...f.flow.taskEntries[0],outputFile:'a'.repeat(111)+'.md'},2),/-fix-r2\.md$/);
 assert.throws(()=>qaRepairOutputFile(f.flow.taskEntries[0],3),/OUTPUT_DENIED/);
});

test('coordinator driver reopens, wakes, collects, rechecks and releases PASS to the existing summary path',async()=>{
 const f=fixture(),originalTasks=structuredClone(f.tasks),events=[],calls=[],finished=new Map();let flow=f.flow;
 const ports={save:async value=>{flow=structuredClone(value);},reopen:async value=>{
  validateQaRepairReopen({...f,flow:value});events.push('reopen-original-children');f.tasks.forEach(task=>{task.status='todo';});
 },block:async()=>assert.fail('repair fits the original budget'),
  collect:async(value,entry)=>{
   const op=teamChildOperation({flow:value,entry,operations:f.operations});if(!op||!finished.has(op.id))return false;
   const result=finished.get(op.id);
   if(entry.role==='qa')validateTeamQaResult(result.review,{reviewedArtifacts:op.reviewedArtifacts,codeCandidate:op.codeCandidate});
   value.artifacts[entry.key]={taskId:entry.id,runId:result.runId,sessionId:result.sessionId,file:op.outputFile,sha256:result.sha256,
    ...(entry.role==='qa'?{verdict:result.review.verdict}:{})};
   f.tasks.find(task=>task.id===entry.id).status='done';events.push('collect-'+entry.key);return true;
  },dispatch:async(value,entry,step)=>{
   const task=f.tasks.find(task=>task.id===entry.id);if(task.status!=='todo')return;
   // The real runtime's wake port observes an existing or unknown dispatch instead of dispatching again.
   if(value.dispatches[entry.key])return;
   const op={...f.operations.find(operation=>operation.taskId===entry.id),id:step.operationId,outputFile:entry.outputFile,qualityRepair:step.qualityRepair};
   if(entry.role==='qa'){op.reviewedArtifacts=qaReviewedArtifacts(value);op.codeCandidate={...op.codeCandidate,candidateSha:'d'.repeat(40)};}
   f.operations.push(op);value.dispatches[entry.key]={operationId:op.id,inputRevision:op.inputRevision};
   calls.push({operationId:op.id,taskId:task.id,role:entry.role,sessionId:'fresh-'+op.id});events.push('wake-'+entry.key);
   await ports.save(value);
  }};
 const tick=()=>driveQaRepair({flow,operations:f.operations,used:3+calls.length,maximum:6,archiveArtifact,ports,newId:f.newId});
 assert.equal((await tick()).handled,true);assert.deepEqual(events,['reopen-original-children']);
 await tick();assert.equal(calls.length,1);assert.equal(calls[0].taskId,originalTasks[0].id);
 await tick();assert.equal(calls.length,1,'unknown run receipt must not create another physical call');
 finished.set(calls[0].operationId,{runId:id(70),sessionId:calls[0].sessionId,sha256:'e'.repeat(64)});
 await tick();assert.ok(flow.artifacts.backend);assert.equal(calls.length,1);
 await tick();assert.equal(calls.length,2);assert.equal(calls[1].taskId,originalTasks[1].id);assert.notEqual(calls[0].sessionId,calls[1].sessionId);
 const reviewOp=f.operations.at(-1);assert.deepEqual(reviewOp.reviewedArtifacts.map(ref=>ref.runId),[id(70)]);
 finished.set(calls[1].operationId,{runId:id(71),sessionId:calls[1].sessionId,sha256:'f'.repeat(64),review:{verdict:'PASS',findings:[],notRun:[],reviewedArtifacts:reviewOp.reviewedArtifacts,reviewedCandidateSha:reviewOp.codeCandidate.candidateSha}});
 await tick();const released=await tick();assert.equal(released.handled,false);assert.equal(flow.qaRepair.stage,'complete');
 events.push('existing-summary');assert.deepEqual(events,['reopen-original-children','wake-backend','collect-backend','wake-quality','collect-quality','existing-summary']);
 assert.equal(3+calls.length+1,6);assert.deepEqual(f.tasks.map(task=>[task.id,task.title,task.description]),originalTasks.map(task=>[task.id,task.title,task.description]));
 assert.equal(flow.qaRepairHistory[0].sourceQa.runId,f.flow.artifacts.quality.runId);
});

test('a missing dispatch operation stays reconciliation-only in the driver and cannot emit a new wake',async()=>{
 const f=fixture(),decision=planQaRepair({...f,used:3,newId:f.newId}),flow=beginQaRepair(f.flow,decision.repair,{archiveArtifact});
 flow.qaRepair.nativePrepared=true;flow.dispatches.backend={operationId:decision.repair.fixOperationId,inputRevision:f.operations[0].inputRevision};let dispatched=0;
 await assert.rejects(driveQaRepair({flow,operations:f.operations,used:4,maximum:6,archiveArtifact,
  ports:{save:async()=>{},reopen:async()=>assert.fail('already prepared'),block:async()=>assert.fail('not blocked'),
   collect:async(current,entry)=>Boolean(teamChildOperation({flow:current,entry,operations:f.operations})),dispatch:async()=>{dispatched++;}}}),/TEAM_DISPATCH_RECONCILIATION_REQUIRED/);
 assert.equal(dispatched,0);
});
