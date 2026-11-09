import { parseFeishuAutoRwbIntake, validateFeishuAutoRwbSupplement } from './feishu-policy.mjs';
import { createFeishuProjectDeliveryAdmission } from '../../feishu-project-admission.mjs';
import { registerScopedFeishuProject, routeFeishuProjectDelivery } from '../../feishu-project-delivery.mjs';

function rwbProject({ admission, native, onAccepted, codePathsFromGoal, readTaskContext = input => native.getTaskContext(input) }) {
  return { admission, tasks: {
    async register({ goal, title, paths, pathsJson, ...input }) {
      const storedGoal = goal + '\n\n文件范围：\n' + paths.join('\n');
      if (codePathsFromGoal(storedGoal) !== pathsJson) throw Object.assign(new Error('FRA_SCOPE_ENCODING_MISMATCH'), { code: 'FRA_SCOPE_ENCODING_MISMATCH' });
      return native.registerExternalTask({ ...input, origin: 'feishu', text: storedGoal, title, autoScopePathsJson: pathsJson });
    },
    append: input => native.appendTaskInput(input),
    readContext: readTaskContext,
    getContext: input => native.getTaskContext(input),
    matchesScope: (context, pathsJson) => context.fullTaskInput?.taskKind === 'code_patch' &&
      context.fullTaskInput.codeAllowedPathsJson === pathsJson,
    onAccepted,
  } };
}

/** The legacy Native RWB bridge is one registered project, behind the shared intake. */
export async function routeRwbFeishuDelivery({
  admission, native, text, operationId, externalRef, sourceEventKey, ownerOpenId,
  onAccepted, codePathsFromGoal, log, readTaskContext, projectAdapters = {},
}) {
  if (!admission) return typeof text === 'string' && text.startsWith('/任务 ')
    ? { type: 'scoped_blocked', status: 'blocked', operationId, code: 'FRA_POLICY_DISABLED' } : null;
  const project = rwbProject({ admission, native, onAccepted, codePathsFromGoal, readTaskContext });
  const input = { operationId, externalRef, sourceEventKey, ownerOpenId, log };
  return routeFeishuProjectDelivery({ ...input, text, routingAuthority: admission, legacyProjectKey: 'rwb', projects: { ...projectAdapters, rwb: project },
    legacy: () => registerScopedFeishuProject({ ...input, project, request: parseFeishuAutoRwbIntake(text), legacy: true }),
  });
}

export function createRwbFeishuAdmission(options = {}) {
  return createFeishuProjectDeliveryAdmission({ ...options, namespace: 'feishu-project-rwb',
    validateSupplement: validateFeishuAutoRwbSupplement });
}
