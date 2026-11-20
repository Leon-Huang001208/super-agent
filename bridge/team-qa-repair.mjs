import {randomUUID} from 'node:crypto';
import {taskInputRevision} from './task-input.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const id=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??'');
const hash=value=>/^[a-f0-9]{64}$/.test(value??'');
const ref=value=>value&&id(value.taskId)&&id(value.runId)&&hash(value.sha256)&&typeof value.file==='string';

/** A task may have older operations and Native retries; only this flow's dispatch may be collected. */
export function teamChildOperation({flow,entry,operations}){
 const dispatch=flow.dispatches?.[entry.key];
 if(!dispatch)return null;
 const operation=operations.find(value=>value.id===dispatch.operationId);
 if(!operation)fail('TEAM_DISPATCH_RECONCILIATION_REQUIRED');
 if(operation.kind!=='run'||operation.taskId!==entry.id||operation.rootTaskId!==flow.rootTaskId||
  operation.rootInputRevision!==flow.inputRevision||operation.role!==entry.role||operation.agentId!==entry.agentId||
  operation.phase!=='work'||operation.inputRevision!==dispatch.inputRevision||
  (operation.artifactGeneration??null)!==(flow.artifactGeneration??null))fail('TEAM_CHILD_OPERATION_CHANGED');
 return operation;
}

export function qaReviewedArtifacts(flow){
 const qaKeys=new Set(flow.taskEntries.filter(entry=>entry.role==='qa').map(entry=>entry.key));
 return Object.entries(flow.artifacts).filter(([key])=>!qaKeys.has(key)).map(([,value])=>value);
}

export function qaRepairOutputFile(entry,round){
 if(!Number.isSafeInteger(round)||round<1||round>2||!/^[a-z][a-z0-9-]{0,110}\.(md|json)$/.test(entry.outputFile??''))fail('TEAM_QA_REPAIR_OUTPUT_DENIED');
 const suffix=entry.role==='qa'?'-qa-r'+round:'-fix-r'+round;
 const extension=entry.outputFile.match(/\.(md|json)$/)[0];
 const result=entry.outputFile.slice(0,-extension.length).slice(0,111-suffix.length)+suffix+extension;
 if(!/^[a-z][a-z0-9-]{0,110}\.(md|json)$/.test(result))fail('TEAM_QA_REPAIR_OUTPUT_DENIED');
 return result;
}

