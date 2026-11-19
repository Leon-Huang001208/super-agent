import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};

/** A completed role hands its artifact to the existing Native user-owned queue. */
export async function settleNativeRole({binding,result,transaction,log}) {
 if(result?.exitCode!==0||result.signal||result.timedOut||result.errorCode)return result;
 if(typeof result.summary!=='string'||!result.summary.trim()||Buffer.byteLength(result.summary)>131072)fail('NATIVE_ROLE_RESULT_MISSING');
 const digest=createHash('sha256').update(result.summary).digest('hex');
 await transaction(async port=>{
  const {task,run}=await port.lock(binding);
  if(task.id!==binding.taskId||task.companyId!==binding.companyId||task.projectId!==binding.projectId||
    task.responsibleUserId!==binding.ownerId||task.assigneeAgentId!==binding.agentId||
    createHash('sha256').update(task.description??'').digest('hex')!==binding.inputRevision||
    run.id!==binding.runId||run.agentId!==binding.agentId||run.status!=='running')fail('NATIVE_ROLE_SETTLEMENT_CHANGED');
  await port.addCompletion(task.id,result.summary,{agentId:binding.agentId,runId:binding.runId});
  // in_review plus a real user owner is Native's durable waiting path. It is
  // a phase handoff, not a claim that the full user request passed acceptance.
  await port.handBack(task.id,{status:'in_review',assigneeAgentId:null,assigneeUserId:binding.ownerId});
 });
 log({code:'NATIVE_ROLE_PHASE_HANDED_BACK',taskId:binding.taskId,runId:binding.runId,summarySha256:digest});
 return result;
}
