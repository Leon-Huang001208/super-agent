import test from 'node:test';
import {recoverOfficialChiefGoal} from '../bridge/chief-official-message-recovery.mjs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createChiefContextController, chiefContextSourceKey } from '../bridge/chief-context-native.mjs';
import { createProjectCatalog } from '../bridge/context-projects.mjs';
import { parseChiefContextCommand, contextMemoryId } from '../bridge/chief-context-commands.mjs';
import { taskInputRevision } from '../bridge/task-input.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {consumeQueuedNativeRoleRetry} from '../bridge/role-native-retry-consumer.mjs';
import {settleNativeRetryWithoutProvider,canReleaseSettledNativeRetryPhase} from '../bridge/role-native-retry.mjs';
import {nativeRetryControlMode} from '../bridge/team-native-runtime.mjs';
import {observeContextCallEvidence} from '../bridge/chief-context-paperclip.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const copy = value => structuredClone(value);

function fixture({dedicatedRwbWorkspace=false}={}) {
  const binding = { appId:'cli_fixture',tenantKey:'tenant_fixture',ownerOpenId:'ou_owner',nativeOwnerId:'owner',
    companyId:randomUUID(),projectId:randomUUID(),chiefAgentId:randomUUID() };
  const otherId = randomUUID(),rwbWorkspaceId=randomUUID(),ids={chief:binding.chiefAgentId,research:randomUUID(),pm:randomUUID(),qa:randomUUID()};
  const project = (key,id) => ({key,aliases:key==='personal'?['个人']:['rwb'],companyId:binding.companyId,
    projectId:id,ownerId:binding.nativeOwnerId,adapterKey:key==='personal'?'native-docs':'rwb-docs',
    allowedRoles:Object.keys(ids),maximumAction:'read_only',workspaceCwd:`/paperclip/instances/default/projects/${binding.companyId}/${id}/_default`,
    ...(key==='research-workbench'&&dedicatedRwbWorkspace&&{projectWorkspaceId:rwbWorkspaceId})});
  const catalogData={schemaVersion:1,defaultProjectKey:'personal',projects:[project('personal',binding.projectId),project('research-workbench',otherId)]};
  const logs=[],catalog=createProjectCatalog({registry:catalogData,authority:{companyId:binding.companyId,ownerId:binding.nativeOwnerId,agentIds:ids},log:e=>logs.push(e)});
  const state={events:new Map(),tasks:new Map(),controls:new Map(),runs:new Map(),executions:new Map(),chats:new Map(),legacy:new Map(),comments:[],supersessions:[]};
  let depth=0,tail=Promise.resolve(),transactions=0,afterTransaction=null,operationLookups=0;
  const chatKey='oc_ownerchat';
  const txFor=(key,options)=>({
    readState:async kind=>copy(state.events.get(key+':'+kind)??null),
    append:async(kind,record)=>{state.events.set(key+':'+kind,copy(record));},
    readLegacyRegistration:async()=>copy(state.legacy.get(key)??null),
    readChat:async()=>copy(state.chats.get(options.chatId)??null),
    writeChat:async record=>{state.chats.set(options.chatId,copy(record));},
    readTask:async ref=>copy(state.tasks.get(ref)??[...state.tasks.values()].find(task=>task.identifier===ref)??null),
    readControl:async id=>copy(state.controls.get(id)??null),
    writeControl:async(id,record)=>{state.controls.set(id,copy(record));},
    readExecution:async id=>copy(state.executions.get(id)??{active:false,unknown:false,started:false,budgetUsed:0}),
    updateTask:async(id,patch)=>{const task=state.tasks.get(id);Object.assign(task,copy(patch));return copy(task);},
    addOwnerComment:async(id,comment)=>{state.comments.push({taskId:id,...copy(comment)});},
    readRun:async id=>copy(state.runs.get(id)??null),
    readOperationRun:async({taskId,operationId})=>{
      operationLookups++;
      const run=[...state.runs.values()].find(value=>value.issueId===taskId&&(value.operationId??value.contextSnapshot?.roleOperationId)===operationId);
      if(run)return copy(run);
      if(state.controls.get(taskId)?.resumeClaim?.operationId===operationId)throw Object.assign(Error('unreconciled claim'),{code:'CHIEF_CONTEXT_RECONCILIATION_REQUIRED'});
      return null;
    },
    supersedeChildren:async record=>{
      const root=state.tasks.get(record.rootTaskId);
      for(const ref of record.children??[]){
        const id=ref.taskId??ref.id,child=state.tasks.get(id);
        if(!child||child.parentId!==root.id||child.projectId!==root.projectId||child.companyId!==root.companyId||
          child.responsibleUserId!==root.responsibleUserId||ref.inputRevision&&taskInputRevision(child)!==ref.inputRevision)throw Object.assign(Error('child changed'),{code:'CHIEF_CONTEXT_CHILD_SCOPE_CHANGED'});
      }
      state.supersessions.push(copy(record));return copy(record.children??[]);
    },
  });
  const repository={async transaction(key,fn,options={}){
    if(options.db){assert.equal(options.db.__fixtureTx,true);return fn(options.db);}
    const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;
    transactions++;depth++;const before=copy(state),tx=txFor(key,options);tx.__fixtureTx=true;
    let result;
    try{result=await fn(tx);}catch(error){for(const field of Object.keys(state))state[field]=before[field];throw error;}
    finally{depth--;release();}
    if(afterTransaction)await afterTransaction({key,result,options});return result;
  }};
  const memory=new Map(),writes=[],registrations=[],acks=[];
  const memKey=(scope,id,visibility,role)=>JSON.stringify([scope.companyId,scope.ownerId,scope.projectId,visibility,role??null,id]);
  const knowledgeStore={
    history:({scope,id,visibility,role})=>copy(memory.get(memKey(scope,id,visibility,role))??[]),
    query:({scope,role})=>[...memory.values()].flatMap(items=>items.at(-1)??[]).filter(r=>r.projectId===scope.projectId&&(r.visibility==='project'||r.role===role)).map(copy),
    async remember(input){return put('remember',input);},async correct(input){return put('correct',input);},
  };
  function put(action,input){
    assert.equal(depth,0,'external memory writes must not run under Native locks');
    const intent=[...state.events.entries()].find(([key,value])=>key.endsWith(':intent')&&value.operationId===input.operationId)?.[1];
    assert.deepEqual(intent.writeRequest,input,'full write request must already be persisted');
    const key=memKey(input.scope,input.id,input.visibility,input.role),history=memory.get(key)??[];
    if(action==='correct'&&history.at(-1)?.version!==input.expectedVersion)throw Object.assign(Error('stale'),{code:'PROJECT_KNOWLEDGE_VERSION_CONFLICT'});
    if(action==='remember'&&history.length)throw Object.assign(Error('exists'),{code:'PROJECT_KNOWLEDGE_ALREADY_EXISTS'});
    const record={id:input.id,version:history.length+1,project:input.scope.projectKey,projectId:input.scope.projectId,
      companyId:input.scope.companyId,ownerId:input.scope.ownerId,
      visibility:input.visibility,...(input.role&&{role:input.role}),kind:input.kind??history.at(-1)?.kind??'decision',
      text:input.text,condition:input.condition,source:'feishu:'+input.source.messageId,sha256:sha(input.text+input.operationId),confirmation:{status:'owner-confirmed',source:copy(input.source),operationId:input.operationId}};
    memory.set(key,[...history,record]);writes.push(copy(input));return {record:copy(record),reused:false};
  }
  let registerDelay=null,ackError=false,registerAfterCommitError=false;
  const registerNewGoal=async request=>{
    assert.equal(depth,0,'registration must happen outside Native transaction');
    registrations.push(copy(request));if(registerDelay)await registerDelay(request);
    const receipt=await repository.transaction(request.intent.sourceKey,async tx=>{
      const prior=await tx.readState('registered');if(prior)return prior;
      const task=makeTask({projectId:request.project.projectId,title:request.intent.goal.split('\n')[0],description:request.intent.goal});
      const control=controlFor(task,{reviewBeforeDispatch:request.intent.reviewBeforeDispatch,continuationOf:request.intent.continuationOf??null});
      state.controls.set(task.id,control);
      const current=await tx.readChat()??emptyChat();
      current.projectTasks??={};current.projectGoalOperations??={};
      if(current.projectGoalOperations[task.projectId]===request.intent.operationId)current.projectTasks[task.projectId]=task.id;
      if(current.pendingGoalOperationId===request.intent.operationId){current.projectId=task.projectId;current.taskId=task.id;current.pendingGoalOperationId=null;}
      await tx.writeChat(current);
      const receipt={taskId:task.id,identifier:task.identifier,companyId:task.companyId,projectId:task.projectId,
        ownerId:binding.nativeOwnerId,inputRevision:taskInputRevision(task)};
      await tx.append('registered',receipt);return receipt;
    },{chatId:request.snapshot.chatId});
    if(registerAfterCommitError)throw Error('registration response fixture');
    return receipt;
  };
  const controller=createChiefContextController({binding,catalog,repository,knowledgeStore,registerNewGoal,
    acknowledge:async receipt=>{assert.equal(depth,0,'SDK sends must happen outside Native transaction');acks.push(copy(receipt));if(ackError)throw Error('unknown SDK result');return {messageId:'om_reply'+acks.length};},
    log:e=>logs.push(e),now:()=> '2026-11-20T02:00:00.000Z'});
  const registry={companyId:binding.companyId,ownerId:binding.nativeOwnerId,team:{ids},context:{schemaVersion:1,enabled:true,catalog:catalogData}};
  function emptyChat(){return {schemaVersion:1,companyId:binding.companyId,ownerId:binding.nativeOwnerId,chatId:chatKey,
    projectId:binding.projectId,taskId:null,projectTasks:{},projectGoalOperations:{},pendingGoalOperationId:null,sequence:0,revision:0};}
  function makeTask(overrides={}){const id=randomUUID(),task={id,identifier:'LEO-'+(100+state.tasks.size),companyId:binding.companyId,
    projectId:binding.projectId,responsibleUserId:binding.nativeOwnerId,createdByUserId:binding.nativeOwnerId,parentId:null,
    title:'Original goal',description:'Original goal',status:'in_review',assigneeUserId:binding.nativeOwnerId,assigneeAgentId:null,
    ...(dedicatedRwbWorkspace&&overrides.projectId===otherId&&{projectWorkspaceId:rwbWorkspaceId}),...overrides};state.tasks.set(id,task);return task;}
  function controlFor(task,extra={}){return {schemaVersion:1,managed:true,companyId:task.companyId,projectId:task.projectId,
    ownerId:binding.nativeOwnerId,taskId:task.id,inputRevision:taskInputRevision(task),revision:0,inputSequence:0,pendingInputs:[],
    reviewBeforeDispatch:false,approvedPlanSha256:null,approvalOperationId:null,plan:null,pauseRequested:false,
    resumeOperationId:null,resumeClaim:null,continuationOf:null,checkpoints:[],
    ...(task.projectWorkspaceId!==undefined&&{projectWorkspaceId:task.projectWorkspaceId}),...extra};}
  function select(task,extra={}){state.controls.set(task.id,controlFor(task,extra));const c=state.chats.get(chatKey)??emptyChat();
    c.projectId=task.projectId;c.taskId=task.id;c.projectTasks[task.projectId]=task.id;state.chats.set(chatKey,c);return state.controls.get(task.id);}
  function message(text,extra={}){const id='om_'+randomUUID().replaceAll('-',''),bodySha256=sha(text);return {schemaVersion:1,...binding,source:'feishu',text,
    messageId:id,externalId:id,chatId:chatKey,bodySha256,createdAt:'2026-11-20T01:00:00.000Z',command:parseChiefContextCommand(text),
    sourceParams:{source:'feishu',eventType:'im.message.receive_v1',appId:binding.appId,tenantKey:binding.tenantKey,
      ownerOpenId:binding.ownerOpenId,messageId:id,chatId:chatKey,bodySha256},...extra};}
  return {binding,catalog,registry,state,controller,repository,knowledgeStore,logs,registrations,acks,writes,
    message,makeTask,controlFor,select,depth:()=>depth,transactions:()=>transactions,
    delayRegister:fn=>{registerDelay=fn;},setAckError:value=>{ackError=value;},setRegisterAfterCommitError:value=>{registerAfterCommitError=value;},
    afterTransaction:fn=>{afterTransaction=fn;},operationLookups:()=>operationLookups};
}

