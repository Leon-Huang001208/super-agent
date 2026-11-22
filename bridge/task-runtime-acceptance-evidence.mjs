import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {RUNTIME_PROFILES} from './role-runtime-profiles.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from './role-execution-policy.mjs';

const fail=suffix=>{const code='TASK_RUNTIME_ACCEPTANCE_'+suffix;throw Object.assign(Error(code),{code});};
const sha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const time=value=>value instanceof Date?Number.isFinite(value.getTime()):typeof value==='string'&&Number.isFinite(Date.parse(value));
const fixed=['result.json','stdout','stderr','implementation-proof.json','native-proof.json','process-cleanup.json','broker-process.json','broker-process-cleanup.json','proxy-audit/provider.jsonl'];
function parse(bytes){try{const value=JSON.parse(bytes);if(plain(value))return value;}catch{}fail('SOURCE_JSON_INVALID');}
function lines(bytes){
 const result=[];let start=0,index=0;
 while(start<bytes.length){let end=bytes.indexOf(10,start);if(end<0)end=bytes.length;const raw=bytes.subarray(start,end);index++;
  if(raw.toString('utf8').trim()){if(raw.length>1048576)fail('SOURCE_LIMIT');result.push({value:parse(raw),line:index,sha256:sha(raw)});}
  start=end+1;
 }
 return result;
}
function view(run){
 if(!plain(run)||![run.id,run.issueId,run.agentId].every(uuid)||run.status!=='succeeded'||!time(run.finishedAt)||
  run.exitCode!=null&&run.exitCode!==0||run.signal!=null||run.errorCode||run.error||run.contextSnapshot?.forceFreshSession!==true||
  !count(run.usageJson?.inputTokens)||run.usageJson.inputTokens<1||!count(run.usageJson?.outputTokens)||run.usageJson.outputTokens<1)fail('RUN_NOT_PROVEN');
 return{id:run.id,issueId:run.issueId,agentId:run.agentId,status:run.status,exitCode:run.exitCode??null,finishedAt:new Date(run.finishedAt).toISOString(),
  projectId:run.contextSnapshot.projectId??null,inputTokens:run.usageJson.inputTokens,outputTokens:run.usageJson.outputTokens};
}
function runtimeTools(runtime,records){
 const found=new Map(),pending=new Map();let terminal=false;
 const add=(name,record,sourceTool,resultRecord=record)=>{if(!found.has(name))found.set(name,{name,sourceTool,request:record,result:resultRecord});};
 for(const record of records){
  const event=record.value;
  if(event.type==='error'||event.type==='turn.failed')fail('RUNTIME_ERROR');
  if(runtime==='codex'){
   if(event.type==='turn.started')terminal=false;
   if(event.type==='turn.completed')terminal=true;
   if(event.type!=='item.completed')continue;
   const item=event.item;if(!plain(item))fail('TOOL_FORMAT_UNKNOWN');
   if(item.type==='command_execution'){
    if(['failed','error','errored','cancelled'].includes(item.status))continue;
    if(item.status!=='completed'||!Number.isInteger(item.exit_code))fail('TOOL_FORMAT_UNKNOWN');
    if(item.exit_code===0)add('shell',record,'command_execution');
   }else if(item.type==='file_change'){
    if(['failed','error','errored','cancelled'].includes(item.status))continue;
    if(item.status!=='completed'||!Array.isArray(item.changes)||!item.changes.length||
     item.changes.some(change=>!plain(change)||!['add','update','delete'].includes(change.kind)||typeof change.path!=='string'||!change.path))fail('TOOL_FORMAT_UNKNOWN');
    add('file_write',record,'file_change');
   }
  }else if(runtime==='opencode'){
   if(event.type==='step_start')terminal=false;
   if(event.type==='step_finish')terminal=true;
   if(event.type!=='tool_use')continue;
   const part=event.part,state=part?.state;
   if(!plain(part)||typeof part.tool!=='string'||!plain(state))fail('TOOL_FORMAT_UNKNOWN');
   if(!['bash','write','edit','apply_patch'].includes(part.tool))continue;
   if(['pending','running','error','failed','cancelled'].includes(state.status))continue;
   if(state.status!=='completed'||state.error!=null)fail('TOOL_FORMAT_UNKNOWN');
   if(part.tool==='bash'){
    if(!Number.isInteger(state.metadata?.exit))fail('TOOL_FORMAT_UNKNOWN');
    if(state.metadata.exit===0)add('shell',record,'bash');
   }else add('file_write',record,part.tool);
  }else if(runtime==='claude'){
   if(event.type==='result'){
    if(event.subtype!=='success'||event.is_error===true||event.error!=null||Array.isArray(event.errors)&&event.errors.length)fail('RUNTIME_ERROR');
    terminal=true;
   }
   const blocks=event.message?.content;
   if(!Array.isArray(blocks))continue;
   if(event.type==='assistant')for(const block of blocks){
    if(block.type!=='tool_use'||!['Bash','Write','Edit','MultiEdit'].includes(block.name))continue;
    if(typeof block.id!=='string'||!block.id||pending.has(block.id))fail('TOOL_FORMAT_UNKNOWN');
    pending.set(block.id,{record,name:block.name});
   }
   if(event.type==='user')for(const block of blocks){
    if(block.type!=='tool_result'||!pending.has(block.tool_use_id))continue;
    const call=pending.get(block.tool_use_id);pending.delete(block.tool_use_id);
    if(block.is_error===true)continue;
    const result=event.tool_use_result;
    if(!plain(result)||result.error!=null)fail('TOOL_FORMAT_UNKNOWN');
    if(call.name==='Bash'){
     if(result.interrupted!==false)fail('TOOL_FORMAT_UNKNOWN');
     const exit=result.exitCode??result.exit_code;
     if(exit!==undefined&&!Number.isInteger(exit))fail('TOOL_FORMAT_UNKNOWN');
     if(exit!==undefined&&exit!==0)continue;
     add('shell',call.record,'Bash',record);
    }else{
     if(typeof result.filePath!=='string'||!result.filePath)fail('TOOL_FORMAT_UNKNOWN');
     add('file_write',call.record,call.name,record);
    }
   }
  }else fail('RUNTIME_UNSUPPORTED');
 }
 if(!terminal||pending.size)fail('RUNTIME_TERMINAL_UNKNOWN');
 return found;
}

