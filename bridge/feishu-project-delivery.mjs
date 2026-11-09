import { parseFeishuProjectDeliveryRequest } from './feishu-project-delivery-policy.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const projectKey = /^[a-z][a-z0-9-]{0,47}$/;
const codePattern = /^(FPD|FRA|RWB_AUTO|IN|US)_[A-Z0-9_]+$/;
const blocked = (operationId, code) => ({ type: 'scoped_blocked', status: 'blocked', operationId, code });
const ignored = { status: 'ignored', created: false, type: 'ignored' };

/** Routes authenticated messages to deployment-owned project profiles. */
export async function routeFeishuProjectDelivery({ text, operationId, externalRef, sourceEventKey, ownerOpenId, projects, legacy, log }) {
  const request = parseFeishuProjectDeliveryRequest(text);
  if (request.kind === 'ignored') return legacy ? legacy() : ignored;
  if (request.kind === 'invalid') return blocked(operationId, request.code);
  if (!projectKey.test(request.projectKey) || !Object.hasOwn(projects ?? {}, request.projectKey)) {
    return blocked(operationId, 'FPD_PROJECT_NOT_REGISTERED');
  }
  return registerScopedFeishuProject({ request, operationId, externalRef, sourceEventKey, ownerOpenId,
    project: projects[request.projectKey], log });
}

/** One intake sequence for every project. A profile supplies its trusted backend and checks. */
export async function registerScopedFeishuProject({
  project, request, operationId, externalRef, sourceEventKey, ownerOpenId, log, legacy = false,
}) {
  const { admission, tasks } = project;
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
