import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{randomUUID}from'node:crypto';import{DatabaseSync}from'node:sqlite';
import{AdmissionMeter}from'../bridge/admission.mjs';import{createHostStorageReceipt}from'../scripts/host-storage.mjs';import{ROLE_DISPLAY_NAMES}from'../bridge/role-labels.mjs';
test('daily task count is unlimited while the same dated ledger, global fence and release evidence stay enforced',t=>{
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'admission-policy-'));t.after(()=>fs.rmSync(dir,{recursive:true}));const file=dir+'/meter.sqlite',projectId=randomUUID(),now=Date.parse('2026-11-19T14:00:00.000Z');
 const receipt=createHostStorageReceipt({hostPlatform:'darwin',capturedAt:new Date(now).toISOString(),externalFilesystem:'apfs',dfPk:'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 50000000 1000000 49000000 2% /\n/dev/data 50000000 1000000 49000000 2% /Volumes/SuperAgentDockerData\n'},{now});assert.equal(receipt.allowed,true);
 const meter=new AdmissionMeter({filename:file,allowedProjectIds:[projectId],log(){}});t.after(()=>meter.close());const taskIds=[];
 for(let i=0;i<25;i++){const taskId=randomUUID();taskIds.push(taskId);const lease=meter.reserveTask({taskId,projectId,now,storageReceipt:receipt});assert.equal(lease.allowed,true,'task '+(i+1));assert.equal(meter.release({...lease,terminalEvidence:true}).released,true);}
 const taskId=randomUUID(),lease=meter.reserveTask({taskId,projectId,now,storageReceipt:receipt});
 assert.throws(()=>meter.reserveTask({taskId:randomUUID(),projectId,now,storageReceipt:receipt}),/ADMISSION_BUSY/);
 assert.throws(()=>meter.release(lease),/ADMISSION_RELEASE_DENIED/);assert.equal(meter.verifyLease({...lease,projectId}).allowed,true);
 assert.equal(meter.release({...lease,terminalEvidence:true}).released,true);
 const old=meter.reserveTask({taskId:taskIds[0],projectId,now,storageReceipt:receipt});assert.equal(old.newTask,false);meter.release({...old,terminalEvidence:true});
 const db=new DatabaseSync(file,{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS count FROM admission_meter WHERE first_day=?').get('2026-11-19').count,26);}finally{db.close();}
});
test('display labels use complete English job names without changing internal role keys',()=>{
 assert.equal(ROLE_DISPLAY_NAMES.research,'Research Analyst');assert.equal(ROLE_DISPLAY_NAMES.pm,'Product Manager');assert.equal(ROLE_DISPLAY_NAMES['network-engineer'],'Network Engineer');assert.equal(ROLE_DISPLAY_NAMES.qa,'Quality Assurance Engineer');assert.equal(ROLE_DISPLAY_NAMES.architect,'Software Architect');
});
