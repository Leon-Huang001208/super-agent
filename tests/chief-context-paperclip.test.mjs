import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createChiefContextPaperclipRepository, readManagedChiefContext, observeContextCallEvidence } from '../bridge/chief-context-paperclip.mjs';
import { createChiefFeishuNative, chiefFeishuOperation } from '../bridge/chief-feishu-native.mjs';
import { createChiefContextController } from '../bridge/chief-context-native.mjs';
import { createProjectCatalog } from '../bridge/context-projects.mjs';
import { taskInputRevision } from '../bridge/task-input.mjs';
import { ROLE_KEYS } from '../bridge/role-labels.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChiefContextApplication } from '../bridge/chief-context-service.mjs';
import { parseChiefContextCommand } from '../bridge/chief-context-commands.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
  const binding={appId:'cli_fixture',tenantKey:'tenant',ownerOpenId:'ou_owner',nativeOwnerId:'owner_native',companyId:randomUUID(),projectId:randomUUID(),chiefAgentId:randomUUID()};
  const agentIds=Object.fromEntries(ROLE_KEYS.map(k=>[k,k==='chief'?binding.chiefAgentId:randomUUID()]));
  const project={key:'personal',aliases:['个人'],companyId:binding.companyId,ownerId:binding.nativeOwnerId,projectId:binding.projectId,adapterKey:'native-docs',allowedRoles:['chief','pm'],maximumAction:'read_only',workspaceCwd:`/paperclip/instances/default/projects/${binding.companyId}/${binding.projectId}/_default`};
  const catalog=createProjectCatalog({registry:{schemaVersion:1,defaultProjectKey:'personal',projects:[project]},authority:{companyId:binding.companyId,ownerId:binding.nativeOwnerId,agentIds},log:()=>{}});
  const data={issues:[],activityLog:[],heartbeatRuns:[],projects:[{id:project.projectId,companyId:binding.companyId}]},locks=[],published=[],calls={transactions:0,create:0,wake:0};
  const schema=Object.fromEntries(Object.keys(data).map(name=>[name,{name,...Object.fromEntries(['id','companyId','projectId','parentId','issueId','status','action','entityId','details','contextSnapshot','createdAt','actorType','actorId'].map(key=>[key,{name,key}]))}]));
  schema.agentWakeupRequests={name:'agentWakeupRequests',companyId:{key:'companyId'},idempotencyKey:{key:'idempotencyKey'}};data.agentWakeupRequests=[];
  const orm={eq:(c,v)=>row=>row[c.key]===v,and:(...ps)=>row=>ps.every(p=>p(row)),inArray:(c,vs)=>row=>vs.includes(row[c.key]),asc:x=>x,desc:x=>x,
    sql:(strings,...args)=>{const p=/->>'([^']+)'/.exec(strings.join(''));return p?row=>row[args[0].key]?.[p[1]]===args[1]:()=>true;}};
  function query(projection){let table,filter=()=>true,max=Infinity;const q={from(t){table=t;return q;},where(p){filter=p;return q;},orderBy(){return q;},limit(n){max=n;return q;},for(kind){locks.push({table:table.name,kind});return q;},then(a,b){
    const rows=(data[table.name]??[]).filter(filter).slice(0,max).map(row=>projection?Object.fromEntries(Object.entries(projection).map(([k,c])=>[k,row[c.key]])):structuredClone(row));
    if(calls.memoryAuthorizationGate&&rows.some(row=>row.action==='team.context.intent'&&row.details.kind==='remember'&&
      data.activityLog.some(effect=>effect.action==='team.context.effect_claimed'&&effect.details.operationId===row.details.operationId))){
      const gate=calls.memoryAuthorizationGate;delete calls.memoryAuthorizationGate;gate.entered();return gate.wait.then(()=>rows).then(a,b);
    }
    return Promise.resolve(rows).then(a,b);
  }};return q;}
  const tx={select:query,execute:async()=>[]};
  const db={...tx,transaction:async fn=>{calls.transactions++;return fn(tx);}};
  const services={issueService:connection=>({
    getById:async id=>structuredClone(data.issues.find(t=>t.id===id||t.identifier===id)??null),
    getByIdForUpdate:async(id,same)=>{assert.equal(same,tx);assert.equal(connection,tx);locks.push({id});return structuredClone(data.issues.find(t=>t.id===id)??null);},
    update:async(id,patch)=>{const t=data.issues.find(x=>x.id===id);Object.assign(t,patch);return structuredClone(t);},
    addComment:async()=>({id:randomUUID()}),create:async()=>{calls.create++;throw Error('unexpected task creation');}}),
    heartbeatService:()=>({wakeup:async()=>{calls.wake++;return {id:randomUUID()};}}),
    logActivity:async(_tx,record,events)=>{assert.equal(_tx,tx);if(calls.failMemoryResultOnce&&record.action==='team.context.result'&&record.details.kind==='remember'){calls.failMemoryResultOnce=false;throw Error('fixture lost memory result commit');}const row={id:randomUUID(),createdAt:new Date(),...structuredClone(record)};data.activityLog.push(row);events?.push({id:row.id});},publishActivity:value=>published.push(value)};
  const database=async()=>({db,schema,orm});
  const options={database,binding,catalog,log:()=>{},loadServices:async()=>services,observeLocalExecution:()=>({unknown:false,budgetUsed:0}),observeLocalOperation:()=>null};
  const task={id:randomUUID(),identifier:'LEO-50',companyId:binding.companyId,projectId:binding.projectId,responsibleUserId:binding.nativeOwnerId,createdByUserId:binding.nativeOwnerId,status:'in_review',title:'Owner task',description:'original goal',parentId:null};data.issues.push(task);
  return {binding,catalog,project,agentIds,data,locks,published,calls,tx,db,database,services,options,task};
}

