import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { selectSkippedChiefWebMessage } from '../bridge/chief-web-skipped-wake.mjs';

function fixture() {
  const body = '原网页消息';
  const grant = { conversationId: 'chat', companyId: 'company', chiefAgentId: 'chief', ownerId: 'owner',
    generation: 0, expiresAt: 100, messageDigest: createHash('sha256').update(body).digest('hex') };
  const issue = { id: 'chat', companyId: 'company', conversationAgentId: 'chief', conversationUserId: 'owner',
    conversationSessionGeneration: 0, conversationState: 'active' };
  const comment = { id: 'comment', issueId: 'chat', companyId: 'company', authorUserId: 'owner', authorAgentId: null,
    deletedAt: null, createdByRunId: null, clientRequestId: 'request', body };
  const wake = { companyId: 'company', agentId: 'chief', status: 'skipped', reason: 'heartbeat.wakeOnDemand.disabled',
    runId: null, source: 'on_demand', triggerDetail: 'manual', requestedByActorType: 'user', requestedByActorId: 'owner',
    idempotencyKey: 'conversation-comment:comment', payload: { issueId: 'chat', commentId: 'comment' } };
  return { grant, issue, comments: [comment], wakes: [wake], runs: [], claim: null, now: 1 };
}

test('recovers the original authenticated message after a single skipped wake with no run or claim', () => {
  const input = fixture();
  assert.equal(selectSkippedChiefWebMessage(input), input.comments[0]);
});

test('denies another message, a queued wake, a different skip, and any observed provider work', () => {
  for (const modify of [
    input => { input.comments[0].body += ' extra'; },
    input => { input.comments.push({ ...input.comments[0] }); },
    input => { input.wakes[0].reason = 'company.inactive'; },
    input => { input.wakes.push({ ...input.wakes[0], status: 'queued' }); },
    input => { input.wakes[0].runId = 'run'; },
    input => { input.runs.push({ id: 'another' }); },
    input => { input.claim = {}; },
    input => { input.now = 100; },
    input => { input.issue.conversationSessionGeneration = 1; },
  ]) {
    const input = fixture();
    modify(input);
    assert.equal(selectSkippedChiefWebMessage(input), null);
  }
});

function preModelFixture() {
  const input = fixture();
  input.grant.grantId = 'grant';
  input.grant.credentialGrantId = 'credential';
  const denial = '{"code":"CHIEF_CALL_ENVIRONMENT_DENIED","retryAllowed":false}';
  input.wakes.push({ ...input.wakes[0], id: 'failed-wake', status: 'failed', runId: 'run', reason: 'issue_commented' });
  input.runs.push({
    id: 'run', companyId: 'company', agentId: 'chief', wakeupRequestId: 'failed-wake',
    status: 'failed', exitCode: 78, errorCode: 'adapter_failed', error: denial, stderrExcerpt: denial + '\n',
    contextSnapshot: { conversationMode: true, issueId: 'chat', source: 'issue.comment',
      conversationSessionGeneration: 0, wakeCommentId: 'comment' },
    usageJson: { inputTokens: 0, outputTokens: 0, providerRequestId: null },
  });
  input.permit = {
    runId: 'run', grantId: 'grant', conversationId: 'chat', messageId: 'comment',
    messageDigest: input.grant.messageDigest, credentialGrantId: 'credential',
  };
  return input;
}

test('recovers one proven pre-model environment rejection while preserving both prior wakes', () => {
  const input = preModelFixture();
  input.wakes.reverse();
  assert.equal(selectSkippedChiefWebMessage(input), input.comments[0]);
});

test('denies unknown usage, any claim or receipt, mismatched proof and a further run', () => {
  for (const modify of [
    input => { input.runs[0].stderrExcerpt = '{"code":"CHIEF_CALL_OUTCOME_UNKNOWN","retryAllowed":false}'; },
    input => { input.runs[0].usageJson.inputTokens = 1; },
    input => { delete input.runs[0].usageJson.providerRequestId; },
    input => { input.permit.runId = 'another'; },
    input => { input.claim = {}; },
    input => { input.receipt = {}; },
    input => { input.runs.push({ ...input.runs[0], id: 'another' }); },
    input => { input.wakes.push({ ...input.wakes[1], id: 'another' }); },
  ]) {
    const input = preModelFixture();
    modify(input);
    assert.equal(selectSkippedChiefWebMessage(input), null);
  }
});
