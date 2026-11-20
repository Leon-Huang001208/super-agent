import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {taskInputRevision} from './task-input.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY,roleExecutionPolicy} from './role-execution-policy.mjs';
import {isInitialChiefPlan,isUnclaimedChiefGateFailure} from './chief-bootstrap-retry.mjs';
import {archiveNativeRetryFailure,clearArchivedRetryLock,NATIVE_RETRY_CONTEXT} from './role-native-retry.mjs';

const prefix='TEAM_NATIVE_RETRY_CHIEF_TRANSPORT_';
const fail=code=>{throw Object.assign(Error(prefix+code),{code:prefix+code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??'');
const ended=value=>Number.isFinite(Date.parse(value));
const message='workspace backend must use an HTTPS origin without credentials';
const artifactName='chief-https-no-response.json';

export const isChiefTransportPlanRetry=(op,parent)=>op?.kind==='run'&&op.role==='chief'&&op.phase==='plan'&&op.contextVersion===1&&
 op.taskId===op.rootTaskId&&op.rootInputRevision===undefined&&op.nativeRetryAttempt===1&&uuid(op.retryOfOperationId)&&uuid(parent?.id)&&
 op.acceptedRunId===parent?.id&&op.retryOfRunId===parent.retryOfRunId&&parent.scheduledRetryAttempt===1&&
 parent.status==='failed'&&parent.exitCode===1&&parent.errorCode==='adapter_failed'&&ended(parent.finishedAt);

function bytes(root,name){
 if(!path.isAbsolute(root)||path.normalize(root)!==root||root==='/'||fs.realpathSync(root)!==root||path.isAbsolute(name)||name.split('/').some(x=>!x||x==='.'||x==='..'))fail('EVIDENCE_UNAVAILABLE');
 let current=root;for(const component of name.split('/')){current=path.join(current,component);if(fs.lstatSync(current).isSymbolicLink())fail('EVIDENCE_UNAVAILABLE');}
 const stat=fs.lstatSync(current);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>8*1024*1024)fail('EVIDENCE_UNAVAILABLE');
 return fs.readFileSync(current);
}
const json=(root,name)=>JSON.parse(bytes(root,name));
const absent=(root,name)=>{try{fs.lstatSync(path.join(root,name));return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};

/** Positive terminal CLI, broker and process evidence. No Native row or no-provider flag is synthesized. */
export function readChiefTransportFailureEvidence({root,operation:op,parentRun:parent}){
 try{
  if(!isChiefTransportPlanRetry(op,parent)||!uuid(op.id)||!uuid(op.taskId)||!uuid(parent.id)||parent.issueId!==op.taskId||parent.agentId!==op.agentId||parent.resultJson?.executionRecovery?.providerWorkStarted===true)fail('RUN_DENIED');
  const base='transport/'+parent.id+'/',names={permit:'permits/'+parent.id+'.json',claim:'claims/'+parent.id+'.json',gateResult:'results/'+parent.id+'.json',
   transportResult:base+'result.json',stdout:base+'stdout',stderr:base+'stderr',audit:base+'proxy-audit/provider.jsonl',request:base+'request.json',hostClaim:base+'host.claim.json',
   proof:base+'native-proof.json',hostInput:base+'host-stdin',process:base+'process.json',processCleanup:base+'process-cleanup.json',broker:base+'broker-process.json',brokerCleanup:base+'broker-process-cleanup.json'};
  const raw=Object.fromEntries(Object.entries(names).map(([key,file])=>[key,bytes(root,file)]));
  const value=Object.fromEntries(Object.entries(raw).filter(([key])=>!['stdout','stderr','audit','hostInput'].includes(key)).map(([key,b])=>[key,JSON.parse(b)]));
  const {permit,claim,gateResult:g,transportResult:t,request,hostClaim,proof,process:child,processCleanup,broker,brokerCleanup}=value;
  if(permit.schemaVersion!==1||permit.runId!==parent.id||permit.taskId!==op.taskId||permit.rootTaskId!==op.taskId||permit.agentId!==op.agentId||permit.projectId!==op.projectId||permit.companyId!==parent.companyId||permit.ownerId!==parent.responsibleUserId||typeof permit.ownerId!=='string'||!permit.ownerId||permit.role!=='chief'||permit.inputRevision!==op.inputRevision||permit.cwd!==op.workspaceCwd||!equal(roleExecutionPolicy(permit),MACOS_NATIVE_EXECUTION_POLICY)||
   claim.schemaVersion!==1||claim.runId!==parent.id||claim.taskId!==op.taskId||claim.role!=='chief'||claim.permitSha256!==sha(raw.permit)||
   g.runId!==parent.id||g.taskId!==op.taskId||g.code!==1||g.signal!==null||g.timedOut!==false||g.interrupted!==false||
   t.runId!==parent.id||t.exitCode!==parent.exitCode||t.signal!==null||t.cancelled!==false||t.timedOut!==false||t.outputUnknown!==false||t.executor!=='macos_native'||t.stdoutSha256!==sha(raw.stdout)||t.stderrSha256!==sha(raw.stderr))fail('TRANSPORT_UNSETTLED');
  if(request.runId!==parent.id||request.taskId!==op.taskId||request.role!=='chief'||request.cwd!==permit.cwd||!equal(roleExecutionPolicy(request),MACOS_NATIVE_EXECUTION_POLICY)||
   hostClaim.runId!==parent.id||hostClaim.executor!=='macos_native'||!equal(roleExecutionPolicy(hostClaim),MACOS_NATIVE_EXECUTION_POLICY)||
   proof.runId!==parent.id||proof.executor!=='macos_native'||proof.platform!=='darwin'||!equal(roleExecutionPolicy(proof),MACOS_NATIVE_EXECUTION_POLICY)||proof.inputSha256!==sha(raw.hostInput)||!equal(proof.process,child))fail('TRANSPORT_UNSETTLED');
  for(const [process,cleanup]of [[child,processCleanup],[broker,brokerCleanup]])if(!Number.isSafeInteger(process.pid)||process.pid<=1||process.pgid!==process.pid||typeof process.birth!=='string'||!process.birth||cleanup.status!=='terminated'||cleanup.pgid!==process.pgid||!Array.isArray(cleanup.members)||!cleanup.members.some(member=>member.pid===process.pid&&member.pgid===process.pgid&&member.birth===process.birth))fail('PROCESS_UNSETTLED');
  const output=raw.stdout.toString().trim().split('\n').map(line=>JSON.parse(line));
  if(output.at(-1)?.type!=='turn.failed'||output.at(-1).error?.message!==message||!output.some(row=>row.type==='thread.started')||output.some(row=>!['thread.started','turn.started','error','item.completed','turn.failed'].includes(row.type)||row.type==='item.completed'&&row.item?.type!=='error')||
   typeof parent.sessionIdAfter==='string'&&!output.some(row=>row.type==='thread.started'&&row.thread_id===parent.sessionIdAfter))fail('FAILURE_NOT_SUPPORTED');
  const audit=raw.audit.toString().trim().split('\n').map(line=>JSON.parse(line));
  const allowedPaths=['/backend-api/codex/models','/backend-api/wham/usage','/backend-api/wham/accounts/check','/backend-api/wham/settings/user','/backend-api/ps/mcp','/backend-api/ps/plugins/suggested/codex','/backend-api/ps/plugins/installed','/backend-api/ps/plugins/list','/backend-api/plugins/featured'];
  if(audit.filter(row=>row.code==='ROLE_PROXY_READY'&&row.runId===parent.id&&row.host==='127.0.0.1'&&Number.isInteger(row.port)&&row.port>0&&row.port<65536).length!==1||!audit.some(row=>row.code==='ROLE_PROXY_COMPLETED'&&row.path==='/backend-api/wham/accounts/check'&&row.status===200&&row.requestCount===0)||
   audit.some(row=>!['ROLE_PROXY_READY','ROLE_PROXY_COMPLETED','ROLE_PROXY_MCP_REQUEST','ROLE_PROXY_MCP_CATALOG_FILTERED'].includes(row.code)||row.code==='ROLE_PROXY_READY'&&row.runId!==parent.id||
    row.runId!==undefined&&row.runId!==parent.id||row.requestCount!==undefined&&row.requestCount!==0||row.code==='ROLE_PROXY_COMPLETED'&&(row.requestCount!==0||!allowedPaths.includes(row.path)||!Number.isInteger(row.status)||row.status<200||row.status>=300)||
    row.code==='ROLE_PROXY_MCP_REQUEST'&&!['initialize','notifications/initialized','tools/list'].includes(row.method)))fail('PROVIDER_EVIDENCE');
  const hostCalls=root+'/'+base+'proxy-audit/host-calls';if(fs.existsSync(hostCalls)&&fs.readdirSync(hostCalls).length)fail('PROVIDER_EVIDENCE');
  return {schemaVersion:1,kind:'chief_https_no_response',parentRunId:parent.id,operationId:op.id,taskId:op.taskId,inputRevision:op.inputRevision,
   hashes:Object.fromEntries(Object.entries(raw).map(([key,b])=>[key+'Sha256',sha(b)]))};
 }catch(error){throw Object.assign(Error(chiefTransportEvidenceCode(error)),{code:chiefTransportEvidenceCode(error)});}
}

export const chiefTransportEvidenceCode=error=>/^TEAM_NATIVE_RETRY_CHIEF_TRANSPORT_[A-Z_]+$/.test(error?.code??'')?error.code:prefix+'EVIDENCE_UNAVAILABLE';
export async function withChiefTransportEvidence(perform){try{return await perform();}catch(error){throw Object.assign(Error(chiefTransportEvidenceCode(error)),{code:chiefTransportEvidenceCode(error)});}}

export function bindChiefTransportRetry({root,ctx,editRegistry,verifyPhaseLease,log,...f}){
 const {registry:r,operation:op,parentRun:parent,initialOperation:initial,initialRun,run,task,wakeup,control}=f;
 const physical=readChiefTransportFailureEvidence({root,operation:op,parentRun:parent});
 const existing=r.operations.find(value=>value.acceptedRunId===run.id&&value.retryOfRunId===parent.id);
 if(!isInitialChiefPlan(initial)||!isUnclaimedChiefGateFailure(initialRun)||initial.acceptedRunId!==initialRun.id||op.retryOfOperationId!==initial.id||parent.retryOfRunId!==initialRun.id||
  run.status!=='running'||run.retryOfRunId!==parent.id||run.scheduledRetryAttempt!==2)fail('RUN_DENIED');
 if(r.enabled!==true||r.team?.enabled!==true||r.context?.enabled!==true||r.team.ids.chief!==op.agentId||!r.tasks?.includes(task.id)||r.taskRoots?.[task.id]!==task.id||
  task.id!==op.taskId||task.parentId||task.companyId!==r.companyId||task.projectId!==op.projectId||task.responsibleUserId!==r.ownerId||task.createdByUserId!==r.ownerId&&task.createdByAgentId!==op.agentId||
  !['todo','in_progress'].includes(task.status)||task.assigneeAgentId!==op.agentId||task.assigneeUserId||task.executionRunId&&task.executionRunId!==run.id||task.checkoutRunId&&task.checkoutRunId!==run.id||taskInputRevision(task)!==op.inputRevision||
  ['taskId','rootTaskId','agentId','projectId','contextVersion','projectKey','workspaceCwd','projectWorkspaceId','inputRevision'].some(key=>initial[key]!==op[key])||
  [initialRun,parent,run].some(value=>value.companyId!==r.companyId||value.agentId!==op.agentId||value.issueId!==task.id||value.responsibleUserId!==r.ownerId)||
  wakeup?.id!==initialRun.wakeupRequestId||wakeup.companyId!==r.companyId||wakeup.agentId!==op.agentId||wakeup.requestedByActorType!=='user'||wakeup.requestedByActorId!==r.ownerId)fail('AUTHORITY_CHANGED');
 const profile=r.agents?.find(value=>value.profile?.agentId===op.agentId&&value.profile.role==='chief')?.profile,permit=json(root,'permits/'+parent.id+'.json');
 if(!profile||permit.ownerId!==r.ownerId||!equal(roleExecutionPolicy(profile),roleExecutionPolicy(permit))||!control||control.managed!==true||control.inputRevision!==op.inputRevision||control.pauseRequested!==false||!Array.isArray(control.pendingInputs)||control.pendingInputs.length||control.plan||control.approvedPlanSha256||
  (control.projectWorkspaceId??null)!==(op.projectWorkspaceId??null)||!Array.isArray(f.flows)||f.flows.some(({flow})=>flow.rootTaskId===task.id))fail('CONTROL_CHANGED');
 if(!Array.isArray(f.taskRuns)||f.taskRuns.length!==3||new Set(f.taskRuns.map(value=>value.id)).size!==3||f.taskRuns.some(value=>![initialRun.id,parent.id,run.id].includes(value.id))||
  !Array.isArray(f.activeRuns)||f.activeRuns.length!==1||f.activeRuns[0].id!==run.id||f.activeRuns[0].status!=='running'||!f.leases?.some(value=>value.heartbeatRunId===parent.id)||
  f.leases.some(value=>value.heartbeatRunId!==run.id&&(!ended(value.releasedAt)||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed')))fail('EXECUTION_UNSETTLED');
 for(const id of [initialRun.id,run.id])for(const file of ['claims/'+id+'.json','results/'+id+'.json','transport/'+id])if(!absent(root,file))fail('PROVIDER_EVIDENCE');
 const names=fs.readdirSync(root+'/budget/'+task.id).sort(),expected=[initial.id+'.json',op.id+'.json'].sort();if(!equal(names,expected))fail('BUDGET_DENIED');
 for(const operation of [initial,op]){
  const budget=json(root,'budget/'+task.id+'/'+operation.id+'.json'),binding=json(root,'operations/'+operation.id+'.json');
  if(Object.keys(operation).some(key=>!equal(budget[key],operation[key]))||binding.operationId!==operation.id||binding.runId!==operation.acceptedRunId||binding.taskId!==task.id||binding.agentId!==op.agentId)fail('BUDGET_DENIED');
 }
 const initialNames={permit:'permits/'+initialRun.id+'.json',budgetRecord:'budget/'+task.id+'/'+initial.id+'.json',operationBinding:'operations/'+initial.id+'.json'};
 if(Object.entries(initialNames).some(([key,name])=>op.bootstrapRetryEvidence?.[key+'Sha256']!==sha(bytes(root,name))))fail('INITIAL_EVIDENCE_CHANGED');
 const operations=r.operations.filter(value=>value.rootTaskId===task.id);if(operations.length!==(existing?3:2)||operations.some(value=>![initial.id,op.id,existing?.id].includes(value.id)))fail('OPERATION_CHANGED');
 if(!r.lease?.nonce||r.lease.taskId!==task.id||r.lease.projectId!==task.projectId||![op.id,existing?.id].includes(r.lease.operationId)||verifyPhaseLease(r.lease)!==true)fail('LEASE_CHANGED');
 const context={issueId:task.id,taskId:task.id,projectId:task.projectId,responsibleUserId:r.ownerId,inputRevision:op.inputRevision,taskGoal:task.description,conversationMode:false};
 if(ctx.runId!==run.id||ctx.agent?.id!==op.agentId||Object.entries(context).some(([key,value])=>ctx.context?.[key]!==undefined&&ctx.context[key]!==value)||ctx.context?.roleOperationId!==undefined&&![op.id,existing?.id].includes(ctx.context.roleOperationId))fail('CONTEXT_CHANGED');
 const lockName=absent(root,'call.lock')?'team/native-retries/'+parent.id+'/call.lock.json':'call.lock',callLock=json(root,lockName);
 if(!callLock.nonce||callLock.taskId!==task.id||callLock.operationId!==op.id||lockName!=='call.lock'&&!existing)fail('LOCK_DENIED');
 const certificate={...physical,initialOperationId:initial.id,initialRunId:initialRun.id,retryRunId:run.id,nativeRetryAttempt:2,phaseLeaseNonceSha256:sha(r.lease.nonce)};
 const data=Buffer.from(JSON.stringify(certificate)+'\n'),evidence={kind:certificate.kind,parentRunId:parent.id,artifactFile:artifactName,artifactSha256:sha(data)};
 const additionalInput=op.additionalInput?.includes(NATIVE_RETRY_CONTEXT)?op.additionalInput:(op.additionalInput??'')+'\n'+NATIVE_RETRY_CONTEXT;
 const next={...op,id:existing?.id??randomUUID(),acceptedRunId:run.id,retryOfOperationId:op.id,retryOfRunId:parent.id,nativeRetryAttempt:2,additionalInput,chiefTransportRetryEvidence:evidence};
 if(existing&&!equal(existing,next))fail('OPERATION_CHANGED');
 const archive=archiveNativeRetryFailure({root,parentRun:parent,operation:op,callLock,artifact:{file:artifactName,data},log});
 editRegistry(current=>{
  if(current.companyId!==r.companyId||current.ownerId!==r.ownerId||!equal(current.context,r.context)||!equal(current.lease,r.lease)||!equal(current.operations.find(value=>value.id===op.id),op)||!equal(current.operations.find(value=>value.id===next.id),existing)||
   !equal(readChiefTransportFailureEvidence({root,operation:op,parentRun:parent}),physical))fail('EVIDENCE_CHANGED');
  if(!existing)current.operations.push(next);current.lease={...current.lease,operationId:next.id};return current;
 });
 clearArchivedRetryLock({root,callLock,archive,allowAlreadyCleared:Boolean(existing),log});
 log({code:prefix+'BOUND',runId:run.id,parentRunId:parent.id,operationId:next.id,retryOfOperationId:op.id,taskId:task.id,nativeRetryAttempt:2});
 return {...ctx,context:{...ctx.context,...context,roleOperationId:next.id}};
}

/** Status/continue observes an immutable admission archive; it never creates a certificate or clears a lock. */
export function readArchivedChiefTransportFailure({root,call,run,successor,registry}){
 try{
  if(!isChiefTransportPlanRetry(call,run)||!successor||successor.retryOfRunId!==run.id||successor.scheduledRetryAttempt!==2||successor.companyId!==run.companyId||successor.issueId!==run.issueId||successor.agentId!==run.agentId||successor.responsibleUserId!==run.responsibleUserId)return false;
  const directory='team/native-retries/'+run.id,receipt=json(root,directory+'/receipt.json'),certificateBytes=bytes(root,directory+'/'+artifactName),certificate=JSON.parse(certificateBytes),lock=bytes(root,directory+'/call.lock.json');
  const current=registry??json(root,'registry.json'),next=current.operations?.find(value=>value.acceptedRunId===successor.id&&value.retryOfOperationId===call.id&&value.retryOfRunId===run.id&&value.nativeRetryAttempt===2);
  if(!next||['kind','role','phase','taskId','rootTaskId','rootInputRevision','agentId','projectId','contextVersion','projectKey','workspaceCwd','projectWorkspaceId','inputRevision'].some(key=>next[key]!==call[key])||next.chiefTransportRetryEvidence?.kind!=='chief_https_no_response'||next.chiefTransportRetryEvidence.parentRunId!==run.id||next.chiefTransportRetryEvidence.artifactSha256!==sha(certificateBytes)||next.chiefTransportRetryEvidence.artifactFile!==artifactName||
   certificate.retryRunId!==successor.id||certificate.initialOperationId!==call.retryOfOperationId||certificate.initialRunId!==run.retryOfRunId||certificate.nativeRetryAttempt!==2||
   receipt.parentRunId!==run.id||receipt.operationId!==call.id||receipt.taskId!==call.taskId||receipt.directory!==root+'/'+directory||receipt.lockFile!==root+'/'+directory+'/call.lock.json'||receipt.lockSha256!==sha(lock)||
   receipt.artifact?.path!==root+'/'+directory+'/'+artifactName||receipt.artifact.sha256!==sha(certificateBytes)||receipt.artifact.bytes!==certificateBytes.length||
   ['receipt.json','call.lock.json',artifactName].some(file=>fs.lstatSync(root+'/'+directory+'/'+file).mode&0o222))return false;
  const lockValue=JSON.parse(lock);if(!lockValue.nonce||lockValue.operationId!==call.id||lockValue.taskId!==call.taskId)return false;
  const actual=readChiefTransportFailureEvidence({root,operation:call,parentRun:run});return Object.entries(actual).every(([key,value])=>equal(certificate[key],value));
 }catch{return false;}
}