test('existing Native transaction is reused for a read-only context guard',async()=>{
  const f=fixture(),repo=await createChiefContextPaperclipRepository(f.options);
  await repo.transaction('context-sync:'+f.task.id,async tx=>{
    assert.equal((await tx.readTask('LEO-50')).id,f.task.id);
    assert.equal(await tx.readControl(f.task.id),null);
    await assert.rejects(tx.append('x',{value:1}),{code:'CHIEF_CONTEXT_TRANSACTION_READ_ONLY'});
  },{taskId:f.task.id,db:f.tx,actor:'controller'});
  assert.equal(f.calls.transactions,0);assert.equal(f.data.activityLog.length,0);
});
test('chat and control projections persist as scoped Native activity, never task rows',async()=>{
  const f=fixture(),repo=await createChiefContextPaperclipRepository(f.options),key='a'.repeat(64);
  await repo.transaction(key,async tx=>{
    await tx.writeChat({schemaVersion:1,companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,chatId:'oc_test',projectId:f.project.projectId,taskId:f.task.id,projectTasks:{[f.project.projectId]:f.task.id},sequence:1,revision:1});
    await tx.writeControl(f.task.id,{schemaVersion:1,managed:true,companyId:f.binding.companyId,projectId:f.project.projectId,ownerId:f.binding.nativeOwnerId,taskId:f.task.id,inputRevision:taskInputRevision(f.task),revision:0,pendingInputs:[]});
  },{chatId:'oc_test'});
  await repo.transaction(key,async tx=>{assert.equal((await tx.readChat()).taskId,f.task.id);assert.equal((await tx.readControl(f.task.id)).revision,0);},{chatId:'oc_test'});
  assert.equal(f.data.issues.length,1);assert.equal(f.calls.create,0);assert.ok(f.published.length>=2);
});
test('M2 association comes from Native control and does not restrict an unrelated legacy workspace or project',async()=>{
  const f=fixture(),third={...f.task,id:randomUUID(),projectId:randomUUID(),projectWorkspaceId:randomUUID()};
  assert.equal(await readManagedChiefContext({...await f.database(),task:third,companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId}),null);
  const repo=await createChiefContextPaperclipRepository(f.options);
  await repo.transaction('association',tx=>tx.writeControl(f.task.id,{schemaVersion:1,managed:true,companyId:f.binding.companyId,
    projectId:f.task.projectId,ownerId:f.binding.nativeOwnerId,taskId:f.task.id,inputRevision:taskInputRevision(f.task),revision:0,pendingInputs:[]}),{actor:'controller'});
  const associated=await readManagedChiefContext({...await f.database(),task:f.task,companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId});
  assert.equal(associated.managed,true);assert.equal(associated.taskId,f.task.id);assert.equal(f.calls.wake,0);
  f.data.activityLog.find(row=>row.action==='team.context.control').details.value.ownerId='other';
  await assert.rejects(readManagedChiefContext({...await f.database(),task:f.task,companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId}),{code:'CHIEF_CONTEXT_CONTROL_CHANGED'});
});
test('foreign Native tasks and scope-changing patches are denied',async()=>{
  const f=fixture(),repo=await createChiefContextPaperclipRepository(f.options);
  await repo.transaction('b'.repeat(64),async tx=>{
    await assert.rejects(tx.updateTask(f.task.id,{projectId:randomUUID()}),{code:'CHIEF_CONTEXT_PATCH_DENIED'});
    f.data.issues[0].responsibleUserId='other';
    await assert.rejects(tx.readTask(f.task.id),{code:'CHIEF_CONTEXT_TASK_SCOPE_DENIED'});
  },{chatId:'oc_test'});
});
test('status execution observation covers root children without starting any model',async()=>{
  const f=fixture(),child={...f.task,id:randomUUID(),identifier:'LEO-51',parentId:f.task.id};f.data.issues.push(child);
  f.data.heartbeatRuns.push({id:randomUUID(),companyId:f.binding.companyId,issueId:child.id,status:'running'});
  const repo=await createChiefContextPaperclipRepository(f.options);
  const result=await repo.transaction('c'.repeat(64),tx=>tx.readExecution(f.task.id),{chatId:'oc_test'});
  assert.equal(result.active,true);assert.equal(f.calls.wake,0);assert.equal(f.calls.create,0);
});

