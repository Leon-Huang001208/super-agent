import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {taskInputRevision} from './task-input.mjs';
import {rootCallLimit} from './task-call-policy.mjs';
import {qaRepairStep} from './team-qa-repair.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>/^[a-f0-9]{64}$/.test(value??'');
const ended=value=>Number.isFinite(Date.parse(value));
export const NATIVE_RETRY_CONTEXT='Resuming the same Native task after a settled failed attempt; preserve earlier failure evidence. Current tool availability and approval configuration can differ from the prior attempt; use this run’s actual tool results, keep the original goal/scope and root budget.';
export function rebindNativeRetryContext(ctx,operation){return {...ctx,context:{...ctx.context,roleOperationId:operation.id}};}

const childBootstrapFail=code=>fail('TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_'+code);
export const childBootstrapEvidenceCode=error=>/^TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_[A-Z_]+$/.test(error?.code??'')?
 error.code:'TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_EVIDENCE_UNAVAILABLE';
/** Native context locates the original operation before any physical binding exists. */
export function childBootstrapOperation(registry,parent){
 if(parent?.errorCode!=='NATIVE_ROLE_PRIVATE_FILE_DENIED')return null;
 const roles=registry?.agents?.filter(entry=>entry.profile?.agentId===parent.agentId);
 if(roles?.length!==1)childBootstrapFail('OPERATION_DENIED');
 const role=roles[0].profile;if(role.role==='chief')return null;
 const matches=registry.operations?.filter(op=>op.id===parent.contextSnapshot?.roleOperationId)??[];
 if(matches.length!==1||matches[0].kind!=='run'||matches[0].phase!=='work'||matches[0].role!==role.role||matches[0].taskId!==parent.issueId||matches[0].agentId!==parent.agentId)childBootstrapFail('OPERATION_DENIED');
 return matches[0];
}

