import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {selectTaskRuntimeProfile} from './task-runtime-policy.mjs';
import {RUNTIME_PROFILES,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,getRoleRuntimeProfile} from './role-runtime-profiles.mjs';
import {isMacNative} from './role-execution-policy.mjs';
import {ROLE_KEYS} from './role-labels.mjs';

// Pure control contract. Native/Host owners re-read actual run, process, budget and file evidence before execution.
const fail=code=>{throw Object.assign(Error(code),{code});};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identities=['taskId','rootTaskId','agentId','role','operationId','inputRevision'];
const routeKeys=['schemaVersion','id',...identities,'profileId','selection','reason','createdAt','handoff'];
const handoffKeys=['previousRouteId','fromRunId','fromProfileId','fromAgentId','fromRole','handoffKind','budgetUsedBefore','artifacts','material'];
const only=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
const time=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
function checkIdentity(value){
 if(!plain(value)||!['taskId','rootTaskId','agentId','operationId'].every(key=>uuid(value[key]))||!hash(value.inputRevision))fail('TASK_RUNTIME_IDENTITY_INVALID');
}
function fileRef(value,runId){
 if(!only(value,runId===undefined?['file','sha256']:['file','sha256','runId'])||!hash(value.sha256)||
  typeof value.file!=='string'||Buffer.byteLength(value.file)>512||
  !value.file.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..')||
  runId!==undefined&&value.runId!==runId)fail('TASK_RUNTIME_HANDOFF_EVIDENCE_INVALID');
}
function checkHandoff(value,route){
 if(!only(value,handoffKeys)||!uuid(value.previousRouteId)||value.previousRouteId===route.id||!uuid(value.fromRunId)||
  typeof value.fromProfileId!=='string'||!Object.hasOwn(RUNTIME_PROFILES,value.fromProfileId)||
  !Number.isSafeInteger(value.budgetUsedBefore)||value.budgetUsedBefore<1||
  !Array.isArray(value.artifacts)||value.artifacts.length<1||value.artifacts.length>32)fail('TASK_RUNTIME_HANDOFF_INVALID');
 const hasActor=Object.hasOwn(value,'fromAgentId')||Object.hasOwn(value,'fromRole');
 if(hasActor&&(!uuid(value.fromAgentId)||!ROLE_KEYS.includes(value.fromRole)))fail('TASK_RUNTIME_HANDOFF_INVALID');
 const actorChanged=hasActor&&(value.fromAgentId!==route.agentId||value.fromRole!==route.role);
 if(actorChanged?value.handoffKind!=='role-transfer':Object.hasOwn(value,'handoffKind'))fail('TASK_RUNTIME_HANDOFF_BINDING_DENIED');
 for(const artifact of value.artifacts)fileRef(artifact,value.fromRunId);
 fileRef(value.material);
 if(new Set([...value.artifacts,value.material].map(ref=>ref.file)).size!==value.artifacts.length+1)fail('TASK_RUNTIME_HANDOFF_EVIDENCE_INVALID');
}

/** Validate recorded policy against canonical profiles, never trust a stored model/endpoint or inherited CLI session. */
export function validateTaskRuntimeRoute(route,expected={}){
 if(!only(route,routeKeys)||route.schemaVersion!==1||!uuid(route.id)||!time(route.createdAt)||
  !only(expected,identities)||!only(route.selection,['complexity','risk','purpose','profileId']))fail('TASK_RUNTIME_ROUTE_INVALID');
 checkIdentity(route);
 for(const key of Object.keys(expected))if(route[key]!==expected[key])fail('TASK_RUNTIME_ROUTE_BINDING_DENIED');
 const selected=selectTaskRuntimeProfile({role:route.role,...route.selection});
 if(route.profileId!==selected.profile.id||route.reason!==selected.reason)fail('TASK_RUNTIME_ROUTE_POLICY_CHANGED');
 if(Object.hasOwn(route,'handoff'))checkHandoff(route.handoff,route);
 return selected.profile;
}

/** Create a fresh operation route; explicit handoff references artifacts and accounting, never session state. */
export function createTaskRuntimeRoute(input){
 if(!only(input,[...identities,'selection','handoff'])||!only(input.selection,['complexity','risk','purpose','profileId']))fail('TASK_RUNTIME_ROUTE_INVALID');
 checkIdentity(input);
 const {profile,reason}=selectTaskRuntimeProfile({role:input.role,...input.selection});
 const route={schemaVersion:1,id:randomUUID(),...Object.fromEntries(identities.map(key=>[key,input[key]])),
  profileId:profile.id,selection:structuredClone(input.selection),reason,createdAt:new Date().toISOString()};
 if(input.handoff!==undefined){
  const h=input.handoff;
  if(!only(h,['previousRoute','previousRun','transport','executionClosed','actorScopeClosed','handoffKind','budgetUsedBefore','artifacts','material']))fail('TASK_RUNTIME_HANDOFF_INVALID');
  const previous=h.previousRoute;validateTaskRuntimeRoute(previous);
  const actorChanged=previous.agentId!==route.agentId||previous.role!==route.role;
  if(['taskId','rootTaskId'].some(key=>previous[key]!==route[key])||previous.operationId===route.operationId||
   (actorChanged?h.handoffKind!=='role-transfer':Object.hasOwn(h,'handoffKind')))fail('TASK_RUNTIME_HANDOFF_BINDING_DENIED');
  const run=h.previousRun,transport=h.transport;
  if(!plain(run)||!uuid(run.id)||run.issueId!==route.taskId||run.agentId!==previous.agentId||run.status!=='succeeded'||
   !(run.finishedAt instanceof Date?Number.isFinite(run.finishedAt.getTime()):time(run.finishedAt))||
   !plain(transport)||transport.runId!==run.id||transport.exitCode!==0||transport.signal!==null||
   !['timedOut','cancelled','outputUnknown'].every(key=>transport[key]===false))fail('TASK_RUNTIME_HANDOFF_RESULT_UNKNOWN');
  if(h.executionClosed!==true)fail('TASK_RUNTIME_HANDOFF_EXECUTION_OPEN');
  if(actorChanged&&h.actorScopeClosed!==true)fail('TASK_RUNTIME_HANDOFF_ACTOR_SCOPE_OPEN');
  route.handoff=structuredClone({previousRouteId:previous.id,fromRunId:run.id,fromProfileId:previous.profileId,
   fromAgentId:previous.agentId,fromRole:previous.role,...(actorChanged?{handoffKind:'role-transfer'}:{}),
   budgetUsedBefore:h.budgetUsedBefore,artifacts:h.artifacts,material:h.material});
 }
 validateTaskRuntimeRoute(route);return route;
}

