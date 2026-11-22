/** Authenticated owner maintenance entry; never starts or cancels model work. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ROLE_ROOT as R,readControl,writeControl,editRoleRegistry} from '../bridge/role-control-store.mjs';
import {planDispatchControl,dispatchControlArgs} from '../bridge/team-dispatch-control.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';
import {database} from '../bridge/native-role-runtime.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};

async function main(){
 const args=dispatchControlArgs(process.argv.slice(2)),file=R+'/registry.json',before=readControl(file),beforeSha256=sha(fs.readFileSync(file));
 const api=await createRoleOwnerApi({registry:before});
 try{
  const {db,schema:s,orm:o}=await database();
  const state=async()=>({activeRuns:await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry'])),
   leases:await db.select().from(s.environmentLeases),callLock:fs.existsSync(R+'/call.lock')});
  const observed=await state(),enabled=args.action==='resume';
  if(args.action==='status'||!args.apply){
   const unsettled=observed.leases.filter(value=>!value.releasedAt||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed');
   console.log(JSON.stringify({status:'preview',enabled:before.team.enabled,registrySha256:beforeSha256,activeRuns:observed.activeRuns.length,
    unsettledLeases:unsettled.length,callLock:observed.callLock,canApply:!observed.activeRuns.length&&!unsettled.length&&!observed.callLock,newModelCalls:0}));return;
  }
  const directory=R+'/team/dispatch-control',receiptFile=directory+'/'+args.operationId+'.json';
  if(fs.existsSync(receiptFile)){
   const existing=readControl(receiptFile);
   if(existing.ownerId!==before.ownerId||existing.companyId!==before.companyId||existing.enabled!==enabled||
    existing.approvalSource!==args.approvalSource||before.team.enabled!==enabled)fail('TEAM_DISPATCH_CONTROL_OPERATION_CHANGED');
   console.log(JSON.stringify({status:'reused',operationId:args.operationId,enabled,newModelCalls:0}));return;
  }
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const directoryStat=fs.lstatSync(directory);if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||directoryStat.uid!==0||(directoryStat.mode&0o077))fail('TEAM_DISPATCH_CONTROL_PATH_DENIED');
  // Retain the exact precondition and intent if a later publication is interrupted.
  const intentFile=directory+'/'+args.operationId+'.intent.json';
  let intent=fs.existsSync(intentFile)?readControl(intentFile):null;
  if(intent){
   if(intent.operationId!==args.operationId||intent.ownerId!==before.ownerId||intent.companyId!==before.companyId||
    intent.enabled!==enabled||intent.registrySha256!==args.expectedRegistrySha256||intent.approvalSource!==args.approvalSource)fail('TEAM_DISPATCH_CONTROL_OPERATION_CHANGED');
   // Publication succeeded but its receipt was lost: reconcile the exact intended state,
   // without applying the transition again or rolling back any newer registry content.
   if(beforeSha256===intent.afterRegistrySha256&&before.team.enabled===enabled){
    writeControl(receiptFile,{...intent,status:'applied',at:new Date().toISOString(),reconciled:true,newModelCalls:0});
    console.log(JSON.stringify({status:'reconciled',operationId:args.operationId,enabled,newModelCalls:0}));return;
   }
  }
  if(beforeSha256!==args.expectedRegistrySha256)fail('TEAM_DISPATCH_CONTROL_CHANGED');
  const next=planDispatchControl({registry:before,expectedRegistry:before,enabled,...observed});
  const prepared={operationId:args.operationId,ownerId:before.ownerId,companyId:before.companyId,priorEnabled:before.team.enabled,enabled,
   registrySha256:beforeSha256,afterRegistrySha256:sha(Buffer.from(JSON.stringify(next)+'\n')),approvalSource:args.approvalSource};
  if(intent){if(!isDeepStrictEqual(intent,prepared))fail('TEAM_DISPATCH_CONTROL_OPERATION_CHANGED');}
  else{intent=prepared;writeControl(intentFile,intent);}
  const fresh=await state();
  editRoleRegistry(current=>planDispatchControl({registry:current,expectedRegistry:before,enabled,...fresh}));
  if(!isDeepStrictEqual(readControl(file),next))fail('TEAM_DISPATCH_CONTROL_PUBLICATION_UNKNOWN');
  writeControl(receiptFile,{...intent,status:'applied',afterRegistrySha256:sha(fs.readFileSync(file)),at:new Date().toISOString(),newModelCalls:0});
  fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),code:'TEAM_DISPATCH_CONTROL_APPLIED',operationId:args.operationId,enabled})+'\n',{mode:0o600});
  console.log(JSON.stringify({status:'applied',operationId:args.operationId,enabled,newModelCalls:0}));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
 console.error(JSON.stringify({code:/^(?:TEAM|ROLE)_[A-Z_]+$/.test(error?.code??error?.message)?error.code??error.message:'TEAM_DISPATCH_CONTROL_FAILED'}));process.exitCode=1;
});
