import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCallLimit,remainingRootCalls,grantComplexTaskBudget} from '../bridge/task-call-policy.mjs';

function fixture(){const task={id:'root',companyId:'company',responsibleUserId:'owner',parentId:null,status:'in_review'},registry={companyId:'company',ownerId:'owner',tasks:['root'],taskRoots:{root:'root'},operations:[{id:'spent-op'}]};return{task,registry};}
test('complex tier extends the same original root without changing past operations or default policy',()=>{
 const {registry,task}=fixture(),before=structuredClone(registry);
 assert.equal(rootCallLimit(registry,task.id),6);
 const next=grantComplexTaskBudget(registry,{task,approvalSource:'owner-approved-task-tier-policy-20261121'});
 assert.equal(rootCallLimit(next,task.id),12);assert.equal(remainingRootCalls(next,task.id,6),6);
 assert.equal(rootCallLimit(next,'new-root'),6);assert.deepEqual(next.operations,before.operations);assert.deepEqual(registry,before);
 assert.deepEqual(grantComplexTaskBudget(next,{task,approvalSource:'repeat-approved-policy'}),next);
});
test('foreign owner/root, terminal tasks, malformed grants and model-provided maxima cannot inflate a root',()=>{
 const {registry,task}=fixture();
 for(const patch of [{parentId:'parent'},{companyId:'other'},{responsibleUserId:'other'},{id:'new'},{status:'done'}])assert.throws(()=>grantComplexTaskBudget(registry,{task:{...task,...patch},approvalSource:'owner-policy'}),/BUDGET_DENIED/);
 const next=grantComplexTaskBudget(registry,{task,approvalSource:'owner-policy'});
 for(const patch of [{maximum:99},{approvedBy:'other'},{rootTaskId:'new'},{companyId:'other'},{approvalSource:''}])assert.throws(()=>rootCallLimit({...next,taskCallBudgets:{root:{...next.taskCallBudgets.root,...patch}}},'root'),/BUDGET_DENIED/);
 assert.equal(rootCallLimit({...registry,policy:{maxRootRoleCalls:99}},'root'),6);
 assert.throws(()=>remainingRootCalls(registry,'root',-1),/BUDGET_DENIED/);
});
test('an owner-created Native root can receive the complex tier before its first wake without creating execution history',()=>{
 const registry={companyId:'company',ownerId:'owner',tasks:[],taskRoots:{},operations:[],context:{catalog:{projects:[{projectId:'project'}]}}};
 const task={id:'root',companyId:'company',projectId:'project',responsibleUserId:'owner',createdByUserId:'owner',status:'backlog'};
 const next=grantComplexTaskBudget(registry,{task,approvalSource:'owner-approved-complex-work'});
 assert.equal(rootCallLimit(next,'root'),12);assert.deepEqual(next.tasks,[]);assert.deepEqual(next.operations,[]);assert.deepEqual(next.taskRoots,{});
 for(const patch of [{createdByUserId:'other'},{projectId:'foreign'},{executionRunId:'active'},{assigneeAgentId:'another'}])assert.throws(()=>grantComplexTaskBudget(registry,{task:{...task,...patch},approvalSource:'owner-policy'}),/BUDGET_DENIED/);
});
