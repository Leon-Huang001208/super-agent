import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {readRootCallBudget,validateRootCallBudget} from '../bridge/native-role-budget.mjs';
import {grantComplexTaskBudget} from '../bridge/task-call-policy.mjs';
test('twenty-call owner allocation counts all earlier spent slots and still reserves the summary',t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'complex-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const task=randomUUID(),operation=randomUUID(),directory=root+'/budget/'+task;fs.mkdirSync(directory,{recursive:true,mode:0o700});
 for(let n=0;n<6;n++)fs.writeFileSync(directory+'/'+randomUUID()+'.json','{}',{mode:0o600});
 const registry=grantComplexTaskBudget({companyId:'c',ownerId:'o',tasks:[task],taskRoots:{[task]:task}},{task:{id:task,companyId:'c',responsibleUserId:'o',status:'in_review'},approvalSource:'user-task-tier-policy'});
 assert.deepEqual(readRootCallBudget({root,rootTaskId:task,operationId:operation,registry}),{maximum:20,usedBeforeCurrent:6,currentCallNumber:7,remainingAfterCurrent:13,maxPlanTasks:4});
 assert.deepEqual(readRootCallBudget({root,rootTaskId:task,operationId:operation}),{maximum:20,usedBeforeCurrent:6,currentCallNumber:7,remainingAfterCurrent:13,maxPlanTasks:4});assert.equal(fs.readdirSync(directory).length,6);
});
test('trusted default budget counts the pending third call once and preserves the four-child plan limit',t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const task=randomUUID(),operation=randomUUID(),directory=root+'/budget/'+task;fs.mkdirSync(directory,{recursive:true,mode:0o700});
 for(let n=0;n<2;n++)fs.writeFileSync(directory+'/'+randomUUID()+'.json','{}',{mode:0o600});
 assert.deepEqual(readRootCallBudget({root,rootTaskId:task,operationId:operation}),{maximum:20,usedBeforeCurrent:2,currentCallNumber:3,remainingAfterCurrent:17,maxPlanTasks:4});assert.equal(fs.readdirSync(directory).length,2);
 fs.writeFileSync(directory+'/'+operation+'.json','{}',{mode:0o600});assert.throws(()=>readRootCallBudget({root,rootTaskId:task,operationId:operation}),/NATIVE_ROLE_BUDGET_DENIED/);
});
test('legacy six and twelve call prompt receipts remain valid without being rewritten',()=>{
 for(const maximum of [6,12]){const value={maximum,usedBeforeCurrent:2,currentCallNumber:3,remainingAfterCurrent:maximum-3,maxPlanTasks:Math.min(4,maximum-4)};assert.equal(validateRootCallBudget(value),value);}
});
test('the twentieth pending call is valid but a twenty-first call cannot enter the trusted prompt',()=>{
 assert.equal(validateRootCallBudget({maximum:20,usedBeforeCurrent:19,currentCallNumber:20,remainingAfterCurrent:0,maxPlanTasks:0}).currentCallNumber,20);
 assert.throws(()=>validateRootCallBudget({maximum:20,usedBeforeCurrent:20,currentCallNumber:21,remainingAfterCurrent:-1,maxPlanTasks:0}),/BUDGET_DENIED/);
});
test('unknown, inflated and exhausted Chief budgets cannot enter the trusted prompt',()=>{
 for(const value of [null,{}, {maximum:7,usedBeforeCurrent:2,currentCallNumber:3,remainingAfterCurrent:4,maxPlanTasks:3},{maximum:6,usedBeforeCurrent:2,currentCallNumber:2,remainingAfterCurrent:4,maxPlanTasks:3},{maximum:6,usedBeforeCurrent:6,currentCallNumber:7,remainingAfterCurrent:-1,maxPlanTasks:0}])assert.throws(()=>validateRootCallBudget(value),/NATIVE_ROLE_BUDGET_DENIED/);
});