test('all commands recheck source binding before accessing Native or creating effects', async()=>{
  const f=fixture();const m=f.message('/chief projects');m.ownerOpenId='ou_other';
  await assert.rejects(f.controller.dispatchTrustedCommand(m),{code:'CHIEF_CONTEXT_BINDING_DENIED'});
  assert.equal(f.transactions(),0);assert.equal(f.registrations.length,0);assert.equal(f.acks.length,0);
});

test('only a closed official GET verifier admits the new-goal recovery origin, never raw JSON or other commands',async()=>{
  const f=fixture(),sdk=f.message('/chief --plan-first new 原消息目标'),item={message_id:sdk.messageId,chat_id:sdk.chatId,msg_type:'text',create_time:String(Date.parse(sdk.createdAt)),
    deleted:false,updated:true,sender:{id_type:'open_id',id:f.binding.ownerOpenId,sender_type:'user',tenant_key:f.binding.tenantKey},body:{content:JSON.stringify({text:sdk.text})}};
  const message=await recoverOfficialChiefGoal({binding:f.binding,client:{im:{message:{get:async()=>({code:0,data:{items:[item]}})}}},
    getBoundChatIds:async()=>[sdk.chatId],messageId:sdk.messageId,expectedBodySha256:sdk.bodySha256,log:event=>f.logs.push(event)});
  const before=f.transactions();
  await assert.rejects(f.controller.dispatchTrustedCommand(structuredClone(message)),{code:'CHIEF_CONTEXT_BINDING_DENIED'});
  assert.equal(f.transactions(),before);assert.equal(f.registrations.length,0);
  const first=await f.controller.dispatchTrustedCommand(message),again=await f.controller.dispatchTrustedCommand(message);
  assert.equal(first.taskId,again.taskId);assert.equal(f.registrations.length,1);assert.equal(f.state.tasks.size,1);
  const intent=[...f.state.events.values()].find(value=>value.kind==='new'&&value.originalText===sdk.text);
  assert.equal(intent.sourceParams.eventType,'feishu.message_api_recovery');assert.equal(Object.hasOwn(intent.sourceParams,'eventId'),false);
  assert.equal(intent.source.createdAt,message.createdAt);
});

