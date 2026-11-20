/** Trusted execution choice copied from the registered profile into each Native permit. */
export const MACOS_NATIVE_EXECUTION_POLICY=Object.freeze({executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'});
const LEGACY=Object.freeze({executor:'docker',sandbox:'workspace-write',approvalPolicy:'never',docker:'required'});
export function roleExecutionPolicy(value={}){
 const selected=value?.executionPolicy;
 if(selected===undefined)return {...LEGACY};
 const expected=selected?.executor==='macos_native'?MACOS_NATIVE_EXECUTION_POLICY:LEGACY;
 if(!selected||Object.keys(selected).length!==4||Object.entries(expected).some(([key,item])=>selected[key]!==item))throw Object.assign(Error('ROLE_EXECUTION_POLICY_DENIED'),{code:'ROLE_EXECUTION_POLICY_DENIED'});
 return {...expected};
}
export const isMacNative=value=>roleExecutionPolicy(value).executor==='macos_native';
export const roleManagedArgs=value=>isMacNative(value)?['--dangerously-bypass-approvals-and-sandbox']:['--sandbox','workspace-write'];
// The stock adapter itself emits the bypass flag when its registered bypass setting is true.
export const roleAdapterArgs=value=>isMacNative(value)?[]:['--sandbox','workspace-write'];
