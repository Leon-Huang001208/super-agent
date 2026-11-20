import{taskInputRevision}from'./task-input.mjs';
import fs from'node:fs';import path from'node:path';import{createHash,randomUUID}from'node:crypto';
import{AdmissionMeter}from'./admission.mjs';import{ROLE_ROOT as R,readControl,writeControl,editRoleRegistry}from'./role-control-store.mjs';
import{authorizeChiefOwnerInput,validateTeamPlan,validateTeamCodeCandidate,validateTeamQaResult,validateTeamCheckEvidence,codeReviewForTeamStep}from'./team-plan.mjs';import{TEAM_ROLES,validateTeamRoster}from'./team-roles.mjs';
import{readRoleProjectContext}from'./role-project-context.mjs';
import{validateNativeRoleRetry,advanceNativeRetryFlow,archiveNativeRetryFailure,clearArchivedRetryLock,rebindNativeRetryContext,NATIVE_RETRY_CONTEXT}from'./role-native-retry.mjs';
import{consumeQueuedNativeRoleRetry}from'./role-native-retry-consumer.mjs';
const P='/opt/paperclip/node_modules',sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const log=e=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...e})+'\n',{mode:0o600});
const projectIdFor=(r,value)=>value?.projectId??r.team.projectId;
const workspace=(r,projectId=r.team.projectId)=>'/paperclip/instances/default/projects/'+r.companyId+'/'+projectId+'/_default';
function dirs(){for(const name of ['team','team/workflows','team/waiting','team/notifications']){const p=R+'/'+name;if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))fail('TEAM_DIRECTORY_DENIED');}}
function budgetUsed(root){const names=fs.readdirSync(R+'/budget/'+root);if(names.some(x=>!/^[-a-f0-9]{36}\.json$/.test(x)))fail('TEAM_BUDGET_RECORD_DENIED');return names.length;}
function registration(r,taskId,agentId,role,lease,{rootTaskId=taskId,rootInputRevision,phase='work',inputRevision,networkScope,resourceScope,additionalCapabilities=[],authorizedHostActions=[],operationId=randomUUID(),acceptedRunId,additionalInput,reviewedArtifacts,codeCandidate,codeReview}={}){
 const op={id:operationId,kind:'run',taskId,projectId:lease.projectId,agentId,role,rootTaskId,rootInputRevision,phase,inputRevision,networkScope,resourceScope,additionalCapabilities,authorizedHostActions,acceptedRunId,additionalInput,reviewedArtifacts,codeCandidate,codeReview};
 editRoleRegistry(current=>{current.tasks=[...new Set([...current.tasks,taskId,rootTaskId])];current.taskRoots??={};current.taskRoots[taskId]=rootTaskId;current.taskRoots[rootTaskId]=rootTaskId;current.taskId=taskId;current.lease={taskId,projectId:lease.projectId,nonce:lease.nonce,operationId:op.id};if(!current.operations.some(x=>x.id===op.id))current.operations.push(op);if(!fs.existsSync(R+'/budget/'+rootTaskId))fs.mkdirSync(R+'/budget/'+rootTaskId,{mode:0o700});return current;});return op;
}
function meterFor(r,projectId=r.lease?.projectId??r.team.projectId){return new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[projectId],log});}
export async function admitChiefInput(ctx,{database}){
 const r=readControl(R+'/registry.json');if(ctx.agent.id!==r.team?.ids?.chief||r.team.enabled!==true)fail('TEAM_CHIEF_NOT_ENABLED');dirs();
 const {db,schema:s,orm:o}=await database();let[task]=await db.select().from(s.issues).where(o.eq(s.issues.id,ctx.context.issueId));const[run]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ctx.runId));if(!task||!run)fail('TEAM_NATIVE_INPUT_MISSING');
 const[wakeup]=await db.select().from(s.agentWakeupRequests).where(o.eq(s.agentWakeupRequests.id,run.wakeupRequestId));const previousRuns=await db.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.issueId,task.id),o.ne(s.heartbeatRuns.id,run.id)));
 authorizeChiefOwnerInput({registry:r,task:task.projectId?task:{...task,projectId:r.team.projectId},run,wakeup,previousRuns});
 if(!task.projectId){const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db);task=await svc.update(task.id,{projectId:r.team.projectId});}
 await readRoleProjectContext({db,schema:s,orm:o,task,companyId:r.companyId,ownerId:r.ownerId,legacyProfile:r.agents.find(a=>a.profile.role==='chief')?.profile,rootTaskId:task.id});
 const meter=meterFor(r,task.projectId);let lease;
 try{lease=meter.reserveTask({taskId:task.id,projectId:task.projectId,storageReceipt:JSON.parse(fs.readFileSync('/host-evidence/host-storage.json','utf8'))});}
 catch(e){if(e.code!=='ADMISSION_BUSY')throw e;const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db);writeControl(R+'/team/waiting/'+task.id+'.json',{taskId:task.id,projectId:task.projectId,runId:run.id,wakeupId:wakeup.id,inputRevision:taskInputRevision(task),at:new Date().toISOString()});await svc.update(task.id,{status:'todo',assigneeAgentId:null,assigneeUserId:r.ownerId});fail('NATIVE_ROLE_GLOBAL_SLOT_BUSY');}
 finally{meter.close();}
 if(!lease?.allowed)fail('TEAM_ADMISSION_RECONCILIATION_REQUIRED');
 const inputRevision=taskInputRevision(task),op=registration(r,task.id,run.agentId,'chief',{...lease,projectId:task.projectId},{phase:'plan',inputRevision,acceptedRunId:run.id});
 log({code:'TEAM_CHIEF_OWNER_ADMITTED',taskId:task.id,runId:run.id,operationId:op.id,ownerWakeupId:wakeup.id});
 return {...ctx,context:{...ctx.context,issueId:task.id,taskId:task.id,projectId:task.projectId,responsibleUserId:r.ownerId,inputRevision,roleOperationId:op.id,taskGoal:task.description,conversationMode:false}};
}
function artifact(r,name,{notBefore=0,runId}={}){
 let base=workspace(r);if(runId){const permit=readControl(R+'/permits/'+runId+'.json');base=permit.cwd;if(permit.companyId!==r.companyId||(base!==workspace(r,permit.projectId)&&!Object.keys(TEAM_ROLES).some(k=>base===R+'/workspaces/'+k)))fail('TEAM_ARTIFACT_WORKSPACE_DENIED');}
 if(!/^[a-z][a-z0-9-]{0,110}\.(md|json)$/.test(name??''))fail('TEAM_ARTIFACT_PATH_DENIED');const p=path.join(base,name),stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>262144||stat.mtimeMs+2000<notBefore)fail('TEAM_ARTIFACT_DENIED');const bytes=fs.readFileSync(p);if(bytes.includes(0))fail('TEAM_ARTIFACT_DENIED');return {file:name,sha256:sha(bytes),bytes:bytes.length,text:bytes.toString('utf8')};
}
async function ports(database){const data=await database();const issue=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(data.db);const heartbeat=(await import(P+'/@paperclipai/server/dist/services/heartbeat.js')).heartbeatService(data.db);return {...data,issue,heartbeat};}
async function getRunForOp(p,op){const file=R+'/operations/'+op.id+'.json';let id=op.acceptedRunId;if(fs.existsSync(file))id=readControl(file).runId;if(!id){const[w]=await p.db.select().from(p.schema.agentWakeupRequests).where(p.orm.eq(p.schema.agentWakeupRequests.idempotencyKey,'team-operation:'+op.id));id=w?.runId;}if(!id)return null;const[run]=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.eq(p.schema.heartbeatRuns.id,id));return run;}
/** Bind only an already-running Native retry row; this never schedules or wakes a run. */
export async function bindNativeRetryAttempt(ctx,{database}){
 const p=await database(),[observed]=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.eq(p.schema.heartbeatRuns.id,ctx.runId));
 if(!observed?.retryOfRunId)return ctx;
 try{return await p.db.transaction(async tx=>{
  const{s,o}= {s:p.schema,o:p.orm},[run]=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ctx.runId)).for('update');
  const[parentRun]=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,run.retryOfRunId)).for('update');
  const r=readControl(R+'/registry.json');
  if(run.agentId!==ctx.agent.id||run.issueId!==ctx.context?.issueId||!parentRun)fail('TEAM_NATIVE_RETRY_CONTEXT_CHANGED');
  const candidates=[];
  for(const value of r.operations.filter(value=>value.kind==='run'&&value.taskId===run.issueId&&value.agentId===run.agentId)){
   const file=R+'/operations/'+value.id+'.json';
   if(fs.existsSync(file)&&readControl(file).runId===parentRun.id)candidates.push(value);
  }
  if(candidates.length!==1)fail('TEAM_NATIVE_RETRY_PARENT_OPERATION_DENIED');
  const operation=candidates[0],existing=r.operations.find(value=>value.acceptedRunId===run.id&&value.retryOfRunId===parentRun.id);
  if(existing&&fs.existsSync(R+'/budget/'+operation.rootTaskId+'/'+existing.id+'.json'))fail('TEAM_NATIVE_RETRY_ALREADY_STARTED');
  const[task]=await tx.select().from(s.issues).where(o.eq(s.issues.id,run.issueId)).for('update');
  const[rootTask]=await tx.select().from(s.issues).where(o.eq(s.issues.id,operation.rootTaskId)).for('update');
  const files=fs.readdirSync(R+'/team/workflows').filter(name=>name.endsWith('.json')).map(name=>R+'/team/workflows/'+name).filter(file=>readControl(file).rootTaskId===operation.rootTaskId);
  if(files.length!==1)fail('TEAM_NATIVE_RETRY_FLOW_CHANGED');
  const file=files[0],flow=readControl(file),entry=flow.taskEntries.find(value=>value.id===task.id);
  const lockPath=R+'/call.lock',archiveLock=R+'/team/native-retries/'+parentRun.id+'/call.lock.json';
  if(!fs.existsSync(lockPath)&&(!existing||flow.dispatches?.[entry?.key]?.operationId!==existing.id||!flow.attemptHistory?.[entry.key]?.some(value=>value.runId===parentRun.id&&value.retryRunId===run.id)))fail('TEAM_NATIVE_RETRY_LOCK_DENIED');
  const callLock=readControl(fs.existsSync(lockPath)?lockPath:archiveLock);
  const directory=R+'/transport/'+parentRun.id,transportResult=readControl(directory+'/result.json');
  const outputHash=name=>{const full=directory+'/'+name,stat=fs.lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==0||(stat.mode&0o077))fail('TEAM_NATIVE_RETRY_TRANSPORT_DENIED');return sha(fs.readFileSync(full));};
  const activeRuns=await tx.select({id:s.heartbeatRuns.id,status:s.heartbeatRuns.status}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
  const leases=await tx.select({heartbeatRunId:s.environmentLeases.heartbeatRunId,status:s.environmentLeases.status,releasedAt:s.environmentLeases.releasedAt,cleanupStatus:s.environmentLeases.cleanupStatus}).from(s.environmentLeases).where(o.or(o.eq(s.environmentLeases.heartbeatRunId,parentRun.id),o.isNull(s.environmentLeases.releasedAt),o.eq(s.environmentLeases.status,'pending_cleanup'),o.eq(s.environmentLeases.cleanupStatus,'failed')));
  const binding=validateNativeRoleRetry({registry:r,flow,rootTask,task,operation,run,parentRun,existingOperation:existing,callLock,
   budgetCount:budgetUsed(rootTask.id),budgetRecord:readControl(R+'/budget/'+rootTask.id+'/'+operation.id+'.json'),operationBinding:readControl(R+'/operations/'+operation.id+'.json'),
   transportResult,stdoutSha256:outputHash('stdout'),stderrSha256:outputHash('stderr'),activeRuns,leases});
  await requireNoPendingOwnerInput({...p,db:tx},r,rootTask.id);
  await requireNoPendingOwnerInput({...p,db:tx},r,task.id);
  const meter=meterFor(r,task.projectId);try{if(!meter.verifyLease(r.lease).allowed)fail('TEAM_NATIVE_RETRY_PHASE_LEASE_CHANGED');}finally{meter.close();}
  const permit=readControl(R+'/permits/'+parentRun.id+'.json');
  if(permit.runId!==parentRun.id||permit.taskId!==task.id||permit.agentId!==operation.agentId||permit.companyId!==r.companyId||permit.projectId!==task.projectId||permit.ownerId!==r.ownerId||permit.inputRevision!==operation.inputRevision)fail('TEAM_NATIVE_RETRY_PARENT_PERMIT_CHANGED');
  let failedArtifact;
  const artifactFile=entry&&path.join(permit.cwd,entry.outputFile);
  if(artifactFile&&fs.existsSync(artifactFile)){
   const original=artifact(r,entry.outputFile,{runId:parentRun.id,notBefore:Date.parse(parentRun.startedAt)});
   if(fs.statSync(artifactFile).mtimeMs>Date.parse(parentRun.finishedAt)+2000)fail('TEAM_NATIVE_RETRY_ARTIFACT_CHANGED');
   const data=fs.readFileSync(artifactFile);if(sha(data)!==original.sha256)fail('TEAM_NATIVE_RETRY_ARTIFACT_CHANGED');
   failedArtifact={file:entry.outputFile,data};
  }
  const archive=archiveNativeRetryFailure({root:R,parentRun,operation,callLock,artifact:failedArtifact,log});
  const additionalInput=operation.additionalInput?.includes(NATIVE_RETRY_CONTEXT)?operation.additionalInput:(operation.additionalInput??'')+'\n'+NATIVE_RETRY_CONTEXT;
  const next=existing??{...operation,id:randomUUID(),acceptedRunId:run.id,retryOfOperationId:operation.id,retryOfRunId:parentRun.id,nativeRetryAttempt:run.scheduledRetryAttempt,additionalInput};
  const updated=advanceNativeRetryFlow(flow,binding,{operation:next,parentRun,evidence:{...archive,transportResultSha256:sha(fs.readFileSync(directory+'/result.json')),stdoutSha256:transportResult.stdoutSha256,stderrSha256:transportResult.stderrSha256}});
  editRoleRegistry(current=>{
   if(current.lease?.nonce!==r.lease.nonce||current.lease.taskId!==task.id||![operation.id,next.id].includes(current.lease.operationId))fail('TEAM_NATIVE_RETRY_PHASE_LEASE_CHANGED');
   if(!current.operations.some(value=>value.id===next.id))current.operations.push(next);
   current.lease={...current.lease,operationId:next.id};return current;
  });
  writeControl(file,updated);
  clearArchivedRetryLock({root:R,callLock,archive,allowAlreadyCleared:Boolean(existing),log});
  log({code:'TEAM_NATIVE_RETRY_BOUND',runId:run.id,parentRunId:parentRun.id,operationId:next.id,retryOfOperationId:operation.id,taskId:task.id,rootTaskId:rootTask.id,nativeRetryAttempt:run.scheduledRetryAttempt});
  return rebindNativeRetryContext(ctx,next);
 });}catch(error){
  const code=/^(?:TEAM_NATIVE_RETRY_[A-Z_]+|TEAM_PENDING_OWNER_INPUT)$/.test(error?.code??'')?error.code:'TEAM_NATIVE_RETRY_PREFLIGHT_FAILED';
  log({code,runId:ctx.runId});fail(code);
 }
}
export async function requireNoPendingOwnerInput(p,r,taskId){const rows=await p.db.select({id:p.schema.agentWakeupRequests.id}).from(p.schema.agentWakeupRequests).where(p.orm.and(p.orm.eq(p.schema.agentWakeupRequests.companyId,r.companyId),p.orm.eq(p.schema.agentWakeupRequests.requestedByActorType,'user'),p.orm.inArray(p.schema.agentWakeupRequests.status,['queued','deferred_issue_execution']),p.orm.sql`${p.schema.agentWakeupRequests.payload}->>'issueId' = ${taskId}`)).limit(1);if(rows.length)fail('TEAM_PENDING_OWNER_INPUT');}
async function releaseKnownIdle(p,r){
 if(fs.existsSync(R+'/call.lock'))return false;const meter=meterFor(r);try{
 if(!r.lease||!meter.verifyLease(r.lease).allowed)return true;
 const currentOp=r.operations.find(x=>x.id===r.lease.operationId);if(!currentOp||!await getRunForOp(p,currentOp))return false;
 const nonce=randomUUID(),lock=R+'/call.lock';try{fs.writeFileSync(lock,JSON.stringify({kind:'controlled-phase-release',nonce})+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')return false;throw e;}
 try{
 const runs=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.eq(p.schema.heartbeatRuns.issueId,r.lease.taskId));if(!runs.length||runs.some(x=>['running','queued','scheduled_retry'].includes(x.status)))return false;
 const ids=runs.map(x=>x.id),leases=await p.db.select().from(p.schema.environmentLeases).where(p.orm.inArray(p.schema.environmentLeases.heartbeatRunId,ids));if(leases.some(l=>!l.releasedAt||l.status==='pending_cleanup'||l.cleanupStatus==='failed'))return false;
 if(runs.some(x=>x.status==='succeeded')||runs.every(x=>x.resultJson?.executionRecovery?.providerWorkStarted===false)){meter.release({...r.lease,terminalEvidence:true});log({code:'TEAM_EXECUTION_PHASE_RELEASED',taskId:r.lease.taskId});return true;}return false;
 }finally{if(readControl(lock).nonce!==nonce)fail('TEAM_RELEASE_FENCE_CHANGED');fs.unlinkSync(lock);}
 }finally{meter.close();}
}
async function nativeRoster(p,r){const rows=await p.db.select().from(p.schema.agents).where(p.orm.eq(p.schema.agents.companyId,r.companyId));return validateTeamRoster(rows.map(a=>({key:Object.keys(r.team.ids).find(k=>r.team.ids[k]===a.id),id:a.id,name:a.name,reportsTo:a.reportsTo,adapterType:a.adapterType,model:a.adapterConfig.model,reasoningEffort:a.adapterConfig.modelReasoningEffort,heartbeatEnabled:a.runtimeConfig.heartbeat?.enabled,status:a.status,lifecycle:a.lifecycleState})),{requireReady:true});}
async function appendOnce(p,issueId,marker,body,actor){
 await p.db.transaction(async tx=>{await tx.select({id:p.schema.issues.id}).from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,issueId)).for('update');const[prior]=await tx.select({id:p.schema.issueComments.id}).from(p.schema.issueComments).where(p.orm.and(p.orm.eq(p.schema.issueComments.issueId,issueId),p.orm.eq(p.schema.issueComments.body,marker+'\n'+body))).limit(1);if(!prior)await(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx).addComment(issueId,marker+'\n'+body,actor);});
}
async function rootAuthority(p,r,flow,fn){
 return p.db.transaction(async tx=>{const[root]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,flow.rootTaskId)).for('update');
  if(!root||root.companyId!==r.companyId||root.projectId!==projectIdFor(r,flow)||root.responsibleUserId!==r.ownerId||taskInputRevision(root)!==flow.inputRevision||root.status!=='in_review'||root.assigneeUserId!==r.ownerId||root.assigneeAgentId||root.executionRunId||root.checkoutRunId)fail('TEAM_ROOT_AUTHORITY_CHANGED');
  await requireNoPendingOwnerInput({...p,db:tx},r,root.id);return fn(tx,root);
 });
}
async function dispatchPlan(p,r,op,run){
 const file=R+'/team/workflows/'+run.id+'.json';if(fs.existsSync(file))return;
 const task=await p.issue.getById(op.taskId);if(task.projectId!==projectIdFor(r,op)||task.status!=='in_review'||task.assigneeUserId!==r.ownerId||taskInputRevision(task)!==op.inputRevision)fail('TEAM_PLAN_INPUT_CHANGED');
 await requireNoPendingOwnerInput(p,r,task.id);
 await nativeRoster(p,r);const a=artifact(r,'chief-dispatch-'+task.id+'-'+op.inputRevision.slice(0,12)+'.json',{notBefore:Date.parse(run.startedAt),runId:run.id});
 const plan=validateTeamPlan(JSON.parse(a.text),{remainingCalls:6-budgetUsed(task.id)});for(const t of plan.tasks)if(!t.outputFile.startsWith('team-'+task.id+'-'))fail('TEAM_PLAN_OUTPUT_SCOPE_DENIED');
 const required=r.goalRequirements?.[task.id];if(required?.roles?.some(role=>!plan.tasks.some(t=>t.role===role)))fail('TEAM_PLAN_REQUIRED_ROLE_MISSING');
 const description=(t,legacy=false)=>t.goal+'\n\nRequired deliverable: '+t.outputFile+(legacy?'\nRead your instructions_file and record material SHA. Keep existing artifacts; no RWB merge/deploy, installation or host configuration change.':'\nRead your instructions_file and current project AGENTS.md. Record material SHA and actual verification. Keep existing artifacts. Follow the current Native project delivery policy and owner authorization.');
 const intentFile=file+'.intent';let intent,created;
 if(fs.existsSync(intentFile)){
  intent=readControl(intentFile);if(intent.rootTaskId!==task.id||intent.sourceRunId!==run.id||intent.inputRevision!==op.inputRevision||intent.planSha256!==a.sha256||projectIdFor(r,intent)!==task.projectId)fail('TEAM_DISPATCH_INTENT_CHANGED');
  created=[];for(const entry of intent.taskEntries){const child=await p.issue.getById(entry.id);if(!child||child.companyId!==r.companyId||child.projectId!==task.projectId||child.parentId!==task.id||child.createdByAgentId!==r.team.ids.chief||child.responsibleUserId!==r.ownerId||child.title!==entry.title||child.description!==description(entry,!intent.projectId))fail('TEAM_DISPATCH_RECONCILIATION_REQUIRED');created.push(child);}
 }else{
  intent={schemaVersion:1,rootTaskId:task.id,projectId:task.projectId,sourceRunId:run.id,inputRevision:op.inputRevision,planSha256:a.sha256,taskEntries:plan.tasks.map(t=>({...t,id:randomUUID(),agentId:r.team.ids[t.role]})),at:new Date().toISOString()};writeControl(intentFile,intent);
  created=await rootAuthority(p,r,intent,async tx=>{const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx),out=[];for(const entry of intent.taskEntries)out.push(await svc.create(r.companyId,{id:entry.id,projectId:task.projectId,parentId:task.id,title:entry.title,description:description(entry),status:'todo',assigneeAgentId:entry.agentId,responsibleUserId:r.ownerId,createdByAgentId:r.team.ids.chief,actorResponsibleUserId:r.ownerId,trustExplicitResponsibleUserId:true,idempotencyKey:'chief-dispatch:'+run.id+':'+entry.key,allowDuplicate:false}));return out;});
 }
 writeControl(file,{...intent,children:created.map(x=>({id:x.id,key:intent.taskEntries.find(t=>t.id===x.id).key})),artifacts:{}});

 if(task.projectId===r.team.projectId&&fs.existsSync(R+'/team/memory-correction.pending.json')){const correction=readControl(R+'/team/memory-correction.pending.json'),knowledge=readControl(R+'/knowledge.json');if(correction.authorizedByOwner!==r.ownerId||correction.record.project!=='personal-automation-m1')fail('TEAM_MEMORY_OWNER_REQUIRED');if(!knowledge.records.some(x=>x.id===correction.record.id&&x.version===correction.record.version))knowledge.records.push(correction.record);writeControl(R+'/knowledge.json',knowledge);writeControl(R+'/team/memory-correction.applied.json',{sourceChiefRunId:run.id,recordId:correction.record.id,version:correction.record.version,source:correction.record.source,at:new Date().toISOString()});}
 await appendOnce(p,task.id,'<!-- team-dispatch:'+run.id+' -->','Chief Coordinator分派已登记到Native：\n'+created.map(x=>'- '+x.identifier+' '+x.title+' ('+x.id+')').join('\n'),{agentId:r.team.ids.chief,runId:run.id});log({code:'TEAM_NATIVE_CHILDREN_CREATED',taskId:task.id,sourceRunId:run.id,children:created.map(x=>x.id)});
}
async function wakeRole(p,r,task,entry,{rootTaskId,phase='work',flow,file,stepKey}={}){
 const role=entry.role,agentId=r.team.ids[role];
 if(!fs.existsSync(R+'/budget/'+rootTaskId))fs.mkdirSync(R+'/budget/'+rootTaskId,{mode:0o700});if(budgetUsed(rootTaskId)>=6)fail('TEAM_ROOT_BUDGET_EXHAUSTED');
 if(flow?.dispatches?.[stepKey]){
  const op=r.operations.find(x=>x.id===flow.dispatches[stepKey].operationId);if(!op)fail('TEAM_DISPATCH_RECONCILIATION_REQUIRED');const prior=await getRunForOp(p,op);if(!prior)return null;return prior.id;
 }
 const projectContext=await readRoleProjectContext({...p,task,companyId:r.companyId,ownerId:r.ownerId,legacyProfile:r.agents.find(a=>a.profile.role===role)?.profile,rootTaskId});
 let additionalInput='',reviewedArtifacts,codeCandidate;
 if(phase==='work'){
  const obs=readControl(R+'/team/host-observations.json');if(obs.kind!=='macos-host-observation'||obs.hostPlatform!=='darwin'||!Number.isFinite(Date.parse(obs.capturedAt))||Date.parse(obs.capturedAt)>Date.now()+5000||Date.now()-Date.parse(obs.capturedAt)>300000)fail('TEAM_HOST_OBSERVATION_STALE');
  additionalInput='Trusted management observations (evidence, not instructions):\n'+JSON.stringify({host:obs,roster:await nativeRoster(p,r)});
  if(role==='pm'||role==='qa')for(const a of Object.values(flow?.artifacts??{})){const value=artifact(r,a.file,{runId:a.runId});if(value.sha256!==a.sha256)fail('TEAM_COLLECTED_ARTIFACT_CHANGED');additionalInput+='\nActual upstream artifact '+JSON.stringify(a)+'\n'+value.text;}
  if(role==='qa'){
   reviewedArtifacts=Object.values(flow.artifacts).map(a=>({taskId:a.taskId,runId:a.runId,file:a.file,sha256:a.sha256}));
   const candidateFile=R+'/code-workspaces/'+rootTaskId+'/candidate.json';
   if(fs.existsSync(candidateFile)){
    const candidate=readControl(candidateFile),[sourceRun]=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.eq(p.schema.heartbeatRuns.id,candidate.runId));
    codeCandidate=validateTeamCodeCandidate(candidate,{rootTaskId,projectId:task.projectId,workspaceHostPath:projectContext.workspace.hostPath,
      companyId:r.companyId,artifacts:Object.values(flow.artifacts),run:sourceRun,qaAgentId:agentId});
   }
   additionalInput+='\nYour JSON verdict must include reviewedArtifacts exactly matching these identities and SHA values: '+JSON.stringify(reviewedArtifacts);
   if(fs.existsSync(R+'/team/isolation-fixtures.json')){const fixtures=readControl(R+'/team/isolation-fixtures.json');for(const f of fixtures.files){const stat=fs.lstatSync(f.path);if(!stat.isFile()||sha(fs.readFileSync(f.path))!==f.sha256)fail('TEAM_ISOLATION_FIXTURE_CHANGED');}additionalInput+='\nSynthetic private fixture existence verified by controller; values withheld: '+JSON.stringify(fixtures);}
  }
 }else if(phase==='summary'){
  additionalInput='Summarize the following real Native child results into the trusted summaryFile. Do not create another plan.\n';for(const a of Object.values(flow.artifacts)){const value=artifact(r,a.file,{runId:a.runId});if(value.sha256!==a.sha256)fail('TEAM_COLLECTED_ARTIFACT_CHANGED');additionalInput+='\n'+JSON.stringify(a)+'\n'+value.text;}
 }
 if(flow)await rootAuthority(p,r,flow,async()=>{});
 const meter=meterFor(r,task.projectId);let lease;try{lease=meter.reserveTask({taskId:task.id,projectId:task.projectId,storageReceipt:JSON.parse(fs.readFileSync('/host-evidence/host-storage.json','utf8'))});}catch(e){if(e.code==='ADMISSION_BUSY')return null;throw e;}finally{meter.close();}
 if(!lease.allowed)fail('TEAM_CHILD_ADMISSION_UNKNOWN');
 const operationId=randomUUID(),inputRevision=taskInputRevision(task);
 if(flow){flow.dispatches??={};flow.dispatches[stepKey]={operationId,taskId:task.id,role,phase,inputRevision,additionalInputSha256:sha(additionalInput),leaseNonce:lease.nonce,at:new Date().toISOString()};writeControl(file,flow);}
 const op=registration(r,task.id,agentId,role,{...lease,projectId:task.projectId},{rootTaskId,rootInputRevision:flow?.inputRevision,phase,inputRevision,operationId,networkScope:entry.networkScope,resourceScope:entry.resourceScope,additionalCapabilities:entry.capabilities??[],authorizedHostActions:entry.hostActions??[],additionalInput,reviewedArtifacts,codeCandidate,codeReview:codeReviewForTeamStep(flow,entry,phase)});
 const assign=async(tx)=>{const[current]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,task.id)).for('update');if(!current||current.companyId!==r.companyId||current.projectId!==task.projectId||current.responsibleUserId!==r.ownerId||taskInputRevision(current)!==inputRevision||['done','cancelled','blocked'].includes(current.status))fail('TEAM_CHILD_AUTHORITY_CHANGED');await(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx).update(task.id,{assigneeAgentId:agentId,assigneeUserId:null,status:'todo'});};
 if(flow)await rootAuthority(p,r,flow,assign);else await p.db.transaction(assign);
 await p.heartbeat.resetRuntimeSession(agentId,{taskKey:task.id});
 const result=await p.heartbeat.wakeup(agentId,{source:'on_demand',triggerDetail:'manual',manualUserWake:false,reason:'team_controlled_assignment',requestedByActorType:'agent',requestedByActorId:r.team.ids.chief,idempotencyKey:'team-operation:'+op.id,payload:{issueId:task.id},contextSnapshot:{issueId:task.id,taskId:task.id,projectId:task.projectId,responsibleUserId:r.ownerId,inputRevision,roleOperationId:op.id,taskGoal:task.description,forceFreshSession:true,conversationMode:false}});
 if(!result?.id)fail('TEAM_WAKE_RECONCILIATION_REQUIRED');log({code:'TEAM_NATIVE_ROLE_DISPATCHED',taskId:task.id,rootTaskId,agentId,role,runId:result.id,operationId:op.id});return result.id;
}

