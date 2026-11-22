import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {TASK_RUNTIME_CATALOG,taskRuntimeImplementationFiles,computeTaskRuntimeImplementationBinding,loadTaskRuntimePool,selectTaskRuntimeCombination,createTaskRuntimeRouter} from '../bridge/task-runtime-router.mjs';
import {createTaskRuntimeRoute,projectTaskRuntimeRoute} from '../bridge/task-runtime-routing.mjs';
import {DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),clone=structuredClone;
const hasCode=code=>error=>error.code===code&&error.message===code;
function evidence(profileId='minimax_opencode',{status='PASS',taskTypes=['execution'],tools=['read_file','shell']}={}){
 const descriptor=TASK_RUNTIME_CATALOG.find(item=>item.profileId===profileId),files=new Map(),runId=randomUUID(),acceptanceId=randomUUID();
 const ref=(name,value)=>{const file='acceptance/'+acceptanceId+'/'+name+'.json',bytes=Buffer.from(JSON.stringify(value)+'\n');files.set(file,bytes);return{file,sha256:sha(bytes)};};
 const receipt={schemaVersion:1,kind:'isolated-runtime-acceptance',id:acceptanceId,status,
  modelId:descriptor.modelId,runtimeId:descriptor.runtimeId,profileId,taskTypes,tools,
  evidence:{run:ref('run',{id:runId,issueId:randomUUID(),agentId:randomUUID(),status:'succeeded',finishedAt:new Date().toISOString()}),
   transport:ref('transport',{runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:sha('stdout'),stderrSha256:sha('stderr')}),
   processCleanup:ref('process-cleanup',{runId,status:'terminated'}),brokerCleanup:ref('broker-cleanup',{runId,status:'terminated'}),
   model:ref('model',{runId,profileId,modelId:descriptor.modelId,runtimeId:descriptor.runtimeId,observed:true}),
   usage:ref('usage',{runId,inputTokens:123,outputTokens:45}),
   implementation:ref('implementation',{runId,profileId,modelId:descriptor.modelId,runtimeId:descriptor.runtimeId,
    sourceSha256:sha('source'),cliSha256:sha('cli'),argsSha256:sha('args'),configSha256:sha('config'),npmCacheVerified:true,freshSession:true}),
   tools:tools.map((name,index)=>{const request=ref('tool-'+index+'-request',{runId,tool:name});return{name,request,result:ref('tool-'+index+'-result',{runId,status:'succeeded',requestSha256:request.sha256})};})}};
 const receiptRef=ref('receipt',receipt),registration={id:randomUUID(),status:'ACTIVE',profileId,modelId:descriptor.modelId,runtimeId:descriptor.runtimeId,receipt:receiptRef,implementationSha256:receipt.evidence.implementation.sha256};
 return{files,receipt,registration,update:()=>{const bytes=Buffer.from(JSON.stringify(receipt)+'\n');files.set(receiptRef.file,bytes);receiptRef.sha256=sha(bytes);}};
}
function poolPorts(...proofs){return{readOperatorRegistrations:async()=>({schemaVersion:1,operatorId:'fixture-owner',entries:proofs.map(value=>value.registration)}),
 readAcceptanceEvidence:async ref=>{for(const proof of proofs)if(proof.files.has(ref.file))return proof.files.get(ref.file);throw Error('PRIVATE_MISSING');}};}
