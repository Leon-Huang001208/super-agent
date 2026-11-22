import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {bindUnstartedChildRetry,childBootstrapOperation,childBootstrapEvidenceCode,isChildBootstrapPreflightRefusal} from '../bridge/role-native-retry.mjs';
import {bindNativeRetryAttempt,resolveNativeRetryScope} from '../bridge/team-native-runtime.mjs';
import {teamRoleAdmissionFailure,prepareTeamRoleExecution} from '../bridge/chief-bootstrap-retry.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'child-bootstrap-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const companyId=randomUUID(),projectId=randomUUID(),chiefId=randomUUID(),agentId=randomUUID(),rootId=randomUUID(),taskId=randomUUID(),parentId=randomUUID(),runId=randomUUID(),operationId=randomUUID();
 const rootTask={id:rootId,companyId,projectId,title:'Original document batch',description:'Review three existing documentation PRs',responsibleUserId:'owner',
  status:'in_review',assigneeUserId:'owner',assigneeAgentId:null,executionRunId:null,checkoutRunId:null};
 const task={id:taskId,parentId:rootId,companyId,projectId,title:'Repair the same documents',description:'Address the existing QA findings',responsibleUserId:'owner',
  status:'in_progress',assigneeAgentId:agentId,assigneeUserId:null,executionRunId:runId,checkoutRunId:runId};
 const workspaceCwd=path.join(root,'workspace');fs.mkdirSync(workspaceCwd,{mode:0o700});
 const operation={id:operationId,kind:'run',role:'document-specialist',phase:'work',agentId,taskId,rootTaskId:rootId,projectId,
  inputRevision:taskInputRevision(task),rootInputRevision:taskInputRevision(rootTask),outputFile:'document-batch-fix-r1.md',
  qualityRepair:{round:1,sourceQaRunId:randomUUID(),targetKey:'document-batch',qaKey:'independent-qa',phase:'fix'}};
 const registry={enabled:true,companyId,ownerId:'owner',team:{enabled:true,projectId,ids:{chief:chiefId,'document-specialist':agentId}},
  agents:[{profile:{role:'chief',agentId:chiefId}},{profile:{role:'document-specialist',agentId}}],operations:[operation],tasks:[rootId,taskId],taskRoots:{[rootId]:rootId,[taskId]:rootId},
  lease:{taskId,projectId,operationId,nonce:'a'.repeat(64)},
  taskCallBudgets:{[rootId]:{rootTaskId:rootId,companyId,approvedBy:'owner',maximum:12,tier:'complex',approvalSource:'original owner grant'}}};
 const flow={rootTaskId:rootId,projectId,inputRevision:operation.rootInputRevision,taskEntries:[{id:taskId,key:'document-batch',role:operation.role,agentId,outputFile:'document-batch.md'}],
  dispatches:{'document-batch':{operationId,taskId,inputRevision:operation.inputRevision,leaseNonce:registry.lease.nonce}},artifacts:{},
  qaRepair:{round:1,stage:'fix',nativePrepared:true,targetKey:'document-batch',qaKey:'independent-qa',fixOperationId:operationId,targetOutputFile:operation.outputFile,sourceQa:{runId:operation.qualityRepair.sourceQaRunId}}};
 const wakeup={id:randomUUID(),companyId,agentId,requestedByActorType:'agent',requestedByActorId:chiefId,runId:parentId,payload:{issueId:taskId}};
 const context={issueId:taskId,taskId,projectId,responsibleUserId:'owner',inputRevision:operation.inputRevision,roleOperationId:operationId,taskGoal:task.description};
 const parentRun={id:parentId,companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'failed',exitCode:1,errorCode:'NATIVE_ROLE_PRIVATE_FILE_DENIED',
  resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}},scheduledRetryAttempt:0,wakeupRequestId:wakeup.id,finishedAt:'2026-11-22T03:24:58.153Z',contextSnapshot:{...context}};
 const run={id:runId,companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'running',scheduledRetryAttempt:1,retryOfRunId:parentId,contextSnapshot:{...context}};
 const ctx={runId,agent:{id:agentId},runtime:{sessionId:'actual-native-retry-session'},context:{...context,forceFreshSession:true}};
 const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});};
 for(let i=0;i<3;i++)write('budget/'+rootId+'/'+randomUUID()+'.json',{rootTaskId:rootId,existing:true});
 return {root,ctx,registry,operation,rootTask,task,flow,workspaceCwd,parentRun,run,wakeup,activeRuns:[run],taskRuns:[parentRun,run],
  leases:[{heartbeatRunId:parentId,status:'failed',releasedAt:'2026-11-22T03:24:58.200Z',cleanupStatus:null}],write};
}
const bind=f=>bindUnstartedChildRetry({...f,verifyPhaseLease:lease=>{assert.deepEqual(lease,f.registry.lease);return true;},log(){}});
function secondFixture(t){
 const f=fixture(t),initialRun=f.parentRun,parentRun={...f.run,status:'failed',exitCode:1,signal:null,finishedAt:'2026-11-22T04:07:23.678Z',
  errorCode:'TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_EVIDENCE_UNAVAILABLE',error:'The controlled Native intake or retry did not admit this execution.',
  resultJson:{executionRecovery:{kind:'reconciliation',providerWorkStarted:null},stopReason:'adapter_failed',timeoutFired:false,
   configFreshness:{session:{taskSessionAvailable:false,taskSessionReused:false}}},stdoutExcerpt:'',stderrExcerpt:'',logBytes:0,
  logSha256:createHash('sha256').update('').digest('hex'),nativeSessionId:null,sessionIdBefore:null,sessionIdAfter:null,processPid:null,processGroupId:null};
 const run={...f.run,id:randomUUID(),scheduledRetryAttempt:2,retryOfRunId:parentRun.id};
 Object.assign(f,{initialRun,parentRun,run,ctx:{...f.ctx,runId:run.id},taskRuns:[initialRun,parentRun,run],activeRuns:[run]});
 Object.assign(f.task,{executionRunId:run.id,checkoutRunId:run.id});
 f.leases.push({heartbeatRunId:parentRun.id,status:'failed',releasedAt:'2026-11-22T04:07:23.800Z',cleanupStatus:null});
 return f;
}
function bytes(directory){return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
 const file=path.join(directory,entry.name);return entry.isDirectory()?bytes(file):[[file,fs.readFileSync(file).toString('base64')]];
});}

