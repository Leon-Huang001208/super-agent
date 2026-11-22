/** Normal Coordinator management ports. No scheduler, subscription clone, or model tool is introduced here. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {ROLE_ROOT,readControl,writeControl,editRoleRegistry} from './role-control-store.mjs';
import {RUNTIME_PROFILES} from './role-runtime-profiles.mjs';
import {roleExecutionPolicy} from './role-execution-policy.mjs';
import {validateTeamRuntimeSelection} from './team-plan.mjs';
import {taskInputRevision} from './task-input.mjs';
import {createTaskRuntimeRoute,projectTaskRuntimeRoute} from './task-runtime-routing.mjs';
import {loadTaskRuntimePool,selectTaskRuntimeCombination,createTaskRuntimeRouter,taskRuntimeImplementationFiles,computeTaskRuntimeImplementationBinding,taskRuntimeImplementationMatches} from './task-runtime-router.mjs';
const PKG='/opt/paperclip/node_modules',SOURCE=fileURLToPath(new URL('../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const enabled=registry=>registry.runtimeRouting?.schemaVersion===1&&registry.runtimeRouting.mode==='task';
const envValue=value=>typeof value==='string'?value:value?.type==='plain'?value.value:null;
const authKeys=['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','DEEPSEEK_API_KEY','MINIMAX_API_KEY','CODEX_HOME','OPENCODE_CONFIG','OPENCODE_CONFIG_DIR','OPENCODE_CONFIG_CONTENT','CLAUDE_CONFIG_DIR','SUPER_AGENT_ROLE_PROVIDER_API_KEY'];

export function teamRuntimeProposal({registry,task,entry,rootTaskId,operationId,phase='work',repair=false}){
 const core=phase!=='work'||['chief','pm','architect','qa'].includes(entry.role);
 const declared=validateTeamRuntimeSelection(entry.runtime,entry.role);
 const selection=core||repair||declared===undefined?{complexity:'unknown',risk:'unknown',purpose:declared?.purpose??'execution',requiredTools:declared?.requiredTools??[]}:
  declared;
 return{taskId:task.id,rootTaskId,agentId:registry.team.ids[entry.role],role:entry.role,operationId,inputRevision:taskInputRevision(task),...selection};
}
/** Shared normal/isolated dispatch exit; the supplied management ports, not the model, own all effects. */
export async function dispatchTeamTaskRuntime(proposal,ports){return createTaskRuntimeRouter(ports)(proposal);}

