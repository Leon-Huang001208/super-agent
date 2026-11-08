import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT, createChiefWebPilot } from '../bridge/chief-web-pilot.mjs';

const id = index => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
const oldRevision = 'a'.repeat(64);
const candidate = 'b'.repeat(40);
const reviewDigest = 'c'.repeat(64);

function fixture() {
  const actor = { userId: id(1), companyId: id(2), conversationId: id(3), generation: 0 };
  const binding = {
    ownerId: actor.userId,
    companyId: actor.companyId,
    conversationId: actor.conversationId,
    generation: actor.generation,
    taskId: CHIEF_WEB_PILOT.taskId,
    grantId: id(4),
    expiresAt: 1000,
    previousInputRevision: CHIEF_WEB_PILOT.previousInputRevision,
    previousHead: CHIEF_WEB_PILOT.previousHead,
  };
  const state = {
    inputRevision: CHIEF_WEB_PILOT.previousInputRevision,
    prHead: CHIEF_WEB_PILOT.previousHead,
    contextRevision: oldRevision,
    observedCalls: 8,
    supplementReserved: false,
    confirmationReserved: false,
    phase: 'done',
    control: 'active',
  };
  const operations = new Map();
  const logs = [];
  let tail = Promise.resolve();
  let fault;
  let now = 100;
  let onOwnerMessage;
  const tx = {
    readBinding: () => binding,
    readState: () => state,
    readStatus: () => ({ phase: state.phase }),
    isOwnerSupplement(_binding, messageId) {
      onOwnerMessage?.();
      return messageId === id(5);
    },
    readOperation: operationId => operations.get(operationId),
    reserveOperation(operation) {
      const receipt = { operationId: operation.operationId, status: 'reserved' };
      operations.set(operation.operationId, { ...operation, receipt });
      if (operation.action === 'supplement') state.supplementReserved = true;
      if (operation.action === 'confirm') state.confirmationReserved = true;
      if (operation.action === 'pause') state.control = 'paused';
      if (operation.action === 'resume') state.control = 'active';
      return receipt;
    },
  };
  const createPilot = () => createChiefWebPilot({
    now: () => now,
    log: entry => logs.push(entry),
    withTaskTransaction(taskId, callback) {
      assert.equal(taskId, CHIEF_WEB_PILOT.taskId);
      const next = tail.then(() => callback(tx));
      tail = next.catch(() => {});
      return next.then(receipt => {
        if (fault) {
          const message = fault;
          fault = undefined;
          throw new Error(message);
        }
        return receipt;
      });
    },
  });
  const supplement = {
    action: 'supplement', contextRevision: oldRevision, requestId: id(6), messageId: id(5),
  };
  const confirm = {
    action: 'confirm', contextRevision: oldRevision, requestId: id(7), candidate, reviewDigest,
  };
  return {
    pilot: createPilot(), createPilot, actor, binding, state, operations, logs, supplement, confirm,
    setFault: value => { fault = value; },
    expireDuringMessageRead: () => { onOwnerMessage = () => { now = binding.expiresAt; }; },
  };
}

test('verifies the authenticated owner and exact conversation generation even for status', async () => {
  const { pilot, actor } = fixture();
  assert.deepEqual(await pilot.handle(actor, { action: 'status' }), { phase: 'done' });
  for (const mismatch of [{ userId: id(9) }, { companyId: id(9) }, { generation: 1 }, { conversationId: id(9) }]) {
    await assert.rejects(pilot.handle({ ...actor, ...mismatch }, { action: 'status' }), { code: 'CHIEF_WEB_AUDIENCE_DENIED' });
  }
});

test('uses the owner message to deduplicate concurrent supplement delivery', async () => {
  const { pilot, actor, state, supplement, operations } = fixture();
  const replay = { ...supplement, requestId: id(10) };
  const [first, duplicate] = await Promise.all([pilot.handle(actor, supplement), pilot.handle(actor, replay)]);
  assert.deepEqual(first, duplicate);
  assert.equal(operations.size, 1);
  const [operation] = operations.values();
  assert.equal(operation.policy.path, 'docs/super-agent/unified-integration.md');
  assert.equal(operation.policy.developerCalls, 1);
  assert.equal(operation.policy.reviewerCalls, 1);
  state.contextRevision = 'f'.repeat(64);
  assert.deepEqual(await pilot.handle(actor, replay), first);
  await assert.rejects(pilot.handle(actor, { ...replay, contextRevision: state.contextRevision }), {
    code: 'CHIEF_WEB_OPERATION_CONFLICT',
  });
});

