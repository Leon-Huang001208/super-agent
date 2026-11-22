import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID,createHash}from'node:crypto';
import{teamRuntimeProposal,createTeamTaskRuntimeController,dispatchTeamTaskRuntime}from'../bridge/team-task-runtime.mjs';
import{validateTeamPlan,validateTeamRuntimeSelection}from'../bridge/team-plan.mjs';
import{RUNTIME_PROFILES,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS}from'../bridge/role-runtime-profiles.mjs';
import{taskInputRevision}from'../bridge/task-input.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(profileId='minimax_opencode',role='backend-engineer'){
 const profile=RUNTIME_PROFILES[profileId],files=new Map(),runId=randomUUID(),agentId=randomUUID(),rootTaskId=randomUUID(),task={id:randomUUID(),companyId:randomUUID(),projectId:randomUUID(),responsibleUserId:'owner',title:'Task',description:'Original goal',status:'todo',assigneeAgentId:agentId,assigneeUserId:null};
 const ref=(name,value)=>{const file=name+'.json',bytes=Buffer.from(JSON.stringify(value)+'\n');files.set(file,bytes);return{file,sha256:sha(bytes)};};
 const tools=['shell'],receipt={schemaVersion:1,kind:'isolated-runtime-acceptance',id:randomUUID(),status:'PASS',profileId,modelId:profile.providerModel,runtimeId:profile.runtime,taskTypes:['execution','research'],tools,
  evidence:{run:ref('run',{id:runId,issueId:randomUUID(),agentId,status:'succeeded',finishedAt:new Date().toISOString()}),transport:ref('transport',{runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:sha('out'),stderrSha256:sha('err')}),processCleanup:ref('process',{runId,status:'terminated'}),brokerCleanup:ref('broker',{runId,status:'terminated'}),model:ref('model',{runId,profileId,modelId:profile.providerModel,runtimeId:profile.runtime,observed:true}),usage:ref('usage',{runId,inputTokens:10,outputTokens:5}),
   implementation:ref('implementation',{runId,profileId,modelId:profile.providerModel,runtimeId:profile.runtime,sourceSha256:sha('source'),cliSha256:sha('cli'),argsSha256:sha('args'),configSha256:sha('config'),npmCacheVerified:true,freshSession:true}),tools:[]}};
 const request=ref('request',{runId,tool:'shell'});receipt.evidence.tools=[{name:'shell',request,result:ref('result',{runId,status:'succeeded',requestSha256:request.sha256})}];
 const registration={id:randomUUID(),status:'ACTIVE',profileId,modelId:profile.providerModel,runtimeId:profile.runtime,receipt:ref('receipt',receipt),implementationSha256:receipt.evidence.implementation.sha256};
 const proposal={taskId:task.id,rootTaskId,agentId,role,operationId:randomUUID(),inputRevision:taskInputRevision(task),complexity:'routine',risk:'low',purpose:'execution',requiredTools:['shell']};
 let registry={companyId:task.companyId,ownerId:'owner',runtimeRouting:{schemaVersion:1,mode:'task'},runtimeAssignments:{...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS},credentialRefs:{minimax:{type:'secret_ref',secretId:randomUUID(),version:1}},team:{ids:{[role]:agentId}},operations:[{id:proposal.operationId,kind:'run',taskId:task.id,rootTaskId,agentId,role,inputRevision:proposal.inputRevision}],
  agents:[{profile:{agentId,role,engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',sandbox:'none',tools:['shell'],executionPolicy:{executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'}}}]};
 const poolPorts={readOperatorRegistrations:async()=>({schemaVersion:1,operatorId:'owner',entries:[registration]}),readAcceptanceEvidence:async value=>files.get(value.file)};
 const bindings=()=>({[profileId]:{sourceSha256:sha('source'),cliSha256:sha('cli')}});
 return{profile,task,proposal,poolPorts,bindings,get registry(){return registry;},setRegistry:value=>{registry=value;}};
}
test('new Chief runtime metadata is explicit while historical plans default unknown to Codex',()=>{
 const f=fixture(),entry={role:'backend-engineer'};
 assert.equal(teamRuntimeProposal({registry:f.registry,task:f.task,entry,rootTaskId:f.proposal.rootTaskId,operationId:f.proposal.operationId}).complexity,'unknown');
 const runtime={complexity:'routine',risk:'low',purpose:'execution',requiredTools:['shell'],modelId:'MiniMax-M3.1-Flash',runtimeId:'claude'};
 assert.deepEqual(validateTeamRuntimeSelection(runtime,'backend-engineer'),runtime);assert.throws(()=>validateTeamRuntimeSelection(runtime,'qa'),/POLICY_CONFLICT/);
 const plan={schemaVersion:1,tasks:[{key:'research',role:'research',title:'Research',goal:'Read evidence',outputFile:'research.md',dependsOn:[]}]};
 assert.equal(validateTeamPlan(plan,{remainingCalls:3}).tasks.length,1);assert.throws(()=>validateTeamPlan(plan,{remainingCalls:3,taskRuntimeRouting:true}),/RUNTIME_REQUIRED/);
 plan.tasks[0].runtime={...runtime,modelId:'deepseek-flash',runtimeId:'opencode',purpose:'research'};assert.equal(validateTeamPlan(plan,{remainingCalls:3,taskRuntimeRouting:true}).tasks[0].runtime.purpose,'research');
});
test('normal controller rejects absent, stale or tool-incompatible combinations before any configure/wake',async()=>{
 const f=fixture(),controller=createTeamTaskRuntimeController({readRegistry:()=>f.registry,poolPorts:f.poolPorts,implementationBindings:f.bindings});
 assert.equal((await controller.preflight(f.proposal)).choice.profileId,'minimax_opencode');
 await assert.rejects(controller.preflight({...f.proposal,requiredTools:['unproven_tool']}),/TEAM_RUNTIME_TASK_ROUTER_/);
 const stale=createTeamTaskRuntimeController({readRegistry:()=>f.registry,poolPorts:f.poolPorts,implementationBindings:()=>({minimax_opencode:{sourceSha256:sha('changed'),cliSha256:sha('cli')}})});
 await assert.rejects(stale.preflight(f.proposal),/COMBINATION_UNPROVEN/);
 const absent=createTeamTaskRuntimeController({readRegistry:()=>f.registry,poolPorts:{...f.poolPorts,readOperatorRegistrations:async()=>{throw Error('missing');}},implementationBindings:f.bindings});await assert.rejects(absent.preflight(f.proposal),/OPERATOR_INDEX_UNAVAILABLE/);
 const core=fixture('codex_subscription','qa'),coreController=createTeamTaskRuntimeController({readRegistry:()=>core.registry,poolPorts:core.poolPorts,implementationBindings:core.bindings});
 const required={complexity:'routine',risk:'low',purpose:'execution',requiredTools:['host.project_check']};
 for(const entry of [{role:'qa',runtime:required},{role:'backend-engineer',runtime:required}]){
  const role=entry.role,p=teamRuntimeProposal({registry:{...core.registry,team:{ids:{[role]:core.proposal.agentId}}},task:core.task,entry,rootTaskId:core.proposal.rootTaskId,operationId:core.proposal.operationId,repair:role!=='qa'});
  assert.deepEqual(p.requiredTools,['host.project_check']);await assert.rejects(coreController.preflight(p),/TEAM_RUNTIME_TASK_ROUTER_/);
 }
});
test('normal current pool uses only operator-listed compatible sources with an unchanged CLI',async()=>{
 const f=fixture(),index=await f.poolPorts.readOperatorRegistrations();index.entries[0].compatibleSourceSha256=[sha('reviewed')];
 for(const [source,cli,accepted]of [['reviewed','cli',true],['unlisted','cli',false],['reviewed','changed-cli',false]]){
  const controller=createTeamTaskRuntimeController({readRegistry:()=>f.registry,poolPorts:f.poolPorts,implementationBindings:()=>({minimax_opencode:{sourceSha256:sha(source),cliSha256:sha(cli)}})});
  if(accepted)assert.equal((await controller.preflight(f.proposal)).choice.implementation.sourceSha256,sha('source'));
  else await assert.rejects(controller.preflight(f.proposal),/COMBINATION_UNPROVEN/);
 }
});
test('normal shared dispatch persists policy route, configures once and wakes the existing task with preserved budget',async()=>{
 const f=fixture(),events=[];let configured=false;
 const ports={...f.poolPorts,readTaskState:async()=>({registry:structuredClone(f.registry),registrySha256:sha(JSON.stringify(f.registry)),task:f.task,operation:f.registry.operations[0],budgetUsed:7,budgetLimit:20,executionClosed:true,activeRunIds:[],implementationBindings:f.bindings()}),
  persistRoute:async value=>{events.push(value.phase);assert.equal(value.budgetUsedBefore,7);f.setRegistry(value.registry);},configureRuntime:async()=>{configured=true;events.push('configure');},
  wakeup:async value=>{assert.equal(configured,true);assert.equal(value.contextSnapshot.forceFreshSession,true);events.push('wake');return{id:randomUUID(),issueId:f.task.id,agentId:f.proposal.agentId,status:'queued'};},log:()=>{}};
 const result=await dispatchTeamTaskRuntime(f.proposal,ports);assert.equal(result.status,'WOKEN');assert.deepEqual(events,['prepare','configure','wake-attempt','wake']);assert.equal(f.registry.operations[0].taskId,f.task.id);assert.equal(f.registry.taskRuntimeRoutes[0].profileId,'minimax_opencode');
});
test('an already running initial Chief is bound in place without an additional Native wake',async()=>{
 const f=fixture('codex_subscription','chief');f.proposal.complexity='unknown';f.proposal.risk='unknown';const run={id:randomUUID(),issueId:f.task.id,agentId:f.proposal.agentId,companyId:f.task.companyId,status:'running',contextSnapshot:{}};f.registry.operations[0].acceptedRunId=run.id;
 let updated;const native={schema:{heartbeatRuns:{id:'id',companyId:'company',status:'status'}},orm:{eq:()=>true,and:()=>true},db:{update:()=>({set:value=>{updated=value;return{where:()=>({returning:async()=>[{id:run.id}]})};}})},heartbeat:{wakeup:()=>assert.fail('must not create another run')}};
 const controller=createTeamTaskRuntimeController({native,readRegistry:()=>f.registry,editRegistry:edit=>{f.setRegistry(edit(f.registry));return f.registry;},poolPorts:f.poolPorts,implementationBindings:f.bindings,managedWake:async()=>({proof:'real-management-port-injection'})});
 await controller.bindAcceptedChief({task:f.task,operation:f.registry.operations[0],run,proposal:f.proposal});assert.equal(updated.contextSnapshot.roleOperationId,f.proposal.operationId);assert.equal(f.registry.operations[0].acceptedRunId,run.id);assert.equal(f.registry.taskRuntimeRoutes[0].profileId,'codex_subscription');
});
