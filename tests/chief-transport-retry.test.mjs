import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {bindChiefTransportRetry,readChiefTransportFailureEvidence,isChiefTransportPlanRetry,readArchivedChiefTransportFailure} from '../bridge/chief-transport-retry.mjs';
import {selectQueuedNativeRoleRetry} from '../bridge/role-native-retry-consumer.mjs';
import {teamRoleAdmissionFailure} from '../bridge/chief-bootstrap-retry.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY as policy} from '../bridge/role-execution-policy.mjs';
import {observeContextCallEvidence} from '../bridge/chief-context-paperclip.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const error='workspace backend must use an HTTPS origin without credentials';
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chief-transport-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const companyId=randomUUID(),projectId=randomUUID(),agentId=randomUUID(),taskId=randomUUID(),initialId=randomUUID(),parentId=randomUUID(),runId=randomUUID();
 const task={id:taskId,companyId,projectId,parentId:null,title:'Plan once',description:'Owner goal',createdByUserId:'owner',responsibleUserId:'owner',status:'in_progress',assigneeAgentId:agentId,assigneeUserId:null};
 const initialOperation={id:randomUUID(),kind:'run',role:'chief',phase:'plan',taskId,rootTaskId:taskId,agentId,projectId,contextVersion:1,projectKey:'personal',inputRevision:taskInputRevision(task),workspaceCwd:'/paperclip/instances/default/projects/'+companyId+'/'+projectId+'/_default',acceptedRunId:initialId};
 const put=(name,value,mode=0o600)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value)+'\n',{mode});return file;};
 const initialRun={id:initialId,companyId,issueId:taskId,agentId,responsibleUserId:'owner',status:'failed',exitCode:1,errorCode:'adapter_failed',error:JSON.stringify({code:'ROLE_GATE_ARGUMENTS_DENIED',claimed:false}),resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}},finishedAt:'2026-11-20T11:38:34Z',scheduledRetryAttempt:0,wakeupRequestId:randomUUID()};
 const initialPermit={schemaVersion:1,runId:initialId,taskId,rootTaskId:taskId,companyId,projectId,ownerId:'owner',agentId,role:'chief',inputRevision:initialOperation.inputRevision,cwd:initialOperation.workspaceCwd,executionPolicy:{...policy}};
 const initialFiles={permit:'permits/'+initialId+'.json',budgetRecord:'budget/'+taskId+'/'+initialOperation.id+'.json',operationBinding:'operations/'+initialOperation.id+'.json'};
 put(initialFiles.permit,initialPermit);put(initialFiles.budgetRecord,{schemaVersion:1,...initialOperation,at:'initial'});put(initialFiles.operationBinding,{operationId:initialOperation.id,runId:initialId,taskId,agentId});
 const operation={...initialOperation,id:randomUUID(),acceptedRunId:parentId,retryOfOperationId:initialOperation.id,retryOfRunId:initialId,nativeRetryAttempt:1,bootstrapRetryEvidence:Object.fromEntries(Object.entries(initialFiles).map(([key,file])=>[key+'Sha256',hash(fs.readFileSync(root+'/'+file))]))};
 const parentRun={id:parentId,companyId,issueId:taskId,agentId,responsibleUserId:'owner',status:'failed',exitCode:1,errorCode:'adapter_failed',retryOfRunId:initialId,scheduledRetryAttempt:1,startedAt:'2026-11-20T12:55:49Z',finishedAt:'2026-11-20T12:56:14Z'};
 const run={id:runId,companyId,issueId:taskId,agentId,responsibleUserId:'owner',status:'running',retryOfRunId:parentId,scheduledRetryAttempt:2};
 const registry={enabled:true,companyId,ownerId:'owner',team:{enabled:true,ids:{chief:agentId}},context:{enabled:true},agents:[{profile:{role:'chief',agentId,executionPolicy:{...policy}}}],tasks:[taskId],taskRoots:{[taskId]:taskId},operations:[initialOperation,operation],lease:{taskId,projectId,operationId:operation.id,nonce:randomUUID()}};
 const permit={...initialPermit,runId:parentId};const pfile=put('permits/'+parentId+'.json',permit);
 put('budget/'+taskId+'/'+operation.id+'.json',{schemaVersion:1,...operation,at:'parent'});put('operations/'+operation.id+'.json',{operationId:operation.id,runId:parentId,taskId,agentId});
 const callLock={nonce:randomUUID(),operationId:operation.id,taskId};put('call.lock',callLock);
 put('claims/'+parentId+'.json',{schemaVersion:1,runId:parentId,taskId,role:'chief',permitSha256:hash(fs.readFileSync(pfile))});
 put('results/'+parentId+'.json',{schemaVersion:1,runId:parentId,taskId,code:1,signal:null,timedOut:false,interrupted:false});
 const dir='transport/'+parentId+'/';
 const stdout=JSON.stringify({type:'thread.started',thread_id:'session'})+'\n'+JSON.stringify({type:'turn.started'})+'\n'+JSON.stringify({type:'error',message:error})+'\n'+JSON.stringify({type:'turn.failed',error:{message:error}})+'\n';
 put(dir+'stdout',stdout);put(dir+'stderr','');put(dir+'host-stdin','private prompt fixture');
 put(dir+'result.json',{runId:parentId,exitCode:1,signal:null,cancelled:false,timedOut:false,outputUnknown:false,executor:'macos_native',stdoutSha256:hash(stdout),stderrSha256:hash('')});
 const process={schemaVersion:1,pid:101,pgid:101,birth:'known',command:'/fixture/codex',startedAt:'2026-11-20T12:55:53Z'},broker={...process,pid:102,pgid:102,command:'/fixture/node'};
 put(dir+'process.json',process);put(dir+'broker-process.json',broker);for(const [prefix,value]of [['process',process],['broker-process',broker]])put(dir+prefix+'-cleanup.json',{schemaVersion:1,status:'terminated',pgid:value.pgid,members:[{pid:value.pid,pgid:value.pgid,birth:value.birth}]});
 put(dir+'native-proof.json',{schemaVersion:1,runId:parentId,executor:'macos_native',platform:'darwin',cwd:'/fixture/workspace',executionPolicy:{...policy},inputSha256:hash('private prompt fixture'),process});
 put(dir+'host.claim.json',{runId:parentId,executor:'macos_native',executionPolicy:{...policy}});put(dir+'request.json',{schemaVersion:1,runId:parentId,taskId,role:'chief',cwd:permit.cwd,executionPolicy:{...policy}});
 put(dir+'proxy-audit/provider.jsonl',JSON.stringify({code:'ROLE_PROXY_READY',runId:parentId,host:'127.0.0.1',port:12345})+'\n'+JSON.stringify({code:'ROLE_PROXY_COMPLETED',path:'/backend-api/wham/accounts/check',status:200,requestCount:0})+'\n');
 const control={managed:true,inputRevision:operation.inputRevision,pauseRequested:false,pendingInputs:[],reviewBeforeDispatch:true,plan:null};
 const wakeup={id:initialRun.wakeupRequestId,companyId,agentId,requestedByActorType:'user',requestedByActorId:'owner'};
 return {root,task,initialOperation,initialRun,operation,parentRun,run,registry,control,wakeup,flows:[],taskRuns:[initialRun,parentRun,run],activeRuns:[run],leases:[{heartbeatRunId:parentId,status:'failed',releasedAt:'2026-11-20T12:56:15Z',cleanupStatus:null}],ctx:{runId,agent:{id:agentId},context:{issueId:taskId,forceFreshSession:true}},put,dir};
}
function bind(f){return bindChiefTransportRetry({...f,editRegistry:edit=>{f.registry=edit(structuredClone(f.registry));return f.registry;},verifyPhaseLease:()=>true,log(){}});}