test('the registered child bootstrap reuses the same context, operation, lease and three spent slots without writing',t=>{
 const f=fixture(t),before=structuredClone({registry:f.registry,flow:f.flow,ctx:f.ctx}),files=bytes(f.root);
 assert.equal(childBootstrapOperation(f.registry,f.parentRun),f.operation);
 assert.equal(bind(f),f.ctx);assert.equal(bind(f),f.ctx);
 assert.deepEqual({registry:f.registry,flow:f.flow,ctx:f.ctx},before);assert.deepEqual(bytes(f.root),files);
 assert.equal(fs.existsSync(f.root+'/operations/'+f.operation.id+'.json'),false);assert.equal(fs.readdirSync(f.root+'/budget/'+f.rootTask.id).length,3);
});

test('scope resolution may clone the registry without invalidating the same original child operation',t=>{
 const f=fixture(t),cwd='/paperclip/instances/default/projects/'+f.registry.companyId+'/'+f.task.projectId+'/_default';
 Object.assign(f.operation,{contextVersion:1,projectKey:'rwb',workspaceCwd:cwd});Object.assign(f.flow,{contextVersion:1,projectKey:'rwb',workspaceCwd:cwd});
 f.registry.context={schemaVersion:1,enabled:true,catalog:{schemaVersion:1,defaultProjectKey:'rwb',projects:[{key:'rwb',aliases:[],companyId:f.registry.companyId,ownerId:'owner',
  projectId:f.task.projectId,adapterKey:'native-docs',allowedRoles:['document-specialist'],maximumAction:'read_only',workspaceCwd:cwd}]}};
 const selected=resolveNativeRetryScope({...f,flows:[{file:'original',flow:f.flow}],log(){}}),scoped=selected.registry;
 assert.notEqual(scoped.operations[0],f.operation);
 assert.equal(bind({...f,registry:scoped,workspaceCwd:selected.workspaceCwd}),f.ctx);
 assert.throws(()=>bind({...f,operation:{...f.operation,additionalCapabilities:['unauthorized']},registry:scoped,workspaceCwd:selected.workspaceCwd}),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_AUTHORITY_CHANGED/);
});