test('project selection restores each Native project task and status has no task/model effects',async()=>{
  const f=fixture(),a=f.makeTask(),b=f.makeTask({projectId:f.catalog.resolve({projectKeyOrAlias:'rwb',companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId}).projectId});
  f.select(a);f.state.controls.set(b.id,f.controlFor(b));f.state.chats.get('oc_ownerchat').projectTasks[b.projectId]=b.id;
  await f.controller.dispatchTrustedCommand(f.message('/chief project rwb'));
  assert.equal(f.state.chats.get('oc_ownerchat').taskId,b.id);
  const status=await f.controller.dispatchTrustedCommand(f.message('/chief status'));
  assert.equal(status.taskId,b.id);assert.equal(status.status,'in_review');
  await f.controller.dispatchTrustedCommand(f.message('/chief project 个人'));
  assert.equal(f.state.chats.get('oc_ownerchat').taskId,a.id);
  assert.equal(f.registrations.length,0);assert.equal(f.writes.length,0);
});

test('new goal intents precede external registration and a replay does not create another root or ACK',async()=>{
  const f=fixture(),m=f.message('/chief --plan-first new A new owner goal');
  const first=await f.controller.dispatchTrustedCommand(m),again=await f.controller.dispatchTrustedCommand(m);
  assert.equal(first.taskId,again.taskId);assert.equal(f.registrations.length,1);assert.equal(f.state.tasks.size,1);assert.equal(f.acks.length,0);
  assert.equal(f.state.controls.get(first.taskId).reviewBeforeDispatch,true);
  assert.equal(f.state.chats.get('oc_ownerchat').taskId,first.taskId);
});

test('same source conflict and old M1 registrations cannot be reinterpreted as memory or status',async()=>{
  const f=fixture(),m=f.message('/chief remember 报告格式 先结论');
  f.state.legacy.set(chiefContextSourceKey(m),{taskId:randomUUID(),identifier:'LEO-28',companyId:f.binding.companyId,
    projectId:f.binding.projectId,ownerId:f.binding.nativeOwnerId,bodySha256:m.bodySha256});
  const receipt=await f.controller.dispatchTrustedCommand(m);
  assert.equal(receipt.taskId,f.state.legacy.get(chiefContextSourceKey(m)).taskId);assert.equal(f.writes.length,0);assert.equal(f.acks.length,0);
  const current=f.message('/chief status');await f.controller.dispatchTrustedCommand(current);
  await assert.rejects(f.controller.dispatchTrustedCommand({...current,bodySha256:'a'.repeat(64)}),/CHIEF_CONTEXT_(SOURCE_CONFLICT|MESSAGE_INVALID)/);
});

test('a slow new registration does not overwrite a later project choice',async()=>{
  const f=fixture();let release;f.delayRegister(()=>new Promise(resolve=>{release=resolve;}));
  const pending=f.controller.dispatchTrustedCommand(f.message('/chief new First goal'));
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await f.controller.dispatchTrustedCommand(f.message('/chief project rwb'));
  release();const result=await pending,current=f.state.chats.get('oc_ownerchat');
  assert.notEqual(current.projectId,f.binding.projectId);assert.equal(current.taskId,null);
  assert.equal(current.projectTasks[f.binding.projectId],result.taskId);
});

test('active-root additions remain pending, then two source inputs flush monotonically on the same root',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task);f.state.executions.set(task.id,{active:true,unknown:false,budgetUsed:2});
  const old=taskInputRevision(task),one=f.message('/chief add Add the first requirement');
  await f.controller.dispatchTrustedCommand(one);await f.controller.dispatchTrustedCommand(one);
  assert.equal(taskInputRevision(f.state.tasks.get(task.id)),old);assert.equal(f.state.controls.get(task.id).pendingInputs.length,1);
  f.state.executions.set(task.id,{active:false,unknown:false,budgetUsed:2});
  const first=await f.controller.syncTask({registry:f.registry,task:f.state.tasks.get(task.id),flow:{rootTaskId:task.id,inputRevision:old,children:[]}});
  assert.notEqual(first.control.inputRevision,old);assert.equal(first.task.id,task.id);assert.equal(first.task.status,'in_review');
  await f.controller.dispatchTrustedCommand(f.message('/chief add Add the second requirement'));
  const second=await f.controller.syncTask({registry:f.registry,task:first.task,flow:{rootTaskId:task.id,inputRevision:first.control.inputRevision,children:[]}});
  assert.notEqual(second.control.inputRevision,first.control.inputRevision);assert.ok(second.control.revision>first.control.revision);
  assert.match(second.task.description,/first requirement/);assert.match(second.task.description,/second requirement/);
  assert.equal(f.state.tasks.size,1);assert.equal(f.state.comments.length,2);assert.equal(f.registrations.length,0);
});