test('large role permits retain their byte binding through transport evidence and retry validation',t=>{
 const f=fixture(t),name='permits/'+f.parentRun.id+'.json',permit=JSON.parse(fs.readFileSync(f.root+'/'+name));
 permit.padding='x'.repeat(9*1024*1024);f.put(name,permit);
 const claimName='claims/'+f.parentRun.id+'.json',claim=JSON.parse(fs.readFileSync(f.root+'/'+claimName));
 claim.permitSha256=hash(fs.readFileSync(f.root+'/'+name));f.put(claimName,claim);
 assert.equal(readChiefTransportFailureEvidence(f).kind,'chief_https_no_response');
 assert.equal(bind(f).context.roleOperationId,f.registry.operations.at(-1).id);
});

test('a proved Chief HTTPS/no-response failure archives its own lock, binds only the Native second retry and preserves both spent slots',t=>{
 const f=fixture(t),oldSlots=fs.readdirSync(f.root+'/budget/'+f.task.id).map(n=>[n,hash(fs.readFileSync(f.root+'/budget/'+f.task.id+'/'+n))]),before=structuredClone(f.parentRun),nonce=f.registry.lease.nonce;
 assert.equal(isChiefTransportPlanRetry(f.operation,f.parentRun),true);const physical=readChiefTransportFailureEvidence(f);assert.equal(physical.kind,'chief_https_no_response');
 const result=bind(f),next=f.registry.operations.at(-1);assert.equal(result.context.roleOperationId,next.id);assert.equal(next.acceptedRunId,f.run.id);assert.equal(next.nativeRetryAttempt,2);assert.equal(next.retryOfOperationId,f.operation.id);assert.equal(next.retryOfRunId,f.parentRun.id);assert.equal(f.registry.lease.nonce,nonce);assert.equal(fs.existsSync(f.root+'/call.lock'),false);
 assert.deepEqual(f.parentRun,before);assert.deepEqual(fs.readdirSync(f.root+'/budget/'+f.task.id).map(n=>[n,hash(fs.readFileSync(f.root+'/budget/'+f.task.id+'/'+n))]),oldSlots);
 const archive=f.root+'/team/native-retries/'+f.parentRun.id;assert.equal(fs.statSync(archive+'/call.lock.json').mode&0o222,0);assert.equal(readArchivedChiefTransportFailure({...f,call:f.operation,run:f.parentRun,successor:f.run}),true);
 assert.equal(bind(f).context.roleOperationId,next.id);assert.equal(f.registry.operations.length,3);
});

