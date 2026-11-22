import fs from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {TEAM_ROLES,roleInstructions} from '../../bridge/team-roles.mjs';
import {getRoleRuntimeProfile,RUNTIME_PROFILES} from '../../bridge/role-runtime-profiles.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../../bridge/role-execution-policy.mjs';
import {taskInputRevision} from '../../bridge/task-input.mjs';
import {AdmissionMeter} from '../../bridge/admission.mjs';
import {editRoleRegistry,writeControl} from '../../bridge/role-control-store.mjs';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {renderRoleCapabilitiesMarkdown,resolveRoleCapabilities} from '../../bridge/role-capabilities.mjs';
import {rolePermissions,roleSkillNames} from '../../bridge/company-role-skills.mjs';

export const ACCEPTANCE_ROOT='/paperclip/control/research-pm';
const P='/opt/paperclip/node_modules',sha=value=>createHash('sha256').update(value).digest('hex');
const SOURCE_TRANSITION='/host-evidence/current13-source-transition.json';
const fail=code=>{throw Object.assign(Error(code),{code});};
const noProviderProcess=run=>!['processPid','processGroupId','nativeSessionId','driverKind','driverVersion','externalRunId','logRef','lastOutputAt'].some(key=>run[key]!=null)&&Number(run.lastOutputBytes??0)===0&&
 !['inputTokens','outputTokens','cachedInputTokens','totalTokens'].some(key=>Number(run.usageJson?.[key]??0)>0);
