import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

function matchesOwnerMessage(message, binding, messageId) {
  return message?.id === messageId && message.issueId === binding.conversationId &&
    message.companyId === binding.companyId && message.authorUserId === binding.ownerId &&
    message.authorAgentId === null && message.createdByRunId === null && message.deletedAt === null &&
    typeof message.body === 'string' && message.body.trim() !== '' && message.body.trim() !== '/new';
}

function matchesChiefTurn(run, binding, messageId, chiefAgentId) {
  const context = run?.contextSnapshot;
  return run?.status === 'succeeded' && run.companyId === binding.companyId && run.agentId === chiefAgentId &&
    context?.issueId === binding.conversationId && context.conversationMode === true &&
    context.conversationSessionGeneration === binding.generation &&
    (context.wakeCommentId ?? context.commentId) === messageId &&
    (context.conversationReplyBoundaryCommentId ?? messageId) === messageId &&
    (context.wakeCommentIds === undefined ||
      (Array.isArray(context.wakeCommentIds) && context.wakeCommentIds.length === 1 && context.wakeCommentIds[0] === messageId));
}

function matchesOwnerWake(wake, run, binding, messageId, chiefAgentId) {
  return wake && wake.id === run.wakeupRequestId && wake.runId === run.id && wake.status === 'completed' &&
    wake.companyId === binding.companyId && wake.agentId === chiefAgentId && wake.reason === 'issue_commented' &&
    wake.requestedByActorType === 'user' && wake.requestedByActorId === binding.ownerId &&
    wake.idempotencyKey === 'conversation-comment:' + messageId &&
    wake.payload?.issueId === binding.conversationId && wake.payload?.commentId === messageId;
}

function matchesCallReceipt(receipt, binding, message, run, chiefAgentId) {
  return receipt?.status === 'completed' && receipt.intent === 'supplement_rwb_pr261' &&
    receipt.taskId === CHIEF_WEB_PILOT.taskId && receipt.targetPath === CHIEF_WEB_PILOT.path &&
    receipt.grantId === binding.grantId && receipt.companyId === binding.companyId &&
    receipt.conversationId === binding.conversationId && receipt.generation === binding.generation &&
    receipt.messageId === message.id && receipt.runId === run.id && receipt.agentId === chiefAgentId &&
    receipt.messageDigest === createHash('sha256').update(message.body).digest('hex') &&
    receipt.model === CHIEF_WEB_PILOT.model && receipt.reasoningEffort === CHIEF_WEB_PILOT.reasoningEffort &&
    receipt.apiFallback === false && receipt.physicalCallsForGrant === CHIEF_WEB_PILOT.chiefCalls;
}

/** Read the Native turn and the existing physical call ledger under the caller's task transaction. */
export function createChiefWebSupplementEvidence({ chiefAgentId, readNativeEvidence, readChiefCallReceipt, log } = {}) {
  if (typeof chiefAgentId !== 'string' || !chiefAgentId ||
      ![readNativeEvidence, readChiefCallReceipt, log].every(fn => typeof fn === 'function')) {
    throw new Error('CHIEF_WEB_EVIDENCE_CONFIGURATION_INVALID');
  }

  return async function verifyOwnerSupplement({ task, transaction, binding, messageId }) {
    if (task?.id !== CHIEF_WEB_PILOT.taskId || binding?.taskId !== task.id) return false;
    try {
      const evidence = await readNativeEvidence({ transaction, binding, messageId, chiefAgentId });
      const { message, run, wake } = evidence ?? {};
      if (evidence?.boundaryChecked !== true ||
          !matchesOwnerMessage(message, binding, messageId) || !matchesChiefTurn(run, binding, messageId, chiefAgentId) ||
          !matchesOwnerWake(wake, run, binding, messageId, chiefAgentId)) {
        await log({ code: 'CHIEF_WEB_NATIVE_EVIDENCE_DENIED' });
        return false;
      }
      const receipt = await readChiefCallReceipt({ transaction, binding, runId: run.id, messageId });
      const verified = matchesCallReceipt(receipt, binding, message, run, chiefAgentId);
      await log({ code: verified ? 'CHIEF_WEB_CALL_EVIDENCE_VERIFIED' : 'CHIEF_WEB_CALL_EVIDENCE_DENIED' });
      return verified;
    } catch {
      try {
        await log({ code: 'CHIEF_WEB_EVIDENCE_UNAVAILABLE' });
      } catch {
        throw new Error('CHIEF_WEB_EVIDENCE_LOG_UNAVAILABLE');
      }
      throw Object.assign(new Error('CHIEF_WEB_STATE_UNAVAILABLE'), { code: 'CHIEF_WEB_STATE_UNAVAILABLE' });
    }
  };
}
