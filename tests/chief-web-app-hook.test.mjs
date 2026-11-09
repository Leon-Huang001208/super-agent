import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeConfiguredChiefWebRecoveredWake, dispatchConfiguredChiefWebRecovery, patchChiefWebQueueSource, mountConfiguredChiefWebPilot, patchChiefWebAppSource, patchChiefWebConversationSource } from '../docker/chief-web-app-hook.mjs';

test('fails closed on a drifted Paperclip release or missing opt-in mount', async () => {
  assert.throws(() => patchChiefWebAppSource('    api.use(boardMutationGuard());'), {
    code: 'CHIEF_WEB_APP_BASE_DRIFT',
  });
  assert.throws(() => patchChiefWebConversationSource('export async function settleConversationTurn(db, run) {'), {
    code: 'CHIEF_WEB_CONVERSATION_BASE_DRIFT',
  });
  await assert.rejects(mountConfiguredChiefWebPilot({ deploymentMode: 'authenticated' }), {
    code: 'CHIEF_WEB_APP_NOT_CONFIGURED',
  });
});

test('one proven recovery can cross only the matching Native on-demand gate once', async () => {
  const issue = { id: 'chat', companyId: 'company', conversationAgentId: 'chief' };
  const comment = { id: 'message', authorUserId: 'owner' };
  const opts = { triggerDetail: 'manual', reason: 'issue_commented', requestedByActorType: 'user', requestedByActorId: 'owner',
    idempotencyKey: 'conversation-comment:message', payload: { issueId: 'chat', commentId: 'message' } };
  const context = { source: 'issue.comment', issueId: 'chat', wakeCommentId: 'message' };
  const claim = (source = 'on_demand', proposed = opts) => consumeConfiguredChiefWebRecoveredWake('company', 'chief', source, proposed, context);
  assert.equal(claim(), false);
  await dispatchConfiguredChiefWebRecovery(issue, comment, async () => {
    await Promise.resolve();
    assert.equal(claim('timer'), false);
    assert.equal(claim('on_demand', { ...opts, requestedByActorId: 'another-owner' }), false);
    assert.equal(claim(), true);
    assert.equal(claim(), false);
  });
  assert.equal(claim(), false);
  assert.throws(() => patchChiefWebQueueSource('changed queue'), { code: 'CHIEF_WEB_QUEUE_BASE_DRIFT' });
});