test('same-tx synchronization reads control only, even when pending input and no model is active',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task);await f.controller.dispatchTrustedCommand(f.message('/chief add Keep pending'));
  const before=f.transactions();
  await f.repository.transaction('outside',async tx=>{
    const result=await f.controller.syncTask({registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task),children:[]},transaction:{db:tx}});
    assert.equal(result.task.description,'Original goal');assert.equal(result.control.pendingInputs.length,1);
  },{taskId:task.id});
  assert.equal(f.transactions(),before+1);assert.equal(f.state.supersessions.length,0);
});

test('new root inputs stop when a referenced old child changes project or revision',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task);const child=f.makeTask({parentId:task.id});
  const childHash=taskInputRevision(child);await f.controller.dispatchTrustedCommand(f.message('/chief add New requirement'));
  f.state.tasks.get(child.id).projectId=randomUUID();
  await assert.rejects(f.controller.syncTask({registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task),children:[{taskId:child.id,inputRevision:childHash}]}}),{code:'CHIEF_CONTEXT_CHILD_SCOPE_CHANGED'});
  assert.equal(f.state.tasks.get(task.id).description,'Original goal');assert.equal(f.state.controls.get(task.id).pendingInputs.length,1);
});

test('continue internally binds the current plan without requiring a copied hash or another model',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task,{reviewBeforeDispatch:true});
  const planText='{"tasks":[]}',runId=randomUUID(),artifact={file:'plan.json',sha256:sha(planText),bytes:Buffer.byteLength(planText),text:planText};
  f.state.runs.set(runId,{id:runId,companyId:f.binding.companyId,issueId:task.id,agentId:f.binding.chiefAgentId,status:'succeeded'});
  await f.controller.checkpoint({registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task)},kind:'plan_ready',runId,artifact});
  let control=f.state.controls.get(task.id);assert.equal(control.approvedPlanSha256,null);assert.equal(control.pauseRequested,true);
  const m=f.message('/chief continue '+task.identifier),result=await f.controller.dispatchTrustedCommand(m);
  control=f.state.controls.get(task.id);assert.equal(control.approvedPlanSha256,artifact.sha256);assert.equal(control.resumeOperationId,null);assert.ok(control.approvalOperationId);
  assert.equal(control.approvalOperationId,f.state.events.get(chiefContextSourceKey(m)+':intent').operationId);
  assert.equal(control.reviewBeforeDispatch,false);
  assert.doesNotMatch(result.replyText,/审阅|已批准|--plan/);
  const same=await f.controller.checkpoint({registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task)},kind:'plan_ready',runId,artifact});
  assert.equal(same.approvedPlanSha256,artifact.sha256);assert.equal(same.pauseRequested,false);assert.equal(f.registrations.length,0);
  assert.equal(f.acks.filter(record=>record.kind==='plan_ready').length,1);
  assert.ok(f.acks.find(record=>record.kind==='plan_ready').replyText.includes('/chief continue '+task.identifier));
  assert.doesNotMatch(f.acks.find(record=>record.kind==='plan_ready').replyText,/--plan/);
});

test('pending input requires a new plan and UNKNOWN cannot create another resume intention',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task,{reviewBeforeDispatch:true});
  await f.controller.dispatchTrustedCommand(f.message('/chief add Changed scope'));
  const current=await f.controller.syncTask({registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task),children:[]}});
  await f.controller.dispatchTrustedCommand(f.message('/chief continue'));
  const operation=f.state.controls.get(task.id).resumeOperationId;assert.match(operation,/^[a-f0-9-]{36}$/);assert.equal(f.state.controls.get(task.id).approvedPlanSha256,null);
  assert.equal(f.state.controls.get(task.id).reviewBeforeDispatch,false);
  f.state.executions.set(task.id,{active:false,unknown:true,budgetUsed:3});
  await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief continue')),{code:'CHIEF_CONTEXT_RECONCILIATION_REQUIRED'});
  assert.equal(f.state.controls.get(task.id).resumeOperationId,operation);assert.equal(current.task.id,task.id);
});

test('continue with pending input consumes the one-shot pause and the new plan runs automatically',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task,{reviewBeforeDispatch:true});
  await f.controller.dispatchTrustedCommand(f.message('/chief add Apply a genuinely new requirement'));
  await f.controller.dispatchTrustedCommand(f.message('/chief continue'));
  const operationId=f.state.controls.get(task.id).resumeOperationId;
  assert.equal(f.state.controls.get(task.id).reviewBeforeDispatch,false);
  const view=await f.controller.syncTask({registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task),children:[]}});
  assert.equal(view.control.pauseRequested,false);assert.equal(view.control.resumeOperationId,operationId);
  const runId=randomUUID(),text='{"tasks":[]}',artifact={file:'new-plan.json',text,bytes:Buffer.byteLength(text),sha256:sha(text)};
  f.state.runs.set(runId,{id:runId,companyId:f.binding.companyId,issueId:task.id,agentId:f.binding.chiefAgentId,status:'succeeded'});
  const next=await f.controller.checkpoint({registry:f.registry,task:view.task,flow:{rootTaskId:task.id,inputRevision:view.control.inputRevision,sourceOperationId:operationId},kind:'plan_ready',runId,artifact});
  assert.equal(next.reviewBeforeDispatch,false);assert.equal(next.pauseRequested,false);assert.equal(next.approvedPlanSha256,null);
  assert.equal(f.acks.filter(record=>record.kind==='plan_ready').length,0);
});

test('resume claims are idempotent and checkpoints cannot grant owner approval',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task);await f.controller.dispatchTrustedCommand(f.message('/chief continue'));
  const operationId=f.state.controls.get(task.id).resumeOperationId,artifact={operationId,inputRevision:taskInputRevision(task)};
  const args={registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task)},kind:'resume_claim',artifact};
  assert.equal((await f.controller.checkpoint(args)).claimGranted,true);
  assert.equal((await f.controller.checkpoint(args)).claimGranted,false);
  assert.equal(f.state.controls.get(task.id).approvedPlanSha256,null);
  assert.equal(f.registrations.length,0);
});