/** Project only an existing unstarted operation; preserve all old task, budget, permission and evidence data. */
export function projectTaskRuntimeRoute(registry,route){
 const selected=validateTaskRuntimeRoute(route);
 if(!plain(registry)||registry.runtimeRouting?.schemaVersion!==1||registry.runtimeRouting.mode!=='task'||
  !Array.isArray(registry.operations)||!Array.isArray(registry.agents)||
  registry.taskRuntimeRoutes!==undefined&&!Array.isArray(registry.taskRuntimeRoutes))fail('TASK_RUNTIME_REGISTRY_INVALID');
 const operations=registry.operations.filter(op=>op?.id===route.operationId),agents=registry.agents.filter(entry=>entry?.profile?.agentId===route.agentId&&entry.profile.role===route.role);
 if(operations.length!==1||agents.length!==1||registry.team?.ids&&registry.team.ids[route.role]!==route.agentId)fail('TASK_RUNTIME_OPERATION_DENIED');
 const operation=operations[0];
 if(operation.kind!=='run'||identities.some(key=>(key==='operationId'?operation.id:key==='rootTaskId'?operation.rootTaskId??operation.taskId:operation[key])!==route[key])||
  ['runId','startedAt','wakeAttemptedAt','finishedAt'].some(key=>operation[key]!=null)||
  operation.status!==undefined&&!['pending','NOT_RUN'].includes(operation.status)||
  operation.taskRuntimeRoute!==undefined&&!equal(operation.taskRuntimeRoute,route))fail('TASK_RUNTIME_OPERATION_DENIED');
 const history=registry.taskRuntimeRoutes??[];
 if(history.some(item=>!plain(item)||!uuid(item.id))||new Set(history.map(item=>item.id)).size!==history.length)fail('TASK_RUNTIME_HISTORY_INVALID');
 const existing=history.find(item=>item.id===route.id);
 if(existing&&!equal(existing,route))fail('TASK_RUNTIME_HISTORY_INVALID');
 const prior=history.filter(item=>item.taskId===route.taskId&&item.id!==route.id).at(-1);
 if(existing&&history.filter(item=>item.agentId===route.agentId&&item.role===route.role).at(-1)?.id!==route.id)fail('TASK_RUNTIME_ROUTE_CHANGED');
 if(!existing){
  if(prior){validateTaskRuntimeRoute(prior);if((prior.profileId!==route.profileId||prior.agentId!==route.agentId||prior.role!==route.role)&&!route.handoff)fail('TASK_RUNTIME_HANDOFF_REQUIRED');}
  if(route.handoff&&(!prior||prior.id!==route.handoff.previousRouteId||prior.profileId!==route.handoff.fromProfileId||
   ['taskId','rootTaskId'].some(key=>prior[key]!==route[key])||prior.agentId!==(route.handoff.fromAgentId??route.agentId)||prior.role!==(route.handoff.fromRole??route.role)||prior.operationId===route.operationId||
   route.handoff.budgetUsedBefore<(prior.handoff?.budgetUsedBefore??0)))fail('TASK_RUNTIME_HANDOFF_BINDING_DENIED');
 }
 const assignments=registry.runtimeAssignments??DEFAULT_ROLE_RUNTIME_ASSIGNMENTS;
 getRoleRuntimeProfile(route.role,assignments);
 let native;try{native=isMacNative(agents[0].profile);}catch{fail('TASK_RUNTIME_EXECUTION_POLICY_DENIED');}
 if(selected.runtime!=='codex'&&!native)fail('TASK_RUNTIME_EXECUTION_POLICY_DENIED');
 const result=structuredClone(registry),entry=result.agents.find(item=>item.profile.agentId===route.agentId),profile=entry.profile;
 result.runtimeAssignments={...assignments,[route.role]:selected.id};
 result.taskRuntimeRoutes=structuredClone(existing?history:[...history,route]);
 result.operations.find(op=>op.id===route.operationId).taskRuntimeRoute=structuredClone(route);
 Object.assign(profile,{engine:selected.adapterType,model:selected.model,reasoningEffort:selected.reasoningEffort});
 for(const key of ['runtime','provider','providerModel','credentialKind','wireApi','endpoint','adapterType'])if(Object.hasOwn(profile,key))profile[key]=selected[key];
 if(Object.hasOwn(profile,'runtimeProfileId'))profile.runtimeProfileId=selected.id;
 for(const key of ['dangerouslySkipPermissions','dangerouslyBypassApprovalsAndSandbox','dangerouslyBypassSandbox'])delete profile[key];
 if(selected.runtime!=='codex')profile.dangerouslySkipPermissions=true;
 else Object.assign(profile,{dangerouslyBypassApprovalsAndSandbox:native,dangerouslyBypassSandbox:native});
 return result;
}
