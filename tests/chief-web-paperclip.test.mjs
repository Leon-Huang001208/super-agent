import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChiefWebPaperclipMount } from '../bridge/chief-web-paperclip.mjs';

test('assembles authenticated routes from the app database binding without opening a second client', async () => {
  const db = {};
  const routes = [];
  const logs = [];
  const mount = createChiefWebPaperclipMount({
    async loadBindings(input) {
      assert.equal(input.db, db);
      return {
        chiefAgentId: '00000000-0000-0000-0000-000000000001',
        repository: { transaction() { assert.fail('route mounting must not open a transaction'); } },
        readGrant() {},
        readProjection() {},
        verifyOwnerSupplement() {},
      };
    },
    log: entry => logs.push(entry),
  });
  const api = { get: path => routes.push(['GET', path]), post: path => routes.push(['POST', path]) };
  const app = { api, db, getIssue() {}, trustedBoardMutationOrigin() {} };
  await assert.rejects(mount({ ...app, deploymentMode: 'local_trusted' }), { message: 'CHIEF_WEB_MOUNT_AUTH_REQUIRED' });
  assert.equal(routes.length, 0);
  await mount({ ...app, deploymentMode: 'authenticated' });
  assert.deepEqual(routes, [
    ['GET', '/issues/:issueId/chief-web-pilot'],
    ['POST', '/issues/:issueId/chief-web-pilot'],
  ]);
  assert.deepEqual(logs, [{ code: 'CHIEF_WEB_MOUNT_READY' }]);
});

test('fails closed if the explicit deployment cannot resolve its trusted bindings', async () => {
  const logs = [];
  const mount = createChiefWebPaperclipMount({
    loadBindings() { throw new Error('private startup details'); },
    log: entry => logs.push(entry),
  });
  await assert.rejects(mount({ deploymentMode: 'authenticated' }), { message: 'CHIEF_WEB_MOUNT_FAILED' });
  assert.deepEqual(logs, [{ code: 'CHIEF_WEB_MOUNT_FAILED' }]);
});
