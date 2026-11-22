import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {teamArtifactNames} from '../bridge/team-context.mjs';
import {teamRoleAdmissionFailure,prepareTeamRoleExecution} from '../bridge/chief-bootstrap-retry.mjs';
import {completedResumeChiefOperation,completedResumeChiefRetryEvidence,bindUnstartedCompletedResumeChiefRetry,completedResumeChiefRetryEvidenceCode} from '../bridge/role-native-retry.mjs';
import {selectQueuedNativeRoleRetry} from '../bridge/role-native-retry-consumer.mjs';
import {bindNativeRetryAttempt,startTeamCoordinator} from '../bridge/team-native-runtime.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),copy=value=>structuredClone(value),R='/paperclip/control/research-pm';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'completed-chief-workspace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const companyId=randomUUID(),projectId=randomUUID(),agentId=randomUUID(),taskId=randomUUID(),workspaceId=randomUUID(),opId=randomUUID(),parentId=randomUUID(),retryId=randomUUID(),oldInput='a'.repeat(64);
 const artifactCwd=`/paperclip/instances/default/projects/${companyId}/${projectId}/_default`,nativeWorkspace={id:workspaceId,projectId,cwd:'/registered-projects/rwb',sourceType:'local_path',metadata:{superAgentProject:{ownerId:'owner',repository:{hostPath:'/Volumes/WorkDisk/Projects/RWB/source'}}}};
 const task={id:taskId,parentId:null,companyId,projectId,projectWorkspaceId:workspaceId,title:'Original financial work',description:'Continue only incomplete PoC with the original spent calls.',
  createdByUserId:'owner',responsibleUserId:'owner',status:'in_progress',assigneeAgentId:agentId,assigneeUserId:null,executionRunId:null,checkoutRunId:null};
 const inputRevision=taskInputRevision(task),names=teamArtifactNames({taskId,inputRevision,generationId:opId});
 const operation={id:opId,kind:'run',role:'chief',phase:'plan',agentId,taskId,rootTaskId:taskId,projectId,inputRevision,contextVersion:1,projectKey:'rwb',projectWorkspaceId:workspaceId,workspaceCwd:artifactCwd,artifactGeneration:opId,...names};
 const context={roleOperationId:opId,issueId:taskId,taskId,projectId,responsibleUserId:'owner',inputRevision,forceFreshSession:true,
  paperclipWorkspace:{workspaceId,projectId,cwd:nativeWorkspace.cwd,source:'project_primary',mode:'shared_workspace'}};
 // Whitelisted shape observed from the real installed Native refusal: no top-level projectWorkspaceId.
 const parentRun={id:parentId,companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'failed',retryOfRunId:null,scheduledRetryAttempt:0,wakeupRequestId:randomUUID(),
  startedAt:'2026-11-22T05:23:42.451Z',finishedAt:'2026-11-22T05:23:49.730Z',exitCode:1,signal:null,errorCode:'NATIVE_ROLE_WORKSPACE_SCOPE_DENIED',error:'NATIVE_ROLE_WORKSPACE_SCOPE_DENIED',
  resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false},stopReason:'adapter_failed',timeoutFired:false,configFreshness:{session:{taskSessionAvailable:false,taskSessionReused:false}}},
  stdoutExcerpt:'',stderrExcerpt:'',logBytes:0,logSha256:sha(''),nativeSessionId:null,sessionIdBefore:null,sessionIdAfter:null,processPid:null,processGroupId:null,contextSnapshot:copy(context)};
 const run={id:retryId,companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'running',retryOfRunId:parentId,scheduledRetryAttempt:1,contextSnapshot:copy(context),
  startedAt:null,finishedAt:null,exitCode:null,signal:null,errorCode:null,error:null,stdoutExcerpt:null,stderrExcerpt:null,logBytes:null,logSha256:null,
  nativeSessionId:null,sessionIdBefore:null,sessionIdAfter:null,processPid:null,processGroupId:null,processStartedAt:null,usageJson:null,
  lastOutputSeq:0,lastOutputAt:null,lastOutputStream:null,lastOutputBytes:null,resultJson:{conversationContinuation:'continue_conversation_v1'}};
 const completedResume={schemaVersion:1,resumeId:opId,rootTaskId:taskId,companyId,ownerId:'owner',approvedBy:'owner',projectId,projectWorkspaceId:workspaceId,goalIncomplete:true,
  beforeInputRevision:oldInput,afterInputRevision:inputRevision,usedCalls:4,maximum:20,sourceRunId:randomUUID()};
 const control={managed:true,taskId,companyId,ownerId:'owner',projectId,projectWorkspaceId:workspaceId,inputRevision,pauseRequested:false,pendingInputs:[],plan:null,
  sourceKey:'owner-completed-resume:'+opId,resumeOperationId:opId,resumeClaim:{operationId:opId,inputRevision,status:'claimed'},completedResume};
 const flow={kind:'completed-root-resume',rootTaskId:taskId,projectId,projectKey:'rwb',projectWorkspaceId:workspaceId,workspaceCwd:artifactCwd,contextVersion:1,inputRevision:oldInput,
  sourceRunId:completedResume.sourceRunId,sourceOperationId:randomUUID(),dispatched:true,completedResume:copy(completedResume),predecessor:{resumeId:opId,flowSha256:'b'.repeat(64),archiveFile:'/private/archive.json'}};
 const registry={enabled:true,companyId,ownerId:'owner',team:{enabled:true,projectId,ids:{chief:agentId}},agents:[{profile:{role:'chief',agentId}}],operations:[operation],tasks:[taskId],taskRoots:{[taskId]:taskId},
  lease:{taskId,projectId,operationId:opId,nonce:'c'.repeat(64)},contextProject:{key:'rwb',projectId,projectWorkspaceId:workspaceId,workspaceCwd:artifactCwd},
  context:{schemaVersion:1,enabled:true,catalog:{schemaVersion:1,defaultProjectKey:'rwb',projects:[{key:'rwb',aliases:[],companyId,ownerId:'owner',projectId,projectWorkspaceId:workspaceId,adapterKey:'rwb-docs',allowedRoles:['chief'],maximumAction:'pull_request',workspaceCwd:artifactCwd}]}}};
 const wakeup={id:parentRun.wakeupRequestId,runId:parentId,companyId,agentId,requestedByActorType:'agent',requestedByActorId:agentId,source:'on_demand',reason:'team_controlled_assignment',payload:{issueId:taskId,_paperclipWakeContext:copy(context)}};
 const oldRuns=Array.from({length:2},()=>({id:randomUUID(),companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'succeeded',finishedAt:'2026-11-22T04:00:00.000Z',contextSnapshot:{roleOperationId:randomUUID()}}));
 const taskRuns=[...oldRuns,parentRun,run],leases=taskRuns.filter(value=>value.id!==run.id).map(value=>({heartbeatRunId:value.id,status:'released',releasedAt:value.finishedAt,cleanupStatus:null}));
 const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});};
 for(let i=0;i<4;i++)write('budget/'+taskId+'/'+randomUUID()+'.json',{rootTaskId:taskId,existing:true});
 return{root,registry,operation,task,parentRun,run,wakeup,control,flow,flows:[{file:R+'/team/workflows/old.json',flow}],nativeWorkspace,workspaceCwd:artifactCwd,
  taskRuns,activeRuns:[run],leases,ctx:{runId:run.id,agent:{id:agentId},context:copy(context)},verifyPhaseLease:()=>true,log(){},write};
}
const contents=root=>fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>entry.isDirectory()?contents(path.join(root,entry.name)):[[path.join(root,entry.name),sha(fs.readFileSync(path.join(root,entry.name)))]]);