test('ordinary Native child resolves its managed artifact directory without M2-only operation fields',t=>{
 const f=fixture(t),before=structuredClone(f.operation),selected=resolveNativeRetryScope({...f,flows:[{file:'original',flow:f.flow}],log(){}});
 const cwd='/paperclip/instances/default/projects/'+f.registry.companyId+'/'+f.task.projectId+'/_default';
 assert.equal(selected.workspaceCwd,cwd);assert.equal(f.operation.contextVersion,undefined);assert.equal(f.operation.workspaceCwd,undefined);
 assert.equal(bind({...f,registry:selected.registry,workspaceCwd:selected.workspaceCwd}),f.ctx);assert.deepEqual(f.operation,before);
 const lstat=fs.lstatSync;t.mock.method(fs,'lstatSync',(file,...args)=>file===path.join(cwd,f.operation.outputFile)?{isFile:()=>true}:lstat(file,...args));
 assert.throws(()=>bind({...f,registry:selected.registry,workspaceCwd:selected.workspaceCwd}),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_PHYSICAL_EVIDENCE_PRESENT/);
});

test('an existing second Native retry reconciles a controlled preflight refusal without rewriting its unknown history',t=>{
 const f=secondFixture(t),selected=resolveNativeRetryScope({...f,flows:[{file:'original',flow:f.flow}],log(){}});
 const {write,...state}=f,before=structuredClone(state),files=bytes(f.root);assert.equal(childBootstrapOperation(f.registry,f.parentRun,f.initialRun),f.operation);
 assert.equal(isChildBootstrapPreflightRefusal(f.parentRun),true);
 assert.equal(bind({...f,registry:selected.registry,workspaceCwd:selected.workspaceCwd}),f.ctx);
 assert.deepEqual(state,before);assert.deepEqual(bytes(f.root),files);
 assert.deepEqual(f.parentRun.resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});
 assert.equal(fs.readdirSync(f.root+'/budget/'+f.rootTask.id).length,3);assert.equal(f.run.scheduledRetryAttempt,2);
});

test('second retry refuses changed or missing controlled return evidence, ancestry and every physical attempt',t=>{
 const mutations=[f=>{f.parentRun.errorCode='adapter_failed';},f=>{f.parentRun.error='same error code from another adapter';},
  f=>{f.parentRun.resultJson.stopReason='provider_failed';},f=>{delete f.parentRun.resultJson.timeoutFired;},f=>{f.parentRun.resultJson.timeoutFired=true;},
  f=>{f.parentRun.logSha256='a'.repeat(64);},f=>{f.parentRun.logBytes=1;},f=>{delete f.parentRun.logBytes;},
  f=>{f.parentRun.stdoutExcerpt='output';},f=>{f.parentRun.stderrExcerpt='error';},f=>{f.parentRun.sessionIdAfter='session';},
  f=>{delete f.parentRun.nativeSessionId;},f=>{f.parentRun.processPid=123;},f=>{f.parentRun.resultJson.configFreshness.session.taskSessionAvailable=true;},
  f=>{delete f.parentRun.resultJson.configFreshness.session.taskSessionReused;},f=>{f.initialRun.resultJson.executionRecovery.providerWorkStarted=null;},
  f=>{f.initialRun.contextSnapshot.responsibleUserId='other';},f=>{f.parentRun.contextSnapshot.roleOperationId=randomUUID();},
  f=>{f.parentRun.retryOfRunId=randomUUID();},f=>{f.parentRun.scheduledRetryAttempt=0;},f=>{f.run.scheduledRetryAttempt=3;},
  f=>{f.wakeup.runId=f.parentRun.id;},f=>{f.leases[1].releasedAt=null;},f=>{f.taskRuns.splice(0,1);}];
 for(const mutate of mutations){const f=secondFixture(t);mutate(f);const {write,...state}=f,before=structuredClone(state),files=bytes(f.root);
  assert.throws(()=>bind(f),/^Error: TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_/);assert.deepEqual(state,before);assert.deepEqual(bytes(f.root),files);
 }
 for(const which of ['initialRun','parentRun','run'])for(const prefix of ['permits','claims','results','transport']){
  const f=secondFixture(t);f.write(prefix+'/'+f[which].id+(prefix==='transport'?'/result.json':'.json'),{});
  assert.throws(()=>bind(f),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_PHYSICAL_EVIDENCE_PRESENT/);
 }
});

test('an earlier successful operation of the same task and its old output remain valid evidence',t=>{
 const f=fixture(t),oldOperationId=randomUUID(),oldRun={...f.parentRun,id:randomUUID(),status:'succeeded',exitCode:0,
  contextSnapshot:{...f.parentRun.contextSnapshot,roleOperationId:oldOperationId}};
 f.taskRuns.unshift(oldRun);f.leases.unshift({heartbeatRunId:oldRun.id,status:'released',releasedAt:'2026-11-22T03:22:47Z',cleanupStatus:null});
 f.registry.operations.unshift({...f.operation,id:oldOperationId,outputFile:'document-batch.md',qualityRepair:undefined});
 f.write('workspace/document-batch.md',{prior:'accepted draft'});f.write('operations/'+oldOperationId+'.json',{runId:oldRun.id});
 for(const prefix of ['permits','claims','results','transport'])f.write(prefix+'/'+oldRun.id+(prefix==='transport'?'/result.json':'.json'),{prior:true});
 const files=bytes(f.root),registry=structuredClone(f.registry);assert.equal(bind(f),f.ctx);assert.deepEqual(bytes(f.root),files);assert.deepEqual(f.registry,registry);
});