test('a physically settled Native retry preserves both budget slots and does not leave its failed parent permanently unknown',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sa-context-retry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const task={id:randomUUID(),companyId:randomUUID(),projectId:randomUUID(),responsibleUserId:'owner'},childId=randomUUID(),agentId=randomUUID();
  const parent={id:randomUUID(),issueId:childId,agentId,companyId:task.companyId,responsibleUserId:'owner',status:'failed',exitCode:1,finishedAt:'2026-11-20T07:00:00Z'};
  const retry={...parent,id:randomUUID(),status:'succeeded',exitCode:0,retryOfRunId:parent.id,scheduledRetryAttempt:1};
  const op={id:randomUUID(),kind:'run',role:'pm',phase:'work',taskId:childId,agentId,rootTaskId:task.id,projectId:task.projectId};
  const next={...op,id:randomUUID(),acceptedRunId:retry.id,retryOfRunId:parent.id,retryOfOperationId:op.id,nativeRetryAttempt:1};
  const put=(name,value,mode=0o600)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value)+'\n',{mode});return file;};
  for(const [call,run]of [[op,parent],[next,retry]]){put('budget/'+task.id+'/'+call.id+'.json',call);put('operations/'+call.id+'.json',{operationId:call.id,taskId:childId,agentId,runId:run.id});}
  put('transport/'+parent.id+'/stdout','Settled failed output');put('transport/'+parent.id+'/stderr','Known nonzero exit');
  const result={runId:parent.id,exitCode:1,signal:null,cancelled:false,outputUnknown:false,timedOut:false,
    stdoutSha256:sha('Settled failed output'),stderrSha256:sha('Known nonzero exit')};put('transport/'+parent.id+'/result.json',result);
  const lock=put('team/native-retries/'+parent.id+'/call.lock.json',{operationId:op.id,taskId:childId,nonce:randomUUID()},0o400);
  put('team/native-retries/'+parent.id+'/receipt.json',{parentRunId:parent.id,operationId:op.id,taskId:childId,
    directory:path.dirname(lock),lockFile:lock,lockSha256:sha(fs.readFileSync(lock))},0o400);
  const input={root,task,ids:[task.id,childId],runs:[parent,retry]},observed=observeContextCallEvidence(input);
  assert.equal(observed.budgetUsed,2);assert.equal(observed.unknown,false);assert.deepEqual(observed.settledFailedRunIds,[parent.id]);
  put('transport/'+parent.id+'/result.json',{...result,outputUnknown:true});assert.equal(observeContextCallEvidence(input).unknown,true);
  put('transport/'+parent.id+'/result.json',result);retry.retryOfRunId=randomUUID();assert.equal(observeContextCallEvidence(input).unknown,true);
});

test('superseding an old child accepts only its already-settled Native failed attempts and preserves their records',async()=>{
  const f=fixture(),child={...f.task,id:randomUUID(),identifier:'LEO-52',parentId:f.task.id,createdByAgentId:f.binding.chiefAgentId,status:'done'};
  f.data.issues.push(child);
  const failed={id:randomUUID(),companyId:f.binding.companyId,issueId:child.id,agentId:f.agentIds.pm,status:'failed'};
  const retry={...failed,id:randomUUID(),status:'succeeded',retryOfRunId:failed.id};f.data.heartbeatRuns.push(failed,retry);
  const args={rootTaskId:f.task.id,previousInputRevision:taskInputRevision(f.task),newInputRevision:sha('supplemented input'),children:[{taskId:child.id,inputRevision:taskInputRevision(child)}]};
  const repo=await createChiefContextPaperclipRepository({...f.options,observeLocalExecution:()=>({unknown:false,budgetUsed:2,settledFailedRunIds:[failed.id]})});
  await repo.transaction('supersede-known-retry',tx=>tx.supersedeChildren(args),{taskId:f.task.id,actor:'controller'});
  assert.equal(f.data.issues.find(task=>task.id===child.id).status,'done');assert.equal(f.data.heartbeatRuns.find(run=>run.id===failed.id).status,'failed');
  const unproved=await createChiefContextPaperclipRepository({...f.options,observeLocalExecution:()=>({unknown:false,budgetUsed:2})});
  await assert.rejects(unproved.transaction('supersede-unknown-retry',tx=>tx.supersedeChildren(args),{taskId:f.task.id,actor:'controller'}),{code:'CHIEF_CONTEXT_RECONCILIATION_REQUIRED'});
});
test('memory authorizer binds the exact owner intent, source, scope and value',async()=>{
  const f=fixture(),repo=await createChiefContextPaperclipRepository(f.options),operationId=randomUUID(),sourceKey='d'.repeat(64);
  const request={scope:{companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,projectId:f.project.projectId,projectKey:f.project.key},id:'owner-example',kind:'decision',visibility:'project',text:'one confirmed value',condition:'until corrected',source:{messageId:'om_test',chatId:'oc_test',bodySha256:'e'.repeat(64),createdAt:'2026-11-20T03:00:00.000Z'},operationId};
  await repo.transaction(sourceKey,tx=>tx.append('intent',{schemaVersion:1,sourceKey,operationId,kind:'remember',project:f.project,scope:request.scope,source:request.source,sourceParams:{appId:f.binding.appId,tenantKey:f.binding.tenantKey,ownerOpenId:f.binding.ownerOpenId},bodySha256:request.source.bodySha256,writeRequest:request}),{chatId:'oc_test'});
  const canonical={action:'remember',...request,role:null,expectedVersion:null};
  assert.equal(await repo.authorizeKnowledgeRequest(canonical),true);
  assert.equal(await repo.authorizeKnowledgeRequest({...canonical,text:'different'}),false);
  assert.equal(await repo.authorizeKnowledgeRequest({...canonical,scope:{...canonical.scope,projectId:randomUUID()}}),false);
});
test('an existing M1 event is not reinterpreted as a new M2 memory command',async()=>{
  const f=fixture(),repo=await createChiefContextPaperclipRepository(f.options);
  const text='/chief remember report-style use evidence';
  const message={...f.binding,messageId:'om_old',chatId:'oc_test',bodySha256:sha(text),text,command:{kind:'remember',key:'report-style',text:'use evidence'}};
  message.sourceParams={source:'feishu',eventType:'im.message.receive_v1',appId:f.binding.appId,tenantKey:f.binding.tenantKey,ownerOpenId:f.binding.ownerOpenId,messageId:message.messageId,chatId:message.chatId,bodySha256:message.bodySha256};
  const key=chiefFeishuOperation(message);
  f.data.activityLog.push({id:randomUUID(),companyId:f.binding.companyId,actorType:'user',actorId:f.binding.nativeOwnerId,action:'team.feishu.registered',entityId:f.task.id,details:{operationId:key,taskId:f.task.id,identifier:f.task.identifier,companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,chiefAgentId:f.binding.chiefAgentId,projectId:f.project.projectId,bodySha256:message.bodySha256}});
  let writes=0,acks=0;
  const controller=createChiefContextController({binding:f.binding,catalog:f.catalog,repository:repo,
    knowledgeStore:{remember:async()=>{writes++;},correct:async()=>{writes++;},query:()=>[],history:()=>[]},
    registerNewGoal:async()=>{throw Error('unexpected registration');},acknowledge:async()=>{acks++;},log:()=>{}});
  const result=await controller.dispatchTrustedCommand(message);
  assert.equal(result.taskId,f.task.id);assert.equal(result.legacy,true);
  assert.equal(writes,0);assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);assert.equal(acks,0);
});

