import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {bindChiefBootstrapRetry,prepareTeamRoleExecution,withChiefBootstrapEvidence,teamRoleAdmissionFailure} from '../bridge/chief-bootstrap-retry.mjs';
import {selectQueuedNativeRoleRetry,consumeQueuedNativeRoleRetry} from '../bridge/role-native-retry-consumer.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chief-bootstrap-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const companyId=randomUUID(),projectId=randomUUID(),agentId=randomUUID(),taskId=randomUUID(),operationId=randomUUID(),parentId=randomUUID(),runId=randomUUID();
 const task={id:taskId,companyId,projectId,title:'Initial owner plan',description:'Make a plan, then wait for supplements',parentId:null,
  createdByAgentId:agentId,responsibleUserId:'owner',status:'in_progress',assigneeAgentId:agentId,assigneeUserId:null,executionRunId:runId,checkoutRunId:runId};
 const operation={id:operationId,kind:'run',role:'chief',phase:'plan',agentId,taskId,rootTaskId:taskId,projectId,contextVersion:1,
  inputRevision:taskInputRevision(task),acceptedRunId:parentId,projectKey:'personal',workspaceCwd:'/paperclip/instances/default/projects/'+companyId+'/'+projectId+'/_default'};
 const registry={enabled:true,companyId,ownerId:'owner',team:{enabled:true,projectId,ids:{chief:agentId}},context:{enabled:true},
  contextProject:{projectId,key:'personal',workspaceCwd:operation.workspaceCwd},agents:[{profile:{role:'chief',agentId,executionPolicy:{...MACOS_NATIVE_EXECUTION_POLICY}}}],tasks:[taskId],taskRoots:{[taskId]:taskId},operations:[operation],
  lease:{taskId,projectId,operationId,nonce:randomUUID()}};
 const wakeup={id:randomUUID(),companyId,agentId,requestedByActorType:'user',requestedByActorId:'owner'};
 const parentRun={id:parentId,companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'failed',exitCode:1,errorCode:'adapter_failed',
  error:JSON.stringify({code:'ROLE_GATE_ARGUMENTS_DENIED',claimed:false}),resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}},
  wakeupRequestId:wakeup.id,scheduledRetryAttempt:0,startedAt:'2026-11-20T11:38:30.454Z',finishedAt:'2026-11-20T11:38:34.370Z'};
 const run={id:runId,companyId,agentId,issueId:taskId,responsibleUserId:'owner',status:'running',retryOfRunId:parentId,scheduledRetryAttempt:1};
 const permit={schemaVersion:1,runId:parentId,companyId,ownerId:'owner',projectId,agentId,taskId,rootTaskId:taskId,role:'chief',inputRevision:operation.inputRevision,cwd:operation.workspaceCwd,expiresAt:1,executionPolicy:{...MACOS_NATIVE_EXECUTION_POLICY}};
 const control={managed:true,inputRevision:operation.inputRevision,pauseRequested:false,pendingInputs:[],reviewBeforeDispatch:true,approvedPlanSha256:null};
 const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});};
 write('permits/'+parentId+'.json',permit);write('budget/'+taskId+'/'+operationId+'.json',{schemaVersion:1,...operation,at:'2026-11-20T11:38:30Z'});
 write('operations/'+operationId+'.json',{operationId,runId:parentId,taskId,agentId});
 const ctx={runId,agent:{id:agentId},runtime:{sessionId:'actual-native-session'},context:{issueId:taskId,forceFreshSession:true}};
 return {root,registry,task,operation,parentRun,run,wakeup,control,permit,flows:[],taskRuns:[parentRun,run],activeRuns:[run],
  leases:[{heartbeatRunId:parentId,status:'failed',releasedAt:'2026-11-20T11:38:34.480Z',cleanupStatus:null}],ctx,write};
}
function admit(f){return bindChiefBootstrapRetry({...f,verifyPhaseLease:()=>true,editRegistry:edit=>{f.registry=edit(structuredClone(f.registry));return f.registry;},log(){}});}

test('bootstrap evidence reads a large permit without widening its budget or operation control files',{skip:process.getuid()!==0},t=>{
 const f=fixture(t);f.permit.padding='x'.repeat(4371200);f.write('permits/'+f.parentRun.id+'.json',f.permit);
 const budgetFile=f.root+'/budget/'+f.task.id+'/'+f.operation.id+'.json',before=fs.readFileSync(budgetFile);
 assert.equal(admit(f).context.roleOperationId,f.registry.operations.at(-1).id);assert.deepEqual(fs.readFileSync(budgetFile),before);
});

