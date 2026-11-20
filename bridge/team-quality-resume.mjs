import {isDeepStrictEqual} from 'node:util';
import {taskInputRevision} from './task-input.mjs';
import {remainingRootCalls,rootCallLimit} from './task-call-policy.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const uuid=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value??'');
const hash=value=>/^[a-f0-9]{64}$/.test(value??'');

/** Native publications and follow-up effects must not escape a rolled-back resume. */
export async function qualityResumeTransaction({transaction,mutate,publishActivity,runPostCommitActions}){
 if([transaction,mutate,publishActivity,runPostCommitActions].some(fn=>typeof fn!=='function'))fail('TEAM_QUALITY_RESUME_PORT_INVALID');
 const publications=[],actions=[];
 const result=await transaction(tx=>mutate(tx,publications,actions));
 for(const publication of publications)publishActivity(publication);
 await runPostCommitActions(actions);
 return result;
}

/** An explicit owner operation resumes the same quality loop; it never creates a goal or run. */
export function planQualityResume({registry,task,flow,flowSha256,expectedFlowSha256,resumeId,used,activeRuns,leases,callLock,nativeEvent}){
 if(!uuid(resumeId)||!hash(expectedFlowSha256)||registry.team?.enabled!==false||callLock||
  !Array.isArray(activeRuns)||activeRuns.length||!Array.isArray(leases)||leases.some(value=>!value.releasedAt||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed'))fail('TEAM_QUALITY_RESUME_BUSY');
 if(!task||task.parentId||task.id!==flow.rootTaskId||task.companyId!==registry.companyId||task.responsibleUserId!==registry.ownerId||
  task.projectId!==flow.projectId||task.assigneeAgentId||task.assigneeUserId!==registry.ownerId||task.executionRunId||task.checkoutRunId||
  taskInputRevision(task)!==flow.inputRevision||!registry.tasks?.includes(task.id)||registry.taskRoots?.[task.id]!==task.id)fail('TEAM_QUALITY_RESUME_SCOPE_CHANGED');
 const prior=flow.qualityResumeHistory?.find(value=>value.resumeId===resumeId);
 const expectedEvent={resumeId,rootTaskId:task.id,inputRevision:flow.inputRevision,beforeFlowSha256:expectedFlowSha256};
 if(nativeEvent&&!isDeepStrictEqual(nativeEvent,expectedEvent))fail('TEAM_QUALITY_RESUME_EVENT_CHANGED');
 if(prior){
  if(prior.beforeFlowSha256!==expectedFlowSha256||!nativeEvent)fail('TEAM_QUALITY_RESUME_EVENT_CHANGED');
  return {kind:'reused',flow:structuredClone(flow),event:expectedEvent};
 }
 if(flowSha256!==expectedFlowSha256||task.status!==(nativeEvent?'in_review':'blocked')||
  flow.qaBlocked?.sourceQa?.verdict!=='NEEDS_WORK'||flow.summary?.kind!=='controller-quality-block'||flow.summary.noModelCall!==true||
  flow.notification?.status!=='sent'||flow.summaryRunId||flow.qaRepair?.stage!=='complete'||flow.qaRepair.round>=2||
  !isDeepStrictEqual(flow.qaBlocked.sourceQa,flow.artifacts?.[flow.qaRepair.qaKey]))fail('TEAM_QUALITY_RESUME_FLOW_CHANGED');
 if(remainingRootCalls(registry,task.id,used)<3)fail('TEAM_QUALITY_RESUME_BUDGET_EXHAUSTED');
 const next=structuredClone(flow);
 next.qualityResumeHistory??=[];
 next.qualityResumeHistory.push({...expectedEvent,usedCalls:used,maximum:rootCallLimit(registry,task.id),
  qaBlocked:next.qaBlocked,summary:next.summary,notification:next.notification});
 delete next.qaBlocked;delete next.summary;delete next.notification;
 return {kind:nativeEvent?'reconcile_projection':'resume',flow:next,event:expectedEvent};
}
