import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createChiefWebRealIntakeRepository, mountChiefWebRealRoutes, verifyChiefWebRealOwnerMessage } from '../bridge/chief-web-real-intake.mjs';
import { createChiefWebRealClient } from '../plugins/chief-web-pilot/ui/index.js';

const id = n => '00000000-0000-0000-0000-00000000000' + n;
const config = Object.freeze({ companyId: id(1), chiefAgentId: id(2), conversationId: id(3), projectId: id(4),
  userId: 'owner', generation: 1, intakeFrom: 10, expiresAt: 20 });
const origin = 'http://127.0.0.1:8107';
const owner = { type: 'board', sessionId: 'session', userId: config.userId, companyIds: [config.companyId] };
const message = {
  id: id(5), issueId: config.conversationId, companyId: config.companyId, authorUserId: config.userId, authorType: 'user',
  authorAgentId: null, createdByRunId: null, derivedAuthorAgentId: null, derivedCreatedByRunId: null, onBehalfOfUserId: null,
  deletedAt: null, origin: 'comment', clientRequestId: id(6), conversationSessionGeneration: null,
  createdAt: new Date(12), body: '请添加文档说明',
};
const confirm = { action: 'confirm', requestId: id(7), generation: 1, expectedRevision: 'a'.repeat(64),
  candidateSha: 'b'.repeat(40), reviewDigest: 'c'.repeat(64), previousHead: null, baseSha: 'd'.repeat(40) };

test('selects only the verified Native owner message in the authorized intake window', () => {
  assert.deepEqual(verifyChiefWebRealOwnerMessage(message, config), { id: message.id, text: message.body, generation: 1 });
  for (const changes of [{ issueId: id(8) }, { authorUserId: 'other' }, { authorType: 'agent' }, { createdByRunId: id(8) },
    { derivedAuthorAgentId: id(8) }, { onBehalfOfUserId: 'owner' }, { deletedAt: new Date(13) }, { origin: 'fast_response' },
    { clientRequestId: '' }, { conversationSessionGeneration: 0 }, { createdAt: new Date(10) }, { body: ' /new' }, { body: 'x'.repeat(4001) }]) {
    assert.equal(verifyChiefWebRealOwnerMessage({ ...message, ...changes }, config), null);
  }
});

function routeFixture() {
  const handlers = new Map();
  const calls = [];
  let isolation = true;
  const router = {
    get(path, handler) { handlers.set('GET ' + path, handler); },
    post(path, handler) { handlers.set('POST ' + path, handler); },
  };
  mountChiefWebRealRoutes(router, {
    config, origin, trustedBoardMutationOrigin: request => request.origin,
    repository: {
      async assertNativeIntakeSafe() {
        if (!isolation) throw Object.assign(new Error(), { code: 'CHIEF_WEB_REAL_NATIVE_DISPATCH_UNFENCED', status: 503 });
      },
    },
    engine: {
      async tick() { calls.push('tick'); },
      async status() { calls.push('status'); return { phase: 'ready' }; },
      async control(command) { calls.push(command); return { phase: 'approved' }; },
    },
    async log({ code }) { assert.match(code, /^CHIEF_WEB_REAL_[A-Z_]+$/); },
  });
  async function call(method, path, change, next) {
    const request = { params: { issueId: config.conversationId }, actor: owner, origin, ...change };
    const response = {
      set() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { return { status: this.statusCode, body }; },
    };
    return handlers.get(method + ' /issues/:issueId/' + path)(request, response, () => next(response));
  }
  return { call, calls, disableIsolation: () => { isolation = false; } };
}

test('wakes on boot and after a successful Native commit, independent of status polling', async () => {
  const { call, calls } = routeFixture();
  await setImmediate();
  assert.deepEqual(calls, ['tick']);
  assert.equal((await call('GET', 'chief-web-real')).status, 200);
  await setImmediate();
  assert.deepEqual(calls, ['tick', 'status']);
  const native = await call('POST', 'comments', { body: { body: message.body } },
    response => response.status(201).json({ id: message.id }));
  assert.deepEqual(native, { status: 201, body: { id: message.id } });
  await setImmediate();
  assert.deepEqual(calls, ['tick', 'status', 'tick']);
  await call('POST', 'comments', {}, response => response.status(409).json({ id: message.id }));
  await setImmediate();
  assert.deepEqual(calls, ['tick', 'status', 'tick']);
});

