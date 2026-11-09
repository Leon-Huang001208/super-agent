import { createHash } from 'node:crypto';

const reason = 'heartbeat.wakeOnDemand.disabled';
const preModelDenial = '{"code":"CHIEF_CALL_ENVIRONMENT_DENIED","retryAllowed":false}';

function matchesWake(wake, issue, grant, comment) {
  return wake.companyId === issue.companyId && wake.agentId === grant.chiefAgentId &&
    wake.source === 'on_demand' && wake.triggerDetail === 'manual' &&
    wake.requestedByActorType === 'user' && wake.requestedByActorId === grant.ownerId &&
    wake.idempotencyKey === 'conversation-comment:' + comment.id &&
    wake.payload?.issueId === issue.id && wake.payload?.commentId === comment.id;
}

function matchesPreModelDenial(run, wake, permit, grant, comment) {
  const context = run.contextSnapshot;
  const usage = run.usageJson;
  return wake.status === 'failed' && wake.reason === 'issue_commented' &&
    wake.runId === run.id && run.wakeupRequestId === wake.id &&
    run.companyId === grant.companyId && run.agentId === grant.chiefAgentId &&
    run.status === 'failed' && run.errorCode === 'adapter_failed' && run.exitCode === 78 &&
    run.error === preModelDenial && run.stderrExcerpt?.trim() === preModelDenial &&
    usage?.inputTokens === 0 && usage.outputTokens === 0 && usage.providerRequestId === null &&
    context?.conversationMode === true && context.issueId === grant.conversationId &&
    context.source === 'issue.comment' && context.conversationSessionGeneration === grant.generation &&
    context.wakeCommentId === comment.id &&
    permit?.runId === run.id && permit.grantId === grant.grantId &&
    permit.conversationId === grant.conversationId && permit.messageId === comment.id &&
    permit.messageDigest === grant.messageDigest && permit.credentialGrantId === grant.credentialGrantId;
}

export function selectSkippedChiefWebMessage({ grant, issue, comments, wakes, runs, permit, claim, receipt, now }) {
  if (!grant || !Number.isSafeInteger(now) || now >= grant.expiresAt ||
      issue?.id !== grant.conversationId || issue.companyId !== grant.companyId ||
      issue.conversationAgentId !== grant.chiefAgentId || issue.conversationUserId !== grant.ownerId ||
      issue.conversationSessionGeneration !== grant.generation || grant.generation !== 0 ||
      issue.conversationState !== 'active' || claim || receipt || comments.length !== 1 ||
      runs.length > 1 || wakes.length !== runs.length + 1) return null;

  const [comment] = comments;
  if (comment.issueId !== issue.id || comment.companyId !== issue.companyId ||
      comment.authorUserId !== grant.ownerId || comment.authorAgentId !== null || comment.createdByRunId !== null ||
      comment.deletedAt !== null || !comment.clientRequestId || typeof comment.body !== 'string' ||
      createHash('sha256').update(comment.body).digest('hex') !== grant.messageDigest ||
      !wakes.every(wake => matchesWake(wake, issue, grant, comment))) return null;
  const skipped = wakes.find(wake => wake.status === 'skipped' && wake.reason === reason && wake.runId === null);
  if (!skipped) return null;
  if (runs.length === 1 && !matchesPreModelDenial(runs[0], wakes.find(wake => wake !== skipped), permit, grant, comment)) return null;
  return comment;
}
