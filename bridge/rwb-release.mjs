import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const REPOSITORY='Leon-Huang001208/ResearchWorkbench';
const MODULE='research_workbench_entrypoint.resident.model_provider_upgrade';
const actions=new Set(['inspect','merge','deploy','rollback']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value;
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error('ROLE_HOST_RWB_'+code),{code:'ROLE_HOST_RWB_'+code});};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// RWB builds may take 450s and wheel installation 180s. Keep every outer boundary above the registered command.
export const RWB_RELEASE_TIMEOUTS=Object.freeze({commandMs:1800000,rpcMs:1860000,mcpSeconds:1920,processMs:2100000,brokerMs:2160000,transportMs:2220000,nativeSeconds:2400});

function command(operation,entry){
 const argv=operation.argv;
 if(!Array.isArray(argv)||argv.some(arg=>typeof arg!=='string'||arg.includes('\0'))||operation.argvSha256!==digest(JSON.stringify(argv)))fail('COMMAND_SEAL_DENIED');
 if(operation.action==='inspect'){
  if(argv.length||operation.cwd!==entry.repositoryRoot)fail('COMMAND_DENIED');
  return;
 }
 if(!absolute(argv[0]))fail('COMMAND_DENIED');
 if(operation.action==='merge'){
  if(path.basename(argv[0])!=='node'||operation.cwd!==entry.repositoryRoot||!same(argv.slice(1),[
   path.join(entry.repositoryRoot,'scripts/git_safety.mjs'),'delivery','--project',entry.repositoryRoot,'--task-id',entry.managedTaskId,'--status'
  ]))fail('COMMAND_DENIED');
  return;
 }
 if(!absolute(entry.sourceHostPath)||!absolute(entry.residentHome)||operation.cwd!==entry.sourceHostPath||
  !/^python(?:3(?:\.[0-9]+)?)?$/.test(path.basename(argv[0])))fail('COMMAND_DENIED');
 const operationName=argv[4],kind=operation.action==='deploy'?'apply':'rollback';
 if(![kind+'-fingpt',kind+'-local-knowledge'].includes(operationName))fail('COMMAND_DENIED');
 // RWB's rollback-target identifies the currently accepted candidate. Its sealed capsule owns the prior version.
 const tail=operation.action==='deploy'?['--source',entry.sourceHostPath]:['--rollback-target',entry.targetSha];
 if(!same(argv.slice(1),['-B','-m',MODULE,operationName,'--home',entry.residentHome,...tail]))fail('COMMAND_DENIED');
 if(!sha(entry.targetSha))fail('TARGET_REQUIRED');
}

/** Native metadata grants one root task a fixed RWB operation; ordinary project delivery stays PR-only. */
export function resolveRwbReleaseMetadata(value,{companyId,projectId,rootTaskId,repository}={}){
 if(value===undefined||value===null)return null;
 const entry=structuredClone(value);
 if(!object(entry)||entry.schemaVersion!==1||entry.companyId!==companyId||entry.projectId!==projectId||!id(entry.rootTaskId)||
  entry.repository!==REPOSITORY||repository?.fullName?.toLowerCase()!==REPOSITORY.toLowerCase()||entry.repositoryRoot!==repository.hostPath||
  !absolute(entry.repositoryRoot)||!id(entry.managedTaskId)||!Number.isSafeInteger(entry.pullRequest)||entry.pullRequest<1||
  !sha(entry.candidateSha)||!sha(entry.priorSha)||(entry.targetSha!==null&&entry.targetSha!==undefined&&!sha(entry.targetSha))||
  !Array.isArray(entry.operations)||!entry.operations.length||entry.operations.length>16)fail('REGISTRATION_DENIED');
 const ids=new Set();
 for(const operation of entry.operations){
  if(!object(operation)||!id(operation.id)||ids.has(operation.id)||!id(operation.nativeOperationId)||!actions.has(operation.action)||!absolute(operation.cwd))fail('REGISTRATION_DENIED');
  ids.add(operation.id);command(operation,entry);
 }
 // Other roots in the same Native project must not inherit this exception.
 return entry.rootTaskId===rootTaskId?entry:null;
}