/** This is a quality loop after a successful QA run, never a Native failed-run retry. */
export function planQaRepair({flow,operations,used,maximum=6,maxFixRounds=2,newId=randomUUID}){
 if(!Number.isSafeInteger(used)||used<0||![6,12].includes(maximum)||maxFixRounds!==2)fail('TEAM_QA_REPAIR_BUDGET_INVALID');
 const qa=flow.taskEntries.find(entry=>entry.role==='qa'),review=qa&&flow.artifacts[qa.key];
 if(!qa||!review||review.verdict!=='NEEDS_WORK')return {kind:'none'};
 if(!ref(review))fail('TEAM_QA_REPAIR_EVIDENCE_CHANGED');
 const qaOperation=teamChildOperation({flow,entry:qa,operations});
 if(!qaOperation||qaOperation.acceptedRunId&&qaOperation.acceptedRunId!==review.runId)fail('TEAM_QA_REPAIR_EVIDENCE_CHANGED');
 const history=operations.filter(value=>value.rootTaskId===flow.rootTaskId&&value.qualityRepair).map(value=>value.qualityRepair.round);
 if(history.some(value=>!Number.isSafeInteger(value)||value<1||value>2))fail('TEAM_QA_REPAIR_HISTORY_CHANGED');
 const round=Math.max(0,flow.qaRepair?.round??0,...history)+1;
 if(round>maxFixRounds)return {kind:'blocked',code:'TEAM_QA_REPAIR_LIMIT',sourceQa:review};
 const unfinished=flow.taskEntries.filter(entry=>entry.role!=='qa'&&!flow.artifacts[entry.key]).length;
 if(maximum-used<3+unfinished)return {kind:'blocked',code:'TEAM_QA_REPAIR_BUDGET_EXHAUSTED',sourceQa:review};
 const candidates=flow.taskEntries.filter(entry=>entry.role!=='qa'&&flow.artifacts[entry.key]&&
  qaOperation.reviewedArtifacts?.some(value=>value.taskId===entry.id&&value.runId===flow.artifacts[entry.key].runId));
 let target;
 if(review.repairTaskKey!==undefined)target=candidates.find(entry=>entry.key===review.repairTaskKey);
 else if(qaOperation.codeCandidate)target=candidates.find(entry=>entry.id===qaOperation.codeCandidate.taskId);
 else {const direct=candidates.filter(entry=>qa.dependsOn.includes(entry.key));if(direct.length===1)target=direct[0];}
 if(!target)return {kind:'blocked',code:'TEAM_QA_REPAIR_TARGET_REQUIRED',sourceQa:review};
 // A later artifact derived from the target also needs fresh validation; never certify it with its old hash.
 const dependent=key=>flow.taskEntries.some(entry=>entry.key!==qa.key&&entry.dependsOn.includes(key)&&
  (flow.artifacts[entry.key]||dependent(entry.key)));
 if(dependent(target.key))return {kind:'blocked',code:'TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED',sourceQa:review};
 const targetOperation=teamChildOperation({flow,entry:target,operations});
 if(!targetOperation||!ref(flow.artifacts[target.key]))fail('TEAM_QA_REPAIR_EVIDENCE_CHANGED');
 const fixOperationId=newId(),reviewOperationId=newId();if(!id(fixOperationId)||!id(reviewOperationId)||fixOperationId===reviewOperationId)fail('TEAM_QA_REPAIR_OPERATION_INVALID');
 return {kind:'repair',repair:{round,targetKey:target.key,qaKey:qa.key,stage:'fix',nativePrepared:false,
  fixOperationId,reviewOperationId,targetOutputFile:qaRepairOutputFile(target,round),qaOutputFile:qaRepairOutputFile(qa,round),
  sourceQa:structuredClone(review),sourceArtifacts:structuredClone(flow.artifacts),
  sourceDispatches:{[target.key]:structuredClone(flow.dispatches[target.key]),[qa.key]:structuredClone(flow.dispatches[qa.key])}}};
}

/** Archive callbacks run before the new active set can replace any previous accepted artifact. */
export function beginQaRepair(flow,repair,{archiveArtifact}){
 if(flow.qaRepair&&flow.qaRepair.stage!=='complete')fail('TEAM_QA_REPAIR_ALREADY_PENDING');
 const next=structuredClone(flow),saved=structuredClone(repair);
 for(const [key,value]of Object.entries(saved.sourceArtifacts))saved.sourceArtifacts[key]=archiveArtifact(value);
 saved.sourceQa=saved.sourceArtifacts[saved.qaKey];
 next.qaRepair=saved;delete next.codeReview;
 delete next.artifacts[saved.targetKey];delete next.artifacts[saved.qaKey];
 delete next.dispatches[saved.targetKey];delete next.dispatches[saved.qaKey];
 return next;
}

export function advanceQaRepair(flow){
 const next=structuredClone(flow),repair=next.qaRepair;
 if(!repair||repair.stage==='complete')return next;
 if(repair.stage==='fix'&&next.artifacts[repair.targetKey])repair.stage='review';
 if(repair.stage==='review'&&next.artifacts[repair.qaKey]){
  repair.stage='complete';next.qaRepairHistory??=[];
  next.qaRepairHistory.push({...structuredClone(repair),result:structuredClone(next.artifacts[repair.qaKey])});
 }
 return next;
}

export function qaRepairStep(flow,entry){
 const repair=flow.qaRepair;
 if(!repair||repair.stage==='complete')return null;
 const fixing=entry.key===repair.targetKey,reviewing=entry.key===repair.qaKey;
 if(!fixing&&!reviewing)return null;
 return {operationId:fixing?repair.fixOperationId:repair.reviewOperationId,
  outputFile:fixing?repair.targetOutputFile:repair.qaOutputFile,
  qualityRepair:{round:repair.round,sourceQaRunId:repair.sourceQa.runId,targetKey:repair.targetKey,qaKey:repair.qaKey,phase:fixing?'fix':'review'}};
}

