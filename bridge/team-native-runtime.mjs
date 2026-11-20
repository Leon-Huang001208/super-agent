import{taskInputRevision}from'./task-input.mjs';
import fs from'node:fs';import path from'node:path';import{createHash,randomUUID}from'node:crypto';
import{AdmissionMeter}from'./admission.mjs';import{ROLE_ROOT as R,readControl,writeControl,editRoleRegistry}from'./role-control-store.mjs';
import{authorizeChiefOwnerInput,validateTeamPlan,validateTeamCodeCandidate,validateTeamQaResult,validateTeamCheckEvidence,codeReviewForTeamStep}from'./team-plan.mjs';import{TEAM_ROLES,validateTeamRoster}from'./team-roles.mjs';
import{readRoleProjectContext}from'./role-project-context.mjs';
import{teamContextEnabled,registryForContextRecord,projectForTask,projectForOperation,scopedRegistry,reconcileTeamDispatch,createTeamContextCoordinator,writeTeamArchive,buildTeamContinuationInput,observeTeamFlow,teamArtifactNames}from'./team-context.mjs';
const P='/opt/paperclip/node_modules',sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const log=e=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...e})+'\n',{mode:0o600});
const projectIdFor=(r,value)=>value?.projectId??r.team.projectId;
const workspace=(r,projectId=r.team.projectId)=>(r.contextProject?.projectId===projectId?r.contextProject.workspaceCwd:null)??'/paperclip/instances/default/projects/'+r.companyId+'/'+projectId+'/_default';
const scopeTask=(r,task,record)=>{if(record||!r.contextProject)r=registryForContextRecord(r,record);if(teamContextEnabled(r))return scopedRegistry(r,projectForTask(r,task,{log}),{log});if(!task||task.companyId!==r.companyId||task.responsibleUserId!==r.ownerId||!task.projectId)fail('TEAM_CONTEXT_NATIVE_SCOPE_DENIED');return {...r,team:{...r.team,projectId:task.projectId}};};
const scopeFlow=(r,flow,task)=>{r=registryForContextRecord(r,flow);if(teamContextEnabled(r))return scopedRegistry(r,projectForOperation(r,flow,{task,log}),{log});if(flow.projectId&&flow.projectId!==task?.projectId)fail('TEAM_CONTEXT_NATIVE_SCOPE_DENIED');return scopeTask(r,task);};
const projectFields=r=>teamContextEnabled(r)?{contextVersion:1,projectId:r.team.projectId,projectKey:r.contextProject.key,workspaceCwd:workspace(r),...(r.contextProject.projectWorkspaceId?{projectWorkspaceId:r.contextProject.projectWorkspaceId}:{})}:{};
function dirs(){for(const name of ['team','team/workflows','team/waiting','team/notifications','team/context-archive']){const p=R+'/'+name;if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))fail('TEAM_DIRECTORY_DENIED');}}
function archiveDirectory(flow){
 if(!/^[a-f0-9-]{36}$/.test(flow.rootTaskId??'')||!/^[a-f0-9]{64}$/.test(flow.inputRevision??''))fail('TEAM_CONTEXT_ARCHIVE_SCOPE_DENIED');
 let directory=R+'/team/context-archive';for(const part of [flow.rootTaskId,flow.inputRevision]){directory+='/'+part;if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))fail('TEAM_CONTEXT_ARCHIVE_SCOPE_DENIED');}return directory;
}
function archiveBytes(flow,name,bytes){
 return writeTeamArchive({root:R+'/team/context-archive',flow,name,bytes,log});
}
function snapshotArtifact(r,flow,value,runId){return flow.contextVersion===1?{...value,archiveFile:archiveBytes(flow,runId+'-'+value.file,Buffer.from(value.text))}:value;}
function flowArtifact(r,flow,ref){
 if(!ref.archiveFile)return artifact(r,ref.file,{runId:ref.runId,...(flow.contextVersion!==1?{historicalTaskId:ref.taskId??flow.rootTaskId}:{})});
 const expected=archiveDirectory(flow)+'/'+ref.runId+'-'+ref.file;if(ref.archiveFile!==expected)fail('TEAM_CONTEXT_ARCHIVE_SCOPE_DENIED');const s=fs.lstatSync(expected);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o077)||s.size>262144)fail('TEAM_CONTEXT_ARCHIVE_SCOPE_DENIED');const bytes=fs.readFileSync(expected);if(sha(bytes)!==ref.sha256)fail('TEAM_COLLECTED_ARTIFACT_CHANGED');return{file:ref.file,sha256:ref.sha256,bytes:bytes.length,text:bytes.toString('utf8'),archiveFile:expected};
}
async function archiveContextFlow({registry:r,flow,native:p}){
 if(!teamContextEnabled(r))return;archiveBytes(flow,flow.sourceRunId+'-flow.json',Buffer.from(JSON.stringify(flow)+'\n'));
 for(const ref of Object.values(flow.artifacts??{})){const value=flowArtifact(r,flow,ref);archiveBytes(flow,ref.runId+'-'+ref.file,Buffer.from(value.text));}
 if(flow.planArtifact){const ref=flow.planArtifact,value=flowArtifact(r,flow,ref);archiveBytes(flow,ref.runId+'-'+ref.file,Buffer.from(value.text));}
 if(flow.summary){const ref=flow.summary,value=flowArtifact(r,flow,ref);archiveBytes(flow,ref.runId+'-'+ref.file,Buffer.from(value.text));}
 const uncollected=[];
 if(p)for(const entry of flow.taskEntries??[]){if(flow.artifacts?.[entry.key])continue;const op=r.operations.filter(x=>x.kind==='run'&&x.taskId===entry.id&&x.rootTaskId===flow.rootTaskId&&x.rootInputRevision===flow.inputRevision).at(-1);if(!op)continue;
  const run=await getRunForOp(p,op),task=await p.issue.getById(entry.id);if(!run)continue;
  if(!['succeeded','failed','cancelled','timed_out'].includes(run.status)||!task||task.parentId!==flow.rootTaskId||task.companyId!==r.companyId||task.projectId!==r.team.projectId||task.responsibleUserId!==r.ownerId||taskInputRevision(task)!==op.inputRevision||run.issueId!==task.id||run.agentId!==op.agentId)fail('TEAM_CONTEXT_ARCHIVE_NATIVE_CHANGED');
  const record={taskId:task.id,runId:run.id,file:entry.outputFile,runStatus:run.status,acceptance:'not_collected'};
  try{if(!Number.isFinite(Date.parse(run.startedAt)))fail('TEAM_ARTIFACT_DENIED');const a=snapshotArtifact(r,flow,artifact(r,entry.outputFile,{runId:run.id,notBefore:Date.parse(run.startedAt)}),run.id);uncollected.push({...record,sha256:a.sha256,bytes:a.bytes,archiveFile:a.archiveFile});}
  catch(error){if(!['ENOENT','TEAM_ARTIFACT_DENIED'].includes(error.code))throw error;uncollected.push({...record,artifactState:'unavailable',code:error.code});log({code:'TEAM_CONTEXT_UNCOLLECTED_ARTIFACT_UNAVAILABLE',taskId:task.id,runId:run.id});}
 }
 if(uncollected.length)archiveBytes(flow,flow.sourceRunId+'-uncollected.json',Buffer.from(JSON.stringify({outputs:uncollected})+'\n'));
}
function continuationInput(r,flow,task){
 const additionalArtifacts=[];if(flow?.contextVersion===1){const pending=archiveDirectory(flow)+'/'+flow.sourceRunId+'-uncollected.json';if(fs.existsSync(pending))additionalArtifacts.push(...readControl(pending).outputs.filter(x=>x.archiveFile));}
 return buildTeamContinuationInput({task,flow,readArtifact:ref=>flowArtifact(r,flow,ref),additionalArtifacts});
}
function budgetUsed(root){const names=fs.readdirSync(R+'/budget/'+root);if(names.some(x=>!/^[-a-f0-9]{36}\.json$/.test(x)))fail('TEAM_BUDGET_RECORD_DENIED');return names.length;}
function registration(r,taskId,agentId,role,lease,{rootTaskId=taskId,rootInputRevision,phase='work',inputRevision,networkScope,resourceScope,additionalCapabilities=[],authorizedHostActions=[],codeCandidate,codeReview,operationId=randomUUID(),acceptedRunId,additionalInput,reviewedArtifacts,artifactGeneration}={}){
 const op={id:operationId,kind:'run',taskId,projectId:lease.projectId,agentId,role,rootTaskId,rootInputRevision,phase,inputRevision,networkScope,resourceScope,additionalCapabilities,authorizedHostActions,codeCandidate,codeReview,acceptedRunId,additionalInput,reviewedArtifacts,...projectFields(r),
  ...(artifactGeneration?{artifactGeneration,...teamArtifactNames({taskId:rootTaskId,inputRevision:rootInputRevision??inputRevision,generationId:artifactGeneration})}:{})};
 editRoleRegistry(current=>{current.tasks=[...new Set([...current.tasks,taskId,rootTaskId])];current.taskRoots??={};current.taskRoots[taskId]=rootTaskId;current.taskRoots[rootTaskId]=rootTaskId;current.taskId=taskId;current.lease={taskId,projectId:lease.projectId,nonce:lease.nonce,operationId:op.id};if(!current.operations.some(x=>x.id===op.id))current.operations.push(op);if(!fs.existsSync(R+'/budget/'+rootTaskId))fs.mkdirSync(R+'/budget/'+rootTaskId,{mode:0o700});return current;});return op;
}
function meterFor(r,projectId=r.lease?.projectId??r.team.projectId){return new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[projectId],log});}
export async function admitChiefInput(ctx,{database}){
 let r=readControl(R+'/registry.json');if(ctx.agent.id!==r.team?.ids?.chief||r.team.enabled!==true)fail('TEAM_CHIEF_NOT_ENABLED');dirs();
 const {db,schema:s,orm:o}=await database();let[task]=await db.select().from(s.issues).where(o.eq(s.issues.id,ctx.context.issueId));const[run]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ctx.runId));if(!task||!run)fail('TEAM_NATIVE_INPUT_MISSING');
 const[wakeup]=await db.select().from(s.agentWakeupRequests).where(o.eq(s.agentWakeupRequests.id,run.wakeupRequestId));const previousRuns=await db.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.issueId,task.id),o.ne(s.heartbeatRuns.id,run.id)));
 if(teamContextEnabled(r)&&!task.projectId)fail('TEAM_CONTEXT_NATIVE_SCOPE_DENIED');
 const contextControl=r.context?.enabled===true?await(await import('./chief-context-paperclip.mjs')).readManagedChiefContext({db,schema:s,orm:o,task,companyId:r.companyId,ownerId:r.ownerId}):null;
 r=scopeTask(r,task.projectId?task:{...task,projectId:r.team.projectId},contextControl?{contextVersion:1}:undefined);authorizeChiefOwnerInput({registry:r,task:task.projectId?task:{...task,projectId:r.team.projectId},run,wakeup,previousRuns});
 if(!task.projectId){const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db);task=await svc.update(task.id,{projectId:r.team.projectId});}
 await readRoleProjectContext({db,schema:s,orm:o,task,companyId:r.companyId,ownerId:r.ownerId,legacyProfile:r.agents.find(a=>a.profile.role==='chief')?.profile,rootTaskId:task.id});
 const meter=meterFor(r,task.projectId);let lease;
 try{lease=meter.reserveTask({taskId:task.id,projectId:task.projectId,storageReceipt:JSON.parse(fs.readFileSync('/host-evidence/host-storage.json','utf8'))});}
 catch(e){if(e.code!=='ADMISSION_BUSY')throw e;const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db);writeControl(R+'/team/waiting/'+task.id+'.json',{taskId:task.id,runId:run.id,wakeupId:wakeup.id,inputRevision:taskInputRevision(task),...projectFields(r),at:new Date().toISOString()});await svc.update(task.id,{status:'todo',assigneeAgentId:null,assigneeUserId:r.ownerId});fail('NATIVE_ROLE_GLOBAL_SLOT_BUSY');}
 finally{meter.close();}
 if(!lease?.allowed)fail('TEAM_ADMISSION_RECONCILIATION_REQUIRED');
 const inputRevision=taskInputRevision(task),op=registration(r,task.id,run.agentId,'chief',{...lease,projectId:task.projectId},{phase:'plan',inputRevision,acceptedRunId:run.id});
 log({code:'TEAM_CHIEF_OWNER_ADMITTED',taskId:task.id,runId:run.id,operationId:op.id,ownerWakeupId:wakeup.id});
 return {...ctx,context:{...ctx.context,issueId:task.id,taskId:task.id,projectId:task.projectId,responsibleUserId:r.ownerId,inputRevision,roleOperationId:op.id,taskGoal:task.description,conversationMode:false}};
}
function artifact(r,name,{notBefore=0,runId,historicalTaskId}={}){
 let base=workspace(r);if(runId){const permit=readControl(R+'/permits/'+runId+'.json');base=permit.cwd;
  if(historicalTaskId!==undefined){if(permit.runId!==runId||permit.taskId!==historicalTaskId||permit.companyId!==r.companyId||permit.projectId!==r.team.projectId||permit.ownerId!==r.ownerId||!TEAM_ROLES[permit.role]||base!==workspace(r)&&base!==R+'/workspaces/'+permit.role)fail('TEAM_ARTIFACT_WORKSPACE_DENIED');}
  else if(teamContextEnabled(r)){if(permit.projectId!==r.team.projectId||base!==workspace(r))fail('TEAM_ARTIFACT_WORKSPACE_DENIED');}else if(permit.companyId!==r.companyId||base!==workspace(r,permit.projectId)&&!Object.keys(TEAM_ROLES).some(k=>base===R+'/workspaces/'+k))fail('TEAM_ARTIFACT_WORKSPACE_DENIED');}
 if(!/^[a-z][a-z0-9-]{0,110}\.(md|json)$/.test(name??''))fail('TEAM_ARTIFACT_PATH_DENIED');const p=path.join(base,name),stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>262144||stat.mtimeMs+2000<notBefore)fail('TEAM_ARTIFACT_DENIED');const bytes=fs.readFileSync(p);if(bytes.includes(0))fail('TEAM_ARTIFACT_DENIED');return {file:name,sha256:sha(bytes),bytes:bytes.length,text:bytes.toString('utf8')};
}
async function ports(database){const data=await database();const issue=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(data.db);const heartbeat=(await import(P+'/@paperclipai/server/dist/services/heartbeat.js')).heartbeatService(data.db);return {...data,issue,heartbeat};}
async function getRunForOp(p,op){const file=R+'/operations/'+op.id+'.json';let id=op.acceptedRunId;if(fs.existsSync(file))id=readControl(file).runId;if(!id){const[w]=await p.db.select().from(p.schema.agentWakeupRequests).where(p.orm.eq(p.schema.agentWakeupRequests.idempotencyKey,'team-operation:'+op.id));id=w?.runId;}if(!id)return null;const[run]=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.eq(p.schema.heartbeatRuns.id,id));return run;}
async function requireNoPendingOwnerInput(p,r,taskId){const rows=await p.db.select({id:p.schema.agentWakeupRequests.id}).from(p.schema.agentWakeupRequests).where(p.orm.and(p.orm.eq(p.schema.agentWakeupRequests.companyId,r.companyId),p.orm.eq(p.schema.agentWakeupRequests.requestedByActorType,'user'),p.orm.inArray(p.schema.agentWakeupRequests.status,['queued','deferred_issue_execution']),p.orm.sql`${p.schema.agentWakeupRequests.payload}->>'issueId' = ${taskId}`)).limit(1);if(rows.length)fail('TEAM_PENDING_OWNER_INPUT');}
async function releaseKnownIdle(p,r){
 if(fs.existsSync(R+'/call.lock'))return false;if(r.lease){const held=await p.issue.getById(r.lease.taskId);if(!held)fail('TEAM_CONTEXT_LEASE_TASK_MISSING');r=scopeTask(r,held,r.operations.find(op=>op.id===r.lease.operationId));if(r.lease.projectId!==r.team.projectId)fail('TEAM_CONTEXT_LEASE_PROJECT_CHANGED');}const meter=meterFor(r);try{
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
async function rootAuthority(p,r,flow,fn,context){
 return p.db.transaction(async tx=>{const[root]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,flow.rootTaskId)).for('update');
  if(root)r=scopeFlow(r,flow,root);
  if(!root||root.companyId!==r.companyId||root.projectId!==r.team.projectId||root.responsibleUserId!==r.ownerId||taskInputRevision(root)!==flow.inputRevision||root.status!=='in_review'||root.assigneeUserId!==r.ownerId||root.assigneeAgentId||root.executionRunId||root.checkoutRunId)fail('TEAM_ROOT_AUTHORITY_CHANGED');
  if(context)await context.assertCurrent({registry:r,task:root,flow,transaction:{db:tx}});
  await requireNoPendingOwnerInput({...p,db:tx},r,root.id);return fn(tx,root);
 });
}
async function dispatchPlan(p,r,op,run,context){
 const file=R+'/team/workflows/'+run.id+'.json',saved=fs.existsSync(file)?readControl(file):null;
 if(saved&&saved.dispatched!==false)return;
 let task=await p.issue.getById(op.taskId);if(!task)fail('TEAM_NATIVE_ROOT_MISSING');r=scopeTask(r,task,op);projectForOperation(r,op,{task,log});if(!teamContextEnabled(r))context=null;
 const base=saved??{rootTaskId:task.id,projectId:task.projectId,sourceRunId:run.id,sourceOperationId:op.id,inputRevision:op.inputRevision,...projectFields(r),artifacts:{},
  ...(op.artifactGeneration?{artifactGeneration:op.artifactGeneration,planFile:op.planFile,summaryFile:op.summaryFile,outputPrefix:op.outputPrefix}:{})};
 const readStrictPlan=()=>{const value=base.planArtifact?flowArtifact(r,base,base.planArtifact):artifact(r,base.planFile??'chief-dispatch-'+task.id+'-'+op.inputRevision.slice(0,12)+'.json',{notBefore:Date.parse(run.startedAt),runId:run.id});
  const strict=validateTeamPlan(JSON.parse(value.text),{remainingCalls:6-budgetUsed(task.id)});if(base.artifactGeneration&&!strict.tasks.length)fail('TEAM_CONTEXT_REPLAN_EMPTY');for(const entry of strict.tasks){if(!entry.outputFile.startsWith(base.outputPrefix??'team-'+task.id+'-'))fail('TEAM_PLAN_OUTPUT_SCOPE_DENIED');if(teamContextEnabled(r)&&!r.contextProject.allowedRoles.includes(entry.role))fail('TEAM_CONTEXT_ROLE_DENIED');}return{artifact:value,plan:strict};};
 let read;if(context){read=readStrictPlan();const snapshot=snapshotArtifact(r,base,read.artifact,run.id);base.planArtifact={file:snapshot.file,sha256:snapshot.sha256,bytes:snapshot.bytes,runId:run.id,...(snapshot.archiveFile?{archiveFile:snapshot.archiveFile}:{})};}
 let control;
 if(context){const view=await context.inspect({registry:r,task,flow:base,file});task=view.task;r=view.registry;control=view.control;if(view.disposition==='superseded'){await resumeContextPlan(context,p,r,task,base,file);return;}if(!['ready','paused'].includes(view.disposition))return;}
 if(task.status!=='in_review'||task.assigneeUserId!==r.ownerId||taskInputRevision(task)!==op.inputRevision)fail('TEAM_PLAN_INPUT_CHANGED');
 if(!context){await requireNoPendingOwnerInput(p,r,task.id);await nativeRoster(p,r);}
 read??=readStrictPlan();const{artifact:a,plan}=read;
 const required=r.goalRequirements?.[task.id];if(required?.roles?.some(role=>!plan.tasks.some(t=>t.role===role)))fail('TEAM_PLAN_REQUIRED_ROLE_MISSING');
 const description=(t,legacy=false)=>t.goal+'\n\nRequired deliverable: '+t.outputFile+(legacy?'\nRead your instructions_file and record material SHA. Keep existing artifacts; no RWB merge/deploy, installation or host configuration change.':'\nRead your instructions_file and current project AGENTS.md. Record material SHA and actual verification. Keep existing artifacts. Follow the current Native project delivery policy and owner authorization.');
 const planArtifact=snapshotArtifact(r,base,a,run.id);
 const pending=saved??{...base,planSha256:a.sha256,taskEntries:plan.tasks.map(t=>({...t,id:randomUUID(),agentId:r.team.ids[t.role]})),
   children:[],artifacts:{},dispatched:false,reviewBeforeDispatch:control?.managed===true&&control.reviewBeforeDispatch===true,
   planArtifact:{file:a.file,sha256:a.sha256,bytes:a.bytes,runId:run.id,...(planArtifact.archiveFile?{archiveFile:planArtifact.archiveFile}:{})}};
 if(pending.planSha256!==a.sha256)fail('TEAM_DISPATCH_INTENT_CHANGED');
 if(context&&!saved)writeControl(file,pending);
 const perform=async()=>{
 if(context)await nativeRoster(p,r);
 const intentFile=file+'.intent';let intent,created;
 if(fs.existsSync(intentFile)){
  intent=readControl(intentFile);if(intent.rootTaskId!==task.id||intent.sourceRunId!==run.id||intent.inputRevision!==op.inputRevision||intent.planSha256!==a.sha256)fail('TEAM_DISPATCH_INTENT_CHANGED');
  created=[];for(const entry of intent.taskEntries){const child=await p.issue.getById(entry.id);if(!child||child.companyId!==r.companyId||child.projectId!==r.team.projectId||r.contextProject?.projectWorkspaceId&&child.projectWorkspaceId!==r.contextProject.projectWorkspaceId||child.parentId!==task.id||child.createdByAgentId!==r.team.ids.chief||child.responsibleUserId!==r.ownerId||child.title!==entry.title||child.description!==description(entry,!intent.projectId))fail('TEAM_DISPATCH_RECONCILIATION_REQUIRED');created.push(child);}
 }else{
  intent={...pending,schemaVersion:1,at:new Date().toISOString()};writeControl(intentFile,intent);
  created=await rootAuthority(p,r,intent,async tx=>{const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx),out=[];for(const entry of intent.taskEntries)out.push(await svc.create(r.companyId,{id:entry.id,projectId:r.team.projectId,...(r.contextProject?.projectWorkspaceId?{projectWorkspaceId:r.contextProject.projectWorkspaceId}:{}),parentId:task.id,title:entry.title,description:description(entry),status:'todo',assigneeAgentId:entry.agentId,responsibleUserId:r.ownerId,createdByAgentId:r.team.ids.chief,actorResponsibleUserId:r.ownerId,trustExplicitResponsibleUserId:true,idempotencyKey:'chief-dispatch:'+run.id+':'+entry.key,allowDuplicate:false}));return out;},context);
 }
 writeControl(file,{...intent,dispatched:true,children:created.map(x=>({id:x.id,key:intent.taskEntries.find(t=>t.id===x.id).key})),artifacts:{}});

 if(!teamContextEnabled(r)&&fs.existsSync(R+'/team/memory-correction.pending.json')){const correction=readControl(R+'/team/memory-correction.pending.json'),knowledge=readControl(R+'/knowledge.json');if(correction.authorizedByOwner!==r.ownerId||correction.record.project!=='personal-automation-m1')fail('TEAM_MEMORY_OWNER_REQUIRED');if(!knowledge.records.some(x=>x.id===correction.record.id&&x.version===correction.record.version))knowledge.records.push(correction.record);writeControl(R+'/knowledge.json',knowledge);writeControl(R+'/team/memory-correction.applied.json',{sourceChiefRunId:run.id,recordId:correction.record.id,version:correction.record.version,source:correction.record.source,at:new Date().toISOString()});}
 await appendOnce(p,task.id,'<!-- team-dispatch:'+run.id+' -->','Chief Coordinator分派已登记到Native：\n'+created.map(x=>'- '+x.identifier+' '+x.title+' ('+x.id+')').join('\n'),{agentId:r.team.ids.chief,runId:run.id});log({code:'TEAM_NATIVE_CHILDREN_CREATED',taskId:task.id,sourceRunId:run.id,children:created.map(x=>x.id)});
 };
 if(context)await context.dispatchPlan({registry:r,task,flow:pending,file,runId:run.id,artifact:a,dispatch:perform});else await perform();
}
async function wakeRole(p,r,task,entry,{rootTaskId,phase='work',flow,file,stepKey,operationId:requestedOperationId,reconstruction='',context,artifactGeneration=flow?.artifactGeneration}={}){
 r=scopeTask(r,task);if(flow)projectForOperation(r,flow,{task,log});
 const role=entry.role,agentId=r.team.ids[role];
 const existingId=flow?.dispatches?.[stepKey]?.operationId??requestedOperationId;
 const latest=readControl(R+'/registry.json'),existing=existingId?latest.operations.find(x=>x.id===existingId):null;
 if(flow?.dispatches?.[stepKey]&&!existing)fail('TEAM_DISPATCH_RECONCILIATION_REQUIRED');
 if(existing){if(existing.taskId!==task.id||existing.rootTaskId!==rootTaskId||existing.role!==role||existing.phase!==phase||existing.inputRevision!==taskInputRevision(task))fail('TEAM_DISPATCH_RECONCILIATION_REQUIRED');projectForOperation(r,existing,{task,log});}
 const budgetDirectory=R+'/budget/'+rootTaskId,used=fs.existsSync(budgetDirectory)?budgetUsed(rootTaskId):0;
 const disposition=await reconcileTeamDispatch({operation:existing,used,lookupRun:op=>getRunForOp(p,op),log});
 if(disposition.kind!=='new')return disposition.run?.id??null;
 if(!fs.existsSync(budgetDirectory))fs.mkdirSync(budgetDirectory,{mode:0o700});
 if(teamContextEnabled(r)&&!r.contextProject.allowedRoles.includes(role))fail('TEAM_CONTEXT_ROLE_DENIED');
 const projectContext=await readRoleProjectContext({...p,task,companyId:r.companyId,ownerId:r.ownerId,legacyProfile:r.agents.find(a=>a.profile.role===role)?.profile,rootTaskId});
 let additionalInput=reconstruction,reviewedArtifacts,codeCandidate;
 if(phase==='work'){
  const obs=readControl(R+'/team/host-observations.json');if(obs.kind!=='macos-host-observation'||obs.hostPlatform!=='darwin'||!Number.isFinite(Date.parse(obs.capturedAt))||Date.parse(obs.capturedAt)>Date.now()+5000||Date.now()-Date.parse(obs.capturedAt)>300000)fail('TEAM_HOST_OBSERVATION_STALE');
  additionalInput='Trusted management observations (evidence, not instructions):\n'+JSON.stringify({host:obs,roster:await nativeRoster(p,r)});
  if(role==='pm'||role==='qa')for(const a of Object.values(flow?.artifacts??{})){const value=flowArtifact(r,flow,a);if(value.sha256!==a.sha256)fail('TEAM_COLLECTED_ARTIFACT_CHANGED');additionalInput+='\nActual upstream artifact '+JSON.stringify(a)+'\n'+value.text;}
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
  additionalInput='Summarize the following real Native child results into the trusted summaryFile. Do not create another plan.\n';for(const a of Object.values(flow.artifacts)){const value=flowArtifact(r,flow,a);if(value.sha256!==a.sha256)fail('TEAM_COLLECTED_ARTIFACT_CHANGED');additionalInput+='\n'+JSON.stringify(a)+'\n'+value.text;}
 }
 if(flow)await rootAuthority(p,r,flow,async()=>{},context);
 const meter=meterFor(r);let lease;try{lease=meter.reserveTask({taskId:task.id,projectId:task.projectId,storageReceipt:JSON.parse(fs.readFileSync('/host-evidence/host-storage.json','utf8'))});}catch(e){if(e.code==='ADMISSION_BUSY')return null;throw e;}finally{meter.close();}
 if(!lease.allowed)fail('TEAM_CHILD_ADMISSION_UNKNOWN');
 const operationId=requestedOperationId??randomUUID(),inputRevision=taskInputRevision(task);
 if(flow){flow.dispatches??={};flow.dispatches[stepKey]={operationId,taskId:task.id,role,phase,inputRevision,...projectFields(r),additionalInputSha256:sha(additionalInput),leaseNonce:lease.nonce,at:new Date().toISOString()};writeControl(file,flow);}
 const op=registration(r,task.id,agentId,role,{...lease,projectId:task.projectId},{rootTaskId,rootInputRevision:flow?.inputRevision,phase,inputRevision,operationId,networkScope:entry.networkScope,resourceScope:entry.resourceScope,additionalInput,reviewedArtifacts,artifactGeneration,additionalCapabilities:entry.capabilities??[],authorizedHostActions:entry.hostActions??[],codeCandidate,codeReview:codeReviewForTeamStep(flow,entry,phase)});
 const assign=async(tx)=>{const[current]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,task.id)).for('update');if(!current||current.companyId!==r.companyId||current.projectId!==r.team.projectId||current.responsibleUserId!==r.ownerId||taskInputRevision(current)!==inputRevision||['done','cancelled','blocked'].includes(current.status))fail('TEAM_CHILD_AUTHORITY_CHANGED');if(context&&!flow)await context.assertCurrent({registry:r,task:current,flow:{rootTaskId,inputRevision,...projectFields(r),phase:'plan'},transaction:{db:tx}});await(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx).update(task.id,{assigneeAgentId:agentId,assigneeUserId:null,status:'todo'});};
 if(flow)await rootAuthority(p,r,flow,assign,context);else await p.db.transaction(assign);
 await p.heartbeat.resetRuntimeSession(agentId,{taskKey:task.id});
 const result=await p.heartbeat.wakeup(agentId,{source:'on_demand',triggerDetail:'manual',manualUserWake:false,reason:'team_controlled_assignment',requestedByActorType:'agent',requestedByActorId:r.team.ids.chief,idempotencyKey:'team-operation:'+op.id,payload:{issueId:task.id},contextSnapshot:{issueId:task.id,taskId:task.id,projectId:task.projectId,responsibleUserId:r.ownerId,inputRevision,roleOperationId:op.id,taskGoal:task.description,forceFreshSession:true,conversationMode:false}});
 if(!result?.id)fail('TEAM_WAKE_RECONCILIATION_REQUIRED');log({code:'TEAM_NATIVE_ROLE_DISPATCHED',taskId:task.id,rootTaskId,agentId,role,runId:result.id,operationId:op.id});return result.id;
}

