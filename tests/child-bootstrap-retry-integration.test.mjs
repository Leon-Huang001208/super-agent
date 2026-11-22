import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {bindNativeRetryAttempt} from '../bridge/team-native-runtime.mjs';
import {teamRoleAdmissionFailure} from '../bridge/chief-bootstrap-retry.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {AdmissionMeter} from '../bridge/admission.mjs';

const P='/opt/paperclip/node_modules',R='/paperclip/control/research-pm';
const available=process.env.SUPER_AGENT_NATIVE_RETRY_FIXTURE==='true'&&fs.existsSync(P+'/@paperclipai/server/dist/services/execution-recovery-resolution.js');

// This test runs only in the existing App image with a dedicated /paperclip tmpfs.
// The Native validator is real; its database is an explicit, read-only fixture port.
test('actual retry binder resolves ordinary Native CWD and validates the settled preflight chain through the installed Native service',{skip:!available},async()=>{
 assert.equal(fs.existsSync(R),false,'the fixture must never use an existing control tree');
 const schema=await import(P+'/@paperclipai/db/dist/index.js'),orm=await import(P+'/drizzle-orm/index.js');
 const {PgDialect}=await import(P+'/drizzle-orm/pg-core/index.js'),dialect=new PgDialect();
 const companyId=randomUUID(),projectId=randomUUID(),chiefId=randomUUID(),agentId=randomUUID(),rootId=randomUUID(),taskId=randomUUID(),operationId=randomUUID();
 const rootTask={id:rootId,companyId,projectId,title:'Original batch',description:'Repair existing documentation',status:'in_review',responsibleUserId:'owner',assigneeUserId:'owner',assigneeAgentId:null,executionRunId:null,checkoutRunId:null};
 const task={id:taskId,companyId,projectId,parentId:rootId,title:'Document fix',description:'Same QA findings',status:'in_progress',responsibleUserId:'owner',assigneeAgentId:agentId,assigneeUserId:null};
 const operation={id:operationId,kind:'run',role:'document-specialist',phase:'work',agentId,taskId,rootTaskId:rootId,projectId,inputRevision:taskInputRevision(task),rootInputRevision:taskInputRevision(rootTask),outputFile:'document-fix-r1.md'};
 const registry={enabled:true,companyId,ownerId:'owner',team:{enabled:true,projectId,ids:{chief:chiefId,'document-specialist':agentId}},agents:[{profile:{role:'chief',agentId:chiefId}},{profile:{role:'document-specialist',agentId}}],operations:[operation],tasks:[rootId,taskId],taskRoots:{[rootId]:rootId,[taskId]:rootId},lease:{taskId,projectId,operationId,nonce:'a'.repeat(64)}};
 const flow={rootTaskId:rootId,projectId,inputRevision:operation.rootInputRevision,taskEntries:[{id:taskId,key:'documents',role:operation.role,agentId,outputFile:operation.outputFile}],dispatches:{documents:{operationId,taskId,inputRevision:operation.inputRevision,leaseNonce:registry.lease.nonce}},artifacts:{}};
 const wakeup={id:randomUUID(),companyId,agentId,requestedByActorType:'agent',requestedByActorId:chiefId,payload:{issueId:taskId}};
 const context={issueId:taskId,taskId,projectId,responsibleUserId:'owner',inputRevision:operation.inputRevision,roleOperationId:operationId};
 const initial={id:randomUUID(),companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'failed',exitCode:1,errorCode:'NATIVE_ROLE_PRIVATE_FILE_DENIED',resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}},scheduledRetryAttempt:0,wakeupRequestId:wakeup.id,finishedAt:new Date('2026-11-22T03:24:58.153Z'),contextSnapshot:{...context}};
 wakeup.runId=initial.id;
 const parent={...initial,id:randomUUID(),retryOfRunId:initial.id,scheduledRetryAttempt:1,signal:null,errorCode:'TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_EVIDENCE_UNAVAILABLE',error:'The controlled Native intake or retry did not admit this execution.',resultJson:{executionRecovery:{kind:'reconciliation',providerWorkStarted:null},stopReason:'adapter_failed',timeoutFired:false,configFreshness:{session:{taskSessionAvailable:false,taskSessionReused:false}}},stdoutExcerpt:'',stderrExcerpt:'',logBytes:0,logSha256:createHash('sha256').update('').digest('hex'),nativeSessionId:null,sessionIdBefore:null,sessionIdAfter:null,processPid:null,processGroupId:null,finishedAt:new Date('2026-11-22T04:07:23.678Z')};
 const current={...initial,id:randomUUID(),status:'running',exitCode:null,errorCode:null,finishedAt:null,retryOfRunId:parent.id,scheduledRetryAttempt:2,resultJson:null};
 const prior={...initial,id:randomUUID(),status:'succeeded',errorCode:null,exitCode:0,contextSnapshot:{...context,roleOperationId:randomUUID()}};
 let rows=[prior,initial,parent,current],mode='second';const queries=[];
 const leases=[prior,initial,parent].map(run=>({heartbeatRunId:run.id,companyId,status:'released',releasedAt:new Date('2026-11-22T04:07:24Z'),cleanupStatus:null}));
 const clone=value=>structuredClone(value);
 function select(selection){let table,condition,locked=false,joined=false;
  const query={from(value){table=value;return query;},where(value){condition=value;return query;},for(value){assert.equal(value,'update');locked=true;return query;},innerJoin(){joined=true;return query;},limit(){return query;},orderBy(){return query;},then(resolve,reject){try{
   const {sql,params}=dialect.sqlToQuery(condition),name=orm.getTableName(table);queries.push({name,locked,params,selection:Object.keys(selection??{})});
   if(mode==='ancestor-read-failed'&&name==='heartbeat_runs'&&locked&&params.includes(initial.id))throw Object.assign(Error('Native ancestor unavailable'),{code:'DB_READ_FAILED'});
   let values=[];
   if(table===schema.heartbeatRuns){
    if(selection?.context)values=[parent];
    else if(selection?.result&&selection?.status)values=rows;
    else if(params.includes('running'))values=rows.filter(run=>run.status==='running');
    else{const matches=rows.filter(run=>params.includes(run.id));values=matches.length?matches:rows;}
   }else if(table===schema.issues)values=[rootTask,task].filter(value=>params.includes(value.id));
   else if(table===schema.agentWakeupRequests)values=params.includes(wakeup.id)?[wakeup]:[];
   else if(table===schema.environmentLeases)values=Object.keys(selection??{}).join(',')==='id'&&sql.includes('"released_at" is null')?[]:leases;
   else if(table===schema.nativeRunFinalizations)values=mode==='native-reconciliation-denied'?[{leaseOwner:'still-owned'}]:[];
   if(joined)values=[];
   const columns=new Map(Object.entries(table).map(([key,value])=>[value,key]));
   resolve(clone(selection?values.map(row=>Object.fromEntries(Object.entries(selection).map(([key,column])=>[key,row[columns.get(column)]]))):values));
  }catch(error){reject(error);}}};return query;
 }
 const tx={select},db={select,transaction:perform=>perform(tx)};
 const write=(file,value)=>{fs.mkdirSync(file.slice(0,file.lastIndexOf('/')),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});};
 write(R+'/registry.json',registry);write(R+'/team/workflows/'+randomUUID()+'.json',flow);
 for(let i=0;i<3;i++)write(R+'/budget/'+rootId+'/'+randomUUID()+'.json',{rootTaskId:rootId,existing:true});
 const meter=new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[projectId],log(){}});meter.close();
 const sqlite=new DatabaseSync('/paperclip/control/admission.sqlite');sqlite.prepare('INSERT INTO admission_meter VALUES(?,?,?)').run(taskId,projectId,'2026-11-22');sqlite.prepare('INSERT INTO admission_lease VALUES(1,?,?)').run(taskId,registry.lease.nonce);sqlite.close();
 const ctx={runId:current.id,agent:{id:agentId},context:{...context}};Object.assign(task,{executionRunId:current.id,checkoutRunId:current.id});
 const originalRegistry=fs.readFileSync(R+'/registry.json'),originalRows=clone(rows);
 const {validateExecutionReconciliation}=await import(P+'/@paperclipai/server/dist/services/execution-recovery-resolution.js');
 assert.deepEqual(await validateExecutionReconciliation({db:tx,companyId,issueId:taskId,agentId,sourceRunId:parent.id,
  decision:{runId:parent.id,providerStopped:true,actionOutcome:'mixed',outcomeEvidence:'Dedicated offline Native fixture; no state or continuation is written.'}}),parent);
 assert.equal(await bindNativeRetryAttempt(ctx,{database:async()=>({db,schema,orm})}),ctx);
 assert.deepEqual(rows,originalRows);assert.deepEqual(fs.readFileSync(R+'/registry.json'),originalRegistry);assert.equal(fs.readdirSync(R+'/budget/'+rootId).length,3);
 assert.equal(queries.some(value=>value.name==='native_run_finalizations'),true,'the installed Native readonly reconciliation service ran');
 assert.equal(queries.some(value=>value.name==='agent_wakeup_requests'&&value.params.includes(wakeup.id)),true,'the original Chief wake supplied authority');
 const events=fs.readFileSync(R+'/events.jsonl','utf8').trim().split('\n').map(JSON.parse);
 assert.equal(events.at(-1).reconciledPreflightRunId,parent.id);assert.equal(events.at(-1).initialRunId,initial.id);
 for(const failure of ['ancestor-read-failed','native-reconciliation-denied']){mode=failure;let error;
  try{await bindNativeRetryAttempt(ctx,{database:async()=>({db,schema,orm})});}catch(value){error=value;}
  assert.deepEqual(teamRoleAdmissionFailure(error).resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});
  assert.match(error?.code??'',/^TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_/);assert.deepEqual(rows,originalRows);
 }
 mode='first';rows=[prior,initial,{...current,retryOfRunId:initial.id,scheduledRetryAttempt:1}];
 const beforeQueries=queries.length;assert.equal(await bindNativeRetryAttempt(ctx,{database:async()=>({db,schema,orm})}),ctx);
 assert.equal(queries.slice(beforeQueries).some(value=>value.name==='native_run_finalizations'),false,'first retry keeps its original positive bootstrap contract');
 assert.deepEqual(parent.resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});assert.deepEqual(fs.readFileSync(R+'/registry.json'),originalRegistry);
});