function proposal(changes={}){
 const task={id:randomUUID(),companyId:randomUUID(),projectId:randomUUID(),title:'Fixed isolated task',description:'Preserve root budget'};
 return{taskId:task.id,rootTaskId:randomUUID(),agentId:randomUUID(),role:'backend-engineer',operationId:randomUUID(),inputRevision:taskInputRevision(task),complexity:'routine',risk:'low',purpose:'execution',...changes,_task:task};
}
const publicProposal=p=>Object.fromEntries(Object.entries(p).filter(([key])=>key!=='_task'));
function controllerFixture(proofs=[evidence()],changes={}){
 const p=proposal(changes),operation={id:p.operationId,kind:'run',taskId:p.taskId,rootTaskId:p.rootTaskId,agentId:p.agentId,role:p.role,inputRevision:p.inputRevision,projectId:p._task.projectId};
 let registry={schemaVersion:1,companyId:p._task.companyId,ownerId:'fixture-owner',runtimeRouting:{schemaVersion:1,mode:'task'},runtimeAssignments:{...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS},
  budget:{used:3,maximum:20},evidence:['keep'],team:{ids:{[p.role]:p.agentId}},operations:[operation],
  agents:[{profile:{agentId:p.agentId,role:p.role,engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',
   executionPolicy:{...MACOS_NATIVE_EXECUTION_POLICY},sandbox:'none',dangerouslyBypassApprovalsAndSandbox:true,tools:['shell'],permissions:{keep:true}}}]};
 p._task.assigneeAgentId=p.agentId;p._task.assigneeUserId=null;p._task.responsibleUserId='fixture-owner';p._task.status='in_review';
 const calls=[],events=[],state={task:p._task,budgetUsed:3,budgetLimit:20,activeRunIds:[],executionClosed:true,
  implementationBindings:Object.fromEntries(proofs.map(proof=>[proof.registration.profileId,{sourceSha256:sha('source'),cliSha256:sha('cli')}]))};
 const ports={...poolPorts(...proofs),readTaskState:async()=>({...clone(state),registry:clone(registry),registrySha256:sha(JSON.stringify(registry)),operation:clone(registry.operations.find(item=>item.id===p.operationId))}),
  persistRoute:async value=>{assert.equal(value.previousRegistrySha256,sha(JSON.stringify(registry)));assert.equal(value.budgetUsedBefore,state.budgetUsed);calls.push(value.phase);registry=clone(value.registry);},
  configureRuntime:async()=>{calls.push('configure');},wakeup:async value=>{calls.push('wake');assert.equal(value.contextSnapshot.forceFreshSession,true);assert.equal(value.contextSnapshot.conversationMode,false);assert.ok(!Object.hasOwn(value.contextSnapshot,'sessionId'));return{id:randomUUID(),issueId:p.taskId,agentId:p.agentId,status:'queued'};},log:event=>events.push(event)};
 return{p:publicProposal(p),ports,state,calls,events,getRegistry:()=>registry,setRegistry:value=>{registry=value;}};
}

test('catalog contains nine candidates and implemented profiles alone do not become available',async()=>{
 assert.equal(TASK_RUNTIME_CATALOG.length,9);assert.equal(TASK_RUNTIME_CATALOG.filter(item=>item.implemented).length,Object.keys(RUNTIME_PROFILES).length);
 assert.ok(TASK_RUNTIME_CATALOG.every(item=>item.candidate===true&&!Object.hasOwn(item,'status')));
 const pool=await loadTaskRuntimePool(poolPorts());assert.equal(pool.available.length,0);
 assert.throws(()=>selectTaskRuntimeCombination(pool,publicProposal(proposal())),hasCode('TASK_ROUTER_COMBINATION_UNPROVEN'));
 assert.throws(()=>selectTaskRuntimeCombination(JSON.parse(JSON.stringify(pool)),publicProposal(proposal())),hasCode('TASK_ROUTER_POOL_UNTRUSTED'));
});

test('Host and operator use the same exact implementation manifest and canonical profile fingerprint',()=>{
 for(const profileId of ['codex_subscription','deepseek_opencode','minimax_opencode','deepseek_claude','minimax_claude']){
  const names=taskRuntimeImplementationFiles(profileId),files=names.map(file=>({file,sha256:sha(file)})),before=clone(files);
  const binding=computeTaskRuntimeImplementationBinding({profileId,files,cliSha256:sha('cli')});assert.deepEqual(files,before);
  assert.deepEqual(computeTaskRuntimeImplementationBinding({profileId,files:[...files].reverse(),cliSha256:sha('cli')}),binding);
  assert.notEqual(computeTaskRuntimeImplementationBinding({profileId,files:files.map((ref,index)=>index===0?{...ref,sha256:sha('changed')}:ref),cliSha256:sha('cli')}).sourceSha256,binding.sourceSha256);
  assert.equal(computeTaskRuntimeImplementationBinding({profileId,files,cliSha256:sha('new-cli')}).sourceSha256,binding.sourceSha256);
  assert.ok(names.includes('scripts/role-host-transport.mjs'));assert.ok(names.includes('bridge/task-runtime-router.mjs'));
  assert.throws(()=>computeTaskRuntimeImplementationBinding({profileId,files:files.slice(1),cliSha256:sha('cli')}),hasCode('TASK_ROUTER_IMPLEMENTATION_MANIFEST_INVALID'));
 }
});

