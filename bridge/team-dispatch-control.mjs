import {isDeepStrictEqual} from 'node:util';

const fail=code=>{throw Object.assign(Error(code),{code});};

/** Owner maintenance changes dispatch only after the existing execution plane is idle. */
export function planDispatchControl({registry,expectedRegistry,enabled,activeRuns,leases,callLock}){
 if(typeof enabled!=='boolean'||!registry?.ownerId||!registry?.companyId||typeof registry.team?.enabled!=='boolean'||
  !isDeepStrictEqual(registry,expectedRegistry)||!Array.isArray(activeRuns)||!Array.isArray(leases))fail('TEAM_DISPATCH_CONTROL_CHANGED');
 if(activeRuns.length||callLock||leases.some(lease=>!lease.releasedAt||['active','pending_cleanup'].includes(lease.status)||lease.cleanupStatus==='failed'))fail('TEAM_DISPATCH_CONTROL_BUSY');
 return {...structuredClone(registry),team:{...structuredClone(registry.team),enabled}};
}

export function dispatchControlArgs(args){
 const result={apply:false};
 const fields={'--action':'action','--operation-id':'operationId','--expected-registry-sha256':'expectedRegistrySha256','--approval-source':'approvalSource'};
 for(let index=0;index<args.length;index++){
  if(args[index]==='--apply'&&!result.apply)result.apply=true;
  else if(fields[args[index]]&&result[fields[args[index]]]===undefined&&args[index+1])result[fields[args[index]]]=args[++index];
  else fail('TEAM_DISPATCH_CONTROL_ARGUMENTS_INVALID');
 }
 if(!['status','pause','resume'].includes(result.action)||result.action==='status'&&result.apply||
  result.apply&&(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.operationId??'')||
   !/^[a-f0-9]{64}$/.test(result.expectedRegistrySha256??'')||!result.approvalSource?.trim()))fail('TEAM_DISPATCH_CONTROL_ARGUMENTS_INVALID');
 return result;
}