test('new goal registration and M2 control/chat binding share the original Native transaction',async()=>{
  const f=fixture(),repo=await createChiefContextPaperclipRepository(f.options),operationId=randomUUID();
  const text='/chief new create a new goal',sourceKey=chiefFeishuOperation({...f.binding,messageId:'om_create'});
  const intent={schemaVersion:1,sourceKey,operationId,kind:'new',project:f.project,scope:{companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,projectId:f.project.projectId,projectKey:f.project.key},source:{messageId:'om_create',chatId:'oc_test'},chatId:'oc_test',bodySha256:sha(text),goal:'create a new goal',reviewBeforeDispatch:true,continuationOf:null};
  await repo.transaction(sourceKey,async tx=>{
    await tx.append('intent',intent);
    await tx.writeChat({schemaVersion:1,companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,chatId:'oc_test',projectId:f.project.projectId,taskId:null,projectTasks:{},projectGoalOperations:{[f.project.projectId]:operationId},pendingGoalOperationId:operationId,sequence:1,revision:1});
  },{chatId:'oc_test'});
  const original=f.services.issueService;
  f.services.issueService=connection=>({...original(connection),create:async(company,options)=>{f.calls.create++;assert.equal(options.allowDuplicate,true);const value={...options,companyId:company,identifier:'LEO-60'};f.data.issues.push(value);return structuredClone(value);}});
  const registry={companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,team:{ids:f.agentIds},context:{schemaVersion:1,enabled:true}};
  const context=repo.createGoalHooks({getRegistry:()=>registry,getController:()=>null});
  let ackControl;
  const native=await createChiefFeishuNative({database:f.database,binding:f.binding,context,canDispatch:async()=>false,
    acknowledge:async record=>{ackControl=await repo.transaction(sourceKey,tx=>tx.readControl(record.taskId),{chatId:'oc_test'});return {messageId:'om_created'};},log:()=>{},loadServices:async()=>f.services});
  const result=await native.registerTrustedMessage({...f.binding,messageId:'om_create',chatId:'oc_test',sourceParams:{messageId:'om_create',chatId:'oc_test'},text,goal:intent.goal,bodySha256:intent.bodySha256,contextIntentOperationId:operationId});
  assert.equal(f.calls.create,1);assert.equal(ackControl.managed,true);assert.equal(ackControl.reviewBeforeDispatch,true);
  assert.equal(ackControl.inputRevision,result.inputRevision);
  const chat=await repo.transaction(sourceKey,tx=>tx.readChat(),{chatId:'oc_test'});assert.equal(chat.taskId,result.taskId);
});

test('operation lookup reconciles a known Native run without another model or pool call',async()=>{
  const f=fixture(),operationId=randomUUID(),run={id:randomUUID(),companyId:f.binding.companyId,issueId:f.task.id,agentId:f.binding.chiefAgentId,status:'succeeded',contextSnapshot:{roleOperationId:operationId}};
  f.data.heartbeatRuns.push(run);const repo=await createChiefContextPaperclipRepository(f.options);
  const result=await repo.transaction('f'.repeat(64),tx=>tx.readOperationRun({taskId:f.task.id,operationId}),{db:f.tx,taskId:f.task.id,actor:'controller'});
  assert.equal(result.id,run.id);assert.equal(f.calls.transactions,0);assert.equal(f.calls.wake,0);
});

