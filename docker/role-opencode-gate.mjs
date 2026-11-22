import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {executeIsolatedRole} from '../bridge/role-isolated-transport.mjs';
import {roleExecutionPolicy} from '../bridge/role-execution-policy.mjs';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {ROLE_PERMIT_MAX_BYTES} from '../bridge/role-permit-contract.mjs';
import {validateRoleMaterialSnapshot,ROLE_MATERIAL_ROOT} from '../bridge/role-material-snapshot.mjs';
import {isRoleInstructionPermitPath} from '../bridge/role-instruction-paths.mjs';

const ROOT='/paperclip/control/research-pm',uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
function readPrivate(filename,maximumBytes=262144){
 let cursor='/';for(const part of filename.slice(1).split('/')){
  cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor);
  if(stat.isSymbolicLink()||stat.uid!==0||((stat.mode&0o022)&&!(cursor==='/tmp'&&(stat.mode&0o1777)===0o1777)))fail('ROLE_OPENCODE_GATE_PATH_DENIED');
 }
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>maximumBytes||(stat.mode&0o077))fail('ROLE_OPENCODE_GATE_FILE_DENIED');return fs.readFileSync(fd);}
 finally{fs.closeSync(fd);}
}
function materialAndProjectScope(permit){
 if(permit.projectContext&&permit.projectContext.id!==permit.projectId)return false;
 if(permit.effectiveCapabilities&&(permit.effectiveCapabilities.role!==permit.role||!Array.isArray(permit.effectiveCapabilities.capabilityIds)||
  !permit.effectiveCapabilities.capabilityIds.includes(permit.role)||permit.effectiveCapabilities.capabilityIds.some(role=>!ROLE_KEYS.includes(role))))return false;
 if(!permit.materialFiles)return true;
 const root=permit.materialSourcePath?path.dirname(path.dirname(permit.instructionsFilePath)):path.dirname(permit.instructionsFilePath);
 if(permit.materialRoot!==root||!Array.isArray(permit.materialFiles)||!permit.materialFiles.length||permit.materialFiles.length>32)return false;
 const seen=new Set();for(const file of permit.materialFiles){
  if(typeof file.path!=='string'||path.posix.normalize(file.path)!==file.path||path.posix.isAbsolute(file.path)||file.path.includes('\\')||
   file.path.split('/').some(part=>!part||part==='..'||part==='.')||seen.has(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256??''))return false;
  seen.add(file.path);
 }
 return permit.materialFiles.some(file=>path.join(root,file.path)===permit.instructionsFilePath&&file.sha256===permit.materialSha256);
}

/** API routing has its own fixed contract; it never impersonates a Codex call. */
export function validateOpenCodeRoleCall({permit,args,env,cwd,now}){
 let policy;try{policy=roleExecutionPolicy(permit);}catch{fail('ROLE_OPENCODE_GATE_SCOPE_DENIED');}
 let materialSnapshot;try{materialSnapshot=validateRoleMaterialSnapshot(permit);}catch{fail('ROLE_OPENCODE_GATE_MATERIAL_SNAPSHOT_DENIED');}
 const profile=Object.hasOwn(RUNTIME_PROFILES,permit?.runtimeProfileId??'')?RUNTIME_PROFILES[permit.runtimeProfileId]:null;
 const marker=env.OPENCODE_CONFIG;
 if(!permit||permit.schemaVersion!==1||!ROLE_KEYS.includes(permit.role)||!profile||profile.runtime!=='opencode'||policy.executor!=='macos_native'||
  !['runId','taskId','agentId','companyId','projectId','credentialGrantId'].every(key=>uuid.test(permit[key]??''))||
  permit.model!==profile.model||permit.reasoningEffort!==null||permit.apiFallback!==false||
  !Number.isSafeInteger(permit.expiresAt)||!Number.isSafeInteger(now)||permit.expiresAt<=now||permit.expiresAt-now>300000||
  permit.cwd!==cwd||!(cwd.startsWith(ROOT+'/workspaces/')||cwd==='/paperclip/instances/default/projects/'+permit.companyId+'/'+permit.projectId+'/_default')||
  !/^[a-f0-9]{64}$/.test(permit.materialSha256??'')||(!materialSnapshot&&!isRoleInstructionPermitPath(permit))||!materialAndProjectScope(permit)||
  ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','MINIMAX_API_KEY','MINIMAX_BASE_URL',
   'ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','SUPER_AGENT_ROLE_PROVIDER_API_KEY','OPENCODE_CONFIG_CONTENT','OPENCODE_CONFIG_DIR','OPENCODE_PERMISSION','OPENCODE_AUTH_JSON'].some(key=>Boolean(env[key]))||
  (marker!==undefined&&marker!==ROOT+'/opencode-clients/'+permit.agentId+'/config.json')||
  (env.CODEX_HOME!==undefined&&!new RegExp('^/tmp/paperclip-ai-'+permit.companyId+'-'+permit.credentialGrantId+'-[A-Za-z0-9]+/provider$').test(env.CODEX_HOME))||
  env.PAPERCLIP_RUN_ID!==permit.runId||env.PAPERCLIP_AGENT_ID!==permit.agentId||env.PAPERCLIP_COMPANY_ID!==permit.companyId||env.PAPERCLIP_TASK_ID!==permit.taskId)fail('ROLE_OPENCODE_GATE_SCOPE_DENIED');
 if(permit.evidencePacket&&(permit.role!=='qa'||permit.evidencePacket.name!=='qa-evidence-v2'||!/^[a-f0-9]{64}$/.test(permit.evidencePacket.manifestSha256??'')))fail('ROLE_OPENCODE_GATE_EVIDENCE_DENIED');
 const expected=['run','--format','json','--model',permit.model,'--dir',permit.cwd];
 if(!Array.isArray(args)||JSON.stringify(args)!==JSON.stringify(expected))fail('ROLE_OPENCODE_GATE_ARGUMENTS_DENIED');
 return permit;
}
export function validateHostRuntimeCatalog(catalog,{now=Date.now()}={}){
 const captured=Date.parse(catalog?.capturedAt),models=Object.values(RUNTIME_PROFILES).filter(profile=>['codex','opencode'].includes(profile.runtime)).map(profile=>profile.model);
 if(catalog?.schemaVersion!==1||catalog.hostPlatform!=='darwin'||!Number.isSafeInteger(now)||!Number.isSafeInteger(captured)||captured>now||now-captured>1800000||
  !Number.isSafeInteger(catalog.expiresAt)||catalog.expiresAt<=now||catalog.expiresAt<=captured||catalog.expiresAt-captured>1800000||
  typeof catalog.opencode?.path!=='string'||!path.posix.isAbsolute(catalog.opencode.path)||path.posix.normalize(catalog.opencode.path)!==catalog.opencode.path||
  !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/.test(catalog.opencode?.version??'')||!Array.isArray(catalog.models)||catalog.models.length!==models.length||
  new Set(catalog.models).size!==models.length||models.some(model=>!catalog.models.includes(model)))fail('ROLE_OPENCODE_GATE_CATALOG_DENIED');
 return catalog;
}
export function openCodeMetadata(args,catalog,options){
 validateHostRuntimeCatalog(catalog,options);
 if(args.length===1&&['--version','-v'].includes(args[0]))return catalog.opencode.version+'\n';
 if(args.length===1&&args[0]==='models')return catalog.models.join('\n')+'\n';
 fail('ROLE_OPENCODE_GATE_ARGUMENTS_DENIED');
}

