import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {RUNTIME_PROFILES} from './role-runtime-profiles.mjs';
import {selectTaskRuntimeProfile} from './task-runtime-policy.mjs';
import {createTaskRuntimeRoute,projectTaskRuntimeRoute} from './task-runtime-routing.mjs';
import {taskInputRevision} from './task-input.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const only=(value,fields)=>plain(value)&&Object.keys(value).every(key=>fields.includes(key));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const label=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);
const list=value=>Array.isArray(value)&&value.length<=32&&value.every(label)&&new Set(value).size===value.length;
const time=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const stableCode=error=>/^(TASK_ROUTER|TASK_RUNTIME|ROLE_RUNTIME)_[A-Z_]+$/.test(error?.code??'')?error.code:null;
const identities=['taskId','rootTaskId','agentId','role','operationId','inputRevision'];
const runtimes=['codex','opencode','claude','openclaw','hermes'];
const profiles=Object.values(RUNTIME_PROFILES);
const pools=new WeakSet();
const implementationCommon=Object.freeze([
 'bridge/task-runtime-router.mjs','bridge/task-runtime-routing.mjs','bridge/task-runtime-policy.mjs',
 'bridge/role-runtime-profiles.mjs','bridge/role-execution-policy.mjs','bridge/role-preparation.mjs',
 'bridge/native-role-adapter.mjs','bridge/native-role-runtime.mjs','bridge/role-isolated-transport.mjs',
 'bridge/role-api-routing.mjs','bridge/role-control-store.mjs','bridge/role-permit-contract.mjs',
 'bridge/role-capabilities.mjs','bridge/role-labels.mjs','bridge/role-instruction-paths.mjs','bridge/role-project-context.mjs',
 'bridge/native-role-budget.mjs','bridge/task-call-policy.mjs',
 'bridge/role-materials.mjs','bridge/role-material-snapshot.mjs','bridge/role-host-capabilities.mjs',
 'bridge/role-host-call-queue.mjs','bridge/role-host-mcp.mjs','bridge/native-npm-cache.mjs','bridge/native-plugin-cache.mjs',
 'scripts/role-host-transport.mjs','scripts/role-container-transport.mjs','scripts/role-proxy-tls.mjs',
 'docker/role-provider-proxy.mjs','docker/role-host-mcp-server.mjs',
]);
const implementationExtra=Object.freeze({
 codex:['docker/bin/codex','docker/role-codex-gate.mjs','docker/codex-hello-gate.mjs','scripts/role-host-mcp-config.mjs'],
 opencode:['docker/bin/opencode','docker/role-opencode-gate.mjs','scripts/role-opencode-config.mjs'],
 claude:['docker/bin/claude','docker/role-claude-gate.mjs','scripts/role-claude-config.mjs'],
});

/** Both the actual Host proof and the operator's fresh read use this exact source manifest. Callers hash real bytes; no filesystem effects here. */
export function taskRuntimeImplementationFiles(profileId){
 const profile=Object.hasOwn(RUNTIME_PROFILES,profileId??'')?RUNTIME_PROFILES[profileId]:null;
 if(!profile||!Object.hasOwn(implementationExtra,profile.runtime))fail('TASK_ROUTER_IMPLEMENTATION_UNAVAILABLE');
 return Object.freeze([...implementationCommon,...implementationExtra[profile.runtime]].sort());
}
export function computeTaskRuntimeImplementationBinding({profileId,files,cliSha256}={}){
 const expected=taskRuntimeImplementationFiles(profileId);
 if(!hash(cliSha256)||!Array.isArray(files)||files.length!==expected.length||
  files.some(item=>!only(item,['file','sha256'])||!expected.includes(item.file)||!hash(item.sha256))||
  new Set(files.map(item=>item.file)).size!==expected.length)fail('TASK_ROUTER_IMPLEMENTATION_MANIFEST_INVALID');
 const manifest=expected.map(file=>({file,sha256:files.find(item=>item.file===file).sha256}));
 return Object.freeze({sourceSha256:sha(JSON.stringify({schemaVersion:1,profile:RUNTIME_PROFILES[profileId],files:manifest})),cliSha256});
}