test('spoofed Native, owner, input, flow, retry and phase proof refuse the no-physical re-entry',t=>{
 const cases=[f=>{f.parentRun.exitCode=0;},f=>{f.parentRun.resultJson.executionRecovery.providerWorkStarted=null;},f=>{delete f.parentRun.resultJson;},
  f=>{f.parentRun.resultJson.executionRecovery.providerWorkStarted=true;},f=>{f.parentRun.status='running';},f=>{f.parentRun.finishedAt=null;},
  f=>{f.parentRun.errorCode='adapter_failed';},f=>{f.parentRun.retryOfRunId=randomUUID();},f=>{f.parentRun.scheduledRetryAttempt=1;},
  f=>{f.run.status='scheduled_retry';},f=>{f.run.retryOfRunId=randomUUID();},f=>{f.run.scheduledRetryAttempt=2;},f=>{f.run.finishedAt='2026-11-22T03:25:00Z';},
  f=>{f.wakeup.requestedByActorType='user';f.wakeup.requestedByActorId='owner';},f=>{f.wakeup.requestedByActorId=randomUUID();},f=>{f.wakeup.runId=randomUUID();},
  f=>{f.rootTask.responsibleUserId='other';},f=>{f.task.companyId=randomUUID();},f=>{f.task.parentId=randomUUID();},f=>{f.rootTask.status='todo';},
  f=>{f.rootTask.description='changed original input';},f=>{f.task.description='changed child input';},f=>{f.task.assigneeAgentId=randomUUID();},
  f=>{f.ctx.context.inputRevision='b'.repeat(64);},f=>{f.ctx.context.projectId=randomUUID();},f=>{f.parentRun.contextSnapshot.responsibleUserId='other';},
  f=>{f.run.contextSnapshot.taskId=randomUUID();},f=>{f.run.contextSnapshot.roleOperationId=randomUUID();},f=>{f.parentRun.responsibleUserId='other';},
  f=>{f.operation.acceptedRunId=f.parentRun.id;},f=>{f.operation.retryOfRunId=randomUUID();},f=>{f.registry.enabled=false;},
  f=>{f.flow.dispatches['document-batch'].operationId=randomUUID();},f=>{f.flow.artifacts['document-batch']={runId:randomUUID()};},
  f=>{f.flow.qaRepair.fixOperationId=randomUUID();},f=>{f.flow.qaRepair.stage='review';},
  f=>{f.registry.lease.nonce='c'.repeat(64);},f=>{f.registry.lease.operationId=randomUUID();},f=>{f.activeRuns.push({id:randomUUID(),status:'queued'});},
  f=>{f.leases[0].releasedAt=null;},f=>{f.leases[0].cleanupStatus='failed';},f=>{f.taskRuns.push({...f.parentRun,id:randomUUID()});},
  f=>{f.taskRuns.push({...f.parentRun,id:randomUUID(),status:'running',contextSnapshot:{...f.parentRun.contextSnapshot,roleOperationId:randomUUID()}});},
  f=>{f.registry.operations.push({...f.operation});},
  f=>{f.registry.operations.push({...f.operation,id:randomUUID(),acceptedRunId:f.run.id,retryOfRunId:f.parentRun.id,retryOfOperationId:f.operation.id});}];
 for(const [index,mutate] of cases.entries()){const f=fixture(t);mutate(f);const files=bytes(f.root),before=structuredClone(f.registry);let failure;
  try{bind(f);}catch(error){failure=error;}
  assert.match(failure?.code??'',/^TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_/,'mutation '+index);
  assert.deepEqual(teamRoleAdmissionFailure(failure).resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});
  assert.deepEqual(bytes(f.root),files);assert.deepEqual(f.registry,before);
 }
 const f=fixture(t);assert.throws(()=>bindUnstartedChildRetry({...f,verifyPhaseLease:()=>false,log(){}}),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_FLOW_OR_PHASE_CHANGED/);
});

