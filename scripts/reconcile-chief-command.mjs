/** Reconcile one already-authenticated persisted Owner continue. No receiver, ACK or run consumer is started. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {ROLE_ROOT as R,readControl} from '../bridge/role-control-store.mjs';
import {chiefCommandReconcileRequest,createChiefContextController} from '../bridge/chief-context-native.mjs';
import {createChiefContextPaperclipRepository} from '../bridge/chief-context-paperclip.mjs';
import {createProjectCatalog} from '../bridge/context-projects.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';
import {database} from '../bridge/native-role-runtime.mjs';
const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};

export function chiefCommandArgs(args){
 let requestFile,apply=false;
 for(let index=0;index<args.length;index++){
  if(args[index]==='--request'&&!requestFile)requestFile=args[++index];
  else if(args[index]==='--apply'&&!apply)apply=true;
  else fail('CHIEF_CONTEXT_RECONCILE_ARGUMENTS_INVALID');
 }
 if(typeof requestFile!=='string'||!path.isAbsolute(requestFile)||path.normalize(requestFile)!==requestFile)fail('CHIEF_CONTEXT_RECONCILE_ARGUMENTS_INVALID');
 return{requestFile,apply};
}
function idle(state,registry){
 if(registry.team?.enabled!==false||state.registrySha256!==sha(registry)||
  ['activeRuns','unsettledLeases','phaseLeases'].some(key=>!Number.isSafeInteger(state[key])||state[key]!==0)||state.callLock!==false||state.controlLock!==false)fail('CHIEF_CONTEXT_RECONCILE_NATIVE_BUSY');
}
export async function reconcileChiefCommand({request:raw,apply=false,registry,api,runtime,snapshot,log=()=>{}}){
 const request=chiefCommandReconcileRequest(raw);
 if(typeof apply!=='boolean')fail('CHIEF_CONTEXT_RECONCILE_ARGUMENTS_INVALID');
 if((await api.request('/auth/get-session'))?.user?.id!==registry.ownerId)fail('ROLE_OWNER_API_SESSION_REJECTED');
 const task=await api.request('/issues/'+request.taskId);
 if(!task||task.id!==request.taskId||task.parentId||task.companyId!==registry.companyId||task.companyId!==request.companyId||task.projectId!==request.projectId||task.responsibleUserId!==registry.ownerId)fail('CHIEF_CONTEXT_RECONCILE_SCOPE_DENIED');
 const before=await snapshot();idle(before,registry);
 const result=await runtime.reconcileOwnerContinue({registry,request,apply});
 const after=await snapshot();idle(after,registry);
 if(!isDeepStrictEqual([before.budgetSha256,before.usedCalls],[after.budgetSha256,after.usedCalls]))fail('CHIEF_CONTEXT_RECONCILE_BUDGET_CHANGED');
 if(apply)await log({code:'CHIEF_CONTEXT_CONTINUE_RECONCILED',taskId:request.taskId,sourceKey:request.sourceKey,operationId:request.operationId,status:result.status,modelCalls:0});
 return{mode:result.mode,status:result.status,...(result.canApply!==undefined&&{canApply:result.canApply}),taskId:request.taskId,sourceKey:request.sourceKey,operationId:request.operationId,
  ...(result.result&&{result:Object.fromEntries(['kind','status','taskId','operationId','resumeOperationId'].filter(key=>result.result[key]!==undefined).map(key=>[key,result.result[key]]))}),usedCalls:before.usedCalls,modelCalls:0,newTasks:0};
}

async function main(){
 const args=chiefCommandArgs(process.argv.slice(2)),request=chiefCommandReconcileRequest(readControl(args.requestFile)),registry=readControl(R+'/registry.json');
 const api=await createRoleOwnerApi({registry,requirePaused:true});
 try{
  const p=await database(),{db,schema:s,orm:o}=p,identity=readControl('/chief-feishu-identity/owner-context.json');
  const log=event=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
  const snapshot=async()=>{
   const active=await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
   const leases=await db.select({id:s.environmentLeases.id}).from(s.environmentLeases).where(o.or(o.isNull(s.environmentLeases.releasedAt),o.inArray(s.environmentLeases.status,['active','pending_cleanup']),o.eq(s.environmentLeases.cleanupStatus,'failed')));
   const file='/paperclip/control/admission.sqlite',stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077))fail('CHIEF_CONTEXT_RECONCILE_PHASE_UNKNOWN');
   const sqlite=new DatabaseSync(file,{readOnly:true});let phaseLeases;try{phaseLeases=sqlite.prepare('SELECT count(*) AS count FROM admission_lease').get().count;}finally{sqlite.close();}
   const budget=path.join(R,'budget',request.taskId),directory=fs.lstatSync(budget);if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o077))fail('CHIEF_CONTEXT_RECONCILE_BUDGET_CHANGED');
   const files=fs.readdirSync(budget).sort(),proof=files.map(name=>{if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(name))fail('CHIEF_CONTEXT_RECONCILE_BUDGET_CHANGED');readControl(path.join(budget,name));return[name,sha(fs.readFileSync(path.join(budget,name)))];});
   return{registrySha256:sha(readControl(R+'/registry.json')),activeRuns:active.length,unsettledLeases:leases.length,phaseLeases,callLock:fs.existsSync(R+'/call.lock'),controlLock:fs.existsSync(R+'/registry.control.lock'),budgetSha256:sha(proof),usedCalls:files.length};
  };
  // Existing domain/repository factories without a sender or a knowledge store: preview has no filesystem or message effects.
  const binding={...identity,nativeOwnerId:registry.ownerId,companyId:registry.companyId,projectId:registry.team.projectId,chiefAgentId:registry.team.ids.chief};
  const catalog=createProjectCatalog({registry:registry.context.catalog,authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log:()=>{}});
  const repository=await createChiefContextPaperclipRepository({database:async()=>p,binding,catalog,log:()=>{}}),prohibited=()=>fail('CHIEF_CONTEXT_RECONCILE_EFFECT_PROHIBITED');
  const runtime=createChiefContextController({binding,catalog,repository,knowledgeStore:{remember:prohibited,correct:prohibited,query:prohibited,history:prohibited},acknowledge:prohibited,registerNewGoal:prohibited,log:()=>{}});
  console.log(JSON.stringify(await reconcileChiefCommand({request,apply:args.apply,registry,api,runtime,snapshot,log})));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
 console.error(JSON.stringify({code:/^(?:CHIEF_CONTEXT|ROLE_OWNER)_[A-Z0-9_]+$/.test(error?.code??error?.message)?error.code??error.message:'CHIEF_CONTEXT_RECONCILE_UNKNOWN'}));process.exitCode=1;
});
