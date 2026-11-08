import assert from 'node:assert/strict';
import { test } from 'node:test';
import manifest from '../plugins/chief-web-pilot/manifest.js';
import { createChiefWebClient, ChiefWebPilotPanel } from '../plugins/chief-web-pilot/ui/index.js';

const issueId = '00000000-0000-0000-0000-000000000001';

test('declares a native task detail slot using the existing SDK surface', () => {
  const [slot] = manifest.ui.slots;
  assert.equal(slot.type, 'taskDetailView');
  assert.deepEqual(slot.entityTypes, ['issue']);
  assert.equal(slot.exportName, ChiefWebPilotPanel.name);
  assert.deepEqual(manifest.capabilities, ['ui.detailTab.register']);
});

test('calls only the scoped same-origin board API and sends the displayed revision', async () => {
  const calls = [];
  const client = createChiefWebClient(issueId, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ phase: 'waiting_ci' }) };
  });
  assert.equal((await client.status()).phase, 'waiting_ci');
  const command = { action: 'pause', contextRevision: 'a'.repeat(64), requestId: issueId };
  await client.control(command);
  assert.equal(calls[0].url, '/api/issues/' + issueId + '/chief-web-pilot');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), command);
  assert.throws(() => createChiefWebClient('../outside'), { message: 'CHIEF_WEB_CONVERSATION_INVALID' });
  assert.throws(() => client.control({ action: 'supplement' }), { message: 'CHIEF_WEB_ACTION_INVALID' });
});

test('hides the slot without access and redacts unexpected API error bodies', async () => {
  const missing = createChiefWebClient(issueId, async () => ({ status: 404 }));
  assert.equal(await missing.status(), null);
  const failed = createChiefWebClient(issueId, async () => ({
    ok: false, status: 503, json: async () => ({ code: 'private error' }),
  }));
  await assert.rejects(failed.status(), { message: 'CHIEF_WEB_STATUS_UNAVAILABLE' });
});