function controlEventFor(run,event,type,level,message){
 const finished=new Date(run.finishedAt).getTime(),created=new Date(event?.createdAt).getTime();
 return event?.runId===run.id&&event.companyId===run.companyId&&event.agentId===run.agentId&&event.eventType===type&&event.stream==='system'&&event.level===level&&event.sourceEventId===null&&
  message(event.message)&&Number.isFinite(finished)&&Number.isFinite(created)&&created>=finished&&created-finished<=60000;
}
const cancellationOnly=(run,events)=>Array.isArray(events)&&events.length<=1&&events.every(event=>controlEventFor(run,event,'lifecycle','warn',message=>message==='run cancelled')&&event.payload?.cancellation?.expected===true&&event.payload.cancellation.source==='control_plane');
const identityError=message=>typeof message==='string'&&/^Secret decryption failed \(master key fingerprint: [a-f0-9]{12}\)\. This usually means the master key does not match the key used to encrypt the secret\. Original error: Unsupported state or unable to authenticate data$/.test(message);
/** The caller holds the parent and identity row locks. A usable current key always wins over an earlier failed probe. */
export async function repairIdentityUnderLock({ensure,replace}){
 try{await ensure();return{reprovisioned:false};}catch(error){if(!identityError(error.message))fail('MULTI_RUNTIME_IDENTITY_FAILURE_UNVERIFIED');}
 await replace();return{reprovisioned:true};
}
export function privateJson(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)||stat.size>1048576)fail('MULTI_RUNTIME_PRIVATE_INPUT_DENIED');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
export function writePrivate(file,value){
 fs.mkdirSync(file.slice(0,file.lastIndexOf('/')),{recursive:true,mode:0o700});
 const temporary=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,file);
}
function restorePrivateBytes(file,bytes){
 const temporary=file+'.'+randomUUID()+'.restore';fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});const fd=fs.openSync(temporary,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file);
 const directory=fs.openSync(file.slice(0,file.lastIndexOf('/')),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
/** Content-addressed private recovery snapshots never replace older bytes. */
export function archivePrivateSnapshot(directory,label,bytes){
 if(!/^[a-z0-9-]+$/.test(label))fail('MULTI_RUNTIME_ARCHIVE_LABEL_DENIED');
 bytes=Buffer.from(bytes);fs.mkdirSync(directory,{recursive:true,mode:0o700});const digest=sha(bytes),file=directory+'/'+label+'-'+digest+'.json';
 try{fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)||!fs.readFileSync(file).equals(bytes))fail('MULTI_RUNTIME_ARCHIVE_CHANGED');}
 return{file,sha256:digest};
}
/** A scoped management acknowledgement of proven absence of provider execution, never a provider success receipt. */
export function reconcileCancelledBootstrapResult({run,closure,closureSha256,expectedAgentId,executionEvents,hostMarkers,verifiedClosureSha256s=[],now=new Date()}){
 if(!run||run.status!=='cancelled'||run.runtimeMode!=='legacy'||run.executionStage!=='preparing'||run.companyId!==closure?.companyId||run.issueId!==closure?.lease?.taskId||run.agentId!==expectedAgentId||
  !closure.runs?.some(value=>value.id===run.id&&value.status==='cancelled'&&value.finishedAt===new Date(run.finishedAt).toISOString())||!/^[a-f0-9]{64}$/.test(closureSha256??'')||
  !cancellationOnly(run,executionEvents)||!Array.isArray(hostMarkers)||hostMarkers.length!==3||hostMarkers.some(Boolean)||
  ['processPid','processGroupId','nativeSessionId','driverKind','driverVersion','externalRunId','logRef','lastOutputAt'].some(key=>run[key]!=null)||Number(run.lastOutputBytes??0)!==0||
  ['inputTokens','outputTokens','cachedInputTokens','totalTokens'].some(key=>Number(run.usageJson?.[key]??0)>0))fail('MULTI_RUNTIME_BOOTSTRAP_STOP_PROOF_DENIED');
 const result=run.resultJson??{};if(typeof result!=='object'||Array.isArray(result))fail('MULTI_RUNTIME_BOOTSTRAP_STOP_PROOF_DENIED');
 if(result.executionCancellation?.state==='acknowledged'){
  if(result.executionCancellation.proof!=='verified-no-provider-bootstrap'||![closureSha256,...verifiedClosureSha256s].includes(result.executionCancellation.closureSha256))fail('MULTI_RUNTIME_BOOTSTRAP_STOP_ACK_CHANGED');
  return{changed:false,resultJson:structuredClone(result)};
 }
 return{changed:true,resultJson:{...structuredClone(result),executionCancellation:{...result.executionCancellation,state:'acknowledged',proof:'verified-no-provider-bootstrap',closureSha256,acknowledgedAt:now.toISOString()}}};
}
export function roleRunMaterialName(step){
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(step?.operationId??''))fail('MULTI_RUNTIME_MATERIAL_ID_DENIED');
 return step.operationId+'.md';
}
export function knownBootstrapClosure(run,markers,{executionEvents}={}){
 const recovery=run?.resultJson?.executionRecovery;
 if(run?.status!=='failed'||!run.finishedAt||recovery?.kind!=='bootstrap'||recovery.providerWorkStarted!==false||
  Object.values(markers??{}).some(Boolean)||!markers||Object.keys(markers).length!==4||
  ['inputTokens','outputTokens','cachedInputTokens','totalTokens'].some(key=>Number(run.usageJson?.[key]??0)>0))fail('MULTI_RUNTIME_BOOTSTRAP_CLOSURE_DENIED');
 if(run.errorCode==='setup_failed'){
  if(!noProviderProcess(run)||!Array.isArray(executionEvents)||executionEvents.length!==1||!controlEventFor(run,executionEvents[0],'error','error',identityError)||executionEvents[0].payload!==null)fail('MULTI_RUNTIME_IDENTITY_SETUP_PROOF_DENIED');
  return{kind:'native-bootstrap-no-provider',proofSource:'native_identity_setup',runId:run.id,gateCode:'NATIVE_IDENTITY_SETUP_FAILED',finishedAt:new Date(run.finishedAt).toISOString(),nativeResultSha256:sha(JSON.stringify(run.resultJson))};
 }
 if(run.errorCode==='NATIVE_ROLE_RESULT_UNKNOWN'&&noProviderProcess({...run,logRef:null})&&Number(run.logBytes??0)===0&&!run.stdoutExcerpt&&!run.stderrExcerpt)return{kind:'native-bootstrap-no-provider',proofSource:'native_preparation_no_process',runId:run.id,nativeErrorCode:run.errorCode,finishedAt:new Date(run.finishedAt).toISOString(),nativeResultSha256:sha(JSON.stringify(run.resultJson))};
 let gate;for(const text of [run.error,run.resultJson?.stderr,run.stderrExcerpt])for(const line of String(text??'').split('\n')){
  try{const value=JSON.parse(line);if(/^ROLE_(?:OPENCODE_|CLAUDE_)?GATE_[A-Z_]+$/.test(value.code??'')&&value.claimed===false)gate=value;}catch{}
 }
 if(!gate)fail('MULTI_RUNTIME_BOOTSTRAP_CLAIM_NOT_PROVEN');
 return{kind:'native-bootstrap-no-provider',runId:run.id,gateCode:gate.code,finishedAt:new Date(run.finishedAt).toISOString(),nativeResultSha256:sha(JSON.stringify(run.resultJson))};
}
export function assertIsolatedIdentityReprovision({authorized,identity,plan,closure,runs,eventsByRun,markersByRun}){
 const first=plan.steps[0];
 if(authorized!==true||identity?.companyId!==plan.companyId||identity.agentId!==first.agentId||identity.algorithm!=='Ed25519'||typeof identity.keyId!=='string'||
  closure.companyId!==plan.companyId||closure.rootTaskId!==plan.rootTaskId||closure.modelCalls!==0||runs.length!==closure.runs.length||!runs.some(run=>run.id===first.runId&&run.errorCode==='setup_failed'))fail('MULTI_RUNTIME_IDENTITY_REPROVISION_DENIED');
 for(const run of runs){
  if(run.companyId!==plan.companyId||run.agentId!==first.agentId||run.issueId!==first.taskId||!closure.runs.some(record=>record.id===run.id&&record.status===run.status&&record.finishedAt===new Date(run.finishedAt).toISOString()))fail('MULTI_RUNTIME_IDENTITY_REPROVISION_DENIED');
  const markers=markersByRun[run.id];if(!markers||Object.values(markers).some(Boolean))fail('MULTI_RUNTIME_IDENTITY_REPROVISION_DENIED');
  if(run.status==='failed')knownBootstrapClosure(run,markers,{executionEvents:eventsByRun[run.id]});
  else if(run.status!=='cancelled'||!noProviderProcess(run)||!cancellationOnly(run,eventsByRun[run.id]))fail('MULTI_RUNTIME_IDENTITY_REPROVISION_DENIED');
 }
 return true;
}
export function validateReleasedBootstrapClosure({closure,plan,registry,runs,budget}){
 const first=plan.steps[0],lease=closure?.lease,iso=value=>new Date(value).toISOString();
 if(closure?.schemaVersion!==1||closure.kind!=='known-unstarted-bootstrap-closure'||closure.modelCalls!==0||closure.companyId!==plan.companyId||closure.rootTaskId!==plan.rootTaskId||registry.lease!==undefined||
  lease?.taskId!==first.taskId||lease.projectId!==plan.projectId||lease.operationId!==first.operationId||!/^[a-f0-9]{64}$/.test(lease.nonce??'')||
  !Array.isArray(closure.runs)||closure.runs.length!==runs.length||!runs.some(run=>run.id===first.runId)||
  runs.some(run=>{const recorded=closure.runs.find(value=>value.id===run.id);return !recorded||!['failed','cancelled'].includes(run.status)||recorded.status!==run.status||!run.finishedAt||recorded.finishedAt!==iso(run.finishedAt)||
   run.companyId!==plan.companyId||run.agentId!==first.agentId||run.issueId!==first.taskId||run.status==='cancelled'&&(
    ['processPid','processGroupId','nativeSessionId','driverKind','driverVersion','externalRunId','logRef','lastOutputAt'].some(key=>run[key]!=null)||Number(run.lastOutputBytes??0)!==0||
    ['inputTokens','outputTokens','cachedInputTokens','totalTokens'].some(key=>Number(run.usageJson?.[key]??0)>0));})||
  !Array.isArray(closure.budget)||closure.budget.length!==budget.length||budget.some(record=>!closure.budget.some(value=>value.file===record.operationId+'.json'&&value.sha256===record.sha256)))fail('MULTI_RUNTIME_RELEASED_BOOTSTRAP_CLOSURE_DENIED');
 return closure;
}
function controllerMaster(){
 const file=ACCEPTANCE_ROOT+'/runtime-secrets/controller-master.json';
 if(!fs.existsSync(file))writePrivate(file,{schemaVersion:1,key:randomBytes(32).toString('hex'),credentialGeneration:randomUUID(),createdAt:new Date().toISOString()});
 const value=privateJson(file);if(value.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(value.key??'')||!/^[a-f0-9-]{36}$/.test(value.credentialGeneration??''))fail('MULTI_RUNTIME_CONTROLLER_MASTER_DENIED');
 process.env.PAPERCLIP_SECRETS_MASTER_KEY=value.key;return value;
}
function validateShortDelegation(auth,{holderAccountId,minimumRemainingMs,now}){
 const tokens=auth?.tokens;
 if(!tokens||!['access_token','id_token','account_id'].every(key=>typeof tokens[key]==='string'&&tokens[key]&&!/[\r\n]/.test(tokens[key]))||tokens.account_id!==holderAccountId||tokens.refresh_token!=='ISOLATED_NO_REFRESH'||
  !Number.isSafeInteger(auth.expiresAt)||auth.expiresAt-now<minimumRemainingMs||auth.expiresAt-now>1800000||Object.keys(auth).some(key=>!['tokens','expiresAt'].includes(key))||Object.keys(tokens).some(key=>!['access_token','id_token','account_id','refresh_token'].includes(key)))fail('MULTI_RUNTIME_DELEGATION_RESPONSE_DENIED');
 return auth;
}
/** Private management RPC only. It never resolves a production connection or sends a provider request. */
export function createAcceptanceDelegationManager({root=ACCEPTANCE_ROOT,providerHome,holderAccountId,companyId,rootTaskId,verifyBoundary,clock=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const inFlight=new Set(),audit=(operationId,event)=>{const dir=root+'/delegation-audit';fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.appendFileSync(dir+'/'+operationId+'.jsonl',JSON.stringify({at:new Date(clock()).toISOString(),operationId,...event})+'\n',{mode:0o600});};
 return async(step,{minimumRemainingMs=210000,timeoutMs=120000}={})=>{
  if(step.runtimeProfileId!=='codex_subscription')return{status:'NOT_APPLICABLE'};
  if(![step.operationId,step.taskId,step.agentId].every(value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??''))||!TEAM_ROLES[step.role]||!Number.isSafeInteger(minimumRemainingMs)||minimumRemainingMs<210000||minimumRemainingMs>1800000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||inFlight.has(step.operationId))fail('MULTI_RUNTIME_DELEGATION_REQUEST_DENIED');
  inFlight.add(step.operationId);let requestSha256,responseSha256,request;
  try{
   await verifyBoundary(step);const authFile=providerHome+'/auth.json',current=privateJson(authFile);
   if(current.tokens?.account_id!==holderAccountId||current.tokens?.refresh_token!=='ISOLATED_NO_REFRESH')fail('MULTI_RUNTIME_DELEGATION_HOLDER_CHANGED');
   if(Number.isSafeInteger(current.delegatedExpiresAt)&&current.delegatedExpiresAt-clock()>=minimumRemainingMs){
    validateShortDelegation({tokens:current.tokens,expiresAt:current.delegatedExpiresAt},{holderAccountId,minimumRemainingMs,now:clock()});
    audit(step.operationId,{code:'CURRENT',authSha256:sha(fs.readFileSync(authFile)),expiresAt:current.delegatedExpiresAt});return{status:'CURRENT',expiresAt:current.delegatedExpiresAt};
   }
   const file=root+'/delegation-requests/'+step.operationId+'.json',responseFile=root+'/runtime-secrets/delegation-'+step.operationId+'.json';
   request={schemaVersion:1,companyId,rootTaskId,taskId:step.taskId,agentId:step.agentId,role:step.role,operationId:step.operationId,nonceUUID:randomUUID(),minimumRemainingMs};
   if(fs.existsSync(file)){const existing=privateJson(file);if(Object.keys(request).some(key=>key!=='nonceUUID'&&existing[key]!==request[key])||!/^[a-f0-9-]{36}$/.test(existing.nonceUUID??'')||Object.keys(existing).length!==Object.keys(request).length)fail('MULTI_RUNTIME_DELEGATION_REQUEST_CHANGED');request=existing;}
   else{fs.mkdirSync(root+'/delegation-requests',{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(request)+'\n',{flag:'wx',mode:0o600});}
   requestSha256=sha(fs.readFileSync(file));audit(step.operationId,{code:'REQUESTED',requestSha256});
   const until=clock()+timeoutMs;
   while(clock()<until){
    await verifyBoundary(step);if(sha(fs.readFileSync(file))!==requestSha256)fail('MULTI_RUNTIME_DELEGATION_REQUEST_CHANGED');
    if(fs.existsSync(responseFile)){
     let response,matched=false;privateJson(responseFile);const bytes=fs.readFileSync(responseFile);responseSha256=sha(bytes);
     try{
      response=privateJson(responseFile);
      if(response.schemaVersion!==1||response.nonce!==request.nonceUUID||response.operationId!==step.operationId)fail('MULTI_RUNTIME_DELEGATION_RESPONSE_DENIED');matched=true;
      if(Object.keys(response).some(key=>!['schemaVersion','nonce','operationId','auth'].includes(key)))fail('MULTI_RUNTIME_DELEGATION_RESPONSE_DENIED');
      validateShortDelegation(response.auth,{holderAccountId,minimumRemainingMs,now:clock()});await verifyBoundary(step);
      if(sha(fs.readFileSync(file))!==requestSha256||sha(fs.readFileSync(responseFile))!==responseSha256)fail('MULTI_RUNTIME_DELEGATION_RESPONSE_CHANGED');
      const old=privateJson(authFile);if(old.tokens?.account_id!==holderAccountId||old.tokens?.refresh_token!=='ISOLATED_NO_REFRESH')fail('MULTI_RUNTIME_DELEGATION_HOLDER_CHANGED');
      writePrivate(authFile,{auth_mode:'chatgpt',delegatedExpiresAt:response.auth.expiresAt,tokens:response.auth.tokens});
      audit(step.operationId,{code:'RENEWED',requestSha256,responseSha256,authSha256:sha(fs.readFileSync(authFile)),expiresAt:response.auth.expiresAt});
      if(sha(fs.readFileSync(file))===requestSha256)fs.unlinkSync(file);
      return{status:'RENEWED',expiresAt:response.auth.expiresAt,requestSha256,responseSha256};
     }finally{if(matched&&fs.existsSync(responseFile)&&sha(fs.readFileSync(responseFile))===responseSha256)fs.unlinkSync(responseFile);}
    }
    await wait(Math.min(500,Math.max(1,until-clock())));
   }
   fail('MULTI_RUNTIME_DELEGATION_TIMEOUT');
  }catch(error){audit(step.operationId,{code:/^MULTI_RUNTIME_[A-Z_]+$/.test(error.code??'')?error.code:'MULTI_RUNTIME_DELEGATION_FAILED',requestSha256,responseSha256});throw error;}
  finally{inFlight.delete(step.operationId);}
 };
}
/** Base matrix proof for reusing the same isolated database; this grants no new provider call. */
export function validateCompletedMultiRuntimeState({plan,registry,rootTask,agents,runs,budget,activeRunIds=[],callLock=false,retainedClosures=[]}){
 const roles=Object.keys(plan?.agentIds??{}),known=Object.keys(TEAM_ROLES),legacy=known.filter(role=>role!=='full-stack-engineer');
 const acceptedRoster=[legacy,known].some(keys=>keys.length===roles.length&&keys.every(role=>roles.includes(role)));
 if(plan?.status!=='PASS'||plan.steps?.length!==5||plan.steps.some(step=>step.status!=='PASS'||!step.runId||!step.artifacts?.length)||plan.maximumCalls!==20||plan.maximumResponsesPerRun!==64||
  registry?.companyId!==plan.companyId||registry.projectId!==plan.projectId||registry.taskId!==plan.rootTaskId||registry.lease!==undefined||activeRunIds.length||callLock||
  rootTask?.id!==plan.rootTaskId||rootTask.companyId!==plan.companyId||rootTask.projectId!==plan.projectId||rootTask.responsibleUserId!==registry.ownerId||taskInputRevision(rootTask)!==plan.rootInputRevision||
  !acceptedRoster||!Array.isArray(agents)||agents.length!==roles.length||Object.keys(registry.team?.ids??{}).length!==roles.length||roles.some(role=>{const definition=TEAM_ROLES[role],agent=agents.find(row=>row.id===plan.agentIds[role]);return !definition||!agent||agent.companyId!==plan.companyId||registry.team?.ids?.[role]!==agent.id||agent.reportsTo!==(definition.parent?plan.agentIds[definition.parent]:null);})||
  !Number.isSafeInteger(plan.callsSpent)||!Array.isArray(budget)||budget.length<plan.callsSpent||budget.length>20||new Set(budget.map(record=>record.operationId)).size!==budget.length)fail('MULTI_RUNTIME_COMPLETED_STATE_DENIED');
 for(const step of plan.steps){const run=runs.find(row=>row.id===step.runId);
  if(!run||run.status!=='succeeded'||!run.finishedAt||run.companyId!==plan.companyId||run.agentId!==step.agentId||run.issueId!==step.taskId||run.responsibleUserId!==registry.ownerId||!budget.some(record=>record.operationId===step.operationId))fail('MULTI_RUNTIME_COMPLETED_RUN_DENIED');
 }
 const oldAttempts=plan.steps.flatMap(step=>step.priorAttempts??[]);
 if(oldAttempts.length&&!retainedClosures.length)fail('MULTI_RUNTIME_COMPLETED_HISTORY_MISSING');
 for(const prior of oldAttempts){const run=runs.find(row=>row.id===prior.runId);
  if(!run||run.companyId!==plan.companyId||run.agentId!==prior.agentId||run.issueId!==prior.taskId||run.status!==prior.nativeEvidence?.status)fail('MULTI_RUNTIME_COMPLETED_HISTORY_MISSING');
 }
 for(const closure of retainedClosures){
  if(closure.companyId!==plan.companyId||closure.rootTaskId!==plan.rootTaskId||closure.modelCalls!==0||closure.runs.some(ref=>!runs.some(row=>row.id===ref.id&&row.status===ref.status&&new Date(row.finishedAt).toISOString()===ref.finishedAt))||
   closure.budget.some(ref=>!budget.some(record=>ref.file===record.operationId+'.json'&&ref.sha256===record.sha256)))fail('MULTI_RUNTIME_COMPLETED_HISTORY_CHANGED');
 }
 for(const record of budget){const operation=registry.operations?.find(value=>value.id===record.operationId);
  if(!operation||operation.kind!=='run'||operation.rootTaskId!==plan.rootTaskId||operation.taskId!==record.taskId||operation.agentId!==record.agentId||operation.role!==record.role||!registry.tasks?.includes(record.taskId)||
   (registry.taskRoots?.[record.taskId]??record.taskId)!==plan.rootTaskId||!/^[a-f0-9]{64}$/.test(record.sha256??''))fail('MULTI_RUNTIME_COMPLETED_BUDGET_DENIED');
 }
 return true;
}
export function validateCurrent13SuccessPrefix({current,plan,registry,runs,budget,pendingEvidence}){
 const finalization=current?.postExecutionPrefixFinalization;
 const subset=validateCurrent13ClosedSubsetHistory(current);
 const repairCount=validateCurrent13PreclaimRepairHistory(current),accounting=repairCount?current.postExecutionPreclaimRepair:finalization;
 const specs=[['fullstack-feature','full-stack-engineer','minimax_opencode'],['backend-transfer','backend-engineer','codex_subscription'],['minimax-claude-preferences','full-stack-engineer','minimax_claude'],
  ['deepseek-claude-crosscheck','research','deepseek_claude'],['deepseek-opencode-crosscheck','research','deepseek_opencode'],['qa13','qa','codex_subscription']];
 if(current?.schemaVersion!==1||current.kind!=='isolated-native-current13'||!['PARTIAL_VALIDATED',...(subset?['COMPLETED_WITH_FAILURES']:[])].includes(current.status)||current.sourceRoleCount!==13||current.companyId!==plan.companyId||current.projectId!==plan.projectId||current.workspaceId!==plan.workspaceId||
  current.rootTaskId!==plan.rootTaskId||current.rootInputRevision!==plan.rootInputRevision||!isDeepStrictEqual(current.agentIds,registry.team.ids)||![6,...(subset?[7]:[])].includes(current.steps?.length)||
  current.steps.slice(0,6).some((step,index)=>[step.key,step.role,step.runtimeProfileId].some((value,part)=>value!==specs[index][part])||step.agentId!==registry.team.ids[step.role])||
  current.steps[0].taskId!==current.steps[1].taskId||current.steps[5].taskId!==plan.steps.find(step=>step.role==='qa').taskId||new Set(current.steps.map(step=>step.operationId)).size!==current.steps.length||
  current.callsSpent!==budget.length||finalization?.schemaVersion!==1||finalization.kind!=='closed-success-prefix'||finalization.modelCallsAdded!==0||(!subset&&(accounting.budgetUsedBefore!==budget.length||accounting.budgetUsedAfter!==budget.length))||
  subset&&budget.length!==current.historicalMatrix.callsSpent+current.steps.filter(step=>step.status==='PASS').length+repairCount+1||
  !/^[a-f0-9]{64}$/.test(finalization.sourceReportSha256??'')||!Array.isArray(current.budgetRecords)||current.budgetRecords.length!==budget.length||current.budgetRecords.some(ref=>!budget.some(value=>ref.operationId===value.operationId&&ref.sha256===value.sha256&&ref.taskId===value.taskId&&ref.agentId===value.agentId&&ref.role===value.role)))fail('MULTI_RUNTIME_CURRENT13_PREFIX_DENIED');
 let prefix=0,pending=false;
 for(const step of current.steps){
  if(step.status==='PASS'){
   const run=runs.find(value=>value.id===step.runId);
   if(pending||!run||run.status!=='succeeded'||run.exitCode!==0||!run.finishedAt||run.issueId!==step.taskId||run.agentId!==step.agentId||run.companyId!==plan.companyId||run.responsibleUserId!==registry.ownerId||
    !step.artifacts?.length||step.modelEvidence?.observed!==true||!budget.some(value=>value.operationId===step.operationId&&value.taskId===step.taskId&&value.agentId===step.agentId))fail('MULTI_RUNTIME_CURRENT13_STARTED_RESULT_UNKNOWN');prefix++;
  }else if(subset&&step.status==='FAILED_CLOSED'){
   const run=runs.find(value=>value.id===step.runId);if(pending||step!==current.steps[2]||run?.status!=='timed_out'||run.id!==step.runId||run.issueId!==step.taskId||run.agentId!==step.agentId||!run.finishedAt||!budget.some(value=>value.operationId===step.operationId))fail('MULTI_RUNTIME_CLOSED_SUBSET_NATIVE_CHANGED');prefix++;
  }else{
   pending=true;const evidence=pendingEvidence.find(value=>value.operationId===step.operationId),op=registry.operations.find(value=>value.id===step.operationId);
   if(step.status!=='NOT_RUN'||step.runId||step.nativeEvidence||step.nativeStatus||step.wakeAttemptedAt||step.leaseReleased||!evidence||evidence.nativeRunIds.length||
    evidence.operationFile||evidence.budgetSlot||evidence.orphanControl||op?.wakeAttemptedAt||op?.runId||op?.acceptedRunId||op?.runtimeDispatch?.status==='WAKE_ATTEMPTED')fail('MULTI_RUNTIME_CURRENT13_PENDING_ALREADY_STARTED');
  }
 }
 if(prefix<1||(!subset&&prefix>=current.steps.length)||(!subset&&finalization.successfulPrefix!==prefix))fail('MULTI_RUNTIME_CURRENT13_PREFIX_DENIED');return prefix;
}
export function validateCurrent13ClosedSubsetHistory(current){
 const meta=current?.postExecutionSubsetContinuation,failed=(current?.steps??[]).filter(step=>step.status==='FAILED_CLOSED');if(!meta&&!failed.length)return 0;
 const step=current.steps?.[2],compat=current.steps?.[6];
 if(meta?.schemaVersion!==1||meta.kind!=='operator-authorized-closed-runtime-subset'||meta.companyId!==current.companyId||meta.rootTaskId!==current.rootTaskId||meta.failedStepIndex!==2||meta.failedProfileId!=='minimax_claude'||step?.status!=='FAILED_CLOSED'||step.key!=='minimax-claude-preferences'||step.runtimeProfileId!=='minimax_claude'||failed.length!==1||
  meta.runId!==step.runId||meta.operationId!==step.operationId||meta.taskId!==step.taskId||meta.agentId!==step.agentId||!controlReference(meta.releaseReceipt)||!/^[a-f0-9]{64}$/.test(meta.sourceReportSha256??'')||!/^[a-f0-9]{64}$/.test(meta.sourceRegistrySha256??'')||meta.budgetUsedBefore!==10||meta.budgetUsedAfter!==10||meta.modelCallsAdded!==0||meta.poolEligibility!=='EXCLUDED_FAILED_RUNTIME'||
  current.steps.length>7||compat&&(compat.key!=='current-source-minimax-compatibility'||compat.role!=='full-stack-engineer'||compat.agentId!==current.agentIds['full-stack-engineer']||compat.runtimeProfileId!=='minimax_opencode'||!/^[-a-f0-9]{36}$/.test(compat.taskId??'')||!/^[-a-f0-9]{36}$/.test(compat.operationId??'')||current.steps.slice(0,6).some(old=>old.taskId===compat.taskId||old.operationId===compat.operationId)))fail('MULTI_RUNTIME_CLOSED_SUBSET_HISTORY_DENIED');
 return 1;
}
export function inspectCurrent13ClosedSubset({current,run,registry,receipt,releaseReceipt,budget,transport,processCleanup,brokerCleanup,nativeStopped,activeRunIds,sourceReportSha256,sourceRegistrySha256,authorized}){
 const step=current?.steps?.[2];
 if(authorized!==true||current?.kind!=='isolated-native-current13'||current.status!=='FAILED'||current.steps?.length!==6||current.steps.slice(0,2).some(value=>value.status!=='PASS')||current.steps.slice(3).some(value=>value.status!=='NOT_RUN'||value.runId)||registry.lease!==undefined||
  step?.key!=='minimax-claude-preferences'||step.runtimeProfileId!=='minimax_claude'||run?.id!==step.runId||run.issueId!==step.taskId||run.agentId!==step.agentId||run.companyId!==current.companyId||run.status!=='timed_out'||run.errorCode!=='timeout'||!run.finishedAt||run.resultJson?.stopReason!=='timeout'||run.resultJson?.timeoutFired!==true||run.resultJson?.effectiveTimeoutSec!==180||
  nativeStopped!==true||!Array.isArray(activeRunIds)||activeRunIds.length||transport?.runId!==run.id||transport.exitCode!==143||transport.signal!==null||transport.cancelled!==true||transport.outputUnknown!==false||processCleanup?.status!=='terminated'||brokerCleanup?.status!=='terminated'||
  receipt?.schemaVersion!==1||receipt.kind!=='known-closed-failed-current13-phase'||receipt.companyId!==current.companyId||receipt.rootTaskId!==current.rootTaskId||receipt.runId!==run.id||receipt.taskId!==step.taskId||receipt.operationId!==step.operationId||receipt.sourceReportSha256!==sourceReportSha256||receipt.budgetSpent!==10||receipt.hostAndBrokerTerminated!==true||receipt.nativeExecutionStopVerified!==true||receipt.logicalValidation!=='FAILED_CLOSED_EXCLUDE_FROM_POOL'||!controlReference(releaseReceipt)||
  !Array.isArray(budget)||budget.length!==10||!budget.some(ref=>ref.operationId===step.operationId&&ref.taskId===step.taskId&&ref.agentId===step.agentId))fail('MULTI_RUNTIME_CLOSED_SUBSET_PROOF_DENIED');
 return{schemaVersion:1,kind:'verified-closed-runtime-subset',companyId:current.companyId,rootTaskId:current.rootTaskId,taskId:step.taskId,agentId:step.agentId,operationId:step.operationId,runId:step.runId,
  releaseReceipt,sourceReportSha256,sourceRegistrySha256,budgetRecords:budget,poolEligibility:'EXCLUDED_FAILED_RUNTIME'};
}
export function projectCurrent13ClosedSubset(current,proof,{compatibilityStep}={}){
 const step=current?.steps?.[2];if(proof?.kind!=='verified-closed-runtime-subset'||proof.runId!==step?.runId||proof.operationId!==step.operationId||proof.companyId!==current.companyId||proof.rootTaskId!==current.rootTaskId||current.postExecutionSubsetContinuation)fail('MULTI_RUNTIME_CLOSED_SUBSET_PROOF_DENIED');
 const next=structuredClone(current);next.status='PARTIAL_VALIDATED';next.steps[2].status='FAILED_CLOSED';next.steps[2].runtimePoolEligibility='EXCLUDED_FAILED_RUNTIME';next.steps[2].failureReceipt=proof.releaseReceipt;
 delete next.errorCode;next.callsSpent=proof.budgetRecords.length;next.rootCallsSpent=proof.budgetRecords.length;next.budgetRecords=structuredClone(proof.budgetRecords);
 next.postExecutionSubsetContinuation={schemaVersion:1,kind:'operator-authorized-closed-runtime-subset',companyId:next.companyId,rootTaskId:next.rootTaskId,failedStepIndex:2,failedProfileId:'minimax_claude',taskId:step.taskId,agentId:step.agentId,runId:step.runId,operationId:step.operationId,
  sourceReportSha256:proof.sourceReportSha256,sourceRegistrySha256:proof.sourceRegistrySha256,releaseReceipt:proof.releaseReceipt,budgetUsedBefore:10,budgetUsedAfter:10,modelCallsAdded:0,poolEligibility:'EXCLUDED_FAILED_RUNTIME',budgetRecords:structuredClone(proof.budgetRecords)};
 if(compatibilityStep)next.steps.push(structuredClone(compatibilityStep));validateCurrent13ClosedSubsetHistory(next);return next;
}
export async function verifyCurrent13ClosedSubset({current,ports,root=ACCEPTANCE_ROOT,cwd,authorized=process.env.SUPER_AGENT_ALLOW_CLOSED_RUNTIME_SUBSET==='1'}){
 if(authorized!==true||['getRun','getActiveRuns','verifyNativeStopped'].some(key=>typeof ports?.[key]!=='function'))fail('MULTI_RUNTIME_CLOSED_SUBSET_AUTH_REQUIRED');
 const step=current.steps[2],registry=privateJson(root+'/registry.json'),relative='closed-phase-releases/'+step.operationId+'.json',releaseReceipt={file:relative,sha256:sha(fs.readFileSync(root+'/'+relative))},receipt=privateJson(root+'/'+relative);
 const read=ref=>{if(!controlReference(ref))fail('MULTI_RUNTIME_CLOSED_SUBSET_REFERENCE_DENIED');let file=root;for(const part of ref.file.split('/')){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())fail('MULTI_RUNTIME_CLOSED_SUBSET_REFERENCE_DENIED');}const stat=fs.lstatSync(file),bytes=fs.readFileSync(file);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||sha(bytes)!==ref.sha256)fail('MULTI_RUNTIME_CLOSED_SUBSET_REFERENCE_CHANGED');return bytes;};
 for(const ref of Object.values(receipt.artifactRefs??{}))read(ref);
 for(const name of ['report','registry','native','callLock','implementation','fixedTests','testing'])if(!receipt.artifactRefs?.[name])fail('MULTI_RUNTIME_CLOSED_SUBSET_REFERENCE_DENIED');
 const frozen=current.fixedInputs?.find(ref=>ref.file==='item-preferences.test.mjs'),testing=read(receipt.artifactRefs.testing).toString();
 if(!frozen||frozen.sha256!==receipt.artifactRefs.fixedTests.sha256||!/(?:#|ℹ) pass 5\b/.test(testing)||!/(?:#|ℹ) fail 0\b/.test(testing))fail('MULTI_RUNTIME_CLOSED_SUBSET_TEST_EVIDENCE_DENIED');
 const directory=root+'/transport/'+step.runId,transport=privateJson(directory+'/result.json');
 for(const stream of ['stdout','stderr'])if(sha(fs.readFileSync(directory+'/'+stream))!==transport[stream+'Sha256'])fail('MULTI_RUNTIME_CLOSED_SUBSET_OUTPUT_CHANGED');
 if(fs.existsSync(root+'/call.lock')||registry.lease!==undefined||cwd&&fs.existsSync(path.join(cwd,step.outputFile)))fail('MULTI_RUNTIME_CLOSED_SUBSET_UNEXPECTED_REPORT');
 const budget=fs.readdirSync(root+'/budget/'+current.rootTaskId).sort().map(name=>{const file=root+'/budget/'+current.rootTaskId+'/'+name,value=privateJson(file);if(name!==value.id+'.json')fail('MULTI_RUNTIME_CLOSED_SUBSET_BUDGET_CHANGED');return{operationId:value.id,taskId:value.taskId,agentId:value.agentId,role:value.role,sha256:sha(fs.readFileSync(file))};});
 for(const prior of current.budgetRecords??[])if(!budget.some(ref=>isDeepStrictEqual(ref,prior)))fail('MULTI_RUNTIME_CLOSED_SUBSET_BUDGET_CHANGED');
 return inspectCurrent13ClosedSubset({current,registry,run:await ports.getRun(step.runId),receipt,releaseReceipt,budget,transport,processCleanup:privateJson(directory+'/process-cleanup.json'),brokerCleanup:privateJson(directory+'/broker-process-cleanup.json'),nativeStopped:await ports.verifyNativeStopped(step.agentId),activeRunIds:await ports.getActiveRuns(),
  sourceReportSha256:sha(fs.readFileSync(root+'/multi-runtime-current13-acceptance.json')),sourceRegistrySha256:sha(fs.readFileSync(root+'/registry.json')),authorized});
}
async function verifyClosedRuntimeSubsetFiles({current,runs,budget,db,root=ACCEPTANCE_ROOT}){
 if(!validateCurrent13ClosedSubsetHistory(current))return;
 const step=current.steps[2],meta=current.postExecutionSubsetContinuation,run=runs.find(value=>value.id===step.runId),file=root+'/'+meta.releaseReceipt.file,bytes=fs.readFileSync(file),receipt=privateJson(file);
 if(sha(bytes)!==meta.releaseReceipt.sha256||receipt.kind!=='known-closed-failed-current13-phase'||receipt.runId!==step.runId||receipt.operationId!==step.operationId||receipt.taskId!==step.taskId||receipt.budgetSpent!==10||receipt.sourceReportSha256!==meta.sourceReportSha256||
  run?.status!=='timed_out'||run.errorCode!=='timeout'||run.resultJson?.stopReason!=='timeout'||run.resultJson?.effectiveTimeoutSec!==180||run.resultJson?.timeoutFired!==true)fail('MULTI_RUNTIME_CLOSED_SUBSET_HISTORY_CHANGED');
 for(const ref of Object.values(receipt.artifactRefs??{})){if(!controlReference(ref))fail('MULTI_RUNTIME_CLOSED_SUBSET_REFERENCE_DENIED');let cursor=root;for(const part of ref.file.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())fail('MULTI_RUNTIME_CLOSED_SUBSET_REFERENCE_DENIED');}if(sha(fs.readFileSync(cursor))!==ref.sha256)fail('MULTI_RUNTIME_CLOSED_SUBSET_REFERENCE_CHANGED');}
 for(const old of meta.budgetRecords??[])if(!budget.some(value=>['operationId','taskId','agentId','role','sha256'].every(key=>value[key]===old[key])))fail('MULTI_RUNTIME_CLOSED_SUBSET_BUDGET_CHANGED');
 const dir=root+'/transport/'+run.id,result=privateJson(dir+'/result.json');
 if(result.runId!==run.id||result.exitCode!==143||result.signal!==null||result.cancelled!==true||result.outputUnknown!==false||['process-cleanup.json','broker-process-cleanup.json'].some(name=>privateJson(dir+'/'+name).status!=='terminated')||fs.existsSync(root+'/call.lock'))fail('MULTI_RUNTIME_CLOSED_SUBSET_EXECUTION_OPEN');
 for(const stream of ['stdout','stderr'])if(sha(fs.readFileSync(dir+'/'+stream))!==result[stream+'Sha256'])fail('MULTI_RUNTIME_CLOSED_SUBSET_OUTPUT_CHANGED');
 const {agentExecutionsHaveStopped}=await import(P+'/@paperclipai/server/dist/services/agent-execution-stop.js');if(!await agentExecutionsHaveStopped(db,[step.agentId]))fail('MULTI_RUNTIME_CLOSED_SUBSET_EXECUTION_OPEN');
}
const controlReference=value=>value&&typeof value.file==='string'&&value.file.length<=512&&!value.file.startsWith('/')&&value.file.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..')&&/^[a-f0-9]{64}$/.test(value.sha256??'');
export function validateCurrent13PreclaimRepairHistory(current){
 const all=(current?.steps??[]).flatMap(step=>step.priorAttempts??[]),meta=current?.postExecutionPreclaimRepair;if(!all.length&&!meta)return 0;
 const step=current.steps?.[2],prior=step?.priorAttempts?.[0],proof=prior?.proof,uuid=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??'');
 if(all.length!==1||step.key!=='minimax-claude-preferences'||step.role!=='full-stack-engineer'||step.runtimeProfileId!=='minimax_claude'||step.priorAttempts.length!==1||
  meta?.schemaVersion!==1||meta.kind!=='known-unclaimed-preflight-repair'||meta.companyId!==current.companyId||meta.rootTaskId!==current.rootTaskId||meta.repairedStepIndex!==2||meta.taskId!==step.taskId||meta.agentId!==step.agentId||meta.role!==step.role||meta.runtimeProfileId!==step.runtimeProfileId||
  meta.fromOperationId!==prior.operationId||meta.fromRunId!==prior.runId||meta.newOperationId!==step.operationId||!uuid(prior.runId)||!uuid(prior.operationId)||!uuid(step.operationId)||prior.operationId===step.operationId||
  prior.taskId!==step.taskId||prior.agentId!==step.agentId||prior.role!==step.role||prior.runtimeProfileId!==step.runtimeProfileId||prior.status!=='FAILED_PRECLAIM'||proof?.kind!=='official-bootstrap-unclaimed'||proof.gateCode!=='ROLE_CLAUDE_GATE_SCOPE_DENIED'||proof.providerWorkStarted!==false||proof.claimed!==false||
  !controlReference(meta.releaseReceipt)||!controlReference(meta.native)||!controlReference(meta.permit)||!isDeepStrictEqual(meta.releaseReceipt,proof.releaseReceipt)||!isDeepStrictEqual(meta.native,proof.native)||!isDeepStrictEqual(meta.permit,proof.permit)||meta.stderrSha256!==proof.stderrSha256||
  !/^[a-f0-9]{64}$/.test(meta.sourceReportSha256??'')||!/^[a-f0-9]{64}$/.test(meta.sourceRegistrySha256??'')||!/^[a-f0-9]{64}$/.test(proof.stderrSha256??'')||meta.modelCallsAdded!==0||meta.budgetUsedBefore!==9||meta.budgetUsedAfter!==9||
  proof.budgetRecord?.operationId!==prior.operationId||proof.budgetRecord.taskId!==prior.taskId||proof.budgetRecord.agentId!==prior.agentId||proof.budgetRecord.role!==prior.role||!/^[a-f0-9]{64}$/.test(proof.budgetRecord.sha256??''))fail('MULTI_RUNTIME_PRECLAIM_HISTORY_DENIED');
 return 1;
}
export function inspectCurrent13PreclaimAttempt({current,registry,rootTask,task,agent,run,release,releaseRef,permit,permitRef,budget,markers,nativeStopped,activeRunIds,sourceReportSha256,sourceRegistrySha256,materialDigests,authorized}){
 const step=current?.steps?.[2],op=registry?.operations?.find(value=>value.id===step?.operationId);
 if(authorized!==true||current?.kind!=='isolated-native-current13'||current.status!=='FAILED'||current.sourceRoleCount!==13||current.steps.length!==6||current.steps.slice(0,2).some(value=>value.status!=='PASS')||current.steps.slice(3).some(value=>value.status!=='NOT_RUN'||value.runId)||
  (current.steps.flatMap(value=>value.priorAttempts??[])).length||registry.lease!==undefined||!isDeepStrictEqual(registry.team?.ids,current.agentIds)||rootTask?.id!==current.rootTaskId||rootTask.companyId!==current.companyId||rootTask.projectId!==current.projectId||rootTask.responsibleUserId!==registry.ownerId||taskInputRevision(rootTask)!==current.rootInputRevision||
  step.key!=='minimax-claude-preferences'||step.role!=='full-stack-engineer'||step.runtimeProfileId!=='minimax_claude'||agent?.id!==step.agentId||agent.companyId!==current.companyId||agent.role!==TEAM_ROLES[step.role].nativeRole||agent.reportsTo!==current.agentIds.architect||agent.adapterType!=='claude_local'||
  task?.id!==step.taskId||task.companyId!==current.companyId||task.projectId!==current.projectId||task.projectWorkspaceId!==current.workspaceId||task.parentId!==current.rootTaskId||task.responsibleUserId!==registry.ownerId||
  !op||op.agentId!==step.agentId||op.role!==step.role||op.taskId!==step.taskId||op.rootTaskId!==current.rootTaskId||taskInputRevision(task)!==op.inputRevision||!isDeepStrictEqual(op.taskRuntimeRoute,step.taskRuntimeRoute)||op.taskRuntimeRoute.profileId!=='minimax_claude'||
  run?.id!==step.runId||run.companyId!==current.companyId||run.issueId!==step.taskId||run.agentId!==step.agentId||run.responsibleUserId!==registry.ownerId||run.errorCode!=='adapter_failed'||nativeStopped!==true||!Array.isArray(activeRunIds)||activeRunIds.length)fail('MULTI_RUNTIME_PRECLAIM_REPAIR_DENIED');
 const closure=knownBootstrapClosure(run,markers);if(closure.gateCode!=='ROLE_CLAUDE_GATE_SCOPE_DENIED')fail('MULTI_RUNTIME_PRECLAIM_REPAIR_DENIED');
 const slot=budget.find(value=>value.operationId===step.operationId);
 if(!Array.isArray(budget)||budget.length!==9||current.callsSpent!==9||!slot||slot.taskId!==step.taskId||slot.agentId!==step.agentId||slot.role!==step.role||
  release?.schemaVersion!==1||release.kind!=='known-unstarted-current13-phase'||release.runId!==run.id||release.operationId!==step.operationId||release.taskId!==step.taskId||release.companyId!==current.companyId||release.rootTaskId!==current.rootTaskId||release.sourceReportSha256!==sourceReportSha256||release.modelCallsAdded!==0||release.providerWorkStarted!==false||release.gate?.claimed!==false||release.gate?.code!==closure.gateCode||release.budgetSpent!==9||
  !Array.isArray(release.budgetRecords)||release.budgetRecords.length!==budget.length||release.budgetRecords.some(ref=>!budget.some(value=>ref.file===value.operationId+'.json'&&ref.sha256===value.sha256))||!controlReference(releaseRef)||!controlReference(release.native)||
  permit?.runId!==run.id||permit.taskId!==step.taskId||permit.agentId!==step.agentId||permit.companyId!==current.companyId||permit.projectId!==current.projectId||permit.rootTaskId!==current.rootTaskId||permit.role!==step.role||permit.runtimeProfileId!=='minimax_claude'||permit.model!==RUNTIME_PROFILES.minimax_claude.model||permit.apiFallback!==false||
  permitRef?.sha256!==release.permitSha256||!controlReference(permitRef)||!Array.isArray(materialDigests)||!permit.materialFiles?.length||permit.materialFiles.some(ref=>!materialDigests.some(value=>value.path===ref.path&&value.sha256===ref.sha256))||!materialDigests.some(value=>value.instructions===true&&value.sha256===permit.materialSha256))fail('MULTI_RUNTIME_PRECLAIM_EVIDENCE_DENIED');
 return{schemaVersion:1,kind:'verified-current13-preclaim-attempt',companyId:current.companyId,rootTaskId:current.rootTaskId,taskId:step.taskId,agentId:step.agentId,role:step.role,runtimeProfileId:step.runtimeProfileId,
  operationId:step.operationId,runId:run.id,sourceReportSha256,sourceRegistrySha256,releaseReceipt:releaseRef,native:release.native,permit:permitRef,stderrSha256:sha(run.stderrExcerpt),budgetRecord:slot,budgetRecords:budget,closure};
}
export function projectCurrent13PreclaimRepair(current,proof,{newOperationId=randomUUID()}={}){
 const original=current?.steps?.[2];if(proof?.kind!=='verified-current13-preclaim-attempt'||proof.operationId!==original?.operationId||proof.runId!==original.runId||proof.companyId!==current.companyId||proof.rootTaskId!==current.rootTaskId||!/^[-a-f0-9]{36}$/.test(newOperationId)||newOperationId===original.operationId)fail('MULTI_RUNTIME_PRECLAIM_REPAIR_DENIED');
 const next=structuredClone(current),step=next.steps[2],{goal,priorAttempts,...old}=structuredClone(original);
 const refs={releaseReceipt:proof.releaseReceipt,native:proof.native,permit:proof.permit,stderrSha256:proof.stderrSha256};
 step.priorAttempts=[{...old,status:'FAILED_PRECLAIM',proof:{kind:'official-bootstrap-unclaimed',gateCode:'ROLE_CLAUDE_GATE_SCOPE_DENIED',providerWorkStarted:false,claimed:false,...refs,budgetRecord:proof.budgetRecord}}];
 step.operationId=newOperationId;step.retryOfOperationId=original.operationId;step.status='NOT_RUN';for(const key of ['runId','nativeStatus','nativeEvidence','taskRuntimeRoute','leaseReleased','wakeAttemptedAt','modelEvidence','proofs','implementationProof','testing','artifacts'])delete step[key];
 next.status='PARTIAL_VALIDATED';delete next.errorCode;next.callsSpent=proof.budgetRecords.length;next.rootCallsSpent=proof.budgetRecords.length;next.budgetRecords=structuredClone(proof.budgetRecords);
 next.postExecutionPreclaimRepair={schemaVersion:1,kind:'known-unclaimed-preflight-repair',companyId:next.companyId,rootTaskId:next.rootTaskId,taskId:step.taskId,agentId:step.agentId,role:step.role,runtimeProfileId:step.runtimeProfileId,repairedStepIndex:2,
  fromOperationId:proof.operationId,fromRunId:proof.runId,newOperationId,...refs,sourceReportSha256:proof.sourceReportSha256,sourceRegistrySha256:proof.sourceRegistrySha256,budgetUsedBefore:9,budgetUsedAfter:9,modelCallsAdded:0};
 validateCurrent13PreclaimRepairHistory(next);return next;
}
export async function verifyCurrent13PreclaimAttempt({current,ports,root=ACCEPTANCE_ROOT,cwd,sourceReportReference,authorized=process.env.SUPER_AGENT_REPAIR_CURRENT13_PRECLAIM==='1'}){
 if(authorized!==true||['getRun','getActiveRuns','verifyNativeStopped','getRootTask','getTask','getAgent'].some(key=>typeof ports?.[key]!=='function'))fail('MULTI_RUNTIME_PRECLAIM_REPAIR_AUTH_REQUIRED');
 const step=current?.steps?.[2],reportFile=root+'/multi-runtime-current13-acceptance.json',registryFile=root+'/registry.json',registry=privateJson(registryFile);
 const readRef=ref=>{if(!controlReference(ref))fail('MULTI_RUNTIME_PRECLAIM_PROOF_PATH_DENIED');let cursor=root;for(const part of ref.file.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())fail('MULTI_RUNTIME_PRECLAIM_PROOF_PATH_DENIED');}
  const stat=fs.lstatSync(cursor);if(!stat.isFile()||stat.nlink!==1||stat.size>1048576||(stat.mode&0o022))fail('MULTI_RUNTIME_PRECLAIM_PROOF_PATH_DENIED');const bytes=fs.readFileSync(cursor);if(sha(bytes)!==ref.sha256)fail('MULTI_RUNTIME_PRECLAIM_PROOF_CHANGED');return bytes;};
 const releaseFile='closed-phase-releases/'+step.operationId+'.json',releaseRef={file:releaseFile,sha256:sha(fs.readFileSync(root+'/'+releaseFile))},release=JSON.parse(readRef(releaseRef));
 for(const ref of [release.native,release.previousReport,release.previousRegistry])readRef(ref);
 if(release.previousReport.sha256!==release.sourceReportSha256||release.previousRegistry.sha256!==release.sourceRegistrySha256)fail('MULTI_RUNTIME_PRECLAIM_PROOF_CHANGED');
 const oldRegistry=JSON.parse(readRef(release.previousRegistry));if(!isDeepStrictEqual(oldRegistry.lease,release.lease)||oldRegistry.companyId!==current.companyId||oldRegistry.taskId!==current.rootTaskId)fail('MULTI_RUNTIME_PRECLAIM_RELEASE_CHANGED');
 const run=await ports.getRun(step.runId),task=await ports.getTask(step.taskId),agent=await ports.getAgent(step.agentId),rootTask=await ports.getRootTask();
 const permitRef={file:'permits/'+run.id+'.json',sha256:sha(fs.readFileSync(root+'/permits/'+run.id+'.json'))},permit=JSON.parse(readRef(permitRef)),materialDigests=[];
 const material=file=>{if(typeof file!=='string'||!path.isAbsolute(file)||path.normalize(file)!==file)fail('MULTI_RUNTIME_PRECLAIM_MATERIAL_DENIED');let cursor=path.parse(file).root;
  for(const part of file.slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())fail('MULTI_RUNTIME_PRECLAIM_MATERIAL_DENIED');}
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>262144||(stat.mode&0o022))fail('MULTI_RUNTIME_PRECLAIM_MATERIAL_DENIED');return sha(fs.readFileSync(file));};
 materialDigests.push({instructions:true,sha256:material(permit.instructionsFilePath)});
 for(const ref of permit.materialFiles??[]){if(!controlReference({file:ref.path,sha256:ref.sha256}))fail('MULTI_RUNTIME_PRECLAIM_MATERIAL_DENIED');materialDigests.push({path:ref.path,sha256:material(path.join(permit.materialRoot,ref.path))});}
 const directory=root+'/budget/'+current.rootTaskId,budget=fs.readdirSync(directory).sort().map(file=>{const bytes=fs.readFileSync(directory+'/'+file),value=privateJson(directory+'/'+file);if(file!==value.id+'.json')fail('MULTI_RUNTIME_PRECLAIM_BUDGET_DENIED');return{operationId:value.id,taskId:value.taskId,agentId:value.agentId,role:value.role,sha256:sha(bytes)};});
 if(fs.existsSync(root+'/call.lock')||registry.lease!==undefined)fail('MULTI_RUNTIME_PRECLAIM_EXECUTION_OPEN');
 const markers={claimExists:fs.existsSync(root+'/claims/'+run.id+'.json'),transportExists:fs.existsSync(root+'/transport/'+run.id),providerAuditExists:fs.existsSync(root+'/transport/'+run.id+'/proxy-audit'),callLockExists:fs.existsSync(root+'/call.lock')};
 const proof=inspectCurrent13PreclaimAttempt({current,registry,rootTask,task,agent,run,release,releaseRef,permit,permitRef,budget,markers,nativeStopped:await ports.verifyNativeStopped(step.agentId),activeRunIds:await ports.getActiveRuns(),
  sourceReportSha256:sha(sourceReportReference?readRef(sourceReportReference):fs.readFileSync(reportFile)),sourceRegistrySha256:sha(fs.readFileSync(registryFile)),materialDigests,authorized});
 if(cwd&&fs.existsSync(path.join(cwd,'item-preferences.mjs'))&&sha(fs.readFileSync(path.join(cwd,'item-preferences.mjs')))!==sha('export function normalizePreferences(value){return value;}\nexport function mergePreferences(current,patch){return patch;}\n'))fail('MULTI_RUNTIME_PRECLAIM_FUTURE_ARTIFACT_CHANGED');
 return proof;
}
function verifyCurrent13PreclaimHistoryFiles(current,runs,budget,root=ACCEPTANCE_ROOT){
 if(!validateCurrent13PreclaimRepairHistory(current))return;
 const prior=current.steps[2].priorAttempts[0],run=runs.find(row=>row.id===prior.runId),proof=prior.proof;
 if(!run||run.companyId!==current.companyId||run.issueId!==prior.taskId||run.agentId!==prior.agentId||run.errorCode!=='adapter_failed'||
  budget.find(record=>record.operationId===prior.operationId)?.sha256!==proof.budgetRecord.sha256)fail('MULTI_RUNTIME_PRECLAIM_HISTORY_CHANGED');
 const closed=knownBootstrapClosure(run,{claimExists:fs.existsSync(root+'/claims/'+run.id+'.json'),transportExists:fs.existsSync(root+'/transport/'+run.id),providerAuditExists:fs.existsSync(root+'/transport/'+run.id+'/proxy-audit'),callLockExists:fs.existsSync(root+'/call.lock')});
 if(closed.gateCode!==proof.gateCode||sha(run.stderrExcerpt)!==proof.stderrSha256)fail('MULTI_RUNTIME_PRECLAIM_HISTORY_CHANGED');
 for(const ref of [proof.releaseReceipt,proof.native,proof.permit]){let cursor=root;for(const component of ref.file.split('/')){cursor=path.join(cursor,component);if(fs.lstatSync(cursor).isSymbolicLink())fail('MULTI_RUNTIME_PRECLAIM_HISTORY_CHANGED');}if(sha(fs.readFileSync(cursor))!==ref.sha256)fail('MULTI_RUNTIME_PRECLAIM_HISTORY_CHANGED');}
 const permit=privateJson(root+'/'+proof.permit.file),release=privateJson(root+'/'+proof.releaseReceipt.file);
 if(permit.runId!==run.id||permit.taskId!==prior.taskId||permit.agentId!==prior.agentId||permit.runtimeProfileId!==prior.runtimeProfileId||release.runId!==run.id||release.operationId!==prior.operationId||release.permitSha256!==proof.permit.sha256||release.providerWorkStarted!==false||release.gate?.claimed!==false||release.gate.code!==proof.gateCode)fail('MULTI_RUNTIME_PRECLAIM_HISTORY_CHANGED');
}
/** Authorizes historical work-product continuation only; this never makes an old implementation eligible for the current runtime pool. */
export async function validateHistoricalPrefixSourceTransition({descriptor,before,after,bridgeBefore,bridgeAfter,diff,review,reviewOutput,regression,regressionStdout,regressionStderr,current,plan,implementations,permits,currentBindings,observedBindings}){
 const d=descriptor,hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),profiles=current.steps.slice(0,2).filter(step=>step.status==='PASS');
 if(d?.schemaVersion!==1||d.kind!=='historical-prefix-source-transition'||!/^[a-f0-9-]{36}$/.test(d.id??'')||d.companyId!==plan.companyId||d.rootTaskId!==plan.rootTaskId||!/^[a-f0-9]{40}$/.test(d.preparedCommit??'')||
  profiles.length!==2||d.passed?.length!==2||before?.schemaVersion!==1||after?.schemaVersion!==1||after.preparedCommit!==d.preparedCommit||
  !isDeepStrictEqual(Object.keys(before.profiles??{}).sort(),profiles.map(step=>step.runtimeProfileId).sort())||!isDeepStrictEqual(Object.keys(after.profiles??{}).sort(),Object.keys(before.profiles).sort()))fail('MULTI_RUNTIME_SOURCE_TRANSITION_SCOPE_DENIED');
 const {computeTaskRuntimeImplementationBinding}=await import('../../bridge/task-runtime-router.mjs'),changed=new Set();
 for(const step of profiles){const old=implementations[step.runId],record=d.passed.find(value=>value.runId===step.runId),a=before.profiles[step.runtimeProfileId],b=after.profiles[step.runtimeProfileId],permit=permits[step.runId];
  if(!record||record.taskId!==step.taskId||record.operationId!==step.operationId||record.profileId!==step.runtimeProfileId||record.sourceSha256!==old.sourceSha256||record.cliSha256!==old.cliSha256||
   permit?.schemaVersion!==1||permit.runId!==step.runId||permit.taskId!==step.taskId||permit.agentId!==step.agentId||permit.role!==step.role||permit.companyId!==plan.companyId||permit.projectId!==plan.projectId||permit.rootTaskId!==plan.rootTaskId||permit.model!==RUNTIME_PROFILES[step.runtimeProfileId].model||permit.apiFallback!==false||permit.executionPolicy?.executor!=='macos_native'||
   permit.projectContext?.repository?.hostPath!==null||permit.projectContext?.workspace?.hostPath!==null||permit.projectContext?.delivery?.maximumAction!=='artifact')fail('MULTI_RUNTIME_SOURCE_TRANSITION_SCOPE_DENIED');
  const original=computeTaskRuntimeImplementationBinding({profileId:step.runtimeProfileId,files:a.files,cliSha256:a.cliSha256}),prepared=computeTaskRuntimeImplementationBinding({profileId:step.runtimeProfileId,files:b.files,cliSha256:b.cliSha256});
  if(original.sourceSha256!==old.sourceSha256||original.cliSha256!==old.cliSha256||prepared.cliSha256!==old.cliSha256||prepared.cliSha256!==observedBindings[step.runtimeProfileId]?.cliSha256||
   prepared.sourceSha256!==currentBindings[step.runtimeProfileId]?.sourceSha256||prepared.sourceSha256!==observedBindings[step.runtimeProfileId]?.sourceSha256)fail('MULTI_RUNTIME_SOURCE_TRANSITION_BINDING_DENIED');
  for(const file of a.files){const next=b.files.find(value=>value.file===file.file);if(!next)fail('MULTI_RUNTIME_SOURCE_TRANSITION_FILES_DENIED');if(next.sha256!==file.sha256)changed.add(file.file);}
  const name='bridge/role-host-capabilities.mjs';if(a.files.find(file=>file.file===name)?.sha256!==sha(bridgeBefore)||b.files.find(file=>file.file===name)?.sha256!==sha(bridgeAfter))fail('MULTI_RUNTIME_SOURCE_TRANSITION_BLOB_DENIED');
 }
 if(changed.size!==1||!changed.has('bridge/role-host-capabilities.mjs')||sha(bridgeBefore)!==d.bridgeBefore.sha256||sha(bridgeAfter)!==d.bridgeAfter.sha256||sha(diff)!==d.diff.sha256||!diff.toString().includes('bridge/role-host-capabilities.mjs'))fail('MULTI_RUNTIME_SOURCE_TRANSITION_FILES_DENIED');
 const branch=bytes=>bytes.toString('utf8').split(/(?<=\n)/).filter(line=>line.includes("if(name==='host.project_inspect'&&!hasWorkspace)return"));
 const x=branch(bridgeBefore),y=branch(bridgeAfter);if(x.length!==1||y.length!==1||x[0]!==y[0])fail('MULTI_RUNTIME_SOURCE_TRANSITION_INSPECT_CHANGED');
 if(review?.schemaVersion!==1||review.kind!=='independent-source-transition-review'||review.preparedCommit!==d.preparedCommit||review.diffSha256!==d.diff.sha256||review.beforeManifestSha256!==d.beforeManifest.sha256||review.afterManifestSha256!==d.afterManifest.sha256||
  review.verdict!=='APPROVED'||!Array.isArray(review.findings)||review.findings.length||typeof review.reviewerId!=='string'||!review.reviewerId||typeof review.reviewerSessionId!=='string'||!review.reviewerSessionId||typeof review.developmentSessionId!=='string'||!review.developmentSessionId||review.reviewerSessionId===review.developmentSessionId||!hex(review.output?.sha256)||sha(reviewOutput)!==review.output.sha256||!reviewOutput.length)fail('MULTI_RUNTIME_SOURCE_TRANSITION_REVIEW_DENIED');
 const args=regression?.command,has=(a,b)=>Array.isArray(args)&&args.some((value,index)=>value===a&&args[index+1]===b);
 if(regression?.schemaVersion!==1||regression.kind!=='exact-offline-regression'||regression.preparedCommit!==d.preparedCommit||regression.afterManifestSha256!==d.afterManifest.sha256||regression.exitCode!==0||regression.signal!==null||regression.modelCalls!==0||
  !has('--network','none')||!has('--pull','never')||!has('--context','desktop-linux')||!/(?:^|\/)docker$/.test(args[0])||!args.includes('run')||!args.includes('node')||!args.some(value=>['node@sha256:a52166d89cfcc66ea62d10535ca712d161cece5d77ff4cfa758866b6b75ccb3f','sha256:a52166d89cfcc66ea62d10535ca712d161cece5d77ff4cfa758866b6b75ccb3f'].includes(value))||
  !args.includes('--read-only')||!args.includes('--test')||regression.fail!==0||!Number.isSafeInteger(regression.tests)||regression.tests<1||!Number.isSafeInteger(regression.pass)||regression.pass<1||!Number.isSafeInteger(regression.skipped)||regression.tests!==regression.pass+regression.skipped||sha(regressionStdout)!==regression.stdout?.sha256||sha(regressionStderr)!==regression.stderr?.sha256)fail('MULTI_RUNTIME_SOURCE_TRANSITION_REGRESSION_DENIED');
 for(const field of ['tests','pass','fail','skipped'])if(!new RegExp('(?:^|\\n)(?:ℹ|#) '+field+' '+regression[field]+'(?:\\r?\\n|$)').test(regressionStdout.toString()))fail('MULTI_RUNTIME_SOURCE_TRANSITION_REGRESSION_DENIED');
 return{kind:'historical-prefix-only',transitionId:d.id,preparedCommit:d.preparedCommit,runIds:profiles.map(step=>step.runId),poolEligibility:'HISTORICAL_ONLY'};
}

