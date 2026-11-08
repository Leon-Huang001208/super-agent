import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT, createChiefWebPilot } from '../bridge/chief-web-pilot.mjs';
import { createChiefWebNativeStore } from '../bridge/chief-web-native-store.mjs';

const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const { taskId, previousHead, previousInputRevision } = CHIEF_WEB_PILOT;

function fixture() {
  const actor = { userId: id(1), companyId: id(2), conversationId: id(3), generation: 0 };
  const task = { id: taskId, companyId: actor.companyId, responsibleUserId: actor.userId };
  const grant = {
    taskId, previousHead, previousInputRevision, ownerId: actor.userId, companyId: actor.companyId,
    conversationId: actor.conversationId, generation: 0, grantId: id(4), expiresAt: 100,
  };
  const state = {
    inputRevision: previousInputRevision,
    contextRevision: 'a'.repeat(64),
    prHead: previousHead,
    observedCalls: 8,
    phase: 'done',
  };
  const activity = [];
  let committed = Promise.resolve();
  let writeFails = false;
  const repository = {
    transaction(run) {
      const result = committed.then(async () => {
        const pending = [];
        let lock;
        const value = await run({
          lockTask(id) {
            lock = id;
            return task;
          },
          listTaskOperations(id) {
            assert.equal(lock, id);
            return structuredClone(activity);
          },
          appendOperation(row) {
            assert.equal(lock, row.taskId);
            pending.push(structuredClone(row));
            if (writeFails) throw new Error('database unavailable');
          },
        });
        activity.push(...pending);
        return value;
      });
      committed = result.catch(() => {});
      return result;
    },
  };
  const createPilot = () => createChiefWebPilot({
    ...createChiefWebNativeStore({
      repository, readGrant: () => grant, readProjection: () => state,
      verifyOwnerSupplement: ({ messageId }) => messageId === id(5),
      now: () => 1,
    }),
    log() {},
    now: () => 1,
  });
  return {
    createPilot, actor, grant, state, activity, task,
    failWrite: () => { writeFails = true; },
  };
}

test('writes one task-bound Native activity and replays it from a recreated adapter', async () => {
  const { createPilot, actor, grant, activity } = fixture();
  const pilot = createPilot();
  const before = await pilot.handle(actor, { action: 'status' });
  const command = { action: 'supplement', contextRevision: before.contextRevision, requestId: id(6), messageId: id(5) };
  const receipt = await pilot.handle(actor, command);
  const resumed = createPilot();
  assert.deepEqual(await resumed.handle(actor, command), receipt);
  assert.notEqual((await resumed.handle(actor, { action: 'status' })).contextRevision, before.contextRevision);
  assert.equal(activity.length, 1);
  assert.equal(activity[0].kind, 'chief-web-intent');
  assert.equal(activity[0].taskId, taskId);
  grant.grantId = id(10);
  const afterRotation = await resumed.handle(actor, { action: 'status' });
  await assert.rejects(resumed.handle(actor, { ...command, contextRevision: afterRotation.contextRevision }), {
    code: 'CHIEF_WEB_SUPPLEMENT_UNAVAILABLE',
  });
});

test('reads a persisted pause fence and rejects commands bound to the previous revision', async () => {
  const { createPilot, actor, grant, state, activity } = fixture();
  const pilot = createPilot();
  Object.assign(state, {
    inputRevision: 'b'.repeat(64), supplementGrantId: grant.grantId, phase: 'awaiting_confirmation', reconciled: true,
  });
  const before = await pilot.handle(actor, { action: 'status' });
  await pilot.handle(actor, { action: 'pause', contextRevision: before.contextRevision, requestId: id(7) });
  const restored = createPilot();
  const paused = await restored.handle(actor, { action: 'status' });
  assert.equal(paused.control, 'paused');
  const originalGrantId = grant.grantId;
  grant.grantId = id(12);
  assert.equal((await restored.handle(actor, { action: 'status' })).control, 'paused');
  grant.grantId = originalGrantId;
  activity[0].grantId = undefined;
  await assert.rejects(restored.handle(actor, { action: 'status' }), { code: 'CHIEF_WEB_OPERATION_UNKNOWN' });
  activity[0].grantId = originalGrantId;
  const resume = { action: 'resume', contextRevision: before.contextRevision, requestId: id(8) };
  await assert.rejects(restored.handle(actor, resume), { code: 'CHIEF_WEB_CONTEXT_CHANGED' });
  await restored.handle(actor, { ...resume, contextRevision: paused.contextRevision });
  assert.equal((await restored.handle(actor, { action: 'status' })).control, 'active');
});

test('denies foreign Native owner and rolls back a failed activity write', async () => {
  const { createPilot, actor, task, activity, failWrite } = fixture();
  const pilot = createPilot();
  task.responsibleUserId = id(9);
  await assert.rejects(pilot.handle(actor, { action: 'status' }), { code: 'CHIEF_WEB_AUDIENCE_DENIED' });
  task.responsibleUserId = actor.userId;
  const before = await pilot.handle(actor, { action: 'status' });
  failWrite();
  await assert.rejects(pilot.handle(actor, {
    action: 'supplement', contextRevision: before.contextRevision, requestId: id(6), messageId: id(5),
  }), { code: 'CHIEF_WEB_STATE_UNAVAILABLE' });
  assert.equal(activity.length, 0);
});
