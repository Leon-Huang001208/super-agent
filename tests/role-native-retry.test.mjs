import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {requireNoPendingOwnerInput,resolveNativeRetryScope,assertNativeRetryControl} from '../bridge/team-native-runtime.mjs';
import {validateNativeRoleRetry,advanceNativeRetryFlow,archiveNativeRetryFailure,clearArchivedRetryLock,rebindNativeRetryContext,NATIVE_RETRY_CONTEXT} from '../bridge/role-native-retry.mjs';

const id=n=>n.repeat(8)+'-'+n.repeat(4)+'-4'+n.repeat(3)+'-8'+n.repeat(3)+'-'+n.repeat(12);
function fixture(){
 const companyId=id('a'),rootId=id('b'),taskId=id('c'),agentId=id('d'),parentId=id('e'),runId=id('f'),operationId=id('1');
 const rootTask={id:rootId,companyId,projectId:id('2'),title:'Original goal',description:'Keep the same goal',status:'in_review',responsibleUserId:'owner',assigneeUserId:'owner',assigneeAgentId:null,executionRunId:null,checkoutRunId:null};
 const task={id:taskId,parentId:rootId,companyId,projectId:rootTask.projectId,title:'Read-only backend acceptance',description:'Same child goal',status:'in_progress',responsibleUserId:'owner',assigneeAgentId:agentId,executionRunId:runId};
 const operation={id:operationId,kind:'run',role:'backend-engineer',agentId,taskId,rootTaskId:rootId,projectId:task.projectId,inputRevision:taskInputRevision(task),rootInputRevision:taskInputRevision(rootTask),phase:'work'};
 const registry={companyId,ownerId:'owner',tasks:[rootId,taskId],taskRoots:{[taskId]:rootId},team:{ids:{'backend-engineer':agentId}},lease:{taskId,projectId:task.projectId,operationId,nonce:'a'.repeat(64)}};
 const flow={rootTaskId:rootId,projectId:task.projectId,inputRevision:taskInputRevision(rootTask),taskEntries:[{id:taskId,key:'backend',role:'backend-engineer',agentId,outputFile:'backend.md'}],dispatches:{backend:{operationId,taskId,role:'backend-engineer',phase:'work',inputRevision:operation.inputRevision,leaseNonce:registry.lease.nonce}},artifacts:{}};
 const parentRun={id:parentId,issueId:taskId,agentId,companyId,status:'failed',exitCode:1,finishedAt:'2026-11-20T07:00:01Z'};
 const run={id:runId,issueId:taskId,agentId,companyId,status:'running',retryOfRunId:parentId,scheduledRetryAttempt:1};
 const callLock={taskId,operationId,nonce:id('3')};
 return {registry,flow,rootTask,task,operation,parentRun,run,callLock,budgetCount:2,
  budgetRecord:{schemaVersion:1,...operation,at:'2026-11-20T07:00:00Z'},operationBinding:{operationId,runId:parentId,taskId,agentId},
  transportResult:{runId:parentId,exitCode:1,signal:null,cancelled:false,outputUnknown:false,timedOut:false,stdoutSha256:'b'.repeat(64),stderrSha256:'c'.repeat(64)},
  stdoutSha256:'b'.repeat(64),stderrSha256:'c'.repeat(64),activeRuns:[run],leases:[{heartbeatRunId:parentId,status:'failed',releasedAt:'2026-11-20T07:00:02Z',cleanupStatus:null}]};
}
test('Native DB successor binds a fresh operation without a new task, wake or budget reset',()=>{
 const f=fixture(),before=structuredClone(f),binding=validateNativeRoleRetry(f);
 const operation={...f.operation,id:id('4'),acceptedRunId:f.run.id,retryOfRunId:f.parentRun.id,retryOfOperationId:f.operation.id,nativeRetryAttempt:1};
 const flow=advanceNativeRetryFlow(f.flow,binding,{operation,parentRun:f.parentRun,evidence:{stdoutSha256:f.stdoutSha256}});
 assert.equal(flow.dispatches.backend.operationId,operation.id);assert.equal(flow.dispatches.backend.taskId,f.task.id);
 assert.equal(flow.attemptHistory.backend[0].operationId,f.operation.id);assert.equal(flow.attemptHistory.backend[0].runId,f.parentRun.id);
 assert.equal(flow.attemptHistory.backend[0].retryRunId,f.run.id);assert.equal(flow.dispatches.backend.leaseNonce,f.registry.lease.nonce);
 assert.deepEqual(f,before);assert.equal(f.budgetCount,2);
});
test('M2 retry selects the original project and exact generation without capturing retired or portable flows',()=>{
 const f=fixture(),personal=id('3'),workspaceId=id('4'),cwd='/paperclip/instances/default/projects/'+f.registry.companyId+'/'+f.task.projectId+'/_default';
 f.registry.team.projectId=personal;f.registry.operations=[f.operation];f.registry.context={schemaVersion:1,enabled:true,catalog:{schemaVersion:1,defaultProjectKey:'personal',projects:[
  {key:'personal',aliases:[],companyId:f.registry.companyId,ownerId:'owner',projectId:personal,adapterKey:'native-docs',allowedRoles:['backend-engineer'],maximumAction:'read_only',workspaceCwd:'/paperclip/instances/default/projects/'+f.registry.companyId+'/'+personal+'/_default'},
  {key:'rwb',aliases:[],companyId:f.registry.companyId,ownerId:'owner',projectId:f.task.projectId,adapterKey:'rwb-docs',allowedRoles:['backend-engineer'],maximumAction:'read_only',workspaceCwd:cwd,projectWorkspaceId:workspaceId}]}};
 f.task.projectWorkspaceId=workspaceId;f.rootTask.projectWorkspaceId=workspaceId;
 const generation=id('5');Object.assign(f.operation,{contextVersion:1,projectKey:'rwb',workspaceCwd:cwd,projectWorkspaceId:workspaceId,artifactGeneration:generation});
 Object.assign(f.flow,{contextVersion:1,projectKey:'rwb',workspaceCwd:cwd,projectWorkspaceId:workspaceId,artifactGeneration:generation});
 const retired={...structuredClone(f.flow),artifactGeneration:id('6'),dispatches:{backend:{...f.flow.dispatches.backend,operationId:id('7')}}};
 const before=structuredClone(f.registry),resolved=resolveNativeRetryScope({...f,flows:[{file:'retired',flow:retired},{file:'current',flow:f.flow}],log(){}});
 assert.equal(resolved.registry.team.projectId,f.task.projectId);assert.equal(resolved.registry.contextProject.workspaceCwd,cwd);
 assert.equal(resolved.file,'current');assert.equal(resolved.flow.artifactGeneration,generation);assert.deepEqual(f.registry,before);
 const control={managed:true,inputRevision:taskInputRevision(f.rootTask),projectWorkspaceId:workspaceId,pendingInputs:[],pauseRequested:false,reviewBeforeDispatch:false};
 assert.doesNotThrow(()=>assertNativeRetryControl({registry:resolved.registry,rootTask:f.rootTask,flow:f.flow,control}));
 for(const change of [{pauseRequested:true},{pendingInputs:[{text:'owner supplement'}]},{inputRevision:'f'.repeat(64)},{projectWorkspaceId:id('8')},{reviewBeforeDispatch:true}])
  assert.throws(()=>assertNativeRetryControl({registry:resolved.registry,rootTask:f.rootTask,flow:f.flow,control:{...control,...change}}),/TEAM_NATIVE_RETRY_CONTROL_CHANGED/);
 assert.throws(()=>assertNativeRetryControl({registry:resolved.registry,rootTask:f.rootTask,flow:f.flow,control:null}),/TEAM_NATIVE_RETRY_CONTROL_CHANGED/);
 assert.throws(()=>resolveNativeRetryScope({...f,task:{...f.task,projectWorkspaceId:id('8')},flows:[{file:'current',flow:f.flow}],log(){}}),/CONTEXT|TEAM_NATIVE_RETRY/);
 const old={...f.operation};for(const key of ['contextVersion','projectKey','workspaceCwd','projectWorkspaceId','artifactGeneration'])delete old[key];
 const oldFlow={...f.flow};for(const key of ['contextVersion','projectKey','workspaceCwd','projectWorkspaceId','artifactGeneration'])delete oldFlow[key];
 assert.equal(resolveNativeRetryScope({...f,operation:old,flows:[{file:'legacy',flow:oldFlow}],log(){}}).registry.context.enabled,false);
});
test('missing or uncertain Native, transport, authority, lease and budget proof refuses a rebind',()=>{
 const cases=[f=>{f.run.retryOfRunId=null;f.run.contextSnapshot={retryOfRunId:f.parentRun.id};},f=>{f.run.status='scheduled_retry';},f=>{f.run.scheduledRetryAttempt=3;},f=>{f.parentRun.status='running';},f=>{f.parentRun.finishedAt=null;},
  f=>{f.transportResult.outputUnknown=true;},f=>{f.transportResult.cancelled=true;},f=>{f.transportResult.timedOut=true;},f=>{f.stdoutSha256='d'.repeat(64);},f=>{f.transportResult.runId=id('5');},
  f=>{f.callLock.operationId=id('5');},f=>{f.registry.lease.taskId=id('5');},f=>{f.budgetRecord.id=id('5');},f=>{f.budgetCount=6;},
  f=>{f.rootTask.status='blocked';},f=>{f.rootTask.responsibleUserId='other';},f=>{f.task.description='changed';},f=>{f.flow.dispatches.backend.operationId=id('5');},
  f=>{f.activeRuns.push({id:id('5'),status:'queued'});},f=>{f.leases[0].releasedAt=null;},f=>{f.flow.artifacts.backend={runId:f.parentRun.id};}];
 for(const mutate of cases){const f=fixture();mutate(f);assert.throws(()=>validateNativeRoleRetry(f),/^Error: TEAM_NATIVE_RETRY_/);}
});
test('a replay of the same Native successor preserves its attempt history',()=>{
 const f=fixture(),binding=validateNativeRoleRetry(f),operation={...f.operation,id:id('4'),acceptedRunId:f.run.id,retryOfRunId:f.parentRun.id,retryOfOperationId:f.operation.id,nativeRetryAttempt:1};
 const flow=advanceNativeRetryFlow(f.flow,binding,{operation,parentRun:f.parentRun,evidence:{}});
 assert.deepEqual(advanceNativeRetryFlow(flow,binding,{operation,parentRun:f.parentRun,evidence:{}}),flow);
 f.existingOperation=operation;f.registry.lease.operationId=operation.id;
 assert.equal(validateNativeRoleRetry(f).replay,true);
 f.flow=flow;assert.equal(validateNativeRoleRetry(f).replay,true);
 f.existingOperation={...operation,projectId:id('5')};assert.throws(()=>validateNativeRoleRetry(f),/FLOW_CHANGED/);
});
test('the second Native repair remains in the same six-slot root and a third is refused',()=>{
 const f=fixture();f.parentRun.scheduledRetryAttempt=1;f.run.scheduledRetryAttempt=2;f.flow.attemptHistory={backend:[{runId:id('6')}]};f.budgetCount=3;
 assert.equal(validateNativeRoleRetry(f).attempt,2);
 f.run.scheduledRetryAttempt=3;f.parentRun.scheduledRetryAttempt=2;assert.throws(()=>validateNativeRoleRetry(f),/RUN_DENIED/);
});
test('retry context keeps the actual Native session, root goal and run while selecting its new operation',()=>{
 const f=fixture(),ctx={runId:f.run.id,agent:{id:f.run.agentId},runtime:{sessionId:'native-owned-existing-session'},context:{issueId:f.task.id,roleOperationId:f.operation.id,taskGoal:'Original goal',forceFreshSession:false}};
 const next=rebindNativeRetryContext(ctx,{...f.operation,id:id('4')});
 assert.equal(next.runId,ctx.runId);assert.equal(next.runtime,ctx.runtime);assert.equal(next.context.taskGoal,'Original goal');assert.equal(next.context.forceFreshSession,false);assert.equal(next.context.roleOperationId,id('4'));assert.equal(ctx.context.roleOperationId,f.operation.id);
 assert.match(NATIVE_RETRY_CONTEXT,/settled failed attempt/);assert.match(NATIVE_RETRY_CONTEXT,/actual tool results/);
});
test('failed artifact and original lock are archived before clearing only that exact lock',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-retry-'));t.after(()=>fs.rmSync(root,{recursive:true}));
 const f=fixture();fs.writeFileSync(root+'/call.lock',JSON.stringify(f.callLock)+'\n',{mode:0o600});
 const bytes=Buffer.from('Partial failed artifact remains evidence.');
 const receipt=archiveNativeRetryFailure({root,parentRun:f.parentRun,operation:f.operation,callLock:f.callLock,artifact:{file:'backend.md',data:bytes},log(){}});
 assert.equal(fs.existsSync(root+'/call.lock'),true);assert.equal(fs.readFileSync(receipt.artifact.path,'utf8'),bytes.toString());
 assert.equal(receipt.artifact.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(fs.statSync(receipt.artifact.path).mode&0o777,0o400);
 fs.writeFileSync(root+'/call.lock',JSON.stringify({...f.callLock,nonce:id('5')})+'\n');
 assert.throws(()=>clearArchivedRetryLock({root,callLock:f.callLock,archive:receipt,log(){}}),/LOCK_CHANGED/);assert.equal(fs.existsSync(root+'/call.lock'),true);
 fs.writeFileSync(root+'/call.lock',JSON.stringify(f.callLock)+'\n');
 clearArchivedRetryLock({root,callLock:f.callLock,archive:receipt,log(){}});
 assert.equal(fs.existsSync(root+'/call.lock'),false);assert.equal(fs.readFileSync(receipt.artifact.path,'utf8'),bytes.toString());
});
test('an incompatible existing archive cannot clear the original fence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-retry-archive-'));t.after(()=>fs.rmSync(root,{recursive:true}));const f=fixture();
 fs.writeFileSync(root+'/call.lock',JSON.stringify(f.callLock)+'\n',{mode:0o600});
 const first=archiveNativeRetryFailure({root,parentRun:f.parentRun,operation:f.operation,callLock:f.callLock,artifact:{file:'backend.md',data:Buffer.from('first failed output')},log(){}});
 assert.throws(()=>archiveNativeRetryFailure({root,parentRun:f.parentRun,operation:f.operation,callLock:f.callLock,artifact:{file:'backend.md',data:Buffer.from('replacement')},log(){}}),/ARCHIVE_CHANGED/);
 assert.equal(fs.existsSync(root+'/call.lock'),true);assert.equal(fs.readFileSync(first.artifact.path,'utf8'),'first failed output');
});
test('Native queued owner inputs on the root or child block the existing retry admission gate',async()=>{
 const f=fixture(),table={id:'id',companyId:'companyId',requestedByActorType:'actorType',status:'status',payload:'payload'};
 const orm={and:(...conditions)=>row=>conditions.every(test=>test(row)),eq:(field,value)=>row=>row[field]===value,inArray:(field,values)=>row=>values.includes(row[field]),sql:(_parts,_payload,issueId)=>row=>row.payload.issueId===issueId};
 let wakes=[];
 const db={select:()=>({from:actual=>{assert.equal(actual,table);return{where:test=>({limit:async limit=>wakes.filter(test).slice(0,limit)})};}})};
 const p={db,schema:{agentWakeupRequests:table},orm};
 for(const taskId of [f.rootTask.id,f.task.id])for(const status of ['queued','deferred_issue_execution']){
  wakes=[{id:'wake',companyId:f.registry.companyId,actorType:'user',status,payload:{issueId:taskId}}];
  await assert.rejects(requireNoPendingOwnerInput(p,f.registry,taskId),/TEAM_PENDING_OWNER_INPUT/);
 }
 for(const other of [{companyId:'other'},{actorType:'agent'},{status:'completed'},{payload:{issueId:'another-task'}}]){
  wakes=[{companyId:f.registry.companyId,actorType:'user',status:'queued',payload:{issueId:f.rootTask.id},...other}];
  await requireNoPendingOwnerInput(p,f.registry,f.rootTask.id);
 }
});