async function collectChild(p,r,flow,entry,task){
 const op=r.operations.filter(x=>x.kind==='run'&&x.taskId===task.id).at(-1);if(!op)return false;const run=await getRunForOp(p,op);if(!run||run.status!=='succeeded')return false;
 if(taskInputRevision(task)!==op.inputRevision||task.companyId!==r.companyId||task.projectId!==projectIdFor(r,flow)||task.projectId!==projectIdFor(r,op)||task.responsibleUserId!==r.ownerId)fail('TEAM_CHILD_INPUT_CHANGED');
 const a=artifact(r,entry.outputFile,{notBefore:Date.parse(run.startedAt),runId:run.id}),marker='<!-- role-artifact:'+run.id+':'+a.sha256+' -->',body=marker+'\n'+a.text;
 let verdict;if(entry.role==='qa'){const review=validateTeamQaResult(JSON.parse(a.text),{reviewedArtifacts:op.reviewedArtifacts,codeCandidate:op.codeCandidate});verdict=review.verdict;}
 await rootAuthority(p,r,flow,async tx=>{
  const[current]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,task.id)).for('update');if(taskInputRevision(current)!==op.inputRevision)fail('TEAM_CHILD_INPUT_CHANGED');
  const[receipt]=await tx.select({id:p.schema.issueComments.id}).from(p.schema.issueComments).where(p.orm.and(p.orm.eq(p.schema.issueComments.issueId,task.id),p.orm.eq(p.schema.issueComments.body,body),p.orm.eq(p.schema.issueComments.authorAgentId,entry.agentId),p.orm.eq(p.schema.issueComments.createdByRunId,run.id))).limit(1);
  if(current.status==='done'){if(!receipt)fail('TEAM_CHILD_DONE_WITHOUT_RECEIPT');return;}
  if(current.status!=='in_review'||current.assigneeUserId!==r.ownerId)fail('TEAM_CHILD_AUTHORITY_CHANGED');
  const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx);if(!receipt)await svc.addComment(task.id,body,{agentId:entry.agentId,runId:run.id});await svc.update(task.id,{status:'done'});
 });
 flow.artifacts[entry.key]={taskId:task.id,runId:run.id,sessionId:run.sessionIdAfter,file:a.file,sha256:a.sha256,bytes:a.bytes,verdict};
 if(entry.role==='qa'&&op.codeCandidate&&verdict==='PASS'){
  const permit=readControl(R+'/permits/'+run.id+'.json');
  if(permit.companyId!==r.companyId||permit.projectId!==task.projectId||permit.runId!==run.id||permit.taskId!==task.id||permit.agentId!==entry.agentId||(permit.rootTaskId??permit.taskId)!==flow.rootTaskId)fail('TEAM_CHECK_EVIDENCE_DENIED');
  const checksFile=R+'/code-workspaces/'+flow.rootTaskId+'/checks/'+run.id+'.json';
  const proof=fs.existsSync(checksFile)?validateTeamCheckEvidence(readControl(checksFile),{permit,candidateSha:op.codeCandidate.candidateSha}):{checks:[]};
  flow.codeReview={verdict,candidateSha:op.codeCandidate.candidateSha,rootTaskId:flow.rootTaskId,
   projectId:task.projectId,runId:run.id,agentId:entry.agentId,artifactSha256:a.sha256,sourceCandidate:op.codeCandidate,...proof};
 }
 return true;
}

