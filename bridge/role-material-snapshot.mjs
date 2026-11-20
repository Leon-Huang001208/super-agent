import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROLE_KEYS} from './role-labels.mjs';

export const ROLE_MATERIAL_ROOT='/paperclip/control/research-pm/materials';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const key=/^[a-z][a-z0-9-]{0,47}$/;
const owner=/^[A-Za-z0-9_-]{1,256}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const roleManifestDigest=manifest=>createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const relative=value=>typeof value==='string'&&value.length>0&&value.length<=512&&
  !/[\\\0\r\n]/.test(value)&&!path.posix.isAbsolute(value)&&path.posix.normalize(value)===value&&
  !value.split('/').some(part=>!part||part==='.'||part==='..');

/** Pure validation shared by the Native wrapper, the process gate and the host transport. */
export function validateRoleMaterialSnapshot(permit,{materialRoot=ROLE_MATERIAL_ROOT}={}) {
  if (permit?.materialSnapshot===undefined) return null;
  try {
    const s=permit.materialSnapshot,m=s?.manifest;
    if(!s||s.schemaVersion!==1||!['companyId','projectId','runId'].every(k=>uuid.test(s[k]??'')&&s[k]===permit[k])||
      !owner.test(s.ownerId??'')||s.ownerId!==permit.ownerId||!key.test(s.projectKey??'')||
      !ROLE_KEYS.includes(s.role)||s.role!==permit.role||!hash.test(s.manifestSha256??'')||
      !m||m.schemaVersion!==1||m.project!==s.projectKey||m.role!==s.role||
      !relative(m.instructionsFilePath)||!Array.isArray(m.files)||!m.files.length||m.files.length>32||
      !Array.isArray(m.requiredReferences)||m.requiredReferences.length>32||
      Buffer.byteLength(JSON.stringify(s))>65536||roleManifestDigest(m)!==s.manifestSha256)fail('ROLE_MATERIAL_SNAPSHOT_INVALID');
    if((s.projectWorkspaceId!==undefined||permit.projectWorkspaceId!==undefined)&&
      (!uuid.test(s.projectWorkspaceId??'')||s.projectWorkspaceId!==permit.projectWorkspaceId))fail('ROLE_MATERIAL_SNAPSHOT_SCOPE_DENIED');
    const seen=new Set();
    for(const file of m.files){
      if(!file||!relative(file.path)||!hash.test(file.sha256??'')||seen.has(file.path))fail('ROLE_MATERIAL_SNAPSHOT_INVALID');
      seen.add(file.path);
    }
    if(m.requiredReferences.some(value=>!relative(value)||!seen.has(value)))fail('ROLE_MATERIAL_SNAPSHOT_REFERENCE_DENIED');
    const instructions=m.files.find(file=>file.path===m.instructionsFilePath);
    if(!instructions||permit.instructionsFilePath!==path.posix.join(materialRoot,m.instructionsFilePath)||
      permit.materialSha256!==instructions.sha256||
      permit.cwd!=='/paperclip/instances/default/projects/'+permit.companyId+'/'+permit.projectId+'/_default') {
      fail('ROLE_MATERIAL_SNAPSHOT_SCOPE_DENIED');
    }
    return structuredClone(s);
  }catch(error){
    if(/^ROLE_MATERIAL_SNAPSHOT_[A-Z_]+$/.test(error?.code??''))throw error;
    fail('ROLE_MATERIAL_SNAPSHOT_INVALID');
  }
}
export function createRoleMaterialSnapshot({binding,profile,manifest,materialRoot=ROLE_MATERIAL_ROOT}) {
  const snapshot={schemaVersion:1,companyId:binding.companyId,ownerId:binding.ownerId,
    projectId:binding.projectId,projectKey:profile.projectKey,role:profile.role,runId:binding.runId,
    manifest:structuredClone(manifest),manifestSha256:roleManifestDigest(manifest),
    ...(binding.projectWorkspaceId?{projectWorkspaceId:binding.projectWorkspaceId}:{})};
  const primary=manifest.files.find(file=>file.path===manifest.instructionsFilePath);
  validateRoleMaterialSnapshot({...binding,role:profile.role,
    cwd:'/paperclip/instances/default/projects/'+binding.companyId+'/'+binding.projectId+'/_default',
    instructionsFilePath:path.posix.join(materialRoot,manifest.instructionsFilePath),
    materialSha256:primary?.sha256,materialSnapshot:snapshot},{materialRoot});
  return snapshot;
}

