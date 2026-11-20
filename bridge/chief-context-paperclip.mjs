import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { createProjectCatalog } from './context-projects.mjs';
import { createProjectKnowledgeStore } from './project-knowledge-store.mjs';
import { createChiefContextController } from './chief-context-native.mjs';
import { chiefFeishuOperation } from './chief-feishu-native.mjs';
import { taskInputRevision } from './task-input.mjs';
import { ROLE_ROOT as ROOT, readControl } from './role-control-store.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const copy=x=>structuredClone(x);
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const SYSTEM='super-agent-context-m2';
const NS='team.context.';
const activeStates=['running','queued','scheduled_retry'];
const terminalStates=['succeeded','failed','cancelled','timed_out'];

/** A deployment switch does not turn an unrelated Native task into an M2 task. */
export async function readManagedChiefContext({db,schema:s,orm:o,task,companyId,ownerId}){
  if(!uuid.test(companyId??'')||!uuid.test(task?.id??'')||task.companyId!==companyId||
    task.responsibleUserId!==ownerId||typeof ownerId!=='string'||task.parentId)fail('CHIEF_CONTEXT_TASK_SCOPE_DENIED');
  const rows=await db.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,companyId),
    o.eq(s.activityLog.action,NS+'control'),o.eq(s.activityLog.entityId,task.id)));
  if(!rows.length)return null;
  for(const row of rows){
    const v=row.details?.value;
    if(!(row.actorType==='user'&&row.actorId===ownerId||row.actorType==='system'&&row.actorId===SYSTEM)||
      !Number.isSafeInteger(row.details?._eventSequence)||row.details._eventSequence<1||
      v?.schemaVersion!==1||v.managed!==true||v.companyId!==companyId||v.ownerId!==ownerId||
      v.taskId!==task.id||v.projectId!==task.projectId)fail('CHIEF_CONTEXT_CONTROL_CHANGED');
  }
  const last=rows.reduce((a,b)=>a.details._eventSequence>b.details._eventSequence?a:b);
  return Object.freeze(copy(last.details.value));
}

function noProvider(run){return run?.resultJson?.executionRecovery?.providerWorkStarted===false;}
/** Existing private call evidence; never treats an unknown lock as an empty worker. */
export function observeContextCallEvidence({task,ids,runs,root=ROOT}){
  let budgetUsed=0,unknown=false;const slots=[],settled=new Set();
  const byRun=new Map(runs.map(run=>[run.id,run]));
  const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  const directory=path.join(root,'budget',task.id);
  if(exists(directory)){
    const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))fail('CHIEF_CONTEXT_EXECUTION_EVIDENCE_DENIED');
    const files=fs.readdirSync(directory);budgetUsed=files.length;
    if(files.length>7)unknown=true;
    for(const name of files){
      if(!name.endsWith('.json')||!uuid.test(name.slice(0,-5)))fail('CHIEF_CONTEXT_EXECUTION_EVIDENCE_DENIED');
      const call=readControl(path.join(directory,name));
      if(!ids.includes(call.taskId)||call.rootTaskId&&call.rootTaskId!==task.id)fail('CHIEF_CONTEXT_EXECUTION_EVIDENCE_DENIED');
      const mapping=path.join(root,'operations',call.id+'.json');
      if(!exists(mapping)){unknown=true;continue;}
      const operation=readControl(mapping),run=byRun.get(operation.runId);
      if(operation.operationId!==call.id||operation.taskId!==call.taskId||!run||run.issueId!==call.taskId||run.agentId!==call.agentId)unknown=true;
      else slots.push({call,run});
    }
  }
  // PR30 archives only after its Native retry/transport admission has succeeded.
  // Observe that existing proof; this path never wakes a retry or releases a lock.
  function settledFailure({call,run}){
    if(run.status!=='failed'||call.kind!=='run'||call.role==='chief'||call.phase!=='work'||call.projectId!==task.projectId||
      run.companyId!==task.companyId||!Number.isFinite(Date.parse(run.finishedAt))||!Number.isInteger(run.exitCode)||run.exitCode===0)return false;
    const successor=runs.find(next=>next.retryOfRunId===run.id&&next.companyId===run.companyId&&next.issueId===run.issueId&&next.agentId===run.agentId&&
      next.scheduledRetryAttempt===(run.scheduledRetryAttempt??0)+1&&next.scheduledRetryAttempt<=2&&
      (noProvider(next)||slots.some(slot=>slot.run.id===next.id&&slot.call.acceptedRunId===next.id&&slot.call.retryOfRunId===run.id&&
        slot.call.retryOfOperationId===call.id))&&
      (activeStates.includes(next.status)||next.status==='succeeded'||noProvider(next)||settled.has(next.id)));
    if(!successor)return false;
    const archive=path.join(root,'team/native-retries',run.id),receiptFile=path.join(archive,'receipt.json'),lockFile=path.join(archive,'call.lock.json');
    const transport=path.join(root,'transport',run.id),resultFile=path.join(transport,'result.json');
    if(![receiptFile,lockFile,resultFile,path.join(transport,'stdout'),path.join(transport,'stderr')].every(exists))return false;
    const receipt=readControl(receiptFile),lock=readControl(lockFile),result=readControl(resultFile);
    if(receipt.parentRunId!==run.id||receipt.operationId!==call.id||receipt.taskId!==call.taskId||receipt.directory!==archive||receipt.lockFile!==lockFile||
      lock.operationId!==call.id||lock.taskId!==call.taskId||fs.lstatSync(receiptFile).mode&0o222||fs.lstatSync(lockFile).mode&0o222||
      result.runId!==run.id||result.exitCode!==run.exitCode||result.signal!==null||result.cancelled!==false||result.outputUnknown!==false||result.timedOut!==false)return false;
    const fileHash=file=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>8*1024*1024)fail('CHIEF_CONTEXT_EXECUTION_EVIDENCE_DENIED');return createHash('sha256').update(fs.readFileSync(file)).digest('hex');};
    return fileHash(lockFile)===receipt.lockSha256&&fileHash(path.join(transport,'stdout'))===result.stdoutSha256&&fileHash(path.join(transport,'stderr'))===result.stderrSha256;
  }
  for(let attempt=0;attempt<2;attempt++)for(const slot of slots)if(settledFailure(slot))settled.add(slot.run.id);
  if(slots.some(({run})=>!activeStates.includes(run.status)&&run.status!=='succeeded'&&!noProvider(run)&&!settled.has(run.id)))unknown=true;
  const lock=path.join(root,'call.lock');
  if(exists(lock)){
    const value=readControl(lock);
    if(ids.includes(value.taskId)&&!runs.some(run=>activeStates.includes(run.status)))unknown=true;
  }
  return {budgetUsed,unknown,settledFailedRunIds:[...settled]};
}

