import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createChiefWebEvaluation, mountChiefWebEvaluationRoutes } from '../bridge/chief-web-evaluation.mjs';
import { createChiefWebEvaluationClient } from '../plugins/chief-web-pilot/ui/index.js';

const companyId = '00000000-0000-0000-0000-000000000001';
const conversationId = '00000000-0000-0000-0000-000000000002';
const taskId = '00000000-0000-0000-0000-000000000003';
const requestId = '00000000-0000-0000-0000-000000000004';
const anotherRequestId = '00000000-0000-0000-0000-000000000005';
const userId = 'test-owner';
const ciToken = 'simulated-ci-test-credential-at-least-32-characters';
const request = { generation: 0, requestId };

function setup() {
  const conversation = { conversationSessionGeneration: 0 };
  let saved = { history: [], task: null };
  let queue = Promise.resolve();
  let dropCandidate = false;
  const repository = {
    transaction(work) {
      const result = queue.then(async () => {
        const draft = structuredClone(saved);
        const value = await work({
          lockConversation: async () => ({ ...conversation }),
          readState: async () => draft.history.at(-1),
          async createTask() {
            assert.equal(draft.task, null);
            draft.task = { id: taskId, identifier: 'EVAL-1', phase: 'queued' };
            return draft.task;
          },
          async lockTask(state) {
            assert.equal(state.taskId, draft.task.id);
          },
          async settleTask(state, phase, artifact) {
            assert.equal(state.taskId, draft.task.id);
            draft.task.phase = phase;
            if (artifact) draft.task.artifact = artifact;
          },
          async appendState(state) {
            if (dropCandidate && state.phase === 'waiting_ci') {
              dropCandidate = false;
              throw new Error('lost result before commit');
            }
            assert.equal(state.sequence, draft.history.length + 1);
            draft.history.push(structuredClone(state));
          },
        });
        saved = draft;
        return value;
      });
      queue = result.catch(() => {});
      return result;
    },
  };
  return {
    newRuntime: () => createChiefWebEvaluation({ repository, log: async () => {} }),
    snapshot: () => structuredClone(saved),
    loseNextCandidate: () => { dropCandidate = true; },
    resetConversation: () => { conversation.conversationSessionGeneration++; },
  };
}

test('a durable registration authorizes only one issue, attempt and matching CI result', async () => {
  const store = setup();
  const first = store.newRuntime();
  assert.deepEqual(await first.status(), { generation: 0, phase: 'ready' });
  const [one, duplicate] = await Promise.all([first.create(request), first.create(request)]);
  assert.deepEqual(one, duplicate);
  assert.equal(one.taskId, taskId);
  assert.equal(one.phase, 'queued');
  await assert.rejects(first.create({ ...request, requestId: anotherRequestId }), { code: 'CHIEF_WEB_EVALUATION_ALREADY_REGISTERED' });
  await Promise.all([first.tick(), first.tick()]);
  const before = await first.status();
  assert.equal(before.phase, 'waiting_ci');
  assert.equal(before.leaseReleased, true);
  assert.match(before.candidateSha, /^[0-9a-f]{64}$/);
  assert.match(store.snapshot().task.artifact, /模拟 CI/);

  const restarted = store.newRuntime();
  await restarted.tick();
  assert.deepEqual(await restarted.status(), before);
  const ci = { operationId: before.operationId, candidateSha: before.candidateSha, conclusion: 'success' };
  await assert.rejects(restarted.acceptCi({ ...ci, candidateSha: 'a'.repeat(64) }), { code: 'CHIEF_WEB_EVALUATION_CI_MISMATCH' });
  await assert.rejects(restarted.acceptCi({ ...ci, operationId: anotherRequestId }), { code: 'CHIEF_WEB_EVALUATION_CI_MISMATCH' });
  const done = await restarted.acceptCi(ci);
  assert.equal(done.phase, 'done');
  assert.equal(done.receipt.taskId, taskId);
  assert.equal(done.leaseReleased, true);
  assert.deepEqual(await restarted.acceptCi(ci), done);
  await assert.rejects(restarted.acceptCi({ ...ci, conclusion: 'failure' }), { code: 'CHIEF_WEB_EVALUATION_CI_MISMATCH' });
  assert.deepEqual(store.snapshot().history.map(row => row.phase), ['queued', 'running', 'waiting_ci', 'done']);
});

