/** Trusted SDK-only intake; all tasks, claims and receipts live in Native. */
import {createHash,randomUUID} from 'node:crypto';
import {taskInputRevision} from './task-input.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
export function chiefFeishuOperation(message){return sha(JSON.stringify(['chief-feishu-v1',message.appId,message.tenantKey,message.messageId]));}
export function createChiefFeishuController({repository,wake,canDispatch,acknowledge,log}){
 if(!repository||![wake,canDispatch,acknowledge,log].every(f=>typeof f==='function'))fail('CHIEF_FEISHU_CONFIGURATION_INVALID');
 async function registerTrustedMessage(message){
  const operationId=chiefFeishuOperation(message);
  const receipt=await repository.transaction(operationId,async tx=>{
   const prior=await tx.readRegistration();
   if(prior){if(prior.bodySha256!==message.bodySha256)fail('CHIEF_FEISHU_SOURCE_CONFLICT');return {...prior,reused:true};}
   const task=await tx.createTask(message);
   const record={schemaVersion:1,operationId,taskId:task.id,identifier:task.identifier,companyId:message.companyId,ownerId:message.nativeOwnerId,chiefAgentId:message.chiefAgentId,projectId:message.projectId,sourceParams:message.sourceParams,bodySha256:message.bodySha256,inputRevision:taskInputRevision(task),status:'registered'};
   await tx.append('registered',record);return {...record,reused:false};
  });
  // Claim before the API call. Unknown delivery never gets an automatic resend.
  const ack=await repository.transaction(operationId,async tx=>{if(await tx.readState('ack_claimed'))return false;await tx.append('ack_claimed',{operationId,taskId:receipt.taskId});return true;});
  if(ack){try{const result=await acknowledge(receipt);await repository.transaction(operationId,tx=>tx.append('ack_sent',{operationId,taskId:receipt.taskId,messageId:result.messageId}));}catch{await log({code:'CHIEF_FEISHU_ACK_UNKNOWN',taskId:receipt.taskId,operationId});}}
  return receipt;
 }
 async function drain(){
  if(!await canDispatch())return;
  for(const entry of await repository.listRegistrations()){
   const claim=await repository.transaction(entry.operationId,async tx=>{
    if(await tx.readState('wake_claimed')||await tx.readState('stale'))return null;
    const task=await tx.readTask(entry.taskId);if(!task||task.companyId!==entry.companyId||task.projectId!==entry.projectId||task.createdByUserId!==entry.ownerId||task.responsibleUserId!==entry.ownerId||task.parentId||task.assigneeAgentId!==entry.chiefAgentId||task.status!=='todo'||taskInputRevision(task)!==entry.inputRevision){await tx.append('stale',{operationId:entry.operationId,taskId:entry.taskId,code:'CHIEF_FEISHU_TASK_CHANGED'});return null;}
    if(!await canDispatch(tx.dispatchContext))return null;
    await tx.append('wake_claimed',{operationId:entry.operationId,taskId:entry.taskId});return entry;
   });
   if(!claim)continue;
   try{const result=await wake(claim);if(!result?.id)fail('CHIEF_FEISHU_WAKE_UNKNOWN');await repository.transaction(entry.operationId,tx=>tx.append('wake_sent',{operationId:entry.operationId,taskId:entry.taskId,runId:result.id}));}
   catch{await log({code:'CHIEF_FEISHU_WAKE_UNKNOWN',taskId:entry.taskId,operationId:entry.operationId});}
   return; // One Native launch per observation, global admission still rechecks.
  }
 }
 return Object.freeze({registerTrustedMessage,drain});
}

