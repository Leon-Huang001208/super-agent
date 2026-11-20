import { isDeepStrictEqual } from 'node:util';
import { loadRoleMaterials, selectRoleKnowledge } from './role-materials.mjs';
import {TEAM_ROLES} from './team-roles.mjs';
import {createHash} from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;

/** Offline preparation port. Native dispatch must independently authorize and claim this run. */
export function createRolePreparation({ readContext, readKnowledge, log }) {
  if (![readContext, readKnowledge, log].every(f => typeof f === 'function')) fail('ROLE_PREPARE_CONFIG_INVALID');
  return async function prepare({ binding, profile, materialRoot, manifest, projectMaterials, contextVersion, workspaceCwd, knowledgeQuery='' }) {
    try {
      binding = structuredClone(binding);
      profile = structuredClone(profile);
      const initial = structuredClone(await readContext(binding?.taskId));
      if (!binding || !['companyId', 'projectId', 'taskId', 'agentId', 'runId'].every(key => uuid.test(binding[key] ?? '')) ||
          !hash.test(binding.inputRevision ?? '') || typeof binding.ownerId !== 'string' || !binding.ownerId.trim() ||
          !profile || profile.agentId !== binding.agentId || profile.projectId !== binding.projectId ||
          !TEAM_ROLES[profile.role] || profile.engine !== 'codex_local' ||
          profile.model !== 'gpt-6.1-sol' || profile.reasoningEffort !== 'low' ||
          profile.dangerouslyBypassApprovalsAndSandbox !== false || !['read-only', 'workspace-write'].includes(profile.sandbox) ||
          !Array.isArray(profile.tools) || profile.tools.some(tool => !['read_materials', 'read_sources', 'shell', 'apply_patch', 'apps', 'plugins'].includes(tool))) {
        fail('ROLE_PREPARE_SCOPE_DENIED');
      }
      const validate = value => {
        if (!value || value.projectKey !== profile.projectKey || value.role !== profile.role || !['companyId', 'projectId', 'taskId', 'agentId', 'runId', 'ownerId', 'inputRevision'].every(key => value[key] === binding[key]) ||
            (contextVersion===1&&(value.projectWorkspaceId??null)!==(binding.projectWorkspaceId??null))||
            !hash.test(value.revision ?? '') || value.runState !== 'authorized' || value.sessionId !== null ||
            value.dispatchMode !== 'controlled' || value.model !== profile.model || value.reasoningEffort !== profile.reasoningEffort) {
          fail('ROLE_PREPARE_NATIVE_BINDING_DENIED');
        }
      };
      validate(initial);
      if(contextVersion===1&&(workspaceCwd!=='/paperclip/instances/default/projects/'+binding.companyId+'/'+binding.projectId+'/_default'||typeof knowledgeQuery!=='string'||Buffer.byteLength(knowledgeQuery)>4096))fail('ROLE_PREPARE_SCOPE_DENIED');
      const materials = loadRoleMaterials({ root: materialRoot, project: manifest?.project, role: profile.role, manifest, log });
      const overlay=projectMaterials?loadRoleMaterials({root:projectMaterials.materialRoot,project:profile.projectKey,role:profile.role,manifest:projectMaterials.manifest,log}):null;
      const knowledge = selectRoleKnowledge({ project: profile.projectKey, role: profile.role,
        records: await readKnowledge({ project: profile.projectKey, role: profile.role,
          ...(contextVersion===1?{scope:{companyId:binding.companyId,ownerId:binding.ownerId,projectId:binding.projectId,projectKey:profile.projectKey},query:knowledgeQuery,limit:32}:{} )}) });
      const final = await readContext(binding.taskId);
      validate(final);
      if (!isDeepStrictEqual(initial, final)) fail('ROLE_PREPARE_VERSION_CHANGED');
      log({ code: 'ROLE_PREPARE_READY', taskId: binding.taskId, runId: binding.runId, role: profile.role });
      if(contextVersion===1)log({code:'ROLE_PREPARE_KNOWLEDGE_LOADED',taskId:binding.taskId,runId:binding.runId,role:profile.role,
        loaded:knowledge.map(record=>({id:record.id,version:record.version,sourceSha256:createHash('sha256').update(record.source).digest('hex')})),
        materials:materials.files.map(file=>({path:file.path,sha256:file.sha256})),
        ...(overlay?{projectMaterials:overlay.files.map(file=>({path:file.path,sha256:file.sha256}))}:{})});
      return {
        binding: structuredClone(binding), nativeRevision: final.revision,
        adapterType: profile.engine, sessionMode: 'new',
        config: { model: profile.model, reasoningEffort: profile.reasoningEffort,
          dangerouslyBypassApprovalsAndSandbox: false, sandbox: profile.sandbox,
          instructionsFilePath: materials.instructionsFilePath },
        materials: materials.files, knowledge, requestedTools: [...profile.tools],
        ...(contextVersion===1?{contextVersion,workspaceCwd}:{}),
        toolVerification: 'NOT_RUN', dispatch: 'NOT_RUN', artifactKind: TEAM_ROLES[profile.role].artifactKind,
      };
    } catch (error) {
      const code = /^(?:ROLE_PREPARE|ROLE_MATERIAL|ROLE_KNOWLEDGE)_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'ROLE_PREPARE_DEPENDENCY_FAILED';
      log({ code, taskId: binding?.taskId, runId: binding?.runId });
      fail(code);
    }
  };
}
