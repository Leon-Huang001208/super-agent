import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import { createProjectCatalog } from './context-projects.mjs';
import { createProjectKnowledgeStore } from './project-knowledge-store.mjs';
import { createChiefContextController, chiefContextSourceKey, chiefContextFingerprint } from './chief-context-native.mjs';
import { createChiefContextPaperclipRepository, contextOwnerSenderFromClient } from './chief-context-paperclip.mjs';
import { createChiefFeishuNative } from './chief-feishu-native.mjs';
import { ROLE_ROOT as ROOT } from './role-control-store.mjs';
import {recoverOfficialChiefGoal} from './chief-official-message-recovery.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const knownCode=error=>/^(?:CHIEF_CONTEXT|CONTEXT_PROJECT|PROJECT_KNOWLEDGE|CHIEF_FEISHU)_[A-Z_]+$/.test(error?.code??'')?error.code:'CHIEF_CONTEXT_OPERATION_UNKNOWN';

/** Adds typed context to the existing SDK receiver. It never creates a connection. */
export async function createChiefContextApplication({database,binding,registry,client,log,currentScope,
  readRegistry=()=>registry,knowledgeRoot=ROOT+'/context/knowledge',loadServices,
  observeLocalExecution,observeLocalOperation}={}){
  if(registry?.context?.schemaVersion!==1||registry.context.enabled!==true||typeof currentScope!=='function'||typeof client?.im?.message?.reply!=='function')fail('CHIEF_CONTEXT_CONFIGURATION_INVALID');
  const catalog=createProjectCatalog({registry:registry.context.catalog,
    authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log});
  const services=loadServices??(async P=>({...await import(P+'issues.js'),...await import(P+'heartbeat.js'),...await import(P+'activity-log.js')}));
  const repository=await createChiefContextPaperclipRepository({database,binding,catalog,log,loadServices:services,
    ...(observeLocalExecution&&{observeLocalExecution}),...(observeLocalOperation&&{observeLocalOperation})});
  const knowledgeStore=createProjectKnowledgeStore({root:knowledgeRoot,log,authorizeOwner:request=>repository.authorizeKnowledgeRequest(request)});
  const acknowledge=contextOwnerSenderFromClient({client,binding});
  let controller;
  const native=await createChiefFeishuNative({database,binding,log,loadServices:services,
    context:repository.createGoalHooks({getRegistry:readRegistry,getController:()=>controller}),
    canDispatch:async({db:transaction,record}={})=>{
      currentScope();if(fs.existsSync(ROOT+'/call.lock')||fs.existsSync(ROOT+'/registry.control.lock'))return false;
      const {db,schema:s,orm:o}=await database();
      const active=await (transaction??db).select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry'])).limit(1);
      if(active.length)return false;
      if(record){
        const project=catalog.resolve({companyId:registry.companyId,ownerId:registry.ownerId,projectId:record.projectId});
        try{knowledgeStore.query({scope:{companyId:project.companyId,ownerId:project.ownerId,projectId:project.projectId,projectKey:project.key},role:'chief',limit:1});}
        catch(error){await log({code:knownCode(error),taskId:record.taskId,operationId:record.operationId});return false;}
      }
      return true;
    },
    acknowledge:async record=>{
      currentScope();const project=catalog.resolve({companyId:record.companyId,ownerId:record.ownerId,projectId:record.projectId});
      const intent=await repository.transaction(record.operationId,tx=>tx.readState('intent'),{chatId:record.sourceParams.chatId});
      const k=record.operationId,uuid=k.slice(0,8)+'-'+k.slice(8,12)+'-4'+k.slice(13,16)+'-8'+k.slice(17,20)+'-'+k.slice(20,32);
      const text=`已登记 Chief 任务 ${record.identifier}\n项目：${project.key}\nNative ID：${record.taskId}\n${intent.reviewBeforeDispatch?'将先生成计划并暂停；可在原任务补充后继续。':'按原根调用预算串行分派。'}`;
      const result=await client.im.message.reply({path:{message_id:record.sourceParams.messageId},data:{msg_type:'text',content:JSON.stringify({text}),uuid}});
      if(result.code!==0||!/^om_[A-Za-z0-9]+$/.test(result.data?.message_id??''))fail('CHIEF_CONTEXT_ACK_UNKNOWN');return {messageId:result.data.message_id};
    }});
  controller=createChiefContextController({binding,catalog,repository,knowledgeStore,acknowledge,log,
    registerNewGoal:async input=>{currentScope();return native.registerTrustedMessage(await repository.goalMessage(input));}});

  async function rejected(message,code){
    if(/SOURCE_CONFLICT$/.test(code))return {kind:'rejected',code};
    const sourceKey=chiefContextSourceKey(message),fingerprint=chiefContextFingerprint(message);
    const queued=await repository.transaction(sourceKey,async tx=>{
      const intent=await tx.readState('intent'),result=await tx.readState('result');
      if(intent&&intent.fingerprint!==fingerprint||result&&result.fingerprint!==fingerprint)return {send:false,value:{kind:'rejected',code:'CHIEF_CONTEXT_SOURCE_CONFLICT'}};
      if(await tx.readState('ack_claimed'))return {send:false,value:result??{kind:'rejected',code}};
      if(result){
        if(['new','followup'].includes(result.kind))return {send:false,value:result};
        await tx.append('ack_claimed',{operationId:result.operationId,bodySha256:hash(result.replyText??'')});return {send:true,value:result};
      }
      const unknown=Boolean(await tx.readState('effect_claimed'))||/UNKNOWN|RECONCILIATION|LOG_FAILED|TRANSACTION_FAILED/.test(code);
      const operationId=intent?.operationId??randomUUID();
      const replyText=unknown
        ? `待核对：${code}。原操作和背景已保留，请勿重复发起；可用 /chief status 查询原任务。`
        : `${code}：本次动作未执行。可用 /chief projects 查看已登记项目，或带任务号补充／查询；已有背景已保留。`;
      const receipt={schemaVersion:1,kind:'rejected',sourceKey,operationId,fingerprint,code,replyText};
      if(!unknown)await tx.append('result',receipt);
      await tx.append('ack_claimed',{operationId,bodySha256:hash(replyText),code});return {send:true,value:receipt};
    },{chatId:message.chatId});
    const value=queued.value;if(!queued.send)return value;
    try{
      const sent=await acknowledge(value);
      await repository.transaction(sourceKey,tx=>tx.append('ack_sent',{operationId:value.operationId,messageId:sent.messageId}),{chatId:message.chatId});
    }catch{await log({code:'CHIEF_CONTEXT_ACK_UNKNOWN',sourceKey});}
    return value;
  }

  async function handleTrusted(message){
      try{
        if(message.commandError){
          const legacy=await repository.transaction(chiefContextSourceKey(message),tx=>tx.readLegacyRegistration(message),{chatId:message.chatId});
          if(legacy)return Object.freeze({...legacy,legacy:true,reused:true});
          return await rejected(message,message.commandError);
        }
        const result=await controller.dispatchTrustedCommand(message);
        if(result.kind==='new'&&!result.legacy){
          // Native owns ACK claiming. Re-enter its idempotent registration to fill an unclaimed
          // post-commit ACK window; an already claimed unknown send is never retried.
          const intent=await repository.transaction(chiefContextSourceKey(message),tx=>tx.readState('intent'),{chatId:message.chatId});
          await native.registerTrustedMessage(await repository.goalMessage({snapshot:message,project:intent.project,intent}));
        }
        return result;
      }catch(error){const code=knownCode(error);await log({code,messageId:message.messageId});return rejected(message,code);}
  }
  const origin=message=>message.sourceParams?.eventType;
  const identities=['appId','tenantKey','ownerOpenId','nativeOwnerId','companyId','projectId','chiefAgentId','messageId','chatId','bodySha256'];
  const sameGoal=(left,right)=>identities.every(key=>left[key]===right[key])&&left.text===right.text&&isDeepStrictEqual(left.command,right.command);
  function sameIntent(intent,message){
    const params=intent.sourceParams;
    return intent.kind==='new'&&intent.sourceKey===chiefContextSourceKey(message)&&intent.originalText===message.text&&
      intent.bodySha256===message.bodySha256&&isDeepStrictEqual(intent.command,message.command)&&
      intent.project?.companyId===binding.companyId&&intent.project.ownerId===binding.nativeOwnerId&&params?.source==='feishu'&&
      ['appId','tenantKey','ownerOpenId','messageId','chatId','bodySha256'].every(key=>params[key]===message[key])&&
      ['im.message.receive_v1','feishu.message_api_recovery'].includes(params.eventType);
  }
  const official=message=>recoverOfficialChiefGoal({client,binding,messageId:message.messageId,expectedBodySha256:message.bodySha256,
    getBoundChatIds:()=>repository.ownerFeishuChatIds(),log});
  async function canonicalGoal(message){
    const intent=await repository.transaction(chiefContextSourceKey(message),tx=>tx.readState('intent'),{chatId:message.chatId});
    if(!intent)return message;
    if(!sameIntent(intent,message))fail('CHIEF_CONTEXT_SOURCE_CONFLICT');
    if(origin(message)===intent.sourceParams.eventType)return message;
    let canonical;
    if(intent.sourceParams.eventType==='feishu.message_api_recovery'){
      // A late SDK event must not manufacture an API-branded object from a stored JSON record.
      canonical=await official(message);
      if(!sameGoal(canonical,message)||chiefContextFingerprint(canonical)!==intent.fingerprint)fail('CHIEF_CONTEXT_SOURCE_CONFLICT');
    }else{
      canonical={...message,sourceParams:structuredClone(intent.sourceParams)};
      if(intent.sourceParams.eventId!==undefined)canonical.eventId=intent.sourceParams.eventId;else delete canonical.eventId;
      if(chiefContextFingerprint(canonical)!==intent.fingerprint)fail('CHIEF_CONTEXT_SOURCE_CONFLICT');
    }
    await log({code:'CHIEF_CONTEXT_GOAL_ORIGIN_REUSED',messageId:message.messageId,incomingOrigin:origin(message),originalOrigin:intent.sourceParams.eventType});
    return canonical;
  }
  const inFlight=new Map();
  async function receiveTrusted(message){
    currentScope();
    const newGoal=message.command?.kind==='new'&&!message.commandError;
    if(newGoal||origin(message)==='feishu.message_api_recovery')controller.validateTrustedMessage(message);
    const source=chiefContextSourceKey(message),key=source+':'+chiefContextFingerprint(message);
    const exact=inFlight.get(key);if(exact)return exact.promise;
    if(newGoal){
      const active=[...inFlight.values()].find(entry=>entry.source===source&&entry.message.command?.kind==='new'&&origin(entry.message)!==origin(message)&&sameGoal(entry.message,message));
      if(active){await log({code:'CHIEF_CONTEXT_GOAL_ORIGIN_REUSED',messageId:message.messageId,incomingOrigin:origin(message),originalOrigin:origin(active.message),stage:'in_flight'});return active.promise;}
    }
    const entry={source,message,promise:null};
    // Publish the known in-flight operation before its first await, including canonical Native reads.
    entry.promise=Promise.resolve().then(async()=>{
      const canonical=newGoal?await canonicalGoal(message):message;
      if(newGoal)controller.validateTrustedMessage(canonical);
      const canonicalKey=source+':'+chiefContextFingerprint(canonical);
      if(canonicalKey!==key){inFlight.delete(key);entry.message=canonical;inFlight.set(canonicalKey,entry);}
      return handleTrusted(canonical);
    });
    inFlight.set(key,entry);
    try{return await entry.promise;}finally{for(const [activeKey,value]of inFlight)if(value===entry)inFlight.delete(activeKey);}
  }
  return Object.freeze({
    catalog,repository,controller,knowledgeStore,
    receiveTrusted,
    async recoverOfficialGoal(request,{apply=false}={}){
      currentScope();
      if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!['messageId','expectedBodySha256'].includes(key))||typeof apply!=='boolean')fail('CHIEF_MESSAGE_RECOVERY_REQUEST_INVALID');
      const message=await recoverOfficialChiefGoal({client,binding,...request,getBoundChatIds:()=>repository.ownerFeishuChatIds(),log});
      currentScope();
      const summary={mode:apply?'apply':'preview',verified:true,origin:'feishu.message_api_recovery',messageId:message.messageId,bodySha256:message.bodySha256,
        createdAt:message.createdAt,commandKind:'new',reviewBeforeDispatch:message.command.reviewBeforeDispatch===true};
      if(!apply)return Object.freeze(summary);
      return Object.freeze({...summary,result:await receiveTrusted(message)});
    },
    async drain(){currentScope();return native.drain();},
  });
}