/** Candidate capability catalog, never acceptance or permission. Unimplemented adapters cannot enter the executable pool. */
export const TASK_RUNTIME_CATALOG=Object.freeze([...new Map(profiles.map(profile=>[profile.providerModel,profile])).values()].flatMap(model=>
 (model.provider==='openai'?['codex']:runtimes.slice(1)).map(runtimeId=>{
  const profile=profiles.find(item=>item.providerModel===model.providerModel&&item.runtime===runtimeId);
  return Object.freeze({modelId:model.providerModel,runtimeId,profileId:profile?.id??model.provider+'_'+runtimeId,candidate:true,implemented:Boolean(profile)});
 })));
function descriptor(value){return TASK_RUNTIME_CATALOG.find(item=>item.modelId===value.modelId&&item.runtimeId===value.runtimeId&&item.profileId===value.profileId);}
function refValid(ref){
 return only(ref,['file','sha256'])&&hash(ref.sha256)&&typeof ref.file==='string'&&Buffer.byteLength(ref.file)<=512&&
  ref.file.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..');
}
async function acceptance(registration,read){
 const expected=descriptor(registration);
 if(!expected)fail('TASK_ROUTER_COMBINATION_UNKNOWN');
 if(!expected.implemented)fail('TASK_ROUTER_IMPLEMENTATION_UNAVAILABLE');
 const hashes=[];let totalBytes=0;
 const json=async(ref,kind)=>{
  if(!refValid(ref))fail('TASK_ROUTER_EVIDENCE_REFERENCE_INVALID');
  let bytes;try{const value=await read(structuredClone(ref));if(typeof value!=='string'&&!Buffer.isBuffer(value)&&!(value instanceof Uint8Array))fail('TASK_ROUTER_EVIDENCE_UNAVAILABLE');bytes=Buffer.from(value);}
  catch{fail('TASK_ROUTER_EVIDENCE_UNAVAILABLE');}
  totalBytes+=bytes.length;
  if(bytes.length>1048576||totalBytes>4194304||sha(bytes)!==ref.sha256)fail('TASK_ROUTER_EVIDENCE_CHANGED');
  let value;try{value=JSON.parse(bytes);}catch{fail('TASK_ROUTER_EVIDENCE_INVALID');}
  if(!plain(value))fail('TASK_ROUTER_EVIDENCE_INVALID');
  hashes.push({kind,...ref});return value;
 };
 const receipt=await json(registration.receipt,'receipt');
 if(receipt.status!=='PASS')fail('TASK_ROUTER_ACCEPTANCE_NOT_PASS');
 if(!only(receipt,['schemaVersion','kind','id','status','profileId','modelId','runtimeId','taskTypes','tools','evidence'])||
  receipt.schemaVersion!==1||receipt.kind!=='isolated-runtime-acceptance'||!uuid(receipt.id)||
  ['modelId','runtimeId','profileId'].some(key=>receipt[key]!==registration[key])||
  !list(receipt.taskTypes)||!receipt.taskTypes.length||!list(receipt.tools)||!receipt.tools.length||
  !only(receipt.evidence,['run','transport','processCleanup','brokerCleanup','model','usage','implementation','tools'])||
  !Array.isArray(receipt.evidence.tools)||receipt.evidence.tools.length<1||receipt.evidence.tools.length>32)fail('TASK_ROUTER_ACCEPTANCE_INVALID');
 const proofs={};
 for(const kind of ['run','transport','processCleanup','brokerCleanup','model','usage','implementation'])proofs[kind]=await json(receipt.evidence[kind],kind);
 const {run,transport,processCleanup,brokerCleanup,model,usage,implementation}=proofs;
 if(!uuid(run.id)||!uuid(run.issueId)||!uuid(run.agentId)||run.status!=='succeeded'||!time(run.finishedAt)||
  [transport,processCleanup,brokerCleanup,model,usage,implementation].some(value=>value.runId!==run.id)||
  transport.exitCode!==0||transport.signal!==null||!['timedOut','cancelled','outputUnknown'].every(key=>transport[key]===false)||
  !hash(transport.stdoutSha256)||!hash(transport.stderrSha256)||processCleanup.status!=='terminated'||brokerCleanup.status!=='terminated')fail('TASK_ROUTER_TERMINAL_PROOF_INVALID');
 if(model.observed!==true||['modelId','runtimeId','profileId'].some(key=>model[key]!==registration[key]))fail('TASK_ROUTER_MODEL_PROOF_INVALID');
 if(!hash(registration.implementationSha256)||registration.implementationSha256!==receipt.evidence.implementation.sha256||
  ['modelId','runtimeId','profileId'].some(key=>implementation[key]!==registration[key])||
  !['sourceSha256','cliSha256','argsSha256','configSha256'].every(key=>hash(implementation[key]))||
  implementation.npmCacheVerified!==true||implementation.freshSession!==true)fail('TASK_ROUTER_IMPLEMENTATION_PROOF_INVALID');
 if(!Number.isSafeInteger(usage.inputTokens)||usage.inputTokens<1||!Number.isSafeInteger(usage.outputTokens)||usage.outputTokens<1||
  usage.costUsd!==undefined&&(typeof usage.costUsd!=='number'||!Number.isFinite(usage.costUsd)||usage.costUsd<0))fail('TASK_ROUTER_USAGE_PROOF_INVALID');
 const actualTools=new Set();
 for(const tool of receipt.evidence.tools){
  if(!only(tool,['name','request','result'])||!label(tool.name))fail('TASK_ROUTER_TOOL_PROOF_INVALID');
  const request=await json(tool.request,'tool-request'),result=await json(tool.result,'tool-result');
  if(request.runId!==run.id||request.tool!==tool.name||result.runId!==run.id||result.status!=='succeeded'||
   result.requestSha256!==tool.request.sha256||result.error!=null)fail('TASK_ROUTER_TOOL_PROOF_INVALID');
  actualTools.add(tool.name);
 }
 if(!equal([...actualTools].sort(),[...receipt.tools].sort()))fail('TASK_ROUTER_TOOL_PROOF_INVALID');
 return Object.freeze({...expected,available:true,acceptanceStatus:'PASS',registrationId:registration.id,acceptanceId:receipt.id,runId:run.id,
  taskTypes:Object.freeze([...receipt.taskTypes]),tools:Object.freeze([...receipt.tools]),receiptSha256:registration.receipt.sha256,
  implementationSha256:registration.implementationSha256,
  implementation:Object.freeze(Object.fromEntries(['sourceSha256','cliSha256','argsSha256','configSha256','npmCacheVerified','freshSession'].map(key=>[key,implementation[key]]))),
  evidenceHashes:Object.freeze(hashes.map(item=>Object.freeze(item))),
  usage:Object.freeze({inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,...(usage.costUsd===undefined?{unknownCost:true}:{costUsd:usage.costUsd,unknownCost:false})})});
}