test('unknown, response-bearing, changed-scope and foreign activity evidence never releases the preserved lock',t=>{
 const corruptions=[f=>f.put(f.dir+'result.json',{runId:f.parentRun.id,exitCode:1,signal:null,cancelled:false,timedOut:false,outputUnknown:true}),
  f=>f.put(f.dir+'proxy-audit/provider.jsonl',JSON.stringify({code:'ROLE_PROXY_READY',runId:f.parentRun.id})+'\n'+JSON.stringify({code:'ROLE_PROXY_COMPLETED',path:'/backend-api/codex/responses',status:200,requestCount:1})+'\n'),
  f=>f.put(f.dir+'process-cleanup.json',{status:'unknown',pgid:101,members:[]}),f=>f.put(f.dir+'broker-process-cleanup.json',{status:'terminated',pgid:999,members:[]}),
  f=>f.put(f.dir+'stdout',JSON.stringify({type:'turn.failed',error:{message:'other failure'}})+'\n'),f=>{f.task.description='changed';},f=>{f.run.scheduledRetryAttempt=1;},
  f=>{f.parentRun.finishedAt=null;},f=>{f.control.pauseRequested=true;},f=>{f.control.pendingInputs=[{}];},f=>{f.control.plan={sha256:'a'.repeat(64)};},
  f=>{f.flows=[{flow:{rootTaskId:f.task.id}}];},f=>{f.leases[0].releasedAt=null;},f=>{f.activeRuns.push({id:randomUUID(),status:'running'});},
  f=>f.put('budget/'+f.task.id+'/'+randomUUID()+'.json',{}),f=>{f.wakeup.requestedByActorType='agent';},f=>f.put('call.lock',{nonce:randomUUID(),taskId:f.task.id,operationId:randomUUID()}),
  f=>f.put('transport/'+f.run.id+'/request.json',{}),f=>{f.initialRun.resultJson.executionRecovery.providerWorkStarted=true;},f=>{f.parentRun.resultJson={executionRecovery:{providerWorkStarted:true}};}];
 for(const mutate of corruptions){const f=fixture(t);mutate(f);const registry=structuredClone(f.registry),lock=fs.readFileSync(f.root+'/call.lock');assert.throws(()=>bind(f),/TEAM_NATIVE_RETRY_CHIEF_TRANSPORT_/);assert.deepEqual(f.registry,registry);assert.deepEqual(fs.readFileSync(f.root+'/call.lock'),lock);}
});

test('archive observation rechecks hashes and the registered successor before treating the failed Chief call as settled',t=>{
 const f=fixture(t);bind(f);assert.equal(readArchivedChiefTransportFailure({...f,call:f.operation,run:f.parentRun,successor:f.run}),true);
 f.put(f.dir+'proxy-audit/provider.jsonl',JSON.stringify({code:'ROLE_PROXY_READY',runId:f.parentRun.id})+'\n');assert.equal(readArchivedChiefTransportFailure({...f,call:f.operation,run:f.parentRun,successor:f.run}),false);
});

test('the provider start observer accepts the archived Chief failure before the successor spends its third slot',{skip:process.getuid()!==0?'the Native control store requires the service uid':false},t=>{
 const f=fixture(t);bind(f);f.put('registry.json',f.registry);
 const observation=observeContextCallEvidence({root:f.root,task:f.task,ids:[f.task.id],runs:[f.initialRun,f.parentRun,f.run]});
 assert.equal(observation.budgetUsed,2);assert.equal(observation.unknown,false);assert.deepEqual(observation.settledFailedRunIds,[f.parentRun.id]);
 f.put(f.dir+'proxy-audit/provider.jsonl',JSON.stringify({code:'ROLE_PROXY_READY',runId:f.parentRun.id})+'\n');assert.equal(observeContextCallEvidence({root:f.root,task:f.task,ids:[f.task.id],runs:[f.initialRun,f.parentRun,f.run]}).unknown,true);
});

test('queued selection admits only the existing second Chief transport retry and admission errors remain reconciliation',t=>{
 const f=fixture(t),state={registry:f.registry,parentRun:f.parentRun,activeRuns:[{...f.run,status:'queued'}],tasks:[f.task],chiefTransportEvidence:readChiefTransportFailureEvidence(f)};
 assert.equal(selectQueuedNativeRoleRetry(state)?.runId,f.run.id);assert.equal(selectQueuedNativeRoleRetry({...state,activeRuns:[{...f.run,status:'scheduled_retry'}]}),null);
 assert.equal(selectQueuedNativeRoleRetry({...state,chiefTransportEvidence:undefined}),null);
 assert.deepEqual(teamRoleAdmissionFailure({code:'TEAM_NATIVE_RETRY_CHIEF_TRANSPORT_EVIDENCE_UNAVAILABLE'}).resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});
});
