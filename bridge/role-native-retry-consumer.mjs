import {taskInputRevision} from './task-input.mjs';
import {isInitialChiefPlan,isUnclaimedChiefGateFailure} from './chief-bootstrap-retry.mjs';
import {isChiefTransportPlanRetry} from './chief-transport-retry.mjs';
import {isCompletedResumeChiefWorkspaceFailure} from './role-native-retry.mjs';

/** Selection only: Native remains the sole queue owner and execution consumer. */
export function selectQueuedNativeRoleRetry({registry:r,activeRuns,parentRun:parent,tasks,chiefTransportEvidence,chiefWorkspaceEvidence}){
 if(r?.team?.enabled!==true||!Array.isArray(activeRuns)||activeRuns.length!==1||!Array.isArray(tasks))return null;
 const run=activeRuns[0],lease=r.lease,op=r.operations?.find(value=>value.id===lease?.operationId);
 const initialChief=isInitialChiefPlan(op)&&isUnclaimedChiefGateFailure(parent)&&run.scheduledRetryAttempt===1&&op.acceptedRunId===parent.id;
 const transportChief=isChiefTransportPlanRetry(op,parent)&&run.scheduledRetryAttempt===2&&chiefTransportEvidence?.kind==='chief_https_no_response'&&
  chiefTransportEvidence.parentRunId===parent.id&&chiefTransportEvidence.operationId===op.id&&chiefTransportEvidence.taskId===op.taskId&&chiefTransportEvidence.inputRevision===op.inputRevision;
 const workspaceChief=isCompletedResumeChiefWorkspaceFailure(parent)&&op?.role==='chief'&&op.phase==='plan'&&op.contextVersion===1&&
  op.artifactGeneration===op.id&&run.scheduledRetryAttempt===1&&chiefWorkspaceEvidence?.kind==='completed_resume_chief_workspace_preflight'&&
  chiefWorkspaceEvidence.runId===run.id&&chiefWorkspaceEvidence.parentRunId===parent.id&&chiefWorkspaceEvidence.operationId===op.id&&
  chiefWorkspaceEvidence.taskId===op.taskId&&chiefWorkspaceEvidence.inputRevision===op.inputRevision&&chiefWorkspaceEvidence.projectWorkspaceId===op.projectWorkspaceId;
 if(run.status!=='queued'||!run.retryOfRunId||!Number.isInteger(run.scheduledRetryAttempt)||run.scheduledRetryAttempt<1||run.scheduledRetryAttempt>2||
  !op||op.kind!=='run'||!initialChief&&!transportChief&&!workspaceChief&&(op.phase!=='work'||op.role==='chief')||!parent||parent.id!==run.retryOfRunId||parent.status!=='failed'||
  parent.companyId!==r.companyId||parent.issueId!==op.taskId||parent.agentId!==op.agentId||run.responsibleUserId!==r.ownerId||
  op.taskId!==lease.taskId||op.projectId!==lease.projectId||run.issueId!==op.taskId||run.agentId!==op.agentId||run.companyId!==r.companyId||
  r.team.ids?.[op.role]!==op.agentId||!r.agents?.some(value=>value.profile?.role===op.role&&value.profile?.agentId===op.agentId)||
  r.taskRoots?.[op.taskId]!==op.rootTaskId||!r.tasks?.includes(op.taskId)||!r.tasks.includes(op.rootTaskId))return null;
 const task=tasks.find(value=>value?.id===op.taskId),root=tasks.find(value=>value?.id===op.rootTaskId);
 if(initialChief||transportChief||workspaceChief){
  if(!task||root?.id!==task.id||task.parentId||task.companyId!==r.companyId||task.projectId!==op.projectId||task.responsibleUserId!==r.ownerId||
   !['todo','in_progress'].includes(task.status)||task.assigneeAgentId!==op.agentId||task.assigneeUserId||taskInputRevision(task)!==op.inputRevision)return null;
  return {companyId:r.companyId,agentId:op.agentId,runId:run.id,taskId:task.id,rootTaskId:task.id};
 }
 if(!task||!root||task.parentId!==root.id||task.companyId!==r.companyId||root.companyId!==r.companyId||task.projectId!==op.projectId||root.projectId!==op.projectId||
  task.responsibleUserId!==r.ownerId||root.responsibleUserId!==r.ownerId||!['todo','in_progress'].includes(task.status)||task.assigneeAgentId!==op.agentId||
  root.status!=='in_review'||root.assigneeUserId!==r.ownerId||root.assigneeAgentId||taskInputRevision(task)!==op.inputRevision||taskInputRevision(root)!==op.rootInputRevision)return null;
 return {companyId:r.companyId,agentId:op.agentId,runId:run.id,taskId:task.id,rootTaskId:root.id};
}

export async function consumeQueuedNativeRoleRetry({resume,log,...state}){
 const selected=selectQueuedNativeRoleRetry(state);if(!selected)return false;
 const claimed=await resume(selected.companyId,selected.agentId);
 // Native owns the claim race. An unexpected result is never repaired by a new wake/run.
 if(!Array.isArray(claimed)||claimed.length>1||claimed.some(run=>run.id!==selected.runId)){
  log({code:'TEAM_NATIVE_RETRY_CONSUMER_SCOPE_CHANGED',status:'unknown',runId:selected.runId});
  throw Object.assign(Error('TEAM_NATIVE_RETRY_CONSUMER_SCOPE_CHANGED'),{code:'TEAM_NATIVE_RETRY_CONSUMER_SCOPE_CHANGED'});
 }
 if(claimed.length)log({code:'TEAM_NATIVE_RETRY_CONSUMER_RESUMED',...selected});
 return true;
}