/** Operator-only ports must read private, owner-checked, non-linked records under a dedicated evidence root. Never expose them as model tools. */
export async function loadTaskRuntimePool({readOperatorRegistrations,readAcceptanceEvidence}){
 if(typeof readOperatorRegistrations!=='function'||typeof readAcceptanceEvidence!=='function')fail('TASK_ROUTER_POOL_PORT_INVALID');
 let index;try{index=structuredClone(await readOperatorRegistrations());}catch{fail('TASK_ROUTER_OPERATOR_INDEX_UNAVAILABLE');}
 if(!only(index,['schemaVersion','operatorId','entries'])||index.schemaVersion!==1||typeof index.operatorId!=='string'||!index.operatorId.trim()||index.operatorId.length>256||
  !Array.isArray(index.entries)||index.entries.length>32||index.entries.some(entry=>!only(entry,['id','status','modelId','runtimeId','profileId','receipt','implementationSha256'])||!uuid(entry.id))||
  new Set(index.entries.map(entry=>entry.id)).size!==index.entries.length)fail('TASK_ROUTER_OPERATOR_INDEX_INVALID');
 const available=[],blocked=[];
 for(const entry of index.entries){
  try{if(entry.status!=='ACTIVE')fail('TASK_ROUTER_REGISTRATION_INACTIVE');available.push(await acceptance(entry,readAcceptanceEvidence));}
  catch(error){blocked.push(Object.freeze({registrationId:entry.id,code:stableCode(error)??'TASK_ROUTER_EVIDENCE_UNAVAILABLE'}));}
 }
 const pool=Object.freeze({schemaVersion:1,available:Object.freeze(available),blocked:Object.freeze(blocked),
  sha256:sha(JSON.stringify({operatorId:index.operatorId,entries:index.entries,available,blocked}))});
 pools.add(pool);return pool;
}
function normalize(proposal){
 if(!only(proposal,[...identities,'complexity','risk','purpose','modelId','runtimeId','requiredTools','taskType'])||
  !['taskId','rootTaskId','agentId','operationId'].every(key=>uuid(proposal[key]))||!hash(proposal.inputRevision)||
  proposal.requiredTools!==undefined&&!list(proposal.requiredTools)||proposal.taskType!==undefined&&!label(proposal.taskType))fail('TASK_ROUTER_PROPOSAL_INVALID');
 const selection=Object.fromEntries(['complexity','risk','purpose'].filter(key=>Object.hasOwn(proposal,key)).map(key=>[key,proposal[key]]));
 const defaultChoice=selectTaskRuntimeProfile({role:proposal.role,...selection});
 let chosen=defaultChoice;
 if(Object.hasOwn(proposal,'modelId')){
  const profile=profiles.find(item=>item.providerModel===proposal.modelId);if(!profile)fail('TASK_ROUTER_MODEL_UNKNOWN');
  selection.profileId=profile.id;chosen=selectTaskRuntimeProfile({role:proposal.role,...selection});
 }
 if(Object.hasOwn(proposal,'runtimeId')&&!runtimes.includes(proposal.runtimeId))fail('TASK_ROUTER_RUNTIME_UNKNOWN');
 return{modelId:chosen.profile.providerModel,reason:chosen.reason,selection,taskType:proposal.taskType??proposal.purpose??'execution',requiredTools:proposal.requiredTools??[]};
}

