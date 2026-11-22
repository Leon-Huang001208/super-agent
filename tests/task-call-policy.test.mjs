import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCallLimit,remainingRootCalls,grantComplexTaskBudget} from '../bridge/task-call-policy.mjs';

function fixture(){const task={id:'root',companyId:'company',responsibleUserId:'owner',parentId:null,status:'in_review'},registry={companyId:'company',ownerId:'owner',tasks:['root'],taskRoots:{root:'root'},operations:[{id:'spent-op'}]};return{task,registry};}
function legacyGrant(registry,task){return{...registry,taskCallBudgets:{[task.id]:{rootTaskId:task.id,companyId:registry.companyId,approvedBy:registry.ownerId,maximum:12,tier:'complex',approvalSource:'original-owner-policy'}}};}
test('each new original root defaults to twenty shared calls and an explicit owner record preserves all operations',()=>{
 const {registry,task}=fixture(),before=structuredClone(registry);
 assert.equal(rootCallLimit(registry,task.id),20);
 const next=grantComplexTaskBudget(registry,{task,approvalSource:'owner-approved-twenty-calls'});
 assert.equal(next.taskCallBudgets.root.maximum,20);assert.equal(rootCallLimit(next,task.id),20);assert.equal(remainingRootCalls(next,task.id,4),16);
 assert.equal(rootCallLimit(next,'new-root'),20);assert.deepEqual(next.operations,before.operations);assert.deepEqual(registry,before);
 assert.deepEqual(grantComplexTaskBudget(next,{task,approvalSource:'repeat-approved-policy'}),next);
});
test('trusted legacy twelve-call grants remain readable and upgrade without resetting their spent calls',()=>{
 const {registry,task}=fixture(),legacy=legacyGrant(registry,task),before=structuredClone(legacy);
 assert.equal(rootCallLimit(legacy,task.id),12);assert.equal(remainingRootCalls(legacy,task.id,6),6);
 const next=grantComplexTaskBudget(legacy,{task,maximum:20,approvalSource:'owner-upgraded-to-twenty'});
 assert.equal(rootCallLimit(next,task.id),20);assert.equal(remainingRootCalls(next,task.id,6),14);
 assert.deepEqual(legacy,before);assert.deepEqual(next.operations,before.operations);assert.deepEqual(next.taskRoots,before.taskRoots);
});
test('historical seventh-QA roots keep their six-call base until the owner explicitly upgrades the same root',()=>{
 const {registry,task}=fixture();registry.qaSupplementAllowances={[task.id]:{maximum:7,approvedBy:registry.ownerId,companyId:registry.companyId,rootTaskId:task.id}};
 const before=structuredClone(registry);assert.equal(rootCallLimit(registry,task.id),6);
 const next=grantComplexTaskBudget(registry,{task,approvalSource:'owner-upgrade-original-root'});
 assert.equal(rootCallLimit(next,task.id),20);assert.deepEqual(next.qaSupplementAllowances,before.qaSupplementAllowances);assert.deepEqual(registry,before);
});
test('foreign owner/root, cancelled tasks, malformed grants and model-provided maxima cannot alter a root budget',()=>{
 const {registry,task}=fixture();
 for(const patch of [{parentId:'parent'},{companyId:'other'},{responsibleUserId:'other'},{id:'new'},{status:'cancelled'}])assert.throws(()=>grantComplexTaskBudget(registry,{task:{...task,...patch},approvalSource:'owner-policy'}),/BUDGET_DENIED/);
 const next=grantComplexTaskBudget(registry,{task,approvalSource:'owner-policy'});
 for(const patch of [{maximum:99},{maximum:6},{approvedBy:'other'},{rootTaskId:'new'},{companyId:'other'},{approvalSource:''}])assert.throws(()=>rootCallLimit({...next,taskCallBudgets:{root:{...next.taskCallBudgets.root,...patch}}},'root'),/BUDGET_DENIED/);
 assert.equal(rootCallLimit({...registry,policy:{maxRootRoleCalls:99}},'root'),20);
 for(const maximum of [6,12,21,Infinity])assert.throws(()=>grantComplexTaskBudget(registry,{task,maximum,approvalSource:'owner-policy'}),/BUDGET_DENIED/);
 assert.throws(()=>remainingRootCalls(registry,'root',-1),/BUDGET_DENIED/);
});
test('an owner-created Native root receives a twenty-call record before its first wake without creating execution history',()=>{
 const registry={companyId:'company',ownerId:'owner',tasks:[],taskRoots:{},operations:[],context:{catalog:{projects:[{projectId:'project'}]}}};
 const task={id:'root',companyId:'company',projectId:'project',responsibleUserId:'owner',createdByUserId:'owner',status:'backlog'};
 const next=grantComplexTaskBudget(registry,{task,approvalSource:'owner-approved-task'});
 assert.equal(rootCallLimit(next,'root'),20);assert.deepEqual(next.tasks,[]);assert.deepEqual(next.operations,[]);assert.deepEqual(next.taskRoots,{});
 for(const patch of [{createdByUserId:'other'},{projectId:'foreign'},{executionRunId:'active'},{assigneeAgentId:'another'},{status:'done'}])assert.throws(()=>grantComplexTaskBudget(registry,{task:{...task,...patch},approvalSource:'owner-policy'}),/BUDGET_DENIED/);
});
test('owner budget correction for an already registered done root does not reopen, wake or rewrite its history',()=>{
 const {registry,task}=fixture();task.status='done';task.summary={sha256:'old-summary'};task.notificationStatus='sent';
 const beforeTask=structuredClone(task),before=structuredClone(registry);
 const next=grantComplexTaskBudget(registry,{task,maximum:20,approvalSource:'owner-authorized-LEO-51-continuation'});
 assert.equal(next.taskCallBudgets.root.maximum,20);assert.equal(remainingRootCalls(next,'root',4),16);
 assert.deepEqual(task,beforeTask);assert.deepEqual(next.tasks,before.tasks);assert.deepEqual(next.operations,before.operations);assert.deepEqual(registry,before);
});