function existingContextOperation({taskId,operationId}){
  const file=path.join(ROOT,'operations',operationId+'.json');
  try{
    fs.lstatSync(file);const value=readControl(file);
    if(value.operationId!==operationId||value.taskId!==taskId)fail('CHIEF_CONTEXT_OPERATION_SCOPE_DENIED');
    return {runId:value.runId};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const registry=readControl(ROOT+'/registry.json');
  const operation=registry.operations?.find(value=>value.id===operationId);
  if(!operation)return null;
  if(operation.taskId!==taskId||operation.role!=='chief')fail('CHIEF_CONTEXT_OPERATION_SCOPE_DENIED');
  return {registered:true};
}

/** Native activity is an event/association ledger; Native issues remain task truth. */
export async function createChiefContextPaperclipRepository({database,binding,catalog,log,
  loadServices=async P=>({...await import(P+'issues.js'),...await import(P+'activity-log.js')}),
  observeLocalExecution=observeContextCallEvidence,observeLocalOperation=existingContextOperation}={}){
  if(typeof database!=='function'||!binding||!catalog||typeof log!=='function'||typeof observeLocalExecution!=='function'||typeof observeLocalOperation!=='function')fail('CHIEF_CONTEXT_REPOSITORY_INVALID');
  const {db,schema:s,orm:o}=await database();
  const {issueService,logActivity,publishActivity}=await loadServices('/opt/paperclip/node_modules/@paperclipai/server/dist/services/');
  const companyId=binding.companyId,ownerId=binding.nativeOwnerId;
  if(!uuid.test(companyId??'')||typeof ownerId!=='string'||!s.activityLog||!s.issues||!s.heartbeatRuns||
     typeof db?.transaction!=='function'||![issueService,logActivity,publishActivity].every(f=>typeof f==='function'))fail('CHIEF_CONTEXT_REPOSITORY_INVALID');
  const allowedActor=row=>row.actorType==='user'&&row.actorId===ownerId||row.actorType==='system'&&row.actorId===SYSTEM;
  // Literal JSON keys keep the exact pinned ORM contract and its parameter binding.
  const sourceCondition=key=>o.sql`${s.activityLog.details}->>'sourceKey' = ${key}`;
  const operationCondition=id=>o.sql`${s.activityLog.details}->>'operationId' = ${id}`;
  async function activities(tx,kind,condition){
    const rows=await tx.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,companyId),o.eq(s.activityLog.action,NS+kind),condition));
    for(const row of rows)if(!allowedActor(row)||!object(row.details))fail('CHIEF_CONTEXT_NATIVE_EVENT_DENIED');
    return rows;
  }
  function latest(rows,field){
    const sorted=rows.map(row=>row.details).sort((a,b)=>(a._eventSequence??0)-(b._eventSequence??0));
    const last=sorted.at(-1);return last?copy(field?last[field]:last):null;
  }
  async function makePort(tx,key,publications,options){
    const readonly=Boolean(options.db),actor=options.actor==='controller'?{actorType:'system',actorId:SYSTEM}:{actorType:'user',actorId:ownerId};
    const cached=new Map();
    function writable(){if(readonly)fail('CHIEF_CONTEXT_TRANSACTION_READ_ONLY');}
    async function task(reference){
      const api=issueService(tx),found=await api.getById(reference);
      if(!found)return null;
      if(found.companyId!==companyId||found.responsibleUserId!==ownerId)fail('CHIEF_CONTEXT_TASK_SCOPE_DENIED');
      const locked=await api.getByIdForUpdate(found.id,tx);if(!locked) return null;
      const value={...found,...locked};
      if(!uuid.test(value.projectId??''))fail('CHIEF_CONTEXT_TASK_SCOPE_DENIED');
      catalog.resolve({projectId:value.projectId,companyId:value.companyId,ownerId});
      if(value.responsibleUserId!==ownerId)fail('CHIEF_CONTEXT_TASK_SCOPE_DENIED');cached.set(value.id,value);return copy(value);
    }
    async function put(kind,record,{entityType,entityId}={}){
      writable();
      if(!/^[a-z][a-z0-9_]{0,63}$/.test(kind)||!object(record)||record.sourceKey!==undefined&&record.sourceKey!==key)fail('CHIEF_CONTEXT_EVENT_INVALID');
      const details={...copy(record),sourceKey:key};
      const id=entityId??record.taskId??record.project?.projectId??binding.projectId;
      await logActivity(tx,{companyId,...actor,action:NS+kind,entityType:entityType??(record.taskId?'issue':'project'),entityId:id,details},publications);
    }
    async function readState(kind){
      const rows=await activities(tx,kind,sourceCondition(key));
      if(rows.length>1)fail('CHIEF_CONTEXT_NATIVE_EVENT_CONFLICT');
      return rows[0]?copy(rows[0].details):null;
    }
    const port={
      readState,
      async append(kind,record){
        await put(kind,record);
      },
      async readLegacyRegistration(snapshot){
        const operationId=chiefFeishuOperation(snapshot);
        const rows=await tx.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,companyId),o.eq(s.activityLog.action,'team.feishu.registered'),operationCondition(operationId)));
        if(rows.length>1)fail('CHIEF_CONTEXT_NATIVE_EVENT_CONFLICT');
        const value=rows[0]?.details;if(!value)return null;
        if(rows[0].actorType!=='user'||rows[0].actorId!==ownerId||value.companyId!==companyId||value.ownerId!==ownerId||
           value.chiefAgentId!==binding.chiefAgentId||value.bodySha256!==snapshot.bodySha256)fail('CHIEF_CONTEXT_SOURCE_CONFLICT');
        return copy(value);
      },
      async readChat(){
        if(!options.chatId)return null;
        const rows=await activities(tx,'chat',o.sql`${s.activityLog.details}->>'chatId' = ${options.chatId}`);
        const value=latest(rows,'value');
        if(value&&(value.companyId!==companyId||value.ownerId!==ownerId||value.chatId!==options.chatId))fail('CHIEF_CONTEXT_CHAT_CHANGED');
        return value;
      },
      async writeChat(value){
        writable();if(value?.companyId!==companyId||value.ownerId!==ownerId||value.chatId!==options.chatId)fail('CHIEF_CONTEXT_CHAT_CHANGED');
        catalog.resolve({companyId,ownerId,projectId:value.projectId});
        const rows=await activities(tx,'chat',o.sql`${s.activityLog.details}->>'chatId' = ${options.chatId}`);
        const sequence=rows.reduce((n,r)=>Math.max(n,r.details._eventSequence??0),0)+1;
        await put('chat',{chatId:options.chatId,_eventSequence:sequence,value:copy(value)},{entityType:'project',entityId:value.projectId});
      },
      readTask:task,
      async readControl(taskId){
        const actual=cached.get(taskId)??await task(taskId);if(!actual)return null;
        const rows=await activities(tx,'control',o.eq(s.activityLog.entityId,taskId));
        const value=latest(rows,'value');
        if(value&&(value.taskId!==taskId||value.companyId!==companyId||value.projectId!==actual.projectId||value.ownerId!==ownerId))fail('CHIEF_CONTEXT_CONTROL_CHANGED');
        return value;
      },
      async writeControl(taskId,value){
        writable();const actual=cached.get(taskId)??await task(taskId);
        if(!actual||value?.schemaVersion!==1||value.taskId!==taskId||value.companyId!==companyId||value.ownerId!==ownerId||
           value.projectId!==actual.projectId||value.inputRevision!==taskInputRevision(actual))fail('CHIEF_CONTEXT_CONTROL_CHANGED');
        const project=catalog.forNativeTask(actual,{ownerId});
        if(project.projectWorkspaceId!==undefined&&value.projectWorkspaceId!==project.projectWorkspaceId)fail('CHIEF_CONTEXT_CONTROL_CHANGED');
        const rows=await activities(tx,'control',o.eq(s.activityLog.entityId,taskId));
        const sequence=rows.reduce((n,r)=>Math.max(n,r.details._eventSequence??0),0)+1;
        await put('control',{taskId,_eventSequence:sequence,value:copy(value)},{entityType:'issue',entityId:taskId});
      },
      async readRun(runId){
        const [run]=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,runId));
        return run?.companyId===companyId?copy(run):null;
      },
      async readOperationRun({taskId,operationId}){
        if(!uuid.test(taskId??'')||!uuid.test(operationId??''))fail('CHIEF_CONTEXT_OPERATION_SCOPE_DENIED');
        const actual=cached.get(taskId)??await task(taskId);if(!actual||actual.parentId)fail('CHIEF_CONTEXT_TASK_SCOPE_DENIED');
        const rows=await tx.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.companyId,companyId),o.eq(s.heartbeatRuns.issueId,taskId),
          o.sql`${s.heartbeatRuns.contextSnapshot}->>'roleOperationId' = ${operationId}`));
        const local=await observeLocalOperation({taskId,operationId});
        const matches=local?.runId?rows.filter(run=>run.id===local.runId):rows;
        if(matches.length>1)fail('CHIEF_CONTEXT_OPERATION_RECONCILIATION_REQUIRED');
        if(matches[0]){
          if(matches[0].agentId!==binding.chiefAgentId)fail('CHIEF_CONTEXT_OPERATION_SCOPE_DENIED');
          return copy(matches[0]);
        }
        const control=await port.readControl(taskId);
        if(local||control?.resumeClaim?.operationId===operationId)fail('CHIEF_CONTEXT_OPERATION_RECONCILIATION_REQUIRED');
        return null;
      },
      async readExecution(taskId){
        const actual=cached.get(taskId)??await task(taskId);if(!actual)fail('CHIEF_CONTEXT_TASK_NOT_FOUND');
        const children=await tx.select().from(s.issues).where(o.and(o.eq(s.issues.companyId,companyId),o.eq(s.issues.parentId,taskId))).limit(129);
        if(children.length>128)fail('CHIEF_CONTEXT_EXECUTION_LIMIT');
        const ids=[taskId,...children.map(row=>row.id)];
        const runs=await tx.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.companyId,companyId),o.inArray(s.heartbeatRuns.issueId,ids))).limit(257);
        if(runs.length>256)fail('CHIEF_CONTEXT_EXECUTION_LIMIT');
        const local=await observeLocalExecution({task:actual,ids,runs});
        const settled=new Set(local.settledFailedRunIds??[]);
        return {active:runs.some(run=>activeStates.includes(run.status)),unknown:local.unknown===true||runs.some(run=>!activeStates.includes(run.status)&&run.status!=='succeeded'&&!noProvider(run)&&!settled.has(run.id)),
          started:runs.length>0,budgetUsed:local.budgetUsed,settledFailedRunIds:[...settled]};
      },
      async updateTask(taskId,patch){
        writable();
        if(!object(patch)||Object.keys(patch).some(key=>!['description','status','assigneeUserId','assigneeAgentId'].includes(key))||
           patch.status!==undefined&&patch.status!=='in_review'||patch.assigneeUserId!==undefined&&patch.assigneeUserId!==ownerId||
           patch.assigneeAgentId!==undefined&&patch.assigneeAgentId!==null)fail('CHIEF_CONTEXT_PATCH_DENIED');
        const before=cached.get(taskId)??await task(taskId);if(!before||before.parentId)fail('CHIEF_CONTEXT_TASK_SCOPE_DENIED');
        const changed=await issueService(tx).update(taskId,{...patch,companyGuard:companyId,actorUserId:ownerId,updatedByUserId:ownerId},tx,publications,[]);
        if(!changed||changed.id!==taskId||changed.companyId!==companyId||changed.projectId!==before.projectId||changed.responsibleUserId!==ownerId)fail('CHIEF_CONTEXT_TASK_UPDATE_UNKNOWN');
        cached.set(taskId,{...before,...changed});return copy(cached.get(taskId));
      },
      async addOwnerComment(taskId,{text,sourceKey,revision}){
        writable();const actual=cached.get(taskId)??await task(taskId);if(!actual||sourceKey!==key||!Number.isSafeInteger(revision))fail('CHIEF_CONTEXT_COMMENT_DENIED');
        return issueService(tx).addComment(taskId,text,{userId:ownerId},{clientRequestId:'chief-context:'+sourceKey,mirrorToSlack:false},tx);
      },
      async supersedeChildren({rootTaskId,previousInputRevision,newInputRevision,children}){
        writable();const rootTask=cached.get(rootTaskId)??await task(rootTaskId);
        if(!rootTask||taskInputRevision(rootTask)!==previousInputRevision||!digest.test(newInputRevision)||!Array.isArray(children))fail('CHIEF_CONTEXT_CHILD_SCOPE_CHANGED');
        const execution=await port.readExecution(rootTaskId);if(execution.active||execution.unknown)fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
        const settled=new Set(execution.settledFailedRunIds??[]);
        for(const ref of children){
          const id=ref.taskId??ref.id,child=await task(id);
          if(!child||child.parentId!==rootTaskId||child.projectId!==rootTask.projectId||child.createdByAgentId!==binding.chiefAgentId||
             ref.inputRevision&&taskInputRevision(child)!==ref.inputRevision)fail('CHIEF_CONTEXT_CHILD_SCOPE_CHANGED');
          const runs=await tx.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.companyId,companyId),o.eq(s.heartbeatRuns.issueId,id)));
          if(runs.some(run=>!terminalStates.includes(run.status)||run.status!=='succeeded'&&!noProvider(run)&&!settled.has(run.id)))fail('CHIEF_CONTEXT_RECONCILIATION_REQUIRED');
          await put('superseded_child',{taskId:id,rootTaskId,previousInputRevision,newInputRevision},{entityType:'issue',entityId:id});
          if(child.status==='todo'&&runs.length===0)await issueService(tx).update(id,{status:'cancelled',companyGuard:companyId},tx,publications,[]);
        }
      },
    };
    return port;
  }
  const repository={
    /** Only an earlier authenticated SDK registration can bind the owner's P2P chat. */
    async ownerFeishuChatIds(){
      try{
        const rows=await db.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.companyId,companyId),
          o.eq(s.activityLog.action,'team.feishu.registered'),o.eq(s.activityLog.actorType,'user'),o.eq(s.activityLog.actorId,ownerId)));
        const chats=new Set();
        for(const row of rows){
          const value=row.details,p=value?.sourceParams;
          if(value?.companyId!==companyId||value.ownerId!==ownerId||value.chiefAgentId!==binding.chiefAgentId||
            p?.source!=='feishu'||p.eventType!=='im.message.receive_v1'||p.appId!==binding.appId||
            p.tenantKey!==binding.tenantKey||p.ownerOpenId!==binding.ownerOpenId||
            !/^om_[A-Za-z0-9]+$/.test(p.messageId??'')||!/^oc_[A-Za-z0-9]+$/.test(p.chatId??'')||
            !digest.test(p.bodySha256??'')||p.bodySha256!==value.bodySha256)continue;
          chats.add(p.chatId);
        }
        return Object.freeze([...chats].sort());
      }catch(error){await log({code:'CHIEF_CONTEXT_OWNER_CHAT_READ_FAILED'});throw error;}
    },
    async transaction(key,fn,options={}){
      if(typeof key!=='string'||!/^[a-zA-Z0-9:_-]{1,220}$/.test(key)||typeof fn!=='function')fail('CHIEF_CONTEXT_TRANSACTION_INVALID');
      if(options.db)return fn(await makePort(options.db,key,[],options));
      const publications=[];
      try{
        const result=await db.transaction(async tx=>{
          if(options.chatId)await tx.execute(o.sql`select pg_advisory_xact_lock(hashtext(${companyId}),hashtext(${ownerId+':'+options.chatId}))`);
          await tx.execute(o.sql`select pg_advisory_xact_lock(hashtext(${companyId}),hashtext(${key}))`);
          if(options.taskId)await issueService(tx).getByIdForUpdate(options.taskId,tx);
          return fn(await makePort(tx,key,publications,options));
        });
        for(const value of publications)publishActivity(value);
        return result;
      }catch(error){await log({code:/^(?:CHIEF_CONTEXT|CONTEXT_PROJECT)_[A-Z_]+$/.test(error?.code??'')?error.code:'CHIEF_CONTEXT_NATIVE_TRANSACTION_FAILED',sourceKey:key});throw error;}
    },
    async authorizeKnowledgeRequest(request){
      if(!uuid.test(request?.operationId??''))return false;
      const rows=await activities(db,'intent',operationCondition(request.operationId));
      if(rows.length!==1||rows[0].actorType!=='user'||rows[0].actorId!==ownerId)return false;
      const intent=rows[0].details,w=intent.writeRequest;
      if(!w||!['remember','correct','share'].includes(intent.kind))return false;
      try{const project=catalog.resolve({companyId,ownerId,projectId:w.scope?.projectId});if(w.scope.projectKey!==project.key)return false;}catch{return false;}
      if(intent.sourceParams?.appId!==binding.appId||intent.sourceParams?.tenantKey!==binding.tenantKey||intent.sourceParams?.ownerOpenId!==binding.ownerOpenId)return false;
      const action=intent.kind==='correct'?'correct':'remember';
      const expected={action,scope:w.scope,id:w.id,kind:action==='correct'?null:w.kind,visibility:w.visibility,role:w.visibility==='private'?w.role:null,
        text:w.text,condition:w.condition,source:{messageId:w.source.messageId,chatId:w.source.chatId,bodySha256:w.source.bodySha256,
          ...(w.source.eventId!==undefined&&{eventId:w.source.eventId}),createdAt:new Date(w.source.createdAt).toISOString()},operationId:w.operationId,expectedVersion:action==='correct'?w.expectedVersion:null};
      return intent.bodySha256===w.source.bodySha256&&isDeepStrictEqual(request,expected);
    },
    createGoalHooks({getRegistry,getController}={}){
      if(typeof getRegistry!=='function'||typeof getController!=='function')fail('CHIEF_CONTEXT_REPOSITORY_INVALID');
      return Object.freeze({
        async beforeTransaction({tx,operationId}){
          const rows=await activities(tx,'intent',sourceCondition(operationId));
          if(rows.length!==1)fail('CHIEF_CONTEXT_INTENT_REQUIRED');
          const intent=rows[0].details;
          if(rows[0].actorType!=='user'||rows[0].actorId!==ownerId||!['new','followup'].includes(intent.kind)||!uuid.test(intent.operationId??''))fail('CHIEF_CONTEXT_INTENT_REQUIRED');
          await tx.execute(o.sql`select pg_advisory_xact_lock(hashtext(${companyId}),hashtext(${ownerId+':'+intent.chatId}))`);
          const project=catalog.resolve({companyId,ownerId,projectId:intent.project?.projectId});
          const port=await makePort(tx,operationId,[],{chatId:intent.chatId,actor:'owner'});
          const registered=await port.readState('registered');
          if(!registered&&intent.continuationOf){
            const predecessor=await port.readTask(intent.continuationOf),execution=predecessor&&await port.readExecution(predecessor.id);
            if(!predecessor||predecessor.parentId||predecessor.status!=='done'||predecessor.projectId!==project.projectId||
               taskInputRevision(predecessor)!==intent.baseInputRevision||execution.active||execution.unknown)fail('CHIEF_CONTEXT_FOLLOWUP_DENIED');
          }
          return {project,intent};
        },
        async onRegistered({tx,record,task,message,contextState,publications}){
          const {project,intent}=contextState??{};
          if(!task||!project||!intent||record.taskId!==task.id||task.parentId||task.projectId!==project.projectId||
             message.contextIntentOperationId!==intent.operationId||record.bodySha256!==intent.bodySha256)fail('CHIEF_CONTEXT_REGISTRATION_BINDING_DENIED');
          catalog.forNativeTask(task,{ownerId});
          const port=await makePort(tx,record.operationId,publications,{chatId:intent.chatId,actor:'owner'});
          const control={schemaVersion:1,managed:true,companyId,ownerId,projectId:project.projectId,taskId:task.id,
            ...(project.projectWorkspaceId&&{projectWorkspaceId:project.projectWorkspaceId}),
            chatId:intent.chatId,sourceKey:intent.sourceKey,sourceMessageId:intent.source.messageId,initialOperationId:intent.operationId,
            inputRevision:taskInputRevision(task),revision:0,inputSequence:0,pendingInputs:[],reviewBeforeDispatch:intent.reviewBeforeDispatch===true,
            approvedPlanSha256:null,plan:null,pauseRequested:false,resumeOperationId:null,resumeClaim:null,
            continuationOf:intent.continuationOf??null,checkpoints:[]};
          await port.writeControl(task.id,control);
          const chat=await port.readChat();if(!chat)fail('CHIEF_CONTEXT_CHAT_CHANGED');
          const value=copy(chat);
          if(value.projectGoalOperations?.[project.projectId]===intent.operationId)value.projectTasks={...value.projectTasks,[project.projectId]:task.id};
          if(value.pendingGoalOperationId===intent.operationId&&value.projectId===project.projectId){value.taskId=task.id;value.pendingGoalOperationId=null;}
          if(!isDeepStrictEqual(value,chat))await port.writeChat(value);
          await port.append('registered',{schemaVersion:1,sourceKey:intent.sourceKey,operationId:intent.operationId,taskId:task.id,identifier:task.identifier,
            projectId:project.projectId,...(project.projectWorkspaceId&&{projectWorkspaceId:project.projectWorkspaceId}),inputRevision:control.inputRevision});
        },
        async filterRegistrations(records){
          const rows=await activities(db,'registered',o.sql`true`),known=new Set(rows.map(row=>row.details.sourceKey));
          const result=[];
          for(const record of records){
            if(!known.has(record.operationId)||record.ownerId!==ownerId||record.companyId!==companyId)continue;
            try{catalog.resolve({companyId,ownerId,projectId:record.projectId});}catch{continue;}
            const task=await issueService(db).getById(record.taskId);if(!task)continue;
            const flowFile=path.join(ROOT,'team','workflows',task.id+'.json');
            if(!fs.existsSync(flowFile)){
              const controller=getController();
              if(controller)await controller.syncTask({registry:getRegistry(),task});
            }
            result.push(record);
          }
          return result;
        },
        async prepareWake({tx,entry,publications}){
          const port=await makePort(tx,entry.operationId,publications,{actor:'controller'}),task=await port.readTask(entry.taskId);
          if(!task)return null;
          let control=await port.readControl(task.id);if(!control?.managed||control.pendingInputs?.length||control.pauseRequested)return null;
          if(['done','cancelled'].includes(task.status))return null;
          const execution=await port.readExecution(task.id);if(execution.active||execution.unknown)return null;
          let actual=task;
          if(task.status!=='todo'||task.assigneeAgentId!==binding.chiefAgentId){
            if(execution.started||!control.resumeOperationId)return null;
            const resume=control.resumeOperationId;
            actual=await issueService(tx).update(task.id,{status:'todo',assigneeAgentId:binding.chiefAgentId,assigneeUserId:null,companyGuard:companyId},tx,publications,[]);
            if(!actual||actual.projectId!==entry.projectId||actual.responsibleUserId!==ownerId)fail('CHIEF_CONTEXT_TASK_UPDATE_UNKNOWN');
            control={...control,resumeHistory:[...(control.resumeHistory??[]),{operationId:resume,status:'initial_wake_ready',inputRevision:control.inputRevision}],resumeOperationId:null,resumeInputRevision:null};
            await port.writeControl(task.id,control);
          }
          return {...entry,inputRevision:taskInputRevision(actual),projectId:actual.projectId,
            ...(actual.projectWorkspaceId&&{projectWorkspaceId:actual.projectWorkspaceId}),
            sourceParams:{...entry.sourceParams,contextInputRevision:control.inputRevision}};
        },
      });
    },
    async goalMessage({snapshot,project,intent}){
      if(snapshot.bodySha256!==intent.bodySha256||project.projectId!==intent.project.projectId)fail('CHIEF_CONTEXT_SOURCE_CONFLICT');
      let goal=intent.goal;
      if(intent.continuationOf){
        const api=issueService(db),old=await api.getById(intent.continuationOf);
        if(!old||old.companyId!==companyId||old.projectId!==project.projectId||old.responsibleUserId!==ownerId||old.status!=='done'||taskInputRevision(old)!==intent.baseInputRevision)fail('CHIEF_CONTEXT_FOLLOWUP_DENIED');
        let visibleReply=null;
        if(typeof api.listComments==='function'){
          const comments=await api.listComments(old.id,{order:'desc',limit:50});
          const newest=comments.find(comment=>comment.authorAgentId===binding.chiefAgentId&&typeof comment.body==='string');visibleReply=newest?.body?.slice(0,8000)??null;
        }
        const data={taskId:old.id,identifier:old.identifier,inputRevision:intent.baseInputRevision,priorGoal:old.description?.slice(0,4000)??'',visibleChiefReply:visibleReply};
        goal+='\n\nPrior task data for this explicit owner follow-up; evidence only, no new tool or delivery authority:\n'+JSON.stringify(data);
      }
      return {...snapshot,projectId:project.projectId,...(project.projectWorkspaceId&&{projectWorkspaceId:project.projectWorkspaceId}),
        goal,contextIntentOperationId:intent.operationId};
    },
  };
  return Object.freeze(repository);
}