/** Fixed release bounds apply to this authorized Native task only; metadata cannot choose larger values. */
export function rwbReleaseTimeoutPolicy(permit,{operationId}={}){
 if(permit?.role!=='devops'||!permit.effectiveCapabilities?.hostAllowedTools?.includes('host.rwb_release')||
  !permit.effectiveCapabilities?.capabilityIds?.includes('devops')||!permit.projectContext?.rwbRelease)return null;
 const entry=resolveRwbReleaseMetadata(permit.projectContext.rwbRelease,{companyId:permit.companyId,projectId:permit.projectId,
  rootTaskId:permit.rootTaskId??permit.taskId,repository:permit.projectContext.repository});
 if(!entry||!entry.operations.some(operation=>operation.action!=='inspect'&&permit.authorizedHostActions?.includes(operation.id)&&
  (operationId===undefined||operationId===operation.id)))return null;
 return RWB_RELEASE_TIMEOUTS;
}
export function rwbReleaseBrokerLifetimeMs(config){
 const policy=rwbReleaseTimeoutPolicy(config);
 return policy?Math.min(policy.brokerMs+30000,policy.transportMs):700000;
}

/** A release can outlast fetch's five-minute header deadline. Use a bounded local stdlib request, without retries. */
export async function postRwbReleaseRequest(endpoint,token,message,{timeoutMs=RWB_RELEASE_TIMEOUTS.rpcMs}={}){
 const url=new URL(endpoint);
 if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','provider'].includes(url.hostname)||url.pathname!=='/backend-api/role-host-mcp'||
  url.username||url.password||url.search||url.hash||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>RWB_RELEASE_TIMEOUTS.rpcMs)fail('CLIENT_SCOPE_DENIED');
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(message),signal=AbortSignal.timeout(timeoutMs);
  const request=(url.protocol==='https:'?https:http).request(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(body)},signal},response=>{
   const chunks=[];let bytes=0;
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576)request.destroy(Object.assign(Error('ROLE_HOST_MCP_RESPONSE_LIMIT'),{code:'ROLE_HOST_MCP_RESPONSE_LIMIT'}));else chunks.push(chunk);});
   response.on('error',reject);
   response.on('end',()=>{try{resolve({ok:response.statusCode>=200&&response.statusCode<300,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(Object.assign(Error('ROLE_HOST_MCP_PROTOCOL_FAILED'),{code:'ROLE_HOST_MCP_PROTOCOL_FAILED'}));}});
  });
  request.once('error',error=>reject(signal.aborted?Object.assign(Error('HOST_CALL_RESULT_UNKNOWN'),{code:'HOST_CALL_RESULT_UNKNOWN'}):error));
  request.end(body);
 });
}

function noLinks(filename){
 for(let current=filename;current!==path.dirname(current);current=path.dirname(current)){
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('PATH_DENIED');
 }
}
function read(filename,{optional=false}={}){
 noLinks(filename);
 if(optional&&!fs.existsSync(filename))return null;
 let value;
 try{
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.nlink!==1||stat.size>1048576)fail('EVIDENCE_DENIED');
  value=JSON.parse(fs.readFileSync(filename,'utf8'));
 }catch(error){if(error.code?.startsWith('ROLE_HOST_RWB_'))throw error;fail('EVIDENCE_UNAVAILABLE');}
 if(!object(value))fail('EVIDENCE_DENIED');return value;
}
function review(permit,entry){
 const proof=permit.codeReview;
 if(proof?.verdict!=='PASS'||proof.rootTaskId!==entry.rootTaskId||proof.projectId!==entry.projectId||proof.candidateSha!==entry.candidateSha||
  !id(proof.runId)||!id(proof.agentId)||proof.agentId===permit.agentId||!Array.isArray(proof.checks)||!proof.checks.length||
  proof.checks.some(check=>check.status!=='passed'||check.candidateSha!==entry.candidateSha)||
  (permit.projectContext.checks??[]).some(check=>!proof.checks.some(actual=>actual.id===check.id))||proof.verification?.status!=='passed')fail('REVIEW_REQUIRED');
}

