import { parseFeishuProjectDeliveryRequest } from './feishu-project-delivery-policy.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const projectKey = /^[a-z][a-z0-9-]{0,47}$/;
const codePattern = /^(FPD|FRA|RWB_AUTO|IN|US)_[A-Z0-9_]+$/;
const blocked = (operationId, code) => ({ type: 'scoped_blocked', status: 'blocked', operationId, code });
const ignored = { status: 'ignored', created: false, type: 'ignored' };
const routingQueues = new WeakMap();

/** Routes authenticated messages to deployment-owned project profiles. */
export async function routeFeishuProjectDelivery({
  text, operationId, externalRef, sourceEventKey, ownerOpenId, projects, legacy, legacyProjectKey,
  routingAuthority = projects, log,
}) {
  if (!routingAuthority || typeof routingAuthority !== 'object') return blocked(operationId, 'FPD_PROJECT_UNAVAILABLE');
  const previous = routingQueues.get(routingAuthority) ?? Promise.resolve();
  const next = previous.then(async () => {
    const request = parseFeishuProjectDeliveryRequest(text);
    if (request.kind === 'invalid') return blocked(operationId, request.code);
    const requestedKey = request.kind === 'ignored' ? legacyProjectKey : request.projectKey;
    // Serialize the ownership check and the first durable reservation across profiles.
    for (const [key, profile] of Object.entries(projects ?? {})) {
      if (key !== requestedKey && await profile.admission?.operation?.(operationId)) {
        return blocked(operationId, 'FPD_OPERATION_PROJECT_CONFLICT');
      }
    }
    if (request.kind === 'ignored') return legacy ? legacy() : ignored;
    if (!projectKey.test(request.projectKey) || !Object.hasOwn(projects ?? {}, request.projectKey)) {
      return blocked(operationId, 'FPD_PROJECT_NOT_REGISTERED');
    }
    return registerScopedFeishuProject({ request, operationId, externalRef, sourceEventKey, ownerOpenId,
      project: projects[request.projectKey], log });
  });
  const tail = next.catch(() => {});
  routingQueues.set(routingAuthority, tail);
  return next;
}

/** One intake sequence for every project. A profile supplies its trusted backend and checks. */
export async function registerScopedFeishuProject({
  project, request, operationId, externalRef, sourceEventKey, ownerOpenId, log, legacy = false,
}) {
  const { admission, tasks } = project ?? {};
  if (!admission || !tasks) return blocked(operationId, 'FPD_PROJECT_UNAVAILABLE');
  if (!await admission.enabled()) {
    if (legacy && !admission.operation?.(operationId) &&
        !(request.kind === 'supplement' && admission.lookup?.(request.taskId))) return null;
    return blocked(operationId, 'FRA_POLICY_DISABLED');
  }
  if (request.kind === 'ignored') return ignored;
  if (request.kind === 'invalid') return blocked(operationId, request.code);
  let reservation, previousContext;
  try {
    if (request.kind === 'supplement') previousContext = await tasks.readContext({ taskId: request.taskId });
    reservation = await admission.reserve({ operationId, chatId: externalRef.chatId, ownerOpenId, request, previousContext });
  } catch (error) {
    const code = codePattern.test(error?.code ?? '') ? error.code : 'FRA_INTAKE_UNKNOWN';
    await log({ code, operationId });
    return blocked(operationId, code);
  }

  const input = { operationId, source: 'feishu', externalRef, sourceEventKey };
  try {
    let result;
    if (request.kind === 'new') {
      result = await tasks.register({ ...input, goal: request.goal, title: request.title, paths: request.paths, pathsJson: reservation.pathsJson });
    } else {
      if (!digest.test(reservation.previousRevision ?? '')) return blocked(operationId, 'FRA_SUPPLEMENT_REVISION_UNKNOWN');
      result = await tasks.append({ ...input, taskId: request.taskId, text: request.text, expectedRevision: reservation.previousRevision });
    }
    if (!uuid.test(result?.taskId ?? '') || result.operationId !== operationId ||
        !digest.test(result.revision ?? '') || !digest.test(result.inputRevision ?? '') ||
        request.kind === 'supplement' && result.taskId !== request.taskId) {
      return blocked(operationId, 'FRA_NATIVE_RECEIPT_UNKNOWN');
    }
    const type = request.kind === 'new' ? 'registered' : 'supplement';
    const accepted = { ...result, status: 'completed', type,
      ...(request.projectKey && { projectKey: request.projectKey }) };
    if (reservation.inputRevision) {
      if (reservation.inputRevision !== result.inputRevision || reservation.taskId !== result.taskId) {
        return blocked(operationId, 'FRA_BINDING_CONFLICT');
      }
      return accepted;
    }
    const context = await tasks.getContext({ taskId: result.taskId });
    if (context?.inputRevision !== result.inputRevision || !tasks.matchesScope(context, reservation.pathsJson)) {
      return blocked(operationId, 'FRA_NATIVE_SCOPE_CHANGED');
    }
    await tasks.onAccepted({ taskId: result.taskId, type, result: accepted, previousContext });
    await admission.bind({ operationId, taskId: result.taskId, inputRevision: result.inputRevision, pathsJson: reservation.pathsJson });
    return accepted;
  } catch (error) {
    const code = codePattern.test(error?.code ?? '') ? error.code : 'FRA_NATIVE_RESULT_UNKNOWN';
    await log({ code, operationId });
    return blocked(operationId, code);
  }
}

export function requireProjectDeliveryChecks(scope, { inputRevision, candidateSha, result }) {
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

export function describeProjectDeliveryBlock(code) {
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
