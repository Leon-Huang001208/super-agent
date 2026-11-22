import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { chiefFeishuOperation } from './chief-feishu-native.mjs';
import { contextMemoryId } from './chief-context-commands.mjs';
import { taskInputRevision } from './task-input.mjs';
import { ROLE_KEYS } from './role-labels.mjs';
import {isOfficialRecoveredGoal} from './chief-official-message-recovery.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const opaque=/^[A-Za-z0-9_-]{1,256}$/;
const messageId=/^om_[A-Za-z0-9]{1,245}$/;
const chatId=/^oc_[A-Za-z0-9]{1,253}$/;
const kinds=new Set(['help','projects','select_project','status','append','continue','pause','followup','remember','correct','memory','memory_history','share','new']);
const taskKinds=new Set(['status','append','continue','pause','followup']);
const writeKinds=new Set(['remember','correct','share']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
function executionCallLimit(execution){
 const maximum=execution.budgetMaximum??6;
 if(![6,12,20].includes(maximum))fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
 return maximum;
}
function frozen(value){const copy=clone(value);const visit=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))visit(child);Object.freeze(v);}return v;};return visit(copy);}
function instant(value){const date=new Date(typeof value==='string'&&/^\d{10,16}$/.test(value)?Number(value):value);if(!Number.isFinite(date.getTime()))fail('CHIEF_CONTEXT_CLOCK_INVALID');return date.toISOString();}
function recordVersion(value){return Number.isSafeInteger(value)&&value>=0;}
function sourceDigest(snapshot){return sha({bodySha256:snapshot.bodySha256,command:snapshot.command,appId:snapshot.appId,tenantKey:snapshot.tenantKey,
  ownerOpenId:snapshot.ownerOpenId,nativeOwnerId:snapshot.nativeOwnerId,companyId:snapshot.companyId,chiefAgentId:snapshot.chiefAgentId,
  messageId:snapshot.messageId,chatId:snapshot.chatId,sourceParams:snapshot.sourceParams});}

export const chiefContextFingerprint=sourceDigest;

/** Same source identity as the existing M1 intake; action namespaces remain separate. */
export const chiefContextSourceKey=chiefFeishuOperation;

/**
 * Native domain policy. Repository callbacks own SQL, locks and authenticated authority.
 * External SDK, task registration and knowledge effects are deliberately outside transactions.
 */
