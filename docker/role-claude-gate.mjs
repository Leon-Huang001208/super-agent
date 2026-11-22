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
  if(stat.isSymbolicLink()||stat.uid!==0||((stat.mode&0o022)&&!(cursor==='/tmp'&&(stat.mode&0o1777)===0o1777)))fail('ROLE_CLAUDE_GATE_PATH_DENIED');
 }
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>maximumBytes||(stat.mode&0o077))fail('ROLE_CLAUDE_GATE_FILE_DENIED');return fs.readFileSync(fd);}
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

/** The stock Native CLI arguments are recognized, not forwarded to the host CLI.
 * Native's content-addressed prompt bundle grants no new filesystem/skill/MCP authority:
 * the host builder injects the separately verified permit instruction file instead.
 */
export function validateClaudeRoleCall({permit,args,env,cwd,now}){
 let policy;try{policy=roleExecutionPolicy(permit);}catch{fail('ROLE_CLAUDE_GATE_SCOPE_DENIED');}
 let materialSnapshot;try{materialSnapshot=validateRoleMaterialSnapshot(permit);}catch{fail('ROLE_CLAUDE_GATE_MATERIAL_SNAPSHOT_DENIED');}
 const profile=Object.hasOwn(RUNTIME_PROFILES,permit?.runtimeProfileId??'')?RUNTIME_PROFILES[permit.runtimeProfileId]:null;
 const marker=env.CLAUDE_CONFIG_DIR,headers=env.ANTHROPIC_CUSTOM_HEADERS;
 if(!permit||permit.schemaVersion!==1||!ROLE_KEYS.includes(permit.role)||!profile||profile.runtime!=='claude'||policy.executor!=='macos_native'||
  !['runId','taskId','agentId','companyId','projectId','credentialGrantId'].every(key=>uuid.test(permit[key]??''))||
  permit.model!==profile.model||permit.reasoningEffort!==null||permit.apiFallback!==false||
  !Number.isSafeInteger(permit.expiresAt)||!Number.isSafeInteger(now)||permit.expiresAt<=now||permit.expiresAt-now>300000||
  permit.cwd!==cwd||!(cwd.startsWith(ROOT+'/workspaces/')||cwd==='/paperclip/instances/default/projects/'+permit.companyId+'/'+permit.projectId+'/_default')||
  !/^[a-f0-9]{64}$/.test(permit.materialSha256??'')||(!materialSnapshot&&!isRoleInstructionPermitPath(permit))||!materialAndProjectScope(permit)||
  ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','MINIMAX_API_KEY','MINIMAX_BASE_URL',
   'ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
   'SUPER_AGENT_ROLE_PROVIDER_API_KEY','OPENCODE_CONFIG','OPENCODE_CONFIG_CONTENT','OPENCODE_CONFIG_DIR'].some(key=>Boolean(env[key]))||
  (marker!==undefined&&marker!==ROOT+'/claude-clients/'+permit.agentId+'/config')||
  (Boolean(headers)&&headers!=='X-Anthropic-Agent-Id: '+permit.agentId)||
  (env.CODEX_HOME!==undefined&&!new RegExp('^/tmp/paperclip-ai-'+permit.companyId+'-'+permit.credentialGrantId+'-[A-Za-z0-9]+/provider$').test(env.CODEX_HOME))||
  env.PAPERCLIP_RUN_ID!==permit.runId||env.PAPERCLIP_AGENT_ID!==permit.agentId||env.PAPERCLIP_COMPANY_ID!==permit.companyId||env.PAPERCLIP_TASK_ID!==permit.taskId)fail('ROLE_CLAUDE_GATE_SCOPE_DENIED');
 if(permit.evidencePacket&&(permit.role!=='qa'||permit.evidencePacket.name!=='qa-evidence-v2'||!/^[a-f0-9]{64}$/.test(permit.evidencePacket.manifestSha256??'')))fail('ROLE_CLAUDE_GATE_EVIDENCE_DENIED');
 const bundle=Array.isArray(args)?args[args.length-1]:null;
 const prefixes=['/paperclip/instances/default/companies/','/paperclip/home/.paperclip/instances/default/companies/'].map(root=>root+permit.companyId+'/claude-prompt-cache/');
 const prefix=typeof bundle==='string'?prefixes.find(value=>bundle.startsWith(value)):undefined;
 if(!prefix||!/^[a-f0-9]{64}$/.test(bundle.slice(prefix.length)))fail('ROLE_CLAUDE_GATE_ARGUMENTS_DENIED');
 const expected=['--print','--output-format','stream-json','--verbose','--dangerously-skip-permissions','--model',permit.model,
  '--max-turns','64','--append-system-prompt-file',bundle+'/agent-instructions.md','--add-dir',bundle];
 if(JSON.stringify(args)!==JSON.stringify(expected))fail('ROLE_CLAUDE_GATE_ARGUMENTS_DENIED');
 return permit;
}
// Stock Native owns this cache; its contents are never forwarded to the host CLI.
export function validateClaudeNativeBundlePath(bundle,{lstat=fs.lstatSync}={}){
 let cursor='/';for(const part of (bundle+'/agent-instructions.md').slice(1).split('/')){
  cursor=path.join(cursor,part);const stat=lstat(cursor),file=cursor===bundle+'/agent-instructions.md';
  if(stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)||(file?(!stat.isFile()||stat.nlink!==1):!stat.isDirectory()))fail('ROLE_CLAUDE_GATE_PATH_DENIED');
 }
}
export function claudeMetadata(args,catalog,{now=Date.now()}={}){
 const captured=Date.parse(catalog?.capturedAt),entry=catalog?.claude;
 if(catalog?.schemaVersion!==1||catalog.hostPlatform!=='darwin'||!Number.isSafeInteger(now)||!Number.isSafeInteger(captured)||captured>now||now-captured>1800000||
  !Number.isSafeInteger(catalog.expiresAt)||catalog.expiresAt<=now||catalog.expiresAt<=captured||catalog.expiresAt-captured>1800000||
  typeof entry?.path!=='string'||!path.posix.isAbsolute(entry.path)||path.posix.normalize(entry.path)!==entry.path||
  !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+_-]+)?$/.test(entry.version??''))fail('ROLE_CLAUDE_GATE_CATALOG_DENIED');
 if(args.length===1&&['--version','-v'].includes(args[0]))return entry.version+' (Claude Code)\n';
 fail('ROLE_CLAUDE_GATE_ARGUMENTS_DENIED');
}