test('rejects unverified messages, foreign scope, stale context and wrong historical budget', async () => {
  const { pilot, actor, state, supplement, operations } = fixture();
  await assert.rejects(pilot.handle(actor, { ...supplement, messageId: id(9) }), { code: 'CHIEF_WEB_MESSAGE_DENIED' });
  await assert.rejects(pilot.handle(actor, { ...supplement, requestId: [id(6)] }), { code: 'CHIEF_WEB_ACTION_INVALID' });
  await assert.rejects(pilot.handle(actor, { ...supplement, path: 'AGENTS.md' }), { code: 'CHIEF_WEB_ACTION_INVALID' });
  await assert.rejects(pilot.handle(actor, { ...supplement, contextRevision: 'd'.repeat(64) }), { code: 'CHIEF_WEB_CONTEXT_CHANGED' });
  state.observedCalls = 9;
  await assert.rejects(pilot.handle(actor, supplement), { code: 'CHIEF_WEB_SUPPLEMENT_UNAVAILABLE' });
  assert.equal(operations.size, 0);
});

test('rechecks the grant if verifying the owner message crosses its expiry', async () => {
  const { pilot, actor, supplement, operations, expireDuringMessageRead } = fixture();
  expireDuringMessageRead();
  await assert.rejects(pilot.handle(actor, supplement), { code: 'CHIEF_WEB_GRANT_UNAVAILABLE' });
  assert.equal(operations.size, 0);
});

test('keeps status and accepted operation replay readable after permission expires', async () => {
  const { pilot, actor, binding, supplement } = fixture();
  const first = await pilot.handle(actor, supplement);
  binding.expiresAt = 100;
  assert.deepEqual(await pilot.handle(actor, supplement), first);
  assert.deepEqual(await pilot.handle(actor, { action: 'status' }), { phase: 'done' });
  await assert.rejects(pilot.handle(actor, { action: 'pause', contextRevision: oldRevision, requestId: id(11) }), {
    code: 'CHIEF_WEB_GRANT_UNAVAILABLE',
  });
});

test('pause fences a later confirmation and resume requires reconciled state', async () => {
  const { pilot, actor, state, binding, confirm } = fixture();
  Object.assign(state, {
    phase: 'awaiting_confirmation',
    inputRevision: 'e'.repeat(64),
    supplementGrantId: binding.grantId,
    candidate,
    independentReview: { candidate, digest: reviewDigest, verdict: 'approved' },
    localChecks: { candidate, passed: true },
  });
  const pause = { action: 'pause', contextRevision: oldRevision, requestId: id(11) };
  const resume = { action: 'resume', contextRevision: oldRevision, requestId: id(12) };
  state.supplementGrantId = id(9);
  await assert.rejects(pilot.handle(actor, confirm), { code: 'CHIEF_WEB_CONTINUATION_UNBOUND' });
  state.supplementGrantId = binding.grantId;
  const [paused, approved] = await Promise.allSettled([pilot.handle(actor, pause), pilot.handle(actor, confirm)]);
  assert.equal(paused.status, 'fulfilled');
  assert.equal(approved.reason.code, 'CHIEF_WEB_CONFIRMATION_STALE');
  await assert.rejects(pilot.handle(actor, resume), { code: 'CHIEF_WEB_TRANSITION_DENIED' });
  state.reconciled = true;
  await pilot.handle(actor, resume);
  state.prHead = 'f'.repeat(40);
  await assert.rejects(pilot.handle(actor, confirm), { code: 'CHIEF_WEB_CONFIRMATION_STALE' });
  state.prHead = CHIEF_WEB_PILOT.previousHead;
  const approvedReceipt = await pilot.handle(actor, confirm);
  assert.equal(approvedReceipt.status, 'reserved');
  assert.deepEqual(await pilot.handle(actor, { ...confirm, requestId: id(13) }), approvedReceipt);
});

test('recovers a reserved operation after response loss and redacts the thrown cause', async () => {
  const { pilot, createPilot, actor, supplement, operations, logs, setFault } = fixture();
  setFault('private response body');
  await assert.rejects(pilot.handle(actor, supplement), { code: 'CHIEF_WEB_STATE_UNAVAILABLE' });
  assert.equal(operations.size, 1);
  assert.equal((await createPilot().handle(actor, supplement)).status, 'reserved');
  assert.equal(operations.size, 1);
  assert.doesNotMatch(JSON.stringify(logs), /private response body/);
});