export function createTeamTaskRuntimeController({native:p,root=ROLE_ROOT,log=()=>{},poolPorts,implementationBindings,configureRuntime:configurePort,readRegistry,editRegistry=editRoleRegistry,managedWake}={}){
 const poolRoot=root+'/task-runtime-pool',registry=readRegistry??(()=>readControl(root+'/registry.json'));
 const evidence=ref=>{if(typeof ref?.file!=='string'||path.posix.normalize(ref.file)!==ref.file||path.isAbsolute(ref.file)||ref.file.split('/').some(part=>!part||part==='.'||part==='..'))fail('TEAM_RUNTIME_EVIDENCE_PATH_DENIED');
  let cursor=poolRoot;for(const part of ref.file.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())fail('TEAM_RUNTIME_EVIDENCE_PATH_DENIED');}const stat=fs.lstatSync(cursor);if(!stat.isFile()||stat.nlink!==1||stat.uid!==0||(stat.mode&0o077)||stat.size>4194304)fail('TEAM_RUNTIME_EVIDENCE_PATH_DENIED');return fs.readFileSync(cursor);};
 const rawPool=poolPorts??{readOperatorRegistrations:()=>{const index=readControl(poolRoot+'/index.json');if(index.operatorId!==registry().ownerId)fail('TEAM_RUNTIME_OPERATOR_CHANGED');return index;},readAcceptanceEvidence:evidence};
 function liveBindings(){
  if(implementationBindings)return implementationBindings();
  const observation=readControl(root+'/team/runtime-implementations.json'),captured=Date.parse(observation.capturedAt);
  if(observation.kind!=='macos-runtime-implementations'||observation.hostPlatform!=='darwin'||captured>Date.now()+5000||Date.now()-captured>300000||!Number.isFinite(captured))fail('TEAM_RUNTIME_IMPLEMENTATION_STALE');
  const result={};for(const [profileId,value]of Object.entries(observation.bindings??{})){if(!RUNTIME_PROFILES[profileId])continue;
   const actual=computeTaskRuntimeImplementationBinding({profileId,cliSha256:value.cliSha256,files:taskRuntimeImplementationFiles(profileId).map(file=>({file,sha256:sha(fs.readFileSync(path.join(SOURCE,file)))}))});
   if(equal(actual,value))result[profileId]=actual;else if(actual.sourceSha256===value.sourceSha256&&actual.cliSha256===value.cliSha256)result[profileId]=actual;
  }return result;
 }
 async function currentPool(){
  const original=await loadTaskRuntimePool(rawPool),bindings=liveBindings(),current=new Set(original.available.filter(item=>taskRuntimeImplementationMatches(item,bindings[item.profileId])).map(item=>item.registrationId));
  const filtered={...rawPool,readOperatorRegistrations:async()=>{const index=structuredClone(await rawPool.readOperatorRegistrations());for(const item of index.entries)if(item.status==='ACTIVE'&&!current.has(item.id))item.status='INACTIVE';return index;}};
  return{pool:await loadTaskRuntimePool(filtered),ports:filtered,bindings};
 }
 async function checkConfiguration(choice){
  const r=registry(),profile=RUNTIME_PROFILES[choice.profileId];if(profile.runtime==='codex')return;
  const ref=r.credentialRefs?.[profile.provider];if(ref?.type!=='secret_ref'||typeof ref.secretId!=='string')fail('TEAM_RUNTIME_PROVIDER_NOT_CONFIGURED');
 }
 async function preflight(proposal){try{const value=await currentPool(),choice=selectTaskRuntimeCombination(value.pool,proposal);await checkConfiguration(choice);return{...value,choice};}
  catch(error){if(/^(?:TASK_ROUTER|TASK_RUNTIME)_[A-Z_]+$/.test(error.code??''))fail('TEAM_RUNTIME_'+error.code);throw error;}}
 async function configure(value){
  if(configurePort)return configurePort(value);
  const {route,combination}=value,r=registry(),profile=RUNTIME_PROFILES[combination.profileId],entry=r.agents.find(item=>item.profile.agentId===route.agentId);
  const [agent]=await p.db.select().from(p.schema.agents).where(p.orm.eq(p.schema.agents.id,route.agentId));
  if(!agent||agent.companyId!==r.companyId||!entry||roleExecutionPolicy(entry.profile).executor!=='macos_native')fail('TEAM_RUNTIME_NATIVE_BINDING_DENIED');
  let baseline=entry.runtimeBaseline;
  if(!baseline){if(agent.adapterType!=='codex_local'||agent.runtimeConfig?.aiConnection?.provider!=='openai'||agent.runtimeConfig.aiConnection.method!=='subscription')fail('TEAM_RUNTIME_SUBSCRIPTION_BASELINE_REQUIRED');
   baseline={adapterConfig:agent.adapterConfig,runtimeConfig:agent.runtimeConfig};editRegistry(current=>{const selected=current.agents.find(item=>item.profile.agentId===route.agentId);selected.runtimeBaseline??=baseline;return current;});}
  const api=profile.runtime!=='codex',config={...agent.adapterConfig},env={...config.env};for(const key of authKeys)delete env[key];
  for(const key of ['modelReasoningEffort','dangerouslyBypassApprovalsAndSandbox','dangerouslyBypassSandbox','dangerouslySkipPermissions','search','effort','chrome','maxTurnsPerRun','variant','args'])delete config[key];
  Object.assign(config,{engine:'cli',command:'/opt/super-agent/bin/'+profile.runtime,model:profile.model,extraArgs:[],env:{...env,SUPER_AGENT_ROLE_ENABLED:'true',SUPER_AGENT_ROLE_AGENT_ID:route.agentId}});
  if(api){config.dangerouslySkipPermissions=true;config.env.SUPER_AGENT_ROLE_PROVIDER_API_KEY=r.credentialRefs[profile.provider];
   if(profile.runtime==='opencode'){config.env.OPENCODE_CONFIG=root+'/opencode-clients/'+route.agentId+'/config.json';fs.mkdirSync(path.dirname(config.env.OPENCODE_CONFIG),{recursive:true,mode:0o700});writeControl(config.env.OPENCODE_CONFIG,{model:profile.model,provider:{}});}
   else{config.maxTurnsPerRun=64;config.effort='';config.chrome=false;config.env.CLAUDE_CONFIG_DIR=root+'/claude-clients/'+route.agentId+'/config';fs.mkdirSync(config.env.CLAUDE_CONFIG_DIR,{recursive:true,mode:0o700});}
  }else Object.assign(config,{modelReasoningEffort:'low',search:true,dangerouslyBypassApprovalsAndSandbox:true,dangerouslyBypassSandbox:true});
  const lifecycle=(await import(PKG+'/@paperclipai/server/dist/services/agent-lifecycle.js')).createAgentLifecycle(p.db);
  await lifecycle.updateConfiguration(route.agentId,{adapterType:profile.adapterType,adapterConfig:config,runtimeConfig:{...agent.runtimeConfig,aiConnection:api?null:baseline.runtimeConfig.aiConnection}},{recordRevision:{source:'team-task-runtime-routing',createdByUserId:r.ownerId}});
 }
 async function managedMarker(proposal,route){
  if(managedWake)return managedWake(proposal,route);
  const {createManagedWakeProof}=await import(PKG+'/@paperclipai/server/dist/services/super-agent-controlled-retry.js');
  const value=createManagedWakeProof({schemaVersion:2,taskId:proposal.taskId,companyId:registry().companyId,agentId:proposal.agentId,scopeId:proposal.rootTaskId,scopeSha256:sha(JSON.stringify(route)),attemptId:proposal.operationId,permitId:route.id,role:proposal.role==='qa'?'review':'develop'});
  const dir='/paperclip/control/daily/tasks/'+proposal.taskId;fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=dir+'/managed-wake-'+proposal.operationId+'.json';
  if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(value.bytes))fail('TEAM_RUNTIME_WAKE_PROOF_CHANGED');}else fs.writeFileSync(file,value.bytes,{flag:'wx',mode:0o600});return value.marker;
 }
 return{
  enabled,
  async available(){const value=await currentPool();return value.pool.available.map(({profileId,modelId,runtimeId,taskTypes,tools})=>({profileId,modelId,runtimeId,taskTypes,tools}));},
  async bindAcceptedChief({task,operation,run,proposal}){
   if(run.agentId!==proposal.agentId||run.issueId!==task.id||run.status!=='running'||operation.acceptedRunId!==run.id)fail('TEAM_RUNTIME_ACCEPTED_CHIEF_CHANGED');
   const {choice}=await preflight(proposal);if(choice.profileId!=='codex_subscription')fail('TEAM_RUNTIME_CORE_PROFILE_REQUIRED');
   const route=createTaskRuntimeRoute({taskId:task.id,rootTaskId:proposal.rootTaskId,agentId:proposal.agentId,role:proposal.role,operationId:proposal.operationId,inputRevision:proposal.inputRevision,
    selection:Object.fromEntries(['complexity','risk','purpose'].map(key=>[key,proposal[key]]))});
   editRegistry(current=>projectTaskRuntimeRoute(current,route));const marker=await managedMarker(proposal,route);
   const changed=await p.db.update(p.schema.heartbeatRuns).set({contextSnapshot:{...run.contextSnapshot,roleOperationId:operation.id,inputRevision:proposal.inputRevision,superAgentControlledExecution:marker}})
    .where(p.orm.and(p.orm.eq(p.schema.heartbeatRuns.id,run.id),p.orm.eq(p.schema.heartbeatRuns.companyId,run.companyId),p.orm.eq(p.schema.heartbeatRuns.status,'running'))).returning({id:p.schema.heartbeatRuns.id});
   if(changed.length!==1)fail('TEAM_RUNTIME_ACCEPTED_CHIEF_CHANGED');return route;
  },
  preflight,
  async dispatch({proposal,readState,assign,persistRoute,wakeup,handoff,assignTaskOwnerCAS}){
   const prepared=await preflight(proposal),ports={...prepared.ports,log,
    readTaskState:async()=>{const state=await readState();return{...state,implementationBindings:liveBindings(),...(handoff?{handoff:await handoff(state)}:{})};},
    persistRoute,configureRuntime:async value=>{await configure(value);if(value.route.handoff?.handoffKind!=='role-transfer')await assign(value.route);},
    ...(assignTaskOwnerCAS?{assignTaskOwnerCAS}:{}),wakeup:async value=>wakeup({...value,contextSnapshot:{...value.contextSnapshot,superAgentControlledExecution:await managedMarker(proposal,value.route)}})};
   return dispatchTeamTaskRuntime(proposal,ports);
  },
 };
}