test('a done predecessor permits a linked real new goal but failed or unknown work cannot escape its root',async()=>{
  const f=fixture(),done=f.makeTask({status:'done'});f.select(done);f.state.executions.set(done.id,{active:false,unknown:false,budgetUsed:6});
  const result=await f.controller.dispatchTrustedCommand(f.message('/chief followup Add a real next iteration'));
  assert.notEqual(result.taskId,done.id);assert.equal(f.state.tasks.get(done.id).status,'done');
  assert.equal(f.state.controls.get(result.taskId).continuationOf,done.id);assert.equal(f.registrations[0].intent.predecessor.description,done.description);
  const failed=f.makeTask({status:'in_review'});f.select(failed);f.state.executions.set(failed.id,{active:false,unknown:true,budgetUsed:6});
  await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief followup Retry under a new number')),{code:'CHIEF_CONTEXT_FOLLOWUP_DENIED'});
  assert.equal(f.registrations.length,1);
});

test('remember and version-captured correction persist full owner intent before external store writes',async()=>{
  const f=fixture(),m=f.message('/chief remember 报告格式 先结论再证据');
  const first=await f.controller.dispatchTrustedCommand(m);assert.equal(first.version,1);assert.equal(f.writes.length,1);
  await f.controller.dispatchTrustedCommand(m);assert.equal(f.writes.length,1);
  const corrected=await f.controller.dispatchTrustedCommand(f.message('/chief correct 报告格式 先列未验证项'));
  assert.equal(corrected.version,2);assert.equal(f.writes[1].expectedVersion,1);assert.equal(f.writes[1].id,contextMemoryId('报告格式'));
  assert.match(f.writes[0].condition,/报告格式/);
  await f.controller.dispatchTrustedCommand(f.message('/chief memory 报告格式'));
  assert.equal(f.registrations.length,0);assert.equal(f.state.tasks.size,0);
});

test('explicit sharing copies only shared owner-confirmed memory and binds its source version and hash',async()=>{
  const f=fixture();await f.controller.dispatchTrustedCommand(f.message('/chief remember 规则 项目A的已确认规则'));
  const source=f.writes[0];const result=await f.controller.dispatchTrustedCommand(f.message('/chief share 规则 rwb'));
  assert.equal(f.writes.length,2);assert.notEqual(f.writes[1].scope.projectId,source.scope.projectId);
  assert.equal(result.sourceVersion,1);assert.match(result.sourceSha256,/^[a-f0-9]{64}$/);
  assert.match(f.writes[1].condition,/explicit share/i);
  assert.equal(f.state.chats.get('oc_ownerchat')?.projectId??f.binding.projectId,f.binding.projectId);
});

test('an unknown acknowledgement is never resent on source replay',async()=>{
  const f=fixture();f.setAckError(true);const m=f.message('/chief projects');
  await f.controller.dispatchTrustedCommand(m);await f.controller.dispatchTrustedCommand(m);
  assert.equal(f.acks.length,1);assert.equal(f.registrations.length,0);
});

test('project task-map corruption cannot silently route a project-B command to project A',async()=>{
  const f=fixture(),a=f.makeTask();f.select(a);const b=f.catalog.resolve({projectKeyOrAlias:'rwb',companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId});
  const chat=f.state.chats.get('oc_ownerchat');chat.projectId=b.projectId;chat.taskId=a.id;chat.projectTasks[b.projectId]=a.id;
  await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief status')),{code:'CHIEF_CONTEXT_PROJECT_CONFLICT'});
  await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief project rwb')),{code:'CHIEF_CONTEXT_PROJECT_CONFLICT'});
  assert.equal(f.state.tasks.size,1);assert.equal(f.registrations.length,0);
});

test('old unmanaged unfinished tasks are not adopted by append, pause or continue',async()=>{
  const f=fixture(),task=f.makeTask();const chat={schemaVersion:1,companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,
    chatId:'oc_ownerchat',projectId:task.projectId,taskId:task.id,projectTasks:{[task.projectId]:task.id},projectGoalOperations:{},revision:0,sequence:0};f.state.chats.set('oc_ownerchat',chat);
  assert.equal((await f.controller.dispatchTrustedCommand(f.message('/chief status'))).status,'in_review');
  for(const command of ['/chief add Old task change','/chief pause','/chief continue'])await assert.rejects(f.controller.dispatchTrustedCommand(f.message(command)),{code:'CHIEF_CONTEXT_TASK_UNMANAGED'});
  assert.equal(f.state.controls.has(task.id),false);assert.equal(f.state.tasks.get(task.id).description,'Original goal');
});

test('a committed-but-lost registration response is reconciled without calling registration again',async()=>{
  const f=fixture(),m=f.message('/chief new One real goal');f.setRegisterAfterCommitError(true);
  await assert.rejects(f.controller.dispatchTrustedCommand(m),{code:'CHIEF_CONTEXT_REGISTRATION_RECONCILIATION_REQUIRED'});
  const result=await f.controller.dispatchTrustedCommand(m);
  assert.ok(result.taskId);assert.equal(f.registrations.length,1);assert.equal(f.state.tasks.size,1);assert.equal(f.acks.length,0);
});

test('an uncommitted unknown registration claim is not retried under another ID',async()=>{
  const f=fixture(),m=f.message('/chief new Unknown original request');f.delayRegister(async()=>{throw Error('unknown before response');});
  for(let i=0;i<2;i++)await assert.rejects(f.controller.dispatchTrustedCommand(m),{code:'CHIEF_CONTEXT_REGISTRATION_RECONCILIATION_REQUIRED'});
  assert.equal(f.registrations.length,1);assert.equal(f.state.tasks.size,0);
});

test('a lost memory-write response reconciles the exact recorded operation without another version',async()=>{
  const f=fixture(),m=f.message('/chief remember 报告规范 必须列出未验证项'),original=f.knowledgeStore.remember;
  f.knowledgeStore.remember=async input=>{await original(input);throw Error('response lost after commit');};
  await assert.rejects(f.controller.dispatchTrustedCommand(m),{code:'CHIEF_CONTEXT_MEMORY_RECONCILIATION_REQUIRED'});
  const result=await f.controller.dispatchTrustedCommand(m);assert.equal(result.version,1);assert.equal(f.writes.length,1);
  assert.equal(f.acks.length,1);
});

