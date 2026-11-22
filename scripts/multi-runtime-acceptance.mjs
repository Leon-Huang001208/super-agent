/** Operator-only real Native acceptance. Production configuration and message delivery are outside this runner. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {AdmissionMeter} from '../bridge/admission.mjs';
import {TEAM_ROLES} from '../bridge/team-roles.mjs';
import {DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {ACCEPTANCE_ROOT as ROOT,privateJson,writePrivate,createMultiRuntimeNativeFixture,knownBootstrapClosure,archivePrivateSnapshot} from '../tests/helpers/multi-runtime-native-fixture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
export const CSV_IMPLEMENTATION='export function parseCsv(text) { return text.split("\\n").map(row => row.split(",")); }\n';
export const CSV_TESTS=`import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv} from './csv.mjs';
test('empty input',()=>assert.deepEqual(parseCsv(''),[]));
test('plain records',()=>assert.deepEqual(parseCsv('a,b\\n1,2'),[['a','b'],['1','2']]));
test('quoted comma',()=>assert.deepEqual(parseCsv('"a,b",c'),[['a,b','c']]));
test('Unicode',()=>assert.deepEqual(parseCsv('姓名,城市\\n小米,北京'),[['姓名','城市'],['小米','北京']]));
test('escaped quotes and CRLF',()=>assert.deepEqual(parseCsv('"a""b",c\\r\\n1,2\\r\\n'),[['a"b','c'],['1','2']]));
`;
const EVIDENCE='# Fixed acceptance evidence\n\nSource: local immutable CSV test suite, authored for this isolated run.\nRequirement: empty input returns []; preserve quoted commas, escaped quotes, CRLF and Unicode.\nCustomer interviews, production deployment, UI and automatic scheduling have not run.\n';
const goals={
 'backend-engineer':'读取当前目录csv.mjs和固定csv.test.mjs，只修改csv.mjs实现CSV解析，执行 node --test csv.test.mjs 并确认5个测试。不要修改测试。写backend-result.json记录实际命令/退出码及范围。仅本隔离目录，不改系统、凭据、业务仓库或外部服务。',
 research:'读取当前目录evidence.md与固定csv.test.mjs及backend-result.json。通过本run实际MCP工具调用host.project_inspect（可能带命名空间前缀，参数{}）；它只读取当前隔离项目metadata，workspace NOT_CONFIGURED是合法结果。写research.md，列来源、事实/假设、实际工具结果及NOT_RUN。不要联网或修改其他文件。',
 pm:'读取当前目录research.md与固定evidence.md，将研究转成简短可观察验收文档acceptance.md；必须覆盖5个CSV用例，区分实际结果、假设和NOT_RUN。不要伪造客户访谈或UI、自动派发、部署结果，不修改其他文件。',
 qa:'独立核对可信reviewedArtifacts中每个实际文件的SHA256，读取csv.mjs、固定csv.test.mjs及上游报告，核验Research来源与事实/假设及真实host工具回执，PM文档覆盖5个可观察CSV验收。独立执行 node --test csv.test.mjs，5个测试须通过。不得修改被审文件。按真实QA合同输出qa.json，reviewedArtifacts精确复用可信绑定，findings/notRun数组；自动调度、outbox、CloudApps、UI、Managed CAS、生产部署均NOT_RUN。',
};
const handoffGoal='这是同一Backend任务中的明确交接，新的Codex会话不能依赖MiniMax CLI记忆。先读可信handoff材料及其versionedhandoff目录，核验旧csv.mjs、报告及固定测试摘要；保留全部旧快照和累计调用预算。对当前csv.mjs作更严格的边界/错误处理审查，实际运行固定5测试并按需要用临时命令检查其他CSV边界，风险或未执行项如实记录。必要时仅修csv.mjs，不改固定测试；写新的backend-review.json记录独立命令/结果、前后SHA、处理原因和NOT_RUN。';

export function createIsolatedAcceptance(){
 const agentIds=Object.fromEntries(Object.keys(TEAM_ROLES).map(role=>[role,randomUUID()]));
 const backendTaskId=randomUUID(),routineOperationId=randomUUID();
 const cases=[['backend-routine','backend-engineer','minimax_opencode','backend-result.json',goals['backend-engineer']],
  ['backend-handoff','backend-engineer','codex_subscription','backend-review.json',handoffGoal],
  ['research','research','deepseek_opencode','research.md',goals.research],['pm','pm','codex_subscription','acceptance.md',goals.pm],['qa','qa','codex_subscription','qa.json',goals.qa]];
 return{schemaVersion:1,kind:'isolated-native-multi-runtime',companyId:randomUUID(),projectId:randomUUID(),workspaceId:randomUUID(),rootTaskId:randomUUID(),agentIds,
  runtimeAssignments:{...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS},maximumCalls:20,maximumResponsesPerRun:64,
  automaticDispatch:'NOT_RUN',outbox:'NOT_RUN',cloudApps:'NOT_RUN',userInterface:'NOT_RUN',managedInstructionCAS:'NOT_RUN',contextVersion1:'NOT_RUN',productionDeployment:'NOT_RUN',
  steps:cases.map(([key,role,runtimeProfileId,outputFile,goal],index)=>({key,role,runtimeProfileId,agentId:agentIds[role],taskId:role==='backend-engineer'?backendTaskId:randomUUID(),
   operationId:index===0?routineOperationId:randomUUID(),selection:{complexity:index===1?'complex':'routine',risk:index===1?'high':'low',purpose:role==='research'?'research':'execution'},
   ...(index===1?{handoffFromOperationId:routineOperationId}:{}),goal,outputFile,status:'NOT_RUN'}))};
}
export function rehydrateAcceptancePlan(saved){
 const expected=[['backend-routine','backend-engineer','minimax_opencode','backend-result.json'],['backend-handoff','backend-engineer','codex_subscription','backend-review.json'],
  ['research','research','deepseek_opencode','research.md'],['pm','pm','codex_subscription','acceptance.md'],['qa','qa','codex_subscription','qa.json']];
 const roles=Object.keys(saved?.agentIds??{}),known=Object.keys(TEAM_ROLES),legacy=known.filter(role=>role!=='full-stack-engineer');
 if(saved?.kind!=='isolated-native-multi-runtime'||saved.maximumCalls!==20||saved.maximumResponsesPerRun!==64||saved.steps?.length!==5||![known,legacy].some(keys=>keys.length===roles.length&&keys.every(role=>roles.includes(role)))||
  saved.steps.some((step,index)=>[step.key,step.role,step.runtimeProfileId,step.outputFile].some((value,column)=>value!==expected[index][column])||step.agentId!==saved.agentIds[step.role])||
  saved.steps[0].taskId!==saved.steps[1].taskId)fail('MULTI_RUNTIME_RESUME_PLAN_CHANGED');
 return{...structuredClone(saved),steps:saved.steps.map(step=>({...structuredClone(step),goal:step.key==='backend-handoff'?handoffGoal:goals[step.role]}))};
}
export function prepareKnownBootstrapRepair(plan,evidence){
 const first=plan.steps[0];
 if(!evidence||evidence.operationId!==first.operationId||evidence.runId!==first.runId||!Array.isArray(evidence.budgetRecords)||evidence.budgetRecords.length<1||evidence.budgetRecords.length>=20||
  plan.steps.slice(1).some(step=>step.runId||step.status!=='NOT_RUN'))fail('MULTI_RUNTIME_BOOTSTRAP_REPAIR_DENIED');
 const result=structuredClone(plan),step=result.steps[0],{goal,priorAttempts:previousAttempts,...prior}=structuredClone(first);
 step.priorAttempts=[...(first.priorAttempts??[]),{...prior,bootstrapClosure:structuredClone(evidence)}];
 step.operationId=randomUUID();step.retryOfOperationId=first.operationId;step.status='NOT_RUN';step.resumeKnownBootstrap=true;
 for(const key of ['runId','nativeEvidence','taskRuntimeRoute','leaseReleased','bootstrapClosure','artifacts','fixedTests'])delete step[key];
 result.steps[1].handoffFromOperationId=step.operationId;result.status='RESUMING_KNOWN_BOOTSTRAP';delete result.errorCode;result.callsSpent=evidence.budgetRecords.length;return result;
}
/** Operator acceptance waits only for another legitimate global owner; no task/run/budget identity is replaced. */
export async function reserveAcceptanceTask({meter,taskId,projectId,readStorage},{timeoutMs=180000,clock=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>900000||typeof readStorage!=='function')fail('MULTI_RUNTIME_ADMISSION_WAIT_DENIED');
 const began=clock();let attempts=0;
 for(;;){
  const now=clock();if(!Number.isSafeInteger(now)||now<began)fail('MULTI_RUNTIME_ADMISSION_CLOCK_DENIED');
  if(attempts&&now-began>=timeoutMs)fail('MULTI_RUNTIME_ADMISSION_BUSY_TIMEOUT');
  try{attempts++;const lease=meter.reserveTask({taskId,projectId,storageReceipt:readStorage()});
   if(lease.allowed!==true)fail('MULTI_RUNTIME_ADMISSION_RECONCILIATION_REQUIRED');return lease;
  }catch(error){if(error.code!=='ADMISSION_BUSY')throw error;const left=timeoutMs-(clock()-began);if(left<=0)fail('MULTI_RUNTIME_ADMISSION_BUSY_TIMEOUT');await wait(Math.min(1000,left));}
 }
}

