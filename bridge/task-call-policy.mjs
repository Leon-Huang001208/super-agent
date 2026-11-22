const fail=()=>{throw Object.assign(Error('NATIVE_ROLE_TASK_BUDGET_DENIED'),{code:'NATIVE_ROLE_TASK_BUDGET_DENIED'});};

/** The default is twenty; only owner-bound records may retain or upgrade a legacy allocation. */
export function rootCallLimit(registry,rootTaskId){
 const grant=registry?.taskCallBudgets?.[rootTaskId];
 // Historical seventh-QA roots keep their six-call base and the existing exact
 // physical-call allowance check. An explicit owner allocation takes precedence.
 if(grant===undefined)return registry?.qaSupplementAllowances?.[rootTaskId]===undefined?20:6;
 if(![12,20].includes(grant?.maximum)||grant.tier!=='complex'||grant.rootTaskId!==rootTaskId||
  !registry?.ownerId||grant.approvedBy!==registry.ownerId||!registry?.companyId||grant.companyId!==registry.companyId||
  typeof grant.approvalSource!=='string'||!grant.approvalSource.trim())fail();
 return grant.maximum;
}

export function remainingRootCalls(registry,rootTaskId,used){
 if(!Number.isSafeInteger(used)||used<0)fail();
 return Math.max(0,rootCallLimit(registry,rootTaskId)-used);
}

// Keep the original exported name for existing operator callers. New allocations
// are twenty calls; this function never creates, reopens or wakes a Native task.
export function grantComplexTaskBudget(registry,{task,approvalSource,maximum=20}){
 const registered=registry.tasks?.includes(task?.id)&&registry.taskRoots?.[task?.id]===task?.id;
 // An authenticated Native issue may receive its tier before its first Chief wake.
 // This does not register an execution or create a spent-call record.
 const notStarted=task?.createdByUserId===registry.ownerId&&!task.assigneeAgentId&&!task.executionRunId&&!task.checkoutRunId&&
  ['backlog','todo'].includes(task.status)&&registry.context?.catalog?.projects?.some(project=>project.projectId===task.projectId);
 if(!task||task.parentId||task.companyId!==registry.companyId||task.responsibleUserId!==registry.ownerId||
  !registered&&!notStarted||task.status==='cancelled'||maximum!==20||
  typeof approvalSource!=='string'||!approvalSource.trim())fail();
 rootCallLimit(registry,task.id);
 if(registry.taskCallBudgets?.[task.id]?.maximum===20)return structuredClone(registry);
 return {...structuredClone(registry),taskCallBudgets:{...registry.taskCallBudgets,[task.id]:{
  rootTaskId:task.id,companyId:registry.companyId,approvedBy:registry.ownerId,maximum,tier:'complex',approvalSource,
 }}};
}