async function collectChild(p,r,flow,entry,task,context){
 r=scopeTask(r,task);projectForOperation(r,flow,{task,log});
 const op=r.operations.filter(x=>x.kind==='run'&&x.taskId===task.id).at(-1);if(!op)return false;const run=await getRunForOp(p,op);if(!run||run.status!=='succeeded')return false;
 if(taskInputRevision(task)!==op.inputRevision||task.companyId!==r.companyId||task.projectId!==r.team.projectId||task.responsibleUserId!==r.ownerId)fail('TEAM_CHILD_INPUT_CHANGED');
 const a=snapshotArtifact(r,flow,artifact(r,entry.outputFile,{notBefore:Date.parse(run.startedAt),runId:run.id}),run.id),marker='<!-- role-artifact:'+run.id+':'+a.sha256+' -->',body=marker+'\n'+a.text;
 let verdict;if(entry.role==='qa'){const review=validateTeamQaResult(JSON.parse(a.text),{reviewedArtifacts:op.reviewedArtifacts,codeCandidate:op.codeCandidate});verdict=review.verdict;}
 await rootAuthority(p,r,flow,async tx=>{
  const[current]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,task.id)).for('update');if(taskInputRevision(current)!==op.inputRevision)fail('TEAM_CHILD_INPUT_CHANGED');
  const[receipt]=await tx.select({id:p.schema.issueComments.id}).from(p.schema.issueComments).where(p.orm.and(p.orm.eq(p.schema.issueComments.issueId,task.id),p.orm.eq(p.schema.issueComments.body,body),p.orm.eq(p.schema.issueComments.authorAgentId,entry.agentId),p.orm.eq(p.schema.issueComments.createdByRunId,run.id))).limit(1);
  if(current.status==='done'){if(!receipt)fail('TEAM_CHILD_DONE_WITHOUT_RECEIPT');return;}
  if(current.status!=='in_review'||current.assigneeUserId!==r.ownerId)fail('TEAM_CHILD_AUTHORITY_CHANGED');
  const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx);if(!receipt)await svc.addComment(task.id,body,{agentId:entry.agentId,runId:run.id});await svc.update(task.id,{status:'done'});
 },context);
 flow.artifacts[entry.key]={taskId:task.id,runId:run.id,sessionId:run.sessionIdAfter,file:a.file,sha256:a.sha256,bytes:a.bytes,verdict,...(a.archiveFile?{archiveFile:a.archiveFile}:{})};

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