export function createChiefContextController({binding,catalog,repository,knowledgeStore,registerNewGoal,acknowledge,log,now=()=>Date.now()}={}){
  if(!object(binding)||!/^cli_[A-Za-z0-9]+$/.test(binding.appId??'')||!opaque.test(binding.tenantKey??'')||
    !/^ou_[A-Za-z0-9]+$/.test(binding.ownerOpenId??'')||!opaque.test(binding.nativeOwnerId??'')||
    !['companyId','projectId','chiefAgentId'].every(key=>uuid.test(binding[key]??''))||
    !catalog||!['list','resolve','forNativeTask'].every(key=>typeof catalog[key]==='function')||
    typeof repository?.transaction!=='function'||!knowledgeStore||!['remember','correct','query','history'].every(key=>typeof knowledgeStore[key]==='function')||
    ![registerNewGoal,acknowledge,log,now].every(fn=>typeof fn==='function'))fail('CHIEF_CONTEXT_CONFIGURATION_INVALID');
  const trusted=frozen(binding),actor={companyId:trusted.companyId,ownerId:trusted.nativeOwnerId};
  const at=()=>instant(now());
  const emit=async event=>{try{await log(event);}catch{fail('CHIEF_CONTEXT_LOG_FAILED');}};
  const txOptions=(message,extra={})=>({chatId:message?.chatId,actor:'owner',...extra});
  const scope=project=>({companyId:project.companyId,ownerId:project.ownerId,projectId:project.projectId,projectKey:project.key});
  const transact=(key,message,fn,extra={})=>repository.transaction(key,fn,txOptions(message,extra));

  function messageOf(input){
    if(!object(input)||!object(input.command)||!kinds.has(input.command.kind)||typeof input.text!=='string'||
      input.text.length>16000||!digest.test(input.bodySha256??'')||sha(input.text)!==input.bodySha256||
      !messageId.test(input.messageId??'')||!chatId.test(input.chatId??''))fail('CHIEF_CONTEXT_MESSAGE_INVALID');
    for(const key of ['appId','tenantKey','ownerOpenId','nativeOwnerId','companyId','projectId','chiefAgentId']){
      if(input[key]!==trusted[key])fail('CHIEF_CONTEXT_BINDING_DENIED');
    }
    const params=input.sourceParams;
    // SDK callers retain the existing authenticated transport contract. API recovery is a new goal only,
    // and accepts the closed verifier's in-process object, never a caller's serialized envelope.
    const recovered=params?.eventType==='feishu.message_api_recovery'&&input.command.kind==='new'&&isOfficialRecoveredGoal(input);
    if(!object(params)||params.source!=='feishu'||params.eventType!=='im.message.receive_v1'&&!recovered)fail('CHIEF_CONTEXT_BINDING_DENIED');
    for(const key of ['appId','tenantKey','ownerOpenId','messageId','chatId','bodySha256'])if(params[key]!==input[key])fail('CHIEF_CONTEXT_BINDING_DENIED');
    let value;try{value=frozen(input);}catch{fail('CHIEF_CONTEXT_MESSAGE_INVALID');}
    if(JSON.stringify(value.command).length>24000)fail('CHIEF_CONTEXT_COMMAND_INVALID');
    return value;
  }

  function chatOf(value,message){
    if(value===null||value===undefined){const project=catalog.resolve(actor);return {schemaVersion:1,...actor,chatId:message.chatId,
      projectId:project.projectId,taskId:null,projectTasks:{},projectGoalOperations:{},pendingGoalOperationId:null,sequence:0,revision:0};}
    if(!object(value)||value.companyId!==actor.companyId||value.ownerId!==actor.ownerId||value.chatId!==message.chatId||
      !uuid.test(value.projectId??'')||!recordVersion(value.sequence??value.revision)||!recordVersion(value.revision??value.sequence)||
      !object(value.projectTasks??{}))fail('CHIEF_CONTEXT_CHAT_CHANGED');
    if(Object.entries(value.projectTasks??{}).some(([projectId,taskId])=>!uuid.test(projectId)||!uuid.test(taskId??''))||
      Object.entries(value.projectGoalOperations??{}).some(([projectId,operationId])=>!uuid.test(projectId)||!uuid.test(operationId??''))||
      value.taskId!==undefined&&value.taskId!==null&&!uuid.test(value.taskId)||
      value.pendingGoalOperationId!==undefined&&value.pendingGoalOperationId!==null&&!uuid.test(value.pendingGoalOperationId))fail('CHIEF_CONTEXT_CHAT_CHANGED');
    return {...clone(value),projectTasks:clone(value.projectTasks??{}),projectGoalOperations:clone(value.projectGoalOperations??{}),
      sequence:value.sequence??value.revision,revision:value.revision??value.sequence};
  }

  function nextChat(chat,patch){
    if(chat.sequence>=Number.MAX_SAFE_INTEGER-1||chat.revision>=Number.MAX_SAFE_INTEGER-1)fail('CHIEF_CONTEXT_CHAT_CHANGED');
    return {...chat,...patch,sequence:chat.sequence+1,revision:chat.revision+1};
  }

  function controlOf(value,task,{metadataOnly=false,project}={}){
    if(!value||value.managed===false)return {managed:false,inputRevision:taskInputRevision(task)};
    if(value.managed!==true||value.schemaVersion!==1||value.taskId!==task.id||value.companyId!==task.companyId||
      value.projectId!==task.projectId||value.ownerId!==actor.ownerId||!digest.test(value.inputRevision??'')||
      !recordVersion(value.revision)||!Array.isArray(value.pendingInputs)||value.pendingInputs.length>32)fail('CHIEF_CONTEXT_CONTROL_CHANGED');
    const selected=project??catalog.forNativeTask(task,{ownerId:actor.ownerId});
    if(!metadataOnly&&value.projectWorkspaceId!==selected.projectWorkspaceId)fail('CHIEF_CONTEXT_CONTROL_CHANGED');
    return {...clone(value),inputSequence:value.inputSequence??0,checkpoints:clone(value.checkpoints??[]),resumeHistory:clone(value.resumeHistory??[])};
  }

  function metadataProject(task){
    if(!object(task)||!uuid.test(task.id??'')||!uuid.test(task.projectId??'')||task.companyId!==actor.companyId||
      task.responsibleUserId!==actor.ownerId)fail('CONTEXT_PROJECT_NATIVE_SCOPE_DENIED');
    return catalog.resolve({...actor,projectId:task.projectId});
  }

  async function ownedTask(tx,reference,{metadataOnly=false,rootRequired=true}={}){
    const task=await tx.readTask(reference);
    if(!task)fail('CHIEF_CONTEXT_TASK_NOT_FOUND');
    const project=metadataOnly?metadataProject(task):catalog.forNativeTask(task,{ownerId:actor.ownerId});
    if(rootRequired&&task.parentId)fail('CHIEF_CONTEXT_ROOT_REQUIRED');
    return {task,project,control:controlOf(await tx.readControl(task.id),task,{metadataOnly,project})};
  }

  function contextSelection(chat,command,project){
    if(command.taskIdentifier)return null;
    if(taskKinds.has(command.kind)){
      const projectId=command.projectKeyOrAlias?project.projectId:chat.projectId;
      return {projectId,taskId:chat.projectTasks[projectId]??(chat.projectId===projectId?chat.taskId:null)};
    }
    if(!command.projectKeyOrAlias&&['new','remember','correct','memory','memory_history','share'].includes(command.kind))return {projectId:chat.projectId};
    return null;
  }

  function checkIntent(intent,message){
    if(!intent||intent.fingerprint!==sourceDigest(message)||intent.bodySha256!==message.bodySha256||intent.sourceKey!==chiefContextSourceKey(message))fail('CHIEF_CONTEXT_SOURCE_CONFLICT');
  }

  async function inspectSource(message){
    const sourceKey=chiefContextSourceKey(message);
    return transact(sourceKey,message,async tx=>{
      const intent=await tx.readState('intent'),result=await tx.readState('result');
      if(intent){checkIntent(intent,message);return {intent,result};}
      if(result){if(result.fingerprint!==sourceDigest(message))fail('CHIEF_CONTEXT_SOURCE_CONFLICT');return {result};}
      const legacy=await tx.readLegacyRegistration(message);
      if(legacy){if(legacy.bodySha256!==message.bodySha256||legacy.companyId!==actor.companyId||legacy.ownerId!==actor.ownerId)fail('CHIEF_CONTEXT_SOURCE_CONFLICT');return {legacy};}
      const command=message.command,chat=chatOf(await tx.readChat(),message);
      let project=catalog.resolve({...actor,...(command.projectKeyOrAlias?{projectKeyOrAlias:command.projectKeyOrAlias}:{projectId:chat.projectId})});
      let task=null,control=null;
      if(taskKinds.has(command.kind)){
        const reference=command.taskIdentifier??chat.projectTasks[project.projectId]??(chat.projectId===project.projectId?chat.taskId:null);
        if(reference){const found=await ownedTask(tx,reference,{metadataOnly:['status','followup'].includes(command.kind),rootRequired:command.kind!=='status'});task=found.task;control=found.control;
          if((command.projectKeyOrAlias||!command.taskIdentifier)&&project.projectId!==found.project.projectId)fail('CHIEF_CONTEXT_PROJECT_CONFLICT');project=found.project;
        }else if(command.kind!=='status')fail('CHIEF_CONTEXT_TASK_REQUIRED');
      }
      return {project,task,control,chat,contextSelection:contextSelection(chat,command,project)};
    });
  }

  function sourceOf(message,acceptedAt){
    const sent=message.createdAt??message.sourceParams.createdAt;
    return {messageId:message.messageId,chatId:message.chatId,bodySha256:message.bodySha256,
      ...(message.sourceParams.eventId&&{eventId:message.sourceParams.eventId}),createdAt:sent===undefined?acceptedAt:instant(sent)};
  }

  function checkedMemory(record,project,visibility,role){
    if(!record||record.companyId!==project.companyId||record.ownerId!==project.ownerId||record.projectId!==project.projectId||record.project!==project.key||record.visibility!==visibility||
      !['project','private'].includes(visibility)||visibility==='private'&&record.role!==role||
      !['fact','decision','experience','source'].includes(record.kind)||typeof record.text!=='string'||typeof record.condition!=='string'||
      !Number.isSafeInteger(record.version)||record.version<1||
      !digest.test(record.sha256??'')||record.confirmation?.status!=='owner-confirmed')fail('CHIEF_CONTEXT_MEMORY_NOT_FOUND');
    return record;
  }

  async function memoryPreparation(message,view,operationId,acceptedAt){
    const command=message.command,visibility=command.role?'private':'project',role=command.role;
    if(role&&!view.project.allowedRoles.includes(role))fail('CHIEF_CONTEXT_ROLE_DENIED');
    const id=command.key?contextMemoryId(command.key):null,source=sourceOf(message,acceptedAt);
    const history=id?await knowledgeStore.history({scope:scope(view.project),id,visibility,role}):[];
    const current=history.at(-1);
    if(command.kind==='remember'&&current)fail('PROJECT_KNOWLEDGE_ALREADY_EXISTS');
    if(command.kind==='correct'){
      checkedMemory(current,view.project,visibility,role);
      if(command.expectedVersion!==undefined&&command.expectedVersion!==current.version)fail('PROJECT_KNOWLEDGE_VERSION_CONFLICT');
      if((message.createdAt??message.sourceParams.createdAt)!==undefined&&source.createdAt<current.confirmation.source.createdAt)fail('PROJECT_KNOWLEDGE_STALE_SOURCE');
    }
    let target=view.project,shareSource;
    if(command.kind==='share'){
      if(role)fail('CHIEF_CONTEXT_PRIVATE_SHARE_DENIED');
      checkedMemory(current,view.project,'project',undefined);
      target=catalog.resolve({...actor,projectKeyOrAlias:command.targetProjectKeyOrAlias});
      if(target.projectId===view.project.projectId)fail('CHIEF_CONTEXT_SHARE_TARGET_INVALID');
      const targetHistory=await knowledgeStore.history({scope:scope(target),id,visibility:'project'});
      if(targetHistory.length)fail('CHIEF_CONTEXT_SHARE_TARGET_EXISTS');
      shareSource={projectId:view.project.projectId,projectKey:view.project.key,id,version:current.version,sha256:current.sha256};
    }
    const condition=command.kind==='share'
      ? `Owner-confirmed explicit share of ${command.key} from ${view.project.key}/${id}/v${current.version} SHA256 ${current.sha256}; until explicitly corrected`
      : `Owner-confirmed memory key ${command.key}; applies to ${view.project.key} until explicitly corrected`;
    const writeRequest={scope:scope(target),id,visibility,...(role&&{role}),text:command.kind==='share'?current.text:command.text,
      condition,source,operationId,...(command.kind==='correct'?{expectedVersion:command.expectedVersion??current.version}:{kind:command.kind==='share'?current.kind:'decision'})};
    if(typeof writeRequest.text!=='string'||!writeRequest.text.trim()||Buffer.byteLength(writeRequest.text)>16384)fail('CHIEF_CONTEXT_COMMAND_INVALID');
    return {writeRequest,scope:scope(target),shareSource,memoryBase:current?{version:current.version,sha256:current.sha256,kind:current.kind}:null};
  }

  async function prepare(message,view){
    const sourceKey=chiefContextSourceKey(message),operationId=randomUUID(),acceptedAt=at(),command=message.command;
    let memory={};
    if(writeKinds.has(command.kind))memory=await memoryPreparation(message,view,operationId,acceptedAt);
    return transact(sourceKey,message,async tx=>{
      const prior=await tx.readState('intent');if(prior){checkIntent(prior,message);return {intent:prior};}
      const result=await tx.readState('result');if(result){if(result.fingerprint!==sourceDigest(message))fail('CHIEF_CONTEXT_SOURCE_CONFLICT');return {result};}
      const legacy=await tx.readLegacyRegistration(message);if(legacy){if(legacy.bodySha256!==message.bodySha256)fail('CHIEF_CONTEXT_SOURCE_CONFLICT');return {legacy};}
      let chat=chatOf(await tx.readChat(),message);
      if(!isDeepStrictEqual(view.contextSelection,contextSelection(chat,command,view.project)))fail('CHIEF_CONTEXT_SOURCE_CONTEXT_CHANGED');
      let task=view.task,control=view.control;
      if(task){const actual=await ownedTask(tx,task.id,{metadataOnly:['status','followup'].includes(command.kind),rootRequired:command.kind!=='status'});
        if(taskInputRevision(actual.task)!==taskInputRevision(task)||actual.project.projectId!==view.project.projectId)fail('CHIEF_CONTEXT_TASK_CHANGED');
        task=actual.task;control=actual.control;
      }
      const intent={schemaVersion:1,sourceKey,operationId,kind:command.kind,command:clone(command),originalText:message.text,fingerprint:sourceDigest(message),
        project:clone(view.project),scope:memory.scope??scope(view.project),source:sourceOf(message,acceptedAt),sourceParams:clone(message.sourceParams),
        bodySha256:message.bodySha256,chatId:message.chatId,acceptedAt,sequence:chat.sequence+1,
        taskId:task?.id??null,baseInputRevision:task?taskInputRevision(task):null,controlRevision:control?.revision??null,
        goal:command.goal??command.text??null,reviewBeforeDispatch:command.reviewBeforeDispatch===true,
        continuationOf:null,...memory};
      if(['new','followup'].includes(command.kind)){
        if(typeof intent.goal!=='string'||!intent.goal.trim()||intent.goal.length>12000)fail('CHIEF_CONTEXT_COMMAND_INVALID');
        if(command.kind==='followup'){
          const execution=await tx.readExecution(task.id);
          if(task.status!=='done'||execution.active||execution.unknown)fail('CHIEF_CONTEXT_FOLLOWUP_DENIED');
          intent.continuationOf=task.id;intent.predecessor={taskId:task.id,identifier:task.identifier,title:task.title,
            description:task.description,inputRevision:taskInputRevision(task)};
        }
        chat=nextChat(chat,{projectId:view.project.projectId,pendingGoalOperationId:operationId,
          projectGoalOperations:{...chat.projectGoalOperations,[view.project.projectId]:operationId}});
        intent.sequence=chat.sequence;await tx.writeChat(chat);
      }
      await tx.append('intent',intent);
      return {intent};
    });
  }

  function receipt(intent,extra={}){return {schemaVersion:1,sourceKey:intent.sourceKey,operationId:intent.operationId,
    fingerprint:intent.fingerprint,kind:intent.kind,projectId:intent.project.projectId,projectKey:intent.project.key,
    chatId:intent.chatId,taskId:intent.taskId??undefined,...extra};}

  async function saveResult(message,intent,value){
    return transact(intent.sourceKey,message,async tx=>{
      const existing=await tx.readState('result');if(existing)return existing;
      const current=await tx.readState('intent');checkIntent(current,message);
      await tx.append('result',value);return value;
    },{actor:'controller'});
  }

  async function reply(message,value){
    if(value.legacy||['new','followup'].includes(value.kind))return frozen(value);
    const claimed=await transact(chiefContextSourceKey(message),message,async tx=>{
      if(await tx.readState('ack_claimed'))return false;
      await tx.append('ack_claimed',{sourceKey:chiefContextSourceKey(message),operationId:value.operationId,taskId:value.taskId??null,bodySha256:sha(value.replyText??'')});return true;
    },{actor:'controller'});
    if(claimed){
      try{
        const sent=await acknowledge(frozen(value));if(!messageId.test(sent?.messageId??''))fail('CHIEF_CONTEXT_ACK_UNKNOWN');
        await transact(chiefContextSourceKey(message),message,tx=>tx.append('ack_sent',{operationId:value.operationId,taskId:value.taskId??null,messageId:sent.messageId}),{actor:'controller'});
      }catch{await emit({code:'CHIEF_CONTEXT_ACK_UNKNOWN',sourceKey:chiefContextSourceKey(message),operationId:value.operationId});}
    }
    return frozen(value);
  }

  async function register(message,intent){
    const claim=await transact(intent.sourceKey,message,async tx=>{
      const registered=await tx.readState('registered');if(registered)return {registered};
      if(await tx.readState('effect_claimed'))return {unknown:true};
      await tx.append('effect_claimed',{operationId:intent.operationId,kind:intent.kind});return {claimed:true};
    },{actor:'controller'});
    if(claim.unknown)fail('CHIEF_CONTEXT_REGISTRATION_RECONCILIATION_REQUIRED');
    let registered=claim.registered;
    if(!registered){
      try{registered=await registerNewGoal({snapshot:message,project:frozen(intent.project),intent:frozen(intent)});}
      catch{await emit({code:'CHIEF_CONTEXT_REGISTRATION_UNKNOWN',sourceKey:intent.sourceKey,operationId:intent.operationId});fail('CHIEF_CONTEXT_REGISTRATION_RECONCILIATION_REQUIRED');}
    }
    return transact(intent.sourceKey,message,async tx=>{
      const saved=await tx.readState('registered');
      if(!saved||saved.taskId!==registered?.taskId)fail('CHIEF_CONTEXT_REGISTRATION_RECONCILIATION_REQUIRED');
      const actual=await ownedTask(tx,saved.taskId);
      if(actual.project.projectId!==intent.project.projectId||!actual.control.managed||
        actual.control.continuationOf!==(intent.continuationOf??null))fail('CHIEF_CONTEXT_REGISTRATION_BINDING_DENIED');
      const value=receipt(intent,{taskId:actual.task.id,identifier:actual.task.identifier,inputRevision:taskInputRevision(actual.task)});
      const prior=await tx.readState('result');if(prior)return prior;await tx.append('result',value);return value;
    },{actor:'controller'});
  }

  async function memoryWrite(message,intent){
    const claimed=await transact(intent.sourceKey,message,async tx=>{
      const done=await tx.readState('result');if(done)return {result:done};
      if(await tx.readState('effect_claimed'))return {reconcile:true};
      await tx.append('effect_claimed',{operationId:intent.operationId,writeRequestSha256:sha(intent.writeRequest)});return {claimed:true};
    },{actor:'controller'});
    if(claimed.result)return claimed.result;
    let record;
    if(claimed.reconcile){
      let history;try{history=await knowledgeStore.history({...intent.writeRequest});}catch{fail('CHIEF_CONTEXT_MEMORY_RECONCILIATION_REQUIRED');}
      record=history.find(item=>item.confirmation?.operationId===intent.operationId&&item.confirmation?.source?.messageId===message.messageId);
      if(!record)fail('CHIEF_CONTEXT_MEMORY_RECONCILIATION_REQUIRED');
    }else{
      try{record=(await knowledgeStore[intent.kind==='correct'?'correct':'remember'](frozen(intent.writeRequest))).record;}
      catch(error){await transact(intent.sourceKey,message,tx=>tx.append('effect_unknown',{operationId:intent.operationId,code:/^[A-Z_]+$/.test(error?.code??'')?error.code:'CHIEF_CONTEXT_MEMORY_UNKNOWN'}),{actor:'controller'});fail('CHIEF_CONTEXT_MEMORY_RECONCILIATION_REQUIRED');}
    }
    checkedMemory(record,intent.kind==='share'?catalog.resolve({...actor,projectId:intent.writeRequest.scope.projectId}):intent.project,
      intent.writeRequest.visibility,intent.writeRequest.role);
    const expectedVersion=intent.kind==='correct'?intent.writeRequest.expectedVersion+1:1;
    if(record.id!==intent.writeRequest.id||record.version!==expectedVersion||record.condition!==intent.writeRequest.condition||
      record.kind!==(intent.kind==='correct'?intent.memoryBase.kind:intent.writeRequest.kind)||record.confirmation.operationId!==intent.operationId||
      !isDeepStrictEqual(record.confirmation.source,intent.writeRequest.source)||record.text!==intent.writeRequest.text)fail('CHIEF_CONTEXT_MEMORY_RESULT_CHANGED');
    const extra=intent.shareSource?{sourceProjectId:intent.shareSource.projectId,sourceVersion:intent.shareSource.version,sourceSha256:intent.shareSource.sha256,targetProjectId:intent.writeRequest.scope.projectId}:{};
    return saveResult(message,intent,receipt(intent,{memoryId:record.id,key:intent.command.key,version:record.version,sha256:record.sha256,...extra,
      replyText:`已${intent.kind==='correct'?'更正':intent.kind==='share'?'共享':'记住'} ${intent.command.key}，版本 ${record.version}。来源与旧依据已保留，新任务将装载此版本；进行中的任务保留已绑定版本。`}));
  }

  function planConfirmationText(task,plan){
    return `任务 ${task.identifier??task.id} 的计划已准备好，按你选择的“先计划后暂停”等待继续。\n${plan.text.slice(0,1600)}\n\n继续当前任务可发送：\n/chief continue ${task.identifier??task.id}`;
  }

  async function notifyPlan(taskId,control){
    if(!control.reviewBeforeDispatch||!control.plan||control.approvedPlanSha256===control.plan.sha256)return;
    const key='context-plan:'+sha([taskId,control.inputRevision,control.plan.sha256]);
    const claimed=await repository.transaction(key,async tx=>{
      const {task,project}=await ownedTask(tx,taskId),current=controlOf(await tx.readControl(taskId),task);
      if(['done','cancelled'].includes(task.status)||current.inputRevision!==control.inputRevision||taskInputRevision(task)!==control.inputRevision||
        current.pendingInputs.length||current.plan?.sha256!==control.plan.sha256||current.approvedPlanSha256===control.plan.sha256)return null;
      if(await tx.readState('plan_ack_claimed'))return null;
      const value={schemaVersion:1,kind:'plan_ready',operationId:randomUUID(),taskId,identifier:task.identifier,projectId:project.projectId,
        projectKey:project.key,chatId:current.chatId,ownerOpenId:trusted.ownerOpenId,inputRevision:current.inputRevision,
        planSha256:current.plan.sha256,replyText:planConfirmationText(task,current.plan)};
      await tx.append('plan_ack_claimed',{...value,replyText:undefined,bodySha256:sha(value.replyText)});return value;
    },{taskId,chatId:control.chatId,actor:'controller'});
    if(!claimed)return;
    try{
      const sent=await acknowledge(frozen(claimed));if(!messageId.test(sent?.messageId??''))fail('CHIEF_CONTEXT_ACK_UNKNOWN');
      await repository.transaction(key,tx=>tx.append('plan_ack_sent',{taskId,operationId:claimed.operationId,planSha256:claimed.planSha256,messageId:sent.messageId}),
        {taskId,chatId:control.chatId,actor:'controller'});
    }catch{await emit({code:'CHIEF_CONTEXT_PLAN_ACK_UNKNOWN',taskId,planSha256:control.plan.sha256});}
  }

  async function continueBlocked(tx,task,control,intent,execution){
    if(control.resumeOperationId){
      if(typeof tx.readOperationRun!=='function')fail('CHIEF_CONTEXT_CONFIGURATION_INVALID');
      const run=await tx.readOperationRun({taskId:task.id,operationId:control.resumeOperationId});
      if(run){
        const operation=run.operationId??run.contextSnapshot?.roleOperationId;
        if(!uuid.test(run.id??'')||run.issueId!==task.id||run.companyId!==task.companyId||run.agentId!==trusted.chiefAgentId||
          operation!==undefined&&operation!==control.resumeOperationId)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
        return {control,value:receipt(intent,{identifier:task.identifier,status:'resume_reconciled',runId:run.id,runStatus:run.status,
          resumeOperationId:control.resumeOperationId,reconciliationRequired:execution.unknown===true,
          replyText:`已定位原继续运行 ${run.id}（${run.status}），保留原操作核对，不新增调用或重发旧成果。`})};
      }
      if(control.resumeClaim?.operationId===control.resumeOperationId)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
    }
    if(execution.unknown)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
    if(execution.active)return {control,value:receipt(intent,{identifier:task.identifier,status:'already_running',replyText:'原任务仍有运行在途，保留原操作核对。'})};
    if(!Number.isSafeInteger(execution.budgetUsed)||execution.budgetUsed<0)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
    const remaining=Math.max(0,executionCallLimit(execution)-execution.budgetUsed);
    if(remaining<3)return {control,value:receipt(intent,{identifier:task.identifier,status:'budget_exhausted',remainingCalls:remaining,requiredCalls:3,
      replyText:`原任务剩余 ${remaining} 次调用，本次恢复至少需要 3 次。预算不足，尚未启动模型，也未重发旧成果。`})};
    if(control.plan)await tx.append('plan_snapshot',{taskId:task.id,inputRevision:control.inputRevision,plan:clone(control.plan),
      approvedPlanSha256:control.approvedPlanSha256??null,sourceKey:intent.sourceKey,operationId:intent.operationId,at:at()});
    const pending=control.pendingInputs.length>0,operationId=control.resumeOperationId??intent.operationId;
    const next={...control,revision:control.revision+1,plan:null,approvedPlanSha256:null,approvalOperationId:null,
      reviewBeforeDispatch:false,pauseRequested:false,resumeOperationId:operationId,
      resumeSourceKey:control.resumeOperationId?control.resumeSourceKey??intent.sourceKey:intent.sourceKey,
      resumeInputRevision:pending?null:control.inputRevision,resumeForPendingSequence:pending?control.inputSequence:null};
    const updated=await tx.updateTask(task.id,{status:'in_review',assigneeUserId:actor.ownerId,assigneeAgentId:null});
    if(!updated||updated.id!==task.id||updated.companyId!==task.companyId||updated.projectId!==task.projectId||
      updated.responsibleUserId!==actor.ownerId||updated.parentId||updated.status!=='in_review'||updated.assigneeUserId!==actor.ownerId||
      updated.assigneeAgentId||taskInputRevision(updated)!==control.inputRevision)fail('CHIEF_CONTEXT_TASK_UPDATE_UNKNOWN');
    return {control:next,value:receipt(intent,{identifier:task.identifier,status:'resume_requested',resumeOperationId:operationId,
      replyText:'已保留旧计划快照，按当前输入在原任务内重新规划；原 hash 和累计预算保留。'})};
  }

  async function nativeCommand(message,intent){
    return transact(intent.sourceKey,message,async tx=>{
      const prior=await tx.readState('result');if(prior)return prior;
      let chat=chatOf(await tx.readChat(),message),value;
      if(intent.kind==='help'||intent.kind==='projects'){
        const projects=catalog.list().map(p=>({key:p.key,aliases:p.aliases,projectId:p.projectId,maximumAction:p.maximumAction}));
        value=receipt(intent,{projects,replyText:intent.kind==='help'?'使用 /chief project、status、add、continue、remember、correct 或 new。':'已登记项目：'+projects.map(p=>p.key).join('、')});
      }else if(intent.kind==='select_project'){
        const taskId=chat.projectTasks[intent.project.projectId]??null;
        if(taskId){const selected=await ownedTask(tx,taskId);if(selected.project.projectId!==intent.project.projectId)fail('CHIEF_CONTEXT_PROJECT_CONFLICT');}
        chat=nextChat(chat,{projectId:intent.project.projectId,taskId,pendingGoalOperationId:null});await tx.writeChat(chat);
        value=receipt(intent,{taskId,replyText:`当前项目：${intent.project.key}${taskId?'；已恢复该项目所选任务':''}。`});
      }else{
        if(!intent.taskId){value=receipt(intent,{status:'no_selected_task',replyText:'本项目当前没有已选择的任务。'});}
        else{
          const actual=await ownedTask(tx,intent.taskId,{metadataOnly:intent.kind==='status',rootRequired:intent.kind!=='status'}),task=actual.task;let control=actual.control;
          if(actual.project.projectId!==intent.project.projectId)fail('CHIEF_CONTEXT_PROJECT_CONFLICT');
          if(intent.kind==='status')value=receipt(intent,{identifier:task.identifier,status:task.status,inputRevision:taskInputRevision(task),revision:control.revision??null,pendingCount:control.pendingInputs?.length??0,
            replyText:`${task.identifier??task.id}：${task.status}；待应用补充 ${control.pendingInputs?.length??0} 条。`});
          else{
            if(!control.managed)fail('CHIEF_CONTEXT_TASK_UNMANAGED');
            if(taskInputRevision(task)!==control.inputRevision||taskInputRevision(task)!==intent.baseInputRevision)fail('CHIEF_CONTEXT_TASK_CHANGED');
            if(['done','cancelled'].includes(task.status))fail('CHIEF_CONTEXT_TASK_TERMINAL');
            const execution=await tx.readExecution(task.id);
            if(intent.kind==='append'){
              if(typeof intent.command.text!=='string'||!intent.command.text.trim()||intent.command.text.length>12000||control.pendingInputs.length>=32)fail('CHIEF_CONTEXT_COMMAND_INVALID');
              const cumulative=Buffer.byteLength(task.description??'')+control.pendingInputs.reduce((n,item)=>n+Buffer.byteLength(item.text),0)+Buffer.byteLength(intent.command.text);
              if(cumulative>65536)fail('CHIEF_CONTEXT_INPUT_LIMIT');
              const sequence=(control.inputSequence??0)+1;
              control={...control,revision:control.revision+1,inputSequence:sequence,pendingInputs:[...control.pendingInputs,{sourceKey:intent.sourceKey,messageId:message.messageId,text:intent.command.text,sequence}],
                pauseRequested:true,approvedPlanSha256:null,approvalOperationId:null};
              await tx.addOwnerComment(task.id,{text:intent.command.text,sourceKey:intent.sourceKey,revision:sequence});
              value=receipt(intent,{identifier:task.identifier,inputRevision:control.inputRevision,revision:control.revision,pending:true,
                replyText:`已记录 ${task.identifier??task.id} 的补充；待当前运行收口后应用新版本。`});
            }else if(intent.kind==='pause'){
              control={...control,revision:control.revision+1,pauseRequested:true};
              value=receipt(intent,{identifier:task.identifier,replyText:'已暂停后续派发，保留当前运行与账本。'});
            }else if(intent.kind==='continue'){
              if(task.status==='blocked')({control,value}=await continueBlocked(tx,task,control,intent,execution));
              else{
              if(execution.unknown)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
              const hasPending=control.pendingInputs.length>0,currentPlan=control.plan?.inputRevision===control.inputRevision?control.plan:null;
              if(!hasPending&&currentPlan){
                control={...control,revision:control.revision+1,approvedPlanSha256:currentPlan.sha256,approvalOperationId:intent.operationId,
                  reviewBeforeDispatch:false,pauseRequested:false};
                value=receipt(intent,{identifier:task.identifier,approvedPlanSha256:currentPlan.sha256,replyText:'已收到继续请求，将按当前输入和既有计划执行；原任务与累计预算保留。'});
              }else if(execution.active&&!hasPending){
                value=receipt(intent,{identifier:task.identifier,status:'already_running',replyText:'原任务仍在运行，未新增模型调用。'});
              }else{
                if(Number.isSafeInteger(execution.budgetUsed)&&execution.budgetUsed>=executionCallLimit(execution))fail('CHIEF_CONTEXT_BUDGET_EXHAUSTED');
                const reuse=control.resumeOperationId&&(!hasPending||control.resumeForPendingSequence===control.inputSequence);
                control={...control,revision:control.revision+1,resumeHistory:[...(control.resumeHistory??[]),...(!reuse&&control.resumeOperationId?[{operationId:control.resumeOperationId,inputRevision:control.resumeInputRevision??control.inputRevision,reason:'new_owner_input'}]:[])],
                  resumeOperationId:reuse?control.resumeOperationId:intent.operationId,resumeSourceKey:reuse?control.resumeSourceKey:intent.sourceKey,
                  resumeInputRevision:hasPending?null:control.inputRevision,resumeForPendingSequence:hasPending?control.inputSequence:null,
                  reviewBeforeDispatch:false,pauseRequested:false,approvedPlanSha256:null,approvalOperationId:null};
                value=receipt(intent,{identifier:task.identifier,resumeOperationId:control.resumeOperationId,replyText:hasPending?'已登记按补充继续的请求；新计划将按当前输入自动执行。':'已登记原任务继续请求；保留累计预算并核对已有操作。'});
              }
              }
            }else fail('CHIEF_CONTEXT_COMMAND_INVALID');
            if(!isDeepStrictEqual(actual.control,control))await tx.writeControl(task.id,control);
            chat=nextChat(chat,{projectId:task.projectId,taskId:task.id,projectTasks:{...chat.projectTasks,[task.projectId]:task.id},pendingGoalOperationId:null});await tx.writeChat(chat);
          }
        }
      }
      await tx.append('result',value);return value;
    });
  }

  async function memoryRead(message,intent){
    const command=intent.command,visibility=command.role?'private':'project',role=command.role??'chief';
    if(!intent.project.allowedRoles.includes(role))fail('CHIEF_CONTEXT_ROLE_DENIED');
    let records;
    if(command.key){records=await knowledgeStore.history({scope:scope(intent.project),id:contextMemoryId(command.key),visibility,role:command.role});if(intent.kind!=='memory_history')records=records.slice(-1);}
    else records=await knowledgeStore.query({scope:scope(intent.project),role,limit:32});
    for(const record of records)checkedMemory(record,intent.project,record.visibility,record.visibility==='private'?role:undefined);
    const visible=records.filter(record=>command.role?record.visibility==='private'&&record.role===command.role:record.visibility==='project');
    const replyText=visible.length?visible.map(record=>`${command.key??record.id} v${record.version}：${record.text}`).join('\n').slice(0,3800):'本项目没有匹配的已确认记忆。';
    return saveResult(message,intent,receipt(intent,{records:visible.map(record=>({id:record.id,version:record.version,sha256:record.sha256,source:record.source})),replyText}));
  }

  async function dispatchTrustedCommand(input){
    const message=messageOf(input);let view=await inspectSource(message);
    if(view.legacy)return frozen({...view.legacy,legacy:true,reused:true});
    if(view.result)return reply(message,view.result);
    if(!view.intent)view=await prepare(message,view);
    if(view.legacy)return frozen({...view.legacy,legacy:true,reused:true});
    if(view.result)return reply(message,view.result);
    const intent=view.intent;let result;
    try{
      if(['new','followup'].includes(intent.kind))result=await register(message,intent);
      else if(writeKinds.has(intent.kind))result=await memoryWrite(message,intent);
      else if(['memory','memory_history'].includes(intent.kind))result=await memoryRead(message,intent);
      else result=await nativeCommand(message,intent);
      await emit({code:'CHIEF_CONTEXT_COMMAND_RECORDED',kind:intent.kind,sourceKey:intent.sourceKey,operationId:intent.operationId,projectId:intent.project.projectId});
      return reply(message,result);
    }catch(error){await emit({code:/^(?:CHIEF_CONTEXT|PROJECT_KNOWLEDGE)_[A-Z_]+$/.test(error?.code??'')?error.code:'CHIEF_CONTEXT_OPERATION_UNKNOWN',sourceKey:intent.sourceKey,operationId:intent.operationId});throw error;}
  }

  function registryProject(registry,task){
    if(registry?.context?.schemaVersion!==1||registry.context.enabled!==true||registry.companyId!==actor.companyId||registry.ownerId!==actor.ownerId||
      registry.team?.ids?.chief!==trusted.chiefAgentId)fail('CHIEF_CONTEXT_REGISTRY_CHANGED');
    const project=catalog.forNativeTask(task,{ownerId:actor.ownerId});
    const configured=registry.context.catalog?.projects?.find(p=>p.projectId===project.projectId);
    for(const key of ['key','companyId','projectId','projectWorkspaceId','ownerId','adapterKey','maximumAction','workspaceCwd'])if(configured?.[key]!==project[key])fail('CHIEF_CONTEXT_REGISTRY_CHANGED');
    if(!isDeepStrictEqual(configured.allowedRoles,project.allowedRoles))fail('CHIEF_CONTEXT_REGISTRY_CHANGED');
    return project;
  }

  function childrenOf(flow,task){
    const children=flow?.children??[];
    if(!Array.isArray(children)||children.length>32)fail('CHIEF_CONTEXT_CHILD_SCOPE_CHANGED');
    for(const child of children){if(!object(child)||!uuid.test(child.taskId??child.id??'')||
      child.projectId!==undefined&&child.projectId!==task.projectId||child.companyId!==undefined&&child.companyId!==task.companyId||
      child.ownerId!==undefined&&child.ownerId!==actor.ownerId)fail('CHIEF_CONTEXT_CHILD_SCOPE_CHANGED');}
    return clone(children);
  }

  function checkFlow(flow,task,project){
    if(!flow)return;
    if(flow.rootTaskId!==task.id)fail('CHIEF_CONTEXT_FLOW_CHANGED');
    for(const [field,value]of Object.entries({projectId:project.projectId,projectKey:project.key,workspaceCwd:project.workspaceCwd,projectWorkspaceId:project.projectWorkspaceId})){
      if(flow[field]!==undefined&&flow[field]!==value)fail('CHIEF_CONTEXT_FLOW_CHANGED');
    }
  }

  async function syncTask({registry,task,flow,transaction}={}){
    if(!uuid.test(task?.id??''))fail('CHIEF_CONTEXT_TASK_REQUIRED');
    return repository.transaction('context-sync:'+task.id,async tx=>{
      const actual=(await ownedTask(tx,task.id)).task,project=registryProject(registry,actual);checkFlow(flow,actual,project);
      let control=controlOf(await tx.readControl(actual.id),actual);
      if(!control.managed)return {task:actual,control};
      if(control.inputRevision!==taskInputRevision(actual))fail('CHIEF_CONTEXT_TASK_CHANGED');
      if(transaction?.db)return {task:actual,control};
      if(!control.pendingInputs.length||['done','cancelled'].includes(actual.status))return {task:actual,control};
      const execution=await tx.readExecution(actual.id);
      if(execution.active||execution.unknown)return {task:actual,control:{...control,reconciliationRequired:execution.unknown===true}};
      if(actual.executionRunId||actual.checkoutRunId)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
      if(flow&&(flow.rootTaskId!==actual.id||flow.inputRevision!==control.inputRevision))fail('CHIEF_CONTEXT_FLOW_CHANGED');
      const children=childrenOf(flow,actual),previousInputRevision=control.inputRevision;
      const description=(actual.description??'')+control.pendingInputs.map(item=>`\n\n[Owner input ${item.sequence}; ${item.messageId}]\n${item.text}`).join('');
      if(Buffer.byteLength(description)>65536)fail('CHIEF_CONTEXT_INPUT_LIMIT');
      const updated={...actual,description,status:'in_review',assigneeUserId:actor.ownerId,assigneeAgentId:null};
      const newInputRevision=taskInputRevision(updated);
      await tx.supersedeChildren({rootTaskId:actual.id,previousInputRevision,newInputRevision,children});
      const applied=await tx.updateTask(actual.id,{description,status:'in_review',assigneeUserId:actor.ownerId,assigneeAgentId:null});
      if(!applied||applied.id!==actual.id||applied.companyId!==actual.companyId||applied.projectId!==actual.projectId||
        applied.responsibleUserId!==actor.ownerId||applied.parentId||applied.status!=='in_review'||applied.assigneeUserId!==actor.ownerId||
        applied.assigneeAgentId||taskInputRevision(applied)!==newInputRevision)fail('CHIEF_CONTEXT_TASK_UPDATE_UNKNOWN');
      const resumePending=control.resumeOperationId&&control.resumeForPendingSequence===control.inputSequence;
      control={...control,revision:control.revision+1,inputRevision:newInputRevision,appliedInputSequence:control.inputSequence,pendingInputs:[],plan:null,
        approvedPlanSha256:null,approvalOperationId:null,pauseRequested:!resumePending,
        resumeHistory:[...(control.resumeHistory??[]),...(!resumePending&&control.resumeOperationId?[{operationId:control.resumeOperationId,inputRevision:previousInputRevision,reason:'superseded_input'}]:[])],
        resumeOperationId:resumePending?control.resumeOperationId:null,resumeInputRevision:resumePending?newInputRevision:null,resumeForPendingSequence:null,
        supersessions:[...(control.supersessions??[]),{previousInputRevision,newInputRevision,children,at:at()}]};
      await tx.writeControl(actual.id,control);return {task:applied,control};
    },{taskId:task.id,actor:'controller',...(transaction?.db&&{db:transaction.db})});
  }

  function artifactOf(artifact){
    if(!object(artifact)||typeof artifact.file!=='string'||!/^[-a-zA-Z0-9_.]{1,180}$/.test(artifact.file)||artifact.file==='.'||artifact.file==='..'||
      !digest.test(artifact.sha256??'')||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<1||artifact.bytes>262144||
      typeof artifact.text!=='string'||Buffer.byteLength(artifact.text)!==artifact.bytes||sha(artifact.text)!==artifact.sha256)fail('CHIEF_CONTEXT_ARTIFACT_INVALID');
    return {file:artifact.file,sha256:artifact.sha256,bytes:artifact.bytes,text:artifact.text};
  }

  async function checkpoint({registry,task,flow,kind,runId,artifact,transaction}={}){
    if(!uuid.test(task?.id??'')||!['plan_ready','resume_claim','superseded'].includes(kind))fail('CHIEF_CONTEXT_CHECKPOINT_INVALID');
    const key='context-checkpoint:'+sha({taskId:task.id,kind,runId:runId??null,artifact});
    const result=await repository.transaction(key,async tx=>{
      const actual=(await ownedTask(tx,task.id)).task,project=registryProject(registry,actual);checkFlow(flow,actual,project);
      let control=controlOf(await tx.readControl(actual.id),actual);
      if(!control.managed||control.inputRevision!==taskInputRevision(actual)||flow?.rootTaskId!==actual.id)fail('CHIEF_CONTEXT_CONTROL_CHANGED');
      if(kind!=='superseded'&&flow.inputRevision!==control.inputRevision)fail('CHIEF_CONTEXT_FLOW_CHANGED');
      if(kind==='plan_ready'){
        const plan=artifactOf(artifact);
        if(control.pendingInputs.length)fail('CHIEF_CONTEXT_PENDING_INPUT');
        if(!uuid.test(runId??''))fail('CHIEF_CONTEXT_PLAN_RUN_CHANGED');
        const run=await tx.readRun(runId);
        if(!run||run.id!==runId||run.companyId!==actual.companyId||run.issueId!==actual.id||run.agentId!==trusted.chiefAgentId||run.status!=='succeeded')fail('CHIEF_CONTEXT_PLAN_RUN_CHANGED');
        if(control.plan?.inputRevision===control.inputRevision){
          if(control.plan.runId!==runId||control.plan.sha256!==plan.sha256||control.plan.file!==plan.file)fail('CHIEF_CONTEXT_PLAN_SOURCE_CHANGED');
          return {...control,checkpointReused:true};
        }
        control={...control,revision:control.revision+1,plan:{...plan,runId,inputRevision:control.inputRevision,sourceOperationId:flow.sourceOperationId??flow.resumeOperationId??null},
          approvedPlanSha256:null,approvalOperationId:null,pauseRequested:control.pauseRequested||control.reviewBeforeDispatch===true};
        if(control.resumeOperationId&&(flow.sourceOperationId===control.resumeOperationId||flow.resumeOperationId===control.resumeOperationId)){
          control.resumeClaim={...(control.resumeClaim??{}),operationId:control.resumeOperationId,inputRevision:control.inputRevision,runId,status:'completed'};
          control.resumeOperationId=null;control.resumeInputRevision=null;control.resumeForPendingSequence=null;
        }
      }else if(kind==='resume_claim'){
        if(!uuid.test(artifact?.operationId??'')||artifact.operationId!==control.resumeOperationId||artifact.inputRevision!==control.inputRevision||
          control.pauseRequested||control.pendingInputs.length)fail('CHIEF_CONTEXT_RESUME_CHANGED');
        if(control.resumeClaim?.operationId===artifact.operationId){
          if(control.resumeClaim.inputRevision!==control.inputRevision)fail('CHIEF_CONTEXT_RESUME_CHANGED');
          if(runId&&control.resumeClaim.runId&&control.resumeClaim.runId!==runId)fail('CHIEF_CONTEXT_RESUME_CHANGED');
          if(runId&&!control.resumeClaim.runId){const run=await tx.readRun(runId),operation=run?.operationId??run?.contextSnapshot?.roleOperationId;
            if(!uuid.test(runId)||!run||run.issueId!==actual.id||run.agentId!==trusted.chiefAgentId||run.companyId!==actual.companyId||
              operation!==undefined&&operation!==artifact.operationId)fail('CHIEF_CONTEXT_PLAN_RUN_CHANGED');
            control={...control,revision:control.revision+1,resumeClaim:{...control.resumeClaim,runId}};await tx.writeControl(actual.id,control);}
          return {...control,checkpointReused:true,claimGranted:false};
        }
        if(runId!==undefined)fail('CHIEF_CONTEXT_RESUME_CHANGED');
        const execution=await tx.readExecution(actual.id);if(execution.active||execution.unknown)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
        control={...control,revision:control.revision+1,resumeHistory:[...(control.resumeHistory??[]),...(control.resumeClaim?[control.resumeClaim]:[])],
          resumeClaim:{operationId:artifact.operationId,inputRevision:control.inputRevision,claimedAt:at(),status:'claimed'}};
        await tx.writeControl(actual.id,control);return {...control,checkpointReused:false,claimGranted:true};
      }else{
        if(!digest.test(artifact?.previousInputRevision??'')||artifact.newInputRevision!==control.inputRevision)fail('CHIEF_CONTEXT_SUPERSESSION_CHANGED');
        const known=control.supersessions?.find(item=>item.previousInputRevision===artifact.previousInputRevision&&item.newInputRevision===artifact.newInputRevision);
        if(!known||!isDeepStrictEqual(known.children,childrenOf({children:artifact.children??[]},actual)))fail('CHIEF_CONTEXT_SUPERSESSION_CHANGED');
        if(control.checkpoints.some(item=>item.kind===kind&&item.previousInputRevision===artifact.previousInputRevision&&item.newInputRevision===artifact.newInputRevision))return {...control,checkpointReused:true};
        control={...control,revision:control.revision+1,checkpoints:[...control.checkpoints,{kind,previousInputRevision:artifact.previousInputRevision,newInputRevision:artifact.newInputRevision,at:at()}]};
      }
      await tx.writeControl(actual.id,control);return {...control,checkpointReused:false};
    },{taskId:task.id,actor:'controller',...(transaction?.db&&{db:transaction.db})});
    if(kind==='plan_ready'&&!transaction?.db)await notifyPlan(task.id,result);
    return result;
  }

  return Object.freeze({dispatchTrustedCommand,syncTask,checkpoint,validateTrustedMessage:input=>{messageOf(input);}});
}

/** Preserve M1 loading: fixed Native packages are imported only after M2 activation. */
export async function createChiefContextRuntime(options){
  const runtime=await import('./chief-context-paperclip.mjs');
  return runtime.createChiefContextRuntime(options);
}