async function application(t){
  const f=fixture(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'sa-m2-app-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const other={...f.project,key:'rwb',aliases:['投研'],projectId:randomUUID(),projectWorkspaceId:randomUUID(),adapterKey:'rwb-docs'};
  other.workspaceCwd=`/paperclip/instances/default/projects/${f.binding.companyId}/${other.projectId}/_default`;
  f.data.projects.push({id:other.projectId,companyId:f.binding.companyId});
  const catalog={schemaVersion:1,defaultProjectKey:f.project.key,projects:[f.project,other]};
  const registry={companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,team:{projectId:f.project.projectId,ids:f.agentIds},context:{schemaVersion:1,enabled:true,catalog}};
  const original=f.services.issueService;
  f.services.issueService=connection=>({...original(connection),create:async(company,options)=>{f.calls.create++;
    if(f.calls.createGate){const gate=f.calls.createGate;delete f.calls.createGate;gate.entered();await gate.wait;}
    const row={...options,companyId:company,identifier:'LEO-'+(60+f.calls.create)};f.data.issues.push(row);return structuredClone(row);}});
  const priorMessageId='om_priorowner';
  const priorParams={source:'feishu',eventType:'im.message.receive_v1',appId:f.binding.appId,tenantKey:f.binding.tenantKey,ownerOpenId:f.binding.ownerOpenId,
    messageId:priorMessageId,chatId:'oc_test',bodySha256:sha('prior authenticated owner goal'),eventId:'event_prior'};
  f.data.activityLog.push({id:randomUUID(),companyId:f.binding.companyId,actorType:'user',actorId:f.binding.nativeOwnerId,action:'team.feishu.registered',entityId:f.task.id,
    details:{schemaVersion:1,operationId:chiefFeishuOperation({...f.binding,messageId:priorMessageId}),taskId:f.task.id,identifier:f.task.identifier,companyId:f.binding.companyId,
      ownerId:f.binding.nativeOwnerId,chiefAgentId:f.binding.chiefAgentId,projectId:f.binding.projectId,sourceParams:priorParams,bodySha256:priorParams.bodySha256}});
  const messages=[],officialMessages=new Map(),logs=[],client={im:{message:{
    get:async value=>{f.calls.get=(f.calls.get??0)+1;if(f.calls.failGet)throw Error('private official GET failure');return {code:0,data:{items:[structuredClone(officialMessages.get(value.path.message_id))]}};},
    create:async value=>{messages.push({method:'create',value});if(f.calls.failReplyOnce){f.calls.failReplyOnce=false;throw Error('fixture unknown send result');}return {code:0,data:{message_id:'om_send'+messages.length}};},
    reply:async value=>{messages.push({method:'reply',value});if(f.calls.failGoalReplyOnce){f.calls.failGoalReplyOnce=false;throw Error('unknown goal ACK fixture');}return {code:0,data:{message_id:'om_send'+messages.length}};}}}};
  const app=await createChiefContextApplication({database:f.database,binding:f.binding,registry,client,log:event=>logs.push(event),currentScope:()=>{},knowledgeRoot:folder+'/knowledge',loadServices:async()=>f.services,
    observeLocalExecution:()=>({unknown:false,budgetUsed:0}),observeLocalOperation:()=>null});
  let number=0;
  const snapshot=text=>{const messageId='om_input'+(++number),bodySha256=sha(text);return {...f.binding,text,goal:text.slice(6).trim(),command:parseChiefContextCommand(text),messageId,chatId:'oc_test',bodySha256,
    createdAt:'2026-11-20T03:00:00.000Z',sourceParams:{source:'feishu',eventType:'im.message.receive_v1',appId:f.binding.appId,tenantKey:f.binding.tenantKey,ownerOpenId:f.binding.ownerOpenId,messageId,chatId:'oc_test',bodySha256,createdAt:'2026-11-20T03:00:00.000Z'}};};
  const putOfficial=source=>officialMessages.set(source.messageId,{message_id:source.messageId,chat_id:source.chatId,msg_type:'text',create_time:String(Date.parse(source.createdAt)),
    update_time:String(Date.parse(source.createdAt)),updated:true,deleted:false,sender:{id_type:'open_id',id:f.binding.ownerOpenId,sender_type:'user',tenant_key:f.binding.tenantKey},body:{content:JSON.stringify({text:source.text})}});
  return {...f,app,registry,other,messages,snapshot,putOfficial,officialMessages,logs};
}

test('official recovery previews without effects, applies exactly once and never drains or wakes',async t=>{
  const f=await application(t),source=f.snapshot('/chief --project rwb --plan-first new 原消息资料任务');f.putOfficial(source);
  const request={messageId:source.messageId,expectedBodySha256:source.bodySha256},before=f.data.activityLog.length;
  const preview=await f.app.recoverOfficialGoal(request);
  assert.equal(preview.mode,'preview');assert.equal(preview.verified,true);assert.equal(preview.commandKind,'new');
  assert.equal(Object.hasOwn(preview,'text'),false);assert.equal(Object.hasOwn(preview,'result'),false);
  assert.equal(f.data.activityLog.length,before);assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);assert.equal(f.messages.length,0);
  const first=await f.app.recoverOfficialGoal(request,{apply:true}),again=await f.app.recoverOfficialGoal(request,{apply:true});
  assert.equal(first.mode,'apply');assert.equal(first.result.taskId,again.result.taskId);assert.equal(f.calls.create,1);assert.equal(f.messages.length,1);assert.equal(f.calls.wake,0);
  const intent=f.data.activityLog.find(row=>row.action==='team.context.intent'&&row.details.sourceKey===chiefFeishuOperation(source)).details;
  assert.equal(intent.sourceParams.eventType,'feishu.message_api_recovery');assert.equal(Object.hasOwn(intent.sourceParams,'eventId'),false);
  assert.equal(intent.project.projectId,f.other.projectId);assert.equal(JSON.stringify(f.logs).includes(source.text),false);
});