test('a changed memory port result is not acknowledged as the authorized write',async()=>{
  const f=fixture(),m=f.message('/chief remember 规范 真实确认值'),original=f.knowledgeStore.remember;
  f.knowledgeStore.remember=async input=>{const result=await original(input);return {...result,record:{...result.record,id:'another-key'}};};
  await assert.rejects(f.controller.dispatchTrustedCommand(m),{code:'CHIEF_CONTEXT_MEMORY_RESULT_CHANGED'});
  assert.equal(f.acks.length,0);assert.equal(f.writes.length,1);
});

test('a foreign project record returned by a misbound query port is never sent to Feishu',async()=>{
  const f=fixture();await f.controller.dispatchTrustedCommand(f.message('/chief remember 规范 当前项目值'));
  const before=f.acks.length,record=f.knowledgeStore.history({scope:{companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,projectId:f.binding.projectId,projectKey:'personal'},id:contextMemoryId('规范'),visibility:'project'})[0];
  f.knowledgeStore.query=()=>[{...record,projectId:randomUUID(),project:'foreign'}];
  await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief memory')),{code:'CHIEF_CONTEXT_MEMORY_NOT_FOUND'});
  assert.equal(f.acks.length,before);
});

test('an unknown plan notification is not resent by repeated checkpoint calls',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task,{reviewBeforeDispatch:true});f.setAckError(true);
  const runId=randomUUID(),text='{"tasks":[]}',args={registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task)},
    kind:'plan_ready',runId,artifact:{file:'plan.json',text,bytes:Buffer.byteLength(text),sha256:sha(text)}};
  f.state.runs.set(runId,{id:runId,companyId:f.binding.companyId,issueId:task.id,agentId:f.binding.chiefAgentId,status:'succeeded'});
  await f.controller.checkpoint(args);await f.controller.checkpoint(args);
  assert.equal(f.acks.length,1);assert.equal(f.state.controls.get(task.id).approvedPlanSha256,null);
});

test('two slow registrations for the same project preserve the latest owner-selected goal',async()=>{
  const f=fixture();let release;f.delayRegister(request=>request.intent.goal==='Older goal'?new Promise(resolve=>{release=resolve;}):undefined);
  const older=f.controller.dispatchTrustedCommand(f.message('/chief new Older goal'));while(!release)await new Promise(resolve=>setImmediate(resolve));
  const newer=await f.controller.dispatchTrustedCommand(f.message('/chief new Newer goal'));release();const oldResult=await older;
  const chat=f.state.chats.get('oc_ownerchat');assert.equal(chat.taskId,newer.taskId);assert.equal(chat.projectTasks[f.binding.projectId],newer.taskId);
  assert.notEqual(newer.taskId,oldResult.taskId);assert.equal(f.state.tasks.size,2);
});

test('collecting a normal plan preserves an owner pause and later continue reuses that plan',async()=>{
  const f=fixture(),task=f.makeTask();f.select(task);await f.controller.dispatchTrustedCommand(f.message('/chief pause'));
  const runId=randomUUID(),text='{"tasks":[]}',artifact={file:'plan.json',text,bytes:Buffer.byteLength(text),sha256:sha(text)};
  f.state.runs.set(runId,{id:runId,companyId:f.binding.companyId,issueId:task.id,agentId:f.binding.chiefAgentId,status:'succeeded'});
  const control=await f.controller.checkpoint({registry:f.registry,task,flow:{rootTaskId:task.id,inputRevision:taskInputRevision(task)},kind:'plan_ready',runId,artifact});
  assert.equal(control.pauseRequested,true);assert.equal(control.approvedPlanSha256,null);
  await f.controller.dispatchTrustedCommand(f.message('/chief continue'));
  assert.equal(f.state.controls.get(task.id).pauseRequested,false);assert.equal(f.state.controls.get(task.id).resumeOperationId,null);
  assert.equal(f.state.controls.get(task.id).plan.runId,runId);
});

test('old RWB primary workspace roots and children permit metadata status only, while followup uses the M2 workspace',async()=>{
  const f=fixture({dedicatedRwbWorkspace:true}),p=f.catalog.resolve({projectKeyOrAlias:'rwb',companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId});
  const current=f.makeTask();f.select(current);const before=copy(f.state.chats.get('oc_ownerchat'));
  const old=f.makeTask({projectId:p.projectId,projectWorkspaceId:randomUUID(),status:'done'}),child=f.makeTask({projectId:p.projectId,projectWorkspaceId:old.projectWorkspaceId,parentId:old.id});
  const rootStatus=await f.controller.dispatchTrustedCommand(f.message('/chief status '+old.identifier));
  assert.equal(rootStatus.taskId,old.id);assert.equal(rootStatus.status,'done');
  const childStatus=await f.controller.dispatchTrustedCommand(f.message('/chief status '+child.identifier));
  assert.equal(childStatus.taskId,child.id);assert.deepEqual(f.state.chats.get('oc_ownerchat'),before);
  for(const action of ['continue','pause'])await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief '+action+' '+old.identifier)),{code:'CONTEXT_PROJECT_NATIVE_WORKSPACE_DENIED'});
  await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief add '+old.identifier+' Old workspace write')),{code:'CONTEXT_PROJECT_NATIVE_WORKSPACE_DENIED'});
  const result=await f.controller.dispatchTrustedCommand(f.message('/chief followup '+old.identifier+' A genuinely new docs goal'));
  assert.equal(f.state.tasks.get(result.taskId).projectWorkspaceId,p.projectWorkspaceId);
  assert.equal(f.state.controls.get(result.taskId).continuationOf,old.id);assert.equal(f.state.tasks.get(old.id).status,'done');
});

function blockedPlan(f,task,used){
  const text='{"tasks":[]}',plan={file:'old-plan.json',sha256:sha(text),text,bytes:Buffer.byteLength(text),runId:randomUUID(),inputRevision:taskInputRevision(task)};
  f.select(task,{plan,approvedPlanSha256:plan.sha256,pauseRequested:false});
  f.state.executions.set(task.id,{active:false,unknown:false,budgetUsed:used});return plan;
}

