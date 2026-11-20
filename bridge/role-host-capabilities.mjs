import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {callHostMcp,runHostCommand} from './role-host-mcp.mjs';

const WORKDISK_UUID='2BC466D2-FD62-4395-86AC-45CFF653BC51';
const shaPattern=/^[a-f0-9]{40,64}$/;
const fail=(code,details)=>{throw Object.assign(new Error(code),{code,...(details?{details}:{})});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value;
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'},boolean={type:'boolean'};
const definition=(name,description,inputSchema)=>Object.freeze({name,description,inputSchema});

export const HOST_TOOL_DEFINITIONS=Object.freeze([
 definition('host.project_inspect','Inspect the registered project, current code candidate and task worktree.',schema()),
 definition('host.project_check','Run a current Native project registered check by ID in the task code worktree.',schema({checkId:string},['checkId'])),
 definition('host.project_git','Read task Git status/diff/show, commit explicit paths, then prepare the managed integration candidate for independent QA. After prepare write the report only; this run keeps its original code mount. QA is read only.',schema({operation:{type:'string',enum:['status','diff','show','commit','prepare']},revision:string,paths:{type:'array',items:string},message:string},['operation'])),
 definition('host.project_publish','Preview or run a registered project delivery entrypoint, with Native QA candidate binding required to publish.',schema({action:{type:'string',enum:['pull_request','merge','deploy']},preview:boolean})),
 definition('host.network_observe','Read current macOS DNS, proxy, Tailscale and proxy application status.',schema()),
 definition('host.network_apply','Run one registered network action authorized by this Native task permit.',schema({actionId:string},['actionId'])),
 definition('host.resources_observe','Read current macOS host disk, memory, CPU, memory pressure and swap observations.',schema()),
 definition('host.resources_apply','Run one registered resource action authorized by this Native task permit.',schema({actionId:string},['actionId'])),
 definition('host.mcp_call','Use tools/list to discover authorized local MCP tool names and input schemas, then tools/call with toolName and arguments. Keeps release/dev servers separate.',schema({serverId:string,operation:{type:'string',enum:['tools/list','tools/call']},toolName:string,arguments:{type:'object'}},['serverId'])),
]);

export function redactHostOutput(value){
 return String(value??'').replace(/\b(Bearer)\s+[^\s"']+/gi,'$1 [REDACTED]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g,'[REDACTED]')
  .replace(/((?:[A-Za-z0-9_]*(?:token|secret|password|api[_-]?key|authorization)[A-Za-z0-9_]*)["']?\s*[:=]\s*)[^\s,;}]+/gi,'$1[REDACTED]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[REDACTED]@').slice(0,48000);
}

function commandEnv(){
 const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_LITERAL_PATHSPECS:'1'};
 for(const key of Object.keys(env))if(/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|REPLACE_REF_BASE|SSH_COMMAND|SSH|NO_VERIFY)/.test(key)||key==='NODE_OPTIONS'||key==='PYTHONPATH'||/^(?:OPENAI|ANTHROPIC|CODEX_CONNECTORS|PAPERCLIP_API)_/.test(key))delete env[key];
 return env;
}

function commandPort({runner=runHostCommand,timeoutMs=120000,signal}={}){
 return async(argv,{cwd,allowedStatuses=[0],timeout=timeoutMs,input}={})=>{
  if(!Array.isArray(argv)||!argv.length||argv.some(x=>typeof x!=='string'||x.includes('\0')))fail('ROLE_HOST_COMMAND_INVALID');
  if(signal?.aborted)fail('ROLE_HOST_CANCELLED');
  let result;try{result=await runner(argv[0],argv.slice(1),{cwd,encoding:'utf8',env:commandEnv(),shell:false,timeout,maxBuffer:512*1024,signal,input});}
  catch{fail(signal?.aborted?'ROLE_HOST_CANCELLED':'ROLE_HOST_COMMAND_UNAVAILABLE');}
  if(signal?.aborted)fail('ROLE_HOST_CANCELLED');
  const details={exitCode:Number.isInteger(result?.status)?result.status:null,signal:result?.signal??null,output:redactHostOutput(result?.stdout),stderr:redactHostOutput(result?.stderr)};
  if(result?.error?.code==='ENOENT')fail('ROLE_HOST_COMMAND_UNAVAILABLE',details);
  if(result?.error?.code==='ETIMEDOUT')fail('ROLE_HOST_COMMAND_TIMEOUT',details);
  if(result?.error?.code==='ENOBUFS')fail('ROLE_HOST_COMMAND_OUTPUT_LIMIT',details);
  if(result?.error||result?.signal||!allowedStatuses.includes(result?.status))fail('ROLE_HOST_COMMAND_FAILED',details);
  return details;
 };
}

function contextOf(permit){
 const context=permit?.projectContext;
 if(!object(context)||context.id!==permit.projectId||!/^[a-z][a-z0-9-]{0,47}$/.test(context.key??''))fail('ROLE_HOST_PROJECT_BINDING_DENIED');
 return context;
}
function rootOf(permit){const root=permit.rootTaskId??permit.taskId;if(typeof root!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(root))fail('ROLE_HOST_ROOT_TASK_DENIED');return root;}
const branchOf=permit=>'codex/'+rootOf(permit)+'-paperclip-work';

function auditPort({permit,log,logRoot}={}){
 if(log)return event=>log({runId:permit.runId,taskId:permit.taskId,rootTaskId:rootOf(permit),projectId:permit.projectId,...event});
 const destination=logRoot??process.env.SUPER_AGENT_LOG_ROOT;
 return event=>{
  // The caller normally supplies the existing host transport logger. Without it,
  // keep logs beside the project worktree root, outside the original Git checkout.
  const context=contextOf(permit),root=destination??(context.workspace?.hostPath?path.join(path.dirname(path.dirname(context.workspace.hostPath)),'logs'):null);
  if(!root||!absolute(root))fail('ROLE_HOST_LOG_ROOT_REQUIRED');
  fs.mkdirSync(root,{recursive:true,mode:0o700});fs.appendFileSync(path.join(root,'role-host-capabilities.jsonl'),JSON.stringify({at:new Date().toISOString(),runId:permit.runId,taskId:permit.taskId,projectId:permit.projectId,...event})+'\n',{mode:0o600});
 };
}

/** All writes to the configured Mac mini disk require its actual UUID and APFS identity. */
async function verifyHostVolume(target,{run}={}){
 if(!target.startsWith('/Volumes/WorkDisk/'))return true;
 let result;try{
  const info=await run(['/usr/sbin/diskutil','info','-plist','/Volumes/WorkDisk']);
  const converted=await run(['/usr/bin/plutil','-convert','json','-o','-','-'],{input:info.output,timeout:5000});result=JSON.parse(converted.output);
 }catch{return false;}
 return result.VolumeUUID===WORKDISK_UUID&&String(result.FilesystemType??'').toLowerCase()==='apfs'&&fs.existsSync('/Volumes/WorkDisk');
}

async function volumeCheck(paths,options,run){for(const value of paths.filter(Boolean))if(await (options.verifyVolume??verifyHostVolume)(value,{run})!==true)fail('ROLE_HOST_VOLUME_IDENTITY_MISMATCH');}
function noSymlinkAncestors(filename){
 let current=filename;while(current!==path.dirname(current)){
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('ROLE_HOST_WORKSPACE_PATH_DENIED');current=path.dirname(current);
 }
}
function substitutions(argv,fields){
 if(!Array.isArray(argv)||!argv.length||argv.some(x=>typeof x!=='string'||x.includes('\0')))fail('ROLE_HOST_COMMAND_INVALID');
 return argv.map(arg=>arg.replace(/\{([A-Za-z]+)\}/g,(match,key)=>{if(typeof fields[key]!=='string')fail('ROLE_HOST_COMMAND_PLACEHOLDER_DENIED');return fields[key];}));
}
function worktrees(text){return text.split('\n\n').filter(Boolean).map(record=>{
 const lines=record.split('\n'),out={};for(const line of lines){if(line.startsWith('worktree '))out.hostPath=line.slice(9);if(line.startsWith('branch '))out.branch=line.slice(7).replace(/^refs\/heads\//,'');if(line.startsWith('HEAD '))out.candidateSha=line.slice(5);}return out;
 });}
async function assertWorkspace({permit,workspace,run}){
 const context=contextOf(permit),target=workspace?.codeHostPath,repository=context.repository?.hostPath;
 if(!absolute(target)||!absolute(repository)||target===repository||workspace.rootTaskId!==rootOf(permit)||workspace.projectId!==context.id||!allowedWorkspace(permit,target,workspace.branch))fail('ROLE_HOST_WORKSPACE_BINDING_DENIED');
 noSymlinkAncestors(target);
 if(!fs.existsSync(target)||!fs.lstatSync(target).isDirectory())fail('ROLE_HOST_WORKSPACE_UNAVAILABLE');
 const git=async(root,args)=>(await run(['/usr/bin/git',...args],{cwd:root})).output.trim();
 const [originalCommon,common,branch,head]=await Promise.all([git(repository,['rev-parse','--path-format=absolute','--git-common-dir']),git(target,['rev-parse','--path-format=absolute','--git-common-dir']),git(target,['symbolic-ref','--short','HEAD']),git(target,['rev-parse','--verify','HEAD'])]);
 if(originalCommon!==common||branch!==workspace.branch||!shaPattern.test(head))fail('ROLE_HOST_WORKSPACE_BINDING_DENIED');
 return head;
}
function allowedWorkspace(permit,target,branch){
 const feature=contextOf(permit).workspace?.hostPath,root=rootOf(permit);
 if(target===feature)return branch===branchOf(permit);
 if(!absolute(target)||!absolute(feature)||path.dirname(target)!==path.dirname(feature))return false;
 const suffix=path.basename(target).slice((root+'-integration').length);
 return (suffix===''||/^-r[1-9][0-9]*$/.test(suffix))&&path.basename(target)===root+'-integration'+suffix&&branch==='codex/integrate-'+root+suffix;
}
function candidateRecord(permit,controlRoot){
 if(!absolute(controlRoot))fail('ROLE_HOST_CANDIDATE_RECORD_DENIED');
 const filename=path.join(controlRoot,'code-workspaces',rootOf(permit),'candidate.json');noSymlinkAncestors(filename);
 let candidate;try{candidate=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{fail('ROLE_HOST_CANDIDATE_RECORD_DENIED');}
 if(candidate.rootTaskId!==rootOf(permit)||candidate.projectId!==permit.projectId||!shaPattern.test(candidate.candidateSha??'')||!allowedWorkspace(permit,candidate.hostPath,candidate.branch))fail('ROLE_HOST_CANDIDATE_RECORD_DENIED');
 return candidate;
}
function recordCandidate({permit,workspace,candidateSha,controlRoot}){
 if(!controlRoot)return;
 if(!absolute(controlRoot)||!shaPattern.test(candidateSha))fail('ROLE_HOST_CANDIDATE_RECORD_DENIED');
 const folder=path.join(controlRoot,'code-workspaces',rootOf(permit));noSymlinkAncestors(folder);fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const value={rootTaskId:rootOf(permit),projectId:permit.projectId,runId:permit.runId,agentId:permit.agentId,taskId:permit.taskId,candidateSha,hostPath:workspace.codeHostPath,branch:workspace.branch};
 const temporary=path.join(folder,'.candidate-'+randomUUID()+'.json');fs.writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,path.join(folder,'candidate.json'));
 return value;
}
function recordCheck({permit,workspace,candidateSha,checkId,status,durationSeconds,controlRoot}){
 if(!controlRoot)return;
 if(!absolute(controlRoot)||!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(permit.runId??''))fail('ROLE_HOST_CHECK_RECORD_DENIED');
 const folder=path.join(controlRoot,'code-workspaces',rootOf(permit),'checks');noSymlinkAncestors(folder);fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const filename=path.join(folder,permit.runId+'.json'),scope={rootTaskId:rootOf(permit),projectId:permit.projectId,runId:permit.runId,agentId:permit.agentId,taskId:permit.taskId,candidateSha};
 let checks=[];if(fs.existsSync(filename)){const previous=JSON.parse(fs.readFileSync(filename,'utf8'));if(Object.keys(scope).some(key=>previous[key]!==scope[key]))fail('ROLE_HOST_CHECK_RECORD_DENIED');checks=previous.checks??[];}
 const value={...scope,checks:[...checks.filter(check=>check.checkId!==checkId),{checkId,status,durationSeconds}]},temporary=path.join(folder,'.check-'+randomUUID()+'.json');
 fs.writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,filename);
}
async function managedProjectDelivery(options,permit,action,run,audit){
 const context=contextOf(permit),request={action,projectRoot:context.repository.hostPath,rootTaskId:rootOf(permit),worktreeRoot:path.dirname(context.workspace.hostPath),permit};
 if(options.projectDelivery)return options.projectDelivery(request,{...options.deliveryPorts,log:audit});
 const entry=fileURLToPath(new URL('../scripts/role-project-delivery.mjs',import.meta.url));
 const result=await run([process.execPath,entry,'--request-stdin'],{cwd:context.repository.hostPath,input:JSON.stringify(request)});
 let value;try{value=JSON.parse(result.output);}catch{fail('ROLE_HOST_DELIVERY_RESULT_INVALID');}return value;
}
async function ownProjectReceipt(permit,run){
 const context=contextOf(permit),root=rootOf(permit),common=(await run(['/usr/bin/git','rev-parse','--path-format=absolute','--git-common-dir'],{cwd:context.repository.hostPath})).output.trim();
 if(!absolute(common))fail('ROLE_HOST_DELIVERY_RECEIPT_DENIED');
 for(const id of [root,'integration'])if(fs.existsSync(path.join(common,'leon-engineering','locks',id+'.lock')))fail('ROLE_HOST_DELIVERY_LOCKED');
 const filename=path.join(common,'leon-engineering','deliveries',root+'.json');noSymlinkAncestors(filename);if(!fs.existsSync(filename))return null;
 let receipt;try{receipt=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{fail('ROLE_HOST_DELIVERY_RECEIPT_DENIED');}
 if(receipt.taskId!==root||receipt.repositoryRoot!==context.repository.hostPath||receipt.featureWorktree!==context.workspace.hostPath||receipt.featureBranch!==branchOf(permit))fail('ROLE_HOST_DELIVERY_RECEIPT_DENIED');return receipt;
}

/** Reuse the original task's isolated Git workspace; never alter the original checkout. */
export async function prepareRoleProjectWorkspace(options={}){
 const {permit}=options,context=contextOf(permit),repository=context.repository?.hostPath,feature=context.workspace?.hostPath;
 if(repository===null||repository===undefined)return {available:false,status:'NOT_CONFIGURED',projectId:context.id,rootTaskId:rootOf(permit),codeHostPath:null};
 if(!absolute(repository)||!absolute(feature)||repository===feature||path.basename(feature)!==rootOf(permit))fail('ROLE_HOST_WORKSPACE_BINDING_DENIED');
 const run=commandPort(options),audit=auditPort(options);
 try{
  let target=feature,branch=branchOf(permit);
  if(permit.codeCandidate||permit.codeReview){
   const candidate=candidateRecord(permit,options.controlRoot),binding=permit.codeCandidate??permit.codeReview;
   if(binding.candidateSha!==candidate.candidateSha||(permit.codeCandidate&&['rootTaskId','projectId','hostPath','branch','runId','agentId','taskId'].some(key=>binding[key]!==candidate[key]))||
    (permit.codeReview&&(binding.rootTaskId!==rootOf(permit)||binding.projectId!==context.id)))fail('ROLE_HOST_REVIEW_CANDIDATE_CHANGED');
   target=candidate.hostPath;branch=candidate.branch;
   if(permit.role==='qa'&&permit.codeCandidate&&context.delivery?.maximumAction!=='artifact'&&target===feature)fail('ROLE_HOST_REVIEW_INTEGRATION_REQUIRED');
  }
  await volumeCheck([repository,target,options.controlRoot],options,run);noSymlinkAncestors(repository);noSymlinkAncestors(target);
  const listed=worktrees((await run(['/usr/bin/git','worktree','list','--porcelain'],{cwd:repository})).output);
  let existing=listed.find(value=>value.hostPath===target);
  if(target!==feature&&!existing)fail('ROLE_HOST_WORKSPACE_BINDING_DENIED');
  if(existing&&existing.branch!==branch)fail('ROLE_HOST_WORKSPACE_COLLISION');
  if(!existing&&fs.existsSync(target))fail('ROLE_HOST_WORKSPACE_COLLISION');
  let reused=Boolean(existing);
  if(existing&&target===feature&&!context.workspace.prepare&&context.delivery?.maximumAction!=='artifact'&&context.delivery?.adapter==='managed-project'&&!fs.existsSync(path.join(repository,'scripts','project-runtime.mjs'))){
   await managedProjectDelivery(options,permit,'workspace',run,audit);
  }
  if(!existing){
   const fields={rootTaskId:rootOf(permit),worktree:target,taskBranch:branch};
   const managed=context.workspace.prepare;
   if(managed){await run(substitutions(managed.argv,fields),{cwd:repository});}
   else if(context.delivery?.maximumAction!=='artifact'&&fs.existsSync(path.join(repository,'scripts','project-runtime.mjs'))){
    const runtime=path.join(repository,'scripts','project-runtime.mjs'),session=rootOf(permit);
    await run([process.execPath,runtime,'session','--start','--new-task','--project',repository,'--host','codex','--session-id',session,'--task-id',rootOf(permit),'--goal','Execute the registered Paperclip project task','--acceptance','Current project checks and independent review','--delivery-required'],{cwd:repository});
    await run([process.execPath,runtime,'delivery','--start','--project',repository,'--task-id',rootOf(permit),'--slug','paperclip-work','--worktree-root',path.dirname(target)],{cwd:repository});
   }else if(context.delivery?.maximumAction!=='artifact'&&context.delivery?.adapter==='managed-project'){
    await managedProjectDelivery(options,permit,'workspace',run,audit);
   }else{
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    const found=await run(['/usr/bin/git','show-ref','--verify','--quiet','refs/heads/'+branch],{cwd:repository,allowedStatuses:[0,1]});
    if(found.exitCode===0)fail('ROLE_HOST_WORKSPACE_BRANCH_COLLISION');
    await run(['/usr/bin/git','worktree','add','-b',branch,target,'HEAD'],{cwd:repository});
   }
  }
  const workspace={available:true,projectId:context.id,rootTaskId:rootOf(permit),codeHostPath:target,containerPath:'/workspace/project',branch,reused};
  const candidateSha=await assertWorkspace({permit,workspace,run});
  if(permit.role==='qa'||permit.codeReview){
   if((await run(['/usr/bin/git','status','--porcelain=v1','-z','--untracked-files=all'],{cwd:target})).output.trim())fail('ROLE_HOST_REVIEW_WORKTREE_DIRTY');
   if((permit.codeCandidate??permit.codeReview)?.candidateSha!==undefined&&(permit.codeCandidate??permit.codeReview).candidateSha!==candidateSha)fail('ROLE_HOST_REVIEW_CANDIDATE_CHANGED');
  }
  audit({code:'ROLE_HOST_WORKSPACE_PREPARED',reused,candidateSha});return {...workspace,candidateSha};
 }catch(error){
  const code=error?.code??'ROLE_HOST_WORKSPACE_FAILED';
  // A volume mismatch must never create a fallback log directory on that volume.
  if(code!=='ROLE_HOST_VOLUME_IDENTITY_MISMATCH'||options.log)audit({code:'ROLE_HOST_WORKSPACE_FAILED',errorCode:code});
  throw error?.code?error:Object.assign(new Error(code),{code});
 }
}

function relativePaths(paths,{required=false}={}){
 if(paths===undefined&&!required)return [];
 if(!Array.isArray(paths)||(required&&!paths.length)||paths.length>256||paths.some(value=>typeof value!=='string'||!value||value==='.'||path.isAbsolute(value)||value.split(/[\\/]/).some(part=>part==='..'||part==='.git')||value.includes('\0')))fail('ROLE_HOST_GIT_PATH_DENIED');return paths;
}
function prohibitedAction(argv){
 const binary=path.basename(argv[0]??''),tail=argv.slice(1).join(' ');
 return ['sh','bash','zsh','fish','osascript','sudo','reboot','shutdown','halt','mkfs','newfs_apfs','newfs_hfs'].includes(binary)||
  (binary==='diskutil'&&/\b(?:erase\w*|partition\w*|apfs\s+delete\w*|unmount\w*\s+force)\b/i.test(tail))||
  (binary==='docker'&&/\b(?:prune|restart)\b/.test(tail))||
  (['rm','unlink','rmdir'].includes(binary)&&/\block\b|\.lock(?:\s|$)/.test(tail))||
  (['kill','killall','pkill'].includes(binary)&&/Docker|com\.docker|dockerd|launchd|WindowServer/i.test(tail))||
  (binary==='open'&&/Docker\.app|\/Applications\/Docker|\sDocker(?:\s|$)/i.test(tail));
}

/** Execute tools selected by Native. Arguments select registered resources, never host shell commands. */
export function createHostCapabilityExecutor(options={}){
 const permit=structuredClone(options.permit),context=contextOf(permit),workspace=options.workspace,run=commandPort(options),audit=auditPort({...options,permit});
 const allowed=new Set(permit.effectiveCapabilities?.hostAllowedTools??[]),hasWorkspace=workspace?.available===true&&absolute(workspace.codeHostPath);
 const selectedMcp=(context.hostMcpServers??[]).filter(value=>object(value)&&typeof value.id==='string'&&Array.isArray(value.tools)&&value.tools.length&&(!value.allowedRoles||value.allowedRoles.includes(permit.role)));
 const definitions=HOST_TOOL_DEFINITIONS.filter(value=>{
  if(!allowed.has(value.name))return false;
  if(['host.project_git','host.project_check','host.project_publish'].includes(value.name)&&!hasWorkspace)return false;
  if(value.name==='host.project_check'&&!context.checks?.length)return false;
  if(value.name==='host.project_publish'&&(permit.role==='qa'||context.delivery?.maximumAction==='artifact'||(!Object.values(context.delivery?.commands??{}).some(command=>Array.isArray(command?.argv)&&command.argv.length)&&context.delivery?.adapter!=='managed-project')))return false;
  return value.name!=='host.mcp_call'||selectedMcp.length>0;
 });
 const git=async(args)=>(await run(['/usr/bin/git',...args],{cwd:workspace.codeHostPath})).output;
 const requireWorkspace=()=>assertWorkspace({permit,workspace,run});
 const fields=candidateSha=>({rootTaskId:rootOf(permit),candidateSha,worktree:workspace.codeHostPath,taskBranch:workspace.branch,projectRoot:context.repository.hostPath});
 const managedDelivery=action=>managedProjectDelivery(options,permit,action,run,audit);
 let preparedCandidate;
 async function observeProbe(argv){try{return {status:'observed',output:(await run(argv,{timeout:10000})).output.trim()};}catch(error){return {status:'NOT_RUN',errorCode:error.code??'ROLE_HOST_COMMAND_UNAVAILABLE'};}}
 async function network(){
  if((options.platform??process.platform)!=='darwin')fail('ROLE_HOST_MACOS_REQUIRED');
  const dns=await observeProbe(['/usr/sbin/scutil','--dns']),proxy=await observeProbe(['/usr/sbin/scutil','--proxy']);
  if(proxy.output)proxy.output=proxy.output.split('\n').filter(line=>/HTTPSEnable|HTTPEnable|HTTPPort|HTTPSPort|SOCKSEnable|SOCKSPort|ProxyAutoConfigEnable/.test(line)).join('\n');
  let tailscale={status:'NOT_RUN',reason:'Existing Tailscale CLI unavailable'};
  for(const binary of ['/usr/local/bin/tailscale','/opt/homebrew/bin/tailscale','/Applications/Tailscale.app/Contents/MacOS/Tailscale'])if((options.exists??fs.existsSync)(binary)){
   try{const value=JSON.parse((await run([binary,'status','--json'],{timeout:10000})).output);tailscale={status:'observed',backendState:value.BackendState,online:value.Self?.Online,peerCount:Object.keys(value.Peer??{}).length};}catch(error){tailscale={status:'NOT_RUN',errorCode:error.code??'ROLE_HOST_OBSERVATION_INVALID'};}break;
  }
  const apps={};for(const name of ['UpNet','Shadowrocket']){let running=null;try{const result=await run(['/usr/bin/pgrep','-x',name],{allowedStatuses:[0,1],timeout:3000});running=result.exitCode===0;}catch{}apps[name]={installed:(options.exists??fs.existsSync)('/Applications/'+name+'.app'),running};}
  return {hostPlatform:'darwin',capturedAt:new Date().toISOString(),source:'macOS host tools',dns,proxy,tailscale,apps};
 }
 async function resources(){
  if((options.platform??process.platform)!=='darwin')fail('ROLE_HOST_MACOS_REQUIRED');
  const volumes=[];for(const mount of options.volumePaths??['/','/Volumes/WorkDisk','/Volumes/SuperAgentDockerData']){
   try{const usage=fs.statfsSync(mount);volumes.push({mount,status:'observed',totalBytes:usage.blocks*usage.bsize,freeBytes:usage.bavail*usage.bsize});}
   catch{volumes.push({mount,status:'NOT_RUN',reason:'Host volume unavailable'});}
  }
  return {hostPlatform:'darwin',capturedAt:new Date().toISOString(),source:'macOS host statfs, os and system tools',volumes,memory:{totalBytes:os.totalmem(),freeBytes:os.freemem(),pressure:await observeProbe(['/usr/bin/memory_pressure','-Q']),swap:await observeProbe(['/usr/sbin/sysctl','-n','vm.swapusage'])},cpu:{count:os.cpus().length,loadAverage:os.loadavg()}};
 }
 async function apply(name,args){
  if((options.platform??process.platform)!=='darwin')fail('ROLE_HOST_MACOS_REQUIRED');
  const scope=name==='host.network_apply'?permit.networkScope:permit.resourceScope;
  if(scope!==undefined&&scope!==null&&(!Array.isArray(scope.actions)||!scope.actions.some(action=>['apply','rollback','verify'].includes(action))))fail('ROLE_HOST_ACTION_SCOPE_DENIED');
  const action=context.hostActions?.find(value=>value?.id===args.actionId),capability=name==='host.network_apply'?'network-engineer':'system-resource-engineer';
  if(!action||!permit.authorizedHostActions?.includes(args.actionId)||action.capability!==capability||!permit.effectiveCapabilities?.capabilityIds?.includes(action.capability)||!action.allowedRoles?.includes(permit.role))fail('ROLE_HOST_ACTION_DENIED');
  if(!Array.isArray(action.argv)||!action.argv.length||action.argv.some(x=>typeof x!=='string'))fail('ROLE_HOST_ACTION_DENIED');
  if(prohibitedAction(action.argv))fail('ROLE_HOST_ACTION_PROHIBITED');
  const cwd=action.cwd??context.repository?.hostPath;if(cwd!==undefined&&cwd!==null&&!absolute(cwd))fail('ROLE_HOST_ACTION_DENIED');
  await volumeCheck([cwd,options.controlRoot],options,run);return {actionId:action.id,...await run(action.argv,{cwd:cwd??undefined})};
 }
 async function perform(name,args){
  if(name==='host.network_observe')return network();if(name==='host.resources_observe')return resources();
  if(name==='host.network_apply'||name==='host.resources_apply')return apply(name,args);
  if(name==='host.mcp_call')return callHostMcp({permit,serverId:args.serverId,operation:args.operation,toolName:args.toolName,arguments:args.arguments,loadServer:options.loadMcpServer,spawnProcess:options.spawnMcp,log:audit,configPath:options.mcpConfigPath,runner:options.runner,timeoutMs:options.mcpTimeoutMs,signal:options.signal});
  if(name==='host.project_inspect'&&!hasWorkspace)return {project:{id:context.id,key:context.key,name:context.name,repository:context.repository},workspace:{status:'NOT_CONFIGURED',containerPath:null},checks:[],delivery:{maximumAction:context.delivery?.maximumAction??'artifact',configured:false},hostMcpServers:selectedMcp.map(({id,tools})=>({id,tools})),hostActions:(context.hostActions??[]).filter(value=>permit.authorizedHostActions?.includes(value.id)).map(({id,capability})=>({id,capability}))};
  const candidateSha=await requireWorkspace();
  if(name==='host.project_inspect')return {project:{id:context.id,key:context.key,name:context.name,repository:context.repository},workspace:{containerPath:'/workspace/project',branch:workspace.branch,candidateSha},status:await git(['status','--short']),checks:(context.checks??[]).map(({id,label,platform})=>({id,label,platform})),delivery:{maximumAction:context.delivery?.maximumAction??'pull_request',configured:Boolean(context.delivery?.commands)},hostMcpServers:(context.hostMcpServers??[]).map(({id,tools})=>({id,tools})),hostActions:(context.hostActions??[]).filter(value=>permit.authorizedHostActions?.includes(value.id)).map(({id,capability})=>({id,capability}))};
  if(name==='host.project_check'){
   const check=context.checks?.find(value=>value.id===args.checkId);if(!check)fail('ROLE_HOST_CHECK_NOT_REGISTERED');
   let argv=check.argv;if(check.platform==='docker'){
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]+$/.test(options.dockerContainerName??''))fail('ROLE_HOST_CHECK_DOCKER_UNAVAILABLE');
    argv=[options.dockerBinary??'/usr/local/bin/docker','--context',options.dockerContext??'desktop-linux','exec','-w','/workspace/project',options.dockerContainerName,...check.argv];
   }else if(check.platform!=='macos')fail('ROLE_HOST_CHECK_PLATFORM_DENIED');
   if(preparedCandidate)fail('ROLE_HOST_CODE_PREPARED_REPORT_ONLY');
   const started=Date.now();try{
    const result=await run(argv,{cwd:workspace.codeHostPath});if(await requireWorkspace()!==candidateSha)fail('ROLE_HOST_CHECK_CANDIDATE_CHANGED');
    recordCheck({permit,workspace,candidateSha,checkId:check.id,status:'passed',durationSeconds:Math.ceil((Date.now()-started)/1000),controlRoot:options.controlRoot});
    return {checkId:check.id,platform:check.platform,candidateSha,...result};
   }catch(error){recordCheck({permit,workspace,candidateSha,checkId:check.id,status:'failed',durationSeconds:Math.ceil((Date.now()-started)/1000),controlRoot:options.controlRoot});throw error;}
  }
  if(name==='host.project_git'){
   const paths=relativePaths(args.paths);let argv;
   if(args.operation==='status')argv=['status','--short'];
   else if(args.operation==='diff')argv=['diff','--no-ext-diff','--no-textconv',...(args.revision?[validRevision(args.revision)]:[]),'--',...paths];
   else if(args.operation==='show')argv=['show','--no-ext-diff','--no-textconv',validRevision(args.revision??'HEAD'),'--',...paths];
   else if(args.operation==='commit'){
    if(permit.role==='qa')fail('ROLE_HOST_GIT_WRITE_DENIED');
    if(preparedCandidate)fail('ROLE_HOST_CODE_PREPARED_REPORT_ONLY');
    if(typeof args.message!=='string'||!args.message.trim()||args.message.length>8192||args.message.includes('\0'))fail('ROLE_HOST_GIT_COMMIT_INVALID');
    relativePaths(args.paths,{required:true});await volumeCheck([workspace.codeHostPath,options.controlRoot],options,run);
    // Resolve symlinked code paths before staging; do not stage a path outside this worktree.
    for(const file of paths){const full=path.resolve(workspace.codeHostPath,file);if(fs.existsSync(full)){const real=fs.realpathSync(full);if(!real.startsWith(workspace.codeHostPath+path.sep))fail('ROLE_HOST_GIT_PATH_DENIED');}}
    await git(['add','--',...paths]);await git(['commit','--only','-m',args.message,'--',...paths]);
    const head=await requireWorkspace();recordCandidate({permit,workspace,candidateSha:head,controlRoot:options.controlRoot});return {operation:'commit',candidateSha:head,exitCode:0};
   }else if(args.operation==='prepare'){
    if(permit.role==='qa')fail('ROLE_HOST_GIT_WRITE_DENIED');
    if(preparedCandidate)fail('ROLE_HOST_CODE_PREPARED_REPORT_ONLY');
    if(context.delivery?.maximumAction==='artifact')fail('ROLE_HOST_DELIVERY_ACTION_DENIED');
    await volumeCheck([workspace.codeHostPath,context.repository.hostPath,options.controlRoot],options,run);
    let result;const configured=context.delivery?.prepareCandidate;
    if(configured?.argv)result=JSON.parse((await run(substitutions(configured.argv,fields(candidateSha)),{cwd:context.repository.hostPath})).output);
    else if(fs.existsSync(path.join(context.repository.hostPath,'scripts','project-runtime.mjs'))){
     const receipt=await ownProjectReceipt(permit,run);
     if(receipt?.status==='prepared'&&receipt.featureCommit===candidateSha)result=receipt;
     else result=JSON.parse((await run([process.execPath,path.join(context.repository.hostPath,'scripts','project-runtime.mjs'),'delivery','--prepare','--project',context.repository.hostPath,'--task-id',rootOf(permit),'--worktree-root',path.dirname(context.workspace.hostPath),...(receipt?.status==='prepared'?['--replace-prepared']:[])],{cwd:context.repository.hostPath})).output);
    }else if(context.delivery?.adapter==='managed-project'||options.projectDelivery)result=await managedDelivery('candidate');
    else fail('ROLE_HOST_DELIVERY_UNAVAILABLE');
    const candidateWorkspace={...workspace,codeHostPath:result.codeHostPath??result.hostPath??result.integrationWorktree,branch:result.branch??result.integrationBranch};
    const expected=result.candidateSha??result.integrationCommit;
    if(candidateWorkspace.codeHostPath===context.workspace.hostPath||!shaPattern.test(expected??''))fail('ROLE_HOST_CANDIDATE_RECORD_DENIED');
    await volumeCheck([candidateWorkspace.codeHostPath],options,run);
    const actual=await assertWorkspace({permit,workspace:candidateWorkspace,run});if(actual!==expected)fail('ROLE_HOST_REVIEW_CANDIDATE_CHANGED');
    preparedCandidate=recordCandidate({permit,workspace:candidateWorkspace,candidateSha:actual,controlRoot:options.controlRoot})??{candidateSha:actual,hostPath:candidateWorkspace.codeHostPath,branch:candidateWorkspace.branch};
    return {operation:'prepare',...(preparedCandidate??{candidateSha:actual,hostPath:candidateWorkspace.codeHostPath,branch:candidateWorkspace.branch}),exitCode:0,next:'Write the report only. Independent QA will mount this integration candidate in its own run.'};
   }else fail('ROLE_HOST_GIT_OPERATION_DENIED');
   return {operation:args.operation,candidateSha,output:await git(argv),exitCode:0};
  }
  if(name==='host.project_publish'){
   const levels=['artifact','pull_request','merge','deploy'],action=args.action??'pull_request',delivery=context.delivery??{},maximum=delivery.maximumAction??'pull_request';
   const rwb=/research[-_ ]?workbench/i.test(context.key+' '+(context.repository?.fullName??'')+' '+(context.repository?.hostPath??''));
   if(permit.role==='qa'||!levels.includes(action)||action==='artifact'||!levels.includes(maximum)||levels.indexOf(action)>levels.indexOf(maximum)||(rwb&&action!=='pull_request'))fail('ROLE_HOST_DELIVERY_ACTION_DENIED');
   const command=delivery.commands?.[action],generic=!command?.argv&&delivery.adapter==='managed-project'&&action==='pull_request'&&!fs.existsSync(path.join(context.repository.hostPath,'scripts','project-runtime.mjs'));
   if(!command?.argv&&!generic)fail('ROLE_HOST_DELIVERY_UNAVAILABLE');
   const argv=command?.argv?substitutions(command.argv,fields(candidateSha)):['managed-project','pull_request'];
   if(args.preview===true)return {status:'preview',action,candidateSha,registeredEntrypoint:path.basename(argv[0]),argv:redactHostOutput(JSON.stringify(argv))};
   const review=permit.codeReview,checks=review?.checks;if(review?.verdict!=='PASS'||review.candidateSha!==candidateSha||review.rootTaskId!==rootOf(permit)||review.projectId!==context.id||
    !Array.isArray(checks)||!checks.length||checks.some(check=>check.status!=='passed'||check.candidateSha!==candidateSha)||
    (context.checks??[]).some(check=>!checks.some(actual=>actual.id===check.id))||review.verification?.status!=='passed')fail('ROLE_HOST_REVIEW_REQUIRED');
   if((await git(['status','--porcelain=v1','-z','--untracked-files=all'])).trim())fail('ROLE_HOST_DELIVERY_WORKTREE_DIRTY');
   await volumeCheck([workspace.codeHostPath,context.repository.hostPath,options.controlRoot],options,run);
   return {action,candidateSha,...(generic?await managedDelivery('pull_request'):await run(argv,{cwd:workspace.codeHostPath}))};
  }
  fail('ROLE_HOST_TOOL_UNKNOWN');
 }
 return Object.freeze({
  listTools:()=>structuredClone(definitions),
  async execute(name,args={}){
   if(!HOST_TOOL_DEFINITIONS.some(value=>value.name===name))fail('ROLE_HOST_TOOL_UNKNOWN');
   if(!allowed.has(name))fail('ROLE_HOST_CAPABILITY_DENIED');if(!object(args))fail('ROLE_HOST_ARGUMENTS_INVALID');
   const started=Date.now();try{const result=await perform(name,args);audit({code:'ROLE_HOST_CALL_COMPLETED',toolName:name,durationMs:Date.now()-started,outputBytes:Buffer.byteLength(JSON.stringify(result))});return result;}
   catch(error){const code=/^ROLE_(?:HOST|PROJECT_DELIVERY)_[A-Z_]+$/.test(error?.code??'')?error.code:'ROLE_HOST_CALL_FAILED';audit({code:'ROLE_HOST_CALL_FAILED',toolName:name,errorCode:code,durationMs:Date.now()-started});throw Object.assign(new Error(code),{code,...(error.details?{details:error.details}:{})});}
  },
 });
}

function validRevision(value){if(typeof value!=='string'||!value||value.length>256||value.startsWith('-')||!/^[-A-Za-z0-9_./~^:@{}]+$/.test(value))fail('ROLE_HOST_GIT_REVISION_DENIED');return value;}