function nativeFixture(t,f){
 const mapped=file=>typeof file!=='string'?file:file===R||file.startsWith(R+'/')?f.root+file.slice(R.length):
  file===f.workspaceCwd||file.startsWith(f.workspaceCwd+'/')?f.root+'/artifacts'+file.slice(f.workspaceCwd.length):file;
 fs.mkdirSync(f.root+'/artifacts',{mode:0o700});f.write('registry.json',f.registry);f.write('team/workflows/old.json',f.flow);
 for(const name of ['mkdirSync','lstatSync','existsSync','readFileSync','readdirSync','appendFileSync']){
  const original=fs[name];t.mock.method(fs,name,(file,...args)=>original(mapped(file),...args));
 }
 const realpath=fs.realpathSync;t.mock.method(fs,'realpathSync',(file,...args)=>typeof file==='string'&&(file===R||file.startsWith(R+'/'))?file:realpath(mapped(file),...args));
 const table=(name,keys)=>Object.fromEntries(keys.map(key=>[key,name+'.'+key]));
 const schema={heartbeatRuns:table('runs',['id','status','issueId','companyId']),issues:table('issues',['id','parentId']),
  agentWakeupRequests:table('wakeups',['id','companyId','requestedByActorType','status','payload']),projectWorkspaces:table('workspaces',['id']),
  activityLog:table('activity',['id','companyId','action','entityId']),environmentLeases:table('leases',['heartbeatRunId','status','releasedAt','cleanupStatus'])};
 const eq=(field,value)=>({kind:'eq',field,value}),orm={eq,inArray:(field,values)=>({kind:'in',field,values}),and:(...values)=>({kind:'and',values}),or:(...values)=>({kind:'or',values}),
  isNull:field=>({kind:'null',field}),sql:(strings,...values)=>({kind:'sql',strings,values})};
 const matches=(row,c)=>c.kind==='eq'?row[c.field.split('.').at(-1)]===c.value:c.kind==='in'?c.values.includes(row[c.field.split('.').at(-1)]):
  c.kind==='and'?c.values.every(value=>matches(row,value)):c.kind==='or'?c.values.some(value=>matches(row,value)):c.kind==='null'?row[c.field.split('.').at(-1)]==null:true;
 const lookups=[],resumes=[];
 const db={select:()=>({from:actual=>({where:condition=>{
  const rows=actual===schema.heartbeatRuns?f.taskRuns:actual===schema.issues?[f.task]:actual===schema.agentWakeupRequests?[f.wakeup]:actual===schema.projectWorkspaces?[f.nativeWorkspace]:
   actual===schema.environmentLeases?f.leases:actual===schema.activityLog?[{companyId:f.registry.companyId,action:'team.context.control',entityId:f.task.id,actorType:'user',actorId:f.registry.ownerId,
    details:{_eventSequence:3,value:{schemaVersion:1,...f.control}}}]:assert.fail('unexpected table');
  if(actual===schema.heartbeatRuns&&condition.kind==='eq'&&condition.field===schema.heartbeatRuns.id)lookups.push(condition.value);
  const selected=rows.filter(row=>matches(row,condition)),promise=Promise.resolve(selected);
  promise.for=async lock=>{assert.equal(lock,'update');return selected;};promise.limit=async n=>selected.slice(0,n);return promise;
 }})}),transaction:async perform=>perform(db)};
 return{db,schema,orm,lookups,resumes,verifyPhaseLease:lease=>{assert.deepEqual(lease,f.registry.lease);return true;},issue:{getById:async id=>id===f.task.id?f.task:null},heartbeat:{resumeQueuedRunsForAgent:async(company,agent)=>{
  assert.equal(company,f.registry.companyId);assert.equal(agent,f.operation.agentId);resumes.push(f.run.id);f.run.status='running';f.run.startedAt=new Date('2026-11-22T06:00:00.000Z');f.task.executionRunId=f.run.id;f.task.checkoutRunId=f.run.id;return[{id:f.run.id}];
 }}};
}

