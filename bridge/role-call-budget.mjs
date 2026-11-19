import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdmissionMeter } from './admission.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const ROOT='/paperclip/control/research-pm';
function write(file,value) {
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
/** One physical call, including onboarding probes, under the existing admission lease. */
export async function withRoleCall({registry,operation,log,perform,completed}, {root=ROOT,admissionFile='/paperclip/control/admission.sqlite'}={}) {
  if(!path.isAbsolute(root)||path.normalize(root)!==root||root==='/'||!path.isAbsolute(admissionFile))fail('ROLE_CALL_CONFIGURATION_DENIED');
  if(!operation||!uuid.test(operation.id??'')||!uuid.test(operation.taskId??'')||
     !['probe','run'].includes(operation.kind)||typeof perform!=='function'||typeof completed!=='function')fail('ROLE_CALL_CONFIGURATION_DENIED');
  const lease=registry.lease;
  if(lease?.taskId!==operation.taskId||!uuid.test(lease.projectId??''))fail('ROLE_CALL_LEASE_DENIED');
  const databaseStat=fs.lstatSync(admissionFile);
  if(!databaseStat.isFile()||databaseStat.isSymbolicLink()||(databaseStat.mode&0o077))fail('ROLE_CALL_LEASE_DENIED');
  const meter=new AdmissionMeter({filename:admissionFile,allowedProjectIds:[lease.projectId],log});
  try {
    if(meter.verifyLease(lease).allowed!==true)fail('ROLE_CALL_LEASE_DENIED');
    const lock=root+'/call.lock',nonce=randomUUID();
    write(lock,{nonce,operationId:operation.id,taskId:operation.taskId});
    let safe=true;
    try {
      const directory=root+'/budget/'+operation.taskId;
      const stat=fs.lstatSync(directory);
      if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o777)!==0o700)fail('ROLE_CALL_BUDGET_DENIED');
      const names=fs.readdirSync(directory);
      if(names.some(n=>!uuid.test(n.slice(0,-5))||!n.endsWith('.json'))||names.length>=6)fail('ROLE_CALL_BUDGET_DENIED');
      write(directory+'/'+operation.id+'.json',{schemaVersion:1,...operation,at:new Date().toISOString()});
      safe=false;
      const result=await perform();
      safe=completed(result)===true;
      return result;
    } finally {
      // Unknown outcomes keep the owning lock for authoritative reconciliation.
      if(safe){
        const current=JSON.parse(fs.readFileSync(lock,'utf8'));
        if(current.nonce!==nonce||current.operationId!==operation.id)fail('ROLE_CALL_LOCK_CHANGED');
        fs.unlinkSync(lock);
        const parent=fs.openSync(root,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
      }
    }
  } finally {meter.close();}
}