/** No permit, claim, transport, spent slot or replacement operation is synthesized. */
export function bindUnstartedChildRetry({root,ctx,registry:r,operation:op,rootTask,task,flow,parentRun:parent,run,wakeup,activeRuns,taskRuns,leases,verifyPhaseLease,log}){
 if(!parent||parent.status!=='failed'||parent.exitCode!==1||parent.errorCode!=='NATIVE_ROLE_PRIVATE_FILE_DENIED'||!ended(parent.finishedAt)||parent.retryOfRunId||
  (parent.scheduledRetryAttempt??0)!==0||parent.resultJson?.executionRecovery?.kind!=='bootstrap'||parent.resultJson.executionRecovery.providerWorkStarted!==false||
  run?.status!=='running'||run.retryOfRunId!==parent.id||run.scheduledRetryAttempt!==1||run.finishedAt)childBootstrapFail('NATIVE_PROOF_DENIED');
 if(r?.enabled!==true||r.team?.enabled!==true||!op||!equal(op,childBootstrapOperation(r,parent))||op.retryOfRunId!==undefined||op.retryOfOperationId!==undefined||op.nativeRetryAttempt!==undefined||
  op.acceptedRunId!==undefined||!rootTask||!task||task.id!==op.taskId||rootTask.id!==op.rootTaskId||task.parentId!==rootTask.id||
  [task,rootTask].some(value=>value.companyId!==r.companyId||value.projectId!==op.projectId||value.responsibleUserId!==r.ownerId)||
  rootTask.status!=='in_review'||rootTask.assigneeUserId!==r.ownerId||rootTask.assigneeAgentId||rootTask.executionRunId||rootTask.checkoutRunId||
  !['todo','in_progress'].includes(task.status)||task.assigneeAgentId!==op.agentId||task.assigneeUserId||task.executionRunId&&task.executionRunId!==run.id||task.checkoutRunId&&task.checkoutRunId!==run.id||
  r.team.ids?.[op.role]!==op.agentId||r.taskRoots?.[task.id]!==rootTask.id||!r.tasks?.includes(task.id)||!r.tasks.includes(rootTask.id)||
  taskInputRevision(task)!==op.inputRevision||taskInputRevision(rootTask)!==op.rootInputRevision||flow?.inputRevision!==op.rootInputRevision||
  [run,parent].some(value=>value.companyId!==r.companyId||value.issueId!==task.id||value.agentId!==op.agentId||value.responsibleUserId!==r.ownerId)||
  ctx.runId!==run.id||ctx.agent?.id!==op.agentId||
  wakeup?.id!==parent.wakeupRequestId||wakeup.runId!==parent.id||wakeup.companyId!==r.companyId||wakeup.agentId!==op.agentId||wakeup.requestedByActorType!=='agent'||wakeup.requestedByActorId!==r.team.ids.chief||wakeup.payload?.issueId!==task.id)childBootstrapFail('AUTHORITY_CHANGED');
 if(r.operations.some(value=>value.id!==op.id&&(value.acceptedRunId===run.id||value.retryOfRunId===parent.id||value.retryOfOperationId===op.id)))childBootstrapFail('OPERATION_DENIED');
 const entry=flow.taskEntries?.find(value=>value.id===task.id),dispatch=entry&&flow.dispatches?.[entry.key];
 const context={roleOperationId:op.id,issueId:task.id,taskId:task.id,projectId:task.projectId,responsibleUserId:r.ownerId,inputRevision:op.inputRevision};
 if([ctx.context,run.contextSnapshot,parent.contextSnapshot].some(value=>Object.entries(context).some(([key,expected])=>value?.[key]!==expected)))childBootstrapFail('AUTHORITY_CHANGED');
 if(!entry||entry.role!==op.role||entry.agentId!==op.agentId||flow.rootTaskId!==rootTask.id||flow.projectId!==task.projectId||flow.summaryRunId||flow.artifacts?.[entry.key]||
  dispatch?.operationId!==op.id||dispatch.taskId!==task.id||dispatch.inputRevision!==op.inputRevision||
  !r.lease?.nonce||r.lease.taskId!==task.id||r.lease.projectId!==task.projectId||r.lease.operationId!==op.id||r.lease.nonce!==dispatch.leaseNonce||verifyPhaseLease(r.lease)!==true)childBootstrapFail('FLOW_OR_PHASE_CHANGED');
 if(op.qualityRepair){const repair=qaRepairStep(flow,entry);
  if(flow.qaRepair?.nativePrepared!==true||flow.qaRepair.stage!==(op.qualityRepair.phase==='fix'?'fix':'review')||repair?.operationId!==op.id||repair.outputFile!==op.outputFile||!equal(repair.qualityRepair,op.qualityRepair))childBootstrapFail('FLOW_OR_PHASE_CHANGED');
 }
 const sameOperationRuns=taskRuns?.filter(value=>value.contextSnapshot?.roleOperationId===op.id);
 if(!Array.isArray(activeRuns)||activeRuns.length!==1||activeRuns[0].id!==run.id||activeRuns[0].status!=='running'||
  !Array.isArray(taskRuns)||sameOperationRuns.length!==2||!sameOperationRuns.some(value=>value.id===parent.id)||!sameOperationRuns.some(value=>value.id===run.id)||
  taskRuns.some(value=>value.companyId!==r.companyId||value.issueId!==task.id||value.id!==run.id&&(!['succeeded','failed','cancelled','timed_out'].includes(value.status)||!ended(value.finishedAt)))||
  !Array.isArray(leases)||taskRuns.some(value=>value.id!==run.id&&!leases.some(lease=>lease.heartbeatRunId===value.id))||
  leases.some(value=>value.heartbeatRunId!==run.id&&(!ended(value.releasedAt)||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed')))childBootstrapFail('EXECUTION_UNSETTLED');
 const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
 if(![op.id,rootTask.id,parent.id,run.id].every(value=>uuid.test(value??''))||!path.isAbsolute(root)||path.normalize(root)!==root||fs.realpathSync(root)!==root||
  !path.isAbsolute(op.workspaceCwd??'')||path.normalize(op.workspaceCwd)!==op.workspaceCwd||!/^[a-z][a-z0-9-]{0,110}\.(md|json)$/.test(op.outputFile??''))childBootstrapFail('EVIDENCE_UNAVAILABLE');
 const present=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 for(const id of [parent.id,run.id])for(const name of ['permits/'+id+'.json','claims/'+id+'.json','results/'+id+'.json','transport/'+id])if(present(path.join(root,name)))childBootstrapFail('PHYSICAL_EVIDENCE_PRESENT');
 if(['call.lock','operations/'+op.id+'.json','budget/'+rootTask.id+'/'+op.id+'.json'].some(file=>present(path.join(root,file)))||present(path.join(op.workspaceCwd,op.outputFile)))childBootstrapFail('PHYSICAL_EVIDENCE_PRESENT');
 const slots=fs.readdirSync(path.join(root,'budget',rootTask.id));if(!slots.length||slots.some(name=>!/^[a-f0-9-]{36}\.json$/.test(name))||slots.length>=rootCallLimit(r,rootTask.id))childBootstrapFail('BUDGET_DENIED');
 log({code:'TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_VALIDATED',runId:run.id,parentRunId:parent.id,operationId:op.id,taskId:task.id,rootTaskId:rootTask.id,spentBeforeCurrent:slots.length});
 return ctx;
}

/** Only Native DB columns establish a retry. Caller/model context grants no retry authority. */
export function validateNativeRoleRetry(f,{settleOnly=false}={}){
 const {registry:r,flow,rootTask:root,task,operation:op,run,parentRun:parent,budgetRecord,operationBinding,callLock,transportResult:t,existingOperation}=f;
 if(!r||!op||op.kind!=='run'||op.role==='chief'||op.phase!=='work'||!run||!parent||run.status!=='running'||
  run.retryOfRunId!==parent.id||!Number.isInteger(run.scheduledRetryAttempt)||run.scheduledRetryAttempt<1||run.scheduledRetryAttempt>2||
  run.scheduledRetryAttempt!==(parent.scheduledRetryAttempt??0)+1||parent.status!=='failed'||!ended(parent.finishedAt)||parent.exitCode===0)
  fail('TEAM_NATIVE_RETRY_RUN_DENIED');
 if(!root||!task||root.id!==op.rootTaskId||task.id!==op.taskId||task.parentId!==root.id||
  root.companyId!==r.companyId||task.companyId!==r.companyId||root.projectId!==op.projectId||task.projectId!==op.projectId||
  root.responsibleUserId!==r.ownerId||task.responsibleUserId!==r.ownerId||root.status!=='in_review'||root.assigneeUserId!==r.ownerId||root.assigneeAgentId||root.executionRunId||root.checkoutRunId||
  !['todo','in_progress'].includes(task.status)||task.assigneeAgentId!==op.agentId||task.executionRunId&&task.executionRunId!==run.id||task.checkoutRunId&&task.checkoutRunId!==run.id||
  r.team?.ids?.[op.role]!==op.agentId||r.taskRoots?.[task.id]!==root.id||!r.tasks?.includes(root.id)||!r.tasks?.includes(task.id)||
  [run,parent].some(value=>value.companyId!==r.companyId||value.issueId!==task.id||value.agentId!==op.agentId||value.responsibleUserId!==undefined&&value.responsibleUserId!==r.ownerId)||
  taskInputRevision(task)!==op.inputRevision||taskInputRevision(root)!==flow?.inputRevision||op.rootInputRevision!==flow.inputRevision)
  fail('TEAM_NATIVE_RETRY_AUTHORITY_CHANGED');
 const entry=flow.taskEntries?.find(value=>value.id===task.id),dispatch=entry&&flow.dispatches?.[entry.key];
 const replay=existingOperation&&existingOperation.acceptedRunId===run.id&&existingOperation.retryOfRunId===parent.id&&existingOperation.retryOfOperationId===op.id&&existingOperation.nativeRetryAttempt===run.scheduledRetryAttempt&&
  ['kind','role','taskId','agentId','rootTaskId','projectId','phase','inputRevision','rootInputRevision'].every(key=>existingOperation[key]===op[key]);
 if(!entry||entry.role!==op.role||entry.agentId!==op.agentId||flow.rootTaskId!==root.id||flow.projectId!==task.projectId||flow.summaryRunId||flow.artifacts?.[entry.key]||
  !dispatch||dispatch.taskId!==task.id||dispatch.inputRevision!==op.inputRevision||![op.id,replay?existingOperation.id:null].includes(dispatch.operationId)||
  existingOperation&&!replay)fail('TEAM_NATIVE_RETRY_FLOW_CHANGED');
 if(!Number.isSafeInteger(f.budgetCount)||f.budgetCount<1||f.budgetCount>rootCallLimit(r,root.id)-(settleOnly?0:1)||!budgetRecord||
  ['id','kind','taskId','rootTaskId','agentId','role','projectId','phase','inputRevision','rootInputRevision'].some(key=>budgetRecord[key]!==op[key])||
  operationBinding?.operationId!==op.id||operationBinding.runId!==parent.id||operationBinding.taskId!==task.id||operationBinding.agentId!==op.agentId)
  fail('TEAM_NATIVE_RETRY_BUDGET_DENIED');
 const history=flow.attemptHistory?.[entry.key]??[];
 if(history.length>2||!replay&&history.length>=2)fail('TEAM_NATIVE_RETRY_REPAIR_LIMIT');
 if(!callLock?.nonce||callLock.operationId!==op.id||callLock.taskId!==task.id||r.lease?.taskId!==task.id||r.lease.projectId!==task.projectId||
  ![op.id,replay?existingOperation.id:null].includes(r.lease.operationId)||r.lease.nonce!==dispatch.leaseNonce)
  fail('TEAM_NATIVE_RETRY_LOCK_DENIED');
 if(!t||t.runId!==parent.id||!Number.isInteger(t.exitCode)||t.exitCode===0||t.exitCode!==parent.exitCode||t.signal!==null||t.cancelled!==false||t.outputUnknown!==false||t.timedOut!==false||
  !hash(t.stdoutSha256)||!hash(t.stderrSha256)||t.stdoutSha256!==f.stdoutSha256||t.stderrSha256!==f.stderrSha256)
  fail('TEAM_NATIVE_RETRY_TRANSPORT_UNSETTLED');
 if(!Array.isArray(f.activeRuns)||f.activeRuns.some(value=>value.id!==run.id)||!f.activeRuns.some(value=>value.id===run.id&&value.status==='running')||
  !f.leases?.some(value=>value.heartbeatRunId===parent.id)||f.leases.some(value=>value.heartbeatRunId!==run.id&&(!ended(value.releasedAt)||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed')))
  fail('TEAM_NATIVE_RETRY_EXECUTION_UNSETTLED');
 return {key:entry.key,taskId:task.id,rootTaskId:root.id,runId:run.id,parentRunId:parent.id,attempt:run.scheduledRetryAttempt,replay:Boolean(replay)};
}

export function advanceNativeRetryFlow(flow,binding,{operation,parentRun,evidence}){
 const next=structuredClone(flow),current=next.dispatches[binding.key];
 if(current.operationId===operation.id)return next;
 next.attemptHistory??={};next.attemptHistory[binding.key]??=[];
 next.attemptHistory[binding.key].push({...current,runId:parentRun.id,finishedAt:parentRun.finishedAt,retryRunId:binding.runId,nativeRetryAttempt:binding.attempt,evidence});
 next.dispatches[binding.key]={...current,operationId:operation.id,acceptedRunId:binding.runId,retryOfOperationId:operation.retryOfOperationId,nativeRetryAttempt:binding.attempt,
  ...(operation.additionalInput!==undefined?{additionalInputSha256:digest(operation.additionalInput)}:{})};
 return next;
}

function writeArchive(file,bytes){
 if(fs.existsSync(file)){
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o222)||!fs.readFileSync(file).equals(bytes))fail('TEAM_NATIVE_RETRY_ARCHIVE_CHANGED');
  return;
 }
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function archiveNativeRetryFailure({root,parentRun,operation,callLock,artifact,log}){
 const directory=path.join(root,'team/native-retries',parentRun.id);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('TEAM_NATIVE_RETRY_ARCHIVE_DENIED');
 const lockFile=path.join(directory,'call.lock.json'),lockBytes=fs.readFileSync(fs.existsSync(root+'/call.lock')?root+'/call.lock':lockFile);
 if(!equal(JSON.parse(lockBytes),callLock))fail('TEAM_NATIVE_RETRY_LOCK_CHANGED');
 const receipt={parentRunId:parentRun.id,operationId:operation.id,taskId:operation.taskId,directory,lockFile,lockSha256:digest(lockBytes)};
 if(artifact){
  if(!/^[a-z][a-z0-9-]{0,110}\.(md|json)$/.test(artifact.file))fail('TEAM_NATIVE_RETRY_ARCHIVE_DENIED');
  const file=path.join(directory,artifact.file);writeArchive(file,artifact.data);
  receipt.artifact={path:file,file:artifact.file,sha256:digest(artifact.data),bytes:artifact.data.length};
 }
 writeArchive(lockFile,lockBytes);writeArchive(path.join(directory,'receipt.json'),Buffer.from(JSON.stringify(receipt)+'\n'));
 const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 log({code:'TEAM_NATIVE_RETRY_FAILURE_ARCHIVED',parentRunId:parentRun.id,operationId:operation.id,artifactSha256:receipt.artifact?.sha256});return receipt;
}
export function clearArchivedRetryLock({root,callLock,archive,allowAlreadyCleared=false,log}){
 const bytes=fs.readFileSync(archive.lockFile);
 if(digest(bytes)!==archive.lockSha256||!equal(JSON.parse(bytes),callLock))fail('TEAM_NATIVE_RETRY_ARCHIVE_CHANGED');
 if(!fs.existsSync(root+'/call.lock')){if(allowAlreadyCleared)return;fail('TEAM_NATIVE_RETRY_LOCK_CHANGED');}
 if(!equal(JSON.parse(fs.readFileSync(root+'/call.lock','utf8')),callLock))fail('TEAM_NATIVE_RETRY_LOCK_CHANGED');
 fs.unlinkSync(root+'/call.lock');const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 log({code:'TEAM_NATIVE_RETRY_SETTLED_LOCK_RELEASED',parentRunId:archive.parentRunId,operationId:callLock.operationId});
}

/** A Native successor may settle a proved failure while owner control forbids any new provider work. */
export function settleNativeRetryWithoutProvider({root,reason,artifact,log,...evidence}){
 if(!['owner_control','owner_input','budget_exhausted'].includes(reason))fail('TEAM_NATIVE_RETRY_SETTLEMENT_DENIED');
 const binding=validateNativeRoleRetry(evidence,{settleOnly:true});
 if(!/^[a-f0-9-]{36}$/.test(evidence.run.id))fail('TEAM_NATIVE_RETRY_SETTLEMENT_DENIED');
 const archive=archiveNativeRetryFailure({root,parentRun:evidence.parentRun,operation:evidence.operation,callLock:evidence.callLock,artifact,log});
 const file=path.join(archive.directory,'settle-only-'+evidence.run.id+'.json');
 const receipt={schemaVersion:1,kind:'settle_only',runId:evidence.run.id,parentRunId:evidence.parentRun.id,operationId:evidence.operation.id,
  taskId:evidence.task.id,rootTaskId:evidence.rootTask.id,companyId:evidence.registry.companyId,agentId:evidence.operation.agentId,
  inputRevision:evidence.operation.inputRevision,rootInputRevision:evidence.operation.rootInputRevision,lockSha256:archive.lockSha256,reason};
 writeArchive(file,Buffer.from(JSON.stringify(receipt)+'\n'));
 const fd=fs.openSync(archive.directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 clearArchivedRetryLock({root,callLock:evidence.callLock,archive,allowAlreadyCleared:true,log});
 log({code:'TEAM_NATIVE_RETRY_SETTLED_NO_PROVIDER',runId:evidence.run.id,parentRunId:evidence.parentRun.id,operationId:evidence.operation.id,reason});
 return{binding,archive,receiptFile:file,errorCode:'TEAM_NATIVE_RETRY_SETTLED_NO_PROVIDER'};
}

/** Additional release proof only; unknown or active attempts never become idle through this helper. */
export function canReleaseSettledNativeRetryPhase({runs,evidence}){
 return Array.isArray(runs)&&runs.length>0&&evidence?.unknown===false&&Array.isArray(evidence.settledFailedRunIds)&&runs.every(run=>
  ['succeeded','failed','cancelled','timed_out'].includes(run.status)&&(run.status==='succeeded'||run.resultJson?.executionRecovery?.providerWorkStarted===false||evidence.settledFailedRunIds.includes(run.id)));
}