test('operator pool verifies exact receipt and every model, usage, tool and terminal evidence hash',async()=>{
 const proof=evidence(),pool=await loadTaskRuntimePool(poolPorts(proof));
 assert.equal(pool.available.length,1);assert.equal(pool.blocked.length,0);assert.equal(pool.available[0].usage.unknownCost,true);
 assert.equal(pool.available[0].receiptSha256,proof.registration.receipt.sha256);assert.ok(pool.available[0].evidenceHashes.length>=10);
 for(const mutate of [p=>{p.files.set(p.receipt.evidence.model.file,Buffer.from('tampered'));},p=>{p.receipt.evidence.tools=[];p.update();},
  p=>{p.receipt.status='NOT_RUN';p.update();},p=>{p.receipt.status='FAIL';p.update();},
  p=>{p.receipt.modelId='untrusted';p.update();}]){
  const value=evidence();mutate(value);const rejected=await loadTaskRuntimePool(poolPorts(value));assert.equal(rejected.available.length,0);assert.equal(rejected.blocked.length,1);
 }
});

test('operator-reviewed compatible sources retain original proof and require the identical CLI',async()=>{
 for(const [source,cli,allowed,expected]of [
  ['reviewed','cli',true,'WOKEN'],['unlisted','cli',true,'BLOCKED'],['reviewed','changed-cli',true,'BLOCKED'],['reviewed','cli',false,'BLOCKED']]){
  const proof=evidence(),original=Buffer.from(proof.files.get(proof.receipt.evidence.implementation.file));
  if(allowed)proof.registration.compatibleSourceSha256=[sha('reviewed')];
  const f=controllerFixture([proof]);f.state.implementationBindings.minimax_opencode={sourceSha256:sha(source),cliSha256:sha(cli)};
  const result=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(result.status,expected);
  assert.deepEqual(proof.files.get(proof.receipt.evidence.implementation.file),original);
  if(expected==='WOKEN')assert.equal(result.combination.implementation.sourceSha256,sha('source'));else assert.deepEqual(f.calls,[]);
 }
});

test('compatible source registration is bounded, unique and operator-only',async()=>{
 for(const value of ['source',['bad-sha'],[sha('same'),sha('same')],Array.from({length:9},(_,index)=>sha(String(index)))]){
  const proof=evidence();proof.registration.compatibleSourceSha256=value;
  await assert.rejects(loadTaskRuntimePool(poolPorts(proof)),hasCode('TASK_ROUTER_OPERATOR_INDEX_INVALID'));
 }
 const f=controllerFixture(),result=await createTaskRuntimeRouter(f.ports)({...f.p,compatibleSourceSha256:[sha('reviewed')]});
 assert.equal(result.code,'TASK_ROUTER_PROPOSAL_INVALID');assert.deepEqual(f.calls,[]);
});

test('a hashed receipt still requires actual tool/model/usage/finished execution proof',async()=>{
 for(const [section,patch]of [['run',{status:'failed'}],['transport',{outputUnknown:true}],['processCleanup',{status:'running'}],
  ['brokerCleanup',{status:'unknown'}],['model',{observed:false}],['model',{modelId:'wrong'}],['usage',{inputTokens:0}],
  ['implementation',{freshSession:false}],['implementation',{npmCacheVerified:false}],['implementation',{sourceSha256:'missing'}]]){
  const proof=evidence(),ref=proof.receipt.evidence[section],value=JSON.parse(proof.files.get(ref.file));
  const bytes=Buffer.from(JSON.stringify({...value,...patch}));proof.files.set(ref.file,bytes);ref.sha256=sha(bytes);
  if(section==='implementation')proof.registration.implementationSha256=ref.sha256;
  proof.update();
  const pool=await loadTaskRuntimePool(poolPorts(proof));assert.equal(pool.available.length,0);assert.equal(pool.blocked.length,1);
 }
});