export async function createChiefFeishuNative({database,binding,canDispatch,acknowledge,log,loadServices=async P=>({...await import(P+'issues.js'),...await import(P+'heartbeat.js'),...await import(P+'activity-log.js')})}){
 const {db,schema:s,orm:o}=await database(),P='/opt/paperclip/node_modules/@paperclipai/server/dist/services/';
 const {issueService,heartbeatService,logActivity,publishActivity}=await loadServices(P);
 const action=state=>'team.feishu.'+state;
 const rows=(tx,operationId,state)=>tx.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,binding.companyId),o.eq(s.activityLog.action,action(state)),o.sql`${s.activityLog.details}->>'operationId' = ${operationId}`));
 const repository={
  async transaction(operationId,fn){const publications=[];const result=await db.transaction(async tx=>{
   await tx.execute(o.sql`select pg_advisory_xact_lock(hashtext(${binding.companyId}),hashtext(${operationId}))`);
   let taskId;
   const read=async state=>{const found=await rows(tx,operationId,state);if(found.length>1)fail('CHIEF_FEISHU_NATIVE_CONFLICT');if(found[0])taskId=found[0].entityId;return found[0]?.details??null;};
   return fn({dispatchContext:{db:tx},readRegistration:()=>read('registered'),readState:read,
    readTask:async id=>{const [t]=await tx.select().from(s.issues).where(o.eq(s.issues.id,id)).for('update');return t;},
    createTask:async message=>{for(const key of ['companyId','projectId','nativeOwnerId','chiefAgentId','appId','tenantKey','ownerOpenId'])if(message[key]!==binding[key])fail('CHIEF_FEISHU_BINDING_CHANGED');
     const id=randomUUID(),t=await issueService(tx).create(binding.companyId,{id,projectId:binding.projectId,title:message.goal.split('\n')[0].slice(0,140),description:message.goal,status:'todo',assigneeAgentId:binding.chiefAgentId,responsibleUserId:binding.nativeOwnerId,createdByUserId:binding.nativeOwnerId,actorResponsibleUserId:binding.nativeOwnerId,trustExplicitResponsibleUserId:true,idempotencyKey:'chief-feishu:'+operationId,allowDuplicate:true});if(t.id!==id||t.companyId!==binding.companyId||t.projectId!==binding.projectId||t.createdByUserId!==binding.nativeOwnerId||t.responsibleUserId!==binding.nativeOwnerId||t.assigneeAgentId!==binding.chiefAgentId||t.description!==message.goal)fail('CHIEF_FEISHU_NATIVE_TASK_BINDING_DENIED');taskId=t.id;return t;},
    append:async(state,record)=>logActivity(tx,{companyId:binding.companyId,actorType:'user',actorId:binding.nativeOwnerId,action:action(state),entityType:'issue',entityId:record.taskId??taskId,details:record},publications)});
  });for(const publication of publications)publishActivity(publication);return result;},
  async listRegistrations(){const records=await db.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,binding.companyId),o.eq(s.activityLog.action,action('registered')))).orderBy(s.activityLog.createdAt);return records.map(x=>x.details);}
 };
 return createChiefFeishuController({repository,canDispatch,acknowledge,log,wake:async record=>{
  const api=heartbeatService(db),key='chief-feishu:'+record.operationId;
  const prior=await db.select().from(s.agentWakeupRequests).where(o.and(o.eq(s.agentWakeupRequests.companyId,binding.companyId),o.eq(s.agentWakeupRequests.idempotencyKey,key)));
  if(prior.length)fail('CHIEF_FEISHU_WAKE_RECONCILE_ONLY');
  return api.wakeup(binding.chiefAgentId,{source:'on_demand',triggerDetail:'manual',manualUserWake:true,reason:'trusted_feishu_owner_goal',requestedByActorType:'user',requestedByActorId:binding.nativeOwnerId,idempotencyKey:key,payload:{issueId:record.taskId},contextSnapshot:{issueId:record.taskId,taskId:record.taskId,projectId:binding.projectId,responsibleUserId:binding.nativeOwnerId,sourceParams:record.sourceParams,taskGoal:(await issueService(db).getById(record.taskId)).description,forceFreshSession:true,conversationMode:false}});
 }});
}
