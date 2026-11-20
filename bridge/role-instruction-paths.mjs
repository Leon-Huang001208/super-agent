import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROLE_KEYS} from './role-labels.mjs';

const ROOT='/paperclip/control/research-pm';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function isRoleInstructionPermitPath(permit) {
  if (!permit.materialSourcePath) return /^\/paperclip\/control\/research-pm\/materials\/[a-f0-9-]{36}\.md$/.test(permit.instructionsFilePath??'');
  const source='/paperclip/instances/default/companies/'+permit.companyId+'/agents/'+permit.agentId+'/instructions/'+permit.role+'/AGENTS.md';
  return permit.materialSourcePath===source && permit.instructionsFilePath===ROOT+'/instruction-runs/'+permit.runId+'/'+permit.role+'/AGENTS.md';
}

/** A run reads its admitted bytes even if the owner saves the next version. */
export function pinRoleInstruction({source,sha256,runId,role,root=ROOT+'/instruction-runs'}) {
  if(!uuid.test(runId??'')||!ROLE_KEYS.includes(role))fail('ROLE_MATERIAL_PATH_DENIED');
  const bytes=fs.readFileSync(source);
  if(sha(bytes)!==sha256)fail('ROLE_MATERIAL_CHANGED');
  const directory=path.join(root,runId,role),target=path.join(directory,'AGENTS.md');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(fs.existsSync(target)) {
    const stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||sha(fs.readFileSync(target))!==sha256)fail('ROLE_MATERIAL_CHANGED');
  } else {
    const fd=fs.openSync(target,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  return target;
}

/** Call only after validating the permit's complete container path. */
export function hostRoleInstructionPath(file,dataRoot) {
  if(typeof file!=='string'||!file.startsWith('/paperclip/')||path.posix.normalize(file)!==file)fail('ROLE_MATERIAL_PATH_DENIED');
  return path.join(dataRoot,'state',file.slice('/paperclip/'.length));
}
