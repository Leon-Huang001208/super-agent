import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {redactHostOutput} from './role-host-capabilities.mjs';
import {rwbReleaseTimeoutPolicy} from './rwb-release.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const serving=new Set();
function read(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)fail('HOST_CALL_FILE_DENIED');return JSON.parse(fs.readFileSync(file,'utf8'));}
function write(file,value){
 const bytes=JSON.stringify(value)+'\n',temporary=file+'.tmp';
 const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temporary,file);
}
function safeDetails(details){
 if(!details||typeof details!=='object')return undefined;
 const result={};
 if(Number.isInteger(details.exitCode))result.exitCode=details.exitCode;
 for(const key of ['output','stdout','stderr','signal'])if(typeof details[key]==='string')result[key]=redactHostOutput(details[key]);
 return Object.keys(result).length?result:undefined;
}
function resultFor(requestHash,request,error,result){return{requestHash,runId:request.runId,taskId:request.taskId,projectId:request.projectId,
 ...(error?{error:{code:/^(?:HOST|ROLE)_[A-Z_]+$/.test(error.code??'')?error.code:'HOST_CALL_EXECUTION_FAILED',details:safeDetails(error.details)}}:{result})};}
function releaseRequestId(tool,args,requestId){
 if(tool!=='host.rwb_release')return requestId;
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||typeof args.operationId!=='string'||
  !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(args.operationId))fail('HOST_CALL_RWB_REQUEST_DENIED');
 return 'rwb-release:'+args.operationId;
}
/** The actual broker call uses the same task-scoped bound as the native executor. */
export function hostCapabilityTimeoutMs({config,tool,args={},now=Date.now()}){
 const release=tool==='host.rwb_release'?rwbReleaseTimeoutPolicy(config,{operationId:args.operationId}):null;
 return Math.max(1,Math.min(release?.rpcMs??300000,config.expiresAt-now));
}

/** JSON-RPC retries reuse the same existing run operation instead of repeating a host action. */
export async function requestHostCapability({root,runId,taskId,projectId,requestId,tool,args={},timeoutMs=300000,pollMs=50,signal}){
 const request={runId,taskId,projectId,requestId:releaseRequestId(tool,args,requestId),tool,args},requestHash=hash(JSON.stringify(request));
 const directory=path.join(root,requestHash);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const requestFile=path.join(directory,'request.json');
 if(!fs.existsSync(requestFile)){
  try{const fd=fs.openSync(requestFile,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(request)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  catch(error){if(error.code!=='EEXIST')throw error;}
 }
 const until=Date.now()+timeoutMs;
 while(Date.now()<until){
  if(signal?.aborted)fail('HOST_CALL_INTERRUPTED');
  const file=path.join(directory,'result.json');
  if(fs.existsSync(file)){
   const response=read(file);if(response.requestHash!==requestHash||response.runId!==runId)fail('HOST_CALL_RESULT_CHANGED');
   if(response.error)throw Object.assign(new Error(response.error.code),response.error);return response.result;
  }
  await sleep(pollMs);
 }
 fail('HOST_CALL_RESULT_UNKNOWN');
}

/** Consumed by the already-running per-run host transport; Native remains the task authority. */
export async function serveHostCapabilityCalls({root,permit,executor,log=()=>{}}){
 if(serving.has(root)||!fs.existsSync(root))return;
 serving.add(root);
 try{
  for(const name of fs.readdirSync(root).filter(name=>/^[a-f0-9]{64}$/.test(name)).sort()){
   const directory=path.join(root,name),file=path.join(directory,'request.json'),result=path.join(directory,'result.json');
   if(!fs.existsSync(file)||fs.existsSync(result))continue;
   const request=read(file),requestHash=hash(JSON.stringify(request));
   try{
    if(requestHash!==name||request.runId!==permit.runId||request.taskId!==permit.taskId||request.projectId!==permit.projectId)fail('HOST_CALL_BINDING_DENIED');
    if(request.tool==='host.rwb_release'&&request.requestId!==releaseRequestId(request.tool,request.args,request.requestId))fail('HOST_CALL_RWB_REQUEST_DENIED');
    if(!permit.effectiveCapabilities?.hostAllowedTools?.includes(request.tool))fail('HOST_CALL_TOOL_DENIED');
    const started=path.join(directory,'started.json');
    if(fs.existsSync(started))fail('HOST_CALL_RESULT_UNKNOWN');
    const fd=fs.openSync(started,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({requestHash,runId:permit.runId,at:new Date().toISOString()})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const output=await executor.execute(request.tool,request.args);
    write(result,resultFor(requestHash,request,null,output));
    log({code:'HOST_CALL_COMPLETED',runId:permit.runId,tool:request.tool,requestHash});
   }catch(error){
    write(result,resultFor(requestHash,request,error));
    log({code:'HOST_CALL_FAILED',runId:permit.runId,tool:request.tool,requestHash,errorCode:error.code??'HOST_CALL_EXECUTION_FAILED'});
   }
  }
 }finally{serving.delete(root);}
}
