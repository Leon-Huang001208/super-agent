import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChiefFeishuController, chiefFeishuOperation } from '../bridge/chief-feishu-native.mjs';

const id = number => String(number).padStart(8, '0') + '-1111-4111-8111-111111111111';
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
function message(text = '/chief 研究已知证据并交接 Product Manager', messageId = 'om_original') {
  return {
    schemaVersion: 1, source: 'feishu', appId: 'cli_testapp', tenantKey: 'tenantowner',
    ownerOpenId: 'ou_owner', nativeOwnerId: 'n6MxHj1whoJQggkbVPBdXUpybvBaa7RI',
    companyId: id(1), projectId: id(2), chiefAgentId: id(3),
    messageId, externalId: messageId, chatId: 'oc_owner', text, goal: text.slice(6).trim(),
    bodySha256: hash(text), sourceParams: { source: 'feishu', messageId, bodySha256: hash(text) },
  };
}

/** A transactional Native repository double; a lost commit reply retains committed state. */
function nativeRepository() {
  let state = { tasks: new Map(), ledgers: new Map(), nextTask: 100 };
  let queue = Promise.resolve();
  const commitReplyLosses = new Map();
  let createAttempts = 0;
  const repository = {
    transaction(operationId, fn) {
      const pending = queue.then(async () => {
        const draft = clone(state), touched = [];
        const ledger = draft.ledgers.get(operationId) ?? new Map();
        draft.ledgers.set(operationId, ledger);
        const result = await fn({
          async readRegistration() { return clone(ledger.get('registered') ?? null); },
          async readState(name) { return clone(ledger.get(name) ?? null); },
          async readTask(taskId) { return clone(draft.tasks.get(taskId) ?? null); },
          async createTask(input) {
            createAttempts += 1;
            const task = {
              id: id(draft.nextTask++), identifier: 'LEO-' + draft.nextTask,
              title: input.goal.split('\n')[0].slice(0, 140), description: input.goal,
              companyId: input.companyId, projectId: input.projectId,
              createdByUserId: input.nativeOwnerId, responsibleUserId: input.nativeOwnerId,
              assigneeAgentId: input.chiefAgentId, parentId: null, status: 'todo',
            };
            draft.tasks.set(task.id, task);
            return clone(task);
          },
          async append(name, value) {
            assert.equal(ledger.has(name), false, 'Native claim/receipt must be appended once');
            ledger.set(name, clone(value)); touched.push(name);
          },
        });
        state = draft;
        const lost = touched.find(name => (commitReplyLosses.get(name) ?? 0) > 0);
        if (lost) {
          commitReplyLosses.set(lost, commitReplyLosses.get(lost) - 1);
          throw Object.assign(Error('transaction committed, reply lost'), { code: 'TEST_COMMIT_REPLY_LOST' });
        }
        return clone(result);
      });
      queue = pending.catch(() => {});
      return pending;
    },
    async listRegistrations() {
      await queue;
      return [...state.ledgers.values()].flatMap(ledger => ledger.has('registered') ? [clone(ledger.get('registered'))] : []);
    },
  };
  return {
    repository,
    get createAttempts() { return createAttempts; },
    tasks: () => [...state.tasks.values()].map(clone),
    ledger: input => clone(state.ledgers.get(chiefFeishuOperation(input)) ?? new Map()),
    mutateTask(taskId, patch) { Object.assign(state.tasks.get(taskId), patch); },
    loseCommitReply(name, count = 1) { commitReplyLosses.set(name, count); },
  };
}
function harness(options = {}) {
  const native = nativeRepository(), wakes = [], acks = [], logs = [];
  let dispatchAllowed = true;
  const controller = createChiefFeishuController({
    repository: native.repository,
    canDispatch: () => dispatchAllowed,
    wake: async receipt => { wakes.push(clone(receipt)); return { id: id(200 + wakes.length) }; },
    acknowledge: async receipt => { acks.push(clone(receipt)); return { messageId: 'om_ack' + acks.length }; },
    log: async record => { logs.push(clone(record)); },
    ...options,
  });
  return { controller, native, wakes, acks, logs, setActive: active => { dispatchAllowed = !active; } };
}

