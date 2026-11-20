import path from 'node:path';

const fail=code=>{throw Object.assign(new Error(code),{code});};

export function isRoleInstructionPermitPath(permit) {
  if (!permit.materialSourcePath) return /^\/paperclip\/control\/research-pm\/materials\/[a-f0-9-]{36}\.md$/.test(permit.instructionsFilePath??'');
  const source='/paperclip/instances/default/companies/'+permit.companyId+'/agents/'+permit.agentId+'/instructions/'+permit.role+'/AGENTS.md';
  const copy='/paperclip/instances/default/companies/'+permit.companyId+'/agents/'+permit.agentId+'/file-sync/runs/'+permit.runId+'/live/'+permit.role+'/AGENTS.md';
  return permit.materialSourcePath===source && permit.instructionsFilePath===copy;
}

/** Native owns the per-run copy. Match its admitted baseline to known material history. */
export function resolveRoleInstructionCopy({role,identity,workingCopy,baseline,history=[],executionPath}) {
  const root='/paperclip/instances/default/companies/'+identity.companyId+'/agents/'+identity.agentId+'/instructions';
  const entry=role.profile.role+'/AGENTS.md',localRoot=path.join(path.dirname(root),'file-sync','runs',identity.runId,'live');
  if(role.materialRoot!==root||role.manifest.instructionsFilePath!==entry||
      !workingCopy||workingCopy.companyId!==identity.companyId||workingCopy.agentId!==identity.agentId||workingCopy.runId!==identity.runId||
      workingCopy.responsibleUserId!==identity.ownerId||workingCopy.entryFile!==entry||workingCopy.state!=='prepared'||workingCopy.location!=='local'||
      workingCopy.localRoot!==localRoot||workingCopy.executionRoot!==localRoot||executionPath!==path.join(localRoot,entry))fail('NATIVE_ROLE_INSTRUCTION_COPY_DENIED');
  const files=baseline?.entries;
  if(!(files instanceof Map))fail('NATIVE_ROLE_INSTRUCTION_BASELINE_CHANGED');
  const count=[...files.values()].filter(file=>file.kind==='file').length;
  const known=[role.manifest,...history.filter(item=>item.agentId===identity.agentId&&item.materialRoot===root).map(item=>item.manifest)];
  const manifest=known.find(item=>item.instructionsFilePath===entry&&item.files.length===count&&item.files.every(file=>
    files.get(file.path)?.kind==='file'&&files.get(file.path).hash===file.sha256));
  if(!manifest)fail('NATIVE_ROLE_INSTRUCTION_BASELINE_CHANGED');
  return {materialRoot:localRoot,manifest:structuredClone(manifest),sourceInstructionsFilePath:path.join(root,entry)};
}

/** Call only after validating the permit's complete container path. */
export function hostRoleInstructionPath(file,dataRoot) {
  if(typeof file!=='string'||!file.startsWith('/paperclip/')||path.posix.normalize(file)!==file)fail('ROLE_MATERIAL_PATH_DENIED');
  return path.join(dataRoot,'state',file.slice('/paperclip/'.length));
}
