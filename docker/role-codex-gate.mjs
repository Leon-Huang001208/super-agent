import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isSubscriptionAuth } from './codex-hello-gate.mjs';
import { executeIsolatedRole } from '../bridge/role-isolated-transport.mjs';
import { NATIVE_ROLE_MANAGED_ARGS } from '../bridge/native-role-adapter.mjs';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';
import {isRoleInstructionPermitPath} from '../bridge/role-instruction-paths.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const ROOT = '/paperclip/control/research-pm';
function materialAndProjectScope(permit){
 if(permit.projectContext&&permit.projectContext.id!==permit.projectId)return false;
 if(permit.effectiveCapabilities&&(permit.effectiveCapabilities.role!==permit.role||!Array.isArray(permit.effectiveCapabilities.capabilityIds)||
  !permit.effectiveCapabilities.capabilityIds.includes(permit.role)||permit.effectiveCapabilities.capabilityIds.some(role=>!ROLE_KEYS.includes(role))))return false;
 if(!permit.materialFiles)return true;
 const root=permit.materialSourcePath?path.dirname(path.dirname(permit.instructionsFilePath)):path.dirname(permit.instructionsFilePath);
 if(permit.materialRoot!==root||!Array.isArray(permit.materialFiles)||!permit.materialFiles.length||permit.materialFiles.length>32)return false;
 const seen=new Set();
 for(const file of permit.materialFiles){
  if(typeof file.path!=='string'||path.posix.normalize(file.path)!==file.path||path.posix.isAbsolute(file.path)||file.path.includes('\\')||
   file.path.split('/').some(part=>!part||part==='..'||part==='.')||seen.has(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256??''))return false;
  seen.add(file.path);
 }
 return permit.materialFiles.some(file=>path.join(root,file.path)===permit.instructionsFilePath&&file.sha256===permit.materialSha256);
}
function readPrivate(filename) {
  let cursor = '/';
  for (const part of filename.slice(1).split('/')) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || stat.uid !== 0 || ((stat.mode & 0o022) && !(cursor === '/tmp' && (stat.mode & 0o1777) === 0o1777))) fail('ROLE_GATE_PATH_DENIED');
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.size > 262144 || (s.mode & 0o077)) fail('ROLE_GATE_FILE_DENIED');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function normalizeNativeRoleArgs(args) {
  if (args[0] !== '-c' || args[1] !== 'features.shell_snapshot=false') return args;
  const fixed = ['-c','features.shell_snapshot=false','-c','shell_environment_policy.inherit="all"',
    '-c','shell_environment_policy.ignore_default_excludes=true','-c'];
  if (!fixed.every((value,i) => args[i] === value) || !args[7]?.startsWith('shell_environment_policy.include_only=')) fail('ROLE_GATE_ARGUMENTS_DENIED');
  let keys;
  try { keys = JSON.parse(args[7].slice('shell_environment_policy.include_only='.length)); } catch { fail('ROLE_GATE_ARGUMENTS_DENIED'); }
  if (!Array.isArray(keys) || keys.length > 256 || keys.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) fail('ROLE_GATE_ARGUMENTS_DENIED');
  return args.slice(8);
}