async function readHistoricalPrefixTransition({current,plan,implementations,permits,currentBindings,observedBindings}){
 const read=(file,{descriptor=false}={})=>{
  let cursor='/';for(const component of file.slice(1).split('/')){cursor=path.join(cursor,component);const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))fail('MULTI_RUNTIME_SOURCE_TRANSITION_OWNER_DENIED');}
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>4194304||descriptor&&(stat.mode&0o077))fail('MULTI_RUNTIME_SOURCE_TRANSITION_OWNER_DENIED');return fs.readFileSync(file);
 };
 const raw=read(SOURCE_TRANSITION,{descriptor:true}),descriptor=JSON.parse(raw),ref=value=>{if(typeof value?.file!=='string'||!value.file.startsWith('current13-source-transition/')||!value.file.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..'))fail('MULTI_RUNTIME_SOURCE_TRANSITION_PATH_DENIED');
  const bytes=read('/host-evidence/'+value.file);if(sha(bytes)!==value.sha256)fail('MULTI_RUNTIME_SOURCE_TRANSITION_PROOF_CHANGED');return bytes;};
 const review=JSON.parse(ref(descriptor.review)),regression=JSON.parse(ref(descriptor.regression));
 const result=await validateHistoricalPrefixSourceTransition({descriptor,before:JSON.parse(ref(descriptor.beforeManifest)),after:JSON.parse(ref(descriptor.afterManifest)),bridgeBefore:ref(descriptor.bridgeBefore),bridgeAfter:ref(descriptor.bridgeAfter),diff:ref(descriptor.diff),review,reviewOutput:ref(review.output),regression,
  regressionStdout:ref(regression.stdout),regressionStderr:ref(regression.stderr),current,plan,implementations,permits,currentBindings,observedBindings});
 if(sha(read(SOURCE_TRANSITION,{descriptor:true}))!==sha(raw))fail('MULTI_RUNTIME_SOURCE_TRANSITION_PROOF_CHANGED');
 const receipt={schemaVersion:1,...result,transitionSha256:sha(raw),originalImplementations:implementations,preparedBindings:currentBindings};
 archivePrivateSnapshot(ACCEPTANCE_ROOT+'/source-transition-continuations','continuation',Buffer.from(JSON.stringify(receipt)+'\n'));return receipt;
}