test('the exact completed-root workspace refusal reuses its original operation and four spent slots',t=>{
 const f=fixture(t),before=copy({registry:f.registry,flow:f.flow,parentRun:f.parentRun,control:f.control,ctx:f.ctx}),files=contents(f.root);
 assert.equal(completedResumeChiefOperation(f.registry,f.parentRun),f.operation);
 assert.equal(bindUnstartedCompletedResumeChiefRetry(f),f.ctx);assert.equal(bindUnstartedCompletedResumeChiefRetry(f),f.ctx);
 assert.deepEqual({registry:f.registry,flow:f.flow,parentRun:f.parentRun,control:f.control,ctx:f.ctx},before);assert.deepEqual(contents(f.root),files);
 assert.equal(f.operation.acceptedRunId,undefined);assert.equal(fs.readdirSync(f.root+'/budget/'+f.task.id).length,4);
 assert.notEqual(f.nativeWorkspace.cwd,f.workspaceCwd);assert.equal(f.ctx.context.projectWorkspaceId,undefined);
});
test('queued selection requires the completed-resume proof and never claims scheduled rows',t=>{
 const f=fixture(t),queued={...f.run,status:'queued'},state={...f,run:queued,activeRuns:[queued],taskRuns:f.taskRuns.map(value=>value.id===queued.id?queued:value),ctx:{...f.ctx,context:queued.contextSnapshot},phase:'queued'};
 const proof=completedResumeChiefRetryEvidence(state),input={registry:f.registry,activeRuns:[queued],parentRun:f.parentRun,tasks:[f.task],chiefWorkspaceEvidence:proof};
 assert.equal(selectQueuedNativeRoleRetry(input).runId,queued.id);
 assert.equal(selectQueuedNativeRoleRetry({...input,chiefWorkspaceEvidence:undefined}),null);
 assert.equal(selectQueuedNativeRoleRetry({...input,activeRuns:[{...queued,status:'scheduled_retry'}]}),null);
});
test('wrong owner/resume/input/workspace, provider uncertainty and any physical evidence remain denied',t=>{
 const changes=[f=>f.parentRun.resultJson.executionRecovery.providerWorkStarted=null,f=>f.parentRun.logBytes=1,f=>delete f.parentRun.nativeSessionId,
  f=>f.parentRun.error='same words from another failure',f=>f.operation.acceptedRunId=randomUUID(),f=>f.operation.artifactGeneration=randomUUID(),f=>f.run.scheduledRetryAttempt=2,
  f=>f.control.completedResume.approvedBy='other',f=>f.control.resumeClaim.operationId=randomUUID(),f=>f.control.pauseRequested=true,f=>f.control.pendingInputs.push({text:'new input'}),
  f=>f.task.description='new goal',f=>f.nativeWorkspace.cwd='/other-source',f=>f.run.contextSnapshot.paperclipWorkspace.workspaceId=randomUUID(),
  f=>f.wakeup.requestedByActorType='user',f=>f.activeRuns.push({...f.run,id:randomUUID()}),f=>f.leases[0].releasedAt=null,f=>f.verifyPhaseLease=()=>false];
 for(const change of changes){const f=fixture(t);change(f);const files=contents(f.root),registry=copy(f.registry);assert.throws(()=>bindUnstartedCompletedResumeChiefRetry(f),/^Error: TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_/);assert.deepEqual(contents(f.root),files);assert.deepEqual(f.registry,registry);}
 for(const which of ['parentRun','run'])for(const prefix of ['permits','claims','results','transport']){const f=fixture(t);f.write(prefix+'/'+f[which].id+(prefix==='transport'?'/request.json':'.json'),{});assert.throws(()=>bindUnstartedCompletedResumeChiefRetry(f),/PHYSICAL_EVIDENCE_PRESENT/);}
 for(const write of [f=>f.write('call.lock',{}),f=>f.write('operations/'+f.operation.id+'.json',{}),f=>f.write('budget/'+f.task.id+'/'+f.operation.id+'.json',{})]){const f=fixture(t);write(f);assert.throws(()=>bindUnstartedCompletedResumeChiefRetry(f),/PHYSICAL_EVIDENCE_PRESENT/);}
});
test('missing physical or Native evidence stays reconciliation unknown and cannot fall into initial admission',async t=>{
 const f=fixture(t);fs.rmSync(f.root+'/budget',{recursive:true});let admissions=0,failure;
 try{await prepareTeamRoleExecution(f.ctx,{database:null,bindNativeRetryAttempt:async()=>{try{return bindUnstartedCompletedResumeChiefRetry(f);}catch(error){throw Object.assign(Error('unknown'),{code:completedResumeChiefRetryEvidenceCode(error)});}},admitChiefInput:async()=>{admissions++;}});}catch(error){failure=teamRoleAdmissionFailure(error);}
 assert.deepEqual(failure.resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});assert.equal(admissions,0);
});
test('the current Native successor must itself be pristine in both queue and running phases',t=>{
 const variants=[['nativeSessionId','observed-provider-session'],['sessionIdBefore','old-provider-session'],['sessionIdAfter','new-provider-session'],
  ['processPid',12345],['processGroupId',12345],['processStartedAt','2026-11-22T06:00:00Z'],['logBytes',1],['logSha256','a'.repeat(64)],
  ['stdoutExcerpt','provider output'],['stderrExcerpt','provider error'],['signal','SIGTERM'],['exitCode',1],['errorCode','interrupted'],['error','unknown execution'],['finishedAt','2026-11-22T06:00:00Z'],
  ['lastOutputSeq',1],['lastOutputAt','2026-11-22T06:00:00Z'],['lastOutputStream','stdout'],['lastOutputBytes',1],['usageJson',{inputTokens:1}],
  ['resultJson',{executionRecovery:{kind:'reconciliation',providerWorkStarted:true}}],['resultJson',{executionRecovery:{kind:'reconciliation',providerWorkStarted:null}}],
  ['resultJson',{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}],['resultJson',{timeoutFired:true}],['resultJson',{outputUnknown:true}],
  ['resultJson',{conversationContinuation:'unknown-policy'}],['resultJson',{conversationContinuation:'continue_conversation_v1',executionRecovery:{providerWorkStarted:true}}],
  ['usageJson',{}],['resultJson',[]]];
 for(const phase of ['queued','running'])for(const [key,value]of variants){
  const f=fixture(t);f.run.status=phase;f.run[key]=value;const before=contents(f.root);
  assert.throws(()=>completedResumeChiefRetryEvidence({...f,phase}),/SUCCESSOR_NOT_PRISTINE/,phase+':'+key);assert.deepEqual(contents(f.root),before);
 }
 for(const key of ['nativeSessionId','processPid','processStartedAt','logBytes','stdoutExcerpt','resultJson','usageJson']){
  const f=fixture(t);delete f.run[key];assert.throws(()=>completedResumeChiefRetryEvidence(f),/SUCCESSOR_NOT_PRISTINE/,'missing:'+key);
 }
 const f=fixture(t),queued={...f.run,status:'queued'},state={...f,run:queued,activeRuns:[queued],taskRuns:f.taskRuns.map(value=>value.id===queued.id?queued:value),ctx:{...f.ctx,context:queued.contextSnapshot},phase:'queued'},proof=completedResumeChiefRetryEvidence(state);
 for(const [key,value]of variants)assert.equal(selectQueuedNativeRoleRetry({registry:f.registry,parentRun:f.parentRun,tasks:[f.task],activeRuns:[{...queued,[key]:value}],chiefWorkspaceEvidence:proof}),null,'selector:'+key);
});
test('Native controller start time and exact continuation marker are not mistaken for provider work',t=>{
 for(const resultJson of [null,{}, {conversationContinuation:'continue_conversation_v1'}]){
  const f=fixture(t);f.run.resultJson=resultJson;f.run.startedAt=new Date('2026-11-22T06:00:00Z');
  assert.equal(completedResumeChiefRetryEvidence(f).spentBeforeCurrent,4);
 }
 const f=fixture(t);f.run.logBytes=0;f.run.logSha256=sha('');f.run.stdoutExcerpt='';f.run.stderrExcerpt='';f.run.lastOutputBytes=0;
 assert.equal(completedResumeChiefRetryEvidence(f).spentBeforeCurrent,4);
});
test('the full queue → actual Native parent → strict selector → production binder chain preserves the old root',async t=>{
 const f=fixture(t);f.run.status='queued';f.activeRuns=[f.run];
 const p=nativeFixture(t,f),budgetBefore=contents(f.root+'/budget'),before={registry:copy(f.registry),parent:copy(f.parentRun),control:copy(f.control)};
 const coordinator=startTeamCoordinator({database:async()=>p,nativePorts:async()=>p});t.after(()=>coordinator.stop());
 await Promise.all([coordinator.tick(),coordinator.tick()]);
 assert.deepEqual(p.resumes,[f.run.id],fs.readFileSync(f.root+'/events.jsonl','utf8'));assert.equal(p.lookups[0],f.parentRun.id);assert.equal(f.run.retryOfRunId,f.parentRun.id);
 const bound=await prepareTeamRoleExecution(f.ctx,{database:async()=>p,bindNativeRetryAttempt,admitChiefInput:async()=>assert.fail('must not readmit the owner root')});
 assert.equal(bound,f.ctx);assert.equal(bound.context.roleOperationId,f.operation.id);assert.equal(f.operation.acceptedRunId,undefined);
 assert.deepEqual(contents(f.root+'/budget'),budgetBefore);assert.deepEqual({registry:f.registry,parent:f.parentRun,control:f.control},before);
 for(const directory of ['permits','claims','results','transport','operations'])assert.equal(fs.existsSync(f.root+'/'+directory),false,directory);
 const events=fs.readFileSync(f.root+'/events.jsonl','utf8').trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(value=>value.code==='TEAM_NATIVE_RETRY_CONSUMER_RESUMED').length,1);
 assert.equal(events.filter(value=>value.code==='TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_VALIDATED').length,1);
});