test('the same Native initial plan retry binds a new operation while its original spent slot and bytes remain',t=>{
 const f=fixture(t),opBytes=fs.readFileSync(f.root+'/operations/'+f.operation.id+'.json'),budgetFile=f.root+'/budget/'+f.task.id+'/'+f.operation.id+'.json',budgetBytes=fs.readFileSync(budgetFile),before=structuredClone(f.ctx);
 const result=admit(f),next=f.registry.operations.at(-1);
 assert.notEqual(next.id,f.operation.id);assert.equal(next.acceptedRunId,f.run.id);assert.equal(next.retryOfRunId,f.parentRun.id);assert.equal(next.retryOfOperationId,f.operation.id);
 assert.equal(next.rootTaskId,f.task.id);assert.equal(f.registry.lease.operationId,next.id);assert.equal(result.context.roleOperationId,next.id);
 assert.equal(result.context.inputRevision,f.operation.inputRevision);assert.equal(result.context.taskGoal,f.task.description);assert.equal(result.context.responsibleUserId,'owner');
 assert.deepEqual(result.runtime,before.runtime);assert.equal(result.runId,before.runId);assert.equal(result.context.forceFreshSession,true);
 assert.deepEqual(fs.readFileSync(budgetFile),budgetBytes);assert.deepEqual(fs.readFileSync(f.root+'/operations/'+f.operation.id+'.json'),opBytes);
 assert.equal(fs.readdirSync(path.dirname(budgetFile)).length,1);assert.equal(fs.existsSync(f.root+'/call.lock'),false);
 assert.equal(admit(f).context.roleOperationId,next.id);assert.equal(f.registry.operations.length,2);
});

test('Native retry binding runs before initial intake even when its inherited context lacks a role operation',async t=>{
 const f=fixture(t),calls=[];
 const result=await prepareTeamRoleExecution(f.ctx,{database:'same-port',bindNativeRetryAttempt:async(ctx,ports)=>{calls.push(['bind',ports.database]);assert.equal(ctx,f.ctx);return admit(f);},
  admitChiefInput:async()=>assert.fail('must not reserve another lease or owner wake')});
 assert.equal(result.context.roleOperationId,f.registry.operations.at(-1).id);assert.deepEqual(calls,[['bind','same-port']]);
 const fresh={...f.ctx,runId:randomUUID()},order=[];
 await prepareTeamRoleExecution(fresh,{database:null,bindNativeRetryAttempt:async ctx=>{order.push('bind');return ctx;},admitChiefInput:async ctx=>{order.push('admit');return ctx;}});
 assert.deepEqual(order,['bind','admit']);
 let admissions=0;
 await assert.rejects(prepareTeamRoleExecution(f.ctx,{database:null,bindNativeRetryAttempt:async()=>{throw Object.assign(Error('reconcile'),{code:'TEAM_NATIVE_RETRY_BOOTSTRAP_PROVIDER_EVIDENCE'});},admitChiefInput:async()=>{admissions++;}}),{code:'TEAM_NATIVE_RETRY_BOOTSTRAP_PROVIDER_EVIDENCE'});
 assert.equal(admissions,0);
});

test('unknown/provider work, changed authority, consumed retry and owner controls fail before registry mutation',t=>{
 const mutations=[f=>{f.parentRun.resultJson.executionRecovery.providerWorkStarted=true;},f=>{f.parentRun.error=JSON.stringify({code:'ROLE_GATE_ARGUMENTS_DENIED',claimed:true});},
  f=>{f.parentRun.error=null;},f=>{f.parentRun.status='running';},f=>{f.parentRun.finishedAt=null;},f=>{f.run.retryOfRunId=randomUUID();},f=>{f.run.scheduledRetryAttempt=2;},
  f=>{f.operation.role='pm';},f=>{f.operation.phase='summary';},f=>{f.task.parentId=randomUUID();},f=>{f.task.description='new input';},f=>{f.task.responsibleUserId='other';},
  f=>{f.wakeup.requestedByActorType='agent';},f=>{f.control.pauseRequested=true;},f=>{f.control.pendingInputs=[{text:'new owner input'}];},f=>{f.control.inputRevision='a'.repeat(64);},
  f=>{f.control.projectWorkspaceId=randomUUID();},f=>{f.flows=[{flow:{rootTaskId:f.task.id}}];},f=>{f.activeRuns.push({id:randomUUID(),status:'queued'});},f=>{f.leases[0].releasedAt=null;},
  f=>{f.taskRuns.push({...f.parentRun,id:randomUUID(),status:'succeeded'});},f=>{f.registry.lease.nonce=null;},f=>{f.ctx.context.inputRevision='b'.repeat(64);},
  f=>{f.write('claims/'+f.parentRun.id+'.json',{});},f=>{f.write('transport/'+f.parentRun.id+'/request.json',{});},f=>{f.write('results/'+f.parentRun.id+'.json',{});},
  f=>{f.write('call.lock',{operationId:f.operation.id});},f=>{f.write('budget/'+f.task.id+'/'+randomUUID()+'.json',{});},
  f=>{f.write('claims/'+f.run.id+'.json',{});},f=>{f.write('transport/'+f.run.id+'/process.json',{});},
  f=>{f.permit.executionPolicy={executor:'docker',sandbox:'workspace-write',approvalPolicy:'never',docker:'required'};f.write('permits/'+f.parentRun.id+'.json',f.permit);},
  f=>{f.permit.inputRevision='c'.repeat(64);f.write('permits/'+f.parentRun.id+'.json',f.permit);},
  f=>{f.write('operations/'+f.operation.id+'.json',{operationId:f.operation.id,runId:randomUUID(),taskId:f.task.id,agentId:f.run.agentId});}];
 for(const mutate of mutations){const f=fixture(t);mutate(f);const before=structuredClone(f.registry);assert.throws(()=>admit(f),/^Error: TEAM_NATIVE_RETRY_/);assert.deepEqual(f.registry,before);}
});