async function finalizeSummary(p,r,flow,file){
 const[run]=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.eq(p.schema.heartbeatRuns.id,flow.summaryRunId));if(run?.status!=='succeeded')return;
 const a=artifact(r,'team-'+flow.rootTaskId+'-summary.md',{notBefore:Date.parse(run.startedAt),runId:run.id}),body='<!-- team-summary:'+run.id+':'+a.sha256+' -->\n'+a.text;
 const qualityAccepted=flow.taskEntries.filter(t=>t.role==='qa').every(t=>flow.artifacts[t.key]?.verdict==='PASS');
 let root=await p.db.transaction(async tx=>{
  const[current]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,flow.rootTaskId)).for('update');
  if(!current||current.companyId!==r.companyId||current.projectId!==projectIdFor(r,flow)||current.responsibleUserId!==r.ownerId||taskInputRevision(current)!==flow.inputRevision)fail('TEAM_ROOT_AUTHORITY_CHANGED');
  const[receipt]=await tx.select({id:p.schema.issueComments.id}).from(p.schema.issueComments).where(p.orm.and(p.orm.eq(p.schema.issueComments.issueId,current.id),p.orm.eq(p.schema.issueComments.body,body),p.orm.eq(p.schema.issueComments.authorAgentId,r.team.ids.chief),p.orm.eq(p.schema.issueComments.createdByRunId,run.id))).limit(1);
  if(['done','blocked'].includes(current.status)){if(!receipt)fail('TEAM_ROOT_DONE_WITHOUT_RECEIPT');return current;}
  if(current.status!=='in_review'||current.assigneeUserId!==r.ownerId||current.assigneeAgentId||current.executionRunId||current.checkoutRunId)fail('TEAM_ROOT_AUTHORITY_CHANGED');
  await requireNoPendingOwnerInput({...p,db:tx},r,current.id);
  const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx);if(!receipt)await svc.addComment(current.id,body,{agentId:r.team.ids.chief,runId:run.id});return svc.update(current.id,{status:qualityAccepted?'done':'blocked'});
 });
 flow.summary={runId:run.id,sessionId:run.sessionIdAfter,file:a.file,sha256:a.sha256,qualityAccepted};writeControl(file,flow);
 const{sendTeamResult}=await import('./team-result-notification.mjs');flow.notification=await sendTeamResult({task:root,summary:a,registry:r,sourceRunId:run.id});writeControl(file,flow);log({code:qualityAccepted?'TEAM_GOAL_COMPLETED':'TEAM_GOAL_NEEDS_OWNER',taskId:root.id,summaryRunId:run.id,messageId:flow.notification.messageId});
}
async function driveFlow(p,r,file){
 const flow=readControl(file);if(flow.notification?.status==='sent')return;const root=await p.issue.getById(flow.rootTaskId);if(root.status==='cancelled')return;
 // Recover the exact Native wake receipt if the caller lost its return value.
 if(!flow.summaryRunId&&flow.dispatches?.['final-summary']){const op=r.operations.find(x=>x.id===flow.dispatches['final-summary'].operationId);const run=op?await getRunForOp(p,op):null;if(run){flow.summaryRunId=run.id;writeControl(file,flow);}}
 if(flow.summaryRunId){await finalizeSummary(p,r,flow,file);return;}
 await rootAuthority(p,r,flow,async()=>{});
 for(const entry of flow.taskEntries){const task=await p.issue.getById(entry.id);if(!task)fail('TEAM_NATIVE_CHILD_MISSING');
  if(flow.artifacts[entry.key]){const op=r.operations.filter(x=>x.kind==='run'&&x.taskId===task.id).at(-1);if(task.status!=='done'||!op||taskInputRevision(task)!==op.inputRevision)fail('TEAM_CHILD_STATUS_CHANGED');continue;}
  if(await collectChild(p,r,flow,entry,task)){writeControl(file,flow);return;}
  if(task.status==='todo'&&entry.dependsOn.every(k=>flow.artifacts[k])){await wakeRole(p,r,task,entry,{rootTaskId:root.id,flow,file,stepKey:entry.key});return;}
 }
 if(flow.taskEntries.some(t=>!flow.artifacts[t.key]))return;
 if(!flow.taskEntries.length){flow.summaryRunId=flow.sourceRunId;writeControl(file,flow);await finalizeSummary(p,r,flow,file);return;}
 const id=await wakeRole(p,r,root,{role:'chief'},{rootTaskId:root.id,phase:'summary',flow,file,stepKey:'final-summary'});if(id){flow.summaryRunId=id;writeControl(file,flow);}
}