/** Operator-only formatter. Readers own the private run directory and management identity; no model tools, writes, DB mutations or new runs. */
export function createTaskRuntimeAcceptanceEvidence({readRun,readRunFile,listHostCalls}={}){
 if([readRun,readRunFile,listHostCalls].some(fn=>typeof fn!=='function'))fail('PORT_INVALID');
 return async function build(input){
  if(!plain(input)||Object.keys(input).some(key=>!['runId','profileId','taskTypes','operatorId'].includes(key))||!uuid(input.runId)||
   !Object.hasOwn(RUNTIME_PROFILES,input.profileId??'')||!['codex','opencode','claude'].includes(RUNTIME_PROFILES[input.profileId].runtime)||
   !Array.isArray(input.taskTypes)||input.taskTypes.length<1||input.taskTypes.length>8||new Set(input.taskTypes).size!==input.taskTypes.length||
   input.taskTypes.some(value=>typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value))||
   typeof input.operatorId!=='string'||!input.operatorId.trim()||input.operatorId.length>256||/[\x00-\x1f\x7f]/.test(input.operatorId))fail('INPUT_INVALID');
  const {runId,profileId}=input,profile=RUNTIME_PROFILES[profileId],sources=new Map();let total=0;
  const getRun=async()=>{try{return await readRun(runId);}catch{fail('READ_UNAVAILABLE');}};
  const load=async name=>{
   let bytes;try{const value=await readRunFile(runId,name);if(typeof value!=='string'&&!Buffer.isBuffer(value)&&!(value instanceof Uint8Array))fail('READ_UNAVAILABLE');bytes=Buffer.from(value);}catch{fail('READ_UNAVAILABLE');}
   total+=bytes.length;if(bytes.length>4194304||total>12582912)fail('SOURCE_LIMIT');
   sources.set(name,{file:name,sha256:sha(bytes),bytes:bytes.length});return bytes;
  };
  const first=view(await getRun());if(first.id!==runId)fail('RUN_BINDING_DENIED');
  const loaded=await Promise.all(fixed.map(async name=>[name,await load(name)])),raw=new Map(loaded),json=name=>parse(raw.get(name));
  const transport=json('result.json'),implementation=json('implementation-proof.json'),native=json('native-proof.json'),process=json('process-cleanup.json'),broker=json('broker-process-cleanup.json'),brokerProcess=json('broker-process.json');
  if(transport.runId!==runId||transport.exitCode!==0||transport.signal!==null||transport.processSignal!=null||transport.executor!=='macos_native'||
   !['timedOut','cancelled','outputUnknown'].every(key=>transport[key]===false)||transport.stdoutSha256!==sha(raw.get('stdout'))||transport.stderrSha256!==sha(raw.get('stderr')))fail('TRANSPORT_NOT_PROVEN');
  if(native.runId!==runId||native.executor!=='macos_native'||native.platform!=='darwin'||!equal(native.executionPolicy,MACOS_NATIVE_EXECUTION_POLICY)||native.npmCache?.volumeVerified!==true||
   typeof native[profile.runtime+'Path']!=='string'||!native[profile.runtime+'Path'].startsWith('/')||
   profile.runtime!=='codex'&&(native.runtimeProfileId!==profileId||native.runtime!==profile.runtime))fail('NATIVE_NOT_PROVEN');
  if(process.status!=='terminated'||broker.status!=='terminated'||!Number.isInteger(native.process?.pgid)||native.process.pgid<1||
   process.pgid!==native.process.pgid||!Number.isInteger(brokerProcess.pgid)||brokerProcess.pgid<1||broker.pgid!==brokerProcess.pgid||
   process.runId!==undefined&&process.runId!==runId||broker.runId!==undefined&&broker.runId!==runId)fail('CLEANUP_NOT_PROVEN');
  if(implementation.runId!==runId||implementation.profileId!==profileId||implementation.modelId!==profile.providerModel||implementation.runtimeId!==profile.runtime||
   !['sourceSha256','cliSha256','argsSha256','configSha256'].every(key=>hash(implementation[key]))||implementation.npmCacheVerified!==true||implementation.freshSession!==true)fail('IMPLEMENTATION_NOT_PROVEN');
  const audit=lines(raw.get('proxy-audit/provider.jsonl'));
  if(!audit.some(record=>['ROLE_PROXY_READY','ROLE_PROXY_TLS_READY'].includes(record.value.code)&&record.value.runId===runId))fail('BROKER_RUN_NOT_PROVEN');
  const optionalPath='/backend-api/ps/plugins/tooling-state/turtle';
  const denials=audit.filter(({value})=>typeof value.code==='string'&&/DENIED|AUTH_REQUIRED|EXPIRED/.test(value.code));
  if(denials.some(({value})=>profile.runtime!=='codex'||value.code!=='ROLE_PROXY_PATH_DENIED'||value.path!==optionalPath||
   value.runId!==undefined&&value.runId!==runId||value.profileId!==undefined&&value.profileId!==profileId))fail('AUDIT_DENIAL');
  const completions=audit.filter(record=>profile.runtime==='codex'?record.value.code==='ROLE_PROXY_COMPLETED'&&record.value.path==='/backend-api/codex/responses':record.value.code==='ROLE_API_COMPLETED');
  if(!completions.length||completions.length>64||completions.some(({value})=>!Number.isInteger(value.status)||value.status<200||value.status>=300||!Number.isInteger(value.requestCount)||value.requestCount<1||value.requestCount>64||
   profile.runtime!=='codex'&&(value.runId!==runId||value.profileId!==profileId||value.model!==profile.providerModel||value.provider!==profile.provider))||
   profile.runtime==='codex'&&(profile.providerModel!=='gpt-6.1-sol'||profile.reasoningEffort!=='low'))fail('MODEL_NOT_OBSERVED');
  const observed=runtimeTools(profile.runtime,lines(raw.get('stdout'))),hostTools=[];
  let hostNames;try{hostNames=await listHostCalls(runId);}catch{fail('READ_UNAVAILABLE');}
  if(!Array.isArray(hostNames)||hostNames.length>64||hostNames.some(name=>!hash(name))||new Set(hostNames).size!==hostNames.length)fail('HOST_INDEX_INVALID');
  for(const name of [...hostNames].sort()){
   const requestFile='proxy-audit/host-calls/'+name+'/request.json',resultFile='proxy-audit/host-calls/'+name+'/result.json',requestBytes=await load(requestFile),resultBytes=await load(resultFile),request=parse(requestBytes),result=parse(resultBytes);
   if(sha(JSON.stringify(request))!==name||request.runId!==runId||request.taskId!==first.issueId||!uuid(first.projectId)||request.projectId!==first.projectId||
    result.runId!==runId||result.requestHash!==name||result.error!=null)fail('HOST_CALL_NOT_PROVEN');
   if(request.tool==='host.project_inspect'){
    if(!plain(result.result?.project))fail('HOST_CALL_NOT_PROVEN');
    hostTools.push({name:'host.project_inspect',sourceRequestHash:name,sourceRequestSha256:sha(requestBytes),sourceResultSha256:sha(resultBytes)});
   }
  }
  if(!observed.size&&!hostTools.length)fail('TOOLS_NOT_PROVEN');
  const lastRun=await getRun();let last;try{last=view(lastRun);}catch{fail('RUN_CHANGED');}
  if(!equal(first,last))fail('RUN_CHANGED');
  const files=[],prefix='runs/'+runId+'/',store=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value)+'\n'),file=prefix+name;files.push({file,bytes});return{file,sha256:sha(bytes)};};
  const sourceSha=name=>sources.get(name).sha256;
  const evidence={run:store('run.json',{id:runId,issueId:last.issueId,agentId:last.agentId,status:last.status,exitCode:last.exitCode,finishedAt:last.finishedAt,sourceNativeRunSha256:sha(JSON.stringify(lastRun))}),
   transport:store('transport.json',{runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:transport.stdoutSha256,stderrSha256:transport.stderrSha256,sourceFileSha256:sourceSha('result.json')}),
   processCleanup:store('process-cleanup.json',{runId,status:'terminated',sourceFileSha256:sourceSha('process-cleanup.json'),sourceNativeProofSha256:sourceSha('native-proof.json')}),
   brokerCleanup:store('broker-cleanup.json',{runId,status:'terminated',sourceFileSha256:sourceSha('broker-process-cleanup.json'),sourceProcessSha256:sourceSha('broker-process.json')}),
   model:store('model.json',{runId,profileId,modelId:profile.providerModel,runtimeId:profile.runtime,observed:true,sourceAuditSha256:sourceSha('proxy-audit/provider.jsonl'),
    sourceEventSha256:completions.map(record=>record.sha256),guardSourceSha256:implementation.sourceSha256,
    ...(denials.length?{optionalMetadata:[{code:'ROLE_PROXY_PATH_DENIED',path:optionalPath,status:'NOT_RUN',disposition:'denied-as-designed',count:denials.length,
     sourceEventSha256:denials.map(record=>record.sha256)}]}:{})}),
   usage:store('usage.json',{runId,inputTokens:last.inputTokens,outputTokens:last.outputTokens,unknownCost:true,sourceNativeRunSha256:sha(JSON.stringify(lastRun))}),
   implementation:store('implementation.json',{runId,profileId,modelId:profile.providerModel,runtimeId:profile.runtime,
    ...Object.fromEntries(['sourceSha256','cliSha256','argsSha256','configSha256','npmCacheVerified','freshSession'].map(key=>[key,implementation[key]])),sourceFileSha256:sourceSha('implementation-proof.json'),sourceNativeProofSha256:sourceSha('native-proof.json')}),tools:[]};
  const addTool=(name,request,result)=>{const index=evidence.tools.length,requestRef=store('tools/'+index+'-request.json',{runId,tool:name,...request});
   evidence.tools.push({name,request:requestRef,result:store('tools/'+index+'-result.json',{runId,status:'succeeded',requestSha256:requestRef.sha256,...result})});};
  for(const observation of [...observed.values()].sort((a,b)=>a.name.localeCompare(b.name)))addTool(observation.name,
   {sourceToolName:observation.sourceTool,sourceStdoutSha256:transport.stdoutSha256,sourceEventSha256:observation.request.sha256,sourceLine:observation.request.line},
   {sourceStdoutSha256:transport.stdoutSha256,sourceEventSha256:observation.result.sha256,sourceLine:observation.result.line});
  if(hostTools.length){const {name,...origin}=hostTools[0];addTool(name,origin,{sourceResultSha256:origin.sourceResultSha256});}
  const tools=[...new Set(evidence.tools.map(tool=>tool.name))].sort(),receipt={schemaVersion:1,kind:'isolated-runtime-acceptance',id:runId,status:'PASS',profileId,modelId:profile.providerModel,runtimeId:profile.runtime,taskTypes:[...input.taskTypes],tools,evidence};
  const receiptRef=store('acceptance-receipt.json',receipt),registration={id:runId,status:'ACTIVE',profileId,modelId:profile.providerModel,runtimeId:profile.runtime,receipt:receiptRef,implementationSha256:evidence.implementation.sha256};
  store('source-references.json',{runId,files:[...sources.values()].sort((a,b)=>a.file.localeCompare(b.file))});
  return{files,registration,receipt,index:{schemaVersion:1,operatorId:input.operatorId,entries:[registration]}};
 };
}