/** Called under the original root's Native row lock before reopening its two settled children. */
export function validateQaRepairReopen({registry,flow,tasks,operations,runs,leases}){
 const repair=flow.qaRepair;
 if(!repair||repair.nativePrepared||repair.stage!=='fix')fail('TEAM_QA_REPAIR_REOPEN_CHANGED');
 const entries=[repair.targetKey,repair.qaKey].map(key=>flow.taskEntries.find(entry=>entry.key===key));
 if(entries.some(entry=>!entry)||!Array.isArray(runs)||!Array.isArray(leases))fail('TEAM_QA_REPAIR_REOPEN_CHANGED');
 for(const entry of entries){
  const task=tasks.find(value=>value.id===entry.id),source=repair.sourceArtifacts[entry.key],dispatch=repair.sourceDispatches[entry.key],op=operations.find(value=>value.id===dispatch?.operationId),run=runs.find(value=>value.id===source?.runId);
  if(!task||!source||!op||!run||op.rootTaskId!==flow.rootTaskId||op.rootInputRevision!==flow.inputRevision||op.taskId!==task.id||op.agentId!==entry.agentId||
   task.companyId!==registry.companyId||task.projectId!==flow.projectId||task.parentId!==flow.rootTaskId||task.responsibleUserId!==registry.ownerId||
   taskInputRevision(task)!==op.inputRevision||!['done','todo'].includes(task.status)||task.assigneeUserId!==registry.ownerId||task.assigneeAgentId||task.executionRunId||task.checkoutRunId||
   run.status!=='succeeded'||run.issueId!==task.id||run.companyId!==registry.companyId||run.agentId!==entry.agentId||!Number.isFinite(Date.parse(run.finishedAt)))fail('TEAM_QA_REPAIR_REOPEN_CHANGED');
  if(runs.some(value=>value.issueId===task.id&&['queued','running','scheduled_retry'].includes(value.status))||
   !leases.some(value=>value.heartbeatRunId===run.id)||leases.some(value=>!Number.isFinite(Date.parse(value.releasedAt))||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed'))fail('TEAM_QA_REPAIR_EXECUTION_UNSETTLED');
 }
 return entries;
}

/** One coordinator tick, using the existing Native collect/wake/reopen ports; no independent scheduler. */
export async function driveQaRepair({flow,operations,used,maximum,maxFixRounds=2,archiveArtifact,ports,newId}){
 if(!ports||['save','reopen','collect','dispatch','block'].some(key=>typeof ports[key]!=='function'))fail('TEAM_QA_REPAIR_PORT_INVALID');
 let current=advanceQaRepair(flow);
 if(JSON.stringify(current)!==JSON.stringify(flow))await ports.save(current);
 if(!current.qaRepair||current.qaRepair.stage==='complete'){
  const decision=planQaRepair({flow:current,operations,used,maximum,maxFixRounds,newId});
  if(decision.kind==='blocked'){
   current.qaBlocked={code:decision.code,sourceQa:decision.sourceQa};delete current.codeReview;
   await ports.save(current);await ports.block(current);return {handled:true,flow:current};
  }
  if(decision.kind==='repair'){
   current=beginQaRepair(current,decision.repair,{archiveArtifact});await ports.save(current);
  }
 }
 const repair=current.qaRepair;
 if(!repair||repair.stage==='complete')return {handled:false,flow:current};
 if(!repair.nativePrepared){await ports.reopen(current);repair.nativePrepared=true;await ports.save(current);return {handled:true,flow:current};}
 const entry=current.taskEntries.find(value=>value.key===(repair.stage==='fix'?repair.targetKey:repair.qaKey));
 if(!entry)fail('TEAM_QA_REPAIR_REOPEN_CHANGED');
 if(await ports.collect(current,entry)){await ports.save(current);return {handled:true,flow:current};}
 const step=qaRepairStep(current,entry);
 await ports.dispatch(current,{...entry,outputFile:step.outputFile},step);
 return {handled:true,flow:current};
}
