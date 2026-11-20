import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {taskInputRevision} from '../bridge/task-input.mjs';

import * as context from '../bridge/team-context.mjs';
const api = name => { assert.equal(typeof context[name], 'function', name + ' is required'); return context[name]; };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const companyId=id(1), ownerId='owner-real', a=id(2), b=id(3), rootId=id(4);
const cwd = project => '/paperclip/instances/default/projects/'+companyId+'/'+project+'/_default';
const log=()=>{};
function registry() {
  const ids={chief:id(11),research:id(12),pm:id(13),qa:id(14)};
  return {companyId,ownerId,team:{projectId:a,enabled:true,ids},operations:[],
    context:{schemaVersion:1,enabled:true,catalog:{schemaVersion:1,defaultProjectKey:'alpha',projects:[
      {key:'alpha',aliases:['甲'],companyId,projectId:a,ownerId,adapterKey:'native-docs',allowedRoles:Object.keys(ids),maximumAction:'read_only',workspaceCwd:cwd(a)},
      {key:'beta',aliases:['乙'],companyId,projectId:b,ownerId,adapterKey:'rwb-docs',allowedRoles:Object.keys(ids),maximumAction:'pull_request',workspaceCwd:cwd(b)}
    ]}}};
}
const task=(projectId=a,description='Owner goal')=>({id:rootId,companyId,projectId,responsibleUserId:ownerId,title:'Goal',description,status:'in_review'});
const flow = t => ({rootTaskId:t.id,inputRevision:taskInputRevision(t),sourceRunId:id(20),projectId:t.projectId,projectKey:t.projectId===a?'alpha':'beta',workspaceCwd:cwd(t.projectId),contextVersion:1,artifacts:{}});
function native(t, control={}) {
  const events=[],archives=[],effects=[];
  const port={syncTask:async()=>({task:structuredClone(t),control:{managed:true,inputRevision:taskInputRevision(t),...control}}),
    checkpoint:async record=>{events.push(structuredClone(record));return {claimGranted:true};}};
  const coordinator=api('createTeamContextCoordinator')({...port,log,archiveFlow:async record=>archives.push(structuredClone(record))});
  return {coordinator,events,archives,effects};
}