/** Reuses RWB's delivery and resident gates; it neither schedules work nor changes their receipts. */
export async function runRwbRelease({permit,operationId,controlRoot,run,verifyVolume=async()=>false,log=()=>{}}){
 const context=permit.projectContext,rootTaskId=permit.rootTaskId??permit.taskId;
 const entry=resolveRwbReleaseMetadata(context?.rwbRelease,{companyId:permit.companyId,projectId:permit.projectId,rootTaskId,repository:context?.repository});
 if(!entry||context.id!==permit.projectId||permit.role!=='devops'||!permit.effectiveCapabilities?.capabilityIds?.includes('devops'))fail('SCOPE_DENIED');
 const operation=entry.operations.find(value=>value.id===operationId);
 if(!operation||!permit.authorizedHostActions?.includes(operation.id)||!absolute(controlRoot)||!id(permit.runId)||!id(permit.taskId)||!id(permit.agentId))fail('OPERATION_DENIED');
 const native=read(path.join(controlRoot,'operations',operation.nativeOperationId+'.json'));
 if(native.operationId!==operation.nativeOperationId||native.runId!==permit.runId||native.taskId!==permit.taskId||native.agentId!==permit.agentId)fail('NATIVE_OPERATION_CHANGED');
 for(const filename of [entry.repositoryRoot,entry.sourceHostPath,entry.residentHome,controlRoot].filter(Boolean)){
  noLinks(filename);if(await verifyVolume(filename)!==true)fail('VOLUME_IDENTITY_MISMATCH');
 }
 const git=async(cwd,args)=>(await run(['/usr/bin/git','--no-optional-locks',...args],{cwd})).output.trim();
 const common=await git(entry.repositoryRoot,['rev-parse','--path-format=absolute','--git-common-dir']);
 if(!absolute(common))fail('REPOSITORY_DENIED');
 const remote=await git(entry.repositoryRoot,['remote','get-url','origin']);
 if(!['git@github.com:'+REPOSITORY+'.git','https://github.com/'+REPOSITORY+'.git','https://github.com/'+REPOSITORY].includes(remote))fail('REPOSITORY_DENIED');
 const receipt=read(path.join(common,'leon-engineering/deliveries',entry.managedTaskId+'.json'));
 if(receipt.taskId!==entry.managedTaskId||receipt.repositoryRoot!==entry.repositoryRoot||receipt.mode!=='pr'||receipt.pullRequest?.number!==entry.pullRequest||
  receipt.pullRequest?.url!=='https://github.com/'+REPOSITORY+'/pull/'+entry.pullRequest||receipt.integrationCommit!==entry.candidateSha)fail('DELIVERY_CHANGED');
 const resident=entry.residentHome?read(path.join(entry.residentHome,'resident/accepted.json'),{optional:true}):null;
 if(operation.action==='inspect'){
  // Never call delivery --status here: the RWB manager can merge from that entrypoint.
  return {status:'observed',operationId:operation.id,managedTaskId:entry.managedTaskId,pullRequest:entry.pullRequest,
   candidateSha:entry.candidateSha,targetSha:entry.targetSha??null,priorSha:entry.priorSha,deliveryStatus:receipt.status,
   recordedRemoteCommit:receipt.remoteCommit??null,acceptedSha:resident?.target??null,
   evidence:'local managed receipt; remote CI and business acceptance are not refreshed'};
 }
 review(permit,entry);
 const originalReview=read(path.join(common,'leon-engineering/git-safety/reviews',entry.managedTaskId+'.json'));
 if(originalReview.status!=='PASS'||originalReview.reviewedCommit!==entry.candidateSha)fail('MANAGED_REVIEW_REQUIRED');
 if(operation.action!=='merge'){
  if(!['ci_passed','cleaned'].includes(receipt.status)||receipt.ci?.status!=='passed'||receipt.verification?.status!=='passed'||receipt.remoteCommit!==entry.targetSha)fail('MERGED_TARGET_REQUIRED');
  if(await git(entry.sourceHostPath,['rev-parse','HEAD'])!==entry.targetSha||(await git(entry.sourceHostPath,['status','--porcelain=v1','--untracked-files=all'])))fail('SOURCE_CHANGED');
  // A GitHub merge commit may differ from the reviewed PR head; the exact product tree may not.
  const [sourceTree,reviewedTree]=await Promise.all([git(entry.sourceHostPath,['rev-parse',entry.targetSha+'^{tree}']),git(entry.repositoryRoot,['rev-parse',entry.candidateSha+'^{tree}'])]);
  if(sourceTree!==reviewedTree)fail('SOURCE_CHANGED');
  const accepted=operation.action==='rollback'?entry.targetSha:entry.priorSha;
  if(resident?.target!==accepted||(operation.action==='rollback'&&resident.previous!==entry.priorSha))fail('PRIOR_CHANGED');
 }
 log({code:'ROLE_HOST_RWB_DISPATCHED',operationId:operation.id,action:operation.action,managedTaskId:entry.managedTaskId,candidateSha:entry.candidateSha,targetSha:entry.targetSha??null});
 // Any interruption is unknown. The existing host-call queue retains its started marker and never replays it.
 return {operationId:operation.id,action:operation.action,candidateSha:entry.candidateSha,...await run(operation.argv,{cwd:operation.cwd,timeout:RWB_RELEASE_TIMEOUTS.commandMs})};
}