test('fences Native provider dispatch and requires owner, origin, generation and exact confirmation fields', async () => {
  const { call, calls, disableIsolation } = routeFixture();
  await setImmediate();
  const noNext = () => assert.fail('unexpected Native route');
  assert.equal((await call('GET', 'chief-web-real', { actor: { ...owner, sessionId: null } })).status, 404);
  assert.equal((await call('POST', 'chief-web-real', { body: confirm, actor: { ...owner, userId: 'other' } })).status, 404);
  assert.equal((await call('POST', 'chief-web-real', { body: confirm, origin: 'http://localhost:8107' })).status, 403);
  assert.equal((await call('POST', 'chief-web-real', { body: { ...confirm, generation: 0 } })).status, 409);
  assert.equal((await call('POST', 'chief-web-real', { body: { ...confirm, previousHead: undefined } })).status, 400);
  assert.equal((await call('POST', 'chief-web-real', { body: { ...confirm, extra: true } })).status, 400);
  assert.equal((await call('POST', 'comments', { body: { body: '/new' } }, noNext)).status, 400);
  disableIsolation();
  assert.equal((await call('POST', 'comments', { body: { body: message.body } }, noNext)).status, 503);
  assert.equal((await call('POST', 'chief-web-real', { body: confirm })).status, 202);
  await setImmediate();
  assert.deepEqual(calls, ['tick', confirm, 'tick']);
});

test('adds an assigned Native issue and the chat ledger in the same locked transaction', async () => {
  const activityLog = {};
  const issueComments = {};
  const agents = {};
  const instanceSettings = {};
  const rows = new Map([[activityLog, []], [issueComments, [message]], [agents, [{ runtimeConfig: { heartbeat: {
    enabled: false, wakeOnDemand: false,
  } } }]], [instanceSettings, [{ experimental: { enableFastResponses: false } }]]]);
  const conversation = {
    id: config.conversationId, companyId: config.companyId, conversationAgentId: config.chiefAgentId,
    conversationUserId: config.userId, conversationSessionGeneration: config.generation, conversationBoundaryCommentId: id(8),
  };
  let task;
  let lockCount = 0;
  const tx = {
    select() {
      const query = {
        from(table) { query.table = table; return query; },
        where() { return query; },
        orderBy() { return query; },
        async limit() { return rows.get(query.table); },
      };
      return query;
    },
    insert(table) {
      return { async values(values) { assert.equal(table, activityLog); rows.get(table).unshift(values); } };
    },
  };
  const fakeExpression = () => {};
  const repository = createChiefWebRealIntakeRepository({
    db: { transaction: work => work(tx) }, config, schema: { activityLog, issueComments, agents, instanceSettings },
    orm: { and: fakeExpression, asc: fakeExpression, desc: fakeExpression, eq: fakeExpression,
      gt: fakeExpression, isNull: fakeExpression, sql: fakeExpression },
    issueService: () => ({
      async getByIdForUpdate(taskId, transaction) {
        assert.equal(transaction, tx);
        lockCount++;
        return taskId === conversation.id ? conversation : task;
      },
      async create(companyId, data, transaction) {
        assert.equal(transaction, tx);
        assert.equal(lockCount, 1);
        assert.equal(data.status, 'in_progress');
        assert.equal(data.assigneeUserId, config.userId);
        task = { id: id(9), companyId, identifier: 'EVAL-9', assigneeAgentId: null, ...data };
        return task;
      },
      async update(taskId, data, transaction) {
        assert.equal(transaction, tx);
        assert.equal(task.id, taskId);
        return { ...task, ...data };
      },
    }),
  });
  await repository.transaction(async port => {
    assert.equal(await port.readState(), null);
    const native = await port.createTask({ title: 'Scoped document', description: 'Exact path' });
    assert.equal(native.id, id(9));
    await port.appendState({ generation: 1, taskId: native.id, messages: [message.id] });
    await port.setTask({ taskId: native.id, status: 'in_review' });
  });
  assert.equal(rows.get(activityLog)[0].entityId, config.conversationId);
  assert.deepEqual(await repository.transaction(port => port.readState()), {
    generation: 1, taskId: id(9), messages: [message.id],
  });
  assert.deepEqual(await repository.readOwnerMessages(), [{ id: message.id, text: message.body, generation: 1 }]);
});

test('browser control sends the exact same-origin confirmation binding', async () => {
  const calls = [];
  const client = createChiefWebRealClient(config.conversationId, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 202, json: async () => ({ phase: 'approved' }) };
  });
  assert.equal((await client.control(confirm)).phase, 'approved');
  assert.equal(calls[0].url, '/api/issues/' + config.conversationId + '/chief-web-real');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].options.body), confirm);
});
