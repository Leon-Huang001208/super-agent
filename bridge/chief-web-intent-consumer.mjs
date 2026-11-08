import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const digest = /^[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/;
const supplementText = '在原文档补一小节说明如何核对原任务 ID、原 PR、输入版本和最新 head 的 CI，以及如何区分历史回执与本次回执。';

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function validateIntent(intent, operationId) {
  if (intent?.operationId !== operationId || intent.taskId !== CHIEF_WEB_PILOT.taskId ||
      intent.kind !== 'chief-web-intent' || !matches(digest, intent.expected?.inputRevision) ||
      intent.expected.prHead !== CHIEF_WEB_PILOT.previousHead) return false;
  if (intent.action === 'supplement') {
    return intent.expected.inputRevision === CHIEF_WEB_PILOT.previousInputRevision &&
      intent.sourceEvidence?.messageId === intent.messageId && matches(digest, intent.sourceEvidence.messageDigest);
  }
  return intent.action === 'confirm' && intent.expected.inputRevision !== CHIEF_WEB_PILOT.previousInputRevision &&
    matches(sha, intent.expected.candidate) && intent.expected.candidate !== intent.expected.prHead &&
    matches(digest, intent.expected.reviewDigest);
}

function validatesResult(result, intent) {
  if (result?.operationId !== intent.operationId || result.taskId !== intent.taskId ||
      result.grantId !== intent.grantId || result.status !== 'completed') return false;
  if (intent.action === 'supplement') {
    return result.previousInputRevision === intent.expected.inputRevision &&
      matches(digest, result.inputRevision) && result.inputRevision !== result.previousInputRevision &&
      result.messageDigest === intent.sourceEvidence.messageDigest;
  }
  return result.repository === CHIEF_WEB_PILOT.repository && result.pullRequest === CHIEF_WEB_PILOT.pullRequest &&
    result.inputRevision === intent.expected.inputRevision && result.previousHead === intent.expected.prHead &&
    result.headSha === intent.expected.candidate;
}

/**
 * Runs only when called by the existing Paperclip controller. Its authority port
 * atomically persists the claim after rechecking the current grant, evidence,
 * pause fence, lease and version under the original task lock.
 */
export function createChiefWebIntentConsumer({ authority, native, publication, log } = {}) {
  if (![authority?.claim, authority?.complete, native?.append, native?.observe,
    publication?.update, publication?.observe, log].every(fn => typeof fn === 'function')) {
    throw new Error('CHIEF_WEB_CONSUMER_CONFIGURATION_INVALID');
  }

  async function consume(operationId) {
    if (!matches(digest, operationId)) throw new Error('CHIEF_WEB_OPERATION_INVALID');
    try {
      const admission = await authority.claim(operationId);
      if (admission?.status === 'blocked') return { operationId, status: 'blocked' };
      const intent = admission?.intent;
      if (!validateIntent(intent, operationId)) throw new Error('CHIEF_WEB_INTENT_UNAVAILABLE');
      if (admission.status === 'completed' && validatesResult(admission.receipt, intent)) {
        return { operationId, status: 'completed' };
      }

      const effect = intent.action === 'supplement' ? native : publication;
      const scope = {
        operationId, taskId: intent.taskId, grantId: intent.grantId,
        inputRevision: intent.expected.inputRevision, repository: CHIEF_WEB_PILOT.repository,
        pullRequest: CHIEF_WEB_PILOT.pullRequest, previousHead: intent.expected.prHead,
      };
      let result;
      if (admission.status === 'claimed_now') {
        result = intent.action === 'supplement'
          ? await effect.append({ ...scope, path: CHIEF_WEB_PILOT.path, text: supplementText, sourceEvidence: intent.sourceEvidence })
          : await effect.update({ ...scope, candidate: intent.expected.candidate, reviewDigest: intent.expected.reviewDigest });
      } else if (admission.status === 'claimed') {
        result = await effect.observe(scope);
      }
      if (!validatesResult(result, intent)) throw new Error('CHIEF_WEB_RESULT_UNCONFIRMED');
      await authority.complete({ operationId, result });
      await log({ code: 'CHIEF_WEB_EFFECT_RECONCILED', operationId });
      return { operationId, status: 'completed' };
    } catch {
      await log({ code: 'CHIEF_WEB_EFFECT_RECONCILIATION_REQUIRED', operationId });
      return { operationId, status: 'unknown' };
    }
  }

  return Object.freeze({ consume });
}