test('Chief model and runtime needs select a passed combination without fallback or permanent role binding',async()=>{
 const mm=evidence(),ds=evidence('deepseek_opencode',{taskTypes:['research','cross-check'],tools:['host.project_inspect']}),codex=evidence('codex_subscription');
 const pool=await loadTaskRuntimePool(poolPorts(mm,ds,codex));
 assert.equal(selectTaskRuntimeCombination(pool,publicProposal(proposal({requiredTools:['shell']}))).profileId,'minimax_opencode');
 assert.equal(selectTaskRuntimeCombination(pool,publicProposal(proposal({purpose:'research',requiredTools:['host.project_inspect']}))).profileId,'deepseek_opencode');
 for(const changes of [{role:'qa'},{role:'chief'},{role:'architect'},{role:'pm'},{risk:'high'},{complexity:'complex'}]){
  assert.equal(selectTaskRuntimeCombination(pool,publicProposal(proposal(changes))).profileId,'codex_subscription');
  assert.throws(()=>selectTaskRuntimeCombination(pool,publicProposal(proposal({...changes,modelId:'MiniMax-M3.1-Flash'}))));
 }
 assert.throws(()=>selectTaskRuntimeCombination(pool,publicProposal(proposal({requiredTools:['unproven.tool']}))),hasCode('TASK_ROUTER_COMBINATION_UNPROVEN'));
 assert.throws(()=>selectTaskRuntimeCombination(pool,publicProposal(proposal({runtimeId:'hermes'}))),hasCode('TASK_ROUTER_IMPLEMENTATION_UNAVAILABLE'));
 assert.throws(()=>selectTaskRuntimeCombination(pool,publicProposal(proposal({runtimeId:'unknown'}))),hasCode('TASK_ROUTER_RUNTIME_UNKNOWN'));
 const failed=evidence('minimax_opencode',{status:'FAIL'}),noMM=await loadTaskRuntimePool(poolPorts(failed,codex));
 assert.throws(()=>selectTaskRuntimeCombination(noMM,publicProposal(proposal())),hasCode('TASK_ROUTER_COMBINATION_UNPROVEN'));
});

test('prompt-shaped PASS, evidence, session and pool overrides cannot grant availability',async()=>{
 const f=controllerFixture([]),dispatch=createTaskRuntimeRouter(f.ports);
 for(const field of ['status','pool','receipt','profileId','sessionId','handoff']){
  const result=await dispatch({...f.p,[field]:'PRIVATE_SECRET'});assert.equal(result.status,'BLOCKED');assert.equal(result.code,'TASK_ROUTER_PROPOSAL_INVALID');
 }
 assert.deepEqual(f.calls,[]);assert.ok(!JSON.stringify(f.events).includes('PRIVATE_SECRET'));
});

test('a separately passed Claude combination is selectable by tools and is not replaced with OpenCode',async()=>{
 const claude=evidence('minimax_claude',{tools:['read_file']}),opencode=evidence(),pool=await loadTaskRuntimePool(poolPorts(claude,opencode));
 assert.equal(selectTaskRuntimeCombination(pool,publicProposal(proposal({requiredTools:['read_file']}))).runtimeId,'claude');
 assert.equal(selectTaskRuntimeCombination(pool,publicProposal(proposal({runtimeId:'opencode',requiredTools:['read_file']}))).runtimeId,'opencode');
 const absent=await loadTaskRuntimePool(poolPorts(opencode));
 assert.throws(()=>selectTaskRuntimeCombination(absent,publicProposal(proposal({runtimeId:'claude'}))),hasCode('TASK_ROUTER_COMBINATION_UNPROVEN'));
 const f=controllerFixture([claude]),result=await createTaskRuntimeRouter(f.ports)(f.p);
 assert.equal(result.status,'WOKEN');assert.equal(result.route.profileId,'minimax_claude');assert.equal(result.combination.modelId,'MiniMax-M3.1-Flash');
 assert.equal(f.getRegistry().agents[0].profile.engine,'claude_local');assert.equal(f.getRegistry().agents[0].profile.dangerouslySkipPermissions,true);
 assert.equal(f.getRegistry().operations[0].runtimeDispatch.runtimeExplicit,false);
});