test('blocked continue reports insufficient remaining calls without approving or resending the old result',async()=>{
  const f=fixture(),task=f.makeTask({status:'blocked'}),old=blockedPlan(f,task,4),m=f.message('/chief continue');
  const result=await f.controller.dispatchTrustedCommand(m);
  assert.equal(result.status,'budget_exhausted');assert.equal(result.remainingCalls,2);assert.equal(result.requiredCalls,3);
  assert.match(result.replyText,/预算|调用/);assert.equal(f.state.tasks.get(task.id).status,'blocked');
  assert.equal(f.state.controls.get(task.id).plan.sha256,old.sha256);assert.equal(f.state.controls.get(task.id).resumeOperationId,null);
  assert.equal(f.registrations.length,0);await f.controller.dispatchTrustedCommand(m);assert.equal(f.acks.length,1);
});

test('blocked continue with three remaining calls keeps the root and hash but snapshots the old plan for a new stable generation',async()=>{
  const f=fixture(),task=f.makeTask({status:'blocked'}),old=blockedPlan(f,task,3),hash=taskInputRevision(task),m=f.message('/chief continue');
  const first=await f.controller.dispatchTrustedCommand(m),control=f.state.controls.get(task.id);
  assert.equal(f.state.tasks.get(task.id).status,'in_review');assert.equal(f.state.tasks.get(task.id).assigneeUserId,f.binding.nativeOwnerId);
  assert.equal(taskInputRevision(f.state.tasks.get(task.id)),hash);assert.equal(control.plan,null);assert.equal(control.approvedPlanSha256,null);
  assert.equal(control.reviewBeforeDispatch,false);assert.match(control.resumeOperationId,/^[a-f0-9-]{36}$/);
  assert.equal(f.state.events.get(chiefContextSourceKey(m)+':plan_snapshot').plan.sha256,old.sha256);
  assert.equal((await f.controller.dispatchTrustedCommand(m)).resumeOperationId,first.resumeOperationId);
  assert.equal(f.state.tasks.size,1);assert.equal(f.registrations.length,0);
});

test('blocked existing operation run is reconciled before the minimum-call rule',async()=>{
  const f=fixture(),task=f.makeTask({status:'blocked'});blockedPlan(f,task,6);
  const operationId=randomUUID(),runId=randomUUID();f.state.controls.get(task.id).resumeOperationId=operationId;
  f.state.runs.set(runId,{id:runId,issueId:task.id,companyId:f.binding.companyId,agentId:f.binding.chiefAgentId,status:'failed',operationId});
  const result=await f.controller.dispatchTrustedCommand(f.message('/chief continue'));
  assert.equal(result.status,'resume_reconciled');assert.equal(result.runId,runId);assert.equal(result.runStatus,'failed');
  assert.equal(f.operationLookups(),1);assert.equal(f.state.tasks.get(task.id).status,'blocked');assert.equal(f.state.controls.get(task.id).resumeOperationId,operationId);
});

test('blocked unknown operation claims are not replaced under a new resume ID',async()=>{
  const f=fixture(),task=f.makeTask({status:'blocked'});blockedPlan(f,task,2);
  const operationId=randomUUID();Object.assign(f.state.controls.get(task.id),{resumeOperationId:operationId,resumeClaim:{operationId,inputRevision:taskInputRevision(task)}});
  await assert.rejects(f.controller.dispatchTrustedCommand(f.message('/chief continue')),{code:'CHIEF_CONTEXT_RECONCILIATION_REQUIRED'});
  assert.equal(f.state.controls.get(task.id).resumeOperationId,operationId);assert.equal(f.state.tasks.get(task.id).status,'blocked');
});

test('action selector ignores same-project task-map registration while a memory source is being prepared',async()=>{
  const f=fixture(),history=f.knowledgeStore.history;let release;
  f.knowledgeStore.history=async input=>{if(!release)await new Promise(resolve=>{release=resolve;});return history(input);};
  const pending=f.controller.dispatchTrustedCommand(f.message('/chief remember 报告格式 先结论再证据'));
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  const task=await f.controller.dispatchTrustedCommand(f.message('/chief new Goal that finishes registration'));
  release();const result=await pending;assert.equal(result.version,1);assert.equal(f.writes.length,1);
  assert.equal(f.state.chats.get('oc_ownerchat').taskId,task.taskId);
});

test('action selector permits a new goal after an older same-project registration changes only the task pointer',async()=>{
  const f=fixture();let release;f.delayRegister(request=>request.intent.goal==='Slow old goal'?new Promise(resolve=>{release=resolve;}):undefined);
  const older=f.controller.dispatchTrustedCommand(f.message('/chief new Slow old goal'));while(!release)await new Promise(resolve=>setImmediate(resolve));
  const message=f.message('/chief new Later new goal'),key=chiefContextSourceKey(message);
  f.afterTransaction(async event=>{if(event.key===key&&event.result.project&&event.result.chat){f.afterTransaction(null);release();await older;}});
  const result=await f.controller.dispatchTrustedCommand(message);
  assert.equal(f.state.chats.get('oc_ownerchat').taskId,result.taskId);assert.equal(f.registrations.length,2);
});

test('action selector still rejects an actual current-project change while a memory command is pending',async()=>{
  const f=fixture(),history=f.knowledgeStore.history;let release;
  f.knowledgeStore.history=async input=>{if(!release)await new Promise(resolve=>{release=resolve;});return history(input);};
  const pending=f.controller.dispatchTrustedCommand(f.message('/chief remember 报告格式 真实旧项目决定'));
  while(!release)await new Promise(resolve=>setImmediate(resolve));await f.controller.dispatchTrustedCommand(f.message('/chief project rwb'));
  release();await assert.rejects(pending,{code:'CHIEF_CONTEXT_SOURCE_CONTEXT_CHANGED'});assert.equal(f.writes.length,0);
});

test('action selector rejects an implicit current-task change but not an explicit task reference',async()=>{
  const f=fixture(),a=f.makeTask();f.select(a);const message=f.message('/chief add Add to the selected task'),key=chiefContextSourceKey(message);
  f.afterTransaction(async event=>{if(event.key===key&&event.result.project&&event.result.chat){f.afterTransaction(null);await f.controller.dispatchTrustedCommand(f.message('/chief new A later selected goal'));}});
  await assert.rejects(f.controller.dispatchTrustedCommand(message),{code:'CHIEF_CONTEXT_SOURCE_CONTEXT_CHANGED'});
  const explicit=f.message('/chief add '+a.identifier+' Explicit original task'),explicitKey=chiefContextSourceKey(explicit);
  f.afterTransaction(async event=>{if(event.key===explicitKey&&event.result.project&&event.result.chat){f.afterTransaction(null);await f.controller.dispatchTrustedCommand(f.message('/chief project rwb'));}});
  await f.controller.dispatchTrustedCommand(explicit);assert.equal(f.state.controls.get(a.id).pendingInputs.length,1);
});