test('API-first recovery and late SDK receipt share the original intent without a new task or ACK',async t=>{
  const f=await application(t),source=f.snapshot('/chief new 只恢复同一原目标');source.sourceParams.eventId='event_late_sdk';f.putOfficial(source);
  const recovered=await f.app.recoverOfficialGoal({messageId:source.messageId,expectedBodySha256:source.bodySha256},{apply:true});
  const before=f.data.activityLog.filter(row=>row.action==='team.context.intent').map(row=>structuredClone(row.details));
  const late=await f.app.receiveTrusted(source);
  assert.equal(late.taskId,recovered.result.taskId);assert.equal(f.calls.create,1);assert.equal(f.messages.length,1);assert.equal(f.calls.wake,0);
  assert.deepEqual(f.data.activityLog.filter(row=>row.action==='team.context.intent').map(row=>row.details),before);
  assert.ok(f.logs.some(row=>row.code==='CHIEF_CONTEXT_GOAL_ORIGIN_REUSED'&&row.incomingOrigin==='im.message.receive_v1'&&row.originalOrigin==='feishu.message_api_recovery'));
});

test('SDK-first receipt and official recovery keep the stored SDK fingerprint and actual event ID',async t=>{
  const f=await application(t),source=f.snapshot('/chief new 正常先入站');source.eventId='event_first_sdk';source.sourceParams.eventId=source.eventId;f.putOfficial(source);
  const first=await f.app.receiveTrusted(source),intentBefore=structuredClone(f.data.activityLog.find(row=>row.action==='team.context.intent').details);
  const recovered=await f.app.recoverOfficialGoal({messageId:source.messageId,expectedBodySha256:source.bodySha256},{apply:true});
  assert.equal(recovered.result.taskId,first.taskId);assert.equal(f.calls.create,1);assert.equal(f.messages.length,1);assert.equal(f.calls.wake,0);
  assert.deepEqual(f.data.activityLog.find(row=>row.action==='team.context.intent').details,intentBefore);
  assert.equal(intentBefore.sourceParams.eventId,'event_first_sdk');
  assert.ok(f.logs.some(row=>row.code==='CHIEF_CONTEXT_GOAL_ORIGIN_REUSED'&&row.incomingOrigin==='feishu.message_api_recovery'&&row.originalOrigin==='im.message.receive_v1'));
});

test('concurrent API and SDK receipt coalesce before registration and a conflicting body never borrows the in-flight result',async t=>{
  const f=await application(t),source=f.snapshot('/chief new 并发原消息');source.sourceParams.eventId='event_concurrent';f.putOfficial(source);
  const request={messageId:source.messageId,expectedBodySha256:source.bodySha256};
  const [api,sdk]=await Promise.all([f.app.recoverOfficialGoal(request,{apply:true}),f.app.receiveTrusted(source)]);
  assert.equal(api.result.taskId,sdk.taskId);assert.equal(f.calls.create,1);assert.equal(f.messages.length,1);assert.equal(f.calls.wake,0);
  const changed={...source,text:'/chief new 修改后的正文',goal:'修改后的正文',command:parseChiefContextCommand('/chief new 修改后的正文')};
  changed.bodySha256=sha(changed.text);changed.sourceParams={...source.sourceParams,bodySha256:changed.bodySha256};
  await assert.rejects(f.app.receiveTrusted(changed),{code:'CHIEF_CONTEXT_SOURCE_CONFLICT'});
  assert.equal(f.calls.create,1);assert.equal(f.messages.length,1);
});

test('a registered goal with no ACK claim can be reconciled once while an unknown claimed ACK is never resent',async t=>{
  const f=await application(t),source=f.snapshot('/chief new ACK受理窗口');f.putOfficial(source);
  const first=await f.app.receiveTrusted(source),key=chiefFeishuOperation(source);
  f.data.activityLog=f.data.activityLog.filter(row=>!(row.action.startsWith('team.feishu.ack_')&&row.details.operationId===key));f.messages.length=0;
  const recovered=await f.app.recoverOfficialGoal({messageId:source.messageId,expectedBodySha256:source.bodySha256},{apply:true});
  assert.equal(recovered.result.taskId,first.taskId);assert.equal(f.messages.length,1);assert.equal(f.calls.create,1);
  const uncertain=await application(t),other=uncertain.snapshot('/chief new ACK未知窗口');uncertain.putOfficial(other);uncertain.calls.failGoalReplyOnce=true;
  const accepted=await uncertain.app.receiveTrusted(other);assert.equal(uncertain.messages.length,1);
  const same=await uncertain.app.recoverOfficialGoal({messageId:other.messageId,expectedBodySha256:other.bodySha256},{apply:true});
  assert.equal(same.result.taskId,accepted.taskId);assert.equal(uncertain.messages.length,1);assert.equal(uncertain.calls.create,1);assert.equal(uncertain.calls.wake,0);
});

test('either authenticated origin can lead an in-flight creation without a competing goal, ACK or borrowed conflicting result',async t=>{
  for(const firstOrigin of ['api','sdk']){
    const f=await application(t),source=f.snapshot('/chief new 指定并发交接');source.sourceParams.eventId='event_concurrent_original';f.putOfficial(source);
    let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),wait=new Promise(resolve=>{release=resolve;});f.calls.createGate={entered:enter,wait};
    const request={messageId:source.messageId,expectedBodySha256:source.bodySha256};
    const api=()=>f.app.recoverOfficialGoal(request,{apply:true}).then(value=>value.result),sdk=()=>f.app.receiveTrusted(source);
    const first=(firstOrigin==='api'?api:sdk)();await entered;
    const second=(firstOrigin==='api'?sdk:api)();
    const changed=structuredClone(source);changed.text='/chief new 不同正文不得借用并发结果';changed.bodySha256=sha(changed.text);
    changed.command=parseChiefContextCommand(changed.text);changed.goal=changed.command.goal;changed.sourceParams.bodySha256=changed.bodySha256;
    const rejected=assert.rejects(f.app.receiveTrusted(changed),{code:'CHIEF_CONTEXT_SOURCE_CONFLICT'});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.create,1);assert.equal(f.messages.length,0);release();
    const [one,two]=await Promise.all([first,second]);await rejected;
    assert.equal(one.taskId,two.taskId);assert.equal(one.kind,'new');assert.equal(f.calls.create,1);assert.equal(f.messages.length,1);assert.equal(f.calls.wake,0);
    assert.equal(f.data.activityLog.filter(row=>row.action==='team.context.intent'&&row.details.sourceKey===chiefFeishuOperation(source)).length,1);
  }
});