test('controller CAS-projects one fresh operation, verifies current state again, then wakes exactly once',async()=>{
 const f=controllerFixture(),before=clone(f.getRegistry()),dispatch=createTaskRuntimeRouter(f.ports),result=await dispatch(f.p);
 assert.equal(result.status,'WOKEN');assert.equal(result.combination.profileId,'minimax_opencode');assert.deepEqual(f.calls,['prepare','configure','wake-attempt','wake']);
 const registry=f.getRegistry(),operation=registry.operations[0];assert.deepEqual(registry.budget,before.budget);assert.deepEqual(registry.evidence,before.evidence);
 assert.equal(operation.runtimeDispatch.status,'WAKE_ATTEMPTED');assert.equal(operation.runtimeDispatch.budgetUsedBefore,3);assert.ok(operation.wakeAttemptedAt);
 assert.equal(registry.taskRuntimeRoutes.length,1);assert.deepEqual(registry.agents[0].profile.permissions,{keep:true});
 const second=await dispatch(f.p);assert.equal(second.status,'RECONCILIATION_REQUIRED');assert.deepEqual(f.calls,['prepare','configure','wake-attempt','wake']);
});

test('missing passed combination or active/unknown execution blocks before configuration and wake',async()=>{
 for(const mutate of [f=>{f.state.activeRunIds=[randomUUID()];},f=>{f.state.executionClosed=false;},f=>{f.state.budgetUsed=20;},f=>{f.state.task.description='Changed';},
  f=>{f.state.implementationBindings.minimax_opencode.sourceSha256=sha('changed');},f=>{delete f.state.implementationBindings;}]){
  const f=controllerFixture();mutate(f);const result=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(result.status,'BLOCKED');assert.deepEqual(f.calls,[]);
 }
 const f=controllerFixture([]),result=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(result.status,'BLOCKED');assert.deepEqual(f.calls,[]);
});

test('same-task profile changes need trusted previous-run handoff and the actual accumulated budget',async()=>{
 const f=controllerFixture([evidence(),evidence('codex_subscription')],{complexity:'complex'}),r=f.getRegistry();
 const previousInput={...f.p,operationId:randomUUID(),selection:{complexity:'routine',risk:'low',purpose:'execution'}};
 for(const field of ['complexity','risk','purpose'])delete previousInput[field];
 const previous=createTaskRuntimeRoute(previousInput);r.operations.unshift({...r.operations[0],id:previous.operationId});
 f.setRegistry(projectTaskRuntimeRoute(r,previous));
 const noHandoff=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(noHandoff.status,'BLOCKED');assert.equal(noHandoff.code,'TASK_RUNTIME_HANDOFF_REQUIRED');assert.deepEqual(f.calls,[]);
 const runId=randomUUID();f.state.handoff={previousRoute:previous,previousRun:{id:runId,issueId:f.p.taskId,agentId:f.p.agentId,status:'succeeded',finishedAt:new Date().toISOString()},
  transport:{runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false},executionClosed:true,budgetUsedBefore:2,
  artifacts:[{file:'snapshots/old.json',sha256:sha('old'),runId}],material:{file:'snapshots/handoff.json',sha256:sha('handoff')}};
 const changedBudget=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(changedBudget.status,'BLOCKED');assert.equal(changedBudget.code,'TASK_ROUTER_HANDOFF_BUDGET_CHANGED');
 f.state.handoff.budgetUsedBefore=3;const result=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(result.status,'WOKEN');
 assert.equal(f.getRegistry().taskRuntimeRoutes.length,2);assert.equal(f.getRegistry().taskRuntimeRoutes[1].handoff.budgetUsedBefore,3);
});