test('any parent/retry provider evidence, unknown output, call lock or spent original operation prevents first admission',t=>{
 for(const which of ['parentRun','run'])for(const prefix of ['permits','claims','results','transport']){
  const f=fixture(t);f.write(prefix+'/'+f[which].id+(prefix==='transport'?'/request.json':'.json'),{});assert.throws(()=>bind(f),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_PHYSICAL_EVIDENCE_PRESENT/);
 }
 for(const create of [f=>f.write('call.lock',{}),f=>f.write('operations/'+f.operation.id+'.json',{}),f=>f.write('budget/'+f.rootTask.id+'/'+f.operation.id+'.json',{}),
  f=>{f.operation.workspaceCwd=f.root+'/workspace';f.write('workspace/'+f.operation.outputFile,{unknown:'output'});}]){
  const f=fixture(t);create(f);assert.throws(()=>bind(f),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_PHYSICAL_EVIDENCE_PRESENT/);
 }
});

test('missing physical proof stays reconciliation/unknown and never falls through to a new intake',async t=>{
 const f=fixture(t);fs.rmSync(f.root+'/budget',{recursive:true});let failure,admissions=0;
 try{await prepareTeamRoleExecution(f.ctx,{database:null,bindNativeRetryAttempt:async()=>{try{return bind(f);}catch(error){throw Object.assign(Error('unknown'),{code:childBootstrapEvidenceCode(error)});}},admitChiefInput:async()=>{admissions++;}});}
 catch(error){failure=teamRoleAdmissionFailure(error);}
 assert.equal(failure.errorCode,'TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_EVIDENCE_UNAVAILABLE');
 assert.deepEqual(failure.resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});assert.equal(admissions,0);
});

test('early private registry or context failures keep the child bootstrap evidence classification unknown',()=>{
 for(const error of [{code:'TEAM_CONTROL_FILE_DENIED'},{code:'TEAM_NATIVE_RETRY_CONTEXT_CHANGED'},new SyntaxError('malformed private JSON')]){
  assert.deepEqual(teamRoleAdmissionFailure({code:childBootstrapEvidenceCode(error)}).resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});
 }
 assert.equal(childBootstrapEvidenceCode({code:'TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_FLOW_OR_PHASE_CHANGED'}),'TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_FLOW_OR_PHASE_CHANGED');
});

test('actual retry binding preserves unknown when its current or parent Native transaction read fails',async t=>{
 const events=[];
 t.mock.method(fs,'appendFileSync',(file,line)=>{assert.equal(file,'/paperclip/control/research-pm/events.jsonl');events.push(JSON.parse(line));});
 for(const mode of ['current-read-failed','parent-read-failed','current-missing','parent-missing']){
  const f=fixture(t);let reads=0;
  const table={id:'id'},orm={eq:(field,value)=>({field,value})};
  const tx={select:()=>({from:actual=>{assert.equal(actual,table);return{where:()=>({for:async lock=>{
   assert.equal(lock,'update');reads++;
   if(mode===(reads===1?'current-read-failed':'parent-read-failed'))throw Object.assign(Error('Native read failed'),{code:'DB_READ_FAILED'});
   if(mode===(reads===1?'current-missing':'parent-missing'))return [];
   return [reads===1?f.run:f.parentRun];
  }})};}})};
  const db={select:()=>({from:actual=>{assert.equal(actual,table);return{where:async()=>[f.run]};}}),transaction:async perform=>perform(tx)};
  let failure;
  try{await bindNativeRetryAttempt(f.ctx,{database:async()=>({db,schema:{heartbeatRuns:table},orm})});}catch(error){failure=teamRoleAdmissionFailure(error);}
  assert.equal(failure?.errorCode,'TEAM_NATIVE_RETRY_BOOTSTRAP_EVIDENCE_UNAVAILABLE',mode);
  assert.deepEqual(failure.resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null},mode);
 }
 assert.equal(events.length,4);assert.equal(events.every(value=>value.code==='TEAM_NATIVE_RETRY_BOOTSTRAP_EVIDENCE_UNAVAILABLE'),true);
});

test('a historical twelve-call root keeps its original limit; a full budget cannot re-enter',t=>{
 const f=fixture(t);for(let i=3;i<12;i++)f.write('budget/'+f.rootTask.id+'/'+randomUUID()+'.json',{rootTaskId:f.rootTask.id});
 assert.throws(()=>bind(f),/TEAM_NATIVE_RETRY_BOOTSTRAP_CHILD_BUDGET_DENIED/);assert.equal(f.registry.taskCallBudgets[f.rootTask.id].maximum,12);
});
