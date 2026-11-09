import { parseFeishuAutoRwbIntake } from './feishu-auto-rwb-policy.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const blocked = (operationId, code) => ({ type: 'scoped_blocked', status: 'blocked', operationId, code });

/** Runs only after the Native Feishu gateway has authenticated the owner and message envelope. */
export async function maybeRegisterFeishuAutoRwb({
  admission, native, text, operationId, externalRef, sourceEventKey, ownerOpenId,
  onAccepted, codePathsFromGoal, log,
}) {
  if (!admission || !await admission.enabled()) return null;
  const request = parseFeishuAutoRwbIntake(text);
  if (request.kind === 'ignored') return { status: 'ignored', created: false, type: 'ignored' };
  if (request.kind === 'invalid') return blocked(operationId, request.code);
  let reservation, previousContext;
  try {
    if (request.kind === 'supplement') {
      previousContext = await native.getTaskContext({ taskId: request.taskId });
    }
    reservation = await admission.reserve({ operationId, chatId: externalRef.chatId, ownerOpenId, request, previousContext });
  } catch (error) {
    const code = /^(FRA|RWB_AUTO|IN)_[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'FRA_INTAKE_UNKNOWN';
    await log({ code, operationId });
    return blocked(operationId, code);
  }

  const input = { operationId, source: 'feishu', externalRef, sourceEventKey };
  let result;
  try {
    if (request.kind === 'new') {
      // The pinned Native register port derives its code scope from the stored goal.
      const goal = request.goal + '\n\n文件范围：\n' + request.paths.join('\n');
      if (codePathsFromGoal(goal) !== reservation.pathsJson) return blocked(operationId, 'FRA_SCOPE_ENCODING_MISMATCH');
      result = await native.registerExternalTask({ ...input, origin: 'feishu', text: goal, title: request.title,
        autoScopePathsJson: reservation.pathsJson });
    } else {
      if (!digest.test(reservation.previousRevision ?? '')) return blocked(operationId, 'FRA_SUPPLEMENT_REVISION_UNKNOWN');
      result = await native.appendTaskInput({ ...input, taskId: request.taskId, text: request.text,
        expectedRevision: reservation.previousRevision });
    }
    if (!uuid.test(result?.taskId ?? '') || result.operationId !== operationId ||
        !digest.test(result.revision ?? '') || !digest.test(result.inputRevision ?? '') ||
        request.kind === 'supplement' && result.taskId !== request.taskId) {
      return blocked(operationId, 'FRA_NATIVE_RECEIPT_UNKNOWN');
    }
    const type = request.kind === 'new' ? 'registered' : 'supplement';
    const accepted = { ...result, status: 'completed', type };
    if (reservation.inputRevision) {
      if (reservation.inputRevision !== result.inputRevision || reservation.taskId !== result.taskId) {
        return blocked(operationId, 'FRA_BINDING_CONFLICT');
      }
      return accepted;
    }
    const context = await native.getTaskContext({ taskId: result.taskId });
    if (context?.inputRevision !== result.inputRevision || context.fullTaskInput?.taskKind !== 'code_patch' ||
        context.fullTaskInput.codeAllowedPathsJson !== reservation.pathsJson) {
      return blocked(operationId, 'FRA_NATIVE_SCOPE_CHANGED');
    }
    await onAccepted({ taskId: result.taskId, type, result: accepted, previousContext });
    await admission.bind({ operationId, taskId: result.taskId, inputRevision: result.inputRevision, pathsJson: reservation.pathsJson });
    return accepted;
  } catch (error) {
    const code = /^(FRA|IN|US)_[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'FRA_NATIVE_RESULT_UNKNOWN';
    await log({ code, operationId });
    return blocked(operationId, code);
  }
}

export function describeFeishuAutoRwbBlocked(code) {
  if (/^RWB_AUTO_[A-Z0-9_]+$/.test(code)) {
    return '待补充。请在同一条 /rwb 消息写需求，并在「文件：」下一行一个填写可修改的仓库相对路径。补充需沿用原范围。';
  }
  if (/SCOPE|PATH|TARGET|CHECK/.test(code)) return '待补充。文件范围或必需检查无法核实，请核对本次已开放的文件清单。';
  if (/BUSY|ACTIVE|LIMIT|FULL/.test(code)) return '本次未进入执行队列。已有任务在处理，或验收名额已满。';
  if (/SUPPLEMENT|REVISION|HEAD/.test(code)) return '补充未进入执行队列。请核对原任务 ID、私聊和已回传的 PR 版本。';
  return '任务暂未继续。系统需要核对原登记或执行回执，请保留这条消息作为核对依据。';
}