test('a changed phase lease or registered successor cannot widen a bootstrap re-entry',t=>{
 const f=fixture(t),before=structuredClone(f.registry);
 assert.throws(()=>bindChiefBootstrapRetry({...f,verifyPhaseLease:()=>false,editRegistry:()=>assert.fail('no mutation'),log(){}}),/TEAM_NATIVE_RETRY_BOOTSTRAP_LEASE_CHANGED/);
 assert.deepEqual(f.registry,before);
 admit(f);f.registry.operations.at(-1).authorizedHostActions=['new-unapproved-action'];
 assert.throws(()=>admit(f),/TEAM_NATIVE_RETRY_BOOTSTRAP_OPERATION_CHANGED/);
});

test('an admitted successor cannot re-enter after any physical retry attempt has consumed its own slot',t=>{
 const f=fixture(t);admit(f);const next=f.registry.operations.at(-1);f.write('budget/'+f.task.id+'/'+next.id+'.json',next);
 const before=structuredClone(f.registry);assert.throws(()=>admit(f),/TEAM_NATIVE_RETRY_/);assert.deepEqual(f.registry,before);
});

test('unreadable or malformed physical proof stays unknown through the production evidence and admission boundaries',async t=>{
 for(const corrupt of [f=>{fs.writeFileSync(f.root+'/permits/'+f.parentRun.id+'.json','{');},f=>{fs.chmodSync(f.root+'/permits/'+f.parentRun.id+'.json',0o644);},
  f=>{fs.unlinkSync(f.root+'/operations/'+f.operation.id+'.json');}]){
  const f=fixture(t);corrupt(f);const before=structuredClone(f.registry);let failure,admissions=0;
  try{await prepareTeamRoleExecution(f.ctx,{database:null,bindNativeRetryAttempt:async()=>withChiefBootstrapEvidence(()=>admit(f)),admitChiefInput:async()=>{admissions++;}});}catch(error){failure=teamRoleAdmissionFailure(error);}
  assert.equal(failure.errorCode,'TEAM_NATIVE_RETRY_BOOTSTRAP_EVIDENCE_UNAVAILABLE');assert.deepEqual(failure.resultJson.executionRecovery,{kind:'reconciliation',providerWorkStarted:null});
  assert.equal(admissions,0);assert.deepEqual(f.registry,before);
 }
 assert.deepEqual(teamRoleAdmissionFailure({code:'TEAM_CHIEF_OWNER_INPUT_DENIED'}).resultJson.executionRecovery,{kind:'bootstrap',providerWorkStarted:false});
});

test('only the already queued initial Chief bootstrap retry is passed to the Native consumer',async t=>{
 const f=fixture(t),queued={...f.run,status:'queued'},state={registry:f.registry,activeRuns:[queued],parentRun:f.parentRun,tasks:[f.task]},calls=[];
 assert.deepEqual(selectQueuedNativeRoleRetry(state),{companyId:f.registry.companyId,agentId:f.run.agentId,runId:f.run.id,taskId:f.task.id,rootTaskId:f.task.id});
 assert.equal(await consumeQueuedNativeRoleRetry({...state,resume:async(...args)=>{calls.push(args);return [{id:queued.id}];},log(){}}),true);assert.equal(calls.length,1);
 for(const change of [v=>{v.activeRuns[0].status='scheduled_retry';},v=>{v.parentRun.resultJson.executionRecovery.providerWorkStarted=true;},v=>{v.parentRun.error=JSON.stringify({code:'ROLE_GATE_ARGUMENTS_DENIED',claimed:true});},v=>{v.tasks[0].description='new scope';}]){
  const state2=structuredClone(state);change(state2);assert.equal(selectQueuedNativeRoleRetry(state2),null);
 }
});
