import test from 'node:test';
import assert from 'node:assert/strict';
import {roleExecutionPolicy,roleManagedArgs,roleAdapterArgs} from '../bridge/role-execution-policy.mjs';

test('native execution is explicit, consistent, and never inherits legacy sandbox arguments',()=>{
 const executionPolicy={executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'};
 assert.deepEqual(roleExecutionPolicy({executionPolicy}),executionPolicy);
 assert.deepEqual(roleManagedArgs({executionPolicy}),['--dangerously-bypass-approvals-and-sandbox']);
 assert.deepEqual(roleAdapterArgs({executionPolicy}),[]);
 assert.deepEqual(roleManagedArgs({}),['--sandbox','workspace-write']);
 for(const change of [{sandbox:'workspace-write'},{approvalPolicy:'prompt'},{executor:'unknown'}])assert.throws(()=>roleExecutionPolicy({executionPolicy:{...executionPolicy,...change}}),/ROLE_EXECUTION_POLICY_DENIED/);
});
