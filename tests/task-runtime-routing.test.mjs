import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTaskRuntimeRoute,validateTaskRuntimeRoute,projectTaskRuntimeRoute} from '../bridge/task-runtime-routing.mjs';
import {DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';

const hash='a'.repeat(64),hasCode=code=>error=>error.code===code&&error.message===code;
const copy=value=>structuredClone(value);
function input(overrides={}){
 return{taskId:randomUUID(),rootTaskId:randomUUID(),agentId:randomUUID(),role:'backend-engineer',operationId:randomUUID(),inputRevision:hash,
  selection:{complexity:'routine',risk:'low',purpose:'execution'},...overrides};
}
const identities=value=>Object.fromEntries(['taskId','rootTaskId','agentId','role','operationId','inputRevision'].map(key=>[key,value[key]]));
function registry(route){
 return{schemaVersion:1,runtimeRouting:{schemaVersion:1,mode:'task'},runtimeAssignments:{...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS},
  team:{ids:{[route.role]:route.agentId}},budget:{used:7,maximum:20},evidence:[{original:'keep'}],
  agents:[{profile:{agentId:route.agentId,role:route.role,projectKey:'keep',engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',
   executionPolicy:{...MACOS_NATIVE_EXECUTION_POLICY},sandbox:'none',dangerouslyBypassApprovalsAndSandbox:true,
   tools:['shell'],permissions:{keep:true}},manifest:{keep:'unchanged'}}],
  operations:[{...identities(route),id:route.operationId,kind:'run',additionalInput:'keep',rootBudget:7}]};
}
function handoff(previousRoute){
 const runId=randomUUID();
 return{previousRoute,previousRun:{id:runId,issueId:previousRoute.taskId,agentId:previousRoute.agentId,status:'succeeded',finishedAt:new Date()},
  transport:{runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:hash,stderrSha256:hash},executionClosed:true,
  budgetUsedBefore:8,artifacts:[{file:'versionedhandoff/'+runId+'/csv.mjs',sha256:hash,runId}],
  material:{file:'versionedhandoff/'+runId+'/handoff.json',sha256:hash}};
}
function next(previous,overrides={}){
 return input({...identities(previous),operationId:randomUUID(),selection:{complexity:'complex',risk:'low',purpose:'execution'},handoff:handoff(previous),...overrides});
}
function appendOperation(r,route){r.operations.push({...identities(route),id:route.operationId,kind:'run'});return r;}

test('routes preserve implicit selection and return canonical task policy profiles',()=>{
 for(const [role,selection,profileId,reason]of [
  ['backend-engineer',{complexity:'routine',risk:'low',purpose:'execution'},'minimax_opencode','routine_execution'],
  ['research',{complexity:'routine',risk:'low',purpose:'research'},'deepseek_opencode','routine_research'],
  ['pm',{},'codex_subscription','core_role']]){
  const original=input({role,selection}),before=copy(original),route=createTaskRuntimeRoute(original);
  assert.deepEqual(original,before);assert.deepEqual(route.selection,selection);assert.ok(!Object.hasOwn(route.selection,'profileId'));
  assert.equal(route.schemaVersion,1);assert.equal(route.profileId,profileId);assert.equal(route.reason,reason);
  assert.equal(validateTaskRuntimeRoute(route,identities(original)),RUNTIME_PROFILES[profileId]);
  assert.notEqual(route.id,route.operationId);assert.ok(Number.isFinite(Date.parse(route.createdAt)));
 }
 const original=input({selection:{complexity:'routine',risk:'low',purpose:'execution',profileId:'deepseek_opencode'}}),route=createTaskRuntimeRoute(original);
 assert.deepEqual(route.selection,original.selection);assert.equal(route.reason,'explicit_profile');
 original.selection.profileId='minimax_opencode';assert.equal(route.selection.profileId,'deepseek_opencode');
});

test('route validation rejects policy tampering, wrong identity and hidden session fields',()=>{
 const route=createTaskRuntimeRoute(input());
 for(const mutate of [r=>{r.profileId='deepseek_opencode';},r=>{r.reason='explicit_profile';},r=>{r.selection.profileId=r.profileId;},
  r=>{r.id='invalid';},r=>{r.schemaVersion=2;},r=>{r.createdAt='invalid';},r=>{r.inputRevision='bad';},r=>{r.sessionId='secret';}]){
  const changed=copy(route);mutate(changed);assert.throws(()=>validateTaskRuntimeRoute(changed,identities(route)));
 }
 for(const field of ['taskId','rootTaskId','agentId','role','operationId','inputRevision'])assert.throws(()=>validateTaskRuntimeRoute(route,{...identities(route),[field]:field==='inputRevision'?'b'.repeat(64):randomUUID()}));
 for(const changes of [{taskId:'bad'},{inputRevision:'secret'},{selection:{risk:'secret'}},{sessionId:'secret'}])assert.throws(()=>createTaskRuntimeRoute({...input(),...changes}),error=>!error.message.includes('secret'));
});

test('handoff stores bounded immutable evidence references without run, transport or session payloads',()=>{
 const previous=createTaskRuntimeRoute(input()),value=next(previous),before=copy(value),route=createTaskRuntimeRoute(value);
 assert.deepEqual(value,before);assert.equal(validateTaskRuntimeRoute(route,identities(value)),RUNTIME_PROFILES.codex_subscription);
 assert.deepEqual(Object.keys(route.handoff).sort(),['previousRouteId','fromRunId','fromProfileId','fromAgentId','fromRole','budgetUsedBefore','artifacts','material'].sort());
 assert.equal(route.handoff.previousRouteId,previous.id);assert.equal(route.handoff.fromRunId,value.handoff.previousRun.id);
 assert.equal(route.handoff.fromProfileId,previous.profileId);assert.deepEqual(route.handoff.material,value.handoff.material);
 value.handoff.artifacts[0].file='changed';assert.notEqual(route.handoff.artifacts[0].file,'changed');
});

test('handoff refuses unsuccessful, unknown, active and cross-task predecessors',()=>{
 const previous=createTaskRuntimeRoute(input());
 const mutations=[v=>{v.handoff.previousRun.status='failed';},v=>{v.handoff.previousRun.finishedAt=null;},
  v=>{v.handoff.previousRun.issueId=randomUUID();},v=>{v.handoff.previousRun.agentId=randomUUID();},v=>{v.handoff.transport.runId=randomUUID();},
  v=>{v.handoff.transport.exitCode=1;},v=>{v.handoff.transport.signal='SIGTERM';},v=>{v.handoff.transport.timedOut=true;},
  v=>{v.handoff.transport.cancelled=true;},v=>{v.handoff.transport.outputUnknown=true;},v=>{delete v.handoff.transport.outputUnknown;},
  v=>{v.handoff.executionClosed=false;},v=>{v.handoff.budgetUsedBefore=0;},v=>{v.handoff.budgetUsedBefore=1.5;},
  v=>{v.operationId=previous.operationId;},v=>{v.rootTaskId=randomUUID();},v=>{v.taskId=randomUUID();},
  v=>{v.agentId=randomUUID();},v=>{v.role='frontend-engineer';}];
 for(const mutate of mutations){const value=next(previous);mutate(value);assert.throws(()=>createTaskRuntimeRoute(value));}
});

test('serialized handoff validation rejects traversal, unbounded evidence and mixed run provenance',()=>{
 const previous=createTaskRuntimeRoute(input()),route=createTaskRuntimeRoute(next(previous));
 for(const file of ['/tmp/file','../file','snap/../file','snap/./file','snap//file','C:\\file','snap\\file','https://host/file','snap/%2e%2e/file','snap/\0file']){
  const changed=copy(route);changed.handoff.artifacts[0].file=file;assert.throws(()=>validateTaskRuntimeRoute(changed));
 }
 for(const mutate of [r=>{r.handoff.artifacts=[];},r=>{r.handoff.artifacts=Array(33).fill(r.handoff.artifacts[0]);},
  r=>{r.handoff.artifacts.push(copy(r.handoff.artifacts[0]));},r=>{r.handoff.artifacts[0].runId=randomUUID();},
  r=>{r.handoff.material.sha256='bad';},r=>{r.handoff.fromProfileId='other';},r=>{r.handoff.previousRouteId=r.id;},
  r=>{r.handoff.sessionId='private';},r=>{r.handoff.artifacts[0].content='prompt';}]){
  const changed=copy(route);mutate(changed);assert.throws(()=>validateTaskRuntimeRoute(changed));
 }
});

test('projection clones registry, preserves budgets, tools, permissions and evidence, and updates runtime fields',()=>{
 const route=createTaskRuntimeRoute(input()),r=registry(route),before=copy(r),projected=projectTaskRuntimeRoute(r,route),p=projected.agents[0].profile;
 assert.deepEqual(r,before);assert.equal(projected.runtimeAssignments[route.role],'minimax_opencode');
 assert.equal(projected.runtimeAssignments.pm,'codex_subscription');assert.deepEqual(projected.budget,r.budget);assert.deepEqual(projected.evidence,r.evidence);
 assert.deepEqual(p.executionPolicy,r.agents[0].profile.executionPolicy);assert.deepEqual(p.permissions,r.agents[0].profile.permissions);assert.deepEqual(p.tools,['shell']);
 assert.equal(p.engine,'opencode_local');assert.equal(p.model,RUNTIME_PROFILES.minimax_opencode.model);assert.equal(p.reasoningEffort,null);
 assert.equal(p.dangerouslySkipPermissions,true);assert.ok(!Object.hasOwn(p,'dangerouslyBypassApprovalsAndSandbox'));
 assert.deepEqual(projected.operations[0],{...r.operations[0],taskRuntimeRoute:route});assert.deepEqual(projected.taskRuntimeRoutes,[route]);
 assert.deepEqual(projectTaskRuntimeRoute(projected,route),projected);
 projected.taskRuntimeRoutes[0].selection.risk='high';assert.equal(route.selection.risk,'low');
});

test('Claude API profile projection preserves the same native execution policy and permission boundary',()=>{
 for(const profileId of ['deepseek_claude','minimax_claude']){
  const route=createTaskRuntimeRoute(input({selection:{complexity:'routine',risk:'low',purpose:'execution',profileId}})),r=registry(route),before=copy(r);
  const result=projectTaskRuntimeRoute(r,route),p=result.agents[0].profile;
  assert.deepEqual(r,before);assert.equal(p.engine,'claude_local');assert.equal(p.model,RUNTIME_PROFILES[profileId].model);assert.equal(p.reasoningEffort,null);
  assert.equal(p.dangerouslySkipPermissions,true);assert.ok(!Object.hasOwn(p,'dangerouslyBypassApprovalsAndSandbox'));assert.ok(!Object.hasOwn(p,'dangerouslyBypassSandbox'));
  for(const field of ['tools','permissions','executionPolicy','sandbox'])assert.deepEqual(p[field],before.agents[0].profile[field]);
 }
});

test('same-task model switch requires latest explicit handoff and retains all historical route bytes',()=>{
 const previous=createTaskRuntimeRoute(input()),first=projectTaskRuntimeRoute(registry(previous),previous);
 const noHandoff=createTaskRuntimeRoute(next(previous,{handoff:undefined}));
 assert.throws(()=>projectTaskRuntimeRoute(appendOperation(copy(first),noHandoff),noHandoff),hasCode('TASK_RUNTIME_HANDOFF_REQUIRED'));
 const route=createTaskRuntimeRoute(next(previous)),r=appendOperation(copy(first),route),result=projectTaskRuntimeRoute(r,route);
 assert.deepEqual(result.taskRuntimeRoutes,[previous,route]);assert.deepEqual(result.operations[0],first.operations[0]);assert.deepEqual(result.budget,first.budget);
 assert.equal(result.agents[0].profile.engine,'codex_local');assert.equal(result.agents[0].profile.dangerouslyBypassApprovalsAndSandbox,true);
 assert.ok(!Object.hasOwn(result.agents[0].profile,'dangerouslySkipPermissions'));
 const stale=createTaskRuntimeRoute(next(previous));assert.throws(()=>projectTaskRuntimeRoute(appendOperation(result,stale),stale),hasCode('TASK_RUNTIME_HANDOFF_BINDING_DENIED'));
 const fresh=createTaskRuntimeRoute(input({...identities(previous),operationId:randomUUID()}));
 const continued=projectTaskRuntimeRoute(appendOperation(copy(first),fresh),fresh);assert.equal(continued.taskRuntimeRoutes.length,2);
});

test('projection rejects missing, started, mismatched and already-bound operations',()=>{
 const route=createTaskRuntimeRoute(input());
 for(const mutate of [r=>{r.operations=[];},r=>{r.operations.push(copy(r.operations[0]));},r=>{r.operations[0].runId=randomUUID();},
  r=>{r.operations[0].startedAt=new Date().toISOString();},r=>{r.operations[0].status='running';},r=>{r.operations[0].kind='probe';},
  r=>{r.operations[0].taskId=randomUUID();},r=>{r.operations[0].taskRuntimeRoute={...route,id:randomUUID()};},
  r=>{r.agents[0].profile.agentId=randomUUID();},r=>{r.team.ids[route.role]=randomUUID();},r=>{r.runtimeRouting.mode='role';}]){
  const r=registry(route);mutate(r);const before=copy(r);assert.throws(()=>projectTaskRuntimeRoute(r,route));assert.deepEqual(r,before);
 }
 const r=registry(route);r.operations[0].taskRuntimeRoute=copy(route);assert.equal(projectTaskRuntimeRoute(r,route).taskRuntimeRoutes.length,1);
});

test('explicit Full Stack to specialist transfer derives old ownership from the previous route and actual run',()=>{
 const previous=createTaskRuntimeRoute(input({role:'full-stack-engineer'})),value=next(previous,{agentId:randomUUID(),role:'backend-engineer'});
 value.handoff.handoffKind='role-transfer';value.handoff.actorScopeClosed=true;
 const route=createTaskRuntimeRoute(value);
 assert.equal(route.handoff.handoffKind,'role-transfer');assert.equal(route.handoff.fromAgentId,previous.agentId);assert.equal(route.handoff.fromRole,'full-stack-engineer');
 assert.equal(route.taskId,previous.taskId);assert.equal(route.rootTaskId,previous.rootTaskId);assert.equal(validateTaskRuntimeRoute(route),RUNTIME_PROFILES.codex_subscription);
 for(const mutate of [v=>{delete v.handoff.handoffKind;},v=>{delete v.handoff.actorScopeClosed;},v=>{v.handoff.actorScopeClosed=false;},
  v=>{v.handoff.previousRun.agentId=v.agentId;},v=>{v.handoff.fromAgentId=v.agentId;}]){
  const changed=copy(value);mutate(changed);assert.throws(()=>createTaskRuntimeRoute(changed));
 }
 const r=registry(previous),target=copy(r.agents[0]);target.profile.agentId=route.agentId;target.profile.role=route.role;r.agents.push(target);r.team.ids[route.role]=route.agentId;
 const first=projectTaskRuntimeRoute(r,previous),original=copy(first);appendOperation(first,route);
 const result=projectTaskRuntimeRoute(first,route);assert.deepEqual(result.taskRuntimeRoutes,[previous,route]);
 assert.deepEqual(result.agents[0],original.agents[0]);assert.deepEqual(result.budget,original.budget);assert.deepEqual(result.evidence,original.evidence);
 assert.equal(result.agents[1].profile.engine,'codex_local');
 const forged=copy(route);delete forged.handoff.handoffKind;assert.throws(()=>validateTaskRuntimeRoute(forged));
});

test('legacy same-owner handoffs remain valid and cannot be reused as implicit actor transfers',()=>{
 const previous=createTaskRuntimeRoute(input()),route=createTaskRuntimeRoute(next(previous));delete route.handoff.fromAgentId;delete route.handoff.fromRole;
 assert.equal(validateTaskRuntimeRoute(route),RUNTIME_PROFILES.codex_subscription);
 const first=projectTaskRuntimeRoute(registry(previous),previous);appendOperation(first,route);assert.equal(projectTaskRuntimeRoute(first,route).taskRuntimeRoutes.length,2);
 const changed=copy(route);changed.agentId=randomUUID();changed.role='frontend-engineer';
 const other=copy(first.agents[0]);other.profile.agentId=changed.agentId;other.profile.role=changed.role;first.agents.push(other);first.team.ids[changed.role]=changed.agentId;
 first.operations[first.operations.length-1]={...first.operations.at(-1),agentId:changed.agentId,role:changed.role};
 assert.throws(()=>projectTaskRuntimeRoute(first,changed));
});