test('scopes two Native projects without mutating the deployment default or Agent identities',()=>{
  const r=registry(),before=structuredClone(r);
  const pa=api('projectForTask')(r,task(a),{log}),pb=api('projectForTask')(r,task(b),{log});
  const sa=api('scopedRegistry')(r,pa,{log}),sb=api('scopedRegistry')(r,pb,{log});
  assert.equal(sa.team.projectId,a); assert.equal(sb.team.projectId,b);
  assert.equal(sa.team.workspaceCwd,cwd(a)); assert.equal(sb.team.workspaceCwd,cwd(b));
  assert.deepEqual(sa.team.ids,r.team.ids); assert.deepEqual(sb.team.ids,r.team.ids); assert.deepEqual(r,before);
});
test('does not let a registered operation substitute another project or workspace',()=>{
  const r=registry(),t=task(b);
  const good={id:id(31),taskId:t.id,projectId:b,projectKey:'beta',workspaceCwd:cwd(b)};
  assert.equal(api('projectForOperation')(r,good,{task:t,log}).projectId,b);
  assert.throws(()=>api('projectForOperation')(r,{...good,projectId:a},{task:t,log}),/TEAM_CONTEXT/);
  assert.throws(()=>api('projectForOperation')(r,{...good,workspaceCwd:cwd(a)},{task:t,log}),/TEAM_CONTEXT/);
});
test('keeps the legacy fixed project when context is absent but rejects malformed enabled context',()=>{
  const r=registry();delete r.context;
  assert.equal(api('projectForTask')(r,task(),{log}).projectId,a);
  assert.throws(()=>api('projectForTask')({...r,context:{schemaVersion:2,enabled:true,catalog:{}}},task(),{log}),/TEAM_CONTEXT/);
});
test('input revision changes archive the old flow and cannot dispatch its old plan',async()=>{
  const old=task(),updated=task(a,'Owner goal plus two real inputs'),oldFlow=flow(old),before=structuredClone(oldFlow);
  const env=native(updated,{reviewBeforeDispatch:true,approvedPlanSha256:'a'.repeat(64)});
  const result=await env.coordinator.dispatchPlan({registry:registry(),task:old,flow:oldFlow,runId:id(20),
    artifact:{file:'plan.json',sha256:'a'.repeat(64),text:'{}'},dispatch:async()=>env.effects.push('dispatch')});
  assert.equal(result.disposition,'superseded');assert.equal(env.archives.length,1);
  assert.deepEqual(env.archives[0].flow,before);assert.deepEqual(oldFlow,before);assert.deepEqual(env.effects,[]);
});
test('reconciles a registered dispatch even when the original root has spent all six calls',async()=>{
  let observed=0;
  const result=await api('reconcileTeamDispatch')({operation:{id:id(30)},used:6,log,
    lookupRun:async()=>{observed++;return {id:id(40)};}});
  assert.equal(result.kind,'existing');assert.equal(result.run.id,id(40));assert.equal(observed,1);
  const unknown=await api('reconcileTeamDispatch')({operation:{id:id(30)},used:6,log,lookupRun:async()=>null});
  assert.equal(unknown.kind,'unknown');
});
test('a fresh dispatch cannot reset or exceed the same root six-call budget',async()=>{
  await assert.rejects(api('reconcileTeamDispatch')({operation:null,used:6,log,lookupRun:async()=>null}),/TEAM_ROOT_BUDGET_EXHAUSTED/);
  assert.equal((await api('reconcileTeamDispatch')({operation:null,used:5,log,lookupRun:async()=>null})).kind,'new');
});
test('plan-first checkpoints the strict plan but does not dispatch until the exact SHA is approved',async()=>{
  const t=task(),f=flow(t),artifact={file:'strict-plan.json',sha256:'a'.repeat(64),bytes:2,text:'{}'};
  const env=native(t,{reviewBeforeDispatch:true,approvedPlanSha256:null});
  const denied=await env.coordinator.dispatchPlan({registry:registry(),task:t,flow:f,runId:id(20),artifact,
    dispatch:async()=>env.effects.push('child')});
  assert.equal(denied.dispatchAllowed,false);assert.equal(env.events[0].kind,'plan_ready');assert.deepEqual(env.effects,[]);
  const approved=native(t,{reviewBeforeDispatch:true,approvedPlanSha256:artifact.sha256});
  const accepted=await approved.coordinator.dispatchPlan({registry:registry(),task:t,flow:f,runId:id(20),artifact,
    dispatch:async()=>approved.effects.push('child')});
  assert.equal(accepted.dispatchAllowed,true);assert.deepEqual(approved.effects,['child']);
});
test('ordinary managed goals store plan evidence without an extra review gate or model call',async()=>{
  const t=task(),env=native(t,{reviewBeforeDispatch:false});
  const result=await env.coordinator.dispatchPlan({registry:registry(),task:t,flow:flow(t),runId:id(20),
    artifact:{file:'strict-plan.json',sha256:'a'.repeat(64),text:'{}'},dispatch:async()=>env.effects.push('child')});
  assert.equal(result.dispatchAllowed,true);assert.deepEqual(env.effects,['child']);assert.deepEqual(env.events.map(x=>x.kind),['plan_ready']);
});
test('pause or missing continue authorization never creates a model call',async()=>{
  const t=task(),env=native(t,{pauseRequested:true,resumeOperationId:id(33)});
  const result=await env.coordinator.resumePlan({registry:registry(),task:t,flow:flow(t),used:1,lookupRun:async()=>null,
    wake:async()=>env.effects.push('model')});
  assert.equal(result.runId,null);assert.deepEqual(env.effects,[]);assert.deepEqual(env.events,[]);
});
test('a Native continue uses its stable operation and reconciles replays without resetting its root budget',async()=>{
  const t=task(),operationId=id(33),r=registry(),env=native(t,{resumeOperationId:operationId});
  let calls=0,observedRun=null;
  const input={registry:r,task:t,flow:flow(t),used:3,lookupRun:async()=>observedRun,
    wake:async value=>{calls++;observedRun={id:id(41)};assert.equal(value.operationId,operationId);assert.equal(value.rootTaskId,t.id);return id(41);}};
  const started=await env.coordinator.resumePlan(input);
  assert.equal(started.runId,id(41));assert.equal(calls,1);
  assert.equal(env.events[0].artifact.operationId,operationId);
  r.operations.push({id:operationId,taskId:t.id,rootTaskId:t.id,inputRevision:taskInputRevision(t),phase:'plan',role:'chief'});
  const repeated=await env.coordinator.resumePlan({...input,used:6});
  assert.equal(repeated.runId,id(41));assert.equal(calls,1);
});
test('the same Native transaction observes an owner pause that arrived after the outer sync',async()=>{
  const t=task(),tx={marker:'locked-native-transaction'},calls=[];
  const coordinator=api('createTeamContextCoordinator')({log,archiveFlow:async()=>{},checkpoint:async()=>{},
    syncTask:async input=>{calls.push(input.transaction?.db);return {task:t,control:{managed:true,
      inputRevision:taskInputRevision(t),pauseRequested:input.transaction?.db===tx}};}});
  assert.equal(typeof coordinator.assertCurrent,'function');
  await assert.rejects(coordinator.assertCurrent({registry:registry(),task:t,flow:flow(t),transaction:{db:tx}}),/TEAM_CONTEXT_CONTROL_CHANGED/);
  assert.deepEqual(calls,[tx]);
});
test('versioned artifact archives preserve prior bytes and reject overwriting the same version',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'team-context-archive-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const old=flow(task()),next=flow(task(a,'Owner confirmed next input'));
  const first=api('writeTeamArchive')({root:directory,flow:old,name:'research.md',bytes:Buffer.from('original source'),log});
  const second=api('writeTeamArchive')({root:directory,flow:next,name:'research.md',bytes:Buffer.from('new source'),log});
  assert.notEqual(first,second);assert.equal(fs.readFileSync(first,'utf8'),'original source');
  assert.equal(api('writeTeamArchive')({root:directory,flow:old,name:'research.md',bytes:Buffer.from('original source'),log}),first);
  assert.throws(()=>api('writeTeamArchive')({root:directory,flow:old,name:'research.md',bytes:Buffer.from('replacement'),log}),/TEAM_CONTEXT_ARCHIVE_CONFLICT/);
  assert.equal(fs.readFileSync(first,'utf8'),'original source');
});
test('an M2 operation cannot silently lose its explicit project binding',()=>{
  const t=task(),operation={contextVersion:1,taskId:t.id,projectId:a,projectKey:'alpha'};
  assert.throws(()=>api('projectForOperation')(registry(),operation,{task:t,log}),/TEAM_CONTEXT_OPERATION_SCOPE_MISSING/);
});
test('a Native control reply cannot replace the locked root with another same-project task',async()=>{
  const original=task(),other={...original,id:id(80)},env=native(other);
  await assert.rejects(env.coordinator.inspect({registry:registry(),task:original,flow:flow(original)}),/TEAM_CONTEXT_NATIVE_TASK_CHANGED/);
});
test('the atomic dispatch guard requires a real approved plan SHA rather than two missing values',async()=>{
  const t=task(),env=native(t,{reviewBeforeDispatch:true});
  await assert.rejects(env.coordinator.assertCurrent({registry:registry(),task:t,
    flow:{...flow(t),reviewBeforeDispatch:true},transaction:{db:{}}}),/TEAM_CONTEXT_PLAN_APPROVAL_CHANGED/);
});
test('same-hash continue approval dispatches the existing strict plan without a new planning call',async()=>{
  const t=task(),f={...flow(t),sourceOperationId:id(21),planSha256:'a'.repeat(64)};
  const env=native(t,{reviewBeforeDispatch:true,approvedPlanSha256:f.planSha256,resumeOperationId:id(33)});
  const result=await env.coordinator.dispatchPlan({registry:registry(),task:t,flow:f,runId:id(20),
    artifact:{file:'strict-plan.json',sha256:f.planSha256,text:'{}'},dispatch:async()=>env.effects.push('child')});
  assert.equal(result.dispatchAllowed,true);assert.equal(result.disposition,'ready');assert.equal(env.archives.length,0);
  assert.deepEqual(env.effects,['child']);assert.equal(env.events.filter(x=>x.kind==='resume_claim').length,0);
});
test('fresh-session continuation includes the actual previous plan and artifacts for the same Native task',()=>{
  const old=task(),current=task(a,'Owner goal plus a correction to plan step 2');
  const f={...flow(old),planArtifact:{file:'strict-plan.json',runId:id(20),sha256:'a'.repeat(64)},
    artifacts:{research:{file:'research.md',runId:id(22),sha256:'b'.repeat(64)}}};
  const readArtifact=ref=>({text:ref.file==='strict-plan.json'?'actual previous plan':'actual prior research',sha256:ref.sha256});
  const result=api('buildTeamContinuationInput')({task:current,flow:f,readArtifact});
  assert.match(result,/actual previous plan/);assert.match(result,/actual prior research/);
  assert.match(result,RegExp(taskInputRevision(current)));assert.match(result,/fresh model session/);
  assert.throws(()=>api('buildTeamContinuationInput')({task:{...current,id:id(90)},flow:f,readArtifact}),/TEAM_CONTEXT_CONTINUATION_SCOPE_DENIED/);
});
test('a flow requiring plan approval fails closed when its Native control disappears',async()=>{
 const t=task(),f={...flow(t),reviewBeforeDispatch:true,planSha256:'a'.repeat(64)},env=native(t,{managed:false});
 await assert.rejects(env.coordinator.dispatchPlan({registry:registry(),task:t,flow:f,runId:id(20),
  artifact:{file:'strict-plan.json',sha256:f.planSha256,text:'{}'},dispatch:async()=>env.effects.push('child')}),/TEAM_CONTEXT_CONTROL_MISSING/);
 await assert.rejects(env.coordinator.assertCurrent({registry:registry(),task:t,flow:f,transaction:{db:{}}}),/TEAM_CONTEXT_CONTROL_MISSING/);
 assert.deepEqual(env.effects,[]);
});
test('a rejected Native resume claim only observes the original operation and never wakes a model',async()=>{
 const t=task(),r=registry(),effects=[];let observed,claimed=false;
 const coordinator=api('createTeamContextCoordinator')({log,archiveFlow:async()=>{},
  syncTask:async()=>({task:t,control:{managed:true,inputRevision:taskInputRevision(t),resumeOperationId:id(33)}}),
  checkpoint:async()=>{claimed=true;return {claimGranted:false};}});
 const result=await coordinator.resumePlan({registry:r,task:t,flow:flow(t),used:2,
  lookupRun:async op=>{observed=op.id;return claimed?{id:id(42)}:null;},wake:async()=>effects.push('wake')});
 assert.equal(result.runId,id(42));assert.equal(observed,id(33));assert.deepEqual(effects,[]);
});
test('an old sent notice never hides a blocked Native task with newly authorized input',async()=>{
 const old={...task(),status:'blocked'},updated=task(a,'Owner supplemental input'),f={...flow(old),notification:{status:'sent'}};
 const env=native(updated,{resumeOperationId:id(33)});let reads=0;
 const result=await api('observeTeamFlow')({registry:registry(),flow:f,context:env.coordinator,log,
  readTask:async()=>{reads++;return old;}});
 assert.equal(reads,1);assert.equal(result.disposition,'superseded');assert.equal(result.delivered,false);
 assert.equal(result.task.id,old.id);assert.equal(env.archives.length,1);
 const done={...old,status:'done'},same=native(done);
 const terminal=await api('observeTeamFlow')({registry:registry(),flow:f,context:same.coordinator,log,readTask:async()=>done});
 assert.equal(terminal.delivered,true);assert.equal(terminal.disposition,'terminal');
});
test('a selected Native project workspace ID stays in the local binding and cannot be substituted',()=>{
 const r=registry(),workspaceId=id(70);r.context.catalog.projects[1].projectWorkspaceId=workspaceId;
 const t={...task(b),projectWorkspaceId:workspaceId},project=api('projectForTask')(r,t,{log});
 const selected=api('scopedRegistry')(r,project,{log});assert.equal(selected.team.projectWorkspaceId,workspaceId);
 assert.equal(r.team.projectWorkspaceId,undefined);
 const op={contextVersion:1,taskId:t.id,projectId:b,projectKey:'beta',workspaceCwd:cwd(b),projectWorkspaceId:workspaceId};
 assert.equal(api('projectForOperation')(r,op,{task:t,log}).projectWorkspaceId,workspaceId);
 assert.throws(()=>api('projectForOperation')(r,{...op,projectWorkspaceId:id(71)},{task:t,log}),/TEAM_CONTEXT/);
});
test('an explicit pause retains the finished strict plan as evidence without dispatching',async()=>{
 const t=task(),env=native(t,{pauseRequested:true,reviewBeforeDispatch:false});
 const result=await env.coordinator.dispatchPlan({registry:registry(),task:t,flow:flow(t),runId:id(20),
  artifact:{file:'strict-plan.json',sha256:'a'.repeat(64),text:'{}'},dispatch:async()=>env.effects.push('child')});
 assert.equal(result.dispatchAllowed,false);assert.deepEqual(env.events.map(x=>x.kind),['plan_ready']);assert.deepEqual(env.effects,[]);
});
test('pending owner input holds an archived strict plan without forcing it into current Native plan state',async()=>{
 const t=task(),effects=[];const coordinator=api('createTeamContextCoordinator')({log,archiveFlow:async()=>{},
  syncTask:async()=>({task:t,control:{managed:true,inputRevision:taskInputRevision(t),pauseRequested:true,reviewBeforeDispatch:true}}),
  checkpoint:async()=>{throw Object.assign(new Error('CHIEF_CONTEXT_PENDING_INPUT'),{code:'CHIEF_CONTEXT_PENDING_INPUT'});}});
 const result=await coordinator.dispatchPlan({registry:registry(),task:t,flow:{...flow(t),reviewBeforeDispatch:true},runId:id(20),
  artifact:{file:'strict-plan.json',sha256:'a'.repeat(64),text:'{}'},dispatch:async()=>effects.push('child')});
 assert.equal(result.dispatchAllowed,false);assert.equal(result.planEvidence,'pending_input');assert.deepEqual(effects,[]);
});
test('a completed blocked stage with an unconsumed same-hash continue resumes instead of finalizing its old summary',async()=>{
 const old={...task(),status:'blocked'},current={...old,status:'in_review'};
 const f={...flow(old),sourceOperationId:id(21),summaryRunId:id(24),notification:{status:'sent'}};
 const env=native(current,{resumeOperationId:id(33),plan:null});
 const view=await api('observeTeamFlow')({registry:registry(),flow:f,context:env.coordinator,log,readTask:async()=>old});
 assert.equal(view.resumeRequired,true);assert.equal(view.delivered,false);
 const resumed=await env.coordinator.resumePlan({registry:registry(),task:current,flow:f,used:3,lookupRun:async()=>null,
  wake:async value=>{env.effects.push(value.artifactGeneration);return id(40);}});
 assert.equal(resumed.runId,id(40));assert.deepEqual(env.effects,[id(33)]);
});
test('a new plan needs three remaining calls but an existing dispatch still reconciles with a spent root',async()=>{
 const t=task(),env=native(t,{resumeOperationId:id(33)});let wakes=0,observations=0;
 await assert.rejects(env.coordinator.resumePlan({registry:registry(),task:t,flow:flow(t),used:4,
  lookupRun:async()=>{observations++;return null;},wake:async()=>{wakes++;}}),/TEAM_CONTEXT_REPLAN_BUDGET_EXHAUSTED/);
 assert.equal(observations,1);assert.equal(wakes,0);assert.equal(env.events.filter(x=>x.kind==='resume_claim').length,0);
 const r=registry();r.operations.push({id:id(33),taskId:t.id,rootTaskId:t.id,inputRevision:taskInputRevision(t),role:'chief',phase:'plan'});
 const existing=await env.coordinator.resumePlan({registry:r,task:t,flow:flow(t),used:6,lookupRun:async()=>({id:id(40)}),wake:async()=>{wakes++;}});
 assert.equal(existing.runId,id(40));assert.equal(wakes,0);
});
test('a later Native plan generation retires old same-hash flow evidence without another summary or model',async()=>{
 const t=task(),f={...flow(t),sourceOperationId:id(21),summaryRunId:id(24),notification:{status:'sent'}};
 const env=native(t,{resumeOperationId:null,plan:{inputRevision:taskInputRevision(t),runId:id(50),sourceOperationId:id(33)}});
 const view=await api('observeTeamFlow')({registry:registry(),flow:f,context:env.coordinator,log,readTask:async()=>t});
 assert.equal(view.disposition,'retired');assert.equal(view.resumeRequired,false);assert.equal(env.archives.length,1);
});
test('artifact names separate generations of the same root and input while keeping legacy names',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'team-generation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input={taskId:rootId,inputRevision:'a'.repeat(64)};
 const original=api('teamArtifactNames')(input),first=api('teamArtifactNames')({...input,generationId:id(33)}),next=api('teamArtifactNames')({...input,generationId:id(34)});
 assert.equal(original.summaryFile,'team-'+rootId+'-summary.md');assert.notEqual(first.planFile,next.planFile);assert.notEqual(first.summaryFile,next.summaryFile);
 fs.writeFileSync(path.join(root,first.summaryFile),'old final');fs.writeFileSync(path.join(root,next.summaryFile),'new final');
 assert.equal(fs.readFileSync(path.join(root,first.summaryFile),'utf8'),'old final');assert.ok(first.outputPrefix.startsWith('team-'+rootId+'-'));
});
