import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {taskInputRevision} from './task-input.mjs';
import {rootCallLimit} from './task-call-policy.mjs';
import {createProjectCatalog} from './context-projects.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const id=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value??'');
const hash=value=>/^[a-f0-9]{64}$/.test(value??'');
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fields=new Set(['schemaVersion','taskId','resumeId','expectedFlowSha256','expectedInputRevision','projectWorkspaceId',
 'expectedWorkspaceSha256','expectedUsedCalls','continuation','approvalSource','goalIncomplete']);

/** An operator request selects an existing root and registered workspace, never new permissions. */
export function completedResumeRequest(value){
 if(!value||value.schemaVersion!==1||Object.keys(value).some(key=>!fields.has(key))||
  ![value.taskId,value.resumeId,value.projectWorkspaceId].every(id)||
  ![value.expectedFlowSha256,value.expectedInputRevision,value.expectedWorkspaceSha256].every(hash)||
  !Number.isSafeInteger(value.expectedUsedCalls)||value.expectedUsedCalls<0||value.goalIncomplete!==true||
  typeof value.continuation!=='string'||!value.continuation.trim()||Buffer.byteLength(value.continuation)>12000||
  typeof value.approvalSource!=='string'||!value.approvalSource.trim()||Buffer.byteLength(value.approvalSource)>2048)
  fail('COMPLETED_TEAM_RESUME_REQUEST_INVALID');
 return structuredClone(value);
}

export function completedResumeWorkspaceSha256(workspace){
 return sha({id:workspace?.id,projectId:workspace?.projectId,cwd:workspace?.cwd??null,sourceType:workspace?.sourceType??null,
  repoUrl:workspace?.repoUrl??null,metadata:workspace?.metadata?.superAgentProject??null});
}

/** A missing spent-call slot cannot make a failed Native run safe to replay. */
export function completedResumeExecution({local,runs}){
 if(!Array.isArray(runs)||!Number.isSafeInteger(local?.budgetUsed)||local.budgetUsed<0)fail('COMPLETED_TEAM_RESUME_EXECUTION_INVALID');
 const active=new Set(['running','queued','scheduled_retry']),settled=new Set(local.settledFailedRunIds??[]);
 return {...local,active:runs.some(run=>active.has(run.status)),unknown:local.unknown===true||runs.some(run=>
  !active.has(run.status)&&run.status!=='succeeded'&&run.resultJson?.executionRecovery?.providerWorkStarted!==false&&!settled.has(run.id))};
}

/** Archived hashes must still name the actual settled Native runs and original children. */
export function validateCompletedResumeArtifacts({registry,task,flow,runs,children,permits}){
 if(!Array.isArray(runs)||!Array.isArray(children)||!permits)fail('COMPLETED_TEAM_RESUME_NATIVE_ARTIFACT_CHANGED');
 for(const child of flow.children??[]){
  const actual=children.find(value=>value.id===(child.taskId??child.id));
  if(!actual||actual.parentId!==task.id||actual.companyId!==task.companyId||actual.projectId!==task.projectId||
   actual.responsibleUserId!==registry.ownerId||actual.createdByAgentId!==registry.team.ids.chief)
   fail('COMPLETED_TEAM_RESUME_NATIVE_ARTIFACT_CHANGED');
 }
 for(const ref of [flow.planArtifact,...Object.values(flow.artifacts??{}),flow.summary].filter(Boolean)){
  const run=runs.find(value=>value.id===ref.runId),permit=permits[ref.runId];
  if(!run||!permit||run.status!=='succeeded'||!Number.isFinite(Date.parse(run.finishedAt))||run.companyId!==task.companyId||
   run.issueId!==(ref.taskId??task.id)||run.agentId!==permit.agentId||run.responsibleUserId!==registry.ownerId||
   permit.taskId!==run.issueId||permit.runId!==run.id||permit.companyId!==task.companyId||permit.ownerId!==registry.ownerId||permit.projectId!==task.projectId)
   fail('COMPLETED_TEAM_RESUME_NATIVE_ARTIFACT_CHANGED');
 }
 return true;
}