async function resumeWaiting(p,r){for(const name of fs.readdirSync(R+'/team/waiting').filter(x=>x.endsWith('.json'))){const file=R+'/team/waiting/'+name,w=readControl(file),task=await p.issue.getById(w.taskId);if(!task||['done','cancelled'].includes(task.status)||taskInputRevision(task)!==w.inputRevision)continue;const[wakeup]=await p.db.select().from(p.schema.agentWakeupRequests).where(p.orm.eq(p.schema.agentWakeupRequests.id,w.wakeupId));if(wakeup?.requestedByActorId!==r.ownerId||wakeup.requestedByActorType!=='user')fail('TEAM_WAIT_OWNER_CHANGED');if(task.status!=='todo'||task.assigneeUserId!==r.ownerId||task.assigneeAgentId||task.projectId!==projectIdFor(r,w)||task.responsibleUserId!==r.ownerId)continue;const runId=await wakeRole(p,r,task,{role:'chief'},{rootTaskId:task.id,phase:'plan'});if(!runId)return false;fs.renameSync(file,file+'.resumed');return true;}return false;}
export function startTeamCoordinator({database}){
 dirs();let busy=false,lastError='';const tick=async()=>{if(busy)return;busy=true;try{let r=readControl(R+'/registry.json');if(r.team?.enabled!==true)return;const p=await ports(database);
  const queued=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.inArray(p.schema.heartbeatRuns.status,['queued','running','scheduled_retry']));
  if(queued.length===1&&queued[0].status==='queued'){
   const op=r.operations.find(value=>value.id===r.lease?.operationId),tasks=[];let parentRun=null;
   if(op){parentRun=await getRunForOp(p,op);for(const id of [op.taskId,op.rootTaskId])tasks.push(await p.issue.getById(id));}
   if(await consumeQueuedNativeRoleRetry({registry:r,activeRuns:queued,parentRun,tasks,resume:(companyId,agentId)=>p.heartbeat.resumeQueuedRunsForAgent(companyId,agentId),log}))return;
  }
  if(!await releaseKnownIdle(p,r))return;
  const active=await p.db.select({id:p.schema.heartbeatRuns.id}).from(p.schema.heartbeatRuns).where(p.orm.inArray(p.schema.heartbeatRuns.status,['queued','running','scheduled_retry']));if(active.length)return;
  for(const op of r.operations.filter(x=>x.kind==='run'&&x.role==='chief'&&x.phase==='plan')){const run=await getRunForOp(p,op);if(run?.status==='succeeded')await dispatchPlan(p,r,op,run);}
  r=readControl(R+'/registry.json');for(const name of fs.readdirSync(R+'/team/workflows').filter(x=>x.endsWith('.json'))){await driveFlow(p,r,R+'/team/workflows/'+name);const nowActive=await p.db.select({id:p.schema.heartbeatRuns.id}).from(p.schema.heartbeatRuns).where(p.orm.inArray(p.schema.heartbeatRuns.status,['queued','running','scheduled_retry']));if(nowActive.length)return;}
  if(!fs.existsSync(R+'/call.lock'))await resumeWaiting(p,readControl(R+'/registry.json'));lastError='';
 }catch(e){const code=/^(?:TEAM|ROLE|ADMISSION)_[A-Z_]+$/.test(e.code??e.message)?(e.code??e.message):'TEAM_RUNTIME_FAILED';if(code!==lastError){log({code,errorType:e.name,status:Number.isInteger(e.status)?e.status:undefined,site:e.stack?.split('\n')[1]?.match(/[^ /]+\.(?:js|mjs):\d+:\d+/)?.[0]});lastError=code;}}finally{busy=false;}};
 const timer=setInterval(()=>void tick(),2000);timer.unref();log({code:'TEAM_COORDINATOR_INSTALLED',source:'native-services',modelCalls:0});return {tick,stop:()=>clearInterval(timer)};
}