test('configuration, state races and unknown wake results preserve a reconciliation marker without automatic retry',async()=>{
 for(const action of ['configure','state-race','implementation-race','revoked','wake']){
  const f=controllerFixture();let reads=0;const original=f.ports.readOperatorRegistrations;
  if(action==='configure')f.ports.configureRuntime=async()=>{f.calls.push('configure');throw Error('PRIVATE_API_KEY');};
  if(action==='state-race')f.ports.configureRuntime=async()=>{f.calls.push('configure');f.state.budgetUsed=2;};
  if(action==='implementation-race')f.ports.configureRuntime=async()=>{f.calls.push('configure');f.state.implementationBindings.minimax_opencode.cliSha256=sha('changed');};
  if(action==='revoked')f.ports.readOperatorRegistrations=async()=>++reads===1?original():{schemaVersion:1,operatorId:'fixture-owner',entries:[]};
  if(action==='wake')f.ports.wakeup=async()=>{f.calls.push('wake');throw Error('PRIVATE_API_KEY');};
  const dispatch=createTaskRuntimeRouter(f.ports),result=await dispatch(f.p);assert.equal(result.status,'RECONCILIATION_REQUIRED');assert.ok(!JSON.stringify(result).includes('PRIVATE_API_KEY'));
  assert.ok(f.getRegistry().operations[0].runtimeDispatch);const calls=f.calls.length;await dispatch(f.p);assert.equal(f.calls.length,calls);
  assert.ok(!JSON.stringify(f.events).includes('PRIVATE_API_KEY'));
 }
});

test('the same operation cannot configure or wake twice during an in-flight dispatch',async()=>{
 const f=controllerFixture();let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 f.ports.configureRuntime=async()=>{f.calls.push('configure');entered();await gate;};
 const dispatch=createTaskRuntimeRouter(f.ports),first=dispatch(f.p);await ready;
 const second=await dispatch(f.p);assert.equal(second.status,'BLOCKED');assert.equal(second.code,'TASK_ROUTER_DISPATCH_BUSY');
 release();assert.equal((await first).status,'WOKEN');assert.deepEqual(f.calls,['prepare','configure','wake-attempt','wake']);
});

test('logger failures are explicit and never leak arbitrary port errors',async()=>{
 const f=controllerFixture([]);f.ports.log=()=>{throw Error('PRIVATE_LOG_KEY');};
 const result=await createTaskRuntimeRouter(f.ports)(f.p);assert.deepEqual(result,{status:'BLOCKED',code:'TASK_ROUTER_LOG_UNAVAILABLE'});
 assert.deepEqual(f.calls,[]);
});

function transferFixture(){
 const f=controllerFixture([evidence(),evidence('codex_subscription')],{complexity:'complex'}),r=f.getRegistry(),oldAgentId=randomUUID();
 const previous=createTaskRuntimeRoute({...Object.fromEntries(['taskId','rootTaskId','inputRevision'].map(key=>[key,f.p[key]])),agentId:oldAgentId,role:'full-stack-engineer',operationId:randomUUID(),
  selection:{complexity:'routine',risk:'low',purpose:'execution'}});
 const old=clone(r.agents[0]);old.profile.agentId=oldAgentId;old.profile.role=previous.role;r.agents.unshift(old);r.team.ids[previous.role]=oldAgentId;
 r.operations.unshift({id:previous.operationId,kind:'run',taskId:f.p.taskId,rootTaskId:f.p.rootTaskId,agentId:oldAgentId,role:previous.role,inputRevision:f.p.inputRevision});
 f.setRegistry(projectTaskRuntimeRoute(r,previous));f.state.task.assigneeAgentId=oldAgentId;
 const runId=randomUUID();f.state.handoff={handoffKind:'role-transfer',actorScopeClosed:true,previousRoute:previous,
  previousRun:{id:runId,issueId:f.p.taskId,agentId:oldAgentId,status:'succeeded',finishedAt:new Date().toISOString()},
  transport:{runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false},executionClosed:true,budgetUsedBefore:3,
  artifacts:[{file:'role-transfer/source.json',sha256:sha('source artifact'),runId}],material:{file:'role-transfer/handoff.json',sha256:sha('material')}};
 f.state.previousActor={agentId:oldAgentId,role:previous.role,runId,taskId:f.p.taskId,rootTaskId:f.p.rootTaskId,scopeClosed:true,activeRunIds:[]};
 f.ports.assignTaskOwnerCAS=async value=>{assert.equal(value.fromAgentId,oldAgentId);assert.equal(value.fromRole,'full-stack-engineer');assert.equal(value.toAgentId,f.p.agentId);assert.equal(value.toRole,'backend-engineer');
  assert.equal(value.expectedInputRevision,f.p.inputRevision);assert.equal(value.budgetUsedBefore,3);assert.equal(value.expectedCurrentAssigneeAgentId,f.state.task.assigneeAgentId);assert.equal(value.expectedCurrentAssigneeUserId,f.state.task.assigneeUserId);assert.equal(value.expectedCurrentStatus,f.state.task.status);
  f.calls.push('owner');f.state.task.assigneeAgentId=value.toAgentId;f.state.task.assigneeUserId=null;};
 return f;
}