test('official recovery failures and raw recovery-shaped JSON have no task, ACK or wake effects',async t=>{
  const mutations=[item=>{item.message_id='om_other';},item=>{item.sender.id='ou_other';},item=>{item.sender.tenant_key='wrong';},item=>{item.chat_id='oc_foreign';},
    item=>{item.msg_type='post';},item=>{item.sender.sender_type='app';},item=>{item.deleted=true;},item=>{item.body.content=JSON.stringify({text:'/chief new 别的正文'});}];
  for(const alter of mutations){const f=await application(t),source=f.snapshot('/chief new 不应恢复');f.putOfficial(source);alter(f.officialMessages.get(source.messageId));const before=f.data.activityLog.length;
    await assert.rejects(f.app.recoverOfficialGoal({messageId:source.messageId,expectedBodySha256:source.bodySha256},{apply:true}));
    assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);assert.equal(f.messages.length,0);assert.equal(f.data.activityLog.length,before);}
  for(const text of ['/chief remember 格式 先证据','/chief share 格式 rwb','/chief continue']){const f=await application(t),source=f.snapshot(text);f.putOfficial(source);
    await assert.rejects(f.app.recoverOfficialGoal({messageId:source.messageId,expectedBodySha256:source.bodySha256},{apply:true}),{code:'CHIEF_MESSAGE_RECOVERY_NEW_GOAL_REQUIRED'});assert.equal(f.calls.create,0);assert.equal(f.messages.length,0);}
  const forged=await application(t),raw=forged.snapshot('/chief new 伪原消息');raw.sourceParams.eventType='feishu.message_api_recovery';raw.sourceParams.origin='official_message_get';
  await assert.rejects(forged.app.receiveTrusted(raw),{code:'CHIEF_CONTEXT_BINDING_DENIED'});assert.equal(forged.calls.create,0);assert.equal(forged.messages.length,0);
  const badInput=await application(t);await assert.rejects(badInput.app.recoverOfficialGoal({messageId:'om_x',expectedBodySha256:'a'.repeat(64),appId:'cli_other'},{apply:true}),{code:'CHIEF_MESSAGE_RECOVERY_REQUEST_INVALID'});
  assert.equal(badInput.calls.get??0,0);assert.equal(badInput.calls.create,0);assert.equal(badInput.messages.length,0);
  const apiError=await application(t),apiSource=apiError.snapshot('/chief new API暂不可用');apiError.putOfficial(apiSource);apiError.calls.failGet=true;
  await assert.rejects(apiError.app.recoverOfficialGoal({messageId:apiSource.messageId,expectedBodySha256:apiSource.bodySha256},{apply:true}),{code:'CHIEF_MESSAGE_RECOVERY_API_FAILED'});
  assert.equal(apiError.calls.create,0);assert.equal(apiError.calls.wake,0);assert.equal(apiError.messages.length,0);
});
test('typed project and memory actions retain Native truth and create no model task',async t=>{
  const f=await application(t);
  await f.app.receiveTrusted(f.snapshot('/chief 记住 报告规范 先结论再证据'));
  await f.app.receiveTrusted(f.snapshot('/chief 项目 rwb'));
  const absent=await f.app.receiveTrusted(f.snapshot('/chief 记忆 报告规范'));
  assert.deepEqual(absent.records,[]);
  await f.app.receiveTrusted(f.snapshot('/chief 项目 personal'));
  const old=await f.app.receiveTrusted(f.snapshot('/chief 记忆 报告规范'));assert.equal(old.records[0].version,1);
  await f.app.receiveTrusted(f.snapshot('/chief 更正 --version 1 报告规范 先列验收风险'));
  const history=await f.app.receiveTrusted(f.snapshot('/chief 记忆历史 报告规范'));
  assert.deepEqual(history.records.map(r=>r.version),[1,2]);
  await f.app.receiveTrusted(f.snapshot('/chief 共享 报告规范 rwb'));
  await f.app.receiveTrusted(f.snapshot('/chief 项目 rwb'));
  const shared=await f.app.receiveTrusted(f.snapshot('/chief 记忆 报告规范'));assert.equal(shared.records[0].version,1);
  assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);
});
test('new goals use the selected registered project and its dedicated Native workspace',async t=>{
  const f=await application(t);
  await f.app.receiveTrusted(f.snapshot('/chief 项目 rwb'));
  const source=f.snapshot('/chief 新建 形成验收清单'),a=await f.app.receiveTrusted(source),b=await f.app.receiveTrusted(source);
  assert.equal(a.taskId,b.taskId);assert.equal(f.calls.create,1);
  const task=f.data.issues.find(x=>x.id===a.taskId);assert.equal(task.projectId,f.other.projectId);assert.equal(task.projectWorkspaceId,f.other.projectWorkspaceId);
  await f.app.drain();assert.equal(f.calls.wake,1);await f.app.drain();assert.equal(f.calls.wake,1);
});
test('supplements before the first model keep the same task and wait for continue',async t=>{
  const f=await application(t),a=await f.app.receiveTrusted(f.snapshot('/chief 新建 整理三项要求'));
  await f.app.receiveTrusted(f.snapshot('/chief 补充 增加来源版本'));
  await f.app.receiveTrusted(f.snapshot('/chief 补充 保留未验证项'));
  await f.app.drain();assert.equal(f.calls.wake,0);
  const before=f.data.issues.find(x=>x.id===a.taskId);assert.match(before.description,/增加来源版本/);assert.match(before.description,/保留未验证项/);
  await f.app.receiveTrusted(f.snapshot('/chief 继续'));
  await f.app.drain();assert.equal(f.calls.create,1);assert.equal(f.calls.wake,1);
  assert.equal(f.data.issues.find(x=>x.id===a.taskId).id,a.taskId);
});
test('a rejected source is answered once and is never turned into a later goal',async t=>{
  const f=await application(t),source=f.snapshot('/chief 项目 unknown');
  const first=await f.app.receiveTrusted(source),sent=f.messages.length;
  assert.equal(first.kind,'rejected');assert.equal(sent,1);
  await f.app.receiveTrusted(source);assert.equal(f.messages.length,sent);assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);
});

