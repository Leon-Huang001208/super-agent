/** Transport a single already-claimed Native invocation to the existing macOS Codex. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {roleExecutionPolicy,isMacNative} from '../bridge/role-execution-policy.mjs';
import {NATIVE_ROLE_EXTRA_ARGS} from '../bridge/native-role-adapter.mjs';
import {validateRoleCall} from '../docker/role-codex-gate.mjs';
import {validateOpenCodeRoleCall as validateRoleOpenCodeCall} from '../docker/role-opencode-gate.mjs';
import {validateClaudeRoleCall} from '../docker/role-claude-gate.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {createRoleOpenCodeLaunch} from './role-opencode-config.mjs';
import {createRoleClaudeLaunch} from './role-claude-config.mjs';
import {taskRuntimeImplementationFiles,computeTaskRuntimeImplementationBinding} from '../bridge/task-runtime-router.mjs';
import {validateRoleMaterialSnapshot} from '../bridge/role-material-snapshot.mjs';
import {hostRoleInstructionPath} from '../bridge/role-instruction-paths.mjs';
import {createRoleMaterialProjection} from './role-container-transport.mjs';
import {prepareRoleProjectWorkspace,createHostCapabilityExecutor} from '../bridge/role-host-capabilities.mjs';
import {serveHostCapabilityCalls} from '../bridge/role-host-call-queue.mjs';
import {prepareDocumentRuntimeEnvironment} from '../bridge/document-runtime.mjs';
import {roleHostMcpConfigArgs} from './role-host-mcp-config.mjs';
import {createNativeRoleTls} from './role-proxy-tls.mjs';
import {rwbReleaseTimeoutPolicy} from '../bridge/rwb-release.mjs';
import {hostProxyEnvironment as proxyEnvironment} from '../bridge/host-proxy-environment.mjs';
import {prepareNativeNpmCache} from '../bridge/native-npm-cache.mjs';
import {prepareNativePluginCache} from '../bridge/native-plugin-cache.mjs';
import {ROLE_PERMIT_MAX_BYTES} from '../bridge/role-permit-contract.mjs';
const DATA='/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0';
const ROOT=DATA+'/state/control/research-pm';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
/** Bind npm's Codex launcher and its resolved platform binary; native CLIs bind their actual executable bytes. */
export function roleHostCliIdentity(command){
 const entry=fs.realpathSync(command),entrySha256=sha(fs.readFileSync(entry));
 if(path.basename(entry)==='codex.js'&&path.basename(path.dirname(entry))==='bin'){
  const pkg=path.join(path.dirname(entry),'..','package.json');
  if(JSON.parse(fs.readFileSync(pkg)).name==='@openai/codex'){
   const triple=process.arch==='arm64'?'aarch64-apple-darwin':process.arch==='x64'?'x86_64-apple-darwin':null;
   if(!triple||process.platform!=='darwin')fail('ROLE_HOST_CLI_IDENTITY_DENIED');
   let vendor;try{vendor=path.join(path.dirname(createRequire(entry).resolve('@openai/codex-darwin-'+process.arch+'/package.json')),'vendor');}
   catch{vendor=path.join(path.dirname(entry),'..','vendor');}
   const binary=fs.realpathSync(path.join(vendor,triple,'bin','codex'));
   return{cliSha256:sha(JSON.stringify({entrySha256,binarySha256:sha(fs.readFileSync(binary))}))};
  }
 }
 return{cliSha256:entrySha256};
}
function read(filename,maximumBytes=16*1024*1024){
 const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.nlink!==1||(stat.mode&0o077)||stat.size>maximumBytes)fail('ROLE_HOST_FILE_DENIED');
 return fs.readFileSync(filename);
}
function durable(filename,value){const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function hostRolePath(value,dataRoot=DATA){
 if(typeof value!=='string'||!value.startsWith('/paperclip/')||path.posix.normalize(value)!==value)fail('ROLE_HOST_PATH_DENIED');
 return path.join(dataRoot,'state',value.slice('/paperclip/'.length));
}
export function transportExecutor(request,permit){
 if(!isDeepStrictEqual(roleExecutionPolicy(request),roleExecutionPolicy(permit)))fail('ROLE_HOST_EXECUTION_POLICY_CHANGED');
 return roleExecutionPolicy(permit).executor;
}
export function nativeRoleCliArgs({permit,client,instructionPath,endpoint,hostTools=[],mcpScriptPath=fileURLToPath(new URL('../docker/role-host-mcp-server.mjs',import.meta.url))}){
 if(!isMacNative(permit))fail('ROLE_HOST_EXECUTION_POLICY_DENIED');
 const address=new URL(endpoint);if(address.protocol!=='https:'||address.hostname!=='127.0.0.1'||address.pathname!=='/backend-api'||address.username||address.password||address.search||address.hash)fail('ROLE_HOST_BROKER_ENDPOINT_DENIED');
 const settings=NATIVE_ROLE_EXTRA_ARGS.slice(2).filter((value,index,array)=>value!=='sandbox_workspace_write.network_access=true'&&!(value==='-c'&&array[index+1]==='sandbox_workspace_write.network_access=true'));
 return ['--search','exec','--json','--ignore-user-config','--skip-git-repo-check','--model',permit.model,'-c','model_reasoning_effort="low"',
  '--dangerously-bypass-approvals-and-sandbox',...settings,
  '-c','model_catalog_json='+JSON.stringify(client+'/models.json'),'-c','chatgpt_base_url='+JSON.stringify(endpoint),
  // The broker implements Responses SSE; the built-in provider may initiate WebSocket GETs.
  '-c','model_provider="paperclip_broker"','-c','model_providers.paperclip_broker.name="Paperclip task broker"',
  '-c','model_providers.paperclip_broker.base_url='+JSON.stringify(endpoint+'/codex'),
  '-c','model_providers.paperclip_broker.wire_api="responses"','-c','model_providers.paperclip_broker.requires_openai_auth=true',
  '-c','model_providers.paperclip_broker.supports_websockets=false',
  '-c','model_instructions_file='+JSON.stringify(instructionPath),
  ...roleHostMcpConfigArgs(hostTools,{scriptPath:mcpScriptPath,nodePath:process.execPath,endpoint:endpoint+'/role-host-mcp',releaseTimeouts:rwbReleaseTimeoutPolicy(permit)}),'-'];
}
function processTable(){
 const result=spawnSync('/bin/ps',['-axo','pid=,ppid=,pgid=,uid=,lstart=,stat=,comm='],{encoding:'utf8',timeout:2000,maxBuffer:4*1024*1024});
 if(result.error||result.signal||result.status!==0)fail('ROLE_HOST_PROCESS_INSPECTION_UNKNOWN');
 return result.stdout.split('\n').filter(Boolean).map(line=>{
  const match=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/);
  if(!match)fail('ROLE_HOST_PROCESS_INSPECTION_UNKNOWN');
  return {pid:Number(match[1]),ppid:Number(match[2]),pgid:Number(match[3]),uid:Number(match[4]),birth:match[5].replace(/\s+/g,' '),state:match[6],command:match[7]};
 });
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function stateFile(filename,value){
 const temporary=filename+'.tmp-'+randomBytes(6).toString('hex');durable(temporary,value);fs.renameSync(temporary,filename);
}
function ownedProcessGroup(child,{directory,prefix='process',inspect=processTable,command}){
 const known=new Map(),sent=new Set();let leader,live=[];
 const persist=status=>stateFile(directory+'/'+prefix+'-cleanup.json',{schemaVersion:1,status,pgid:child.pid,members:[...known.values()],at:new Date().toISOString()});
 const refresh=()=>{
  const rows=inspect();if(!Array.isArray(rows))fail('ROLE_HOST_PROCESS_INSPECTION_UNKNOWN');
  const group=rows.filter(value=>value.pgid===child.pid&&!value.state.startsWith('Z'));
  if(!leader){leader=group.find(value=>value.pid===child.pid);if(!leader)fail('ROLE_HOST_PROCESS_IDENTITY_UNKNOWN');known.set(leader.pid,leader);}
  if(group.length&&!group.some(value=>known.get(value.pid)?.birth===value.birth&&known.get(value.pid)?.uid===value.uid))fail('ROLE_HOST_PROCESS_GROUP_IDENTITY_UNKNOWN');
  let changed=false;for(const value of group){if(known.get(value.pid)?.birth!==value.birth){known.set(value.pid,value);changed=true;}}
  live=group;
  if(changed)persist('running');return live;
 };
 const signal=signal=>{
  // Recheck each PID and start identity immediately before signaling. The leader may already have exited.
  for(const expected of [...live].sort((a,b)=>(a.pid===child.pid)-(b.pid===child.pid))){
   const key=signal+':'+expected.pid+':'+expected.birth;if(sent.has(key))continue;
   const current=inspect().find(value=>value.pid===expected.pid);
   if(!current||current.state.startsWith('Z'))continue;
   if(current.pgid!==child.pid||current.birth!==expected.birth||current.uid!==expected.uid)fail('ROLE_HOST_PROCESS_GROUP_IDENTITY_UNKNOWN');
   try{process.kill(current.pid,signal);sent.add(key);}catch(error){if(error.code!=='ESRCH')throw error;}
  }
 };
 refresh();return {refresh,signal,persist,get record(){return {schemaVersion:1,pid:child.pid,pgid:child.pid,birth:leader.birth,command,startedAt:new Date().toISOString()};}};
}
async function stopOwnedGroup(group,{graceMs=4000}={}){
 const began=Date.now();
 while(group.refresh().length){
  group.signal(Date.now()-began>=graceMs?'SIGKILL':'SIGTERM');
  if(Date.now()-began>graceMs+4000){group.persist('unknown');fail('ROLE_HOST_PROCESS_CLEANUP_UNKNOWN');}
  await delay(50);
 }
 group.persist('terminated');
}
async function stopDirectChild(child){
 // ChildProcess retains its own unreaped handle, so this does not target a potentially reused PID.
 if(!child||child.exitCode!==null||child.signalCode)return;
 child.kill('SIGTERM');const deadline=Date.now()+4000;
 while(child.exitCode===null&&!child.signalCode&&Date.now()<deadline)await delay(25);
 if(child.exitCode===null&&!child.signalCode){child.kill('SIGKILL');const forced=Date.now()+2000;while(child.exitCode===null&&!child.signalCode&&Date.now()<forced)await delay(25);}
}
export async function runNativeRoleProcess({command,args,directory,cwd,env,timeoutMs=600000,onCancel=()=>{},redactValues=[],inputFile=directory+'/stdin',processInspector=processTable}){
 const input=fs.openSync(inputFile,'r'),out=fs.openSync(directory+'/stdout','wx',0o600),err=fs.openSync(directory+'/stderr','wx',0o600);
 let child,group,cancelled=false,timedOut=false,outputUnknown=false,pending='',outputBytes=0,stoppingAt=null,result=null,closed=false,stderr='';
 const stop=()=>{if(!cancelled){cancelled=true;onCancel();}};
 const consume=line=>{if(!line.trim())return;try{const value=JSON.parse(line);if(value.type?.includes('reasoning')||value.item?.type==='reasoning')return;for(const secret of redactValues)if(secret)line=line.replaceAll(secret,'[redacted]');fs.writeSync(out,line+'\n');}catch{outputUnknown=true;stop();}};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{
  if(fs.existsSync(directory+'/cancel.json'))fail('ROLE_HOST_CANCELLED_BEFORE_START');
  child=spawn(command,args,{shell:false,cwd,env,detached:true,stdio:[input,'pipe','pipe']});
  child.once('exit',(code,signal)=>{result={code,signal};});child.once('close',()=>{closed=true;});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Object.assign(Error('ROLE_HOST_LAUNCH_FAILED'),{code:'ROLE_HOST_LAUNCH_FAILED'})));});
  group=ownedProcessGroup(child,{directory,inspect:processInspector,command});durable(directory+'/process.json',group.record);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{outputBytes+=Buffer.byteLength(chunk);if(outputBytes>8*1024*1024){outputUnknown=true;stop();return;}pending+=chunk;let cut;while((cut=pending.indexOf('\n'))>=0){consume(pending.slice(0,cut));pending=pending.slice(cut+1);}});
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{if(stderr.length+chunk.length>1048576){outputUnknown=true;stop();return;}stderr+=chunk;});
  const deadline=Date.now()+timeoutMs;
  for(;;){
   if(!cancelled&&Date.now()>=deadline){timedOut=true;stop();}if(fs.existsSync(directory+'/cancel.json'))stop();
   const members=group.refresh();
   if(cancelled||result){
    stoppingAt??=Date.now();
    if(members.length)group.signal(Date.now()-stoppingAt>=4000?'SIGKILL':'SIGTERM');
    if(Date.now()-stoppingAt>8000){group.persist('unknown');fail('ROLE_HOST_PROCESS_CLEANUP_UNKNOWN');}
   }
   if(result&&closed&&!members.length)break;
   await delay(50);
  }
  group.persist('terminated');
  if(pending)consume(pending);
  for(const secret of redactValues)if(secret)stderr=stderr.replaceAll(secret,'[redacted]');fs.writeSync(err,stderr);
  if(outputUnknown)fs.writeSync(err,JSON.stringify({code:'ROLE_HOST_OUTPUT_UNKNOWN'})+'\n');
  if(!Number.isInteger(result.code)&&!cancelled)fail('ROLE_HOST_PROCESS_RESULT_UNKNOWN');
  return {exitCode:timedOut?124:cancelled?143:outputUnknown?1:result.code,signal:null,cancelled,timedOut,outputUnknown,
   ...(result.signal?{processSignal:result.signal}:{})};
 }catch(error){
  if(group){try{await stopOwnedGroup(group);}catch{await stopDirectChild(child);group.persist('unknown');}}
  else if(child){await stopDirectChild(child);stateFile(directory+'/process-cleanup.json',{schemaVersion:1,status:'unknown',pid:child.pid,command,reason:'process identity inspection failed',leaderExited:child.exitCode!==null||Boolean(child.signalCode),at:new Date().toISOString()});}
  throw error;
 }finally{
  process.off('SIGTERM',stop);process.off('SIGINT',stop);
  fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(input);fs.closeSync(out);fs.closeSync(err);
 }
}
async function waitBroker(readyFile,child,runId){
 for(let i=0;i<100;i++){
  if(child.exitCode!==null||child.signalCode)fail('ROLE_HOST_BROKER_LAUNCH_FAILED');
  if(fs.existsSync(readyFile)){const ready=JSON.parse(read(readyFile));if(ready.runId!==runId||ready.protocol!=='https:'||ready.host!=='127.0.0.1'||!Number.isInteger(ready.port)||ready.port<1||ready.port>65535)fail('ROLE_HOST_BROKER_READY_DENIED');return 'https://127.0.0.1:'+ready.port+'/backend-api';}
  await new Promise(resolve=>setTimeout(resolve,50));
 }fail('ROLE_HOST_BROKER_READY_TIMEOUT');
}
export async function runHostTransport(runId,{dataRoot=DATA,transportRoot,codexPath='/Users/leon/.local/bin/codex',opencodePath='/Users/leon/.npm-global/bin/opencode',claudePath='/Users/leon/.local/bin/claude',platform=process.platform,npmCacheOptions={},pluginCacheOptions={}}={}){
 if(platform!=='darwin'||!uuid.test(runId??''))fail('ROLE_HOST_TRANSPORT_ARGUMENT_DENIED');
 const root=path.join(dataRoot,'state/control/research-pm'),selectedTransport=transportRoot??root+'/transport';
 if(typeof selectedTransport!=='string'||!path.isAbsolute(selectedTransport)||path.normalize(selectedTransport)!==selectedTransport||fs.realpathSync(selectedTransport)!==selectedTransport)fail('ROLE_HOST_TRANSPORT_ROOT_DENIED');
 const dir=path.join(selectedTransport,runId);
 const log=event=>fs.appendFileSync(root+'/host-transport.jsonl',JSON.stringify({at:new Date().toISOString(),runId,...event})+'\n',{mode:0o600});
 const request=JSON.parse(read(dir+'/request.json')),permitBytes=read(root+'/permits/'+runId+'.json',ROLE_PERMIT_MAX_BYTES),permit=JSON.parse(permitBytes),claim=JSON.parse(read(root+'/claims/'+runId+'.json'));
 if(transportExecutor(request,permit)!=='macos_native')fail('ROLE_HOST_EXECUTION_POLICY_DENIED');
 const runtimeProfile=permit.runtimeProfileId===undefined?RUNTIME_PROFILES.codex_subscription:RUNTIME_PROFILES[permit.runtimeProfileId];
 if(!runtimeProfile||permit.model!==runtimeProfile.model)fail('ROLE_HOST_RUNTIME_PROFILE_DENIED');
 const api=runtimeProfile.runtime!=='codex',claude=runtimeProfile.runtime==='claude';
 if(api&&request.runtimeProfileId!==runtimeProfile.id)fail('ROLE_HOST_RUNTIME_PROFILE_DENIED');
 (claude?validateClaudeRoleCall:api?validateRoleOpenCodeCall:validateRoleCall)({permit,args:request.args,cwd:request.cwd,now:Date.now(),env:{PAPERCLIP_RUN_ID:permit.runId,PAPERCLIP_AGENT_ID:permit.agentId,PAPERCLIP_COMPANY_ID:permit.companyId,PAPERCLIP_TASK_ID:permit.taskId,CODEX_HOME:request.home}});
 if(request.runId!==runId||request.taskId!==permit.taskId||claim.runId!==runId||claim.permitSha256!==sha(permitBytes)||request.inputSha256!==sha(read(dir+'/stdin'))||fs.existsSync(dir+'/host.claim.json')||fs.existsSync(dir+'/cancel.json'))fail('ROLE_HOST_TRANSPORT_BINDING_DENIED');
 const originalMaterial=hostRoleInstructionPath(permit.instructionsFilePath,dataRoot);
 if(sha(read(originalMaterial))!==permit.materialSha256)fail('ROLE_HOST_MATERIAL_CHANGED');
 const cwd=hostRolePath(request.cwd,dataRoot);if(fs.realpathSync(cwd)!==cwd||!fs.lstatSync(cwd).isDirectory())fail('ROLE_HOST_WORKSPACE_DENIED');
 durable(dir+'/host.claim.json',{runId,executor:'macos_native',executionPolicy:permit.executionPolicy,at:new Date().toISOString()});
 const client=dir+'/client',proxy=dir+'/proxy',audit=dir+'/proxy-audit';for(const folder of [client,proxy,audit,client+'/home'])fs.mkdirSync(folder,{mode:0o700});
 const npmCache=await prepareNativeNpmCache({...npmCacheOptions,home:client+'/home'});log({code:'ROLE_NATIVE_NPM_CACHE_CONFIGURED',cacheRoot:npmCache.proof.cacheRoot});
 const pluginCache=api?{verify(){},proof:{status:'not_applicable',runtime:runtimeProfile.runtime}}:await prepareNativePluginCache({...pluginCacheOptions,codexHome:client});
 if(!api)log({code:'ROLE_NATIVE_PLUGIN_CACHE_CONFIGURED',cacheRoot:pluginCache.proof.cacheRoot});
 const snapshot=validateRoleMaterialSnapshot(permit);
 const materialProjection=snapshot?createRoleMaterialProjection({permit,materialRoot:root+'/materials',snapshotRoot:dir+'/material-snapshot',clientRoot:client,log}):null;
 const nativeProjection=snapshot?.nativeInstructions?createRoleMaterialProjection({permit,kind:'native-instructions',materialRoot:hostRoleInstructionPath(permit.materialRoot,dataRoot),snapshotRoot:dir+'/native-instructions',clientRoot:client,log}):null;
 let instructionPath=originalMaterial;
 if(nativeProjection)instructionPath=path.join(nativeProjection.source,path.posix.relative(nativeProjection.target,permit.instructionsFilePath));
 else if(materialProjection)instructionPath=path.join(materialProjection.source,path.posix.relative(materialProjection.target,permit.instructionsFilePath));
 else if(permit.materialFiles){
  const bundle=dir+'/instructions';fs.mkdirSync(bundle,{mode:0o700});
  for(const file of permit.materialFiles){const bytes=read(hostRoleInstructionPath(path.posix.join(permit.materialRoot,file.path),dataRoot));if(sha(bytes)!==file.sha256)fail('ROLE_HOST_MATERIAL_CHANGED');const filename=path.join(bundle,file.path);fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o400});}
  instructionPath=path.join(bundle,path.posix.relative(permit.materialRoot,permit.instructionsFilePath));
 }
 let evidenceRoot;
 if(permit.evidencePacket){
  const source=root+'/team/qa-evidence-v2',manifestBytes=read(source+'/manifest.json');
  if(sha(manifestBytes)!==permit.evidencePacket.manifestSha256)fail('ROLE_HOST_EVIDENCE_CHANGED');
  const manifest=JSON.parse(manifestBytes);if(manifest.rootTaskId!=='7956bcfe-85cd-424a-ac8f-c57752f36dfc'||!Array.isArray(manifest.files)||manifest.files.length>64)fail('ROLE_HOST_EVIDENCE_DENIED');
  evidenceRoot=dir+'/evidence';fs.mkdirSync(evidenceRoot,{mode:0o700});let total=0;
  for(const entry of [...manifest.files,{path:'manifest.json',sha256:sha(manifestBytes)}]){
   if(!/^(?:materials\/[a-z-]+\.md|audit\.json|manifest\.json)$/.test(entry.path))fail('ROLE_HOST_EVIDENCE_DENIED');
   const bytes=read(source+'/'+entry.path);total+=bytes.length;if(total>2097152||sha(bytes)!==entry.sha256)fail('ROLE_HOST_EVIDENCE_CHANGED');
   const target=path.join(evidenceRoot,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{flag:'wx',mode:0o400});
  }
 }
 const advanced=Boolean(permit.projectContext&&permit.effectiveCapabilities),workspace=advanced?await prepareRoleProjectWorkspace({permit,controlRoot:root,log}):{available:false};
 const controller=new AbortController(),hostExecutor=advanced?createHostCapabilityExecutor({permit,workspace,controlRoot:root,executionPolicy:permit.executionPolicy,signal:controller.signal,log}):null;
 const hostTools=hostExecutor?.listTools()??[],key=randomBytes(32).toString('hex');
 const releaseTimeouts=rwbReleaseTimeoutPolicy(permit);
 const subscriptionAuth=api?null:JSON.parse(read(dir+'/provider/auth.json'));
 const delegatedExpiresAt=subscriptionAuth?.delegatedExpiresAt;
 if(delegatedExpiresAt!==undefined&&(!Number.isSafeInteger(delegatedExpiresAt)||delegatedExpiresAt<=Date.now()||delegatedExpiresAt>Date.now()+1800000))fail('ROLE_HOST_DELEGATED_AUTH_EXPIRED');
 const {companySkillSnapshot:_privateSkillSnapshot,...brokerCapabilities}=permit.effectiveCapabilities??{};
 durable(proxy+'/config.json',{runId,key,expiresAt:Math.min(Date.now()+(releaseTimeouts?.brokerMs??660000),delegatedExpiresAt??Infinity),...(api?{runtimeProfileId:runtimeProfile.id}:{}),role:advanced?permit.role:undefined,companyId:permit.companyId,rootTaskId:permit.rootTaskId,authorizedHostActions:permit.authorizedHostActions,taskId:permit.taskId,projectId:permit.projectId,projectContext:permit.projectContext,
  readOnlyToolsOnly:Boolean(snapshot&&permit.projectContext?.delivery?.maximumAction==='artifact'),additionalCapabilities:permit.additionalCapabilities??[],effectiveCapabilities:permit.effectiveCapabilities?brokerCapabilities:undefined,hostTools,mcpAllowedTools:permit.effectiveCapabilities?.mcpAllowedTools??[]});
 if(!api){
 const auth=subscriptionAuth,claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url'));
 const account=auth.tokens.account_id??claims['https://api.openai.com/auth']?.chatgpt_account_id;if(typeof account!=='string'||!account)fail('ROLE_HOST_PROVIDER_ACCOUNT_DENIED');
 const payload={iss:'https://auth.openai.com',sub:'role-'+runId,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),email:'role@local.invalid','https://api.openai.com/auth':{chatgpt_account_id:account,chatgpt_user_id:'role-'+runId,chatgpt_plan_type:'plus'}};
 const token=Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.eA';
 durable(client+'/auth.json',{auth_mode:'chatgpt',tokens:{access_token:key,refresh_token:'role-no-refresh',id_token:token,account_id:account},last_refresh:new Date().toISOString()});
 const models=JSON.parse(read(root+'/models-current.json'));if(!models.models?.some(value=>value.slug==='gpt-6.1-sol'))fail('ROLE_HOST_CATALOG_DENIED');durable(client+'/models.json',models);
 }
 const skillModule=await import('../bridge/role-skill-bundles.mjs');
 const skillAssetRoot=fileURLToPath(new URL('../assets/role-skills/',import.meta.url));
 const roleSkills=permit.effectiveCapabilities?skillModule.materializeEffectiveRoleSkills({codexHome:client,effectiveCapabilities:permit.effectiveCapabilities,assetRoot:skillAssetRoot,packageRoot:permit.effectiveCapabilities.companySkillSnapshot?dir+'/skill-packages':skillAssetRoot}):null;
 if(roleSkills)durable(dir+'/role-skills.json',{...roleSkills,runId});
 let input=read(dir+'/stdin').toString();
 const mappings=[[permit.instructionsFilePath,instructionPath],...(evidenceRoot?[['/qa-evidence',evidenceRoot]]:[]),...(nativeProjection?[[nativeProjection.target,nativeProjection.source]]:[]),...(materialProjection?[[materialProjection.target,materialProjection.source]]:[]),[permit.cwd,cwd],['/workspace/project',workspace.codeHostPath??cwd],['/opt/role-skill-packages',roleSkills?.packageRoot??skillAssetRoot]];
 for(const [from,to]of mappings)input=input.replaceAll(from,to);
 // Native instructions already have an immutable run copy. Preserve the original stdio and record only its digest.
 fs.writeFileSync(dir+'/host-stdin',input,{flag:'wx',mode:0o600});
 const tls=createNativeRoleTls({proxyRoot:proxy,clientRoot:client});
 const readyFile=proxy+'/ready.json',runtime=fileURLToPath(new URL('../',import.meta.url));let broker,brokerGroup,hostTimer,terminal=false;
 try{
  broker=spawn(process.execPath,[runtime+'docker/role-provider-proxy.mjs'],{detached:true,stdio:['ignore','ignore','ignore'],env:{PATH:process.env.PATH,...proxyEnvironment(),SUPER_AGENT_ROLE_PROXY_ROOT:proxy,SUPER_AGENT_ROLE_PROXY_AUDIT:audit,SUPER_AGENT_ROLE_PROXY_AUTH_FILE:dir+'/provider/auth.json',...(api?{SUPER_AGENT_ROLE_API_AUTH_FILE:dir+'/provider/api-auth.json'}:{}),SUPER_AGENT_ROLE_PROXY_LISTEN_HOST:'127.0.0.1',SUPER_AGENT_ROLE_PROXY_PORT:'0',SUPER_AGENT_ROLE_PROXY_TLS_PORT:'0',SUPER_AGENT_ROLE_PROXY_READY_PROTOCOL:'https',SUPER_AGENT_ROLE_PROXY_READY_FILE:readyFile}});
  await new Promise((resolve,reject)=>{broker.once('spawn',resolve);broker.once('error',()=>reject(Object.assign(Error('ROLE_HOST_BROKER_LAUNCH_FAILED'),{code:'ROLE_HOST_BROKER_LAUNCH_FAILED'})));});
  brokerGroup=ownedProcessGroup(broker,{directory:dir,prefix:'broker-process',command:process.execPath});durable(dir+'/broker-process.json',brokerGroup.record);
  const endpoint=await waitBroker(readyFile,broker,runId);
  if(hostExecutor)hostTimer=setInterval(()=>void serveHostCapabilityCalls({root:audit+'/host-calls',permit,executor:hostExecutor,log}).catch(error=>{log({code:'HOST_CALL_QUEUE_FAILED',errorCode:error.code??'HOST_CALL_QUEUE_FAILED'});controller.abort();}),50);
  const documentEnvironment=prepareDocumentRuntimeEnvironment({role:permit.role,runDirectory:client});
  if(permit.role==='document-specialist')documentEnvironment.PAPERCLIP_DOCUMENT_ENGINEERING_RULES=path.join(skillAssetRoot,'shared','engineering.md');
  const launch=claude?createRoleClaudeLaunch({permit,client,cwd,instructionPath,endpoint,key,hostTools,connectors:Boolean(permit.effectiveCapabilities?.mcpAllowedTools?.length),...(releaseTimeouts?{mcpTimeoutMs:releaseTimeouts.mcpSeconds*1000}:{})}):api?createRoleOpenCodeLaunch({permit,client,cwd,endpoint,key,hostTools,skillPaths:roleSkills?[client+'/skills']:[],connectors:Boolean(permit.effectiveCapabilities?.mcpAllowedTools?.length),...(releaseTimeouts?{mcpTimeoutMs:releaseTimeouts.mcpSeconds*1000}:{})}):null;
  if(launch){
   const cacheParent=path.join(path.dirname(npmCache.proof.cacheRoot),runtimeProfile.runtime),cache=path.join(cacheParent,runId);
   fs.mkdirSync(cacheParent,{recursive:true,mode:0o700});
   const stat=fs.lstatSync(cacheParent);
   if(fs.realpathSync(cacheParent)!==cacheParent||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o022))fail('ROLE_HOST_CACHE_PATH_DENIED');
   fs.mkdirSync(cache,{mode:0o700});launch.env.XDG_CACHE_HOME=cache;
   if(claude){fs.mkdirSync(launch.env.CLAUDE_CONFIG_DIR,{recursive:true,mode:0o700});durable(launch.settingsPath,launch.settings);durable(launch.mcpConfigPath,launch.mcpConfig);}
   else durable(launch.env.OPENCODE_CONFIG,launch.config);
  }
  const command=claude?claudePath:api?opencodePath:codexPath,args=launch?.args??nativeRoleCliArgs({permit,client,instructionPath,endpoint,hostTools});
  const implementationRoot=fileURLToPath(new URL('../',import.meta.url));
  const binding=computeTaskRuntimeImplementationBinding({profileId:runtimeProfile.id,files:taskRuntimeImplementationFiles(runtimeProfile.id).map(file=>({file,sha256:sha(fs.readFileSync(path.join(implementationRoot,file)))})),...roleHostCliIdentity(command)});
  const implementation={runId,profileId:runtimeProfile.id,modelId:runtimeProfile.providerModel,runtimeId:runtimeProfile.runtime,...binding,argsSha256:sha(JSON.stringify(args)),
   configSha256:sha(launch?claude?Buffer.concat([fs.readFileSync(launch.settingsPath),fs.readFileSync(launch.mcpConfigPath)]):fs.readFileSync(launch.env.OPENCODE_CONFIG):JSON.stringify(args)),npmCacheVerified:npmCache.proof.volumeVerified===true,freshSession:!args.some(value=>['resume','--resume','--session','--continue'].includes(value))};
  const result=await runNativeRoleProcess({command,args,directory:dir,inputFile:dir+'/host-stdin',cwd,timeoutMs:releaseTimeouts?.processMs??600000,
   env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',HOME:client+'/home',CODEX_HOME:client,CODEX_CONNECTORS_TOKEN:key,ROLE_HOST_MCP_ENDPOINT:endpoint+'/role-host-mcp',...(releaseTimeouts?{ROLE_HOST_RWB_RELEASE:'1'}:{}),SSL_CERT_FILE:tls.trustFile,CODEX_CA_CERTIFICATE:tls.trustFile,NODE_EXTRA_CA_CERTS:tls.caFile,...proxyEnvironment(),...documentEnvironment,...npmCache.environment,...(launch?.env??{})},redactValues:[key],onCancel:()=>controller.abort()});
  pluginCache.verify();
  durable(dir+'/implementation-proof.json',implementation);
  durable(dir+'/native-proof.json',{schemaVersion:1,runId,executor:'macos_native',platform:process.platform,...(api?{runtimeProfileId:runtimeProfile.id,runtime:runtimeProfile.runtime,...(claude?{claudePath}:{opencodePath})}:{codexPath}),cwd,executionPolicy:permit.executionPolicy,skillManifestSha256:roleSkills?.sha256,inputSha256:sha(input),process:JSON.parse(read(dir+'/process.json')),npmCache:npmCache.proof,pluginCache:pluginCache.proof,...(permit.role==='document-specialist'?{documentRuntime:{status:documentEnvironment.PAPERCLIP_DOCUMENT_RUNTIME_STATUS,python:documentEnvironment.PAPERCLIP_DOCUMENT_PYTHON,soffice:documentEnvironment.PAPERCLIP_DOCUMENT_SOFFICE,fontConfig:documentEnvironment.FONTCONFIG_FILE}}:{}),at:new Date().toISOString()});
  await stopOwnedGroup(brokerGroup);brokerGroup=null;
  for(const filename of [client+'/auth.json',proxy+'/config.json'])if(fs.existsSync(filename))fs.unlinkSync(filename);
  durable(dir+'/result.json',{runId,...result,executor:'macos_native',stdoutSha256:sha(fs.readFileSync(dir+'/stdout')),stderrSha256:sha(fs.readFileSync(dir+'/stderr')),at:new Date().toISOString()});terminal=true;log({code:'ROLE_HOST_TRANSPORT_COMPLETED',exitCode:result.exitCode});return result;
 }finally{
  clearInterval(hostTimer);controller.abort();if(brokerGroup){try{await stopOwnedGroup(brokerGroup);}catch(error){await stopDirectChild(broker);brokerGroup.persist('unknown');throw error;}}else if(broker&&!terminal){await stopDirectChild(broker);stateFile(dir+'/broker-process-cleanup.json',{schemaVersion:1,status:'unknown',pid:broker.pid,reason:'broker identity inspection failed',at:new Date().toISOString()});}
  if(terminal)for(const filename of [client+'/auth.json',proxy+'/config.json',tls.keyFile])if(fs.existsSync(filename))fs.unlinkSync(filename);
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))runHostTransport(process.argv[2]).then(result=>console.log(JSON.stringify({runId:process.argv[2],executor:'macos_native',exitCode:result.exitCode}))).catch(error=>{console.error(JSON.stringify({code:/^ROLE_[A-Z_]+$/.test(error.code??'')?error.code:'ROLE_HOST_TRANSPORT_UNKNOWN',causeCode:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:undefined,runId:process.argv[2]}));process.exitCode=1;});
