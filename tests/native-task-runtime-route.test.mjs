import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {assertNativeTaskRuntimeRoute} from '../bridge/native-role-runtime.mjs';
import {createTaskRuntimeRoute,projectTaskRuntimeRoute} from '../bridge/task-runtime-routing.mjs';
import {DEFAULT_ROLE_RUNTIME_ASSIGNMENTS} from '../bridge/role-runtime-profiles.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function setup(t,initialRole='backend-engineer'){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-task-route-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const task={id:randomUUID(),title:'CSV',description:'same task'},rootTaskId=randomUUID(),agentId=randomUUID(),companyId=randomUUID(),projectId=randomUUID();
 task.projectId=projectId;
 const role={profile:{agentId,projectId,role:initialRole,engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',sandbox:'none',tools:[],executionPolicy:MACOS_NATIVE_EXECUTION_POLICY}};
 let registry={companyId,runtimeRouting:{schemaVersion:1,mode:'task'},runtimeAssignments:{...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS},agents:[role],operations:[]};
 const make=selection=>{const id=randomUUID();return createTaskRuntimeRoute({taskId:task.id,rootTaskId,agentId,role:role.profile.role,operationId:id,inputRevision:taskInputRevision(task),selection});};
 const first=make({complexity:'routine',risk:'low',purpose:'execution'});
 const op={id:first.operationId,taskId:task.id,rootTaskId,agentId,role:role.profile.role,kind:'run',inputRevision:first.inputRevision,taskRuntimeRoute:first};
 registry.operations.push(op);registry=projectTaskRuntimeRoute(registry,first);
 return{root,task,rootTaskId,agentId,companyId,projectId,registry,first,op,make};
}
test('Native rejects an API binding without an exact task route and immutable history',async t=>{
 const f=setup(t),call=registry=>assertNativeTaskRuntimeRoute({registry,role:registry.agents[0],task:f.task,operation:f.op,root:f.root});
 assert.equal((await call(f.registry)).id,'minimax_opencode');
 const noMode=structuredClone(f.registry);delete noMode.runtimeRouting;
 await assert.rejects(call(noMode),/TASK_ROUTE_REQUIRED/);
 const changed=structuredClone(f.registry);changed.operations[0].taskRuntimeRoute.selection.risk='high';
 await assert.rejects(assertNativeTaskRuntimeRoute({registry:changed,role:changed.agents[0],task:f.task,operation:changed.operations[0],root:f.root}));
 const noHistory=structuredClone(f.registry);noHistory.taskRuntimeRoutes=[];await assert.rejects(call(noHistory),/TASK_ROUTE_CHANGED/);
});
test('Native Full Stack handoff checks the real old actor and final specialist ownership in the task project',async t=>{
 const f=setup(t,'full-stack-engineer'),runId=randomUUID(),targetId=randomUUID(),run={id:runId,issueId:f.task.id,agentId:f.agentId,companyId:f.companyId,status:'succeeded',finishedAt:new Date()};
 const artifactRoot=f.root+'/artifacts';fs.mkdirSync(artifactRoot);
 const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
 write(artifactRoot+'/previous.mjs','old artifact');write(artifactRoot+'/handoff.md','specialist scope');
 const transport={runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:sha('ok'),stderrSha256:sha('')};
 const next=createTaskRuntimeRoute({taskId:f.task.id,rootTaskId:f.rootTaskId,agentId:targetId,role:'backend-engineer',operationId:randomUUID(),inputRevision:taskInputRevision(f.task),selection:{complexity:'complex',risk:'high',purpose:'execution'},
  handoff:{handoffKind:'role-transfer',actorScopeClosed:true,previousRoute:f.first,previousRun:run,transport,executionClosed:true,budgetUsedBefore:1,artifacts:[{file:'previous.mjs',sha256:sha('old artifact'),runId}],material:{file:'handoff.md',sha256:sha('specialist scope')}}});
 f.registry.agents.push({profile:{...f.registry.agents[0].profile,agentId:targetId,role:'backend-engineer',engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low'}});
 // An M2 Agent may have a different default project; the old task operation carries its actual project authority.
 f.registry.agents[0].profile.projectId=randomUUID();f.registry.operations[0].projectId=f.projectId;
 const operation={...f.op,id:next.operationId,agentId:targetId,role:'backend-engineer',taskRuntimeRoute:next};f.registry.operations.push(operation);
 const registry=projectTaskRuntimeRoute(f.registry,next),directory=f.root+'/transport/'+runId;
 write(f.root+'/operations/'+f.first.operationId+'.json',{runId,taskId:f.task.id,agentId:f.agentId});write(f.root+'/budget/'+f.rootTaskId+'/'+f.first.operationId+'.json',{});
 write(directory+'/result.json',transport);write(directory+'/stdout','ok');write(directory+'/stderr','');
 for(const name of ['process-cleanup.json','broker-process-cleanup.json'])write(directory+'/'+name,{status:'terminated'});
 f.task.assigneeAgentId=targetId;
 const call=()=>assertNativeTaskRuntimeRoute({registry,role:registry.agents[1],task:f.task,operation,readRun:async()=>run,root:f.root,artifactRoot,readPrivate:file=>JSON.parse(fs.readFileSync(file))});
 assert.equal((await call()).id,'codex_subscription');
 f.task.assigneeAgentId=f.agentId;await assert.rejects(call(),/HANDOFF_BINDING_DENIED/);f.task.assigneeAgentId=targetId;
 run.agentId=targetId;await assert.rejects(call(),/HANDOFF_RESULT_UNKNOWN/);
});
test('Native handoff rechecks actual terminal run, process closure, hashes and cumulative budget',async t=>{
 const f=setup(t),runId=randomUUID(),run={id:runId,issueId:f.task.id,agentId:f.agentId,companyId:f.companyId,status:'succeeded',finishedAt:new Date()};
 const artifactRoot=f.root+'/artifacts';fs.mkdirSync(artifactRoot);
 const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
 write(artifactRoot+'/old.csv','a,b');write(artifactRoot+'/handoff.md','explicit handoff');
 const transport={runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:sha('output'),stderrSha256:sha('')};
 const next=createTaskRuntimeRoute({taskId:f.task.id,rootTaskId:f.rootTaskId,agentId:f.agentId,role:'backend-engineer',operationId:randomUUID(),inputRevision:taskInputRevision(f.task),selection:{complexity:'complex',risk:'high',purpose:'execution'},
  handoff:{previousRoute:f.first,previousRun:run,transport,executionClosed:true,budgetUsedBefore:1,artifacts:[{file:'old.csv',sha256:sha('a,b'),runId}],material:{file:'handoff.md',sha256:sha('explicit handoff')}}});
 const operation={...f.op,id:next.operationId,taskRuntimeRoute:next};f.registry.operations.push(operation);
 const registry=projectTaskRuntimeRoute(f.registry,next),directory=f.root+'/transport/'+runId;
 write(f.root+'/operations/'+f.first.operationId+'.json',{runId,taskId:f.task.id,agentId:f.agentId});
 write(f.root+'/budget/'+f.rootTaskId+'/'+f.first.operationId+'.json',{});
 write(directory+'/result.json',transport);write(directory+'/stdout','output');write(directory+'/stderr','');
 for(const name of ['process-cleanup.json','broker-process-cleanup.json'])write(directory+'/'+name,{status:'terminated'});
 const call=()=>assertNativeTaskRuntimeRoute({registry,role:registry.agents[0],task:f.task,operation,readRun:async()=>run,root:f.root,artifactRoot,readPrivate:file=>JSON.parse(fs.readFileSync(file))});
 assert.equal((await call()).id,'codex_subscription');
 run.status='running';await assert.rejects(call(),/HANDOFF_RESULT_UNKNOWN/);run.status='succeeded';
 write(directory+'/broker-process-cleanup.json',{status:'unknown'});await assert.rejects(call(),/HANDOFF_EXECUTION_OPEN/);write(directory+'/broker-process-cleanup.json',{status:'terminated'});
 write(artifactRoot+'/old.csv','changed');await assert.rejects(call(),/HANDOFF_EVIDENCE_CHANGED/);write(artifactRoot+'/old.csv','a,b');
 fs.unlinkSync(f.root+'/budget/'+f.rootTaskId+'/'+f.first.operationId+'.json');await assert.rejects(call(),/HANDOFF_BUDGET_CHANGED/);
});