/** Freeze actual previous bytes and budget identities before a same-task runtime handoff. Never copy credentials or CLI state. */
export function snapshotAcceptanceHandoff({cwd,rootTaskId,from,to,artifacts,budget}){
 const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
 if(![rootTaskId,from?.taskId,from?.operationId,from?.runId,to?.operationId].every(value=>uuid.test(value??''))||from.taskId!==to.taskId||from.agentId!==to.agentId||from.status!=='PASS'||
  to.handoffFromOperationId!==from.operationId||from.runtimeProfileId===to.runtimeProfileId||!Array.isArray(artifacts)||!artifacts.length||!Array.isArray(budget)||budget.length<1||budget.length>=20)fail('MULTI_RUNTIME_HANDOFF_DENIED');
 const prefix='versionedhandoff/'+from.taskId+'/'+from.operationId+'-'+to.operationId;
 fs.mkdirSync(path.join(cwd,prefix),{recursive:true,mode:0o700});
 const copies=artifacts.map(ref=>{
  if(ref.taskId!==from.taskId||ref.runId!==from.runId||!/^[-a-zA-Z0-9_.]+$/.test(ref.file)||ref.file==='.'||ref.file==='..')fail('MULTI_RUNTIME_HANDOFF_DENIED');
  const bytes=fs.readFileSync(path.join(cwd,ref.file));if(sha(bytes)!==ref.sha256)fail('MULTI_RUNTIME_HANDOFF_ARTIFACT_CHANGED');
  const file=prefix+'/'+ref.file;fs.writeFileSync(path.join(cwd,file),bytes,{flag:'wx',mode:0o400});return{sourceFile:ref.file,file,sha256:ref.sha256,bytes:bytes.length};
 });
 if(budget.some(record=>!uuid.test(record.operationId??'')||!/^[a-f0-9]{64}$/.test(record.sha256??'')))fail('MULTI_RUNTIME_HANDOFF_DENIED');
 const receipt={schemaVersion:1,kind:'explicit-runtime-handoff',rootTaskId,taskId:from.taskId,agentId:from.agentId,
  fromOperationId:from.operationId,fromRunId:from.runId,toOperationId:to.operationId,fromRuntimeProfileId:from.runtimeProfileId,toRuntimeProfileId:to.runtimeProfileId,
  artifacts:copies,budget:{callsSpent:budget.length,records:structuredClone(budget)},receiptFile:prefix+'/handoff.json'};
 fs.writeFileSync(path.join(cwd,receipt.receiptFile),JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o400});return receipt;
}
export function verifyAcceptanceHandoff({cwd,receipt}){
 if(!receipt||receipt.kind!=='explicit-runtime-handoff'||!isDeepStrictEqual(privateJson(path.join(cwd,receipt.receiptFile)),receipt))fail('MULTI_RUNTIME_HANDOFF_CHANGED');
 for(const ref of receipt.artifacts)if(sha(fs.readFileSync(path.join(cwd,ref.file)))!==ref.sha256)fail('MULTI_RUNTIME_HANDOFF_ARTIFACT_CHANGED');
}
export function assertDelegatedAuth(auth,{now=Date.now()}={}){
 if(!auth||!Number.isSafeInteger(auth.expiresAt)||auth.expiresAt<=now||auth.expiresAt>now+1800000||
  !['access_token','id_token','account_id'].every(key=>typeof auth.tokens?.[key]==='string'&&auth.tokens[key].trim())||
  auth.tokens.refresh_token!=='ISOLATED_NO_REFRESH')fail('MULTI_RUNTIME_DELEGATED_AUTH_DENIED');
}
export function publicRunEvidence(run,profile){
 const usage={};for(const key of ['inputTokens','outputTokens','cachedInputTokens','cacheReadInputTokens','cacheCreationInputTokens','costUsd','totalCostUsd']){
  const value=run.usageJson?.[key];if(typeof value==='number'&&Number.isFinite(value))usage[key]=value;
 }
 return{taskId:run.issueId,agentId:run.agentId,runId:run.id,status:run.status,exitCode:run.exitCode??null,
  errorCode:typeof run.errorCode==='string'&&/^[A-Z0-9_]+$/.test(run.errorCode)?run.errorCode:null,
  provider:profile.provider,model:profile.model,runtime:profile.runtime,sessionId:run.nativeSessionId??run.sessionIdAfter??run.sessionId??null,
  startedAt:run.startedAt?new Date(run.startedAt).toISOString():null,finishedAt:run.finishedAt?new Date(run.finishedAt).toISOString():null,
  usage,unknownCost:true,costSource:Object.hasOwn(usage,'costUsd')||Object.hasOwn(usage,'totalCostUsd')?'runtime_reported_estimate':'not_reported',resultSha256:sha(JSON.stringify(run.resultJson??null))};
}
function artifact(cwd,file,step){
 const filename=path.join(cwd,file),stat=fs.lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>131072)fail('MULTI_RUNTIME_ARTIFACT_DENIED');
 return{taskId:step.taskId,runId:step.runId,file,sha256:sha(fs.readFileSync(filename))};
}
/** A hash-bound business artifact may be readable; it is not a credential input. */
export function readAcceptanceArtifactJson({cwd,reference}){
 if(typeof reference?.file!=='string'||reference.file.split('/').some(part=>!/^[-a-zA-Z0-9_.]+$/.test(part)||part==='.'||part==='..')||
  !/^[a-f0-9]{64}$/.test(reference.sha256??''))fail('MULTI_RUNTIME_ARTIFACT_DENIED');
 const filename=path.join(cwd,reference.file);let cursor=cwd;
 for(const part of reference.file.split('/')){cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink()||cursor!==filename&&!stat.isDirectory())fail('MULTI_RUNTIME_ARTIFACT_DENIED');}
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let bytes;
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.uid!==process.getuid()||stat.nlink!==1||stat.size>131072||(stat.mode&0o022))fail('MULTI_RUNTIME_ARTIFACT_DENIED');bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
 if(sha(bytes)!==reference.sha256)fail('MULTI_RUNTIME_REVIEWED_ARTIFACT_CHANGED');
 try{return JSON.parse(bytes);}catch{fail('MULTI_RUNTIME_ARTIFACT_JSON_DENIED');}
}
function assertTransportTerminal(run,executionEvents){
 if(!['succeeded','failed','cancelled','timed_out'].includes(run.status)||!run.finishedAt)fail('MULTI_RUNTIME_NATIVE_RESULT_UNKNOWN');
 if(run.resultJson?.executionRecovery?.providerWorkStarted===false)return knownBootstrapClosure(run,{claimExists:fs.existsSync(ROOT+'/claims/'+run.id+'.json'),
  transportExists:fs.existsSync(ROOT+'/transport/'+run.id),providerAuditExists:fs.existsSync(ROOT+'/transport/'+run.id+'/proxy-audit'),callLockExists:fs.existsSync(ROOT+'/call.lock')},{executionEvents});
 const directory=ROOT+'/transport/'+run.id,transport=privateJson(directory+'/result.json');
 if(transport.runId!==run.id||transport.signal!==null||transport.outputUnknown||!Number.isInteger(transport.exitCode)||transport.timedOut||transport.cancelled)fail('MULTI_RUNTIME_TRANSPORT_RESULT_UNKNOWN');
 for(const stream of ['stdout','stderr'])if(sha(fs.readFileSync(directory+'/'+stream))!==transport[stream+'Sha256'])fail('MULTI_RUNTIME_TRANSPORT_DIGEST_CHANGED');
 if(run.status==='succeeded'){
  const proof=privateJson(directory+'/native-proof.json');
  if(proof.runId!==run.id||proof.executor!=='macos_native'||proof.platform!=='darwin'||proof.executionPolicy?.executor!=='macos_native')fail('MULTI_RUNTIME_NATIVE_PROOF_REQUIRED');
 }
 if(fs.existsSync(ROOT+'/call.lock'))fail('MULTI_RUNTIME_CALL_SETTLEMENT_PENDING');
}
function assertHostInspect(runId){
 const root=ROOT+'/transport/'+runId+'/audit/host-calls';
 // The host call queue is under the per-run provider audit directory, never inferred from model prose.
 const alternatives=[ROOT+'/transport/'+runId+'/proxy-audit/host-calls',root];
 for(const directory of alternatives)if(fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(name=>/^[a-f0-9]{64}$/.test(name))){
  const request=privateJson(directory+'/'+name+'/request.json');if(request.runId!==runId||request.tool!=='host.project_inspect')continue;
  const result=privateJson(directory+'/'+name+'/result.json');
  if(result.requestHash===sha(JSON.stringify(request))&&result.runId===runId&&!result.error&&result.result?.project)return;
 }
 fail('MULTI_RUNTIME_HOST_INSPECT_EVIDENCE_MISSING');
}