async function verifyCurrent13PrefixFiles({current,plan,registry,runs,budget,cwd,validation,allowHistoricalSourceTransition=false,allowClosedRuntimeSubset=false}){
 if(typeof validation?.validateRunEvidence!=='function'||!Array.isArray(validation.fixedInputs)||validation.fixedInputs.length!==4)fail('MULTI_RUNTIME_CURRENT13_VALIDATOR_REQUIRED');
 verifyCurrent13PreclaimHistoryFiles(current,runs,budget);
 if(validateCurrent13ClosedSubsetHistory(current)&&!allowClosedRuntimeSubset)fail('MULTI_RUNTIME_CLOSED_SUBSET_AUTH_REQUIRED');
 const settled=step=>step.status==='PASS'||allowClosedRuntimeSubset&&step.status==='FAILED_CLOSED';
 const allowedPreviousRuns=new Set([...plan.steps,...current.steps.filter(settled),...current.steps.flatMap(step=>step.priorAttempts??[])].map(step=>step.runId));
 const pendingEvidence=current.steps.filter(step=>!settled(step)).map(step=>({operationId:step.operationId,nativeRunIds:runs.filter(run=>run.contextSnapshot?.roleOperationId===step.operationId||run.issueId===step.taskId&&!allowedPreviousRuns.has(run.id)).map(run=>run.id),
  operationFile:fs.existsSync(ACCEPTANCE_ROOT+'/operations/'+step.operationId+'.json')||fs.existsSync('/paperclip/control/daily/tasks/'+step.taskId+'/managed-wake-'+step.operationId+'.json'),budgetSlot:budget.some(value=>value.operationId===step.operationId),orphanControl:false}));
 const knownRuns=new Set(runs.map(run=>run.id));
 for(const folder of ['permits','claims'])for(const name of fs.readdirSync(ACCEPTANCE_ROOT+'/'+folder)){
  const record=privateJson(ACCEPTANCE_ROOT+'/'+folder+'/'+name);for(const step of current.steps.filter(value=>!settled(value)))if(record.taskId===step.taskId&&!knownRuns.has(record.runId))pendingEvidence.find(value=>value.operationId===step.operationId).orphanControl=true;
 }
 for(const name of fs.readdirSync(ACCEPTANCE_ROOT+'/transport')){const file=ACCEPTANCE_ROOT+'/transport/'+name+'/request.json';if(!fs.existsSync(file))continue;const request=privateJson(file);
  for(const step of current.steps.filter(value=>!settled(value)))if(request.taskId===step.taskId&&!allowedPreviousRuns.has(request.runId))pendingEvidence.find(value=>value.operationId===step.operationId).orphanControl=true;}
 const prefix=validateCurrent13SuccessPrefix({current,plan,registry,runs,budget,pendingEvidence}),passed=current.steps.slice(0,prefix).filter(step=>step.status==='PASS');
 verifyCompletedFiles({...current,steps:passed},cwd);
 if(!isDeepStrictEqual(current.fixedInputs,validation.fixedInputs))fail('MULTI_RUNTIME_CURRENT13_FROZEN_INPUT_CHANGED');
 const controlBytes=ref=>{if(typeof ref?.file!=='string'||ref.file.startsWith('/')||!ref.file.split('/').every(value=>/^[a-zA-Z0-9_.-]+$/.test(value)&&value!=='.'&&value!=='..'))fail('MULTI_RUNTIME_CURRENT13_PROOF_PATH_DENIED');
  privateJson(ACCEPTANCE_ROOT+'/registry.json');let cursor=ACCEPTANCE_ROOT;for(const component of ref.file.split('/')){cursor=path.join(cursor,component);if(fs.lstatSync(cursor).isSymbolicLink())fail('MULTI_RUNTIME_CURRENT13_PROOF_PATH_DENIED');}
  const stat=fs.lstatSync(cursor);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077))fail('MULTI_RUNTIME_CURRENT13_PROOF_PATH_DENIED');
  const bytes=fs.readFileSync(cursor);if(bytes.length>4194304||sha(bytes)!==ref.sha256)fail('MULTI_RUNTIME_CURRENT13_PROOF_CHANGED');return bytes;};
 for(const ref of validation.fixedInputs){const file=path.join(cwd,ref.file);if(path.dirname(file)!==cwd||sha(fs.readFileSync(file))!==ref.sha256)fail('MULTI_RUNTIME_CURRENT13_FROZEN_INPUT_CHANGED');}
 const release=JSON.parse(controlBytes(current.postExecutionPrefixFinalization.releaseReceipt)),last=current.steps[current.postExecutionPrefixFinalization.successfulPrefix-1];
 if(release.schemaVersion!==1||release.kind!=='known-closed-current13-phase'||release.runId!==last.runId||release.taskId!==last.taskId||release.operationId!==last.operationId||release.modelCallsAdded!==0||release.budgetSpent!==current.postExecutionPrefixFinalization.budgetUsedAfter||
  release.sourceReportSha256!==current.postExecutionPrefixFinalization.sourceReportSha256||release.transportSha256!==sha(fs.readFileSync(ACCEPTANCE_ROOT+'/transport/'+last.runId+'/result.json'))||
  release.providerAuditSha256!==sha(fs.readFileSync(ACCEPTANCE_ROOT+'/transport/'+last.runId+'/proxy-audit/provider.jsonl')))fail('MULTI_RUNTIME_CURRENT13_RELEASE_PROOF_DENIED');
 const {taskRuntimeImplementationFiles,computeTaskRuntimeImplementationBinding}=await import('../../bridge/task-runtime-router.mjs'),sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
 const observations=privateJson('/host-evidence/runtime-implementations.json'),captured=Date.parse(observations.capturedAt);
 if(observations.schemaVersion!==1||observations.kind!=='macos-runtime-implementations'||observations.hostPlatform!=='darwin'||!Number.isFinite(captured)||captured>Date.now()+5000||Date.now()-captured>300000)fail('MULTI_RUNTIME_CURRENT13_IMPLEMENTATION_STALE');
 const implementations={},permits={},currentBindings={};let changed=false;
 for(const step of passed){
  const dir=ACCEPTANCE_ROOT+'/transport/'+step.runId,implementation=privateJson(dir+'/implementation-proof.json'),events=fs.readFileSync(dir+'/proxy-audit/provider.jsonl','utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  validation.validateRunEvidence({step,run:runs.find(run=>run.id===step.runId),transport:privateJson(dir+'/result.json'),processCleanup:privateJson(dir+'/process-cleanup.json'),brokerCleanup:privateJson(dir+'/broker-process-cleanup.json'),implementation,providerEvents:events});
  const observed=observations.bindings?.[step.runtimeProfileId],binding=computeTaskRuntimeImplementationBinding({profileId:step.runtimeProfileId,cliSha256:observed?.cliSha256,
   files:taskRuntimeImplementationFiles(step.runtimeProfileId).map(file=>({file,sha256:sha(fs.readFileSync(path.join(sourceRoot,file)))}))});
  if(observed?.sourceSha256!==binding.sourceSha256||implementation.cliSha256!==binding.cliSha256)fail('MULTI_RUNTIME_CURRENT13_IMPLEMENTATION_CHANGED');
  implementations[step.runId]=implementation;permits[step.runId]=privateJson(ACCEPTANCE_ROOT+'/permits/'+step.runId+'.json');currentBindings[step.runtimeProfileId]=binding;
  if(implementation.sourceSha256!==binding.sourceSha256){if(!current.steps.slice(0,2).some(original=>original.runId===step.runId))fail('MULTI_RUNTIME_CURRENT13_IMPLEMENTATION_CHANGED');changed=true;}
  const expected=step.key==='fullstack-feature'?[8]:step.key==='backend-transfer'?[8,4]:step.key==='minimax-claude-preferences'?[5]:step.role==='qa'||step.key==='current-source-minimax-compatibility'?[8,4,5]:[];
  if(step.testing?.length!==expected.length)fail('MULTI_RUNTIME_CURRENT13_TEST_EVIDENCE_MISSING');
  for(const [index,check]of (step.testing??[]).entries()){const out=controlBytes(check.stdout).toString();controlBytes(check.stderr);
   if(check.exitCode!==0||check.signal!==null||check.count!==expected[index]||!new RegExp('# pass '+check.count+'\\b').test(out)||!/# fail 0\b/.test(out))fail('MULTI_RUNTIME_CURRENT13_TEST_EVIDENCE_FAILED');}
 }
 if(changed){if(!allowHistoricalSourceTransition||!fs.existsSync(SOURCE_TRANSITION))fail('MULTI_RUNTIME_CURRENT13_IMPLEMENTATION_CHANGED');
  await readHistoricalPrefixTransition({current:{...current,steps:current.steps.slice(0,2)},plan,implementations,permits,currentBindings,observedBindings:observations.bindings});}
 const {agentExecutionsHaveStopped}=await import(P+'/@paperclipai/server/dist/services/agent-execution-stop.js');
 return{prefix,passedAgentIds:[...new Set(passed.map(step=>step.agentId))],agentExecutionsHaveStopped};
}
export function verifyCompletedFiles(plan,cwd,{root=ACCEPTANCE_ROOT}={}){
 const readArtifact=relative=>{
  if(typeof relative!=='string'||relative.startsWith('/')||!relative.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..'))fail('MULTI_RUNTIME_COMPLETED_ARTIFACT_DENIED');
  let cursor=cwd;for(const part of relative.split('/')){cursor+='/'+part;if(fs.lstatSync(cursor).isSymbolicLink())fail('MULTI_RUNTIME_COMPLETED_ARTIFACT_DENIED');}
  const stat=fs.lstatSync(cursor);if(!stat.isFile()||stat.nlink!==1||stat.size>131072)fail('MULTI_RUNTIME_COMPLETED_ARTIFACT_DENIED');return fs.readFileSync(cursor);
 };
 for(const step of plan.steps){
  const dir=root+'/transport/'+step.runId,result=privateJson(dir+'/result.json'),proof=privateJson(dir+'/native-proof.json');
  if(result.runId!==step.runId||result.exitCode!==0||result.signal!==null||result.timedOut!==false||result.cancelled!==false||result.outputUnknown!==false||
   proof.runId!==step.runId||proof.executor!=='macos_native'||proof.platform!=='darwin'||
   (proof.runtimeProfileId??'codex_subscription')!==step.runtimeProfileId||
   ['process-cleanup.json','broker-process-cleanup.json'].some(file=>privateJson(dir+'/'+file).status!=='terminated'))fail('MULTI_RUNTIME_COMPLETED_HOST_PROOF_DENIED');
  for(const stream of ['stdout','stderr'])if(sha(fs.readFileSync(dir+'/'+stream))!==result[stream+'Sha256'])fail('MULTI_RUNTIME_COMPLETED_OUTPUT_CHANGED');
  for(const ref of step.artifacts)if(ref.taskId!==step.taskId||ref.runId!==step.runId||sha(readArtifact(ref.file))!==ref.sha256)fail('MULTI_RUNTIME_COMPLETED_ARTIFACT_CHANGED');
 }
 return readArtifact('csv.test.mjs');
}
export function projectCompletedRosterMigration({plan,registry,newAgentId,entry,migrationId,sourcePlanSha256,sourceRegistrySha256,budget}){
 const role='full-stack-engineer',oldRoles=Object.keys(TEAM_ROLES).filter(key=>key!==role);
 if(!TEAM_ROLES[role]||oldRoles.length!==12||Object.keys(plan.agentIds??{}).length!==12||oldRoles.some(key=>plan.agentIds[key]!==registry.team?.ids?.[key])||registry.team.ids[role]||
  !/^[a-f0-9-]{36}$/.test(newAgentId)||Object.values(plan.agentIds).includes(newAgentId)||entry?.profile?.agentId!==newAgentId||entry.profile.role!==role||entry.profile.projectId!==plan.projectId)fail('MULTI_RUNTIME_ROSTER_MIGRATION_DENIED');
 const history={schemaVersion:1,kind:'historical-twelve-role-roster',migrationId,companyId:plan.companyId,rootTaskId:plan.rootTaskId,agentIds:structuredClone(plan.agentIds),
  sourcePlanSha256,sourceRegistrySha256,budget:structuredClone(budget),evidenceScope:'original-source-only'};
 const nextPlan=structuredClone(plan),nextRegistry=structuredClone(registry);
 nextPlan.rosterHistory=[...(nextPlan.rosterHistory??[]),history];nextPlan.agentIds[role]=newAgentId;nextPlan.runtimeAssignments[role]='codex_subscription';
 nextRegistry.rosterHistory=[...(nextRegistry.rosterHistory??[]),history];nextRegistry.team.ids[role]=newAgentId;nextRegistry.runtimeAssignments[role]='codex_subscription';nextRegistry.agents.push(structuredClone(entry));
 const migration={schemaVersion:1,id:migrationId,fromRoleCount:12,toRoleCount:13,newRole:role,newAgentId,status:'CONFIGURED',businessAcceptance:'NOT_RUN',oldSourceEvidence:'historical-only'};
 nextPlan.rosterMigration=migration;nextRegistry.rosterMigration=migration;return{plan:nextPlan,registry:nextRegistry};
}
export function assertAcceptanceTaskNamespace({plan,registry,root,task,step,expected,scopeClosed}){
 const owner=registry.ownerId,rootId=plan.rootTaskId,isRoot=step.taskId===rootId,target=step.agentId??null,user=step.userId??(target===null?owner:null);
 const op=registry.operations?.find(value=>value.id===step.operationId);
 if(root?.id!==rootId||root.companyId!==plan.companyId||root.projectId!==plan.projectId||root.responsibleUserId!==owner||taskInputRevision(root)!==plan.rootInputRevision||
  task?.id!==step.taskId||task.companyId!==plan.companyId||task.projectId!==plan.projectId||task.projectWorkspaceId!==plan.workspaceId||task.responsibleUserId!==owner||
  task.parentId!==(isRoot?null:rootId)||taskInputRevision(task)!==expected?.inputRevision||!registry.tasks?.includes(task.id)||(registry.taskRoots?.[task.id]??task.id)!==rootId||
  (!isRoot&&(root.status!=='in_review'||root.assigneeUserId!==owner||root.assigneeAgentId!=null))||
  !op||op.kind!=='run'||op.taskId!==task.id||(op.rootTaskId??op.taskId)!==rootId||op.role!==step.role||op.inputRevision!==expected.inputRevision||
  op.rootInputRevision!==undefined&&op.rootInputRevision!==plan.rootInputRevision||target!==null&&op.agentId!==target||
  (target!==null&&registry.team?.ids?.[step.role]!==target)||target===null&&user!==owner||
  task.assigneeUserId!=null&&task.assigneeUserId!==owner||target!==null&&task.assigneeAgentId!=null&&task.assigneeAgentId!==target&&op.taskRuntimeRoute?.handoff?.handoffKind!=='role-transfer'||
  target===null&&task.assigneeAgentId!=null&&task.assigneeAgentId!==op.agentId||
  !Object.hasOwn(expected??{},'expectedAgentId')||!Object.hasOwn(expected??{},'expectedAssigneeUserId')||task.assigneeAgentId!==(expected.expectedAgentId??null)||task.assigneeUserId!==(expected.expectedAssigneeUserId??null)||
  expected.expectedStatus!==undefined&&task.status!==expected.expectedStatus||!['todo','in_progress','in_review'].includes(task.status)||scopeClosed?.taskId!==task.id||scopeClosed.closed!==true||!Array.isArray(scopeClosed.activeRunIds)||scopeClosed.activeRunIds.length)fail('MULTI_RUNTIME_OWNER_CAS_DENIED');
 return{op,target,user};
}
export function assertAcceptanceTaskBody({task,plan,ownerId,step,title,description}){
 if(!task||task.id!==step.taskId||task.companyId!==plan.companyId||task.projectId!==plan.projectId||task.projectWorkspaceId!==plan.workspaceId||task.parentId!==plan.rootTaskId||task.responsibleUserId!==ownerId||task.title!==title||task.description!==description)fail('MULTI_RUNTIME_CASE_BODY_CHANGED');return task;
}
export function assertAcceptanceRoleTransfer({plan,registry,task,step,expected,scopeClosed,previousRun,route,budgetUsed}){
 const h=route?.handoff,oldRole=h?.fromRole,oldAgent=h?.fromAgentId,previous=registry.taskRuntimeRoutes?.find(value=>value.id===h?.previousRouteId);
 if(h?.handoffKind!=='role-transfer'||route.operationId!==step.operationId||route.taskId!==step.taskId||route.rootTaskId!==plan.rootTaskId||route.agentId!==step.agentId||route.role!==step.role||
  route.inputRevision!==expected.inputRevision||!isDeepStrictEqual(registry.operations.find(value=>value.id===step.operationId)?.taskRuntimeRoute,route)||
  !previous||previous.agentId!==oldAgent||previous.role!==oldRole||previous.taskId!==task.id||previous.operationId===step.operationId||registry.team.ids[oldRole]!==oldAgent||
  !previousRun||previousRun.id!==h.fromRunId||previousRun.issueId!==task.id||previousRun.agentId!==oldAgent||previousRun.companyId!==plan.companyId||previousRun.status!=='succeeded'||!previousRun.finishedAt||
  scopeClosed.taskId!==task.id||scopeClosed.agentId!==oldAgent||scopeClosed.closed!==true||budgetUsed!==h.budgetUsedBefore||
  !(task.assigneeAgentId===oldAgent&&task.assigneeUserId==null||task.assigneeAgentId==null&&task.assigneeUserId===registry.ownerId&&task.status==='in_review'))fail('MULTI_RUNTIME_ROLE_TRANSFER_DENIED');
 return true;
}

/** A controlled DB transaction plus private control-file CAS; a failed/unknown batch leaves its recovery intent. */
async function migrateCompletedRoster({plan,registry,db,s,o,cwd,ownerId,providerHome,refs}){
 const role='full-stack-engineer',definition=TEAM_ROLES[role];if(!definition)fail('MULTI_RUNTIME_THIRTEEN_ROLE_SOURCE_REQUIRED');
 const reportFile=ACCEPTANCE_ROOT+'/multi-runtime-acceptance.json',registryFile=ACCEPTANCE_ROOT+'/registry.json',intentFile=ACCEPTANCE_ROOT+'/roster-migration.intent.json';
 if(fs.existsSync(intentFile))fail('MULTI_RUNTIME_ROSTER_MIGRATION_RECONCILIATION_REQUIRED');
 const originalRegistry=fs.readFileSync(registryFile),originalPlan=fs.readFileSync(reportFile),sourcePlanSha256=sha(originalPlan),sourceRegistrySha256=sha(originalRegistry);
 const normalize=value=>({...value,steps:value.steps.map(({goal,...step})=>step)});
 if(!isDeepStrictEqual(normalize(plan),normalize(JSON.parse(originalPlan))))fail('MULTI_RUNTIME_ROSTER_MIGRATION_SOURCE_CHANGED');
 const migrationId=randomUUID(),newAgentId=randomUUID(),instructionName=newAgentId+'.md',capabilityName=migrationId+'.md';
 const instructions=roleInstructions(role,{taskRuntimeRouting:true}),capabilities=renderRoleCapabilitiesMarkdown(role);
 const binding=isolatedRuntimeBinding({role,id:newAgentId,projectId:plan.projectId,cwd,providerHome,runtimeProfileId:'codex_subscription',refs,instructionsFilePath:ACCEPTANCE_ROOT+'/materials/'+instructionName});
 const entry={profile:binding.profile,manifest:{schemaVersion:1,project:binding.profile.projectKey,role,instructionsFilePath:instructionName,requiredReferences:[capabilityName],
  files:[{path:instructionName,sha256:sha(instructions)},{path:capabilityName,sha256:sha(capabilities)}]}};
 const directory=ACCEPTANCE_ROOT+'/budget/'+plan.rootTaskId,budget=fs.readdirSync(directory).sort().map(file=>({file,sha256:sha(fs.readFileSync(directory+'/'+file))}));
 const projected=projectCompletedRosterMigration({plan,registry,newAgentId,entry,migrationId,sourcePlanSha256,sourceRegistrySha256,budget});
 archivePrivateSnapshot(ACCEPTANCE_ROOT+'/roster-history','plan',originalPlan);archivePrivateSnapshot(ACCEPTANCE_ROOT+'/roster-history','registry',originalRegistry);
 for(const [name,text]of [[instructionName,instructions],[capabilityName,capabilities]])fs.writeFileSync(ACCEPTANCE_ROOT+'/materials/'+name,text,{flag:'wx',mode:0o600});
 const lock=ACCEPTANCE_ROOT+'/registry.control.lock',fd=fs.openSync(lock,'wx',0o600),lockIdentity=fs.fstatSync(fd);let published=false;
 const intent={schemaVersion:1,id:migrationId,state:'pending',companyId:plan.companyId,rootTaskId:plan.rootTaskId,newAgentId,sourcePlanSha256,sourceRegistrySha256,
  materialFiles:entry.manifest.files,budget,createdAt:new Date().toISOString()};
 try{
  writeControl(intentFile,intent);
  await db.transaction(async tx=>{
   const [root]=await tx.select().from(s.issues).where(o.eq(s.issues.id,plan.rootTaskId)).for('update');
   const agents=await tx.select({id:s.agents.id}).from(s.agents).where(o.eq(s.agents.companyId,plan.companyId)),active=await tx.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
   if(!root||taskInputRevision(root)!==plan.rootInputRevision||root.responsibleUserId!==ownerId||agents.length!==12||agents.some(agent=>!Object.values(plan.agentIds).includes(agent.id))||active.length||fs.existsSync(ACCEPTANCE_ROOT+'/call.lock')||
    sha(fs.readFileSync(registryFile))!==sourceRegistrySha256||sha(fs.readFileSync(reportFile))!==sourcePlanSha256)fail('MULTI_RUNTIME_ROSTER_MIGRATION_CAS_CHANGED');
   await tx.insert(s.agents).values({id:newAgentId,companyId:plan.companyId,name:definition.name,title:definition.name,role:definition.nativeRole,reportsTo:plan.agentIds.architect,status:'idle',
    capabilities:definition.duty,permissions:rolePermissions(role),adapterType:binding.adapterType,adapterConfig:binding.adapterConfig,runtimeConfig:binding.runtimeConfig,
    metadata:{isolatedRosterMigrationId:migrationId,desiredSkillNames:roleSkillNames({role}),capabilityIds:resolveRoleCapabilities({role}).capabilityIds,businessAcceptance:'NOT_RUN'}});
   const {agentIdentityService}=await import(P+'/@paperclipai/server/dist/services/agent-identity.js');await agentIdentityService(tx).ensureAgentIdentity(plan.companyId,newAgentId);
   writeControl(registryFile,projected.registry);writeControl(reportFile,normalize(projected.plan));published=true;
   await tx.insert(s.activityLog).values({companyId:plan.companyId,actorType:'user',actorId:ownerId,action:'isolated.roster.migrated',entityType:'agent',entityId:newAgentId,
    details:{migrationId,rootTaskId:plan.rootTaskId,oldRoleCount:12,newRoleCount:13,sourcePlanSha256,sourceRegistrySha256,budgetCount:budget.length,businessAcceptance:'NOT_RUN'}});
  });
  writeControl(intentFile,{...intent,state:'complete',registrySha256:sha(fs.readFileSync(registryFile)),planSha256:sha(fs.readFileSync(reportFile)),completedAt:new Date().toISOString()});
  Object.assign(plan,projected.plan);return projected.registry;
 }catch(error){
  if(published){const [created]=await db.select({id:s.agents.id}).from(s.agents).where(o.eq(s.agents.id,newAgentId));
   if(!created&&isDeepStrictEqual(privateJson(registryFile),projected.registry)&&isDeepStrictEqual(privateJson(reportFile),normalize(projected.plan))){restorePrivateBytes(registryFile,originalRegistry);restorePrivateBytes(reportFile,originalPlan);}}
  throw error;
 }finally{fs.closeSync(fd);const current=fs.lstatSync(lock);if(current.ino!==lockIdentity.ino||current.dev!==lockIdentity.dev)fail('MULTI_RUNTIME_ROSTER_LOCK_CHANGED');fs.unlinkSync(lock);}
}

/** Per-run controller selection; this does not edit the all-Codex role defaults. Values are secret references, never keys. */
export function isolatedRuntimeBinding({role,id,projectId,cwd,providerHome,runtimeProfileId,refs,instructionsFilePath}){
 const runtime=Object.hasOwn(RUNTIME_PROFILES,runtimeProfileId)?RUNTIME_PROFILES[runtimeProfileId]:null;
 if(!runtime||!TEAM_ROLES[role])fail('MULTI_RUNTIME_ROUTE_DENIED');
 const api=runtime.runtime!=='codex',claude=runtime.runtime==='claude',env={SUPER_AGENT_ROLE_ENABLED:'true',SUPER_AGENT_ROLE_AGENT_ID:id};
 if(api){if(!refs?.[runtime.provider])fail('MULTI_RUNTIME_PROVIDER_REF_REQUIRED');env.SUPER_AGENT_ROLE_PROVIDER_API_KEY=refs[runtime.provider];
  if(claude)env.CLAUDE_CONFIG_DIR=ACCEPTANCE_ROOT+'/claude-clients/'+id+'/config';else env.OPENCODE_CONFIG=ACCEPTANCE_ROOT+'/opencode-clients/'+id+'/config.json';}
 else env.CODEX_HOME=providerHome;
 return{profile:{projectId,projectKey:'isolated-multi-runtime',agentId:id,role,engine:runtime.adapterType,model:runtime.model,reasoningEffort:runtime.reasoningEffort,
   ...(api?{dangerouslySkipPermissions:true}:{dangerouslyBypassApprovalsAndSandbox:true}),sandbox:'none',executionPolicy:MACOS_NATIVE_EXECUTION_POLICY,tools:['read_materials','read_sources','shell','apply_patch','apps','plugins']},
  adapterType:runtime.adapterType,adapterConfig:{engine:'cli',command:'/opt/super-agent/bin/'+runtime.runtime,cwd,instructionsFilePath,model:runtime.model,
   ...(api?{dangerouslySkipPermissions:true,...(claude?{maxTurnsPerRun:64,effort:'',chrome:false}:{})}:{modelReasoningEffort:'low',search:true,dangerouslyBypassApprovalsAndSandbox:true,dangerouslyBypassSandbox:true}),extraArgs:[],timeoutSec:180,env},
  runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:true,maxConcurrentRuns:1},aiConnection:null}};
}

/** Disposable migrated Native database. No installed adapter is replaced by a stub. */
export async function createMultiRuntimeNativeFixture(plan,input,{resumeKnownBootstrap=false,resumeCompleted=false,resumeCurrent13=false,current13,allowHistoricalSourceTransition=false,allowClosedRuntimeSubset=false,migrateRoster=false}={}){
 if(process.platform!=='linux'||process.getuid()!==0||process.env.SUPER_AGENT_ISOLATED_MULTI_RUNTIME!=='1')fail('MULTI_RUNTIME_ISOLATED_CONTAINER_REQUIRED');
 if(resumeKnownBootstrap&&resumeCompleted)fail('MULTI_RUNTIME_RESUME_MODE_DENIED');
 if(resumeCurrent13&&!resumeCompleted)fail('MULTI_RUNTIME_RESUME_MODE_DENIED');
 const existing=resumeKnownBootstrap||resumeCompleted;
 if(fs.existsSync(ACCEPTANCE_ROOT+'/registry.json')!==existing)fail('MULTI_RUNTIME_EXISTING_CONTROL_DENIED');
 const shared='/shared-admission/admission.sqlite',stat=fs.lstatSync(shared);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))fail('MULTI_RUNTIME_SHARED_ADMISSION_REQUIRED');
 fs.mkdirSync(ACCEPTANCE_ROOT,{recursive:true,mode:0o700});
 if(!existing)fs.writeFileSync(ACCEPTANCE_ROOT+'/.multi-runtime-owner',plan.companyId,{flag:'wx',mode:0o600});
 process.env.SUPER_AGENT_ROLE_RUNTIME_ENABLED='true';process.env.SUPER_AGENT_TEAM_COORDINATOR_ENABLED='false';
 const s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js');
 const connectionString=process.env.SUPER_AGENT_ISOLATED_DATABASE_URL;
 if(connectionString!=='postgres://postgres@127.0.0.1:5432/sa_multi_runtime_acceptance')fail('MULTI_RUNTIME_ISOLATED_DATABASE_REQUIRED');
 // Operator supplies a disposable, network-isolated Postgres namespace. Never migrate the live database.
 if(!existing)await s.applyPendingMigrations(connectionString);
 const pg={connectionString,cleanup:()=>s.closeRegisteredClients(connectionString)},db=s.createDb(connectionString);
 const {heartbeatService}=await import(P+'/@paperclipai/server/dist/services/heartbeat.js');
 const {secretService}=await import(P+'/@paperclipai/server/dist/services/secrets.js');
 const heartbeat=heartbeatService(db),secrets=secretService(db),ownerId=input.ownerId;
 if(typeof ownerId!=='string'||!ownerId.trim()||ownerId.length>256)fail('MULTI_RUNTIME_OWNER_REQUIRED');
 const cwd='/paperclip/instances/default/projects/'+plan.companyId+'/'+plan.projectId+'/_default';
 let registry=existing?privateJson(ACCEPTANCE_ROOT+'/registry.json'):null,bootstrapRecovery;
 if(resumeCompleted){
  if(fs.existsSync(ACCEPTANCE_ROOT+'/roster-migration.intent.json')&&privateJson(ACCEPTANCE_ROOT+'/roster-migration.intent.json').state!=='complete')fail('MULTI_RUNTIME_ROSTER_MIGRATION_RECONCILIATION_REQUIRED');
  if(registry.ownerId!==ownerId||fs.readFileSync(ACCEPTANCE_ROOT+'/.multi-runtime-owner','utf8')!==plan.companyId||!fs.existsSync(ACCEPTANCE_ROOT+'/runtime-secrets/controller-master.json'))fail('MULTI_RUNTIME_COMPLETED_OWNER_DENIED');
  const rootTask=(await db.select().from(s.issues).where(o.eq(s.issues.id,plan.rootTaskId)))[0],agents=await db.select().from(s.agents).where(o.eq(s.agents.companyId,plan.companyId));
  const runs=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.companyId,plan.companyId)),directory=ACCEPTANCE_ROOT+'/budget/'+plan.rootTaskId;
  const budget=fs.readdirSync(directory).map(name=>{if(!/^[a-f0-9-]{36}\.json$/.test(name))fail('MULTI_RUNTIME_COMPLETED_BUDGET_DENIED');const bytes=fs.readFileSync(directory+'/'+name),value=privateJson(directory+'/'+name);if(value.id!==name.slice(0,-5))fail('MULTI_RUNTIME_COMPLETED_BUDGET_DENIED');return{...value,operationId:value.id,sha256:sha(bytes)};});
  validateCompletedMultiRuntimeState({plan,registry,rootTask,agents,runs,budget,activeRunIds:runs.filter(run=>['running','queued','scheduled_retry'].includes(run.status)).map(run=>run.id),callLock:fs.existsSync(ACCEPTANCE_ROOT+'/call.lock'),
   retainedClosures:fs.existsSync(ACCEPTANCE_ROOT+'/bootstrap-closure.json')?[privateJson(ACCEPTANCE_ROOT+'/bootstrap-closure.json')]:[]});
  if(budget.length>plan.callsSpent){
   const current=privateJson(ACCEPTANCE_ROOT+'/multi-runtime-current13-acceptance.json');
   verifyCurrent13PreclaimHistoryFiles(current,runs,budget);
   const subset=validateCurrent13ClosedSubsetHistory(current);if(subset){if(!allowClosedRuntimeSubset)fail('MULTI_RUNTIME_CLOSED_SUBSET_AUTH_REQUIRED');await verifyClosedRuntimeSubsetFiles({current,runs,budget,db});}
   if(resumeCurrent13){
    const sourceRegistrySha256=current.postExecutionSubsetContinuation?.sourceRegistrySha256??current.postExecutionPreclaimRepair?.sourceRegistrySha256??current.postExecutionPrefixFinalization?.sourceRegistrySha256;
    const anchorBudget=current.postExecutionSubsetContinuation?.budgetUsedAfter??current.postExecutionPreclaimRepair?.budgetUsedAfter??current.postExecutionPrefixFinalization?.budgetUsedAfter;
    if(budget.length===anchorBudget&&sourceRegistrySha256!==sha(fs.readFileSync(ACCEPTANCE_ROOT+'/registry.json')))fail('MULTI_RUNTIME_CURRENT13_REGISTRY_CHANGED');
    const verified=await verifyCurrent13PrefixFiles({current,plan,registry,runs,budget,cwd,validation:current13,allowHistoricalSourceTransition:allowHistoricalSourceTransition===true,allowClosedRuntimeSubset:allowClosedRuntimeSubset===true});
    if(!await verified.agentExecutionsHaveStopped(db,verified.passedAgentIds))fail('MULTI_RUNTIME_CURRENT13_EXECUTION_OPEN');
   }else if(current.schemaVersion!==1||!['PASS',...(subset?['COMPLETED_WITH_FAILURES']:[])].includes(current.status)||current.companyId!==plan.companyId||current.projectId!==plan.projectId||current.rootTaskId!==plan.rootTaskId||
    !isDeepStrictEqual(current.agentIds,registry.team.ids)||!Array.isArray(current.steps)||!current.steps.length||current.steps.some(step=>!(subset&&step.status==='FAILED_CLOSED')&&(step.status!=='PASS'||!runs.some(run=>run.id===step.runId&&run.status==='succeeded'&&run.issueId===step.taskId&&run.agentId===step.agentId))))fail('MULTI_RUNTIME_CURRENT_MATRIX_UNACCEPTED');
   if(!resumeCurrent13)verifyCompletedFiles({...current,steps:current.steps.filter(step=>step.status==='PASS')},cwd);
   const accepted=new Set([...plan.steps,...current.steps.filter(step=>step.status==='PASS'||subset&&step.status==='FAILED_CLOSED')].map(step=>step.operationId));
   for(const step of plan.steps)for(const prior of step.priorAttempts??[])accepted.add(prior.operationId);
   for(const step of current.steps)for(const prior of step.priorAttempts??[])accepted.add(prior.operationId);
   const routingFile=ACCEPTANCE_ROOT+'/chief-runtime-routing-acceptance.json';
   if(fs.existsSync(routingFile)){const routing=privateJson(routingFile);if(routing.kind==='isolated-chief-runtime-routing'&&routing.companyId===plan.companyId&&routing.rootTaskId===plan.rootTaskId)for(const step of [routing.chief,routing.execution,...(routing.execution?.priorAttempts??[])])if(['PASS','FAILED_CLOSED'].includes(step?.status)&&runs.some(run=>run.id===step.runId&&['succeeded','failed'].includes(run.status)&&run.issueId===step.taskId&&run.agentId===step.agentId))accepted.add(step.operationId);}
   if(budget.some(record=>!accepted.has(record.operationId)))fail('MULTI_RUNTIME_CURRENT_MATRIX_BUDGET_UNPROVEN');
  }
  else if(resumeCurrent13)fail('MULTI_RUNTIME_CURRENT13_PREFIX_DENIED');
  const ledger=new DatabaseSync(shared,{readOnly:true});try{const leases=ledger.prepare('SELECT task_id FROM admission_lease').all();if(leases.length>1||leases.some(lease=>registry.tasks.includes(lease.task_id)))fail('MULTI_RUNTIME_COMPLETED_ADMISSION_BUSY');}finally{ledger.close();}
  const {CSV_TESTS,assertDelegatedAuth}=await import('../../scripts/multi-runtime-acceptance.mjs');assertDelegatedAuth(input.codexAuth);
  if(sha(verifyCompletedFiles(plan,cwd))!==sha(CSV_TESTS))fail('MULTI_RUNTIME_COMPLETED_FIXED_TEST_CHANGED');
  if(Object.keys(registry.team.ids).length!==Object.keys(TEAM_ROLES).length&&!migrateRoster)fail('MULTI_RUNTIME_ROSTER_MIGRATION_REQUIRED');
 }
 if(resumeKnownBootstrap){
  const first=plan.steps[0],run=(await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,first.runId)))[0];
  const active=await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
  const rootTask=(await db.select().from(s.issues).where(o.eq(s.issues.id,plan.rootTaskId)))[0];
  if(active.length||registry.companyId!==plan.companyId||registry.projectId!==plan.projectId||registry.taskId!==plan.rootTaskId||registry.ownerId!==ownerId||
   fs.readFileSync(ACCEPTANCE_ROOT+'/.multi-runtime-owner','utf8')!==plan.companyId||taskInputRevision(rootTask??{})!==plan.rootInputRevision||
   !run||run.companyId!==plan.companyId||run.agentId!==first.agentId||run.issueId!==first.taskId||run.responsibleUserId!==ownerId)fail('MULTI_RUNTIME_BOOTSTRAP_IDENTITY_DENIED');
  const agents=await db.select().from(s.agents).where(o.eq(s.agents.companyId,plan.companyId));
  if(agents.length!==12||Object.entries(TEAM_ROLES).some(([role,definition])=>{const agent=agents.find(value=>value.id===plan.agentIds[role]);return !agent||registry.team.ids[role]!==agent.id||agent.reportsTo!==(definition.parent?plan.agentIds[definition.parent]:null);}))fail('MULTI_RUNTIME_BOOTSTRAP_ROSTER_CHANGED');
  const currentEvents=await db.select().from(s.heartbeatRunEvents).where(o.eq(s.heartbeatRunEvents.runId,run.id));
  const closure=knownBootstrapClosure(run,{claimExists:fs.existsSync(ACCEPTANCE_ROOT+'/claims/'+run.id+'.json'),transportExists:fs.existsSync(ACCEPTANCE_ROOT+'/transport/'+run.id),
   providerAuditExists:fs.existsSync(ACCEPTANCE_ROOT+'/transport/'+run.id+'/proxy-audit'),callLockExists:fs.existsSync(ACCEPTANCE_ROOT+'/call.lock')},{executionEvents:currentEvents});
  const directory=ACCEPTANCE_ROOT+'/budget/'+plan.rootTaskId,names=fs.readdirSync(directory);
  if(names.length<1||names.length>=20||names.some(name=>!/^[-a-f0-9]{36}\.json$/.test(name))||!names.includes(first.operationId+'.json')&&closure.proofSource!=='native_identity_setup')fail('MULTI_RUNTIME_BOOTSTRAP_BUDGET_DENIED');
  const budgetRecords=names.sort().map(name=>({operationId:name.slice(0,-5),sha256:sha(fs.readFileSync(directory+'/'+name))})),sourceClosure=privateJson(ACCEPTANCE_ROOT+'/bootstrap-closure.json');
  const runs=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.companyId,plan.companyId));
  validateReleasedBootstrapClosure({closure:sourceClosure,plan,registry,runs,budget:budgetRecords});
  for(const row of runs)if(fs.existsSync(ACCEPTANCE_ROOT+'/claims/'+row.id+'.json')||fs.existsSync(ACCEPTANCE_ROOT+'/transport/'+row.id))fail('MULTI_RUNTIME_BOOTSTRAP_HOST_EFFECT_FOUND');
  const meter=new AdmissionMeter({filename:shared,allowedProjectIds:[plan.projectId],log:()=>{}});try{if(meter.verifyLease(sourceClosure.lease).allowed===true)fail('MULTI_RUNTIME_BOOTSTRAP_LEASE_NOT_RELEASED');}finally{meter.close();}
  bootstrapRecovery={...closure,operationId:first.operationId,budgetRecords,closureSha256:sha(fs.readFileSync(ACCEPTANCE_ROOT+'/bootstrap-closure.json'))};
  const verifiedClosureSha256s=[];let ancestor=sourceClosure.previousClosureSha256;
  while(ancestor){if(!/^[a-f0-9]{64}$/.test(ancestor)||verifiedClosureSha256s.includes(ancestor)||verifiedClosureSha256s.length>=20)fail('MULTI_RUNTIME_BOOTSTRAP_CLOSURE_CHAIN_DENIED');
   const file=ACCEPTANCE_ROOT+'/bootstrap-closures/'+ancestor+'.json',bytes=fs.readFileSync(file),previous=privateJson(file);
   if(sha(bytes)!==ancestor||previous.companyId!==plan.companyId||previous.rootTaskId!==plan.rootTaskId||previous.modelCalls!==0)fail('MULTI_RUNTIME_BOOTSTRAP_CLOSURE_CHAIN_DENIED');verifiedClosureSha256s.push(ancestor);ancestor=previous.previousClosureSha256;}
  const archive=ACCEPTANCE_ROOT+'/bootstrap-archives/'+run.id;fs.mkdirSync(archive,{recursive:true,mode:0o700});
  for(const [label,file]of [['registry-before-resume',ACCEPTANCE_ROOT+'/registry.json'],['acceptance-before-resume',ACCEPTANCE_ROOT+'/multi-runtime-acceptance.json']])archivePrivateSnapshot(archive,label,fs.readFileSync(file));
  for(const candidate of runs.filter(row=>row.status==='cancelled'&&row.startedAt&&row.runtimeMode==='legacy'&&row.executionStage==='preparing'))await db.transaction(async tx=>{
   const [current]=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,candidate.id)).for('update');
   const executionEvents=await tx.select().from(s.heartbeatRunEvents).where(o.eq(s.heartbeatRunEvents.runId,current.id));
   const currentActive=await tx.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
   if(currentActive.length)fail('MULTI_RUNTIME_BOOTSTRAP_STOP_EXECUTION_ACTIVE');
   const reconciled=reconcileCancelledBootstrapResult({run:current,closure:sourceClosure,closureSha256:bootstrapRecovery.closureSha256,expectedAgentId:first.agentId,executionEvents,verifiedClosureSha256s,
    hostMarkers:[fs.existsSync(ACCEPTANCE_ROOT+'/claims/'+current.id+'.json'),fs.existsSync(ACCEPTANCE_ROOT+'/transport/'+current.id),fs.existsSync(ACCEPTANCE_ROOT+'/call.lock')]});
   if(!reconciled.changed)return;
   const original=archivePrivateSnapshot(ACCEPTANCE_ROOT+'/runtime-secrets/bootstrap-stop-archives','run-'+current.id,Buffer.from(JSON.stringify({schemaVersion:1,run:current,resultSha256:sha(JSON.stringify(current.resultJson??null)),
    cancellationEvents:executionEvents,cancellationEventsSha256:sha(JSON.stringify(executionEvents))})+'\n'));
   const changed=await tx.update(s.heartbeatRuns).set({resultJson:reconciled.resultJson,updatedAt:new Date()}).where(o.and(o.eq(s.heartbeatRuns.id,current.id),o.eq(s.heartbeatRuns.companyId,plan.companyId),
    o.eq(s.heartbeatRuns.status,'cancelled'),o.eq(s.heartbeatRuns.runtimeMode,'legacy'),o.eq(s.heartbeatRuns.executionStage,'preparing'),o.eq(s.heartbeatRuns.updatedAt,current.updatedAt),
    current.resultJson===null?o.isNull(s.heartbeatRuns.resultJson):o.eq(s.heartbeatRuns.resultJson,current.resultJson))).returning({id:s.heartbeatRuns.id});
   if(changed.length!==1)fail('MULTI_RUNTIME_BOOTSTRAP_STOP_CAS_CHANGED');
   await tx.insert(s.activityLog).values({companyId:plan.companyId,actorType:'user',actorId:ownerId,action:'isolated.bootstrap_stop_reconciled',entityType:'heartbeat_run',entityId:current.id,
    details:{rootTaskId:plan.rootTaskId,closureSha256:bootstrapRecovery.closureSha256,originalRunSha256:original.sha256,resultSha256:sha(JSON.stringify(current.resultJson??null)),
     cancellationEventsSha256:sha(JSON.stringify(executionEvents)),proof:'verified-no-provider-bootstrap'}});
  });
 }
 if(resumeKnownBootstrap&&bootstrapRecovery?.proofSource==='native_identity_setup'&&!fs.existsSync(ACCEPTANCE_ROOT+'/runtime-secrets/controller-master.json'))fail('MULTI_RUNTIME_IDENTITY_MASTER_NOT_PERSISTED');
 const master=controllerMaster();
 if(resumeKnownBootstrap&&bootstrapRecovery?.proofSource==='native_identity_setup'){
  const sourceClosure=privateJson(ACCEPTANCE_ROOT+'/bootstrap-closure.json'),{agentIdentityService}=await import(P+'/@paperclipai/server/dist/services/agent-identity.js');
  try{await agentIdentityService(db).ensureAgentIdentity(plan.companyId,plan.steps[0].agentId);}
  catch(error){
   if(!identityError(error.message))fail('MULTI_RUNTIME_IDENTITY_FAILURE_UNVERIFIED');
   if(process.env.SUPER_AGENT_REPROVISION_ISOLATED_IDENTITY!=='1')fail('MULTI_RUNTIME_IDENTITY_REPROVISION_AUTH_REQUIRED');
   await db.transaction(async tx=>{
    const [agent]=await tx.select().from(s.agents).where(o.and(o.eq(s.agents.id,plan.steps[0].agentId),o.eq(s.agents.companyId,plan.companyId))).for('update');
    const [identity]=await tx.select({...o.getTableColumns(s.agentIdentityKeys),createdAtExact:o.sql`${s.agentIdentityKeys.createdAt}::text`}).from(s.agentIdentityKeys).where(o.and(o.eq(s.agentIdentityKeys.agentId,agent.id),o.eq(s.agentIdentityKeys.companyId,plan.companyId))).for('update');
    await repairIdentityUnderLock({ensure:()=>agentIdentityService(tx).ensureAgentIdentity(plan.companyId,agent.id),replace:async()=>{
    const runs=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.companyId,plan.companyId));
    if(runs.some(row=>['running','queued','scheduled_retry'].includes(row.status)))fail('MULTI_RUNTIME_IDENTITY_EXECUTION_ACTIVE');
    const eventsByRun={},markersByRun={};for(const row of runs){eventsByRun[row.id]=await tx.select().from(s.heartbeatRunEvents).where(o.eq(s.heartbeatRunEvents.runId,row.id));
     markersByRun[row.id]={claimExists:fs.existsSync(ACCEPTANCE_ROOT+'/claims/'+row.id+'.json'),transportExists:fs.existsSync(ACCEPTANCE_ROOT+'/transport/'+row.id),providerAuditExists:fs.existsSync(ACCEPTANCE_ROOT+'/transport/'+row.id+'/proxy-audit'),callLockExists:fs.existsSync(ACCEPTANCE_ROOT+'/call.lock')};}
    assertIsolatedIdentityReprovision({authorized:true,identity,plan,closure:sourceClosure,runs,eventsByRun,markersByRun});
    const original=archivePrivateSnapshot(ACCEPTANCE_ROOT+'/runtime-secrets/identity-recovery-archives','identity-'+agent.id,Buffer.from(JSON.stringify({schemaVersion:1,identity,closureSha256:bootstrapRecovery.closureSha256})+'\n'));
    const removed=await tx.delete(s.agentIdentityKeys).where(o.and(o.eq(s.agentIdentityKeys.companyId,plan.companyId),o.eq(s.agentIdentityKeys.agentId,agent.id),o.eq(s.agentIdentityKeys.keyId,identity.keyId),
     o.eq(s.agentIdentityKeys.publicKeyPem,identity.publicKeyPem),o.eq(s.agentIdentityKeys.privateKeyMaterial,identity.privateKeyMaterial),o.sql`${s.agentIdentityKeys.createdAt}::text = ${identity.createdAtExact}`)).returning({agentId:s.agentIdentityKeys.agentId});
    if(removed.length!==1)fail('MULTI_RUNTIME_IDENTITY_CAS_CHANGED');
    const replacement=await agentIdentityService(tx).ensureAgentIdentity(plan.companyId,agent.id);
    await tx.insert(s.activityLog).values({companyId:plan.companyId,actorType:'user',actorId:ownerId,action:'isolated.agent_identity.reprovisioned',entityType:'agent',entityId:agent.id,
     details:{rootTaskId:plan.rootTaskId,oldKeyId:identity.keyId,newKeyId:replacement.keyId,archiveSha256:original.sha256,closureSha256:bootstrapRecovery.closureSha256,proof:'isolated-no-provider-bootstrap'}});
    }});
   });
  }
 }
 if(!existing){fs.mkdirSync(cwd,{recursive:true,mode:0o700});execFileSync('git',['init',cwd],{stdio:'ignore'});}
 if(!resumeCompleted)for(const name of ['materials','permits','claims','results','probes','operations','budget/'+plan.rootTaskId])fs.mkdirSync(ACCEPTANCE_ROOT+'/'+name,{recursive:true,mode:0o700});
 if(!existing){await db.insert(s.authUsers).values({id:ownerId,name:'Isolated acceptance owner',email:'isolated-'+plan.companyId+'@fixture.invalid',createdAt:new Date(),updatedAt:new Date()});
 await db.insert(s.companies).values({id:plan.companyId,name:'Isolated multi-runtime acceptance',issuePrefix:'ISO'});
 await db.insert(s.companyMemberships).values({companyId:plan.companyId,principalType:'user',principalId:ownerId,status:'active',membershipRole:'owner'});}
 const refs={};
 for(const provider of ['deepseek','minimax']){
  if(resumeCompleted){const ref=registry.credentialRefs?.[provider];
   if(registry.credentialRefs?.generation!==master.credentialGeneration||ref?.type!=='secret_ref')fail('MULTI_RUNTIME_COMPLETED_CREDENTIAL_REF_CHANGED');
   const [secret]=await db.select({id:s.companySecrets.id,latestVersion:s.companySecrets.latestVersion}).from(s.companySecrets).where(o.and(o.eq(s.companySecrets.companyId,plan.companyId),o.eq(s.companySecrets.id,ref.secretId)));
   if(!secret||secret.latestVersion!==ref.version)fail('MULTI_RUNTIME_COMPLETED_CREDENTIAL_REF_CHANGED');refs[provider]=structuredClone(ref);continue;
  }
  const value=input.providers?.[provider]?.apiKey;if(typeof value!=='string'||!value.trim())fail('MULTI_RUNTIME_PROVIDER_KEY_REQUIRED');
  const name='Isolated '+provider+' '+master.credentialGeneration;
  const existing=(await db.select({id:s.companySecrets.id,latestVersion:s.companySecrets.latestVersion}).from(s.companySecrets).where(o.and(o.eq(s.companySecrets.companyId,plan.companyId),o.eq(s.companySecrets.name,name))))[0];
  const secret=existing??await secrets.create(plan.companyId,{name,key:'ISOLATED_'+provider.toUpperCase()+'_'+master.credentialGeneration.replaceAll('-','_'),provider:'local_encrypted',value},{userId:ownerId});
  refs[provider]={type:'secret_ref',secretId:secret.id,version:secret.latestVersion};
 }
 const grantId=randomUUID(),providerHome=fs.mkdtempSync('/tmp/paperclip-ai-'+plan.companyId+'-'+grantId+'-')+'/provider';
 fs.mkdirSync(providerHome,{mode:0o700});writePrivate(providerHome+'/auth.json',{auth_mode:'chatgpt',delegatedExpiresAt:input.codexAuth.expiresAt,tokens:{...input.codexAuth.tokens,refresh_token:'ISOLATED_NO_REFRESH'}});
 registry??={schemaVersion:1,enabled:true,companyId:plan.companyId,ownerId,projectId:plan.projectId,taskId:plan.rootTaskId,
  tasks:[...new Set([plan.rootTaskId,...plan.steps.map(step=>step.taskId)])],taskRoots:Object.fromEntries([plan.rootTaskId,...plan.steps.map(step=>step.taskId)].map(id=>[id,plan.rootTaskId])),
  runtimeAssignments:plan.runtimeAssignments,team:{schemaVersion:1,enabled:false,projectId:plan.projectId,ids:plan.agentIds},
  runtimeRouting:{schemaVersion:1,mode:'task'},
  policy:{newTasksPerShanghaiDay:null,concurrentExecutions:1,maxRootRoleCalls:20,maxResponsesPerRun:64,maxFixRounds:2},agents:[],operations:[]};
 if(!existing){for(const [role,definition]of Object.entries(TEAM_ROLES)){
  const id=plan.agentIds[role],runtime=getRoleRuntimeProfile(role,plan.runtimeAssignments),name=id+'.md';
  const text=roleInstructions(role,{taskRuntimeRouting:true});fs.writeFileSync(ACCEPTANCE_ROOT+'/materials/'+name,text,{flag:'wx',mode:0o600});
  const binding=isolatedRuntimeBinding({role,id,projectId:plan.projectId,cwd,providerHome,runtimeProfileId:runtime.id,refs,instructionsFilePath:ACCEPTANCE_ROOT+'/materials/'+name});
  registry.agents.push({profile:binding.profile,manifest:{schemaVersion:1,project:binding.profile.projectKey,role,instructionsFilePath:name,requiredReferences:[],files:[{path:name,sha256:sha(text)}]}});
  await db.insert(s.agents).values({id,companyId:plan.companyId,name:definition.name,role:definition.nativeRole,reportsTo:definition.parent?plan.agentIds[definition.parent]:null,status:'idle',
   adapterType:binding.adapterType,adapterConfig:binding.adapterConfig,runtimeConfig:binding.runtimeConfig});
 }
 await db.insert(s.projects).values({id:plan.projectId,companyId:plan.companyId,name:'Isolated multi-runtime'});
 await db.insert(s.projectWorkspaces).values({id:plan.workspaceId,companyId:plan.companyId,projectId:plan.projectId,name:'Isolated artifacts',cwd,sourceType:'local_path',isPrimary:true,
  metadata:{superAgentProject:{key:'isolated-multi-runtime',ownerId,delivery:{maximumAction:'artifact'},rules:[],checks:[]}}});
 const [root]=await db.insert(s.issues).values({id:plan.rootTaskId,companyId:plan.companyId,projectId:plan.projectId,projectWorkspaceId:plan.workspaceId,
  title:'Isolated multi-runtime acceptance',description:'Fixed CSV → research → observable acceptance → independent QA. No production or messages.',status:'in_review',assigneeUserId:ownerId,responsibleUserId:ownerId}).returning();
 plan.rootInputRevision=taskInputRevision(root);
 for(const taskId of new Set(plan.steps.map(step=>step.taskId))){const step=plan.steps.find(value=>value.taskId===taskId);await db.insert(s.issues).values({id:step.taskId,companyId:plan.companyId,projectId:plan.projectId,projectWorkspaceId:plan.workspaceId,parentId:root.id,
  title:'Isolated '+step.role,description:step.goal,status:'todo',assigneeUserId:ownerId,responsibleUserId:ownerId});}
 writePrivate(ACCEPTANCE_ROOT+'/knowledge.json',{schemaVersion:1,records:[]});}
 if(!resumeCompleted){if(registry.credentialRefs)registry.credentialRefHistory=[...(registry.credentialRefHistory??[]),registry.credentialRefs];
 registry.credentialRefs={generation:master.credentialGeneration,...refs};writePrivate(ACCEPTANCE_ROOT+'/registry.json',registry);}
 if(resumeCompleted&&Object.keys(registry.team.ids).length!==Object.keys(TEAM_ROLES).length){
  if(!migrateRoster)fail('MULTI_RUNTIME_ROSTER_MIGRATION_REQUIRED');
  registry=await migrateCompletedRoster({plan,registry,db,s,o,cwd,ownerId,providerHome,refs});
 }
 const runtime=await import('../../bridge/native-role-runtime.mjs');
 if(typeof runtime.installNativeRoleRuntime!=='function')fail('MULTI_RUNTIME_NATIVE_INJECTION_UNAVAILABLE');
 const uninstall=await runtime.installNativeRoleRuntime({database:async()=>({db,schema:s,orm:o}),admissionFile:shared});
 const getRun=async id=>(await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,id)))[0];
 const lifecycleModule=await import(P+'/@paperclipai/server/dist/services/agent-lifecycle.js'),lifecycle=lifecycleModule.createAgentLifecycle(db);
 let lifecycleWorker;
 if(resumeKnownBootstrap){
  const [agent]=await db.select().from(s.agents).where(o.eq(s.agents.id,plan.steps[0].agentId));
  if(!agent||!['ready','pausing','paused','resuming'].includes(agent.lifecycleState)||(agent.lifecycleOperation?.resumeState??'ready')!=='ready')fail('MULTI_RUNTIME_BOOTSTRAP_LIFECYCLE_REQUIRES_VERIFICATION');
  const selected=getRoleRuntimeProfile(plan.steps[0].role,registry.runtimeAssignments);
  if(selected.runtime==='opencode')await lifecycle.updateConfiguration(agent.id,{adapterConfig:{...agent.adapterConfig,env:{...agent.adapterConfig.env,SUPER_AGENT_ROLE_PROVIDER_API_KEY:refs[selected.provider]}}},
   {recordRevision:{source:'isolated-bootstrap-secret-reference-repair',createdByUserId:ownerId}});
  const {createLifecycleDriver}=await import(P+'/@paperclipai/server/dist/services/agent-lifecycle-driver.js');lifecycleWorker=lifecycleModule.configureAgentLifecycle(db,createLifecycleDriver(db));
  const until=Date.now()+180000;let resumeRequested=false;
  while(Date.now()<until){
   const state=await lifecycle.get(plan.steps[0].agentId);if(state?.lifecycleState==='ready')break;
   if(!['pausing','paused','resuming'].includes(state?.lifecycleState))fail('MULTI_RUNTIME_BOOTSTRAP_LIFECYCLE_REQUIRES_VERIFICATION');
   if(state.lifecycleState==='paused'&&!resumeRequested){resumeRequested=true;await lifecycle.resumeAgent(plan.steps[0].agentId);}
   await lifecycleWorker.process(plan.steps[0].agentId);
   if((await lifecycle.get(plan.steps[0].agentId))?.lifecycleState==='ready')break;
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  if((await lifecycle.get(plan.steps[0].agentId))?.lifecycleState!=='ready')fail('MULTI_RUNTIME_BOOTSTRAP_AGENT_NOT_READY');}
 const nativeIssues=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService;
 const readRegistry=()=>{registry=privateJson(ACCEPTANCE_ROOT+'/registry.json');return registry;};
 const verifyActorScopeClosed=async(taskId,agentId,data=db)=>{
  const r=readRegistry();if(!r.tasks.includes(taskId)||!r.agents.some(entry=>entry.profile.agentId===agentId)||fs.existsSync(ACCEPTANCE_ROOT+'/call.lock'))fail('MULTI_RUNTIME_ACTOR_SCOPE_OPEN');
  const [task]=await data.select().from(s.issues).where(o.and(o.eq(s.issues.id,taskId),o.eq(s.issues.companyId,plan.companyId)));
  if(!task||task.projectId!==plan.projectId||task.projectWorkspaceId!==plan.workspaceId||task.responsibleUserId!==ownerId||(task.parentId??task.id)!==plan.rootTaskId||(r.taskRoots?.[taskId]??taskId)!==plan.rootTaskId)fail('MULTI_RUNTIME_ACTOR_SCOPE_DENIED');
  const active=await data.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
  if(active.length)fail('MULTI_RUNTIME_ACTOR_SCOPE_OPEN');
  const {agentExecutionsHaveStopped}=await import(P+'/@paperclipai/server/dist/services/agent-execution-stop.js');
  if(!await agentExecutionsHaveStopped(data,[agentId]))fail('MULTI_RUNTIME_NATIVE_EXECUTION_OPEN');
  const runs=await data.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.companyId,plan.companyId),o.eq(s.heartbeatRuns.issueId,taskId),o.eq(s.heartbeatRuns.agentId,agentId))),proofs=[];
  for(const run of runs){
   if(!['succeeded','failed','cancelled','timed_out'].includes(run.status)||!run.finishedAt)fail('MULTI_RUNTIME_ACTOR_SCOPE_OPEN');
   const directory=ACCEPTANCE_ROOT+'/transport/'+run.id;
   if(!fs.existsSync(directory)){
    const events=await data.select().from(s.heartbeatRunEvents).where(o.eq(s.heartbeatRunEvents.runId,run.id));
    if(run.status==='failed')knownBootstrapClosure(run,{claimExists:fs.existsSync(ACCEPTANCE_ROOT+'/claims/'+run.id+'.json'),transportExists:false,providerAuditExists:false,callLockExists:false},{executionEvents:events});
    else if(run.status!=='cancelled'||!noProviderProcess(run)||!cancellationOnly(run,events)||fs.existsSync(ACCEPTANCE_ROOT+'/claims/'+run.id+'.json'))fail('MULTI_RUNTIME_ACTOR_PROVIDER_STATE_UNKNOWN');
    proofs.push({runId:run.id,status:run.status,providerWorkStarted:false});continue;
   }
   const result=privateJson(directory+'/result.json');
   if(result.runId!==run.id||!Number.isInteger(result.exitCode)||result.signal!==null||result.timedOut||result.cancelled||result.outputUnknown)fail('MULTI_RUNTIME_ACTOR_PROVIDER_STATE_UNKNOWN');
   for(const stream of ['stdout','stderr'])if(sha(fs.readFileSync(directory+'/'+stream))!==result[stream+'Sha256'])fail('MULTI_RUNTIME_ACTOR_OUTPUT_CHANGED');
   for(const file of ['process-cleanup.json','broker-process-cleanup.json'])if(privateJson(directory+'/'+file).status!=='terminated')fail('MULTI_RUNTIME_ACTOR_PROCESS_OPEN');
   for(const file of ['sdk-offload-closure.json','sdk-process-cleanup.json','sdk-server-cleanup.json'])if(fs.existsSync(directory+'/'+file)){
    const proof=privateJson(directory+'/'+file);if(proof.runId!==undefined&&proof.runId!==run.id||!['closed','terminated'].includes(proof.status)||(proof.activeProcesses?.length??0)>0)fail('MULTI_RUNTIME_ACTOR_SDK_OPEN');
   }
   const queue=directory+'/proxy-audit/host-calls';if(fs.existsSync(queue))for(const name of fs.readdirSync(queue)){
    if(!/^[a-f0-9]{64}$/.test(name))fail('MULTI_RUNTIME_ACTOR_HOST_QUEUE_UNKNOWN');
    const request=privateJson(queue+'/'+name+'/request.json'),response=privateJson(queue+'/'+name+'/result.json');
    if(sha(JSON.stringify(request))!==name||request.runId!==run.id||request.taskId!==taskId||response.runId!==run.id||response.requestHash!==name||/UNKNOWN|TIMEOUT|CANCEL/.test(response.error?.code??''))fail('MULTI_RUNTIME_ACTOR_HOST_QUEUE_UNKNOWN');
   }
   proofs.push({runId:run.id,status:run.status,transportSha256:sha(fs.readFileSync(directory+'/result.json')),processCleanupSha256:sha(fs.readFileSync(directory+'/process-cleanup.json')),brokerCleanupSha256:sha(fs.readFileSync(directory+'/broker-process-cleanup.json'))});
  }
  return{closed:true,taskId,agentId,activeRunIds:[],nativeExecutionStopVerified:true,proofs};
 };
 const ensureAcceptanceTask=async step=>{
  const r=readRegistry(),description=step.description??step.goal,title=(step.title??'Isolated acceptance — '+(step.key??step.role)+' — '+step.taskId).trim();
  if(!/^[a-f0-9-]{36}$/.test(step.taskId??'')||step.taskId===plan.rootTaskId||typeof description!=='string'||!description.trim()||step.description!==undefined&&step.goal!==undefined&&step.description!==step.goal||
   r.team.ids[step.role]!==step.agentId)fail('MULTI_RUNTIME_CASE_CREATE_DENIED');
  return db.transaction(async tx=>{
   const [root]=await tx.select().from(s.issues).where(o.and(o.eq(s.issues.id,plan.rootTaskId),o.eq(s.issues.companyId,plan.companyId))).for('update');
   if(!root||root.projectId!==plan.projectId||root.responsibleUserId!==ownerId||taskInputRevision(root)!==plan.rootInputRevision||fs.existsSync(ACCEPTANCE_ROOT+'/call.lock')||
    (await tx.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']))).length)fail('MULTI_RUNTIME_CASE_CREATE_DENIED');
   const [existingTask]=await tx.select().from(s.issues).where(o.eq(s.issues.id,step.taskId)).for('update');
   if(existingTask)return assertAcceptanceTaskBody({task:existingTask,plan,ownerId,step,title,description});
   const created=await nativeIssues(tx).create(plan.companyId,{id:step.taskId,projectId:plan.projectId,projectWorkspaceId:plan.workspaceId,parentId:root.id,title,description,status:'todo',priority:'medium',
    assigneeUserId:ownerId,assigneeAgentId:null,responsibleUserId:ownerId,createdByUserId:ownerId,actorResponsibleUserId:ownerId,trustExplicitResponsibleUserId:true,idempotencyKey:'isolated-case:'+step.taskId,allowDuplicate:false});
   return assertAcceptanceTaskBody({task:created,plan,ownerId,step,title,description});
  });
 };
 const assignAcceptanceTask=async(step,expected)=>db.transaction(async tx=>{
  if(expected?.expectedStatus!==undefined&&expected.expectedCurrentStatus!==undefined&&expected.expectedStatus!==expected.expectedCurrentStatus)fail('MULTI_RUNTIME_OWNER_CAS_DENIED');
  expected={...expected,expectedStatus:expected?.expectedStatus??expected?.expectedCurrentStatus};
  const [root]=await tx.select().from(s.issues).where(o.and(o.eq(s.issues.id,plan.rootTaskId),o.eq(s.issues.companyId,plan.companyId))).for('update');
  const task=step.taskId===plan.rootTaskId?root:(await tx.select().from(s.issues).where(o.and(o.eq(s.issues.id,step.taskId),o.eq(s.issues.companyId,plan.companyId))).for('update'))[0];
  const r=readRegistry(),registrySha256=sha(fs.readFileSync(ACCEPTANCE_ROOT+'/registry.json')),operation=r.operations?.find(value=>value.id===step.operationId),route=operation?.taskRuntimeRoute;
  if(expected.route&&!isDeepStrictEqual(expected.route,route))fail('MULTI_RUNTIME_ROLE_TRANSFER_DENIED');
  const fromAgent=step.agentId==null?operation?.agentId:route?.handoff?.fromAgentId??expected?.expectedAgentId??operation?.agentId;
  const closed=await verifyActorScopeClosed(step.taskId,fromAgent,tx),checked=assertAcceptanceTaskNamespace({plan,registry:r,root,task,step,expected,scopeClosed:closed});
  if(step.agentId!=null&&route?.handoff?.handoffKind==='role-transfer'){
   const [previousRun]=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,route.handoff.fromRunId));
   if(expected.fromActor){const previous=r.taskRuntimeRoutes?.find(value=>value.id===route.handoff.previousRouteId);if(expected.fromActor.agentId!==route.handoff.fromAgentId||expected.fromActor.role!==route.handoff.fromRole||expected.fromActor.runId!==route.handoff.fromRunId||expected.fromActor.operationId!==previous?.operationId)fail('MULTI_RUNTIME_ROLE_TRANSFER_DENIED');}
   assertAcceptanceRoleTransfer({plan,registry:r,task,step,expected,scopeClosed:closed,previousRun,route,budgetUsed:fs.readdirSync(ACCEPTANCE_ROOT+'/budget/'+plan.rootTaskId).length});
  }
  if(sha(fs.readFileSync(ACCEPTANCE_ROOT+'/registry.json'))!==registrySha256)fail('MULTI_RUNTIME_OWNER_REGISTRY_CHANGED');
  const status=expected.status??(checked.target===null?'in_review':'todo');if(!['todo','in_progress','in_review'].includes(status)||checked.target===null&&status!=='in_review')fail('MULTI_RUNTIME_OWNER_STATUS_DENIED');
  const updated=await nativeIssues(tx).update(task.id,{companyGuard:plan.companyId,assigneeAgentId:checked.target,assigneeUserId:checked.user,status,actorUserId:ownerId});
  if(!updated||taskInputRevision(updated)!==expected.inputRevision||updated.assigneeAgentId!==checked.target||updated.assigneeUserId!==checked.user)fail('MULTI_RUNTIME_OWNER_UPDATE_CHANGED');
  await tx.insert(s.activityLog).values({companyId:plan.companyId,actorType:'user',actorId:ownerId,action:'isolated.task_owner.assigned',entityType:'issue',entityId:task.id,
   details:{rootTaskId:plan.rootTaskId,operationId:step.operationId,inputRevision:expected.inputRevision,oldAssigneeAgentId:task.assigneeAgentId,oldAssigneeUserId:task.assigneeUserId,newAssigneeAgentId:checked.target,newAssigneeUserId:checked.user,previousActorId:fromAgent,scopeProofs:closed.proofs}});
  return updated;
 });
 const assignTaskOwnerCAS=async payload=>{
  if(!Object.hasOwn(payload,'expectedCurrentAssigneeAgentId')||!Object.hasOwn(payload,'expectedCurrentAssigneeUserId')||!Object.hasOwn(payload,'expectedCurrentStatus')||payload.rootTaskId!==plan.rootTaskId||
   payload.route?.handoff?.fromAgentId!==payload.fromAgentId||payload.route?.handoff?.fromRole!==payload.fromRole||payload.route?.handoff?.fromRunId!==payload.previousRunId||payload.route?.handoff?.budgetUsedBefore!==payload.budgetUsedBefore)fail('MULTI_RUNTIME_ROLE_TRANSFER_DENIED');
  return assignAcceptanceTask({taskId:payload.taskId,operationId:payload.operationId,agentId:payload.toAgentId,role:payload.toRole},{expectedAgentId:payload.expectedCurrentAssigneeAgentId,expectedAssigneeUserId:payload.expectedCurrentAssigneeUserId,expectedStatus:payload.expectedCurrentStatus,inputRevision:payload.expectedInputRevision,status:'todo',route:payload.route});
 };
 const delegationLeases=new Map();
 const ensureAcceptanceDelegation=createAcceptanceDelegationManager({providerHome,holderAccountId:input.codexAuth.tokens.account_id,companyId:plan.companyId,rootTaskId:plan.rootTaskId,
  verifyBoundary:async step=>{
   const r=readRegistry(),op=r.operations?.find(value=>value.id===step.operationId),lease=r.lease;
   if(!op||op.kind!=='run'||op.taskId!==step.taskId||op.agentId!==step.agentId||op.role!==step.role||(op.rootTaskId??op.taskId)!==plan.rootTaskId||op.taskRuntimeRoute?.profileId!=='codex_subscription'||
    r.team.ids[step.role]!==step.agentId||lease?.taskId!==step.taskId||lease.projectId!==plan.projectId||lease.operationId!==step.operationId||lease.agentId!==undefined&&lease.agentId!==step.agentId||fs.existsSync(ACCEPTANCE_ROOT+'/call.lock'))fail('MULTI_RUNTIME_DELEGATION_BOUNDARY_DENIED');
   const leaseHash=sha(JSON.stringify({taskId:lease.taskId,projectId:lease.projectId,operationId:lease.operationId,nonce:lease.nonce,agentId:step.agentId}));
   if(delegationLeases.has(step.operationId)&&delegationLeases.get(step.operationId)!==leaseHash)fail('MULTI_RUNTIME_DELEGATION_LEASE_CHANGED');
   const meter=new AdmissionMeter({filename:shared,allowedProjectIds:[plan.projectId],log:()=>{}});try{if(meter.verifyLease(lease).allowed!==true)fail('MULTI_RUNTIME_DELEGATION_LEASE_DENIED');}finally{meter.close();}
   const [task]=await db.select().from(s.issues).where(o.eq(s.issues.id,step.taskId)),[agent]=await db.select().from(s.agents).where(o.eq(s.agents.id,step.agentId));
   const home=agent?.adapterConfig?.env?.CODEX_HOME,resolvedHome=typeof home==='string'?home:home?.type==='plain'?home.value:null;
   if(!task||task.companyId!==plan.companyId||task.projectId!==plan.projectId||task.responsibleUserId!==ownerId||task.assigneeAgentId!==step.agentId||task.assigneeUserId!=null||taskInputRevision(task)!==op.inputRevision||
    agent?.adapterType!=='codex_local'||resolvedHome!==providerHome)fail('MULTI_RUNTIME_DELEGATION_OWNER_CHANGED');
   const runs=await db.select().from(s.heartbeatRuns).where(o.and(o.eq(s.heartbeatRuns.companyId,plan.companyId),o.eq(s.heartbeatRuns.agentId,step.agentId),o.eq(s.heartbeatRuns.issueId,step.taskId)));
   if(runs.some(run=>run.contextSnapshot?.roleOperationId===step.operationId))fail('MULTI_RUNTIME_DELEGATION_ALREADY_ATTEMPTED');
   await verifyActorScopeClosed(step.taskId,step.agentId);
   const previous=op.taskRuntimeRoute?.handoff?.fromAgentId;if(previous&&previous!==step.agentId)await verifyActorScopeClosed(step.taskId,previous);
   delegationLeases.set(step.operationId,leaseHash);
  }});
 return{db,schema:s,orm:o,heartbeat,get registry(){return registry;},cwd,ownerId,getRun,bootstrapRecovery,privateRoot:ACCEPTANCE_ROOT,admissionFile:shared,
  ensureAcceptanceTask,createAcceptanceTask:ensureAcceptanceTask,assignAcceptanceTask,assignTaskOwnerCAS,verifyActorScopeClosed,ensureAcceptanceDelegation,
  getRegistry:()=>{registry=privateJson(ACCEPTANCE_ROOT+'/registry.json');return registry;},
  readRegistryBytes:()=>{privateJson(ACCEPTANCE_ROOT+'/registry.json');return fs.readFileSync(ACCEPTANCE_ROOT+'/registry.json');},
  setRegistryCAS:(value,{expectedSha256}={})=>{if(!/^[a-f0-9]{64}$/.test(expectedSha256??''))fail('MULTI_RUNTIME_REGISTRY_CAS_DENIED');
   registry=editRoleRegistry(current=>{if(sha(fs.readFileSync(ACCEPTANCE_ROOT+'/registry.json'))!==expectedSha256||value.companyId!==current.companyId||value.ownerId!==current.ownerId||value.taskId!==current.taskId||value.projectId!==current.projectId||
    Object.keys(TEAM_ROLES).some(role=>value.team?.ids?.[role]!==current.team?.ids?.[role]))fail('MULTI_RUNTIME_REGISTRY_CAS_CHANGED');return value;});return registry;},
  setRegistry:value=>{registry=value;writePrivate(ACCEPTANCE_ROOT+'/registry.json',registry);},
  issue:async id=>(await db.select().from(s.issues).where(o.eq(s.issues.id,id)))[0],
  assign:async step=>{const [task]=await db.select().from(s.issues).where(o.eq(s.issues.id,step.taskId));return assignAcceptanceTask(step,{expectedAgentId:task?.assigneeAgentId??null,expectedAssigneeUserId:task?.assigneeUserId??null,expectedStatus:task?.status,inputRevision:taskInputRevision(task??{})});},
  configureRuntime:async(step,taskRuntimeRoute,{reusePrepared=false}={})=>{
   if(!taskRuntimeRoute)fail('MULTI_RUNTIME_TASK_ROUTE_REQUIRED');
   if((await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']))).length||fs.existsSync(ACCEPTANCE_ROOT+'/call.lock'))fail('MULTI_RUNTIME_ROUTE_BUSY');
   const name=roleRunMaterialName(step),text=roleInstructions(step.role,{taskRuntimeRouting:true})+'\n\n当前可信任务Runtime交接（只适用此操作，不改变岗位默认模型，不共享CLI记忆）：\n'+JSON.stringify({taskId:step.taskId,operationId:step.operationId,runtimeProfileId:step.runtimeProfileId,taskRuntimeRoute,handoff:step.handoff??null});
   const materialFile=ACCEPTANCE_ROOT+'/materials/'+name;
   if(fs.existsSync(materialFile)){const stat=fs.lstatSync(materialFile);if(!reusePrepared||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)||sha(fs.readFileSync(materialFile))!==sha(text))fail('MULTI_RUNTIME_PREPARED_MATERIAL_CHANGED');}
   else fs.writeFileSync(materialFile,text,{flag:'wx',mode:0o600});
   const selected=isolatedRuntimeBinding({role:step.role,id:step.agentId,projectId:plan.projectId,cwd,providerHome,runtimeProfileId:step.runtimeProfileId,refs,instructionsFilePath:ACCEPTANCE_ROOT+'/materials/'+name});
   if(selected.adapterType==='opencode_local')writePrivate(selected.adapterConfig.env.OPENCODE_CONFIG,{model:selected.profile.model,provider:{}});
   if(selected.adapterType==='claude_local')fs.mkdirSync(selected.adapterConfig.env.CLAUDE_CONFIG_DIR,{recursive:true,mode:0o700});
   await lifecycle.updateConfiguration(step.agentId,{adapterType:selected.adapterType,adapterConfig:selected.adapterConfig,runtimeConfig:selected.runtimeConfig},
    {recordRevision:{source:'isolated-task-runtime-route',createdByUserId:ownerId}});
   const entry=registry.agents.find(value=>value.profile.agentId===step.agentId);registry.materialHistory??=[];if(entry.manifest.instructionsFilePath!==name)registry.materialHistory.push({agentId:step.agentId,manifest:entry.manifest});
   entry.profile={...entry.profile,...selected.profile};
   for(const field of ['dangerouslySkipPermissions','dangerouslyBypassApprovalsAndSandbox','dangerouslyBypassSandbox'])if(!Object.hasOwn(selected.profile,field))delete entry.profile[field];
   const references=entry.manifest.requiredReferences??[],retained=references.map(reference=>{const file=entry.manifest.files.find(item=>item.path===reference);if(!file||sha(fs.readFileSync(ACCEPTANCE_ROOT+'/materials/'+reference))!==file.sha256)fail('MULTI_RUNTIME_REFERENCE_MATERIAL_CHANGED');return file;});
   entry.manifest={schemaVersion:1,project:entry.profile.projectKey,role:step.role,instructionsFilePath:name,requiredReferences:[...references],files:[{path:name,sha256:sha(text)},...retained]};
   writePrivate(ACCEPTANCE_ROOT+'/registry.json',registry);
  },
  managedWake:async(step,route)=>{const {createManagedWakeProof}=await import(P+'/@paperclipai/server/dist/services/super-agent-controlled-retry.js');
   const proof=createManagedWakeProof({schemaVersion:2,taskId:step.taskId,companyId:plan.companyId,agentId:step.agentId,scopeId:plan.rootTaskId,scopeSha256:sha(JSON.stringify(route)),attemptId:step.operationId,permitId:route.id,role:step.role==='qa'?'review':'develop'});
   const directory='/paperclip/control/daily/tasks/'+step.taskId;fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(directory+'/managed-wake-'+step.operationId+'.json',proof.bytes,{flag:'wx',mode:0o600});return proof.marker;},
  close:async()=>{await heartbeat.drainActiveRunExecutions();await lifecycleWorker?.stop();await uninstall?.();await pg.cleanup();delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;}};
}
