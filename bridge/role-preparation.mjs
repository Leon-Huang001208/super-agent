import { isDeepStrictEqual } from 'node:util';
import { loadRoleMaterials, selectRoleKnowledge } from './role-materials.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;

/** Offline preparation port. Native dispatch must independently authorize and claim this run. */
export function createRolePreparation({ readContext, readKnowledge, log }) {
  if (![readContext, readKnowledge, log].every(f => typeof f === 'function')) fail('ROLE_PREPARE_CONFIG_INVALID');
  return async function prepare({ binding, profile, materialRoot, manifest }) {
    try {
      binding = structuredClone(binding);
      profile = structuredClone(profile);
      const initial = structuredClone(await readContext(binding?.taskId));
      if (!binding || !['companyId', 'projectId', 'taskId', 'agentId', 'runId'].every(key => uuid.test(binding[key] ?? '')) ||
          !hash.test(binding.inputRevision ?? '') || typeof binding.ownerId !== 'string' || !binding.ownerId.trim() ||
          !profile || profile.agentId !== binding.agentId || profile.projectId !== binding.projectId ||
          !['research', 'pm'].includes(profile.role) || profile.engine !== 'codex_local' ||
          profile.model !== 'gpt-6.1-sol' || profile.reasoningEffort !== 'low' ||
          profile.dangerouslyBypassApprovalsAndSandbox !== false || !['read-only', 'workspace-write'].includes(profile.sandbox) ||
          !Array.isArray(profile.tools) || profile.tools.some(tool => !['read_materials', 'read_sources', 'shell', 'apply_patch', 'apps', 'plugins'].includes(tool))) {
        fail('ROLE_PREPARE_SCOPE_DENIED');
      }
      const validate = value => {
        if (!value || value.projectKey !== profile.projectKey || value.role !== profile.role || !['companyId', 'projectId', 'taskId', 'agentId', 'runId', 'ownerId', 'inputRevision'].every(key => value[key] === binding[key]) ||
            !hash.test(value.revision ?? '') || value.runState !== 'authorized' || value.sessionId !== null ||
            value.dispatchMode !== 'controlled' || value.model !== profile.model || value.reasoningEffort !== profile.reasoningEffort) {
          fail('ROLE_PREPARE_NATIVE_BINDING_DENIED');
        }
      };
      validate(initial);
      const materials = loadRoleMaterials({ root: materialRoot, project: profile.projectKey, role: profile.role, manifest, log });
      const knowledge = selectRoleKnowledge({ project: profile.projectKey, role: profile.role,
        records: await readKnowledge({ project: profile.projectKey, role: profile.role }) });
      const final = await readContext(binding.taskId);
      validate(final);
      if (!isDeepStrictEqual(initial, final)) fail('ROLE_PREPARE_VERSION_CHANGED');
      log({ code: 'ROLE_PREPARE_READY', taskId: binding.taskId, runId: binding.runId, role: profile.role });
      return {
        binding: structuredClone(binding), nativeRevision: final.revision,
        adapterType: profile.engine, sessionMode: 'new',
        config: { model: profile.model, reasoningEffort: profile.reasoningEffort,
          dangerouslyBypassApprovalsAndSandbox: false, sandbox: profile.sandbox,
          instructionsFilePath: materials.instructionsFilePath },
        materials: materials.files, knowledge, requestedTools: [...profile.tools],
        toolVerification: 'NOT_RUN', dispatch: 'NOT_RUN', artifactKind: profile.role === 'research' ? 'sourced-research' : 'requirements-and-acceptance',
      };
    } catch (error) {
      const code = /^(?:ROLE_PREPARE|ROLE_MATERIAL|ROLE_KNOWLEDGE)_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'ROLE_PREPARE_DEPENDENCY_FAILED';
      log({ code, taskId: binding?.taskId, runId: binding?.runId });
      fail(code);
    }
  };
}