/** Publish Native events only after commit; this entry creates no task, run or wake. */
export async function completedResumeTransaction({transaction,mutate,publishActivity,runPostCommitActions}){
 if([transaction,mutate,publishActivity,runPostCommitActions].some(fn=>typeof fn!=='function'))fail('COMPLETED_TEAM_RESUME_PORT_INVALID');
 const publications=[],actions=[];
 const result=await transaction(tx=>mutate(tx,publications,actions));
 for(const publication of publications)publishActivity(publication);
 await runPostCommitActions(actions);
 return result;
}

/** Pure same-root adoption plan. All prior artifacts remain historical, hash-bound evidence. */
export function planCompletedResume({registry,task,originalTask=task,project,workspace,flow,flowSha256,request,used,
 activeRuns,leases,admissionLeases,callLock,execution,nativeEvent,archivedFlow,archivedArtifacts,at}){
 const r=completedResumeRequest(request);
 if(registry?.team?.enabled!==false||callLock||!Array.isArray(activeRuns)||activeRuns.length||
  !Array.isArray(admissionLeases)||admissionLeases.length||!Array.isArray(leases)||
  leases.some(value=>!value.releasedAt||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed')||
  execution?.active!==false||execution?.unknown!==false)fail('COMPLETED_TEAM_RESUME_BUSY');
 if(!Number.isSafeInteger(used)||used<0||!Number.isSafeInteger(execution?.budgetUsed)||execution.budgetUsed!==used||
  !registry.tasks?.includes(r.taskId)||registry.taskRoots?.[r.taskId]!==r.taskId||
  !task||task.id!==r.taskId||task.parentId||task.companyId!==registry.companyId||task.responsibleUserId!==registry.ownerId||
  task.assigneeAgentId||task.assigneeUserId!==registry.ownerId||task.executionRunId||task.checkoutRunId||
  !originalTask||originalTask.id!==task.id||originalTask.companyId!==task.companyId||originalTask.projectId!==task.projectId||
  originalTask.responsibleUserId!==registry.ownerId||originalTask.parentId||originalTask.status!=='done'||
  taskInputRevision(originalTask)!==r.expectedInputRevision)fail('COMPLETED_TEAM_RESUME_SCOPE_CHANGED');
 if(!flow||flow.rootTaskId!==task.id||flow.projectId!==task.projectId||flow.inputRevision!==r.expectedInputRevision||
  flowSha256!==r.expectedFlowSha256||flow.dispatched!==true||!id(flow.sourceRunId)||!id(flow.sourceOperationId)||
  !flow.summary||!hash(flow.summary.sha256)||flow.summary.runId!==flow.summaryRunId||
  flow.notification?.status!=='sent'||typeof flow.notification.messageId!=='string'||!flow.notification.messageId||
  !Array.isArray(flow.children)||!Array.isArray(flow.taskEntries)||flow.taskEntries.some(entry=>!flow.artifacts?.[entry.key])||
  flow.taskEntries.filter(entry=>entry.role==='qa').some(entry=>flow.artifacts[entry.key].verdict!=='PASS'))fail('COMPLETED_TEAM_RESUME_FLOW_CHANGED');
 const catalog=createProjectCatalog({registry:registry.context?.catalog,authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log:()=>{}});
 const selected=catalog.forNativeTask({...task,projectWorkspaceId:r.projectWorkspaceId},{ownerId:registry.ownerId});
 if(registry.context?.enabled!==true||!isDeepStrictEqual(selected,project)||workspace?.id!==r.projectWorkspaceId||
  workspace.projectId!==task.projectId||workspace.companyId!==undefined&&workspace.companyId!==task.companyId||
  workspace.metadata?.superAgentProject?.ownerId!==registry.ownerId||
  completedResumeWorkspaceSha256(workspace)!==r.expectedWorkspaceSha256)fail('COMPLETED_TEAM_RESUME_WORKSPACE_CHANGED');
 if(!Number.isFinite(Date.parse(at))||typeof archivedFlow!=='string'||!archivedFlow.startsWith('/')||!archivedArtifacts)
  fail('COMPLETED_TEAM_RESUME_ARCHIVE_INVALID');
 const mapped=ref=>{
  if(!ref||!id(ref.runId)||!hash(ref.sha256)||typeof ref.file!=='string')fail('COMPLETED_TEAM_RESUME_ARTIFACT_CHANGED');
  const saved=archivedArtifacts[ref.runId+':'+ref.file];
  if(!saved||saved.sha256!==ref.sha256||typeof saved.archiveFile!=='string'||!saved.archiveFile.startsWith('/'))fail('COMPLETED_TEAM_RESUME_ARTIFACT_CHANGED');
  return {...structuredClone(ref),archiveFile:saved.archiveFile};
 };
 const description=(originalTask.description??'')+'\n\n[Owner continuation '+r.resumeId+']\n'+r.continuation;
 if(Buffer.byteLength(description)>65536)fail('COMPLETED_TEAM_RESUME_INPUT_LIMIT');
 const taskPatch={description,projectWorkspaceId:r.projectWorkspaceId,status:'in_review',assigneeUserId:registry.ownerId,assigneeAgentId:null};
 const afterInputRevision=taskInputRevision({...originalTask,...taskPatch});
 const maximum=rootCallLimit(registry,task.id);
 if(maximum!==20||maximum-r.expectedUsedCalls<3)fail('COMPLETED_TEAM_RESUME_BUDGET_EXHAUSTED');
 const event={schemaVersion:1,resumeId:r.resumeId,rootTaskId:task.id,companyId:registry.companyId,ownerId:registry.ownerId,
  projectId:task.projectId,projectWorkspaceId:r.projectWorkspaceId,beforeInputRevision:r.expectedInputRevision,afterInputRevision,
  beforeFlowSha256:r.expectedFlowSha256,workspaceSha256:r.expectedWorkspaceSha256,requestSha256:sha(r),usedCalls:r.expectedUsedCalls,
  maximum,sourceRunId:flow.sourceRunId,summarySha256:flow.summary.sha256,notificationSha256:sha(flow.notification),
  approvedBy:registry.ownerId,approvalSource:r.approvalSource,goalIncomplete:true};
 if(nativeEvent){
  if(!isDeepStrictEqual(nativeEvent,event))fail('COMPLETED_TEAM_RESUME_EVENT_CHANGED');
  if(task.status!=='in_review'||taskInputRevision(task)!==afterInputRevision||task.projectWorkspaceId!==r.projectWorkspaceId||used<r.expectedUsedCalls)
   fail('COMPLETED_TEAM_RESUME_NATIVE_RESULT_CHANGED');
 }else if(task.status!=='done'||taskInputRevision(task)!==r.expectedInputRevision||used!==r.expectedUsedCalls)
  fail('COMPLETED_TEAM_RESUME_SCOPE_CHANGED');
 const sourceKey='owner-completed-resume:'+r.resumeId;
 const control={schemaVersion:1,managed:true,companyId:registry.companyId,ownerId:registry.ownerId,projectId:task.projectId,
  projectWorkspaceId:r.projectWorkspaceId,taskId:task.id,chatId:'owner-operator:'+registry.ownerId,sourceKey,sourceMessageId:'operator:'+r.resumeId,
  initialOperationId:r.resumeId,inputRevision:afterInputRevision,revision:1,inputSequence:1,appliedInputSequence:1,pendingInputs:[],
  reviewBeforeDispatch:false,approvedPlanSha256:null,plan:null,pauseRequested:false,resumeOperationId:r.resumeId,resumeClaim:null,
  resumeInputRevision:afterInputRevision,resumeSourceKey:sourceKey,resumeHistory:[],checkpoints:[],
  supersessions:[{previousInputRevision:r.expectedInputRevision,newInputRevision:afterInputRevision,children:structuredClone(flow.children),at}],
  completedResume:structuredClone(event)};
 const resumed={...structuredClone(flow),kind:'completed-root-resume',contextVersion:1,projectKey:project.key,
  projectWorkspaceId:r.projectWorkspaceId,workspaceCwd:project.workspaceCwd,
  predecessor:{kind:'completed-native-root',flowSha256:r.expectedFlowSha256,archiveFile:archivedFlow,resumeId:r.resumeId},
  completedResume:structuredClone(event),artifacts:Object.fromEntries(Object.entries(flow.artifacts).map(([key,ref])=>[key,mapped(ref)])),
  ...(flow.planArtifact?{planArtifact:mapped(flow.planArtifact)}:{}),summary:mapped(flow.summary)};
 return {kind:nativeEvent?'reconcile_projection':'resume',taskPatch,control,flow:resumed,event};
}
