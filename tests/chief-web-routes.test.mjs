import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountChiefWebRoutes } from '../bridge/chief-web-routes.mjs';

const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;

function fixture() {
  const handlers = {};
  const router = {
    get(path, handler) { handlers.get = { path, handler }; },
    post(path, handler) { handlers.post = { path, handler }; },
  };
  const issue = { id: id(1), conversationAgentId: id(2), conversationUserId: 'owner', companyId: id(3), conversationSessionGeneration: 7 };
  const request = {
    actor: { type: 'board', sessionId: 'session', userId: 'owner', companyIds: [issue.companyId] },
    params: { issueId: issue.id }, body: { action: 'pause' }, trustedOrigin: true,
  };
  const calls = [];
  const logs = [];
  const options = {
    enabled: true,
    deploymentMode: 'authenticated',
    chiefAgentId: issue.conversationAgentId,
    getIssue: () => issue,
    trustedBoardMutationOrigin: req => req.trustedOrigin,
    pilot: {
      handle(actor, command) {
        calls.push({ actor, command });
        return { status: 'ok' };
      },
    },
    log: entry => logs.push(entry),
  };
  async function call(method) {
    const result = {};
    await handlers[method].handler(request, {
      set(key, value) { result[key] = value; },
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
    });
    return result;
  }
  return { router, handlers, options, request, issue, calls, logs, call };
}

test('registers only in authenticated deployments when explicitly enabled', () => {
  const { router, handlers, options } = fixture();
  mountChiefWebRoutes(router, { ...options, enabled: false });
  assert.deepEqual(handlers, {});
  assert.throws(() => mountChiefWebRoutes(router, { ...options, deploymentMode: 'local_trusted' }), {
    message: 'CHIEF_WEB_ROUTE_CONFIGURATION_INVALID',
  });
  mountChiefWebRoutes(router, options);
  assert.equal(handlers.get.path, '/issues/:issueId/chief-web-pilot');
  assert.equal(handlers.get.path, handlers.post.path);
});

test('derives the actor from the current native Chief conversation', async () => {
  const { router, options, issue, calls, call } = fixture();
  mountChiefWebRoutes(router, options);
  assert.equal((await call('get')).status, 200);
  assert.equal((await call('post')).status, 202);
  assert.deepEqual(calls[0], {
    actor: { userId: 'owner', companyId: issue.companyId, conversationId: issue.id, generation: 7 },
    command: { action: 'status' },
  });
  assert.equal((await call('get'))['Cache-Control'], 'no-store');
});

test('fences session, membership, Chief identity, origin and browser supplement attempts', async () => {
  const { router, options, request, issue, calls, call } = fixture();
  mountChiefWebRoutes(router, options);
  const actor = request.actor;
  request.actor = { ...actor, sessionId: undefined };
  assert.equal((await call('get')).status, 404);
  request.actor = { ...actor, companyIds: [] };
  assert.equal((await call('get')).status, 404);
  request.actor = actor;
  issue.conversationAgentId = id(9);
  assert.equal((await call('get')).status, 404);
  issue.conversationAgentId = options.chiefAgentId;
  request.trustedOrigin = false;
  assert.equal((await call('post')).status, 403);
  request.trustedOrigin = true;
  request.body = { action: 'supplement' };
  assert.equal((await call('post')).status, 400);
  assert.equal(calls.length, 0);
});

test('redacts errors and signals uncertain reservations as unavailable', async () => {
  const { router, options, logs, call } = fixture();
  options.pilot.handle = () => { throw new Error('private failure'); };
  mountChiefWebRoutes(router, options);
  assert.equal((await call('post')).status, 503);
  assert.deepEqual(logs, [{ code: 'CHIEF_WEB_STATE_UNAVAILABLE' }]);
});
