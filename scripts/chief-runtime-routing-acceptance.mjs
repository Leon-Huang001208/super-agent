/** Operator-only real Chief → trusted router → one execution. Historical matrices never certify the current implementation. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {AdmissionMeter} from '../bridge/admission.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {teamArtifactNames} from '../bridge/team-context.mjs';
import {rootCallLimit} from '../bridge/task-call-policy.mjs';
import {loadTaskRuntimePool,selectTaskRuntimeCombination,createTaskRuntimeRouter,taskRuntimeImplementationFiles,computeTaskRuntimeImplementationBinding} from '../bridge/task-runtime-router.mjs';
import {createTaskRuntimeAcceptanceEvidence} from '../bridge/task-runtime-acceptance-evidence.mjs';
import {assertDelegatedAuth,reserveAcceptanceTask} from './multi-runtime-acceptance.mjs';
import {ACCEPTANCE_ROOT as ROOT,privateJson,writePrivate,createMultiRuntimeNativeFixture,knownBootstrapClosure} from '../tests/helpers/multi-runtime-native-fixture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=suffix=>{const code='CHIEF_ROUTING_'+suffix;throw Object.assign(Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const relative=value=>typeof value==='string'&&value.length<=512&&value.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..');
const codeOf=error=>/^[A-Z][A-Z_0-9]+$/.test(error?.code??'')?error.code:'CHIEF_ROUTING_UNKNOWN';
const SOURCE_ROOT=fileURLToPath(new URL('../',import.meta.url));
const STATE=ROOT+'/chief-runtime-routing-acceptance.json',POOL=ROOT+'/chief-runtime-routing-pool';
const HOST_IMPLEMENTATIONS='/host-evidence/runtime-implementations.json';
const ownerRoles=['full-stack-engineer','backend-engineer','frontend-engineer'];
function guardedFile(base,file,{privateMode=true,maximum=4194304}={}){
 if(!relative(file)||fs.realpathSync(base)!==base)fail('FILE_SCOPE_DENIED');
 let cursor=base;for(const component of file.split('/')){cursor=path.join(cursor,component);const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink())fail('FILE_SCOPE_DENIED');}
 const stat=fs.lstatSync(cursor);if(!stat.isFile()||stat.nlink!==1||stat.size>maximum||privateMode&&(stat.mode&0o077))fail('PRIVATE_FILE_DENIED');return fs.readFileSync(cursor);
}
export function writeChiefRoutingEvidenceOnce(root,files){
 fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.realpathSync(root)!==root)fail('FILE_SCOPE_DENIED');
 for(const item of files){
  if(!relative(item.file)||!Buffer.isBuffer(item.bytes)||item.bytes.length>1048576)fail('EVIDENCE_FILE_DENIED');
  let cursor=root;for(const component of item.file.split('/').slice(0,-1)){cursor=path.join(cursor,component);if(!fs.existsSync(cursor))fs.mkdirSync(cursor,{mode:0o700});if(!fs.lstatSync(cursor).isDirectory()||fs.lstatSync(cursor).isSymbolicLink())fail('FILE_SCOPE_DENIED');}
  const destination=path.join(root,item.file);
  try{fs.writeFileSync(destination,item.bytes,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;if(!guardedFile(root,item.file).equals(item.bytes))fail('EVIDENCE_CHANGED');}
 }
}
export function assertChiefRoutingSource(plan,registry){
 if(plan?.schemaVersion!==1||plan.status!=='PASS'||!Array.isArray(plan.steps)||!plan.steps.length||
  plan.steps.some(step=>step.status!=='PASS'||!uuid(step.runId))||registry?.companyId!==plan.companyId||registry.projectId!==plan.projectId||registry.taskId!==plan.rootTaskId||
  registry.team?.enabled!==false||!equal(registry.team.ids,plan.agentIds)||!Object.values(plan.agentIds??{}).every(uuid)||!plan.agentIds?.chief||
  registry.policy?.maxRootRoleCalls!==20||registry.policy.maxResponsesPerRun!==64||registry.policy.concurrentExecutions!==1)fail('SOURCE_NOT_COMPLETED');
}
export function createChiefRuntimeRoutingStage({plan,currentCases=plan,registry,rootTask,targetTask,sourcePlanSha256,budgetBefore=[]}){
 assertChiefRoutingSource(plan,registry);
 if(!targetTask||targetTask.companyId!==plan.companyId||targetTask.projectId!==plan.projectId||rootTask?.id!==plan.rootTaskId||taskInputRevision(rootTask)!==plan.rootInputRevision||!hash(sourcePlanSha256))fail('STAGE_SCOPE_DENIED');
 const previous=currentCases.steps.filter(step=>step.taskId===targetTask.id).at(-1);if(!previous)fail('TARGET_NOT_PROVEN');
 const chiefId=randomUUID(),executionId=randomUUID(),identity={taskId:targetTask.id,rootTaskId:plan.rootTaskId,operationId:executionId,inputRevision:taskInputRevision(targetTask)};
 return{schemaVersion:1,kind:'isolated-chief-runtime-routing',status:'NOT_RUN',companyId:plan.companyId,projectId:plan.projectId,rootTaskId:plan.rootTaskId,
  sourcePlanSha256,budgetBefore:structuredClone(budgetBefore),agentIds:structuredClone(plan.agentIds),
  chief:{status:'NOT_RUN',operationId:chiefId,taskId:plan.rootTaskId,agentId:plan.agentIds.chief,role:'chief',phase:'summary',outputFile:'runtime-proposal-'+chiefId+'.json',
   artifactGeneration:chiefId,...teamArtifactNames({taskId:plan.rootTaskId,inputRevision:plan.rootInputRevision,generationId:chiefId}),
   identity:{taskId:plan.rootTaskId,rootTaskId:plan.rootTaskId,agentId:plan.agentIds.chief,role:'chief',operationId:chiefId,inputRevision:plan.rootInputRevision}},
  execution:{status:'NOT_RUN',operationId:executionId,taskId:targetTask.id,identity,handoffFromOperationId:previous.operationId,phase:'work',outputFile:'runtime-task-'+executionId+'.json',
   ownerCandidates:ownerRoles.filter(role=>plan.agentIds[role]&&registry.agents?.some(entry=>entry.profile.role===role&&entry.profile.agentId===plan.agentIds[role])).map(role=>({role,agentId:plan.agentIds[role]}))},
  outbox:'NOT_RUN',production:'NOT_RUN',newRootCreated:false};
}
export function chiefRuntimeRoutingPrompt(stage,pool){
 const available=pool.available.map(({profileId,modelId,runtimeId,tools,taskTypes,receiptSha256})=>({profileId,modelId,runtimeId,tools,taskTypes,receiptSha256}));
 return'当前是原Root的受控summary回合，不创建新任务、Agent或team plan，不发送消息。只读取已完成的真实隔离验收结果，先选择唯一Owner，再分别判断modelId、runtimeId和requiredTools。跨前后端功能优先全栈Owner，专门复杂后端/前端工作由对应专业岗；Core/复杂/高风险必须Codex。candidate不是available，未通过或NOT_RUN不能选；不能伪造PASS或回退。\n'+
  '本次后继是在同一个功能任务重新执行已有固定检查并写新的独立报告，不改已有实现/测试/QA报告/快照；需要真实shell执行检查。默认常规低风险；若实际更复杂或风险高如实选择complex/high和Codex，不可编造低风险。只写binding.outputFile；summary可写绑定的新summaryFile，不写planFile。JSON形状为{schemaVersion:1,proposal:{...identity,role,agentId,complexity:"routine",risk:"low",purpose:"execution",modelId,runtimeId,requiredTools:["shell"]},ownerReason,modelReason,runtimeReason}，理由各用一段话。身份必须精确匹配下方，Owner只能从真实roster候选选择。不能写provider Key、session、费用或证据PASS。\n'+
  JSON.stringify({identity:stage.execution.identity,owners:stage.execution.ownerCandidates,available,outputFile:stage.execution.outputFile});
}
export function validateChiefRuntimeDecision(document,{stage,pool}){
 if(!plain(document)||Object.keys(document).some(key=>!['schemaVersion','proposal','ownerReason','modelReason','runtimeReason'].includes(key))||document.schemaVersion!==1||
  !['ownerReason','modelReason','runtimeReason'].every(key=>typeof document[key]==='string'&&document[key].trim()&&document[key].length<=4000))fail('PROPOSAL_SHAPE_DENIED');
 const proposal=document.proposal;
 if(!plain(proposal)||Object.entries(stage.execution.identity).some(([key,value])=>proposal[key]!==value)||
  !stage.execution.ownerCandidates.some(owner=>owner.role===proposal.role&&owner.agentId===proposal.agentId)||
  proposal.purpose!=='execution'||!proposal.requiredTools?.includes('shell'))fail('PROPOSAL_SCOPE_DENIED');
 return{proposal:structuredClone(proposal),combination:selectTaskRuntimeCombination(pool,proposal)};
}
export function validateRuntimeImplementationObservation(observation,{profileId,now=Date.now(),sourceSha256}){
 const captured=Date.parse(observation?.capturedAt),binding=observation?.bindings?.[profileId];
 if(observation?.schemaVersion!==1||observation.kind!=='macos-runtime-implementations'||observation.hostPlatform!=='darwin'||
  !Number.isFinite(captured)||captured>now+5000||now-captured>300000||!hash(binding?.sourceSha256)||!hash(binding?.cliSha256)||binding.sourceSha256!==sourceSha256)fail('HOST_IMPLEMENTATION_STALE');
 return{sourceSha256:binding.sourceSha256,cliSha256:binding.cliSha256};
}
/** Only operator-tested Node suites in the existing artifact directory; model-provided commands never reach spawn. */
export function chiefRuntimeCheckCommands(cases,taskId){
 const checks=new Map();for(const step of cases.steps.filter(step=>step.taskId===taskId))for(const test of step.testing??[]){
  const match=typeof test.command==='string'?test.command.match(/^node --test(?: --test-reporter=tap)? ([a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\.test\.(?:mjs|js|cjs))$/):null;
  if(test.exitCode!==0||!match)continue;checks.set(match[1],{file:match[1],command:'node --test '+match[1]});
 }
 if(!checks.size||checks.size>8)fail('TESTED_CHECKS_MISSING');return[...checks.values()];
}
function executeChecks(checks,cwd){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.PAPERCLIP_SECRETS_MASTER_KEY;
 return checks.map(check=>{const result=spawnSync(process.execPath,['--test','--test-reporter=tap',check.file],{cwd,env,encoding:'utf8',timeout:10000,maxBuffer:1048576});
  const passed=(result.stdout??'').match(/# pass (\d+)\b/);if(result.status!==0||result.signal||result.error||!passed||Number(passed[1])<1)fail('FIXED_CHECK_FAILED');
  return{command:check.command,exitCode:result.status,count:Number(passed[1]),stdoutSha256:sha(result.stdout),stderrSha256:sha(result.stderr)};});
}
function budget(rootTaskId){return fs.readdirSync(ROOT+'/budget/'+rootTaskId).sort().map(file=>{if(!/^[a-f0-9-]{36}\.json$/.test(file))fail('BUDGET_DENIED');return{file,sha256:sha(guardedFile(ROOT,'budget/'+rootTaskId+'/'+file))};});}
function retainedBudget(before,rootTaskId){const current=budget(rootTaskId);if(before.some(ref=>!current.some(value=>equal(value,ref))))fail('BUDGET_CHANGED');return current;}
function protectedArtifacts(plan,cases,cwd){
 const refs=new Map();for(const step of [...plan.steps,...cases.steps])for(const ref of step.artifacts??[]){if(refs.has(ref.file)&&refs.get(ref.file)!==ref.sha256)fail('ARTIFACT_CONFLICT');refs.set(ref.file,ref.sha256);}
 return[...refs].map(([file,expected])=>{const digest=sha(guardedFile(cwd,file,{privateMode:false,maximum:1048576}));if(digest!==expected)fail('ARTIFACT_CHANGED');return{file,sha256:digest};});
}
function verifyProtected(stage,cwd){for(const ref of stage.protectedArtifacts)if(sha(guardedFile(cwd,ref.file,{privateMode:false,maximum:1048576}))!==ref.sha256)fail('OLD_ARTIFACT_CHANGED');retainedBudget(stage.budgetBefore,stage.rootTaskId);}
function sourceBinding(profileId,cliSha256){return computeTaskRuntimeImplementationBinding({profileId,cliSha256,files:taskRuntimeImplementationFiles(profileId).map(file=>({file,sha256:sha(fs.readFileSync(path.join(SOURCE_ROOT,file)))}))});}
function liveBindings(pool){
 const observation=privateJson(HOST_IMPLEMENTATIONS),bindings={};
 for(const combo of pool.available){const observed=observation.bindings?.[combo.profileId],current=sourceBinding(combo.profileId,observed?.cliSha256);
  bindings[combo.profileId]=validateRuntimeImplementationObservation(observation,{profileId:combo.profileId,sourceSha256:current.sourceSha256});}
 return bindings;
}
function evidencePorts(fixture){return{readRun:fixture.getRun,readRunFile:async(runId,file)=>{if(!uuid(runId)||!relative(file))fail('RUN_FILE_DENIED');return guardedFile(ROOT,'transport/'+runId+'/'+file);},
 listHostCalls:async runId=>{const directory=ROOT+'/transport/'+runId+'/proxy-audit/host-calls';if(!fs.existsSync(directory))return[];if(fs.realpathSync(directory)!==directory)fail('RUN_FILE_DENIED');return fs.readdirSync(directory);}};}
export function currentImplementationRegistration(registration,recorded,current){
 if(!hash(recorded?.sourceSha256)||!hash(recorded?.cliSha256)||!hash(current?.sourceSha256)||!hash(current?.cliSha256))fail('IMPLEMENTATION_BINDING_MISSING');
 return{...registration,status:recorded.sourceSha256===current.sourceSha256&&recorded.cliSha256===current.cliSha256?'ACTIVE':'INACTIVE_IMPLEMENTATION'};
}
async function currentPool(cases,fixture,sourceCasesSha256){
 const indexFile=POOL+'/index.json';
 if(!fs.existsSync(indexFile)){
  const build=createTaskRuntimeAcceptanceEvidence(evidencePorts(fixture)),items=[],entries=[];
  for(const step of cases.steps){
   if(step.status!=='PASS'||!uuid(step.runId))fail('CURRENT_CASE_NOT_PASSED');const run=await fixture.getRun(step.runId);
   const operation=fixture.getRegistry().operations.find(value=>value.id===step.operationId);
   if(run?.companyId!==cases.companyId||run.issueId!==step.taskId||run.agentId!==step.agentId||run.contextSnapshot?.roleOperationId!==step.operationId||
    cases.agentIds[step.role]!==step.agentId||operation?.taskId!==step.taskId||operation.agentId!==step.agentId||operation.role!==step.role||operation.taskRuntimeRoute?.profileId!==step.runtimeProfileId)fail('CURRENT_CASE_BINDING_DENIED');
   const result=await build({runId:step.runId,profileId:step.runtimeProfileId,taskTypes:[step.role==='research'?'research':'execution'],operatorId:fixture.ownerId});
   const recorded=JSON.parse(guardedFile(ROOT,'transport/'+step.runId+'/implementation-proof.json')),observation=privateJson(HOST_IMPLEMENTATIONS);
   const actual=sourceBinding(step.runtimeProfileId,observation.bindings?.[step.runtimeProfileId]?.cliSha256);
   const current=validateRuntimeImplementationObservation(observation,{profileId:step.runtimeProfileId,sourceSha256:actual.sourceSha256});
   items.push(...result.files);entries.push(currentImplementationRegistration(result.registration,recorded,current));
  }
  writeChiefRoutingEvidenceOnce(POOL,items);writeChiefRoutingEvidenceOnce(POOL,[{file:'source.json',bytes:Buffer.from(JSON.stringify({schemaVersion:1,sourceCasesSha256,companyId:cases.companyId,projectId:cases.projectId,rootTaskId:cases.rootTaskId})+'\n')},
   {file:'index.json',bytes:Buffer.from(JSON.stringify({schemaVersion:1,operatorId:fixture.ownerId,entries})+'\n')}]);
 }
 if(JSON.parse(guardedFile(POOL,'source.json')).sourceCasesSha256!==sourceCasesSha256)fail('POOL_SOURCE_CHANGED');
 const ports={readOperatorRegistrations:async()=>JSON.parse(guardedFile(POOL,'index.json')),readAcceptanceEvidence:async ref=>guardedFile(POOL,ref.file)};
 return{pool:await loadTaskRuntimePool(ports),ports};
}
async function activeRuns(fixture){const{db,schema:s,orm:o}=fixture;return(await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']))).map(row=>row.id);}
async function previousActorState(fixture,route){
 const runId=route.handoff.fromRunId,run=await fixture.getRun(runId),proof=await fixture.verifyActorScopeClosed(route.taskId,route.handoff.fromAgentId);
 if(run?.id!==runId||run.issueId!==route.taskId||run.agentId!==route.handoff.fromAgentId||run.status!=='succeeded'||!run.finishedAt)fail('PREVIOUS_ACTOR_UNKNOWN');
 if(!plain(proof)||proof.closed!==true||proof.taskId!==route.taskId||proof.agentId!==route.handoff.fromAgentId||proof.nativeExecutionStopVerified!==true||
  !Array.isArray(proof.activeRunIds)||proof.activeRunIds.length||!proof.proofs?.some(item=>item.runId===runId&&item.status==='succeeded'))fail('PREVIOUS_ACTOR_SCOPE_UNKNOWN');
 return{agentId:route.handoff.fromAgentId,role:route.handoff.fromRole,runId,taskId:route.taskId,rootTaskId:route.rootTaskId,
  scopeClosed:true,activeRunIds:[...proof.activeRunIds]};
}
async function returnRootToOwner(fixture,plan,chief){
 const task=await fixture.issue(plan.rootTaskId);if(taskInputRevision(task)!==plan.rootInputRevision||task.responsibleUserId!==fixture.ownerId)fail('ROOT_OWNER_CHANGED');
 if(task.assigneeAgentId===null&&task.assigneeUserId===fixture.ownerId&&task.status==='in_review')return;
 await fixture.assignAcceptanceTask({taskId:plan.rootTaskId,operationId:chief.operationId,role:'chief',agentId:null,userId:fixture.ownerId},
  {expectedAgentId:task.assigneeAgentId??null,expectedAssigneeUserId:task.assigneeUserId??null,expectedStatus:task.status,inputRevision:plan.rootInputRevision,status:'in_review'});
}
function makeHandoff(stage,cases,fixture,proposal){
 const previous=cases.steps.find(step=>step.operationId===stage.execution.handoffFromOperationId);if(!previous||previous.status!=='PASS')fail('HANDOFF_SOURCE_UNKNOWN');
 const before=budget(stage.rootTaskId),prefix='routing-handoff/'+stage.execution.operationId,refs=[];
 for(const ref of previous.artifacts??[]){const bytes=guardedFile(fixture.cwd,ref.file,{privateMode:false,maximum:1048576});if(sha(bytes)!==ref.sha256)fail('HANDOFF_ARTIFACT_CHANGED');
  const file=prefix+'/'+ref.file;writeChiefRoutingEvidenceOnce(fixture.cwd,[{file,bytes}]);refs.push({file,sha256:sha(bytes),runId:previous.runId});}
 if(!refs.length)fail('HANDOFF_ARTIFACT_MISSING');
 const material={schemaVersion:1,kind:'explicit-task-owner-runtime-handoff',taskId:proposal.taskId,rootTaskId:stage.rootTaskId,fromOperationId:previous.operationId,fromRunId:previous.runId,
  toOperationId:proposal.operationId,fromAgentId:previous.agentId,fromRole:previous.role,toAgentId:proposal.agentId,toRole:proposal.role,artifacts:refs,budgetBefore:before,chiefProposalSha256:stage.chief.artifactSha256};
 const file=prefix+'/handoff.json',bytes=Buffer.from(JSON.stringify(material)+'\n');writeChiefRoutingEvidenceOnce(fixture.cwd,[{file,bytes}]);
 return{previous:Object.fromEntries(['operationId','runId','taskId','agentId','role','runtimeProfileId','status'].map(key=>[key,previous[key]])),artifacts:refs,material:{file,sha256:sha(bytes)}};
}
async function actualHandoff(stage,fixture,proposal,stored){
 if(!stored)return undefined;
 const bytes=fixture.readRegistryBytes(),registry=JSON.parse(bytes),previous=(registry.taskRuntimeRoutes??[]).filter(route=>route.taskId===proposal.taskId&&route.operationId!==proposal.operationId).at(-1);
 if(previous?.operationId!==stored.previous.operationId)fail('HANDOFF_HISTORY_CHANGED');
 const transfer=previous.agentId!==proposal.agentId||previous.role!==proposal.role,run=await fixture.getRun(stored.previous.runId);
 if(run?.id!==stored.previous.runId||run.issueId!==proposal.taskId||run.agentId!==previous.agentId||run.status!=='succeeded'||!run.finishedAt)fail('HANDOFF_RUN_CHANGED');
 const dir='transport/'+run.id+'/';
 const h={previousRoute:previous,previousRun:run,transport:JSON.parse(guardedFile(ROOT,dir+'result.json')),
  executionClosed:['process-cleanup.json','broker-process-cleanup.json'].every(file=>JSON.parse(guardedFile(ROOT,dir+file)).status==='terminated'),
  budgetUsedBefore:budget(stage.rootTaskId).length,artifacts:stored.artifacts,material:stored.material};
 if(transfer){h.handoffKind='role-transfer';const actor=await previousActorState(fixture,{taskId:proposal.taskId,rootTaskId:stage.rootTaskId,handoff:{fromRunId:run.id,fromAgentId:previous.agentId,fromRole:previous.role}});h.actorScopeClosed=actor.scopeClosed&&actor.activeRunIds.length===0;}
 return h;
}

function isolated(){if(process.platform!=='linux'||process.getuid?.()!==0||process.env.SUPER_AGENT_ISOLATED_MULTI_RUNTIME!=='1'||process.env.SUPER_AGENT_RUN_CHIEF_ROUTING_ACCEPTANCE!=='1')fail('ISOLATED_ENVIRONMENT_REQUIRED');}
/** Actual installed Native fixture only. Unit tests exercise pure planning/contracts and never replace Chief, Native or provider execution. */
export async function runChiefRuntimeRoutingAcceptance(inputFile,{casesFile=ROOT+'/multi-runtime-current13-acceptance.json'}={}){
 isolated();const input=privateJson(inputFile);assertDelegatedAuth(input.codexAuth);
 if(path.dirname(casesFile)!==ROOT||path.basename(casesFile)!=='multi-runtime-current13-acceptance.json')fail('CURRENT_CASE_FILE_DENIED');
 const sourceBytes=guardedFile(ROOT,'multi-runtime-acceptance.json'),plan=JSON.parse(sourceBytes),caseBytes=guardedFile(ROOT,path.basename(casesFile)),cases=JSON.parse(caseBytes),sourceCasesSha256=sha(caseBytes);
 if(cases.kind!=='isolated-native-current13')fail('CURRENT_CASE_KIND_DENIED');
 const fixture=await createMultiRuntimeNativeFixture(plan,input,{resumeCompleted:true});
 const log=event=>{const file=ROOT+'/chief-runtime-routing-events.jsonl';if(fs.existsSync(file)&&fs.statSync(file).size>1048576)fail('LOG_LIMIT');fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});};
 const meter=new AdmissionMeter({filename:fixture.admissionFile,allowedProjectIds:[plan.projectId],log});let stage;
 try{
  if(['getRegistry','readRegistryBytes','setRegistryCAS','getRun','issue','configureRuntime','managedWake','assignAcceptanceTask','assignTaskOwnerCAS','verifyActorScopeClosed','ensureAcceptanceDelegation'].some(name=>typeof fixture[name]!=='function'))fail('TRUSTED_PORT_MISSING');
  assertChiefRoutingSource(plan,fixture.getRegistry());assertChiefRoutingSource(cases,fixture.getRegistry());
  if(!cases.agentIds['full-stack-engineer'])fail('CURRENT_ROSTER_NOT_REGISTERED');
  const targetId=cases.executionTaskId??cases.steps.find(step=>step.role==='full-stack-engineer')?.taskId;if(!targetId)fail('CURRENT_TARGET_MISSING');
  const rootTask=await fixture.issue(plan.rootTaskId),targetTask=await fixture.issue(targetId);
  stage=fs.existsSync(STATE)?privateJson(STATE):createChiefRuntimeRoutingStage({plan,currentCases:cases,registry:fixture.getRegistry(),rootTask,targetTask,sourcePlanSha256:sha(sourceBytes),budgetBefore:budget(plan.rootTaskId)});
  stage.sourceCasesSha256??=sourceCasesSha256;
  if(stage.companyId!==plan.companyId||stage.rootTaskId!==plan.rootTaskId||stage.sourcePlanSha256!==sha(sourceBytes)||stage.sourceCasesSha256!==sourceCasesSha256||stage.execution.taskId!==targetId||!equal(stage.agentIds,plan.agentIds))fail('STAGE_HISTORY_CHANGED');
  stage.checks??=chiefRuntimeCheckCommands(cases,targetId);
  stage.protectedArtifacts??=protectedArtifacts(plan,cases,fixture.cwd);
  for(const check of stage.checks)if(!stage.protectedArtifacts.some(ref=>ref.file===check.file))stage.protectedArtifacts.push({file:check.file,sha256:sha(guardedFile(fixture.cwd,check.file,{privateMode:false,maximum:1048576}))});
  verifyProtected(stage,fixture.cwd);const save=()=>writePrivate(STATE,stage);save();
  if(stage.status==='PASS')return stage;
  if(rootCallLimit(fixture.getRegistry(),plan.rootTaskId)-budget(plan.rootTaskId).length<2&&!stage.chief.runId)fail('BUDGET_INSUFFICIENT');
  const{pool,ports:poolPorts}=await currentPool(cases,fixture,sourceCasesSha256);
  const build=createTaskRuntimeAcceptanceEvidence(evidencePorts(fixture));
  async function phase(step,proposal,goal,stored){
   if(step.status==='PASS'){if(sha(guardedFile(fixture.cwd,step.outputFile,{privateMode:false,maximum:131072}))!==step.artifactSha256)fail('PHASE_ARTIFACT_CHANGED');return;}
   if(step.status!=='NOT_RUN'||step.runId)fail('PHASE_RECONCILIATION_REQUIRED');
   if(fs.existsSync(path.join(fixture.cwd,step.outputFile)))fail('ARTIFACT_ALREADY_EXISTS');
   const selected=selectTaskRuntimeCombination(pool,proposal),binding=liveBindings(pool)[selected.profileId];
   if(!equal(binding,{sourceSha256:selected.implementation.sourceSha256,cliSha256:selected.implementation.cliSha256}))fail('POOL_IMPLEMENTATION_CHANGED');
   if(stored)await actualHandoff(stage,fixture,proposal,stored);
   const lease=await reserveAcceptanceTask({meter,taskId:proposal.taskId,projectId:plan.projectId,readStorage:()=>privateJson('/host-evidence/host-storage.json')},{timeoutMs:900000});
   step.lease=lease;step.status='RESERVED';save();
   const registered=fixture.getRegistry(),expectedSha256=sha(fixture.readRegistryBytes());if(registered.lease)fail('LEASE_RECONCILIATION_REQUIRED');
   const operation={id:proposal.operationId,kind:'run',taskId:proposal.taskId,rootTaskId:plan.rootTaskId,rootInputRevision:plan.rootInputRevision,projectId:plan.projectId,
    agentId:proposal.agentId,role:proposal.role,inputRevision:proposal.inputRevision,phase:step.phase,outputFile:step.outputFile,additionalInput:goal,
    ...(step.artifactGeneration?{artifactGeneration:step.artifactGeneration,planFile:step.planFile,summaryFile:step.summaryFile,outputPrefix:step.outputPrefix}:{})};
   registered.operations.push(operation);registered.lease={taskId:proposal.taskId,projectId:plan.projectId,operationId:proposal.operationId,nonce:lease.nonce};await fixture.setRegistryCAS(registered,{expectedSha256});
   const router=createTaskRuntimeRouter({...poolPorts,log,
    readTaskState:async()=>{const bytes=fixture.readRegistryBytes(),registry=JSON.parse(bytes),handoff=await actualHandoff(stage,fixture,proposal,stored),implementationBindings=liveBindings(pool);
     return{registry,registrySha256:sha(bytes),task:await fixture.issue(proposal.taskId),operation:registry.operations.find(op=>op.id===proposal.operationId),budgetUsed:budget(plan.rootTaskId).length,budgetLimit:rootCallLimit(registry,plan.rootTaskId),
      executionClosed:!fs.existsSync(ROOT+'/call.lock'),activeRunIds:await activeRuns(fixture),implementationBindings,...(handoff?{handoff}:{}),
      ...(handoff?.handoffKind==='role-transfer'?{previousActor:await previousActorState(fixture,{taskId:proposal.taskId,rootTaskId:plan.rootTaskId,handoff:{fromAgentId:handoff.previousRoute.agentId,fromRole:handoff.previousRoute.role,fromRunId:handoff.previousRun.id}})}:{})};},
    persistRoute:async value=>{if(budget(plan.rootTaskId).length!==value.budgetUsedBefore)fail('BUDGET_CHANGED');await fixture.setRegistryCAS(value.registry,{expectedSha256:value.previousRegistrySha256});},
    configureRuntime:async({route,combination,state})=>{await fixture.configureRuntime({...step,...proposal,goal,runtimeProfileId:combination.profileId},route);
     if(route.handoff?.handoffKind!=='role-transfer')await fixture.assignAcceptanceTask({...step,...proposal},{expectedAgentId:state.task.assigneeAgentId??null,expectedAssigneeUserId:state.task.assigneeUserId??null,expectedStatus:state.task.status,inputRevision:proposal.inputRevision});},
    assignTaskOwnerCAS:async value=>fixture.assignTaskOwnerCAS(value),
    wakeup:async value=>{
     if(RUNTIME_PROFILES[value.route.profileId].credentialKind==='chatgpt-subscription')await fixture.ensureAcceptanceDelegation({...step,...proposal,runtimeProfileId:value.route.profileId},{minimumRemainingMs:210000,timeoutMs:120000});
     await fixture.heartbeat.resetRuntimeSession(proposal.agentId,{taskKey:proposal.taskId});const marker=await fixture.managedWake({...step,...proposal},value.route);
     const initialChief=proposal.role==='chief'&&proposal.taskId===plan.rootTaskId;
     step.status='WAKE_PENDING';step.taskRuntimeRoute=value.route;save();const run=await fixture.heartbeat.wakeup(proposal.agentId,{manualUserWake:initialChief,source:'on_demand',triggerDetail:'manual',
      requestedByActorType:initialChief?'user':'agent',requestedByActorId:initialChief?fixture.ownerId:plan.agentIds.chief,
      reason:initialChief?'issue_commented':'team_controlled_assignment',idempotencyKey:value.idempotencyKey,payload:{issueId:proposal.taskId},contextSnapshot:{...value.contextSnapshot,taskGoal:goal,superAgentControlledExecution:marker}});
     if(run?.id){step.runId=run.id;step.status='RUNNING';save();}return run;}});
   const dispatched=await router(proposal);if(dispatched.status!=='WOKEN'){step.status=dispatched.status;step.errorCode=dispatched.code;save();fail('DISPATCH_RECONCILIATION_REQUIRED');}
   const until=Date.now()+195000;let run;
   while(Date.now()<until){run=await fixture.getRun(step.runId);if(!['queued','running'].includes(run?.status))break;await new Promise(resolve=>setTimeout(resolve,500));}
   if(!run?.finishedAt||!['succeeded','failed','cancelled','timed_out'].includes(run.status))fail('NATIVE_RESULT_UNKNOWN');
   if(run.status!=='succeeded'){
    if(run.resultJson?.executionRecovery?.providerWorkStarted!==false)fail('NATIVE_CASE_FAILED');await fixture.heartbeat.drainActiveRunExecutions();
    const{db,schema:s,orm:o}=fixture,events=await db.select().from(s.heartbeatRunEvents).where(o.eq(s.heartbeatRunEvents.runId,run.id));
    knownBootstrapClosure(run,{claimExists:fs.existsSync(ROOT+'/claims/'+run.id+'.json'),transportExists:fs.existsSync(ROOT+'/transport/'+run.id),providerAuditExists:fs.existsSync(ROOT+'/transport/'+run.id+'/proxy-audit'),callLockExists:fs.existsSync(ROOT+'/call.lock')},{executionEvents:events});
   }else{
    const proof=await build({runId:run.id,profileId:dispatched.route.profileId,taskTypes:[proposal.role==='chief'?'runtime-selection':'execution'],operatorId:fixture.ownerId});
    writeChiefRoutingEvidenceOnce(ROOT+'/chief-runtime-routing-results',proof.files);step.acceptance=proof.registration;step.actualTools=proof.receipt.tools;
   }
   if(fs.existsSync(ROOT+'/call.lock'))fail('EXECUTION_NOT_CLOSED');
   meter.release({taskId:proposal.taskId,nonce:lease.nonce,terminalEvidence:true});const current=fixture.getRegistry(),revision=sha(fixture.readRegistryBytes());if(current.lease?.nonce!==lease.nonce)fail('LEASE_CHANGED');delete current.lease;await fixture.setRegistryCAS(current,{expectedSha256:revision});
   step.leaseReleased=true;step.budgetAfter=retainedBudget(stage.budgetBefore,plan.rootTaskId);save();
   if(run.status!=='succeeded')fail('NATIVE_CASE_FAILED');if(proposal.role!=='chief'&&!step.actualTools.includes('shell'))fail('EXECUTION_TOOL_NOT_USED');
   step.artifactSha256=sha(guardedFile(fixture.cwd,step.outputFile,{privateMode:false,maximum:131072}));step.status='PASS';save();verifyProtected(stage,fixture.cwd);
  }
  const chiefProposal={...stage.chief.identity,complexity:'routine',risk:'low',purpose:'execution',modelId:RUNTIME_PROFILES.codex_subscription.providerModel,runtimeId:'codex',requiredTools:[]};
  await phase(stage.chief,chiefProposal,chiefRuntimeRoutingPrompt(stage,pool));await returnRootToOwner(fixture,plan,stage.chief);
  const decision=validateChiefRuntimeDecision(JSON.parse(guardedFile(fixture.cwd,stage.chief.outputFile,{privateMode:false,maximum:131072})),{stage,pool});
  stage.proposal=decision.proposal;stage.execution.agentId=decision.proposal.agentId;stage.execution.role=decision.proposal.role;stage.execution.handoff??=makeHandoff(stage,cases,fixture,decision.proposal);save();
  const goal='读取可信handoff材料与原任务实现及固定测试；仅实际执行下方现有检查并写新的binding.outputFile。不得改旧实现、测试、QA、报告、快照；费用未知，不得自报provider验收PASS。输出JSON {schemaVersion:1,taskId,rootTaskId,operationId,checks:[{command,exitCode}],notRun:[]}。可信身份/检查：'+JSON.stringify({...stage.execution.identity,checks:stage.checks});
  await phase(stage.execution,decision.proposal,goal,stage.execution.handoff);
  const output=JSON.parse(guardedFile(fixture.cwd,stage.execution.outputFile,{privateMode:false,maximum:131072}));
  if(output.schemaVersion!==1||['taskId','rootTaskId','operationId'].some(key=>output[key]!==stage.execution.identity[key])||!Array.isArray(output.notRun)||
   !Array.isArray(output.checks)||stage.checks.some(check=>!output.checks.some(value=>value.command===check.command&&value.exitCode===0)))fail('EXECUTION_REPORT_DENIED');
  stage.fixedChecksAfter=executeChecks(stage.checks,fixture.cwd);verifyProtected(stage,fixture.cwd);stage.status='PASS';stage.budgetAfter=budget(plan.rootTaskId);stage.callsSpent=stage.budgetAfter.length;save();return stage;
 }catch(error){if(stage){stage.status=fixture.getRegistry().lease||fs.existsSync(ROOT+'/call.lock')?'RECONCILIATION_REQUIRED':'FAILED';stage.errorCode=codeOf(error);writePrivate(STATE,stage);}throw error;}
 finally{meter.close();if(!fixture.getRegistry().lease&&!fs.existsSync(ROOT+'/call.lock'))await fixture.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==6||process.argv[2]!=='--input'||process.argv[4]!=='--cases')fail('ARGUMENT_DENIED');const result=await runChiefRuntimeRoutingAcceptance(process.argv[3],{casesFile:process.argv[5]});
  console.log(JSON.stringify({status:result.status,rootTaskId:result.rootTaskId,chiefRunId:result.chief.runId,executionRunId:result.execution.runId,owner:result.execution.role,callsSpent:result.callsSpent,outbox:result.outbox,production:result.production}));}
 catch(error){console.error(JSON.stringify({status:'NOT_RUN_OR_RECONCILIATION_REQUIRED',errorCode:codeOf(error)}));process.exitCode=1;}
}