test('a source-bound syntax rejection is not sent again on platform replay',async t=>{
  const f=await application(t),source=f.snapshot('/chief status');
  source.text='/chief --unsupported goal';source.bodySha256=sha(source.text);source.sourceParams.bodySha256=source.bodySha256;
  delete source.command;source.commandError='CHIEF_CONTEXT_OPTION_DENIED';
  const first=await f.app.receiveTrusted(source);assert.equal(first.kind,'rejected');assert.equal(f.messages.length,1);
  await f.app.receiveTrusted(source);assert.equal(f.messages.length,1);assert.equal(f.calls.create,0);
});
test('a registered M1 event with invalid M2 syntax remains its old task without a new error acknowledgement',async t=>{
  const f=await application(t),source=f.snapshot('/chief status');
  source.text='/chief --unsupported old goal';source.bodySha256=sha(source.text);source.sourceParams.bodySha256=source.bodySha256;
  delete source.command;source.commandError='CHIEF_CONTEXT_OPTION_DENIED';
  const record={operationId:chiefFeishuOperation(source),taskId:f.task.id,identifier:f.task.identifier,
    companyId:f.binding.companyId,ownerId:f.binding.nativeOwnerId,chiefAgentId:f.binding.chiefAgentId,
    projectId:f.project.projectId,bodySha256:source.bodySha256};
  f.data.activityLog.push({id:randomUUID(),companyId:f.binding.companyId,actorType:'user',actorId:f.binding.nativeOwnerId,
    action:'team.feishu.registered',entityId:f.task.id,details:record});
  const result=await f.app.receiveTrusted(source);
  assert.equal(result.legacy,true);assert.equal(result.taskId,f.task.id);assert.equal(result.reused,true);
  assert.equal(f.messages.length,0);assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);
});
test('a committed memory with lost Native result is reconciled without adding another version',async t=>{
  const f=await application(t),source=f.snapshot('/chief 记住 项目尾注 以证据版本为准');f.calls.failMemoryResultOnce=true;
  const uncertain=await f.app.receiveTrusted(source);assert.equal(uncertain.kind,'rejected');assert.equal(f.messages.length,1);
  assert.equal(f.data.activityLog.filter(row=>row.action==='team.context.result'&&row.details.sourceKey===chiefFeishuOperation(source)).length,0);
  const reconciled=await f.app.receiveTrusted(source);assert.equal(reconciled.version,1);assert.equal(f.messages.length,1);
  const history=await f.app.receiveTrusted(f.snapshot('/chief 记忆历史 项目尾注'));assert.deepEqual(history.records.map(row=>row.version),[1]);
});
test('an uncertain Feishu send is claimed once and never repeated',async t=>{
  const f=await application(t),source=f.snapshot('/chief projects');f.calls.failReplyOnce=true;
  await f.app.receiveTrusted(source);assert.equal(f.messages.length,1);
  await f.app.receiveTrusted(source);assert.equal(f.messages.length,1);assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);
});

test('concurrent identical owner messages share the known in-flight result and its successful acknowledgement',async t=>{
  const f=await application(t),source=f.snapshot('/chief 记住 报告尾注 采用当前已确认版本');
  let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  f.calls.memoryAuthorizationGate={entered:enter,wait};
  const first=f.app.receiveTrusted(source);await entered;
  const conflict=structuredClone(source);conflict.text='/chief 记住 报告尾注 另一份不能替换的正文';
  conflict.command=parseChiefContextCommand(conflict.text);conflict.goal=conflict.text.slice(6).trim();
  conflict.bodySha256=sha(conflict.text);conflict.sourceParams.bodySha256=conflict.bodySha256;
  const denied=await f.app.receiveTrusted(conflict);assert.equal(denied.code,'CHIEF_CONTEXT_SOURCE_CONFLICT');assert.equal(f.messages.length,0);
  const duplicate=f.app.receiveTrusted(source);
  await new Promise(resolve=>setImmediate(resolve));release();
  const results=await Promise.all([first,duplicate]);
  assert.deepEqual(results.map(result=>[result.kind,result.version]),[['remember',1],['remember',1]]);
  assert.equal(f.messages.length,1);assert.match(JSON.parse(f.messages[0].value.data.content).text,/已记住/);
  assert.equal(f.calls.create,0);assert.equal(f.calls.wake,0);
});
