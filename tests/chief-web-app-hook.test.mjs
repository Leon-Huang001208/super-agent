import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountConfiguredChiefWebPilot, patchChiefWebAppSource, patchChiefWebConversationSource } from '../docker/chief-web-app-hook.mjs';

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