/** Native owns tasks/runs/sessions; this gate claims one already-authorized stdio transport. */
export async function runOpenCodeRoleGate(){
 let claim,permit;
 try{
  if(process.platform!=='linux'||process.getuid()!==0)fail('ROLE_OPENCODE_GATE_ENVIRONMENT_DENIED');
  const args=process.argv.slice(2);
  if(args.length===1&&['--version','-v','models'].includes(args[0])){
   process.stdout.write(openCodeMetadata(args,JSON.parse(readPrivate(ROOT+'/host-runtime-catalog.json'))));return;
  }
  if(!uuid.test(process.env.PAPERCLIP_RUN_ID??''))fail('ROLE_OPENCODE_GATE_ENVIRONMENT_DENIED');
  const raw=readPrivate(ROOT+'/permits/'+process.env.PAPERCLIP_RUN_ID+'.json',ROLE_PERMIT_MAX_BYTES);
  permit=validateOpenCodeRoleCall({permit:JSON.parse(raw),args,env:process.env,cwd:process.cwd(),now:Date.now()});
  if(hash(readPrivate(permit.instructionsFilePath))!==permit.materialSha256)fail('ROLE_OPENCODE_GATE_MATERIAL_CHANGED');
  if(permit.materialSnapshot){const snapshot=validateRoleMaterialSnapshot(permit);let total=0;for(const file of snapshot.manifest.files){const bytes=readPrivate(path.join(ROLE_MATERIAL_ROOT,file.path));total+=bytes.length;if(total>1048576||hash(bytes)!==file.sha256)fail('ROLE_OPENCODE_GATE_MATERIAL_CHANGED');}}
  for(const file of permit.materialFiles??[])if(hash(readPrivate(path.join(permit.materialRoot,file.path)))!==file.sha256)fail('ROLE_OPENCODE_GATE_MATERIAL_CHANGED');
  for(const name of ['claims','results']){const stat=fs.lstatSync(ROOT+'/'+name);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o777)!==0o700)fail('ROLE_OPENCODE_GATE_DIRECTORY_DENIED');}
  claim=ROOT+'/claims/'+permit.runId+'.json';const fd=fs.openSync(claim,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,role:permit.role,runtimeProfileId:permit.runtimeProfileId,permitSha256:hash(raw),at:new Date().toISOString(),status:'claimed'})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(ROOT+'/claims','r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  let input='',length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>262144)fail('ROLE_OPENCODE_GATE_INPUT_LIMIT');input+=chunk;}
  const result=await executeIsolatedRole({permit,args,input,home:process.env.CODEX_HOME});
  process.exitCode=result.exitCode===0&&!result.signal&&!result.timedOut&&!result.spawnFailed&&!result.interrupted?0:1;
  fs.writeFileSync(ROOT+'/results/'+permit.runId+'.json',JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,runtimeProfileId:permit.runtimeProfileId,
   code:result.exitCode,signal:result.signal,timedOut:result.timedOut,interrupted:result.interrupted,at:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
 }catch(error){const code=/^ROLE_OPENCODE_GATE_[A-Z_]+$/.test(error?.code??'')?error.code:'ROLE_OPENCODE_GATE_RESULT_UNKNOWN';process.stderr.write(JSON.stringify({code,runId:permit?.runId,claimed:Boolean(claim)})+'\n');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runOpenCodeRoleGate();