async function finalizeSummary(p,r,flow,file,context){
 const rootTask=await p.issue.getById(flow.rootTaskId);if(!rootTask)fail('TEAM_NATIVE_ROOT_MISSING');r=scopeFlow(r,flow,rootTask);
 const[run]=await p.db.select().from(p.schema.heartbeatRuns).where(p.orm.eq(p.schema.heartbeatRuns.id,flow.summaryRunId));if(run?.status!=='succeeded')return;
 const a=snapshotArtifact(r,flow,artifact(r,flow.summaryFile??'team-'+flow.rootTaskId+'-summary.md',{notBefore:Date.parse(run.startedAt),runId:run.id}),run.id),body='<!-- team-summary:'+run.id+':'+a.sha256+' -->\n'+a.text;
 const qualityAccepted=flow.taskEntries.filter(t=>t.role==='qa').every(t=>flow.artifacts[t.key]?.verdict==='PASS');
 let root=await p.db.transaction(async tx=>{
  const[current]=await tx.select().from(p.schema.issues).where(p.orm.eq(p.schema.issues.id,flow.rootTaskId)).for('update');
  if(!current||current.companyId!==r.companyId||current.projectId!==projectIdFor(r,flow)||current.responsibleUserId!==r.ownerId||taskInputRevision(current)!==flow.inputRevision)fail('TEAM_ROOT_AUTHORITY_CHANGED');
  const[receipt]=await tx.select({id:p.schema.issueComments.id}).from(p.schema.issueComments).where(p.orm.and(p.orm.eq(p.schema.issueComments.issueId,current.id),p.orm.eq(p.schema.issueComments.body,body),p.orm.eq(p.schema.issueComments.authorAgentId,r.team.ids.chief),p.orm.eq(p.schema.issueComments.createdByRunId,run.id))).limit(1);
  if(['done','blocked'].includes(current.status)){if(!receipt)fail('TEAM_ROOT_DONE_WITHOUT_RECEIPT');return current;}
  if(current.status!=='in_review'||current.assigneeUserId!==r.ownerId||current.assigneeAgentId||current.executionRunId||current.checkoutRunId)fail('TEAM_ROOT_AUTHORITY_CHANGED');
  if(context)await context.assertCurrent({registry:r,task:current,flow,transaction:{db:tx}});
  await requireNoPendingOwnerInput({...p,db:tx},r,current.id);
  const svc=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(tx);if(!receipt)await svc.addComment(current.id,body,{agentId:r.team.ids.chief,runId:run.id});return svc.update(current.id,{status:qualityAccepted?'done':'blocked'});
 });
 flow.summary={runId:run.id,sessionId:run.sessionIdAfter,file:a.file,sha256:a.sha256,qualityAccepted,...(a.archiveFile?{archiveFile:a.archiveFile}:{})};writeControl(file,flow);
 const{sendTeamResult}=await import('./team-result-notification.mjs');flow.notification=await sendTeamResult({task:root,summary:a,registry:r,sourceRunId:run.id});writeControl(file,flow);log({code:qualityAccepted?'TEAM_GOAL_COMPLETED':'TEAM_GOAL_NEEDS_OWNER',taskId:root.id,summaryRunId:run.id,messageId:flow.notification.messageId});
}
async function resumeContextPlan(context,p,r,task,flow,file){
 if(!context)return null;const used=fs.existsSync(R+'/budget/'+task.id)?budgetUsed(task.id):0;
 return context.resumePlan({registry:readControl(R+'/registry.json'),task,flow,file,used,
  lookupRun:op=>getRunForOp(p,op),wake:view=>wakeRole(p,view.registry,view.task,{role:'chief'},
   {rootTaskId:view.task.id,phase:'plan',operationId:view.operationId,artifactGeneration:view.artifactGeneration,reconstruction:continuationInput(r,flow,view.task),context})});
}
async function driveFlow(p,r,file,context){
 const flow=readControl(file);r=registryForContextRecord(r,flow);if(!teamContextEnabled(r)){context=null;const task=await p.issue.getById(flow.rootTaskId);r=scopeFlow(r,flow,task);}
 const view=await observeTeamFlow({registry:r,flow,file,readTask:id=>p.issue.getById(id),context,log});let root=view.task;r=view.registry;
 if(view.delivered||root.status==='cancelled')return;
 if(context){if(view.disposition==='retired')return;if(view.disposition==='superseded'||view.resumeRequired){await resumeContextPlan(context,p,r,root,flow,file);return;}if(view.disposition==='paused')return;if(view.disposition==='terminal'&&!flow.summaryRunId)return;}
 if(flow.dispatched===false){const op=r.operations.find(x=>x.kind==='run'&&x.acceptedRunId===flow.sourceRunId||x.kind==='run'&&x.id===flow.sourceOperationId);let source=op;if(!source)for(const candidate of r.operations.filter(x=>x.kind==='run'&&x.role==='chief'&&x.taskId===flow.rootTaskId&&x.phase==='plan')){if((await getRunForOp(p,candidate))?.id===flow.sourceRunId){source=candidate;break;}}if(!source)fail('TEAM_DISPATCH_RECONCILIATION_REQUIRED');const prior=await getRunForOp(p,source);if(prior?.status==='succeeded')await dispatchPlan(p,r,source,prior,context);return;}
 // Recover the exact Native wake receipt if the caller lost its return value.
 if(!flow.summaryRunId&&flow.dispatches?.['final-summary']){const op=r.operations.find(x=>x.id===flow.dispatches['final-summary'].operationId);const run=op?await getRunForOp(p,op):null;if(run){flow.summaryRunId=run.id;writeControl(file,flow);}}
 if(flow.summaryRunId){await finalizeSummary(p,r,flow,file,context);return;}
 await rootAuthority(p,r,flow,async()=>{},context);
 for(const entry of flow.taskEntries){const task=await p.issue.getById(entry.id);if(!task)fail('TEAM_NATIVE_CHILD_MISSING');
  if(flow.artifacts[entry.key]){const op=r.operations.filter(x=>x.kind==='run'&&x.taskId===task.id).at(-1);if(task.status!=='done'||!op||taskInputRevision(task)!==op.inputRevision)fail('TEAM_CHILD_STATUS_CHANGED');continue;}
  if(await collectChild(p,r,flow,entry,task,context)){writeControl(file,flow);return;}
  if(task.status==='todo'&&entry.dependsOn.every(k=>flow.artifacts[k])){await wakeRole(p,r,task,entry,{rootTaskId:root.id,flow,file,stepKey:entry.key,context});return;}
 }
 if(flow.taskEntries.some(t=>!flow.artifacts[t.key]))return;
 if(!flow.taskEntries.length){flow.summaryRunId=flow.sourceRunId;writeControl(file,flow);await finalizeSummary(p,r,flow,file,context);return;}
 const id=await wakeRole(p,r,root,{role:'chief'},{rootTaskId:root.id,phase:'summary',flow,file,stepKey:'final-summary',context});if(id){flow.summaryRunId=id;writeControl(file,flow);}
}