test('concurrent duplicate messages and drains share one Native task, wake and ACK', async () => {
  const { controller, native, wakes, acks } = harness();
  const input = message();
  const results = await Promise.all([
    controller.registerTrustedMessage(input), controller.registerTrustedMessage(clone(input)),
  ]);
  assert.equal(native.tasks().length, 1);
  assert.equal(native.createAttempts, 1);
  assert.equal(results[0].taskId, results[1].taskId);
  assert.equal(results[0].operationId, results[1].operationId);
  assert.deepEqual(results.map(result => result.reused), [false, true]);
  assert.equal(acks.length, 1);
  await Promise.all([controller.drain(), controller.drain()]);
  await controller.registerTrustedMessage(input);
  await controller.drain();
  assert.equal(wakes.length, 1);
  assert.equal(acks.length, 1);
  assert.deepEqual([...native.ledger(input).keys()], ['registered', 'ack_claimed', 'ack_sent', 'wake_claimed', 'wake_sent']);
  assert.equal(native.ledger(input).get('wake_sent').runId, id(201));
});

test('same message ID with another body conflicts without replacing the task or ACK', async () => {
  const { controller, native, acks, wakes } = harness();
  const original = message(), changed = message('/chief 改写原任务的正文');
  const receipt = await controller.registerTrustedMessage(original);
  await assert.rejects(controller.registerTrustedMessage(changed), { code: 'CHIEF_FEISHU_SOURCE_CONFLICT' });
  assert.equal(chiefFeishuOperation(original), chiefFeishuOperation(changed));
  assert.notEqual(original.bodySha256, changed.bodySha256);
  assert.equal(native.tasks().length, 1);
  assert.equal(native.tasks()[0].description, original.goal);
  assert.equal(native.ledger(original).get('registered').taskId, receipt.taskId);
  assert.equal(native.createAttempts, 1);
  assert.equal(acks.length, 1);
  assert.equal(wakes.length, 0);
});

test('active execution allows registration and ACK but keeps the same task queued without a wake claim', async () => {
  const { controller, native, acks, wakes, setActive } = harness();
  const input = message();
  setActive(true);
  const receipt = await controller.registerTrustedMessage(input);
  await controller.drain();
  await controller.drain();
  assert.equal(acks.length, 1);
  assert.equal(wakes.length, 0);
  assert.equal(native.ledger(input).has('wake_claimed'), false);
  setActive(false);
  await controller.drain();
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].taskId, receipt.taskId);
  assert.equal(native.tasks().length, 1);
});

test('dispatch eligibility is rechecked inside the Native claim transaction', async () => {
  let observations = 0;
  const { controller, native, wakes } = harness({ canDispatch: () => ++observations !== 2 });
  const input = message();
  await controller.registerTrustedMessage(input);
  await controller.drain();
  assert.equal(wakes.length, 0);
  assert.equal(native.ledger(input).has('wake_claimed'), false);
  await controller.drain();
  assert.equal(wakes.length, 1);
});

for (const [name, patch] of [
  ['title version', { title: '已变化的标题' }],
  ['body version', { description: '已变化的正文' }],
  ['creator', { createdByUserId: 'other-owner' }],
  ['responsible owner', { responsibleUserId: 'other-owner' }],
  ['company', { companyId: id(9) }],
  ['project', { projectId: id(9) }],
  ['Chief assignment', { assigneeAgentId: id(9) }],
  ['parent', { parentId: id(9) }],
  ['status', { status: 'in_progress' }],
]) {
  test('marks changed task ' + name + ' stale and lets the next valid task launch', async () => {
    const { controller, native, wakes } = harness();
    const input = message();
    const registered = await controller.registerTrustedMessage(input);
    const freshInput = message('/chief 后续合法目标', 'om_next');
    const fresh = await controller.registerTrustedMessage(freshInput);
    native.mutateTask(registered.taskId, patch);
    await controller.drain();
    await controller.drain();
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].taskId, fresh.taskId);
    assert.equal(native.ledger(input).has('wake_claimed'), false);
    assert.equal(native.ledger(input).get('stale').code, 'CHIEF_FEISHU_TASK_CHANGED');
    assert.equal(native.ledger(freshInput).has('wake_sent'), true);
    assert.equal(native.tasks().length, 2);
  });
}

