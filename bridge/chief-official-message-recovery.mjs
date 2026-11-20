import {createHash} from 'node:crypto';
import {parseChiefContextCommand} from './chief-context-commands.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const messageIdPattern=/^om_[A-Za-z0-9]{1,245}$/;
const chatIdPattern=/^oc_[A-Za-z0-9]{1,253}$/;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const identityKeys=['appId','tenantKey','ownerOpenId','nativeOwnerId','companyId','projectId','chiefAgentId'];
const verifiedGoals=new WeakSet();
const hash=value=>createHash('sha256').update(value).digest('hex');
const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};

/** Only objects returned after the fixed SDK's official GET are admitted as this origin. */
export const isOfficialRecoveredGoal=value=>object(value)&&verifiedGoals.has(value);

/** Read a single original message. This function never registers, sends, drains or wakes. */
export async function recoverOfficialChiefGoal(options={}){
  const {binding,client,messageId,expectedBodySha256,getBoundChatIds,log}=object(options)?options:{};
  const emit=async event=>{try{await log(event);}catch{fail('CHIEF_MESSAGE_RECOVERY_LOG_FAILED');}};
  try{
    if(!object(options)||Object.keys(options).some(key=>!['binding','client','messageId','expectedBodySha256','getBoundChatIds','log'].includes(key))||
      !messageIdPattern.test(messageId??'')||!digest.test(expectedBodySha256??''))fail('CHIEF_MESSAGE_RECOVERY_REQUEST_INVALID');
    if(!object(binding)||!/^cli_[A-Za-z0-9]+$/.test(binding.appId??'')||!/^ou_[A-Za-z0-9]+$/.test(binding.ownerOpenId??'')||
      !/^[A-Za-z0-9_-]{1,256}$/.test(binding.tenantKey??'')||!/^[A-Za-z0-9_-]{1,256}$/.test(binding.nativeOwnerId??'')||
      !['companyId','projectId','chiefAgentId'].every(key=>uuid.test(binding[key]??''))||
      typeof client?.im?.message?.get!=='function'||typeof getBoundChatIds!=='function'||typeof log!=='function')fail('CHIEF_MESSAGE_RECOVERY_CONFIGURATION_INVALID');
    let chats;
    try{chats=await getBoundChatIds();}catch{fail('CHIEF_MESSAGE_RECOVERY_CHAT_LOOKUP_FAILED');}
    if(!Array.isArray(chats)||!chats.length||chats.some(chat=>!chatIdPattern.test(chat)))fail('CHIEF_MESSAGE_RECOVERY_CHAT_UNBOUND');
    let response;
    try{response=await client.im.message.get({path:{message_id:messageId},params:{user_id_type:'open_id'}});}
    catch{fail('CHIEF_MESSAGE_RECOVERY_API_FAILED');}
    if(response?.code!==0)fail('CHIEF_MESSAGE_RECOVERY_API_FAILED');
    if(!Array.isArray(response.data?.items)||response.data.items.length!==1)fail('CHIEF_MESSAGE_RECOVERY_MESSAGE_INVALID');
    const item=response.data.items[0],sender=item?.sender;
    if(!object(item)||item.message_id!==messageId||item.msg_type!=='text'||item.deleted===true||
      !chatIdPattern.test(item.chat_id??'')||!object(sender)||sender.id_type!=='open_id'||sender.sender_type!=='user'||
      sender.id!==binding.ownerOpenId||sender.tenant_key!==undefined&&sender.tenant_key!==binding.tenantKey)fail('CHIEF_MESSAGE_RECOVERY_MESSAGE_INVALID');
    // GET does not return chat_type. Prior SDK-authenticated Native registration binds the owner p2p chat.
    if(!chats.includes(item.chat_id))fail('CHIEF_MESSAGE_RECOVERY_CHAT_UNBOUND');
    if(typeof item.create_time!=='string'||!/^[0-9]{13}$/.test(item.create_time))fail('CHIEF_MESSAGE_RECOVERY_MESSAGE_INVALID');
    const created=new Date(Number(item.create_time));
    if(!Number.isFinite(created.getTime()))fail('CHIEF_MESSAGE_RECOVERY_MESSAGE_INVALID');
    let body;
    try{body=JSON.parse(item.body?.content);}catch{fail('CHIEF_MESSAGE_RECOVERY_MESSAGE_INVALID');}
    if(!object(body)||typeof body.text!=='string'||!body.text.trim()||body.text.length>16000||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.text)||hash(body.text)!==expectedBodySha256)fail('CHIEF_MESSAGE_RECOVERY_BODY_MISMATCH');
    let command;
    try{command=parseChiefContextCommand(body.text);}catch{fail('CHIEF_MESSAGE_RECOVERY_NEW_GOAL_REQUIRED');}
    if(command?.kind!=='new')fail('CHIEF_MESSAGE_RECOVERY_NEW_GOAL_REQUIRED');
    const identity=Object.fromEntries(identityKeys.map(key=>[key,binding[key]])),createdAt=created.toISOString();
    const sourceParams={source:'feishu',eventType:'feishu.message_api_recovery',origin:'official_message_get',
      appId:binding.appId,tenantKey:binding.tenantKey,ownerOpenId:binding.ownerOpenId,messageId,chatId:item.chat_id,
      bodySha256:expectedBodySha256,createdAt};
    const snapshot=freeze({schemaVersion:1,...identity,source:'feishu',externalId:messageId,messageId,chatId:item.chat_id,
      text:body.text,goal:command.goal,command,bodySha256:expectedBodySha256,createdAt,sourceParams});
    verifiedGoals.add(snapshot);
    await emit({code:'CHIEF_MESSAGE_RECOVERY_VERIFIED',messageId,bodySha256:expectedBodySha256});
    return snapshot;
  }catch(error){
    const code=/^CHIEF_MESSAGE_RECOVERY_[A-Z_]+$/.test(error?.code??'')?error.code:'CHIEF_MESSAGE_RECOVERY_VERIFICATION_FAILED';
    if(typeof log==='function'&&code!=='CHIEF_MESSAGE_RECOVERY_LOG_FAILED')await emit({code,...(messageIdPattern.test(messageId??'')&&{messageId})});
    fail(code);
  }
}
