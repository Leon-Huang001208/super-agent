/** Explicit, one-role-at-a-time acceptance. Paperclip remains the task/run authority.
 * Container operator: --init --apply; --role research --preview; --role research --apply.
 * Default/status/preview never provision, reserve, wake, release or update configuration.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AdmissionMeter} from '../bridge/admission.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {readControl,writeControl,editRoleRegistry} from '../bridge/role-control-store.mjs';

const ROOT='/paperclip/control/research-pm',PKG='/opt/paperclip/node_modules';
const DIRECTORY=ROOT+'/native-skills-acceptance',RECEIPT=DIRECTORY+'/receipt.json';
const ACTIVE=['running','queued','scheduled_retry'],TERMINAL=['succeeded','failed','cancelled','timed_out'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const exists=file=>fs.existsSync(file);
function privateDirectory(directory){
 if(!exists(directory))fs.mkdirSync(directory,{mode:0o700});
 const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077))fail('NATIVE_ACCEPTANCE_DIRECTORY_DENIED');
}
export const ACCEPTANCE_ROLES=Object.freeze(['research','pm','frontend-engineer','qa','network-engineer','system-resource-engineer']);

export function acceptanceOptions(args){
 const known=new Set(['--apply','--status','--preview','--init','--reconcile','--role']);
 for(let i=0;i<args.length;i++){if(!known.has(args[i]))fail('NATIVE_ACCEPTANCE_ARGUMENT_DENIED');if(args[i]==='--role'){if(!ACCEPTANCE_ROLES.includes(args[++i]))fail('NATIVE_ACCEPTANCE_ROLE_DENIED');}}
 const role=args.includes('--role')?args[args.indexOf('--role')+1]:null;
 const action=args.includes('--init')?'init':args.includes('--reconcile')?'reconcile':role?'role':'status';
 if((args.includes('--init')&&args.includes('--reconcile'))||role&&action!=='role'||args.filter(x=>x==='--role').length>1)fail('NATIVE_ACCEPTANCE_ARGUMENT_DENIED');
 return {action,role,apply:args.includes('--apply')&&!args.includes('--preview')&&!args.includes('--status')};
}

export function createAcceptanceReceipt(registry,{uuid=randomUUID}={}){
 const projectId=registry.team?.projectId??registry.projectId;
 if(registry.enabled!==true||registry.team?.enabled!==false||!projectId)fail('NATIVE_ACCEPTANCE_REGISTRY_NOT_READY');
 const rootTaskId=uuid(),artifactDirectory='native-skills-'+rootTaskId;
 const steps=ACCEPTANCE_ROLES.map((role,index)=>{
  const entry=registry.agents?.find(value=>value.profile?.role===role),agentId=registry.team?.ids?.[role];
  if(!entry||!agentId||entry.profile.agentId!==agentId||entry.profile.projectId!==projectId||entry.profile.executionPolicy?.executor!=='macos_native')fail('NATIVE_ACCEPTANCE_AGENT_NOT_READY');
  const names=role==='frontend-engineer'?['index.html','app.js']:role==='qa'?['qa.json']:role==='network-engineer'?['network.json']:role==='system-resource-engineer'?['resources.json']:[role+'.md'];
  return {role,index,agentId,taskId:uuid(),operationId:uuid(),files:names.map(name=>artifactDirectory+'/'+name),status:'NOT_RUN'};
 });
 return {schemaVersion:1,kind:'native-skills-acceptance',companyId:registry.companyId,ownerId:registry.ownerId,projectId,rootTaskId,artifactDirectory,
  originalTaskId:registry.taskId,originalTeamEnabled:registry.team.enabled,maximumCalls:6,steps,createdAt:new Date().toISOString(),initialized:false};
}

export function assertReceiptRegistry(registry,receipt){
 if(receipt?.kind!=='native-skills-acceptance'||receipt.schemaVersion!==1||receipt.maximumCalls!==6||receipt.companyId!==registry.companyId||receipt.ownerId!==registry.ownerId||receipt.projectId!==(registry.team?.projectId??registry.projectId)||receipt.originalTaskId!==registry.taskId||registry.team?.enabled!==false||receipt.steps?.length!==6)fail('NATIVE_ACCEPTANCE_RECEIPT_CHANGED');
 for(const [index,step]of receipt.steps.entries())if(step.role!==ACCEPTANCE_ROLES[index]||step.agentId!==registry.team.ids[step.role])fail('NATIVE_ACCEPTANCE_AGENT_CHANGED');
}

export function assertAcceptanceStep({receipt,role,budgetCount,activeRuns=[],callLock=false,admissionLeases=[]}){
 if(activeRuns.length||callLock||admissionLeases.length)fail('NATIVE_ACCEPTANCE_BUSY');
 const step=receipt.steps.find(value=>value.role===role);
 if(!receipt.initialized||!step||step.status!=='NOT_RUN'||step.wakeAttemptedAt||step.runId)fail('NATIVE_ACCEPTANCE_ALREADY_ATTEMPTED');
 if(budgetCount>=6)fail('NATIVE_ACCEPTANCE_BUDGET_EXHAUSTED');
 if(receipt.steps.slice(0,step.index).some(value=>value.status!=='succeeded'||!value.artifacts?.length))fail('NATIVE_ACCEPTANCE_PREDECESSOR_INCOMPLETE');
 return step;
}

export function appendAcceptanceOperation(registry,receipt,operation,lease){
 assertReceiptRegistry(registry,receipt);
 if(registry.operations.some(value=>value.id===operation.id))fail('NATIVE_ACCEPTANCE_OPERATION_ALREADY_EXISTS');
 const next=structuredClone(registry);
 next.tasks=[...new Set([...next.tasks,receipt.rootTaskId,...receipt.steps.map(step=>step.taskId)])];
 next.taskRoots={...next.taskRoots,[receipt.rootTaskId]:receipt.rootTaskId};
 for(const step of receipt.steps)next.taskRoots[step.taskId]=receipt.rootTaskId;
 next.operations.push(operation);next.lease={taskId:operation.taskId,projectId:receipt.projectId,nonce:lease.nonce,operationId:operation.id};
 return next;
}

function description(receipt,step){
 const base='本任务是 Mac 原生 Skill 验收，使用当前真实个人订阅和岗位已分配 Skill。只写当前 Native 工作目录中的 '+receipt.artifactDirectory+' 子目录；不得修改项目代码、旧验收资料、凭据、配置或其他任务，不发外部通知，不部署。读取实际可用且匹配任务的 Skill，并在产物列明读取入口、实际工具结果、事实/假设和 NOT_RUN。';
 const goals={
  research:'使用至少两个公开官方原始来源，比较 Agent Skills 的职责分配、完整包依赖与来源固定，写带原始链接的简短中文来源简报。',
  pm:'读取已提供的真实 Research 产物，形成简短需求和可观察验收；引用上游来源，不把推断或客户访谈写成事实。',
  'frontend-engineer':'创建独立最小 HTML/JS 产物：一个中文计数器页面，初值0，点击增加和重置按钮更新计数。index.html 引用同目录 app.js，标签和键盘操作可用，无网络和新依赖。',
  qa:'独立读取给定精确 HTML/JS 产物，先核对哈希再验证计数、重置、脚本引用与可访问性。若真实浏览器不可用明确 NOT_RUN，不编造浏览器通过。按既有 QA 合同输出 JSON，reviewedArtifacts 必须与可信绑定一致。',
  'network-engineer':'仅执行真实 Mac 宿主只读检查：uname、路由、DNS、网关或 host.network_observe；不修改网络。输出 JSON {hostPlatform:"darwin",evidence:[{command或tool,observedAt,result}],notRun:[]}；容器结果不得充当 Mac 结果，结果不得含凭据。',
  'system-resource-engineer':'仅执行真实 Mac 宿主只读检查：卷身份和容量、memory/swap/CPU或 host.resources_observe；不清理、不卸载、不重启。输出 JSON {hostPlatform:"darwin",evidence:[{command或tool,observedAt,result}],notRun:[]}，区分实际观测和未执行项目，不记录秘密。'
 };
 return base+'\n'+goals[step.role]+'\n必须创建并写入：'+step.files.join('、')+'。';
}

function readArtifact(file,{notBefore=0,expectedHash}={}){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==path.resolve(file)||stat.nlink!==1||stat.size>131072||stat.mtimeMs<notBefore-2000)fail('NATIVE_ACCEPTANCE_ARTIFACT_DENIED');
 const bytes=fs.readFileSync(file),digest=sha(bytes);if(expectedHash&&digest!==expectedHash)fail('NATIVE_ACCEPTANCE_ARTIFACT_CHANGED');
 return {sha256:digest,bytes:bytes.length,text:bytes.toString('utf8')};
}
function budgetCount(rootTaskId){const dir=ROOT+'/budget/'+rootTaskId;return exists(dir)?fs.readdirSync(dir).length:0;}
function admissionLeases(){const filename='/paperclip/control/admission.sqlite';if(!exists(filename))fail('NATIVE_ACCEPTANCE_ADMISSION_MISSING');const db=new DatabaseSync(filename,{readOnly:true});try{return db.prepare('SELECT task_id FROM admission_lease').all();}finally{db.close();}}
const log=event=>fs.appendFileSync(ROOT+'/operator.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});

async function main(args){
 const options=acceptanceOptions(args);
 if(process.platform!=='linux'||process.getuid()!==0)fail('NATIVE_ACCEPTANCE_APPLICATION_CONTAINER_REQUIRED');
 const registry=()=>readControl(ROOT+'/registry.json');
 const r=registry();
 let receipt=exists(RECEIPT)?readControl(RECEIPT):null;
 if(receipt)assertReceiptRegistry(r,receipt);
 const password=fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim();
 const url='postgres://paperclip:'+encodeURIComponent(password)+'@db:5432/paperclip';process.env.DATABASE_URL=url;
 const s=await import(PKG+'/@paperclipai/db/dist/index.js'),o=await import(PKG+'/drizzle-orm/index.js');
 const config=await import(PKG+'/@paperclipai/server/dist/config.js');process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE=config.loadConfig().secretsMasterKeyFilePath;
 const db=s.createDb(url,{maxConnections:2,applicationName:'native-skills-acceptance'});let meter;
 const active=()=>db.select({id:s.heartbeatRuns.id,status:s.heartbeatRuns.status}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,ACTIVE));
 const getRun=async id=>(await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,id)))[0];
 const issues=(await import(PKG+'/@paperclipai/server/dist/services/issues.js')).issueService(db);
 const save=()=>writeControl(RECEIPT,receipt);
 async function runsFor(step){return db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.issueId,step.taskId));}
 async function status(){
  const runs=receipt?(await Promise.all(receipt.steps.map(runsFor))).flat():[];
  return {status:receipt?'INITIALIZED':'NOT_INITIALIZED',rootTaskId:receipt?.rootTaskId,projectId:receipt?.projectId??r.team?.projectId,
   calls:receipt?budgetCount(receipt.rootTaskId):0,maximumCalls:6,activeRuns:await active(),callLock:exists(ROOT+'/call.lock'),admissionLeases:admissionLeases(),
   steps:receipt?.steps.map(step=>({role:step.role,taskId:step.taskId,operationId:step.operationId,status:step.status,runId:step.runId,artifacts:step.artifacts,nativeProof:step.nativeProof,
    runs:runs.filter(run=>run.issueId===step.taskId).map(run=>({id:run.id,status:run.status,errorCode:run.errorCode,retryOfRunId:run.retryOfRunId??null,sessionId:run.nativeSessionId??run.sessionIdAfter??run.sessionId??null}))}))??ACCEPTANCE_ROLES.map(role=>({role,status:'NOT_RUN'})),
   businessAcceptance:'NOT_RUN',note:'Artifact and run evidence require scoped review; this command does not certify all Agent business capabilities.'};
 }
 async function reconcile(step){
  const runs=await runsFor(step);
  if(runs.length!==1||step.runId&&step.runId!==runs[0].id)fail('NATIVE_ACCEPTANCE_RUN_RECONCILIATION_REQUIRED');
  const run=runs[0];step.runId=run.id;
  if(!TERMINAL.includes(run.status)||!run.finishedAt)fail('NATIVE_ACCEPTANCE_RESULT_UNKNOWN');
  if(run.companyId!==receipt.companyId||run.agentId!==step.agentId||run.issueId!==step.taskId||run.retryOfRunId)fail('NATIVE_ACCEPTANCE_RUN_CHANGED');
  const lock=ROOT+'/call.lock';if((await active()).length||exists(lock))fail('NATIVE_ACCEPTANCE_TERMINAL_LOCK_REQUIRES_RECONCILIATION');
  const transport=ROOT+'/transport/'+run.id+'/result.json',bound=ROOT+'/operations/'+step.operationId+'.json';
  const bootstrap=run.resultJson?.executionRecovery?.providerWorkStarted===false;
  if(exists(bound)&&readControl(bound).runId!==run.id)fail('NATIVE_ACCEPTANCE_OPERATION_BINDING_CHANGED');
  if(!bootstrap){
   if(!exists(transport))fail('NATIVE_ACCEPTANCE_TRANSPORT_RESULT_MISSING');const result=readControl(transport);
   if(result.runId!==run.id||result.signal!==null||result.outputUnknown||!Number.isInteger(result.exitCode))fail('NATIVE_ACCEPTANCE_TRANSPORT_RESULT_UNKNOWN');
   for(const name of ['stdout','stderr'])if(sha(fs.readFileSync(ROOT+'/transport/'+run.id+'/'+name))!==result[name+'Sha256'])fail('NATIVE_ACCEPTANCE_TRANSPORT_CHANGED');
  }
  step.status=run.status;step.nativeStatus=run.status;step.finishedAt=new Date(run.finishedAt).toISOString();
  if(run.status==='succeeded'){
   const permit=readControl(ROOT+'/permits/'+run.id+'.json');
   if(permit.taskId!==step.taskId||permit.rootTaskId!==receipt.rootTaskId||permit.executionPolicy?.executor!=='macos_native'||permit.companyId!==receipt.companyId||permit.agentId!==step.agentId)fail('NATIVE_ACCEPTANCE_PERMIT_CHANGED');
   const proof=readControl(ROOT+'/transport/'+run.id+'/native-proof.json');
   if(proof.runId!==run.id||proof.executor!=='macos_native'||proof.platform!=='darwin'||proof.executionPolicy?.executor!=='macos_native')fail('NATIVE_ACCEPTANCE_NATIVE_PROOF_MISSING');
   step.nativeProof={executor:proof.executor,platform:proof.platform,codexPath:proof.codexPath,skillManifestSha256:proof.skillManifestSha256,sha256:sha(fs.readFileSync(ROOT+'/transport/'+run.id+'/native-proof.json'))};
   try{step.artifacts=step.files.map(file=>({taskId:step.taskId,runId:run.id,file,...(({sha256,bytes})=>({sha256,bytes}))(readArtifact(path.join(permit.cwd,file),{notBefore:Date.parse(run.startedAt)}))}));}
   catch(error){step.status='NEEDS_WORK';step.artifactError=error.code??'NATIVE_ACCEPTANCE_ARTIFACT_MISSING';}
  }
  save();
  if(step.lease&&!step.leaseReleased){
   meter??=new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[receipt.projectId],log});
   if(meter.verifyLease(step.lease).allowed!==true)fail('NATIVE_ACCEPTANCE_LEASE_CHANGED');
   meter.release({...step.lease,terminalEvidence:true});step.leaseReleased=true;save();
   editRoleRegistry(current=>{assertReceiptRegistry(current,receipt);if(current.lease?.operationId!==step.operationId||current.lease.nonce!==step.lease.nonce)fail('NATIVE_ACCEPTANCE_REGISTRY_LEASE_CHANGED');if(step.previousLeasePresent)current.lease=step.previousLease;else delete current.lease;return current;});
  }
  log({code:'NATIVE_ACCEPTANCE_ROLE_SETTLED',rootTaskId:receipt.rootTaskId,taskId:step.taskId,operationId:step.operationId,runId:run.id,status:step.status});
  return {role:step.role,runId:run.id,status:step.status,calls:budgetCount(receipt.rootTaskId),leaseReleased:step.leaseReleased===true};
 }
 try{
  if(!options.apply){console.log(JSON.stringify({...await status(),preview:options.action,role:options.role??undefined}));return;}
  if(options.action==='status')fail('NATIVE_ACCEPTANCE_EXPLICIT_ACTION_REQUIRED');
  if(options.action==='init'){
   if((await active()).length||exists(ROOT+'/call.lock')||admissionLeases().length)fail('NATIVE_ACCEPTANCE_BUSY');
   if(!receipt){receipt=createAcceptanceReceipt(r);privateDirectory(DIRECTORY);save();}
   if(receipt.initialized){console.log(JSON.stringify(await status()));return;}
   const rootDescription='最多6次个人订阅的本轮Mac原生验收：Research→PM、Frontend→独立QA、Network和System Resource。只产出独立验收资料；保留既有任务、Agent、预算和通知配置。';
   const rootTask=await issues.getById(receipt.rootTaskId)??await issues.create(receipt.companyId,{id:receipt.rootTaskId,projectId:receipt.projectId,title:'Mac native skills acceptance 2026-11-20',description:rootDescription,status:'in_review',priority:'medium',assigneeUserId:receipt.ownerId,assigneeAgentId:null,responsibleUserId:receipt.ownerId,createdByUserId:receipt.ownerId,actorResponsibleUserId:receipt.ownerId,trustExplicitResponsibleUserId:true,idempotencyKey:'native-skills:'+receipt.rootTaskId,allowDuplicate:false});
   if(rootTask.companyId!==receipt.companyId||rootTask.projectId!==receipt.projectId||rootTask.responsibleUserId!==receipt.ownerId||rootTask.description!==rootDescription||rootTask.parentId||rootTask.assigneeAgentId||rootTask.assigneeUserId!==receipt.ownerId)fail('NATIVE_ACCEPTANCE_ROOT_CHANGED');
   receipt.rootInputRevision=taskInputRevision(rootTask);
   for(const step of receipt.steps){const body=description(receipt,step);const task=await issues.getById(step.taskId)??await issues.create(receipt.companyId,{id:step.taskId,projectId:receipt.projectId,parentId:receipt.rootTaskId,title:'Native Skill acceptance — '+step.role,description:body,status:'todo',priority:'medium',assigneeUserId:receipt.ownerId,assigneeAgentId:null,responsibleUserId:receipt.ownerId,createdByUserId:receipt.ownerId,actorResponsibleUserId:receipt.ownerId,trustExplicitResponsibleUserId:true,idempotencyKey:'native-skills:'+step.taskId,allowDuplicate:false});if(task.parentId!==receipt.rootTaskId||task.description!==body||task.projectId!==receipt.projectId||task.companyId!==receipt.companyId||task.responsibleUserId!==receipt.ownerId)fail('NATIVE_ACCEPTANCE_CHILD_CHANGED');step.inputRevision=taskInputRevision(task);}
   editRoleRegistry(current=>{assertReceiptRegistry(current,receipt);current.tasks=[...new Set([...current.tasks,receipt.rootTaskId,...receipt.steps.map(step=>step.taskId)])];current.taskRoots??={};for(const id of [receipt.rootTaskId,...receipt.steps.map(step=>step.taskId)]){if(current.taskRoots[id]&&current.taskRoots[id]!==receipt.rootTaskId)fail('NATIVE_ACCEPTANCE_ROOT_MAPPING_CHANGED');current.taskRoots[id]=receipt.rootTaskId;}return current;});
   privateDirectory(ROOT+'/budget/'+receipt.rootTaskId);receipt.initialized=true;save();log({code:'NATIVE_ACCEPTANCE_INITIALIZED',rootTaskId:receipt.rootTaskId,projectId:receipt.projectId});console.log(JSON.stringify(await status()));return;
  }
  if(!receipt?.initialized)fail('NATIVE_ACCEPTANCE_INIT_REQUIRED');
  if(options.action==='reconcile'){const step=receipt.steps.find(value=>value.wakeAttemptedAt&&!value.leaseReleased);if(!step)fail('NATIVE_ACCEPTANCE_NO_PENDING_ATTEMPT');console.log(JSON.stringify(await reconcile(step)));return;}
  const step=assertAcceptanceStep({receipt,role:options.role,budgetCount:budgetCount(receipt.rootTaskId),activeRuns:await active(),callLock:exists(ROOT+'/call.lock'),admissionLeases:admissionLeases()});
  const rootTask=await issues.getById(receipt.rootTaskId),child=await issues.getById(step.taskId);
  if(!rootTask||rootTask.status!=='in_review'||rootTask.assigneeUserId!==receipt.ownerId||rootTask.assigneeAgentId||taskInputRevision(rootTask)!==receipt.rootInputRevision||!child||child.parentId!==rootTask.id||taskInputRevision(child)!==step.inputRevision||child.projectId!==receipt.projectId||child.responsibleUserId!==receipt.ownerId)fail('NATIVE_ACCEPTANCE_TASK_CHANGED');
  if((await runsFor(step)).length)fail('NATIVE_ACCEPTANCE_ALREADY_ATTEMPTED');
  let additionalInput='本次只执行已分配的单个角色验收，不创建或唤醒其他任务。'+description(receipt,step);let reviewedArtifacts;
  const predecessor=step.role==='pm'?receipt.steps[0]:step.role==='qa'?receipt.steps[2]:null;
  if(predecessor){const sourcePermit=readControl(ROOT+'/permits/'+predecessor.runId+'.json');reviewedArtifacts=predecessor.artifacts.map(ref=>{const artifact=readArtifact(path.join(sourcePermit.cwd,ref.file),{expectedHash:ref.sha256});additionalInput+='\n实际已完成上游产物 '+JSON.stringify(ref)+'\n'+artifact.text;return {taskId:ref.taskId,runId:ref.runId,file:ref.file,sha256:ref.sha256};});}
  const operation={id:step.operationId,kind:'run',taskId:step.taskId,projectId:receipt.projectId,agentId:step.agentId,role:step.role,rootTaskId:receipt.rootTaskId,rootInputRevision:receipt.rootInputRevision,inputRevision:step.inputRevision,phase:'work',additionalInput,
   ...(step.role==='qa'?{reviewedArtifacts}:{}),...(step.role==='network-engineer'?{networkScope:{topics:['gateway','routing','dns','connectivity'],actions:['observe','report']}}:{}),...(step.role==='system-resource-engineer'?{resourceScope:{topics:['volumes','capacity','memory','swap','cpu'],actions:['observe','report']}}:{})};
  const current=registry();assertReceiptRegistry(current,receipt);step.previousLeasePresent=Object.hasOwn(current,'lease');if(step.previousLeasePresent)step.previousLease=structuredClone(current.lease);
  meter=new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[receipt.projectId],log});
  const lease=meter.reserveTask({taskId:step.taskId,projectId:receipt.projectId,storageReceipt:readControl('/host-evidence/host-storage.json')});if(!lease.allowed)fail('NATIVE_ACCEPTANCE_ADMISSION_DENIED');
  step.lease={taskId:step.taskId,projectId:receipt.projectId,nonce:lease.nonce};step.status='RESERVED';save();
  if((await active()).length||exists(ROOT+'/call.lock'))fail('NATIVE_ACCEPTANCE_BUSY_AFTER_RESERVATION');
  editRoleRegistry(value=>appendAcceptanceOperation(value,receipt,operation,lease));
  await issues.update(step.taskId,{assigneeAgentId:step.agentId,assigneeUserId:null,status:'todo'});
  step.wakeAttemptedAt=new Date().toISOString();step.status='WAKE_PENDING';save();
  const {heartbeatService}=await import(PKG+'/@paperclipai/server/dist/services/heartbeat.js');
  const result=await heartbeatService(db).wakeup(step.agentId,{manualUserWake:true,source:'on_demand',triggerDetail:'manual',requestedByActorType:'user',requestedByActorId:receipt.ownerId,reason:'native_skills_acceptance',idempotencyKey:'native-skills:'+step.operationId,payload:{issueId:step.taskId},contextSnapshot:{issueId:step.taskId,taskId:step.taskId,projectId:receipt.projectId,responsibleUserId:receipt.ownerId,inputRevision:step.inputRevision,roleOperationId:step.operationId,taskGoal:child.description,conversationMode:false,forceFreshSession:true}});
  if(!result?.id)fail('NATIVE_ACCEPTANCE_WAKE_RESULT_UNKNOWN');step.runId=result.id;step.status=result.status??'queued';save();console.log(JSON.stringify({role:step.role,operationId:step.operationId,runId:step.runId,status:step.status}));
  const until=Date.now()+720000;
  while(Date.now()<until){const run=await getRun(step.runId);if(!run)fail('NATIVE_ACCEPTANCE_RUN_MISSING');if(TERMINAL.includes(run.status)){console.log(JSON.stringify(await reconcile(step)));return;}if(run.status==='scheduled_retry')fail('NATIVE_ACCEPTANCE_NATIVE_RETRY_REQUIRES_RECONCILIATION');await new Promise(resolve=>setTimeout(resolve,1000));}
  fail('NATIVE_ACCEPTANCE_RESULT_UNKNOWN');
 }finally{meter?.close();await s.closeRegisteredClients(url);}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({code:/^NATIVE_ACCEPTANCE_[A-Z_]+$/.test(error.code??'')?error.code:'NATIVE_ACCEPTANCE_FAILED',errorType:error.name}));process.exitCode=1;});
