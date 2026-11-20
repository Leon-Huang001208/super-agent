import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCEPTANCE_ROLES,acceptanceOptions,createAcceptanceReceipt,assertReceiptRegistry,assertAcceptanceStep,appendAcceptanceOperation} from '../scripts/native-skills-acceptance.mjs';

function fixture(){
 let next=0;const uuid=()=>String(++next).padStart(8,'0')+'-0000-4000-8000-000000000000';
 const projectId=uuid(),taskId=uuid(),ids=Object.fromEntries(ACCEPTANCE_ROLES.map(role=>[role,uuid()]));
 const registry={enabled:true,companyId:uuid(),ownerId:'owner',projectId,taskId,team:{enabled:false,projectId,ids},tasks:[taskId],taskRoots:{[taskId]:taskId},operations:[{id:uuid(),kind:'run',taskId}],lease:{taskId,projectId,nonce:'old-nonce'},agents:ACCEPTANCE_ROLES.map(role=>({profile:{role,projectId,agentId:ids[role],executionPolicy:{executor:'macos_native'}}}))};
 const receipt=createAcceptanceReceipt(registry,{uuid});receipt.initialized=true;
 return {registry,receipt,uuid};
}
test('all default/status/preview requests stay read-only and role selection is explicit',()=>{
 assert.deepEqual(acceptanceOptions([]),{action:'status',role:null,apply:false});
 assert.equal(acceptanceOptions(['--init']).apply,false);
 assert.equal(acceptanceOptions(['--apply','--preview','--role','research']).apply,false);
 assert.equal(acceptanceOptions(['--apply','--status','--role','research']).apply,false);
 assert.deepEqual(acceptanceOptions(['--role','qa','--apply']),{action:'role',role:'qa',apply:true});
 for(const args of [['--apply','--init','--role','qa'],['--role','chief'],['--role'],['--reconcile','--init'],['--role','qa','--role','pm'],['--all']])assert.throws(()=>acceptanceOptions(args),/NATIVE_ACCEPTANCE_/);
});
test('a fresh private receipt has six fixed unique child and operation identities under a separate root',()=>{
 const {registry,receipt}=fixture();assert.equal(receipt.maximumCalls,6);assert.equal(receipt.originalTaskId,registry.taskId);
 assert.notEqual(receipt.rootTaskId,registry.taskId);assert.deepEqual(receipt.steps.map(s=>s.role),ACCEPTANCE_ROLES);
 assert.equal(new Set([receipt.rootTaskId,...receipt.steps.flatMap(s=>[s.taskId,s.operationId])]).size,13);
 assert.ok(receipt.steps.every(s=>s.files.every(f=>f.startsWith(receipt.artifactDirectory+'/'))));
 assert.equal(receipt.steps[2].files.length,2);
});
test('appending one operation preserves original root, lease object, team flag and all history',()=>{
 const {registry,receipt}=fixture(),before=structuredClone(registry),step=receipt.steps[0];
 const operation={id:step.operationId,taskId:step.taskId,rootTaskId:receipt.rootTaskId,kind:'run',role:step.role};
 const updated=appendAcceptanceOperation(registry,receipt,operation,{nonce:'new-nonce'});
 assert.deepEqual(registry,before);assert.equal(updated.taskId,before.taskId);assert.equal(updated.team.enabled,false);
 assert.deepEqual(updated.operations.slice(0,-1),before.operations);assert.deepEqual(updated.operations.at(-1),operation);
 assert.equal(updated.tasks.length,before.tasks.length+7);assert.equal(updated.taskRoots[before.taskId],before.taskId);
 for(const id of [receipt.rootTaskId,...receipt.steps.map(s=>s.taskId)])assert.equal(updated.taskRoots[id],receipt.rootTaskId);
 assert.equal(updated.lease.taskId,step.taskId);assert.equal(updated.lease.operationId,step.operationId);
 assert.throws(()=>appendAcceptanceOperation(updated,receipt,operation,{nonce:'new-nonce'}),/ALREADY_EXISTS/);
});
test('any active Native run, call lock or actual admission lease blocks launch',()=>{
 const {receipt}=fixture(),base={receipt,role:'research',budgetCount:0};assert.equal(assertAcceptanceStep(base).role,'research');
 for(const extra of [{activeRuns:[{id:'other'}]},{callLock:true},{admissionLeases:[{task_id:'old'}]}])assert.throws(()=>assertAcceptanceStep({...base,...extra}),/NATIVE_ACCEPTANCE_BUSY/);
});
test('all six calls share the root cap and required role order',()=>{
 const {receipt}=fixture();assert.throws(()=>assertAcceptanceStep({receipt,role:'pm',budgetCount:0}),/PREDECESSOR/);
 for(let index=0;index<6;index++){
  const role=ACCEPTANCE_ROLES[index];assert.equal(assertAcceptanceStep({receipt,role,budgetCount:index}).role,role);
  receipt.steps[index].status='succeeded';receipt.steps[index].artifacts=[{sha256:'a'.repeat(64)}];
 }
 receipt.steps[5].status='NOT_RUN';assert.throws(()=>assertAcceptanceStep({receipt,role:ACCEPTANCE_ROLES[5],budgetCount:6}),/BUDGET_EXHAUSTED/);
});
test('a failed, unknown, reserved or already woken role never launches another attempt',()=>{
 for(const patch of [{status:'failed'},{status:'RESULT_UNKNOWN'},{status:'RESERVED'},{wakeAttemptedAt:'now'},{runId:'old-run'}]){
  const {receipt}=fixture();Object.assign(receipt.steps[0],patch);assert.throws(()=>assertAcceptanceStep({receipt,role:'research',budgetCount:0}),/ALREADY_ATTEMPTED/);
 }
});
test('receipt identity, existing Agent identity and coordinator state cannot drift',()=>{
 for(const change of [r=>r.taskId='other',r=>r.ownerId='other',r=>r.team.enabled=true,r=>r.team.ids.qa='other']){
  const {registry,receipt}=fixture();change(registry);assert.throws(()=>assertReceiptRegistry(registry,receipt),/NATIVE_ACCEPTANCE_/);
 }
 const {registry}=fixture();registry.agents[0].profile.executionPolicy.executor='docker';assert.throws(()=>createAcceptanceReceipt(registry),/AGENT_NOT_READY/);
});
