/** Owner management entry; the existing coordinator consumes the resulting original flow. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {ROLE_ROOT as R,readControl,writeControl} from '../bridge/role-control-store.mjs';
import {planQualityResume,qualityResumeTransaction} from '../bridge/team-quality-resume.mjs';
import {writeTeamArchive} from '../bridge/team-context.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';
import {database} from '../bridge/native-role-runtime.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
export function qualityResumeArgs(args){
 const values={apply:false};const fields={'--task-id':'taskId','--resume-id':'resumeId','--expected-flow-sha256':'expectedFlowSha256'};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--apply'&&!values.apply)values.apply=true;
  else if(fields[args[i]]&&values[fields[args[i]]]===undefined&&args[i+1])values[fields[args[i]]]=args[++i];
  else fail('TEAM_QUALITY_RESUME_ARGUMENTS_INVALID');
 }
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(values.taskId??'')||
  values.apply&&(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(values.resumeId??'')||!/^[a-f0-9]{64}$/.test(values.expectedFlowSha256??'')))fail('TEAM_QUALITY_RESUME_ARGUMENTS_INVALID');
 return values;
}

async function main(){
 const args=qualityResumeArgs(process.argv.slice(2)),registry=readControl(R+'/registry.json');
 const files=fs.readdirSync(R+'/team/workflows').filter(name=>name.endsWith('.json')).map(name=>({file:R+'/team/workflows/'+name,flow:readControl(R+'/team/workflows/'+name)}))
  .filter(({flow})=>flow.rootTaskId===args.taskId&&flow.qaBlocked);
 // Already-projected resumes remain discoverable under the same explicit owner operation.
 if(!files.length&&args.resumeId)for(const name of fs.readdirSync(R+'/team/workflows').filter(name=>name.endsWith('.json'))){const file=R+'/team/workflows/'+name,flow=readControl(file);if(flow.rootTaskId===args.taskId&&flow.qualityResumeHistory?.some(item=>item.resumeId===args.resumeId))files.push({file,flow});}
 if(files.length!==1)fail('TEAM_QUALITY_RESUME_FLOW_AMBIGUOUS');
 const {file,flow}=files[0],bytes=fs.readFileSync(file),flowSha256=sha(bytes);
 const api=await createRoleOwnerApi({registry,requirePaused:args.apply});
 try{
  if(!args.apply){const task=await api.request('/issues/'+args.taskId);console.log(JSON.stringify({status:'preview',taskId:args.taskId,nativeStatus:task?.status,flowSha256,round:flow.qaRepair?.round,qaBlocked:flow.qaBlocked?.code,modelCalls:0}));return;}
  const {db,schema:s,orm:o}=await database();
  const {issueService,executeIssuePostCommitActions}=await import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/issues.js');
  const {logActivity,publishActivity}=await import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/activity-log.js');
  const outcome=await qualityResumeTransaction({transaction:fn=>db.transaction(fn),publishActivity,runPostCommitActions:actions=>executeIssuePostCommitActions(db,actions),mutate:async(tx,publications,actions)=>{
   const [task]=await tx.select().from(s.issues).where(o.eq(s.issues.id,args.taskId)).for('update');
   const activeRuns=await tx.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
   const leases=await tx.select().from(s.environmentLeases);
   const rows=await tx.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,registry.companyId),o.eq(s.activityLog.entityId,args.taskId),o.eq(s.activityLog.action,'team.quality_resume'),o.sql`${s.activityLog.details}->>'resumeId' = ${args.resumeId}`));
   if(rows.length>1||rows.some(row=>row.actorType!=='user'||row.actorId!==registry.ownerId))fail('TEAM_QUALITY_RESUME_EVENT_CHANGED');
   if(sha(fs.readFileSync(file))!==flowSha256)fail('TEAM_QUALITY_RESUME_FLOW_CHANGED');
   const budgetFiles=fs.readdirSync(R+'/budget/'+args.taskId);if(budgetFiles.some(name=>!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(name)))fail('TEAM_QUALITY_RESUME_BUDGET_INVALID');
   const plan=planQualityResume({registry,task,flow,flowSha256,...args,used:budgetFiles.length,activeRuns,leases,callLock:fs.existsSync(R+'/call.lock'),nativeEvent:rows[0]?.details});
   if(plan.kind==='resume'){
    const changed=await issueService(tx).update(task.id,{status:'in_review',assigneeUserId:registry.ownerId,assigneeAgentId:null,companyGuard:registry.companyId,updatedByUserId:registry.ownerId,actorUserId:registry.ownerId},tx,publications,actions);
    if(changed?.id!==task.id||changed.status!=='in_review'||changed.assigneeUserId!==registry.ownerId||changed.assigneeAgentId||changed.responsibleUserId!==registry.ownerId||taskInputRevision(changed)!==flow.inputRevision)fail('TEAM_QUALITY_RESUME_NATIVE_RESULT_CHANGED');
    await logActivity(tx,{companyId:registry.companyId,actorType:'user',actorId:registry.ownerId,action:'team.quality_resume',entityType:'issue',entityId:task.id,details:plan.event},publications);
   }
   return plan;
  }});
  if(outcome.kind!=='reused'){
   writeTeamArchive({root:R+'/team/context-archive',flow,name:args.resumeId+'-quality-block.json',bytes,log:()=>{}});
   if(sha(fs.readFileSync(file))!==flowSha256)fail('TEAM_QUALITY_RESUME_FLOW_CHANGED');
   writeControl(file,outcome.flow);
  }
  fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),code:'TEAM_QUALITY_RESUME_APPLIED',taskId:args.taskId,resumeId:args.resumeId,status:outcome.kind,modelCalls:0})+'\n',{mode:0o600});
  console.log(JSON.stringify({status:outcome.kind,taskId:args.taskId,resumeId:args.resumeId,modelCalls:0,newTasks:0}));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({code:/^(?:TEAM|ROLE)_[A-Z_]+$/.test(error?.code??error?.message)?(error.code??error.message):'TEAM_QUALITY_RESUME_UNKNOWN'}));process.exitCode=1;});