test('a completed Full Stack task transfers one owner by trusted Native CAS before a fresh specialist wake',async()=>{
 const f=transferFixture(),before=clone(f.getRegistry()),result=await createTaskRuntimeRouter(f.ports)(f.p);
 assert.equal(result.status,'WOKEN');assert.deepEqual(f.calls,['prepare','configure','owner','wake-attempt','wake']);
 assert.equal(f.state.task.assigneeAgentId,f.p.agentId);assert.equal(result.route.handoff.fromRole,'full-stack-engineer');
 assert.equal(result.route.handoff.fromRunId,f.state.previousActor.runId);assert.equal(result.route.taskId,f.state.task.id);
 assert.deepEqual(f.getRegistry().budget,before.budget);assert.deepEqual(f.getRegistry().evidence,before.evidence);assert.deepEqual(f.getRegistry().agents[0],before.agents[0]);
 assert.deepEqual(f.getRegistry().taskRuntimeRoutes[0],before.taskRuntimeRoutes[0]);
});

test('active or unclosed former actors and missing owner CAS cannot be disguised as model selection',async()=>{
 for(const mutate of [f=>{f.state.previousActor.activeRunIds=[randomUUID()];},f=>{f.state.previousActor.scopeClosed=false;},
  f=>{delete f.state.previousActor;},f=>{f.state.previousActor.agentId=randomUUID();},f=>{delete f.ports.assignTaskOwnerCAS;},
  f=>{f.state.task.assigneeAgentId=randomUUID();},f=>{delete f.state.handoff.actorScopeClosed;}]){
  const f=transferFixture();mutate(f);const result=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(result.status,'BLOCKED');assert.deepEqual(f.calls,[]);
 }
 for(const changed of [false,true]){
  const f=transferFixture();f.ports.assignTaskOwnerCAS=async()=>{f.calls.push('owner');if(changed)throw Error('PRIVATE_OWNER_KEY');};
  const result=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(result.status,'RECONCILIATION_REQUIRED');assert.ok(!f.calls.includes('wake'));assert.ok(!JSON.stringify(result).includes('PRIVATE_OWNER_KEY'));
 }
});

test('real Native owner handback in_review transfers directly without reassigning the finished source actor',async()=>{
 const f=transferFixture();f.state.task.assigneeAgentId=null;f.state.task.assigneeUserId=f.getRegistry().ownerId;f.state.task.status='in_review';
 const result=await createTaskRuntimeRouter(f.ports)(f.p);assert.equal(result.status,'WOKEN');assert.equal(f.state.task.assigneeAgentId,f.p.agentId);assert.equal(f.state.task.assigneeUserId,null);
 assert.deepEqual(f.calls,['prepare','configure','owner','wake-attempt','wake']);assert.equal(result.route.handoff.fromAgentId,f.state.previousActor.agentId);
 for(const mutate of [g=>{g.state.task.assigneeUserId='another-user';},g=>{g.state.task.responsibleUserId='another-user';},
  g=>{g.state.task.status='todo';},g=>{g.state.previousActor.scopeClosed=false;},g=>{g.state.previousActor.activeRunIds=[randomUUID()];}]){
  const g=transferFixture();g.state.task.assigneeAgentId=null;g.state.task.assigneeUserId=g.getRegistry().ownerId;mutate(g);
  const blocked=await createTaskRuntimeRouter(g.ports)(g.p);assert.equal(blocked.status,'BLOCKED');assert.deepEqual(g.calls,[]);
 }
});
