import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseFeishuRecoveryArgs,runFeishuRecovery} from '../scripts/chief-feishu-recover.mjs';
import {createChiefContextPaperclipRepository} from '../bridge/chief-context-paperclip.mjs';

test('recovery CLI defaults to preview and accepts only the fixed message identity and body digest',()=>{
  const input=['--message-id','om_original','--expected-body-sha','a'.repeat(64)];
  assert.deepEqual(parseFeishuRecoveryArgs(input),{messageId:'om_original',expectedBodySha256:'a'.repeat(64),apply:false});
  assert.equal(parseFeishuRecoveryArgs([...input,'--apply']).apply,true);
  for(const args of [[],['--message-id','../bad','--expected-body-sha','a'.repeat(64)],input.concat('--body','forged'),input.concat('--owner','ou_other'),input.concat('--apply','--apply')])
    assert.throws(()=>parseFeishuRecoveryArgs(args),{code:'CHIEF_FEISHU_RECOVERY_ARGUMENTS_INVALID'});
});

test('the CLI delegates one verified recovery and prints no original text or arbitrary response fields',async()=>{
  const calls=[],logs=[],request={messageId:'om_original',expectedBodySha256:'b'.repeat(64),apply:true};
  const app={recoverOfficialGoal:async(req,options)=>{calls.push({req,options});return{mode:'apply',verified:true,origin:'feishu.message_api_recovery',messageId:req.messageId,bodySha256:req.expectedBodySha256,createdAt:'2026-11-20T10:33:13Z',commandKind:'new',result:{kind:'new',identifier:'LEO-36',taskId:randomUUID(),reused:false,replyText:'private message',privateField:'private'}};}};
  const result=await runFeishuRecovery({app,request,log:event=>logs.push(event)});
  assert.equal(calls.length,1);assert.deepEqual(calls[0],{req:{messageId:request.messageId,expectedBodySha256:request.expectedBodySha256},options:{apply:true}});
  assert.equal(result.result.identifier,'LEO-36');assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(logs).includes('private'),false);
  assert.equal(Object.hasOwn(app,'drain'),false);
});

test('unknown recovery results and thrown SDK/Native errors remain failures without an automatic second call',async()=>{
  let calls=0;const request={messageId:'om_original',expectedBodySha256:'b'.repeat(64),apply:true},logs=[];
  const app={recoverOfficialGoal:async()=>{calls++;throw Object.assign(Error('private SDK payload'),{code:'CHIEF_FEISHU_RECOVERY_READ_FAILED'});}};
  await assert.rejects(runFeishuRecovery({app,request,log:e=>logs.push(e)}),{code:'CHIEF_FEISHU_RECOVERY_READ_FAILED'});
  assert.equal(calls,1);assert.equal(JSON.stringify(logs).includes('private SDK payload'),false);
});

test('only the earlier authenticated SDK owner record binds an official recovery chat',async()=>{
  const companyId=randomUUID(),ownerId='native_owner',binding={companyId,nativeOwnerId:ownerId,projectId:randomUUID(),chiefAgentId:randomUUID(),appId:'cli_fixture',tenantKey:'tenant',ownerOpenId:'ou_owner'};
  const params={source:'feishu',eventType:'im.message.receive_v1',appId:binding.appId,tenantKey:binding.tenantKey,ownerOpenId:binding.ownerOpenId,messageId:'om_previous',chatId:'oc_owner',bodySha256:'c'.repeat(64)};
  const good={companyId,action:'team.feishu.registered',actorType:'user',actorId:ownerId,details:{companyId,ownerId,chiefAgentId:binding.chiefAgentId,bodySha256:params.bodySha256,sourceParams:params}};
  const rows=[good];
  for(const patch of [{actorId:'other'},{actorType:'agent'},{companyId:randomUUID()},{action:'team.context.registered'}])rows.push({...structuredClone(good),...patch});
  for(const patch of [{appId:'cli_other'},{tenantKey:'other'},{ownerOpenId:'ou_other'},{eventType:'feishu.message_api_recovery'},{bodySha256:'d'.repeat(64)}]){
    const row=structuredClone(good);Object.assign(row.details.sourceParams,patch);row.details.sourceParams.chatId='oc_untrusted';rows.push(row);
  }
  const fields=Object.fromEntries(['companyId','action','actorType','actorId'].map(key=>[key,key]));
  const db={transaction:()=>{throw Error('owner chat lookup must not write');},select:()=>({from:()=>({where:filter=>Promise.resolve(rows.filter(filter))})})};
  const services={issueService:()=>({}),logActivity:()=>{throw Error('no write');},publishActivity:()=>{throw Error('no event');}};
  const repository=await createChiefContextPaperclipRepository({database:async()=>({db,schema:{activityLog:fields,issues:{},heartbeatRuns:{}},orm:{eq:(key,value)=>row=>row[key]===value,and:(...tests)=>row=>tests.every(check=>check(row)),sql:()=>null}}),binding,catalog:{},log:()=>{},loadServices:async()=>services});
  assert.deepEqual(await repository.ownerFeishuChatIds(),['oc_owner']);
});