/** Select model policy first, then a proven runtime that satisfies actual task/tool evidence. No cross-model/runtime fallback. */
export function selectTaskRuntimeCombination(pool,proposal){
 if(!pools.has(pool))fail('TASK_ROUTER_POOL_UNTRUSTED');
 const choice=normalize(proposal),candidates=TASK_RUNTIME_CATALOG.filter(item=>item.modelId===choice.modelId&&
  (proposal.runtimeId===undefined||item.runtimeId===proposal.runtimeId));
 if(!candidates.length)fail('TASK_ROUTER_COMBINATION_UNKNOWN');
 if(candidates.every(item=>!item.implemented))fail('TASK_ROUTER_IMPLEMENTATION_UNAVAILABLE');
 const matched=pool.available.filter(item=>item.modelId===choice.modelId&&(proposal.runtimeId===undefined||item.runtimeId===proposal.runtimeId)&&
  item.taskTypes.includes(choice.taskType)&&choice.requiredTools.every(tool=>item.tools.includes(tool)))
  .sort((a,b)=>a.tools.length-b.tools.length||a.runtimeId.localeCompare(b.runtimeId)||a.registrationId.localeCompare(b.registrationId));
 if(!matched.length)fail('TASK_ROUTER_COMBINATION_UNPROVEN');
 return Object.freeze({...matched[0],reason:choice.reason,taskType:choice.taskType,requiredTools:Object.freeze([...choice.requiredTools]),poolSha256:pool.sha256});
}
function assertState(state,proposal){
 if(!plain(state)||!plain(state.registry)||!hash(state.registrySha256)||!plain(state.task)||!plain(state.operation)||
  state.task.id!==proposal.taskId||state.task.companyId!==state.registry.companyId||taskInputRevision(state.task)!==proposal.inputRevision||
  typeof state.registry.ownerId!=='string'||!state.registry.ownerId||state.task.responsibleUserId!==state.registry.ownerId||['done','cancelled','blocked'].includes(state.task.status)||
  !Array.isArray(state.activeRunIds)||state.activeRunIds.length||state.executionClosed!==true||
  !Number.isSafeInteger(state.budgetUsed)||state.budgetUsed<0||!Number.isSafeInteger(state.budgetLimit)||state.budgetUsed>=state.budgetLimit)fail('TASK_ROUTER_ACTUAL_STATE_DENIED');
 const matches=state.registry.operations?.filter(item=>item?.id===proposal.operationId);
 if(matches?.length!==1||!equal(matches[0],state.operation)||state.operation.taskId!==state.task.id||
  state.operation.projectId!==undefined&&state.operation.projectId!==state.task.projectId)fail('TASK_ROUTER_ACTUAL_STATE_DENIED');
}
function assertImplementation(state,combination){
 const actual=state.implementationBindings?.[combination.profileId];
 if(!only(actual,['sourceSha256','cliSha256'])||['sourceSha256','cliSha256'].some(key=>!hash(actual[key])||actual[key]!==combination.implementation[key]))fail('TASK_ROUTER_IMPLEMENTATION_CHANGED');
}
function assertPreviousActorClosed(state,route){
 const handoff=route.handoff;if(handoff?.handoffKind!=='role-transfer')return;
 const actor=state.previousActor;
 if(!plain(actor)||actor.agentId!==handoff.fromAgentId||actor.role!==handoff.fromRole||actor.runId!==handoff.fromRunId||
  actor.taskId!==route.taskId||actor.rootTaskId!==route.rootTaskId||actor.scopeClosed!==true||
  !Array.isArray(actor.activeRunIds)||actor.activeRunIds.length)fail('TASK_ROUTER_PREVIOUS_ACTOR_OPEN');
}