export async function runMultiRuntimeAcceptance(inputFile,{afterAcceptance}={}){
 const {createTaskRuntimeRoute,projectTaskRuntimeRoute}=await import('../bridge/task-runtime-routing.mjs');
 const input=privateJson(inputFile);assertDelegatedAuth(input.codexAuth);
 const resume=process.env.SUPER_AGENT_RESUME_KNOWN_BOOTSTRAP==='1',receiptFile=ROOT+'/multi-runtime-acceptance.json';
 let plan=resume?rehydrateAcceptancePlan(privateJson(receiptFile)):createIsolatedAcceptance();
 const fixture=await createMultiRuntimeNativeFixture(plan,input,{resumeKnownBootstrap:resume});let r=fixture.registry;
 const save=()=>writePrivate(receiptFile,{...plan,steps:plan.steps.map(({goal,...step})=>step)});
 const events=event=>fs.appendFileSync(ROOT+'/operator.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
 const meter=new AdmissionMeter({filename:'/shared-admission/admission.sqlite',allowedProjectIds:[plan.projectId],log:events});
 let safeToClose=true;
 try{
  if(resume){
   const archived=ROOT+'/bootstrap-archives/'+fixture.bootstrapRecovery.runId;fs.mkdirSync(archived,{recursive:true,mode:0o700});
   for(const [label,file]of [['acceptance',receiptFile],['registry',ROOT+'/registry.json']])archivePrivateSnapshot(archived,label,fs.readFileSync(file));
   plan=prepareKnownBootstrapRepair(plan,fixture.bootstrapRecovery);
  }else for(const [name,text]of Object.entries({'csv.mjs':CSV_IMPLEMENTATION,'csv.test.mjs':CSV_TESTS,'evidence.md':EVIDENCE}))fs.writeFileSync(path.join(fixture.cwd,name),text,{flag:'wx',mode:0o600});
  if(sha(fs.readFileSync(fixture.cwd+'/csv.test.mjs'))!==sha(CSV_TESTS)||sha(fs.readFileSync(fixture.cwd+'/evidence.md'))!==sha(EVIDENCE))fail('MULTI_RUNTIME_FIXED_INPUT_CHANGED');
  save();
  for(const step of plan.steps){
   if(fs.existsSync(ROOT+'/call.lock'))fail('MULTI_RUNTIME_PREVIOUS_CALL_UNKNOWN');
   const profile=RUNTIME_PROFILES[step.runtimeProfileId],task=await fixture.issue(step.taskId);
   if(profile.runtime==='codex')assertDelegatedAuth(input.codexAuth);
   if(step.handoffFromOperationId){
    const from=plan.steps.find(prior=>prior.operationId===step.handoffFromOperationId);
    const budget=fs.readdirSync(ROOT+'/budget/'+plan.rootTaskId).sort().map(name=>({operationId:name.slice(0,-5),sha256:sha(fs.readFileSync(ROOT+'/budget/'+plan.rootTaskId+'/'+name))}));
    step.handoff=snapshotAcceptanceHandoff({cwd:fixture.cwd,rootTaskId:plan.rootTaskId,from,to:step,artifacts:from.artifacts,budget});
    from.artifacts=step.handoff.artifacts.map(ref=>({taskId:from.taskId,runId:from.runId,file:ref.file,sha256:ref.sha256}));save();
   }
   let handoff;
   if(step.handoff){
    const from=plan.steps.find(prior=>prior.operationId===step.handoffFromOperationId),dir=ROOT+'/transport/'+from.runId;
    handoff={previousRoute:from.taskRuntimeRoute,previousRun:await fixture.getRun(from.runId),transport:privateJson(dir+'/result.json'),
     executionClosed:['process-cleanup.json','broker-process-cleanup.json'].every(name=>privateJson(dir+'/'+name).status==='terminated'),
     budgetUsedBefore:step.handoff.budget.callsSpent,artifacts:step.handoff.artifacts.map(ref=>({file:ref.file,sha256:ref.sha256,runId:from.runId})),
     material:{file:step.handoff.receiptFile,sha256:sha(fs.readFileSync(path.join(fixture.cwd,step.handoff.receiptFile)))}};
   }
   const taskRuntimeRoute=createTaskRuntimeRoute({taskId:step.taskId,rootTaskId:plan.rootTaskId,agentId:step.agentId,role:step.role,
    operationId:step.operationId,inputRevision:taskInputRevision(task),selection:step.selection,...(handoff?{handoff}:{})});
   if(taskRuntimeRoute.profileId!==step.runtimeProfileId)fail('MULTI_RUNTIME_TASK_ROUTE_PROFILE_MISMATCH');
   step.taskRuntimeRoute=taskRuntimeRoute;
   const reviewedArtifacts=step.role==='qa'?plan.steps.slice(0,4).flatMap(prior=>prior.artifacts):undefined;
   const operation={id:step.operationId,kind:'run',taskId:step.taskId,agentId:step.agentId,role:step.role,projectId:plan.projectId,
    rootTaskId:plan.rootTaskId,rootInputRevision:plan.rootInputRevision,inputRevision:taskInputRevision(task),phase:'work',outputFile:step.outputFile,
    additionalInput:step.goal+(step.handoff?'\n本次明确handoff材料：'+JSON.stringify(step.handoff):''),
    taskRuntimeRoute,...(reviewedArtifacts?{reviewedArtifacts,reviewedTaskKeys:['backend-routine','backend-handoff','research','pm']}:{} )};
   r.operations.push(operation);r=projectTaskRuntimeRoute(r,taskRuntimeRoute);fixture.setRegistry(r);
   await fixture.configureRuntime(step,operation.taskRuntimeRoute);
   const lease=await reserveAcceptanceTask({meter,taskId:step.taskId,projectId:plan.projectId,readStorage:()=>privateJson('/host-evidence/host-storage.json')});
   if(!lease.allowed)fail('MULTI_RUNTIME_SHARED_ADMISSION_BUSY');
   safeToClose=false;step.status='RESERVED';save();
   r.lease={taskId:step.taskId,projectId:plan.projectId,nonce:lease.nonce,operationId:step.operationId};writePrivate(ROOT+'/registry.json',r);
   await fixture.assign(step);await fixture.heartbeat.resetRuntimeSession(step.agentId,{taskKey:step.taskId});step.status='WAKE_PENDING';save();
   const controlledExecution=await fixture.managedWake(step,taskRuntimeRoute);
   const run=await fixture.heartbeat.wakeup(step.agentId,{manualUserWake:true,source:'on_demand',triggerDetail:'manual',requestedByActorType:'user',requestedByActorId:fixture.ownerId,
    reason:'issue_commented',idempotencyKey:'isolated:'+step.operationId,payload:{issueId:step.taskId},
    contextSnapshot:{issueId:step.taskId,taskId:step.taskId,projectId:plan.projectId,responsibleUserId:fixture.ownerId,inputRevision:operation.inputRevision,
     roleOperationId:step.operationId,taskGoal:step.goal,forceFreshSession:true,conversationMode:false,superAgentControlledExecution:controlledExecution}});
   if(!run?.id)fail('MULTI_RUNTIME_WAKE_RESULT_UNKNOWN');step.runId=run.id;step.status='RUNNING';save();
   let current;const until=Date.now()+195000;
   while(Date.now()<until){current=await fixture.getRun(run.id);if(!['queued','running'].includes(current?.status))break;await new Promise(resolve=>setTimeout(resolve,500));}
   step.nativeEvidence=publicRunEvidence(current??run,profile);step.status=current?.status??'UNKNOWN';save();
   if(current?.resultJson?.executionRecovery?.providerWorkStarted===false)await fixture.heartbeat.drainActiveRunExecutions();
   const executionEvents=current?.resultJson?.executionRecovery?.providerWorkStarted===false?await fixture.db.select().from(fixture.schema.heartbeatRunEvents).where(fixture.orm.eq(fixture.schema.heartbeatRunEvents.runId,current.id)):undefined;
   const closure=assertTransportTerminal(current,executionEvents);if(closure)step.bootstrapClosure=closure;
   meter.release({taskId:step.taskId,nonce:lease.nonce,terminalEvidence:true});delete r.lease;writePrivate(ROOT+'/registry.json',r);safeToClose=true;step.leaseReleased=true;save();
   if(current.status!=='succeeded')fail(closure?.gateCode??'MULTI_RUNTIME_NATIVE_CASE_FAILED');
   if(step.handoff){const from=plan.steps.find(prior=>prior.operationId===step.handoffFromOperationId);if(from.nativeEvidence.sessionId&&from.nativeEvidence.sessionId===step.nativeEvidence.sessionId)fail('MULTI_RUNTIME_HANDOFF_SESSION_REUSED');}
   if(sha(fs.readFileSync(fixture.cwd+'/csv.test.mjs'))!==sha(CSV_TESTS)||sha(fs.readFileSync(fixture.cwd+'/evidence.md'))!==sha(EVIDENCE))fail('MULTI_RUNTIME_FIXED_INPUT_CHANGED');
   const files=step.role==='backend-engineer'?['csv.mjs',step.outputFile]:[step.outputFile];step.artifacts=files.map(file=>artifact(fixture.cwd,file,step));
   if(step.role==='backend-engineer'||step.role==='qa'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.PAPERCLIP_SECRETS_MASTER_KEY;
    const tests=spawnSync(process.execPath,['--test','--test-reporter=tap','csv.test.mjs'],{cwd:fixture.cwd,encoding:'utf8',env,timeout:10000,maxBuffer:1048576});
    step.fixedTests={exitCode:tests.status,count:5,stdoutSha256:sha(tests.stdout??''),stderrSha256:sha(tests.stderr??'')};
    if(tests.status!==0||!/# pass 5\b/.test(tests.stdout??''))fail('MULTI_RUNTIME_FIXED_TESTS_FAILED');
   }
   if(step.role==='research')assertHostInspect(step.runId);
   for(const prior of plan.steps)if(prior.handoff){verifyAcceptanceHandoff({cwd:fixture.cwd,receipt:prior.handoff});
    for(const record of prior.handoff.budget.records)if(sha(fs.readFileSync(ROOT+'/budget/'+plan.rootTaskId+'/'+record.operationId+'.json'))!==record.sha256)fail('MULTI_RUNTIME_HANDOFF_BUDGET_CHANGED');}
   if(step.role==='qa'){
    const qa=readAcceptanceArtifactJson({cwd:fixture.cwd,reference:step.artifacts.find(ref=>ref.file==='qa.json')});
    if(qa.verdict!=='PASS'||!Array.isArray(qa.findings)||qa.findings.length||!Array.isArray(qa.notRun)||!isDeepStrictEqual(qa.reviewedArtifacts,reviewedArtifacts))fail('MULTI_RUNTIME_QA_RESULT_DENIED');
    for(const ref of reviewedArtifacts)if(sha(fs.readFileSync(path.join(fixture.cwd,ref.file)))!==ref.sha256)fail('MULTI_RUNTIME_REVIEWED_ARTIFACT_CHANGED');
    step.verdict='PASS';
   }
   step.status='PASS';plan.callsSpent=fs.readdirSync(ROOT+'/budget/'+plan.rootTaskId).length;save();
  }
  plan.status='PASS';save();if(afterAcceptance)await afterAcceptance({plan,fixture,meter,reportFile:receiptFile});return{...plan,steps:plan.steps.map(({goal,...step})=>step)};
 }catch(error){plan.status='FAILED';plan.errorCode=/^[A-Z_]+$/.test(error.code??'')?error.code:'MULTI_RUNTIME_ACCEPTANCE_FAILED';save();throw Object.assign(Error(plan.errorCode),{code:plan.errorCode});}
 finally{meter.close();if(safeToClose)await fixture.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4||process.argv[2]!=='--input')fail('MULTI_RUNTIME_ARGUMENT_DENIED');const result=await runMultiRuntimeAcceptance(process.argv[3]);console.log(JSON.stringify(result));}
 catch(error){console.error(JSON.stringify({status:'FAILED',errorCode:error.code??'MULTI_RUNTIME_ACCEPTANCE_FAILED'}));process.exitCode=1;}
}