test('a wake side effect followed by a lost response is retained as unknown and never launched again', async () => {
  const actualRuns = [];
  const { controller, native, logs } = harness({ wake: async receipt => {
    actualRuns.push({ taskId: receipt.taskId, runId: id(300) });
    throw Error('remote wake succeeded, response lost');
  } });
  const input = message();
  await controller.registerTrustedMessage(input);
  await controller.drain();
  await controller.drain();
  await controller.registerTrustedMessage(input);
  await controller.drain();
  assert.equal(actualRuns.length, 1);
  assert.equal(native.ledger(input).has('wake_claimed'), true);
  assert.equal(native.ledger(input).has('wake_sent'), false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].code, 'CHIEF_FEISHU_WAKE_UNKNOWN');
});

test('an ACK side effect with an unknown result is claimed once and never resent', async () => {
  const sent = [];
  const { controller, native, logs } = harness({ acknowledge: async receipt => {
    sent.push(receipt.taskId);
    throw Error('message accepted, delivery response lost');
  } });
  const input = message();
  const first = await controller.registerTrustedMessage(input);
  const repeat = await controller.registerTrustedMessage(input);
  assert.equal(first.taskId, repeat.taskId);
  assert.equal(sent.length, 1);
  assert.equal(native.ledger(input).has('ack_claimed'), true);
  assert.equal(native.ledger(input).has('ack_sent'), false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].code, 'CHIEF_FEISHU_ACK_UNKNOWN');
});

test('lost wake_sent commit response keeps the prior claim and cannot repeat wake', async () => {
  const { controller, native, wakes, logs } = harness();
  const input = message();
  await controller.registerTrustedMessage(input);
  native.loseCommitReply('wake_sent');
  await controller.drain();
  await controller.drain();
  await controller.registerTrustedMessage(input);
  await controller.drain();
  assert.equal(wakes.length, 1);
  assert.equal(native.ledger(input).has('wake_claimed'), true);
  assert.equal(native.ledger(input).get('wake_sent').runId, id(201));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].code, 'CHIEF_FEISHU_WAKE_UNKNOWN');
});

test('lost ack_sent commit response preserves one original message and does not resend', async () => {
  const { controller, native, acks, logs } = harness();
  const input = message();
  native.loseCommitReply('ack_sent');
  await controller.registerTrustedMessage(input);
  await controller.registerTrustedMessage(input);
  assert.equal(acks.length, 1);
  assert.equal(native.ledger(input).get('ack_sent').messageId, 'om_ack1');
  assert.equal(logs[0].code, 'CHIEF_FEISHU_ACK_UNKNOWN');
});

test('a lost registration commit response resumes that Native task rather than creating another', async () => {
  const { controller, native, acks } = harness();
  const input = message();
  native.loseCommitReply('registered');
  await assert.rejects(controller.registerTrustedMessage(input), { code: 'TEST_COMMIT_REPLY_LOST' });
  const committedTaskId = native.tasks()[0].id;
  assert.equal(acks.length, 0);
  const recovered = await controller.registerTrustedMessage(input);
  assert.equal(recovered.taskId, committedTaskId);
  assert.equal(recovered.reused, true);
  assert.equal(native.tasks().length, 1);
  assert.equal(native.createAttempts, 1);
  assert.equal(acks.length, 1);
});

test('separate queued messages launch at most one task per drain and honor renewed active observation', async () => {
  let active = false;
  const launched = [];
  const { controller, native } = harness({
    canDispatch: () => !active,
    wake: async receipt => { active = true; launched.push(receipt.taskId); return { id: id(400 + launched.length) }; },
  });
  const firstInput = message('/chief 第一个目标', 'om_first');
  const secondInput = message('/chief 第二个目标', 'om_second');
  const first = await controller.registerTrustedMessage(firstInput);
  const second = await controller.registerTrustedMessage(secondInput);
  await controller.drain();
  assert.deepEqual(launched, [first.taskId]);
  await controller.drain();
  assert.deepEqual(launched, [first.taskId]);
  assert.equal(native.ledger(secondInput).has('wake_claimed'), false);
  active = false;
  await controller.drain();
  assert.deepEqual(launched, [first.taskId, second.taskId]);
  assert.equal(native.tasks().length, 2);
});