/** Caller holds the existing Native root/global-admission lease throughout dispatch; ports enforce owner checks and registry/budget CAS.
 * This is not a scheduler or a permission grant. Unknown persistence/configuration/wake is never automatically replayed. */
export function createTaskRuntimeRouter(ports){
 const names=['readOperatorRegistrations','readAcceptanceEvidence','readTaskState','configureRuntime','persistRoute','wakeup','log'];
 if(!plain(ports)||names.some(name=>typeof ports[name]!=='function'))fail('TASK_ROUTER_PORT_INVALID');
 const inFlight=new Set();
 const emit=event=>{try{ports.log(event);return true;}catch{return false;}};
 return async function dispatch(proposal){
  let sideEffects=false,stage='VALIDATION',route,combination,claimed=false;
  try{
   normalize(proposal);
   if(inFlight.has(proposal.operationId))fail('TASK_ROUTER_DISPATCH_BUSY');
   inFlight.add(proposal.operationId);claimed=true;
   stage='POOL';const pool=await loadTaskRuntimePool(ports);combination=selectTaskRuntimeCombination(pool,proposal);
   stage='STATE';const identity=Object.fromEntries(identities.map(key=>[key,proposal[key]])),state=await ports.readTaskState(identity);
   if(state?.operation?.runtimeDispatch||state?.operation?.wakeAttemptedAt||state?.operation?.runId){sideEffects=true;fail('TASK_ROUTER_DISPATCH_RECONCILIATION_REQUIRED');}
   assertState(state,proposal);assertImplementation(state,combination);
   const prior=(state.registry.taskRuntimeRoutes??[]).filter(item=>item.taskId===proposal.taskId).at(-1);
   if(state.handoff&&(!prior||!equal(prior,state.handoff.previousRoute)))fail('TASK_ROUTER_HANDOFF_HISTORY_CHANGED');
   if(state.handoff&&state.handoff.budgetUsedBefore!==state.budgetUsed)fail('TASK_ROUTER_HANDOFF_BUDGET_CHANGED');
   const selection=normalize(proposal).selection;
   // A non-default runtime is an explicit controller choice backed by this pool, not a permanent role binding.
   if(selectTaskRuntimeProfile({role:proposal.role,...selection}).profile.id!==combination.profileId)selection.profileId=combination.profileId;
   route=createTaskRuntimeRoute({...identity,selection,...(state.handoff?{handoff:state.handoff}:{})});
   if(route.profileId!==combination.profileId)fail('TASK_ROUTER_IMPLEMENTATION_UNAVAILABLE');
   const transfer=route.handoff?.handoffKind==='role-transfer';assertPreviousActorClosed(state,route);
   const sourceAssigned=state.task.assigneeAgentId===route.handoff?.fromAgentId&&state.task.assigneeUserId==null;
   const nativeHandback=state.task.assigneeAgentId===null&&state.task.assigneeUserId===state.registry.ownerId&&state.task.responsibleUserId===state.registry.ownerId&&state.task.status==='in_review';
   if(transfer&&(typeof ports.assignTaskOwnerCAS!=='function'||!sourceAssigned&&!nativeHandback))fail('TASK_ROUTER_OWNER_TRANSFER_DENIED');
   if(!transfer&&state.task.assigneeAgentId!=null&&state.task.assigneeAgentId!==proposal.agentId)fail('TASK_ROUTER_OWNER_TRANSFER_REQUIRED');
   const projected=projectTaskRuntimeRoute(state.registry,route),op=projected.operations.find(item=>item.id===proposal.operationId);
   op.runtimeDispatch={schemaVersion:1,status:'PREPARING',routeId:route.id,profileId:combination.profileId,modelId:combination.modelId,runtimeId:combination.runtimeId,
    taskType:combination.taskType,requiredTools:[...combination.requiredTools],registrationId:combination.registrationId,receiptSha256:combination.receiptSha256,
    poolSha256:pool.sha256,proposalSha256:sha(JSON.stringify(proposal)),modelExplicit:Object.hasOwn(proposal,'modelId'),runtimeExplicit:Object.hasOwn(proposal,'runtimeId'),budgetUsedBefore:state.budgetUsed};
   stage='PERSIST';sideEffects=true;
   await ports.persistRoute({registry:projected,route,previousRegistrySha256:state.registrySha256,budgetUsedBefore:state.budgetUsed,operationId:proposal.operationId,phase:'prepare'});
   stage='CONFIGURE';await ports.configureRuntime({route,combination,proposal:structuredClone(proposal),state});
   if(transfer){stage='OWNER';await ports.assignTaskOwnerCAS({taskId:proposal.taskId,rootTaskId:proposal.rootTaskId,operationId:proposal.operationId,
    fromAgentId:route.handoff.fromAgentId,fromRole:route.handoff.fromRole,toAgentId:proposal.agentId,toRole:proposal.role,
    previousRunId:route.handoff.fromRunId,expectedInputRevision:proposal.inputRevision,budgetUsedBefore:state.budgetUsed,
    expectedCurrentAssigneeAgentId:state.task.assigneeAgentId??null,expectedCurrentAssigneeUserId:state.task.assigneeUserId??null,expectedCurrentStatus:state.task.status,route});}
   stage='STATE';const current=await ports.readTaskState(identity);assertState(current,proposal);assertImplementation(current,combination);
   assertPreviousActorClosed(current,route);
   if(current.budgetUsed!==state.budgetUsed||!equal(current.operation.runtimeDispatch,op.runtimeDispatch)||current.operation.wakeAttemptedAt||
    !equal(current.operation.taskRuntimeRoute,route)||current.task.assigneeAgentId!==proposal.agentId||current.task.assigneeUserId!=null)fail('TASK_ROUTER_PREPARED_STATE_CHANGED');
   stage='POOL';const rechecked=await loadTaskRuntimePool(ports);
   if(rechecked.sha256!==pool.sha256||selectTaskRuntimeCombination(rechecked,proposal).receiptSha256!==combination.receiptSha256)fail('TASK_ROUTER_POOL_CHANGED');
   const wakeRegistry=structuredClone(current.registry),wakeOperation=wakeRegistry.operations.find(item=>item.id===proposal.operationId);
   wakeOperation.wakeAttemptedAt=new Date().toISOString();wakeOperation.runtimeDispatch.status='WAKE_ATTEMPTED';
   stage='PERSIST';await ports.persistRoute({registry:wakeRegistry,route,previousRegistrySha256:current.registrySha256,budgetUsedBefore:state.budgetUsed,operationId:proposal.operationId,phase:'wake-attempt'});
   stage='WAKE';const run=await ports.wakeup({route,combination,agentId:proposal.agentId,taskId:proposal.taskId,idempotencyKey:'team-operation:'+proposal.operationId,
    contextSnapshot:{issueId:proposal.taskId,taskId:proposal.taskId,projectId:current.task.projectId,responsibleUserId:current.registry.ownerId,
     inputRevision:proposal.inputRevision,roleOperationId:proposal.operationId,taskGoal:current.task.description,forceFreshSession:true,conversationMode:false}});
   if(!uuid(run?.id)||run.issueId!==proposal.taskId||run.agentId!==proposal.agentId||!['queued','running','succeeded'].includes(run.status))fail('TASK_ROUTER_WAKE_RESULT_UNKNOWN');
   if(!emit({code:'TASK_ROUTER_WOKEN',taskId:proposal.taskId,operationId:proposal.operationId,profileId:combination.profileId,runId:run.id}))fail('TASK_ROUTER_LOG_UNAVAILABLE');
   return{status:'WOKEN',route,combination,runId:run.id};
  }catch(error){
   const code=stableCode(error)??'TASK_ROUTER_'+stage+'_UNAVAILABLE',status=sideEffects?'RECONCILIATION_REQUIRED':'BLOCKED';
   const logged=emit({code,status,...(uuid(proposal?.taskId)?{taskId:proposal.taskId}:{}),...(uuid(proposal?.operationId)?{operationId:proposal.operationId}:{})});
   return{status,code:logged?code:'TASK_ROUTER_LOG_UNAVAILABLE'};
  }finally{if(claimed)inFlight.delete(proposal.operationId);}
 };
}
