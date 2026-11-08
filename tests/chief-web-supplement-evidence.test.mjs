import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { createChiefWebSupplementEvidence } from '../bridge/chief-web-supplement-evidence.mjs';

function fixture() {
  const binding = {
    taskId: CHIEF_WEB_PILOT.taskId, companyId: 'company', ownerId: 'owner',
    conversationId: 'conversation', grantId: 'grant', generation: 1,
  };
  const message = {
    id: 'message', issueId: binding.conversationId, companyId: binding.companyId,
    authorUserId: binding.ownerId, authorAgentId: null, createdByRunId: null, deletedAt: null,
    body: '补充同一任务续接的证据',
  };
  const run = {
    id: 'run', wakeupRequestId: 'wake', status: 'succeeded', companyId: binding.companyId, agentId: 'chief',
    contextSnapshot: {
      issueId: binding.conversationId, conversationMode: true, conversationSessionGeneration: 1,
      wakeCommentId: message.id, wakeCommentIds: [message.id], conversationReplyBoundaryCommentId: message.id,
    },
  };
  const wake = {
    id: run.wakeupRequestId, runId: run.id, status: 'completed', companyId: binding.companyId,
    agentId: run.agentId, reason: 'issue_commented', requestedByActorType: 'user', requestedByActorId: binding.ownerId,
    idempotencyKey: 'conversation-comment:' + message.id,
    payload: { issueId: binding.conversationId, commentId: message.id },
  };
  const evidence = { message, run, wake, boundaryChecked: true };
  const receipt = {
    status: 'completed', intent: 'supplement_rwb_pr261', taskId: binding.taskId, targetPath: CHIEF_WEB_PILOT.path,
    grantId: binding.grantId, companyId: binding.companyId, conversationId: binding.conversationId,
    generation: binding.generation, messageId: message.id, runId: run.id, agentId: run.agentId,
    messageDigest: createHash('sha256').update(message.body).digest('hex'),
    model: CHIEF_WEB_PILOT.model, reasoningEffort: 'low', apiFallback: false, physicalCallsForGrant: 1, providerClaimId: 'claim',
  };
  const transaction = {};
  const logs = [];
  const verify = createChiefWebSupplementEvidence({
    chiefAgentId: run.agentId,
    readNativeEvidence(input) {
      assert.equal(input.transaction, transaction);
      return evidence;
    },
    readChiefCallReceipt(input) {
      assert.equal(input.transaction, transaction);
      assert.equal(input.runId, run.id);
      return receipt;
    },
    log: entry => logs.push(entry),
  });
  const check = () => verify({ task: { id: binding.taskId }, transaction, binding, messageId: message.id });
  return { check, binding, message, run, wake, evidence, receipt, logs };
}

test('accepts one exact completed Chief turn and physical call', async () => {
  const { check, logs } = fixture();
  const proof = await check();
  assert.equal(proof.providerClaimId, 'claim');
  assert.equal(proof.runId, 'run');
  assert.equal(proof.wakeId, 'wake');
  assert.deepEqual(logs, [{ code: 'CHIEF_WEB_CALL_EVIDENCE_VERIFIED' }]);
});

test('rejects reset, other owner, another generation and bundled messages', async () => {
  for (const apply of [
    ({ message }) => { message.body = '/new'; },
    ({ message }) => { message.authorUserId = 'other'; },
    ({ run }) => { run.contextSnapshot.conversationSessionGeneration++; },
    ({ run }) => { run.contextSnapshot.wakeCommentIds.push('another'); },
    ({ run }) => { run.status = 'running'; },
    ({ evidence }) => { evidence.boundaryChecked = false; },
    ({ wake }) => { wake.reason = 'interaction_resolved'; },
    ({ wake }) => { wake.requestedByActorId = 'other'; },
    ({ wake }) => { wake.idempotencyKey = 'retry:' + wake.runId; },
  ]) {
    const f = fixture();
    apply(f);
    assert.equal(await f.check(), false);
  }
});

test('rejects a changed message, scope, model or physical call count', async () => {
  for (const apply of [
    ({ message }) => { message.body += ' changed'; },
    ({ receipt }) => { receipt.targetPath = 'docs/README.md'; },
    ({ receipt }) => { receipt.apiFallback = true; },
    ({ receipt }) => { receipt.physicalCallsForGrant = 2; },
  ]) {
    const f = fixture();
    apply(f);
    assert.equal(await f.check(), false);
    assert.deepEqual(f.logs, [{ code: 'CHIEF_WEB_CALL_EVIDENCE_DENIED' }]);
  }
});
