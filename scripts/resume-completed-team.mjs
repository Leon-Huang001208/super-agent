/** Explicit owner adoption of an incomplete, settled Native root; never a new goal or model call. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ROLE_ROOT as R,readControl,readRolePermit,writeControl} from '../bridge/role-control-store.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';
import {database} from '../bridge/native-role-runtime.mjs';
import {createProjectCatalog} from '../bridge/context-projects.mjs';
import {resolveRoleProjectContext} from '../bridge/role-project-context.mjs';
import {observeContextCallEvidence} from '../bridge/chief-context-paperclip.mjs';
import {writeTeamArchive} from '../bridge/team-context.mjs';
import {TEAM_ROLES} from '../bridge/team-roles.mjs';
import {completedResumeRequest,planCompletedResume,completedResumeTransaction,completedResumeExecution,validateCompletedResumeArtifacts} from '../bridge/completed-team-resume.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const uuid=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value??'');
const log=event=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});

export function completedResumeArgs(args){
 let requestFile,apply=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--request'&&!requestFile&&args[i+1])requestFile=args[++i];
  else if(args[i]==='--apply'&&!apply)apply=true;
  else fail('COMPLETED_TEAM_RESUME_ARGUMENTS_INVALID');
 }
 if(typeof requestFile!=='string'||!path.isAbsolute(requestFile)||path.normalize(requestFile)!==requestFile||!requestFile.startsWith(R+'/'))
  fail('COMPLETED_TEAM_RESUME_ARGUMENTS_INVALID');
 return{requestFile,apply};
}
function directory(name){
 if(!fs.existsSync(name))fs.mkdirSync(name,{mode:0o700});
 const stat=fs.lstatSync(name);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)||fs.realpathSync(name)!==name)fail('COMPLETED_TEAM_RESUME_DIRECTORY_DENIED');
}
function originalTask(task){
 const keys=['id','companyId','projectId','projectWorkspaceId','parentId','createdByUserId','createdByAgentId','responsibleUserId','assigneeUserId','assigneeAgentId','executionRunId','checkoutRunId','status','title','description'];
 return Object.fromEntries(keys.map(key=>[key,task[key]??null]));
}
function originalFlow(request){
 const matches=fs.readdirSync(R+'/team/workflows').filter(name=>name.endsWith('.json')).map(name=>({file:R+'/team/workflows/'+name,flow:readControl(R+'/team/workflows/'+name)}))
  .filter(({flow})=>flow.rootTaskId===request.taskId&&flow.inputRevision===request.expectedInputRevision);
 if(matches.length!==1)fail('COMPLETED_TEAM_RESUME_FLOW_AMBIGUOUS');
 const value=matches[0],bytes=fs.readFileSync(value.file);
 if(sha(bytes)===request.expectedFlowSha256)return{...value,bytes,projected:false};
 const expected=R+'/team/context-archive/'+request.taskId+'/'+request.expectedInputRevision+'/'+request.resumeId+'-completed-flow.json';
 if(value.flow.kind!=='completed-root-resume'||value.flow.completedResume?.resumeId!==request.resumeId||
  value.flow.predecessor?.flowSha256!==request.expectedFlowSha256||value.flow.predecessor.archiveFile!==expected)
  fail('COMPLETED_TEAM_RESUME_FLOW_CHANGED');
 const archived=readControl(expected),saved=fs.readFileSync(expected);
 if(sha(saved)!==request.expectedFlowSha256)fail('COMPLETED_TEAM_RESUME_FLOW_CHANGED');
 return{file:value.file,flow:archived,bytes:saved,projected:true,projectedFlow:value.flow};
}
function budgetEvidence(taskId){
 const root=R+'/budget/'+taskId,stat=fs.lstatSync(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077))fail('COMPLETED_TEAM_RESUME_BUDGET_INVALID');
 return fs.readdirSync(root).sort().map(name=>{
  if(!name.endsWith('.json')||!uuid(name.slice(0,-5)))fail('COMPLETED_TEAM_RESUME_BUDGET_INVALID');
  readControl(root+'/'+name);return{name,sha256:sha(fs.readFileSync(root+'/'+name))};
 });
}
function admissionLeases(){
 const db=new DatabaseSync('/paperclip/control/admission.sqlite',{readOnly:true});
 try{return db.prepare('SELECT task_id FROM admission_lease').all();}finally{db.close();}
}
function archiveArtifacts(registry,source,request,{apply}){
 const flow=source.flow,base=R+'/team/context-archive/'+flow.rootTaskId+'/'+flow.inputRevision;
 const saved={},permits={};
 for(const ref of [flow.planArtifact,...Object.values(flow.artifacts??{}),flow.summary].filter(Boolean)){
  if(!uuid(ref.runId)||!/^[a-z][a-z0-9-]{0,110}\.(md|json)$/.test(ref.file??''))fail('COMPLETED_TEAM_RESUME_ARTIFACT_CHANGED');
  const permit=readRolePermit(R+'/permits/'+ref.runId+'.json');
  permits[ref.runId]=permit;
  const projectCwd='/paperclip/instances/default/projects/'+registry.companyId+'/'+flow.projectId+'/_default';
  if(permit.runId!==ref.runId||permit.taskId!==(ref.taskId??flow.rootTaskId)||permit.companyId!==registry.companyId||
   permit.projectId!==flow.projectId||permit.ownerId!==registry.ownerId||!TEAM_ROLES[permit.role]||
   ![projectCwd,R+'/workspaces/'+permit.role].includes(permit.cwd))
   fail('COMPLETED_TEAM_RESUME_ARTIFACT_CHANGED');
  const sourceFile=ref.archiveFile??path.join(permit.cwd,ref.file),stat=fs.lstatSync(sourceFile);
  if(ref.archiveFile&&(ref.archiveFile!==base+'/'+ref.runId+'-'+ref.file||stat.uid!==0||(stat.mode&0o077))||
   !stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>262144||fs.realpathSync(sourceFile)!==sourceFile)
   fail('COMPLETED_TEAM_RESUME_ARTIFACT_CHANGED');
  const bytes=fs.readFileSync(sourceFile);if(sha(bytes)!==ref.sha256)fail('COMPLETED_TEAM_RESUME_ARTIFACT_CHANGED');
  const archiveFile=apply?writeTeamArchive({root:R+'/team/context-archive',flow,name:ref.runId+'-'+ref.file,bytes}):base+'/'+ref.runId+'-'+ref.file;
  saved[ref.runId+':'+ref.file]={...ref,archiveFile};
 }
 const archivedFlow=apply?writeTeamArchive({root:R+'/team/context-archive',flow,name:request.resumeId+'-completed-flow.json',bytes:source.bytes}):base+'/'+request.resumeId+'-completed-flow.json';
 return{archivedArtifacts:saved,archivedFlow,permits};
}

async function main(){
 const args=completedResumeArgs(process.argv.slice(2)),request=completedResumeRequest(readControl(args.requestFile)),registry=readControl(R+'/registry.json');
 const api=await createRoleOwnerApi({registry,requirePaused:args.apply});
 try{
  const source=originalFlow(request),task=await api.request('/issues/'+request.taskId);
  if(!task)fail('COMPLETED_TEAM_RESUME_TASK_MISSING');
  const {db,schema:s,orm:o}=await database();
  const intentFile=R+'/team/completed-resumes/'+request.resumeId+'.json',requestSha256=sha(JSON.stringify(request));
  let intent=fs.existsSync(intentFile)?readControl(intentFile):null;
  if(intent&&(intent.requestSha256!==requestSha256||intent.rootTaskId!==task.id||intent.beforeFlowSha256!==request.expectedFlowSha256))
   fail('COMPLETED_TEAM_RESUME_INTENT_CHANGED');
  const before=budgetEvidence(task.id);
  if(!intent&&task.status!=='done')fail('COMPLETED_TEAM_RESUME_INTENT_REQUIRED');
  if(!intent)intent={schemaVersion:1,rootTaskId:task.id,resumeId:request.resumeId,requestSha256,beforeFlowSha256:request.expectedFlowSha256,
   originalTask:originalTask(task),budgetBefore:before,at:new Date().toISOString()};
  if(args.apply&&!fs.existsSync(intentFile)){
   directory(R+'/team/completed-resumes');
   const fd=fs.openSync(intentFile,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
   try{fs.writeFileSync(fd,JSON.stringify(intent)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   const parent=fs.openSync(path.dirname(intentFile),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  }
  const archived=archiveArtifacts(registry,source,request,{apply:args.apply});
  const inspect=async(tx,current)=>{
   const [workspace]=await tx.select().from(s.projectWorkspaces).where(o.eq(s.projectWorkspaces.id,request.projectWorkspaceId));
   const [nativeProject]=await tx.select().from(s.projects).where(o.eq(s.projects.id,current.projectId));
   if(!nativeProject||nativeProject.companyId!==registry.companyId)fail('COMPLETED_TEAM_RESUME_WORKSPACE_CHANGED');
   resolveRoleProjectContext({companyId:registry.companyId,ownerId:registry.ownerId,project:nativeProject,workspace,
    task:{...current,projectWorkspaceId:request.projectWorkspaceId},rootTaskId:current.id});
   const catalog=createProjectCatalog({registry:registry.context.catalog,authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log:()=>{}});
   const project=catalog.forNativeTask({...current,projectWorkspaceId:request.projectWorkspaceId},{ownerId:registry.ownerId});
   const activeRuns=await tx.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
   const leases=await tx.select().from(s.environmentLeases);
   const children=await tx.select().from(s.issues).where(o.and(o.eq(s.issues.companyId,registry.companyId),o.eq(s.issues.parentId,current.id)));
   const ids=[current.id,...children.map(value=>value.id)];
   const runs=await tx.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.companyId,registry.companyId),o.inArray(s.heartbeatRuns.issueId,ids)));
   validateCompletedResumeArtifacts({registry,task:current,flow:source.flow,runs,children,permits:archived.permits});
   const local=observeContextCallEvidence({task:current,ids,runs}),execution=completedResumeExecution({local,runs});
   const events=await tx.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,registry.companyId),o.eq(s.activityLog.entityId,current.id),o.eq(s.activityLog.action,'team.completed_resume'),o.sql`${s.activityLog.details}->>'resumeId' = ${request.resumeId}`));
   if(events.length>1||events.some(row=>row.actorType!=='user'||row.actorId!==registry.ownerId))fail('COMPLETED_TEAM_RESUME_EVENT_CHANGED');
   const controls=await tx.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,registry.companyId),o.eq(s.activityLog.entityId,current.id),o.eq(s.activityLog.action,'team.context.control')));
   if(controls.length&&!events.length)fail('COMPLETED_TEAM_RESUME_ALREADY_MANAGED');
   if(controls.some(row=>!(row.actorType==='user'&&row.actorId===registry.ownerId||row.actorType==='system'&&row.actorId==='super-agent-context-m2')||
    !Number.isSafeInteger(row.details?._eventSequence)||row.details._eventSequence<1||row.details?.value?.taskId!==current.id||
    row.details.value.ownerId!==registry.ownerId||row.details.value.companyId!==registry.companyId||row.details.value.projectId!==current.projectId))fail('COMPLETED_TEAM_RESUME_EVENT_CHANGED');
   if(JSON.stringify(readControl(R+'/registry.json'))!==JSON.stringify(registry))fail('COMPLETED_TEAM_RESUME_REGISTRY_CHANGED');
   const latest=originalFlow(request);if(latest.file!==source.file||sha(latest.bytes)!==request.expectedFlowSha256)fail('COMPLETED_TEAM_RESUME_FLOW_CHANGED');
   const currentBudget=budgetEvidence(current.id);
   if(intent.budgetBefore.some(old=>!currentBudget.some(value=>value.name===old.name&&value.sha256===old.sha256)))fail('COMPLETED_TEAM_RESUME_BUDGET_CHANGED');
   const plan=planCompletedResume({registry,task:current,originalTask:intent.originalTask,project,workspace,flow:source.flow,
    flowSha256:request.expectedFlowSha256,request,used:currentBudget.length,activeRuns,leases,admissionLeases:admissionLeases(),
    callLock:fs.existsSync(R+'/call.lock'),execution,nativeEvent:events[0]?.details,...archived,at:intent.at});
   return{plan,controls};
  };
  if(!args.apply){
   let inspected;
   try{inspected=await inspect(db,task);}catch(error){
    if(error?.code!=='COMPLETED_TEAM_RESUME_BUSY')throw error;
    console.log(JSON.stringify({status:'preview',canApply:false,code:error.code,validation:'not_checked_while_busy',taskId:task.id,
     resumeId:request.resumeId,nativeStatus:task.status,flowSha256:request.expectedFlowSha256,usedCalls:before.length,modelCalls:0,newTasks:0}));return;
   }
   const {plan}=inspected;console.log(JSON.stringify({status:'preview',canApply:true,taskId:task.id,resumeId:request.resumeId,nativeStatus:task.status,
    flowSha256:request.expectedFlowSha256,usedCalls:plan.event.usedCalls,maximum:plan.event.maximum,projectWorkspaceId:request.projectWorkspaceId,
    modelCalls:0,newTasks:0}));return;
  }
  const {issueService,executeIssuePostCommitActions}=await import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/issues.js');
  const {logActivity,publishActivity}=await import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/activity-log.js');
  const outcome=await completedResumeTransaction({transaction:fn=>db.transaction(fn),publishActivity,
   runPostCommitActions:actions=>executeIssuePostCommitActions(db,actions),mutate:async(tx,publications,actions)=>{
    const [current]=await tx.select().from(s.issues).where(o.eq(s.issues.id,request.taskId)).for('update');
    if(!current)fail('COMPLETED_TEAM_RESUME_TASK_MISSING');
    const{plan,controls}=await inspect(tx,current);
    if(plan.kind==='resume'){
     const changed=await issueService(tx).update(current.id,{...plan.taskPatch,companyGuard:registry.companyId,actorUserId:registry.ownerId,updatedByUserId:registry.ownerId},tx,publications,actions);
     if(changed?.id!==current.id||changed.status!=='in_review'||changed.assigneeAgentId||changed.assigneeUserId!==registry.ownerId||changed.projectWorkspaceId!==request.projectWorkspaceId)
      fail('COMPLETED_TEAM_RESUME_NATIVE_RESULT_CHANGED');
     const sequence=controls.reduce((value,row)=>Math.max(value,row.details?._eventSequence??0),0)+1;
     await logActivity(tx,{companyId:registry.companyId,actorType:'user',actorId:registry.ownerId,action:'team.context.control',entityType:'issue',entityId:current.id,
      details:{taskId:current.id,sourceKey:'owner-completed-resume:'+request.resumeId,_eventSequence:sequence,value:plan.control}},publications);
     await logActivity(tx,{companyId:registry.companyId,actorType:'user',actorId:registry.ownerId,action:'team.completed_resume',entityType:'issue',entityId:current.id,details:plan.event},publications);
    }
    return plan;
   }});
  const currentFlow=readControl(source.file);
  if(source.projected){
   if(currentFlow.completedResume?.resumeId!==request.resumeId||currentFlow.predecessor?.flowSha256!==request.expectedFlowSha256)fail('COMPLETED_TEAM_RESUME_FLOW_CHANGED');
  }else{
   if(sha(fs.readFileSync(source.file))!==request.expectedFlowSha256)fail('COMPLETED_TEAM_RESUME_FLOW_CHANGED');
   writeControl(source.file,outcome.flow);
  }
  const after=budgetEvidence(task.id);
  if(intent.budgetBefore.some(old=>!after.some(value=>value.name===old.name&&value.sha256===old.sha256)))fail('COMPLETED_TEAM_RESUME_BUDGET_CHANGED');
  log({code:'COMPLETED_TEAM_RESUME_APPLIED',taskId:task.id,resumeId:request.resumeId,status:outcome.kind,modelCalls:0,newTasks:0});
  console.log(JSON.stringify({status:source.projected?'reused':outcome.kind,taskId:task.id,resumeId:request.resumeId,modelCalls:0,newTasks:0,originalCallsPreserved:true}));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
 const code=/^(?:COMPLETED_TEAM_RESUME|ROLE|NATIVE_ROLE|CONTEXT_PROJECT|CHIEF_CONTEXT|TEAM_CONTEXT)_[A-Z_]+$/.test(error?.code??error?.message)?(error.code??error.message):'COMPLETED_TEAM_RESUME_UNKNOWN';
 console.error(JSON.stringify({code}));process.exitCode=1;
});
