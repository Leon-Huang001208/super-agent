import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {taskInputRevision} from './task-input.mjs';
import {readControl} from './role-control-store.mjs';
import {roleExecutionPolicy} from './role-execution-policy.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const ended=value=>Number.isFinite(Date.parse(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

export const isInitialChiefPlan=operation=>operation?.kind==='run'&&operation.role==='chief'&&operation.phase==='plan'&&
 operation.taskId===operation.rootTaskId&&operation.rootInputRevision===undefined&&operation.contextVersion===1&&!operation.retryOfRunId;

/** A settled Native gate refusal is positive no-provider evidence, not an inference from missing files. */
export function isUnclaimedChiefGateFailure(parent){
 if(parent?.status!=='failed'||parent.errorCode!=='adapter_failed'||parent.exitCode!==1||!ended(parent.finishedAt)||
  parent.retryOfRunId||(parent.scheduledRetryAttempt??0)!==0||parent.resultJson?.executionRecovery?.kind!=='bootstrap'||
  parent.resultJson.executionRecovery.providerWorkStarted!==false)return false;
 try{const gate=JSON.parse(parent.error);return gate.code==='ROLE_GATE_ARGUMENTS_DENIED'&&gate.claimed===false;}catch{return false;}
}

function exists(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function physicalEvidence(root,operation,parent,run){
 if(!path.isAbsolute(root)||path.normalize(root)!==root||!uuid.test(operation?.id??'')||!uuid.test(operation.taskId??'')||
  !uuid.test(parent?.id??'')||!uuid.test(run?.id??''))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_SCOPE_DENIED');
 for(const id of [parent.id,run.id])for(const file of ['claims/'+id+'.json','results/'+id+'.json','transport/'+id])
  if(exists(path.join(root,file)))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_PROVIDER_EVIDENCE');
 if(exists(root+'/call.lock'))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_LOCK_DENIED');
 const directory=root+'/budget/'+operation.taskId,names=fs.readdirSync(directory);
 if(names.length!==1||names[0]!==operation.id+'.json')fail('TEAM_NATIVE_RETRY_BOOTSTRAP_BUDGET_DENIED');
 const files={permit:'permits/'+parent.id+'.json',budgetRecord:'budget/'+operation.taskId+'/'+operation.id+'.json',operationBinding:'operations/'+operation.id+'.json'};
 const values={},hashes={};
 for(const [key,file] of Object.entries(files)){const full=path.join(root,file);values[key]=readControl(full);hashes[key+'Sha256']=sha(fs.readFileSync(full));}
 return {...values,evidence:hashes};
}

/** Only the first Native successor of an initial M2 plan is supported here; work retries keep their existing contract. */
export function validateChiefBootstrapRetry(f){
 const {registry:r,task,operation:op,parentRun:parent,run,wakeup,control,existingOperation:existing,permit,budgetRecord,operationBinding}=f;
 if(!isInitialChiefPlan(op)||!isUnclaimedChiefGateFailure(parent)||run?.status!=='running'||run.retryOfRunId!==parent.id||
  run.scheduledRetryAttempt!==1||op.acceptedRunId!==parent.id)fail('TEAM_NATIVE_RETRY_BOOTSTRAP_RUN_DENIED');
 if(!r||r.enabled!==true||r.team?.enabled!==true||r.context?.enabled!==true||r.team.ids.chief!==op.agentId||
  !r.agents?.some(value=>value.profile?.role==='chief'&&value.profile.agentId===op.agentId)||!r.tasks?.includes(op.taskId)||r.taskRoots?.[op.taskId]!==op.taskId||
  !task||task.id!==op.taskId||task.parentId||task.companyId!==r.companyId||task.projectId!==op.projectId||task.responsibleUserId!==r.ownerId||
  task.createdByUserId!==r.ownerId&&task.createdByAgentId!==op.agentId||!['todo','in_progress'].includes(task.status)||task.assigneeAgentId!==op.agentId||task.assigneeUserId||
  task.executionRunId&&task.executionRunId!==run.id||task.checkoutRunId&&task.checkoutRunId!==run.id||taskInputRevision(task)!==op.inputRevision||
  [run,parent].some(value=>value.companyId!==r.companyId||value.agentId!==op.agentId||value.issueId!==task.id||value.responsibleUserId!==r.ownerId)||
  wakeup?.id!==parent.wakeupRequestId||wakeup.companyId!==r.companyId||wakeup.agentId!==op.agentId||wakeup.requestedByActorType!=='user'||wakeup.requestedByActorId!==r.ownerId)
  fail('TEAM_NATIVE_RETRY_BOOTSTRAP_AUTHORITY_CHANGED');
 if(!control||control.managed!==true||control.inputRevision!==op.inputRevision||control.pauseRequested!==false||!Array.isArray(control.pendingInputs)||control.pendingInputs.length||
  (control.projectWorkspaceId??null)!==(op.projectWorkspaceId??null)||!Array.isArray(f.flows)||f.flows.some(({flow})=>flow.rootTaskId===task.id))
  fail('TEAM_NATIVE_RETRY_BOOTSTRAP_CONTROL_CHANGED');
 if(!Array.isArray(f.taskRuns)||f.taskRuns.length!==2||f.taskRuns.some(value=>![parent.id,run.id].includes(value.id))||
  new Set(f.taskRuns.map(value=>value.id)).size!==2||!Array.isArray(f.activeRuns)||f.activeRuns.length!==1||f.activeRuns[0].id!==run.id||f.activeRuns[0].status!=='running'||
  !Array.isArray(f.leases)||!f.leases.some(value=>value.heartbeatRunId===parent.id)||
  f.leases.some(value=>value.heartbeatRunId!==run.id&&(!ended(value.releasedAt)||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed')))
  fail('TEAM_NATIVE_RETRY_BOOTSTRAP_EXECUTION_UNSETTLED');
 const role=r.agents.find(value=>value.profile.role==='chief');
 if(!permit||permit.schemaVersion!==1||permit.runId!==parent.id||permit.companyId!==r.companyId||permit.ownerId!==r.ownerId||permit.projectId!==op.projectId||
  permit.agentId!==op.agentId||permit.taskId!==task.id||permit.rootTaskId!==task.id||permit.role!=='chief'||permit.inputRevision!==op.inputRevision||permit.cwd!==op.workspaceCwd||
  (permit.projectWorkspaceId??null)!==(op.projectWorkspaceId??null)||!equal(roleExecutionPolicy(permit),roleExecutionPolicy(role.profile)))
  fail('TEAM_NATIVE_RETRY_BOOTSTRAP_PERMIT_CHANGED');
 if(!budgetRecord||['id','kind','role','phase','agentId','taskId','rootTaskId','rootInputRevision','projectId','contextVersion','projectKey','workspaceCwd','projectWorkspaceId','inputRevision','acceptedRunId'].some(key=>budgetRecord[key]!==op[key])||
  operationBinding?.operationId!==op.id||operationBinding.runId!==parent.id||operationBinding.taskId!==task.id||operationBinding.agentId!==op.agentId)
  fail('TEAM_NATIVE_RETRY_BOOTSTRAP_BUDGET_DENIED');
 if(!r.lease?.nonce||r.lease.taskId!==task.id||r.lease.projectId!==task.projectId||![op.id,existing?.id].includes(r.lease.operationId))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_LEASE_CHANGED');
 const planOperations=r.operations.filter(value=>value.rootTaskId===task.id);
 if(planOperations.some(value=>value.id!==op.id&&value.id!==existing?.id)||!planOperations.some(value=>equal(value,op)))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_OPERATION_CHANGED');
 return {runId:run.id,parentRunId:parent.id,taskId:task.id,rootTaskId:task.id,attempt:1};
}

/** Called under the Native run/root row transaction. It does not create a task/run, reserve a lease or consume a call slot. */
export function bindChiefBootstrapRetry({root,ctx,editRegistry,verifyPhaseLease,log,...state}){
 const {operation:op,parentRun:parent,run,task}=state;
 const physical=physicalEvidence(root,op,parent,run),registry=state.registry;
 const existing=registry.operations.find(value=>value.acceptedRunId===run.id&&value.retryOfRunId===parent.id);
 validateChiefBootstrapRetry({...state,...physical,existingOperation:existing});
 const context={issueId:task.id,taskId:task.id,projectId:task.projectId,responsibleUserId:registry.ownerId,inputRevision:op.inputRevision,taskGoal:task.description,conversationMode:false};
 if(ctx.runId!==run.id||ctx.agent?.id!==op.agentId||Object.entries(context).some(([key,value])=>ctx.context?.[key]!==undefined&&ctx.context[key]!==value)||
  ctx.context?.roleOperationId!==undefined&&![op.id,existing?.id].includes(ctx.context.roleOperationId))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_CONTEXT_CHANGED');
 const next={...op,id:existing?.id??randomUUID(),acceptedRunId:run.id,retryOfOperationId:op.id,retryOfRunId:parent.id,nativeRetryAttempt:1,bootstrapRetryEvidence:physical.evidence};
 if(existing&&!equal(existing,next))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_OPERATION_CHANGED');
 if(verifyPhaseLease(registry.lease)!==true)fail('TEAM_NATIVE_RETRY_BOOTSTRAP_LEASE_CHANGED');
 editRegistry(current=>{
  if(current.companyId!==registry.companyId||current.ownerId!==registry.ownerId||!equal(current.context,registry.context)||!equal(current.lease,registry.lease)||
   !equal(current.operations.find(value=>value.id===op.id),op)||!equal(current.operations.find(value=>value.id===next.id),existing))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_REGISTRY_CHANGED');
  // Recheck the same physical evidence immediately before the private registration changes.
  if(!equal(physicalEvidence(root,op,parent,run),physical))fail('TEAM_NATIVE_RETRY_BOOTSTRAP_EVIDENCE_CHANGED');
  if(!existing)current.operations.push(next);current.lease={...current.lease,operationId:next.id};return current;
 });
 log({code:'TEAM_NATIVE_RETRY_BOOTSTRAP_BOUND',runId:run.id,parentRunId:parent.id,taskId:task.id,operationId:next.id,retryOfOperationId:op.id,nativeRetryAttempt:1});
 return {...ctx,context:{...ctx.context,...context,roleOperationId:next.id}};
}

/** A retry's inherited Native context may predate the first private role registration. */
export async function prepareTeamRoleExecution(ctx,{database,bindNativeRetryAttempt,admitChiefInput}){
 const bound=await bindNativeRetryAttempt(ctx,{database});
 return bound.context?.roleOperationId?bound:admitChiefInput(bound,{database});
}

/** Unknown private/Native evidence in this branch must not become a new no-provider certificate. */
export async function withChiefBootstrapEvidence(perform){
 try{return await perform();}catch(error){
  fail(chiefBootstrapEvidenceCode(error));
 }
}

export const chiefBootstrapEvidenceCode=error=>/^TEAM_NATIVE_RETRY_BOOTSTRAP_[A-Z_]+$/.test(error?.code??'')?
 error.code:'TEAM_NATIVE_RETRY_BOOTSTRAP_EVIDENCE_UNAVAILABLE';

export function teamRoleAdmissionFailure(error){
 return {exitCode:1,signal:null,timedOut:false,
  errorCode:/^(?:TEAM|NATIVE_ROLE)_[A-Z_]+$/.test(error?.code??error?.message)?(error.code??error.message):'NATIVE_ROLE_PREFLIGHT_FAILED',
  errorMessage:'The controlled Native intake or retry did not admit this execution.',
  resultJson:{executionRecovery:error?.code?.startsWith('TEAM_NATIVE_RETRY_BOOTSTRAP_')?
   {kind:'reconciliation',providerWorkStarted:null}:{kind:'bootstrap',providerWorkStarted:false}}};
}