test('owner pause/add survives queued Native retry settlement and continues the same root with its original spent budget',async t=>{
 const f=fixture(),rootTask=f.makeTask();f.select(rootTask);
 const child=f.makeTask({parentId:rootTask.id,status:'in_progress',assigneeUserId:null,assigneeAgentId:f.registry.team.ids.research});
 const operation={id:randomUUID(),kind:'run',phase:'work',role:'research',taskId:child.id,rootTaskId:rootTask.id,projectId:rootTask.projectId,
  agentId:f.registry.team.ids.research,inputRevision:taskInputRevision(child),rootInputRevision:taskInputRevision(rootTask)};
 const parentRun={id:randomUUID(),companyId:f.binding.companyId,issueId:child.id,agentId:operation.agentId,responsibleUserId:'owner',status:'failed',exitCode:1,finishedAt:'2026-11-20T01:00:01Z'};
 const run={id:randomUUID(),companyId:f.binding.companyId,issueId:child.id,agentId:operation.agentId,responsibleUserId:'owner',status:'queued',retryOfRunId:parentRun.id,scheduledRetryAttempt:1};
 Object.assign(f.registry,{operations:[operation],tasks:[rootTask.id,child.id],taskRoots:{[child.id]:rootTask.id},agents:[{profile:{role:'research',agentId:operation.agentId}}],
  lease:{taskId:child.id,projectId:rootTask.projectId,operationId:operation.id,nonce:'a'.repeat(64)}});f.registry.team.enabled=true;
 const flow={rootTaskId:rootTask.id,projectId:rootTask.projectId,inputRevision:operation.rootInputRevision,taskEntries:[{id:child.id,key:'research',role:'research',agentId:operation.agentId}],
  dispatches:{research:{operationId:operation.id,taskId:child.id,inputRevision:operation.inputRevision,leaseNonce:f.registry.lease.nonce}},artifacts:{}};
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-owner-settle-'));t.after(()=>fs.rmSync(root,{recursive:true}));
 fs.mkdirSync(root+'/budget/'+rootTask.id,{recursive:true,mode:0o700});fs.mkdirSync(root+'/operations',{mode:0o700});fs.mkdirSync(root+'/transport/'+parentRun.id,{recursive:true,mode:0o700});
 const result={runId:parentRun.id,exitCode:1,signal:null,cancelled:false,timedOut:false,outputUnknown:false,stdoutSha256:sha('known failed stdout'),stderrSha256:sha('known failed stderr')};
 for(const [file,bytes]of [['stdout','known failed stdout'],['stderr','known failed stderr'],['result.json',JSON.stringify(result)]])fs.writeFileSync(root+'/transport/'+parentRun.id+'/'+file,bytes,{mode:0o600});
 const callLock={taskId:child.id,operationId:operation.id,nonce:randomUUID()},budgetRecord={schemaVersion:1,...operation};
 const operationBinding={operationId:operation.id,runId:parentRun.id,taskId:child.id,agentId:operation.agentId};
 fs.writeFileSync(root+'/call.lock',JSON.stringify(callLock)+'\n',{mode:0o600});fs.writeFileSync(root+'/budget/'+rootTask.id+'/'+operation.id+'.json',JSON.stringify(budgetRecord),{mode:0o600});
 fs.writeFileSync(root+'/operations/'+operation.id+'.json',JSON.stringify(operationBinding),{mode:0o600});
 f.state.executions.set(rootTask.id,{active:true,unknown:true,started:true,budgetUsed:1});
 await f.controller.dispatchTrustedCommand(f.message('/chief pause '+rootTask.identifier));await f.controller.dispatchTrustedCommand(f.message('/chief add '+rootTask.identifier+' Keep this new owner requirement'));
 const before=copy({flow,operations:f.registry.operations,lease:f.registry.lease}),oldHash=taskInputRevision(rootTask);
 let consumed=0;
 assert.equal(await consumeQueuedNativeRoleRetry({registry:f.registry,activeRuns:[run],parentRun,tasks:[rootTask,child],log(){},resume:async()=>{
  consumed++;run.status='running';assert.equal(nativeRetryControlMode({registry:f.registry,rootTask,flow,control:f.state.controls.get(rootTask.id)}),'settle-only');
  const settled=settleNativeRetryWithoutProvider({root,reason:'owner_control',registry:f.registry,flow,rootTask,task:child,operation,run,parentRun,callLock,budgetCount:1,budgetRecord,operationBinding,
   transportResult:result,stdoutSha256:result.stdoutSha256,stderrSha256:result.stderrSha256,activeRuns:[run],leases:[{heartbeatRunId:parentRun.id,status:'failed',releasedAt:'2026-11-20T01:00:02Z'}],log(){}});
  Object.assign(run,{status:'failed',resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}},errorCode:settled.errorCode});return[run];
 }}),true);
 assert.equal(consumed,1);assert.deepEqual({flow,operations:f.registry.operations,lease:f.registry.lease},before);assert.equal(fs.existsSync(root+'/call.lock'),false);
 const evidence=observeContextCallEvidence({task:rootTask,ids:[rootTask.id,child.id],runs:[parentRun,run],root});assert.equal(evidence.unknown,false);
 assert.equal(canReleaseSettledNativeRetryPhase({runs:[parentRun,run],evidence}),true);
 f.state.executions.set(rootTask.id,{active:false,unknown:evidence.unknown,started:true,budgetUsed:evidence.budgetUsed});
 await f.controller.dispatchTrustedCommand(f.message('/chief continue '+rootTask.identifier));
 const view=await f.controller.syncTask({registry:f.registry,task:rootTask,flow:{rootTaskId:rootTask.id,inputRevision:oldHash,children:[{taskId:child.id,inputRevision:operation.inputRevision}]}});
 assert.equal(view.task.id,rootTask.id);assert.equal(view.control.pauseRequested,false);assert.match(view.task.description,/Keep this new owner requirement/);
 assert.notEqual(view.control.inputRevision,oldHash);assert.equal(f.state.tasks.size,2);assert.equal(f.state.executions.get(rootTask.id).budgetUsed,1);
 assert.equal(fs.readdirSync(root+'/budget/'+rootTask.id).length,1);assert.equal(f.registrations.length,0);
});