export function validateRoleCall({ permit, args, env, cwd, now }) {
  if(permit?.evidencePacket&&(permit.role!=='qa'||permit.evidencePacket.name!=='qa-evidence-v2'||!/^[a-f0-9]{64}$/.test(permit.evidencePacket.manifestSha256??'')))fail('ROLE_GATE_EVIDENCE_DENIED');
  if (!permit || permit.schemaVersion !== 1 || !ROLE_KEYS.includes(permit.role) ||
      !['runId','taskId','agentId','companyId','projectId','credentialGrantId'].every(k => uuid.test(permit[k] ?? '')) ||
      permit.model !== 'gpt-6.1-sol' || permit.reasoningEffort !== 'low' || permit.apiFallback !== false ||
      !Number.isSafeInteger(permit.expiresAt) || !Number.isSafeInteger(now) ||
      permit.expiresAt <= now || permit.expiresAt - now > 300000 ||
      permit.cwd !== cwd || !(cwd.startsWith(ROOT + '/workspaces/') || cwd === '/paperclip/instances/default/projects/'+permit.companyId+'/'+permit.projectId+'/_default') ||
      !/^[a-f0-9]{64}$/.test(permit.materialSha256 ?? '') ||
      !isRoleInstructionPermitPath(permit) ||
      !materialAndProjectScope(permit) ||
      ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','ANTHROPIC_API_KEY'].some(k => Boolean(env[k])) ||
      env.PAPERCLIP_RUN_ID !== permit.runId || env.PAPERCLIP_AGENT_ID !== permit.agentId ||
      env.PAPERCLIP_COMPANY_ID !== permit.companyId || env.PAPERCLIP_TASK_ID !== permit.taskId ||
      !new RegExp('^/tmp/paperclip-ai-'+permit.companyId+'-'+permit.credentialGrantId+'-[A-Za-z0-9]+/provider$').test(env.CODEX_HOME ?? '')) fail('ROLE_GATE_SCOPE_DENIED');
  args = normalizeNativeRoleArgs(args);
  const base = ['exec','--json','--model',permit.model,'-c','model_reasoning_effort="low"',...NATIVE_ROLE_MANAGED_ARGS,'-'];
  const allowed = [base, [...base.slice(0,2),'--skip-git-repo-check',...base.slice(2)]]
    .map(value => ['--search', ...value]);
  if (!Array.isArray(args) || !allowed.some(value => JSON.stringify(value) === JSON.stringify(args))) fail('ROLE_GATE_ARGUMENTS_DENIED');
  return permit;
}

/** A one-call wrapper under Native. It never creates tasks, runs or sessions. */
export async function runRoleGate() {
  let claim, permit;
  try {
    if (process.platform !== 'linux' || process.getuid() !== 0 || !uuid.test(process.env.PAPERCLIP_RUN_ID ?? '')) fail('ROLE_GATE_ENVIRONMENT_DENIED');
    const raw = readPrivate(ROOT + '/permits/' + process.env.PAPERCLIP_RUN_ID + '.json');
    permit = validateRoleCall({permit:JSON.parse(raw),args:process.argv.slice(2),env:process.env,cwd:process.cwd(),now:Date.now()});
    if (hash(readPrivate(permit.instructionsFilePath)) !== permit.materialSha256) fail('ROLE_GATE_MATERIAL_CHANGED');
    for(const file of permit.materialFiles??[])if(hash(readPrivate(path.join(permit.materialRoot,file.path)))!==file.sha256)fail('ROLE_GATE_MATERIAL_CHANGED');
    const auth = JSON.parse(readPrivate(process.env.CODEX_HOME + '/auth.json'));
    if (!isSubscriptionAuth(auth)) fail('ROLE_GATE_SUBSCRIPTION_REQUIRED');
    for (const name of ['claims','results']) {
      const stat = fs.lstatSync(ROOT+'/'+name);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o700) fail('ROLE_GATE_DIRECTORY_DENIED');
    }
    claim = ROOT + '/claims/' + permit.runId + '.json';
    const fd = fs.openSync(claim, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,role:permit.role,permitSha256:hash(raw),at:new Date().toISOString(),status:'claimed'})+'\n');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    const parent = fs.openSync(ROOT+'/claims','r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    let input = '', length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 262144) fail('ROLE_GATE_INPUT_LIMIT');
      input += chunk;
    }
    // The existing CLI and Native-resolved provider home own authentication.
    const result = await executeIsolatedRole({permit,args:process.argv.slice(2),input,home:process.env.CODEX_HOME});
    process.exitCode = result.exitCode === 0 && !result.signal && !result.timedOut && !result.spawnFailed && !result.interrupted ? 0 : 1;
    fs.writeFileSync(ROOT+'/results/'+permit.runId+'.json', JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,
      code:result.exitCode,signal:result.signal,timedOut:result.timedOut,interrupted:result.interrupted,at:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
  } catch (error) {
    const code = /^ROLE_GATE_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'ROLE_GATE_RESULT_UNKNOWN';
    process.stderr.write(JSON.stringify({code,runId:permit?.runId,claimed:Boolean(claim)})+'\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runRoleGate();