async function resumeWaiting(p,r,context){
 for(const name of fs.readdirSync(R+'/team/waiting').filter(x=>x.endsWith('.json'))){
  const file=R+'/team/waiting/'+name,w=readControl(file);let task=await p.issue.getById(w.taskId);if(!task||['done','cancelled'].includes(task.status))continue;
  let scoped=scopeTask(r,task,w);projectForOperation(scoped,w,{task,log});const localContext=teamContextEnabled(scoped)?context:null;
  if(localContext){const flow={...w,rootTaskId:task.id,sourceRunId:w.runId},view=await localContext.inspect({registry:scoped,task,flow,file});task=view.task;scoped=view.registry;if(view.disposition==='superseded'){const result=await resumeContextPlan(localContext,p,scoped,task,flow,file);if(result?.runId){fs.renameSync(file,file+'.resumed');return true;}continue;}if(view.disposition!=='ready')continue;}
  if(taskInputRevision(task)!==w.inputRevision)continue;
  const[wakeup]=await p.db.select().from(p.schema.agentWakeupRequests).where(p.orm.eq(p.schema.agentWakeupRequests.id,w.wakeupId));if(wakeup?.requestedByActorId!==scoped.ownerId||wakeup.requestedByActorType!=='user')fail('TEAM_WAIT_OWNER_CHANGED');
  if(task.status!=='todo'||task.assigneeUserId!==scoped.ownerId||task.assigneeAgentId||task.projectId!==scoped.team.projectId||task.responsibleUserId!==scoped.ownerId)continue;
  const runId=await wakeRole(p,scoped,task,{role:'chief'},{rootTaskId:task.id,phase:'plan',context:localContext});if(!runId)return false;fs.renameSync(file,file+'.resumed');return true;
 }return false;
}
export function startTeamCoordinator({database,contextRuntime}){
 dirs();let busy=false,lastError='',contextPort;
 const contextFor=async(r,p)=>{if(!teamContextEnabled(r))return null;if(!contextPort)contextPort=await(contextRuntime??(await import('./chief-context-native.mjs')).createChiefContextRuntime({database}));return createTeamContextCoordinator({...contextPort,archiveFlow:args=>archiveContextFlow({...args,native:p}),log});};
 const activeRuns=p=>p.db.select({id:p.schema.heartbeatRuns.id}).from(p.schema.heartbeatRuns).where(p.orm.inArray(p.schema.heartbeatRuns.status,['queued','running','scheduled_retry']));
 const tick=async()=>{if(busy)return;busy=true;try{let r=readControl(R+'/registry.json');if(r.team?.enabled!==true)return;const p=await ports(database);
  if(!await releaseKnownIdle(p,r))return;
  if((await activeRuns(p)).length)return;const context=await contextFor(r,p);
  for(const op of r.operations.filter(x=>x.kind==='run'&&x.role==='chief'&&x.phase==='plan')){const run=await getRunForOp(p,op);if(run?.status==='succeeded')await dispatchPlan(p,r,op,run,context);if((await activeRuns(p)).length)return;}
  r=readControl(R+'/registry.json');for(const name of fs.readdirSync(R+'/team/workflows').filter(x=>x.endsWith('.json'))){await driveFlow(p,r,R+'/team/workflows/'+name,context);if((await activeRuns(p)).length)return;}
  if(!fs.existsSync(R+'/call.lock'))await resumeWaiting(p,readControl(R+'/registry.json'),context);lastError='';
 }catch(e){const code=/^(?:TEAM|ROLE|ADMISSION|CONTEXT_PROJECT|CHIEF_CONTEXT|CONTEXT_NATIVE)_[A-Z_]+$/.test(e.code??e.message)?(e.code??e.message):'TEAM_RUNTIME_FAILED';if(code!==lastError){log({code,errorType:e.name,status:Number.isInteger(e.status)?e.status:undefined,site:e.stack?.split('\n')[1]?.match(/[^ /]+\.(?:js|mjs):\d+:\d+/)?.[0]});lastError=code;}}finally{busy=false;}};
 const timer=setInterval(()=>void tick(),2000);timer.unref();log({code:'TEAM_COORDINATOR_INSTALLED',source:'native-services',modelCalls:0});return {tick,stop:()=>clearInterval(timer)};
}
