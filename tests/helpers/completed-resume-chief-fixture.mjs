import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {taskInputRevision} from '../../bridge/task-input.mjs';
import {teamArtifactNames} from '../../bridge/team-context.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),copy=value=>structuredClone(value),R='/paperclip/control/research-pm';
export function fixture(t){
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
  stdoutExcerpt:'',stderrExcerpt:'',logBytes:0,logSha256:sha(''),nativeSessionId:null,sessionIdBefore:null,sessionIdAfter:null,processPid:null,processGroupId:null,processStartedAt:null,
  lastOutputSeq:0,lastOutputAt:null,lastOutputStream:null,lastOutputBytes:null,contextSnapshot:copy(context)};
 const run={id:retryId,companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'running',retryOfRunId:parentId,scheduledRetryAttempt:1,contextSnapshot:copy(context),
  startedAt:null,finishedAt:null,exitCode:null,signal:null,errorCode:null,error:null,stdoutExcerpt:null,stderrExcerpt:null,logBytes:null,logSha256:null,
  nativeSessionId:null,sessionIdBefore:null,sessionIdAfter:null,processPid:null,processGroupId:null,processStartedAt:null,usageJson:null,
  costAccountingPending:false,costAccountedAt:null,accountingAttemptCount:0,accountingLastAttemptAt:null,accountingLastError:null,accountingProjectionVersion:null,
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
export const contents=root=>fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>entry.isDirectory()?contents(path.join(root,entry.name)):[[path.join(root,entry.name),sha(fs.readFileSync(path.join(root,entry.name)))]]);

export function controlledPreflight(f){
 f.initialRun=f.parentRun;
 f.parentRun={...copy(f.initialRun),id:randomUUID(),retryOfRunId:f.initialRun.id,scheduledRetryAttempt:1,
  errorCode:'TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_SUCCESSOR_NOT_PRISTINE',error:'The controlled Native intake or retry did not admit this execution.',
  processStartedAt:null,lastOutputSeq:0,lastOutputAt:null,lastOutputStream:null,lastOutputBytes:null,
  resultJson:{...copy(f.initialRun.resultJson),executionRecovery:{kind:'reconciliation',providerWorkStarted:null}}};
 f.run.retryOfRunId=f.parentRun.id;f.run.scheduledRetryAttempt=2;
 f.taskRuns.splice(f.taskRuns.length-1,0,f.parentRun);f.leases.push({heartbeatRunId:f.parentRun.id,status:'released',releasedAt:f.parentRun.finishedAt,cleanupStatus:null});
 f.reconciledPreflightRun=copy(f.parentRun);return f;
}

export function nativeFixture(t,f){
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
 return{db,schema,orm,lookups,resumes,validateExecutionReconciliation:async input=>{assert.equal(input.sourceRunId,f.parentRun.id);return f.reconciledPreflightRun;},verifyPhaseLease:lease=>{assert.deepEqual(lease,f.registry.lease);return true;},issue:{getById:async id=>id===f.task.id?f.task:null},heartbeat:{resumeQueuedRunsForAgent:async(company,agent)=>{
  assert.equal(company,f.registry.companyId);assert.equal(agent,f.operation.agentId);resumes.push(f.run.id);f.run.status='running';f.run.startedAt=new Date('2026-11-22T06:00:00.000Z');f.task.executionRunId=f.run.id;f.task.checkoutRunId=f.run.id;return[{id:f.run.id}];
 }}};
}