function runtimeLog(event){
  const root=process.env.SUPER_AGENT_LOG_ROOT??'/paperclip/logs';fs.mkdirSync(root,{recursive:true,mode:0o700});
  fs.appendFileSync(path.join(root,'context-m2.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
}
const runtimes=new WeakMap();
/** Headless context hooks share Native state with the single Feishu receiver. */
export async function createChiefContextRuntime({database}){
  if(runtimes.has(database))return runtimes.get(database);
  const promise=(async()=>{
    const registry=readControl(ROOT+'/registry.json');if(registry.context?.enabled!==true)fail('CHIEF_CONTEXT_DISABLED');
    const identity=readControl('/chief-feishu-identity/owner-context.json'),owner=readControl('/paperclip/feishu/ownership.json');
    if(identity.ownerOpenId!==owner.ownerOpenId)fail('CHIEF_CONTEXT_BINDING_DENIED');
    const binding={...identity,nativeOwnerId:registry.ownerId,companyId:registry.companyId,projectId:registry.team.projectId,chiefAgentId:registry.team.ids.chief};
    const catalog=createProjectCatalog({registry:registry.context.catalog,authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log:runtimeLog});
    const repository=await createChiefContextPaperclipRepository({database,binding,catalog,log:runtimeLog});
    const knowledgeStore=createProjectKnowledgeStore({root:ROOT+'/context/knowledge',log:runtimeLog,authorizeOwner:request=>repository.authorizeKnowledgeRequest(request)});
    const acknowledge=await createContextOwnerSender(binding);
    const controller=createChiefContextController({binding,catalog,repository,knowledgeStore,acknowledge,log:runtimeLog,
      registerNewGoal:async()=>fail('CHIEF_CONTEXT_INTAKE_REQUIRED')});
    return Object.freeze({syncTask:controller.syncTask,checkpoint:controller.checkpoint});
  })();
  runtimes.set(database,promise);
  try{return await promise;}catch(error){runtimes.delete(database);runtimeLog({code:error?.code??'CHIEF_CONTEXT_RUNTIME_FAILED'});throw error;}
}

export async function createContextOwnerSender(binding){
  const credentials=readControl('/paperclip/feishu/feishu.json');if(credentials.appId!==binding.appId)fail('CHIEF_CONTEXT_BINDING_DENIED');
  const require=createRequire('/opt/super-agent/bridge-dependencies/package.json');
  if(require('@larksuiteoapi/node-sdk/package.json').version!=='1.76.0')fail('CHIEF_CONTEXT_SDK_VERSION_DENIED');
  const sdk=require('@larksuiteoapi/node-sdk'),noop=()=>{};
  const client=new sdk.Client({...credentials,logger:{error:noop,warn:noop,info:noop,debug:noop,trace:noop}});
  return contextOwnerSenderFromClient({client,binding});
}

export function contextOwnerSenderFromClient({client,binding}){
  if(typeof client?.im?.message?.create!=='function'||!/^ou_[A-Za-z0-9]+$/.test(binding?.ownerOpenId??''))fail('CHIEF_CONTEXT_REPLY_INVALID');
  return async value=>{
    const text=value.replyText;if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>32768||
      value.ownerOpenId!==undefined&&value.ownerOpenId!==binding.ownerOpenId)fail('CHIEF_CONTEXT_REPLY_INVALID');
    const k=hash(['context-owner-reply',value.sourceKey??value.operationId,value.kind,value.taskId??null]);
    const nonce=k.slice(0,8)+'-'+k.slice(8,12)+'-4'+k.slice(13,16)+'-8'+k.slice(17,20)+'-'+k.slice(20,32);
    const response=await client.im.message.create({params:{receive_id_type:'open_id'},data:{receive_id:binding.ownerOpenId,msg_type:'text',content:JSON.stringify({text}),uuid:nonce}});
    if(response.code!==0||!/^om_[A-Za-z0-9]+$/.test(response.data?.message_id??''))fail('CHIEF_CONTEXT_ACK_UNKNOWN');
    return {messageId:response.data.message_id};
  };
}
