const fail=()=>{throw Object.assign(Error('NATIVE_ROLE_TASK_BUDGET_DENIED'),{code:'NATIVE_ROLE_TASK_BUDGET_DENIED'});};

/** Only an owner-bound control-plane record can select the complex tier. Model text cannot. */
export function rootCallLimit(registry,rootTaskId){
 const grant=registry?.taskCallBudgets?.[rootTaskId];
 if(grant===undefined)return 6;
 if(grant?.maximum!==12||grant.tier!=='complex'||grant.rootTaskId!==rootTaskId||
  !registry?.ownerId||grant.approvedBy!==registry.ownerId||!registry?.companyId||grant.companyId!==registry.companyId||
  typeof grant.approvalSource!=='string'||!grant.approvalSource.trim())fail();
 return 12;
}

export function remainingRootCalls(registry,rootTaskId,used){
 if(!Number.isSafeInteger(used)||used<0)fail();
 return Math.max(0,rootCallLimit(registry,rootTaskId)-used);
}

export function grantComplexTaskBudget(registry,{task,approvalSource}){
 const registered=registry.tasks?.includes(task?.id)&&registry.taskRoots?.[task?.id]===task?.id;
 // An authenticated Native issue may receive its tier before its first Chief wake.
 // This does not register an execution or create a spent-call record.
 const notStarted=task?.createdByUserId===registry.ownerId&&!task.assigneeAgentId&&!task.executionRunId&&!task.checkoutRunId&&
  ['backlog','todo'].includes(task.status)&&registry.context?.catalog?.projects?.some(project=>project.projectId===task.projectId);
 if(!task||task.parentId||task.companyId!==registry.companyId||task.responsibleUserId!==registry.ownerId||
  !registered&&!notStarted||['done','cancelled'].includes(task.status)||
  typeof approvalSource!=='string'||!approvalSource.trim())fail();
 const maximum=rootCallLimit(registry,task.id);
 if(maximum===12)return structuredClone(registry);
 return {...structuredClone(registry),taskCallBudgets:{...registry.taskCallBudgets,[task.id]:{
  rootTaskId:task.id,companyId:registry.companyId,approvedBy:registry.ownerId,maximum:12,tier:'complex',approvalSource,
 }}};
}
