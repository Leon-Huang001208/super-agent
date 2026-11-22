import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTaskCallBudgetArguments} from '../scripts/task-call-budget.mjs';

const taskId='5436f00e-75e6-49ce-821c-dbaff45798f3';
const base=['--task-id',taskId,'--approval-source','owner-approved-twenty'];
test('budget CLI defaults to twenty and accepts only an explicit twenty-call allocation',()=>{
 assert.deepEqual(parseTaskCallBudgetArguments(base),{apply:false,taskId,approvalSource:'owner-approved-twenty',maximum:20});
 assert.deepEqual(parseTaskCallBudgetArguments([...base,'--maximum','20','--apply']),{apply:true,taskId,approvalSource:'owner-approved-twenty',maximum:20});
 for(const value of ['6','12','21','0','Infinity','20.5','--apply'])assert.throws(()=>parseTaskCallBudgetArguments([...base,'--maximum',value]),/NATIVE_ROLE_TASK_BUDGET_ARGUMENTS_DENIED/);
});
test('budget CLI rejects malformed identities, missing values, unknown arguments and empty approval sources without owner API work',()=>{
 for(const args of [[],['--task-id',taskId],['--task-id','foreign','--approval-source','owner'],['--task-id',taskId,'--approval-source',''],[...base,'--maximum'],[...base,'--other','20']])assert.throws(()=>parseTaskCallBudgetArguments(args),/NATIVE_ROLE_TASK_BUDGET_ARGUMENTS_DENIED/);
});
