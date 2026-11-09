import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChiefWebRealEngine, REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY } from '../bridge/chief-web-real-engine.mjs';

const conversationId = randomUUID();
const taskId = randomUUID();
const firstHead = 'a'.repeat(40);
const secondHead = 'b'.repeat(40);
const baseSha = 'c'.repeat(40);
const branch = 'codex/integrate-super-agent-' + taskId;
const receiptDigest = 'e'.repeat(64);

function setup() {
  const calls = [], publications = [], records = [], messages = [], statuses = [];
  let issued = 0, staleCi = true, clock = 100;
  let respondToReview = true;
  const repository = {
    async readOwnerMessages() { return structuredClone(messages); },
    async transaction(work) {
      return work({
        readState: () => structuredClone(records.at(-1)),
        createTask() { issued++; return { id: taskId, identifier: 'CHI-2' }; },
        setTask({ status }) { statuses.push(status); },
        appendState(state) { records.push(structuredClone(state)); },
      });
    },
  };
  const receipt = (request, result) => ({
    status: 'completed', taskId: request.taskId, operationId: request.operationId,
    inputRevision: request.inputRevision, evidenceDigest: receiptDigest, result,
  });
  const models = request => {
    if (request.role === 'chief') return receipt(request, { accepted: true, targetDoc: REAL_RWB_DOCUMENT, requirements: request.text });
    if (request.role === 'developer') {
      return receipt(request, { candidateSha: request.revision === 1 ? firstHead : secondHead, baseSha, branch, checksPassed: true });
    }
    return respondToReview ? receipt(request, { approved: true, candidateSha: request.candidateSha, reviewDigest: receiptDigest }) :
      { status: 'pending' };
  };
  const config = { conversationId, generation: 0, expiresAt: 9_000_000 };
  const publisher = {
    async publish(request) {
      publications.push(request);
      return receipt(request, { headSha: request.candidateSha, baseSha, branch, number: 123,
        url: 'https://github.com/' + REAL_RWB_REPOSITORY + '/pull/123' });
    },
    async observePublication() { assert.fail('unrequested publication replay'); },
    async readCi(request) {
      if (request.revision === 1) return { status: 'pending' };
      return receipt(request, { number: 123, headSha: staleCi ? firstHead : secondHead, conclusion: 'success',
        checksDigest: receiptDigest });
    },
  };
  const engine = () => createChiefWebRealEngine({
    repository, config, publisher, log: async () => {}, now: () => clock,
    executor: {
      async execute(request) { calls.push(request); return models(request); },
      async observe(request) { return models(request); },
    },
  });
  return { engine, records, messages, calls, publications, statuses, issued: () => issued,
    newMessage: text => messages.push({ id: randomUUID(), text, generation: 0 }),
    advanceClock: value => { clock += value; }, answerReview: value => { respondToReview = value; },
    correctCi: () => { staleCi = false; },
  };
}

async function until(engine, phase) {
  for (let i = 0; i < 10; i++) {
    const state = await engine.status();
    if (state.phase === phase) return state;
    await engine.tick();
  }
  assert.equal((await engine.status()).phase, phase);
}

function command(state, action) {
  return { requestId: randomUUID(), generation: 0, expectedRevision: state.contextRevision, action };
}

function approval(state) {
  return { ...command(state, 'confirm'), candidateSha: state.candidateSha, reviewDigest: state.reviewDigest,
    baseSha: state.baseSha, previousHead: state.previousHead };
}

test('two owner inputs retain one Native task and PR across a restart and ignore stale CI', async () => {
  const f = setup();
  const live = f.engine();
  f.newMessage('请新建真实验收说明');
  const first = await until(live, 'awaiting_confirmation');
  const confirmed = approval(first);
  await assert.rejects(live.control({ ...confirmed, baseSha: 'd'.repeat(40) }), { code: 'CHIEF_WEB_REAL_CONFIRMATION_STALE' });
  await live.control(confirmed);
  await live.control(confirmed);
  await until(live, 'waiting_ci');
  await live.tick();
  f.newMessage('追加发布回执丢失时的核对步骤');
  const second = await until(live, 'awaiting_confirmation');
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.pr.headSha, firstHead);
  assert.equal(second.previousHead, firstHead);
  assert.equal(second.revision, 2);
  await live.control(approval(second));
  await until(live, 'waiting_ci');
  const restarted = f.engine();
  await restarted.tick();
  assert.equal((await restarted.status()).phase, 'waiting_ci');
  f.correctCi();
  const final = await until(restarted, 'done');
  assert.equal(final.ci.headSha, secondHead);
  assert.equal(final.pr.number, 123);
  assert.equal(final.pr.branch, branch);
  assert.equal(f.issued(), 1);
  assert.equal(f.calls.length, 6);
  assert.equal(f.publications.length, 2);
  assert.equal(new Set(f.calls.map(call => call.slotId)).size, 6);
  assert.equal(f.statuses.at(-1), 'done');
});

test('pause before dispatch revokes approval and repeated operation has one effect', async () => {
  const f = setup();
  const engine = f.engine();
  f.newMessage('创建验收文档');
  await engine.control(command(await engine.status(), 'pause'));
  await engine.tick();
  assert.equal(f.calls.length, 0);
  await engine.control(command(await engine.status(), 'resume'));
  const candidate = await until(engine, 'awaiting_confirmation');
  await engine.control(approval(candidate));
  await engine.control(command(await engine.status(), 'pause'));
  await engine.tick();
  assert.equal(f.publications.length, 0);
  assert.equal((await engine.status()).phase, 'awaiting_confirmation');
});

test('expiry discards an unlaunched approval without publishing', async () => {
  const f = setup();
  const engine = f.engine();
  f.newMessage('创建验收文档');
  const candidate = await until(engine, 'awaiting_confirmation');
  await engine.control(approval(candidate));
  f.advanceClock(15 * 60_000);
  await engine.tick();
  assert.equal(f.publications.length, 0);
  assert.equal((await engine.status()).code, 'CHIEF_WEB_REAL_CONFIRMATION_EXPIRED');
});

test('restart observes an already reserved review without a new model call', async () => {
  const f = setup();
  f.answerReview(false);
  const engine = f.engine();
  f.newMessage('创建验收文档');
  await until(engine, 'reviewing');
  await engine.tick();
  assert.equal(f.calls.length, 3);
  const op = (await engine.status()).operationId;
  assert.ok(op);
  const resumed = f.engine();
  f.answerReview(true);
  await until(resumed, 'awaiting_confirmation');
  assert.equal(f.calls.length, 3);
  assert.equal(f.records.at(-1).results.at(-1).operationId, op);
});