/** Claim one Native-authorized transport; task/session creation stays in Paperclip. */
export async function runClaudeRoleGate(){
 let claim,permit;
 try{
  if(process.platform!=='linux'||process.getuid()!==0)fail('ROLE_CLAUDE_GATE_ENVIRONMENT_DENIED');
  const args=process.argv.slice(2);
  if(args.length===1&&['--version','-v'].includes(args[0])){
   process.stdout.write(claudeMetadata(args,JSON.parse(readPrivate(ROOT+'/host-runtime-catalog.json'))));return;
  }
  if(!uuid.test(process.env.PAPERCLIP_RUN_ID??''))fail('ROLE_CLAUDE_GATE_ENVIRONMENT_DENIED');
  const raw=readPrivate(ROOT+'/permits/'+process.env.PAPERCLIP_RUN_ID+'.json',ROLE_PERMIT_MAX_BYTES);
  permit=validateClaudeRoleCall({permit:JSON.parse(raw),args,env:process.env,cwd:process.cwd(),now:Date.now()});
  validateClaudeNativeBundlePath(args.at(-1));
  if(hash(readPrivate(permit.instructionsFilePath))!==permit.materialSha256)fail('ROLE_CLAUDE_GATE_MATERIAL_CHANGED');
  if(permit.materialSnapshot){const snapshot=validateRoleMaterialSnapshot(permit);let total=0;for(const file of snapshot.manifest.files){const bytes=readPrivate(path.join(ROLE_MATERIAL_ROOT,file.path));total+=bytes.length;if(total>1048576||hash(bytes)!==file.sha256)fail('ROLE_CLAUDE_GATE_MATERIAL_CHANGED');}}
  for(const file of permit.materialFiles??[])if(hash(readPrivate(path.join(permit.materialRoot,file.path)))!==file.sha256)fail('ROLE_CLAUDE_GATE_MATERIAL_CHANGED');
  for(const name of ['claims','results']){const stat=fs.lstatSync(ROOT+'/'+name);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o777)!==0o700)fail('ROLE_CLAUDE_GATE_DIRECTORY_DENIED');}
  claim=ROOT+'/claims/'+permit.runId+'.json';const fd=fs.openSync(claim,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,role:permit.role,runtimeProfileId:permit.runtimeProfileId,permitSha256:hash(raw),at:new Date().toISOString(),status:'claimed'})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(ROOT+'/claims','r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  let input='',length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>262144)fail('ROLE_CLAUDE_GATE_INPUT_LIMIT');input+=chunk;}
  const result=await executeIsolatedRole({permit,args,input,home:process.env.CODEX_HOME});
  process.exitCode=result.exitCode===0&&!result.signal&&!result.timedOut&&!result.spawnFailed&&!result.interrupted?0:1;
  fs.writeFileSync(ROOT+'/results/'+permit.runId+'.json',JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,runtimeProfileId:permit.runtimeProfileId,
   code:result.exitCode,signal:result.signal,timedOut:result.timedOut,interrupted:result.interrupted,at:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
 }catch(error){const code=/^ROLE_CLAUDE_GATE_[A-Z_]+$/.test(error?.code??'')?error.code:'ROLE_CLAUDE_GATE_RESULT_UNKNOWN';process.stderr.write(JSON.stringify({code,runId:permit?.runId,claimed:Boolean(claim)})+'\n');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runClaudeRoleGate();