test('recovery uses the original attempt when the candidate transaction has no known result', async () => {
  const store = setup();
  const first = store.newRuntime();
  const registered = await first.create(request);
  store.loseNextCandidate();
  await assert.rejects(first.tick(), { message: 'lost result before commit' });
  assert.equal(store.snapshot().task.phase, 'queued');
  assert.equal(store.snapshot().history.length, 2);
  assert.equal(store.snapshot().history[1].leaseHeld, true);
  const restarted = store.newRuntime();
  await restarted.tick();
  const resumed = await restarted.status();
  assert.equal(resumed.operationId, registered.operationId);
  assert.equal(resumed.phase, 'waiting_ci');
  assert.equal(resumed.leaseReleased, true);
  assert.equal(store.snapshot().history.length, 3);
});

test('a reset fences creation and CI and recovers the old task without exposing its receipt', async () => {
  const store = setup();
  const evaluation = store.newRuntime();
  await evaluation.create(request);
  await evaluation.tick();
  const waiting = await evaluation.status();
  store.resetConversation();
  await assert.rejects(evaluation.create(request), { code: 'CHIEF_WEB_EVALUATION_GENERATION_CHANGED' });
  await assert.rejects(evaluation.create({ ...request, generation: 1 }), { code: 'CHIEF_WEB_EVALUATION_GENERATION_CHANGED' });
  await assert.rejects(evaluation.acceptCi({ ...waiting, conclusion: 'success' }), { code: 'CHIEF_WEB_EVALUATION_CI_MISMATCH' });
  await store.newRuntime().tick();
  assert.deepEqual(await evaluation.status(), {
    generation: 1, phase: 'closed', code: 'CHIEF_WEB_EVALUATION_GENERATION_CHANGED',
  });
  assert.equal(store.snapshot().task.phase, 'blocked');
  assert.equal(store.snapshot().history.at(-1).leaseHeld, false);
});

test('route requires the bound browser identity, conversation, generation, same origin and simulation token', async () => {
  const store = setup();
  const handlers = new Map();
  const config = { userId, companyId, conversationId, ciToken, origin: 'http://127.0.0.1:8100' };
  mountChiefWebEvaluationRoutes({
    get(path, handler) { handlers.set('GET ' + path, handler); },
    post(path, handler) { handlers.set('POST ' + path, handler); },
  }, { config, evaluation: store.newRuntime(), trustedBoardMutationOrigin: input => input.origin });
  const route = '/issues/:issueId/chief-web-evaluation';
  const actor = { type: 'board', userId, companyIds: [companyId], sessionId: 'session' };
  const defaults = {
    params: { issueId: conversationId }, actor, origin: 'http://127.0.0.1:8100',
    body: { action: 'create', ...request }, header: () => ciToken,
  };
  async function call(method, suffix, override = {}) {
    const response = {
      set() {},
      status(value) { this.statusCode = value; return this; },
      json(body) { return { status: this.statusCode, body }; },
    };
    return handlers.get(method + ' ' + route + suffix)({ ...defaults, ...override }, response);
  }
  assert.equal((await call('GET', '', { actor: { ...actor, userId: 'other' } })).status, 404);
  assert.equal((await call('GET', '', { actor: { ...actor, companyIds: [] } })).status, 404);
  assert.equal((await call('POST', '', { actor: { ...actor, sessionId: null } })).status, 404);
  assert.equal((await call('POST', '', { params: { issueId: taskId } })).status, 404);
  assert.equal((await call('POST', '', { origin: null })).status, 403);
  assert.equal((await call('POST', '', { origin: 'http://127.0.0.1:3100' })).status, 403);
  assert.equal((await call('POST', '', { body: { ...defaults.body, generation: 1 } })).status, 409);
  assert.equal((await call('POST', '')).status, 202);
  await setImmediate();
  const waiting = (await call('GET', '')).body;
  assert.equal(waiting.phase, 'waiting_ci');
  const body = { operationId: waiting.operationId, candidateSha: waiting.candidateSha, conclusion: 'failure' };
  assert.equal((await call('POST', '/ci', { header: () => 'forged', body })).status, 403);
  const terminal = await call('POST', '/ci', { body });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.phase, 'blocked');
  assert.equal(terminal.body.leaseReleased, true);
  assert.equal((await call('GET', '')).body.receipt.conclusion, 'failure');
});

test('browser intake only sends the same-origin generation and request id', async () => {
  const calls = [];
  const browser = createChiefWebEvaluationClient(conversationId, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ phase: 'queued' }) };
  });
  await browser.create(0, requestId);
  await browser.create(0, requestId);
  for (const { url, options } of calls) {
    assert.equal(url, '/api/issues/' + conversationId + '/chief-web-evaluation');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), { action: 'create', ...request });
  }
});
