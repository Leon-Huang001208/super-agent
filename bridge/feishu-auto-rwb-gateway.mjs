import { parseFeishuAutoRwbIntake } from './feishu-auto-rwb-policy.mjs';
import { registerScopedFeishuProject, routeFeishuProjectDelivery } from './feishu-project-delivery.mjs';

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
export async function maybeRegisterFeishuAutoRwb({
  admission, native, text, operationId, externalRef, sourceEventKey, ownerOpenId,
  onAccepted, codePathsFromGoal, log, readTaskContext, projectAdapters = {},
}) {
  if (!admission) return null;
  const project = rwbProject({ admission, native, onAccepted, codePathsFromGoal, readTaskContext });
  const input = { operationId, externalRef, sourceEventKey, ownerOpenId, log };
  return routeFeishuProjectDelivery({ ...input, text, projects: { ...projectAdapters, rwb: project },
    legacy: () => registerScopedFeishuProject({ ...input, project, request: parseFeishuAutoRwbIntake(text), legacy: true }),
  });
}
export function requireFeishuAutoRwbChecks(scope, { inputRevision, candidateSha, result }) {
  if (!scope || result?.status !== 'passed') return result;
  if (scope.inputRevision !== inputRevision || result.candidateSha !== candidateSha || !Array.isArray(result.checks) ||
      scope.checks.some(name => result.checks.filter(check => check.name === name && check.exitCode === 0).length !== 1)) {
    throw Object.assign(new Error('FRA_VALIDATION_SCOPE_CHANGED'), { code: 'FRA_VALIDATION_SCOPE_CHANGED' });
  }
  return result;
}

export function scopedCompletionReceipt(scope, headSha) {
  if (!scope) return null;
  if (scope.version === 2 && scope.previousHead === headSha) {
    return { autoVersion: 1, autoInputRevision: scope.previousInputRevision };
  }
  return { autoVersion: scope.version, autoInputRevision: scope.inputRevision };
}

export function appendScopedCompletion(text, scopeReceipt) {
  return scopeReceipt ? text + '\n输入版本：' + scopeReceipt.autoVersion + '\nCI：通过' : text;
}

export function describeFeishuAutoRwbBlocked(code) {
  if (code === 'FPD_PROJECT_NOT_REGISTERED') return '这个项目尚未开放自动交付。请使用已登记的项目名。';
  if (/^FPD_[A-Z0-9_]+$/.test(code)) {
    return '待补充。请用「/任务 项目名 需求」，再在「文件：」下逐行填写范围。补充需沿用原项目和范围。';
  }
  if (/^RWB_AUTO_[A-Z0-9_]+$/.test(code)) {
    return '待补充。请在同一条 /rwb 消息写需求，并在「文件：」下一行一个填写可修改的仓库相对路径。补充需沿用原范围。';
  }
  if (/SCOPE|PATH|TARGET|CHECK/.test(code)) return '待补充。文件范围或必需检查无法核实，请核对本次已开放的文件清单。';
  if (/BUSY|ACTIVE|LIMIT|FULL/.test(code)) return '本次未进入执行队列。已有任务在处理，或验收名额已满。';
  if (/SUPPLEMENT|REVISION|HEAD/.test(code)) return '补充未进入执行队列。请核对原任务 ID、私聊和已回传的 PR 版本。';
  return '任务暂未继续。系统需要核对原登记或执行回执，请保留这条消息作为核对依据。';
}
