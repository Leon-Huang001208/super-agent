import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {recoverOfficialChiefGoal,isOfficialRecoveredGoal} from '../bridge/chief-official-message-recovery.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const binding={appId:'cli_recovery',tenantKey:'tenant',ownerOpenId:'ou_owner',nativeOwnerId:'native_owner',
    companyId:randomUUID(),projectId:randomUUID(),chiefAgentId:randomUUID()};
  const text='/chief --project 个人 --plan-first new 仅整理本轮资料，等待本人补充';
  // Matches the actually observed SDK 1.76 message.get item shape. GET has no chat_type or event_id.
  const item={message_id:'om_original',chat_id:'oc_bound',msg_type:'text',create_time:'1795168800000',update_time:'1795168800001',
    deleted:false,updated:true,sender:{id_type:'open_id',id:'ou_owner',sender_type:'user',tenant_key:'tenant'},body:{content:JSON.stringify({text})}};
  let response={code:0,msg:'success',data:{items:[item]}},apiError=false;const calls=[],logs=[];
  const client={im:{message:{get:async request=>{calls.push(request);if(apiError)throw Error('private token must not be logged');return structuredClone(response);}}}};
  const input={messageId:item.message_id,expectedBodySha256:sha(text)};
  const run=extra=>recoverOfficialChiefGoal({binding,client,getBoundChatIds:async()=>['oc_bound'],log:event=>logs.push(event),...input,...extra});
  return {binding,item,input,text,calls,logs,run,setResponse:value=>{response=value;},setApiError:()=>{apiError=true;}};
}

test('official GET verifies an edited-but-hash-matching original goal without inventing SDK fields',async()=>{
  const f=fixture(),message=await f.run();
  assert.deepEqual(f.calls,[{path:{message_id:'om_original'},params:{user_id_type:'open_id'}}]);
  assert.equal(message.text,f.text);assert.equal(message.goal,'仅整理本轮资料，等待本人补充');assert.equal(message.command.kind,'new');
  assert.equal(message.createdAt,'2026-11-20T10:00:00.000Z');assert.equal(message.sourceParams.eventType,'feishu.message_api_recovery');
  assert.equal(message.sourceParams.origin,'official_message_get');assert.equal(message.bodySha256,f.input.expectedBodySha256);
  assert.equal(Object.hasOwn(message,'eventId'),false);assert.equal(Object.hasOwn(message.sourceParams,'eventId'),false);
  assert.equal(Object.hasOwn(message.sourceParams,'verifiedAt'),false);assert.equal(Object.hasOwn(message,'chat_type'),false);
  assert.equal(isOfficialRecoveredGoal(message),true);assert.equal(isOfficialRecoveredGoal(structuredClone(message)),false);
  assert.ok(Object.isFrozen(message));assert.ok(Object.isFrozen(message.sourceParams));
  assert.equal(JSON.stringify(f.logs).includes(f.text),false);
  const again=await f.run();assert.deepEqual(again,message,'verification time never changes the stable business snapshot');
});

test('wrong identity, chat, content, original ID or message type is rejected before any dispatch',async()=>{
  const cases=[
    item=>{item.message_id='om_other';},item=>{item.sender.id='ou_other';},item=>{item.sender.id_type='user_id';},
    item=>{item.sender.sender_type='app';},item=>{item.sender.tenant_key='other';},item=>{item.chat_id='oc_unbound';},
    item=>{item.msg_type='post';},item=>{item.deleted=true;},item=>{item.body.content=JSON.stringify({text:'/chief new Changed content'});},
    item=>{item.body.content='not JSON';},item=>{item.body.content=JSON.stringify({text:123});},
    item=>{item.create_time='bad';},item=>{item.create_time='1795168800';},
  ];
  for(const alter of cases){const f=fixture();alter(f.item);await assert.rejects(f.run(),error=>/^CHIEF_MESSAGE_RECOVERY_/.test(error.code));
    assert.equal(f.calls.length,1);assert.equal(JSON.stringify(f.logs).includes(f.text),false);}
});

test('only new goals are eligible, even when all official identity and body checks pass',async()=>{
  for(const text of ['/chief remember 格式 先结论','/chief share 格式 rwb','/chief continue','/chief add 补充条件','/chief followup 另一目标','/chief projects','普通历史消息']){
    const f=fixture();f.item.body.content=JSON.stringify({text});
    await assert.rejects(f.run({expectedBodySha256:sha(text)}),{code:'CHIEF_MESSAGE_RECOVERY_NEW_GOAL_REQUIRED'});
  }
});

test('API errors, ambiguous items and missing authenticated chat history do not produce trusted snapshots',async()=>{
  for(const response of [{code:999,msg:'private details'}, {code:0,data:{}}, {code:0,data:{items:[]}}]){
    const f=fixture();f.setResponse(response);await assert.rejects(f.run(),error=>/^CHIEF_MESSAGE_RECOVERY_/.test(error.code));
  }
  const duplicate=fixture();duplicate.setResponse({code:0,data:{items:[duplicate.item,duplicate.item]}});
  await assert.rejects(duplicate.run(),{code:'CHIEF_MESSAGE_RECOVERY_MESSAGE_INVALID'});
  const unavailable=fixture();unavailable.setApiError();await assert.rejects(unavailable.run(),{code:'CHIEF_MESSAGE_RECOVERY_API_FAILED'});
  assert.equal(JSON.stringify(unavailable.logs).includes('private token'),false);
  const unbound=fixture();await assert.rejects(unbound.run({getBoundChatIds:async()=>[]}),{code:'CHIEF_MESSAGE_RECOVERY_CHAT_UNBOUND'});
  assert.equal(unbound.calls.length,0);
});

test('requests cannot supply replacement text, sender, app, arbitrary snapshots or malformed message IDs',async()=>{
  for(const patch of [{messageId:'../other'},{expectedBodySha256:'a'},{text:'/chief new injected'},
    {sender:{id:'ou_owner'}},{appId:'cli_other'},{snapshot:{sourceParams:{eventType:'im.message.receive_v1'}}}]){
    const f=fixture();await assert.rejects(f.run(patch),{code:'CHIEF_MESSAGE_RECOVERY_REQUEST_INVALID'});assert.equal(f.calls.length,0);
  }
});
