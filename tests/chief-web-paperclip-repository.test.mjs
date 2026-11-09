import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { bindChiefWebPaperclipRepository } from '../bridge/chief-web-paperclip-repository.mjs';

function fixture() {
  const task = { id: CHIEF_WEB_PILOT.taskId, originKind: 'task_bridge', responsibleUserId: 'owner', companyId: 'company' };
  const conversation = { id: 'chat', companyId: task.companyId, conversationAgentId: 'chief', conversationUserId: 'owner', conversationSessionGeneration: 1, conversationBoundaryCommentId: 'reset' };
  const grant = { taskId: task.id, ownerId: 'owner', companyId: task.companyId, conversationId: conversation.id, generation: 1 };
  const schema = Object.fromEntries(['activityLog', 'issueComments', 'heartbeatRuns', 'agentWakeupRequests'].map(key => [key, { table: key }]));
  const rows = {
    activityLog: [{ details: { sequence: 4, kind: 'input-state' } }],
    issueComments: [{ id: 'message' }],
    heartbeatRuns: [{ id: 'run', wakeupRequestId: 'wake' }],
    agentWakeupRequests: [{ id: 'wake' }],
  };
  const locks = [];
  const inserted = [];
  const tx = {
    select() {
      return { from: table => ({ where: () => ({ orderBy: () => rows[table.table], limit: max => rows[table.table].slice(0, max) }) }) };
    },
    insert(table) {
      assert.equal(table, schema.activityLog);
      return { values: value => inserted.push(value) };
    },
  };
  const db = { transaction: run => run(tx) };
  const bindings = bindChiefWebPaperclipRepository({
    db,
    issueService(actualDb) {
      assert.equal(actualDb, db);
      return { getByIdForUpdate(id, connection) {
        assert.equal(connection, tx);
        locks.push(id);
        return id === task.id ? task : id === conversation.id ? conversation : null;
      } };
    },
    schema,
    orm: { eq() {}, and() {}, asc() {}, sql() {} },
    chiefAgentId: conversation.conversationAgentId,
    readApprovedGrant: () => grant,
    readProjection() {},
    readChiefCallReceipt() {},
  });
  return { bindings, locks, task, conversation, rows, inserted };
}

test('locks the fixed task and its exact Chief conversation and appends only pilot intent activity', async () => {
  const { bindings, locks, task, conversation, inserted } = fixture();
  await bindings.repository.transaction(async transaction => {
    const lockedTask = await transaction.lockTask(task.id);
    const grant = await bindings.readGrant({ task: lockedTask, transaction });
    assert.deepEqual(locks, [task.id, conversation.id]);
    assert.deepEqual(await bindings.readNativeEvidence({
      transaction, binding: grant, messageId: 'message', chiefAgentId: 'chief',
    }), { message: { id: 'message' }, run: { id: 'run', wakeupRequestId: 'wake' }, wake: { id: 'wake' }, boundaryChecked: true });
    await transaction.appendOperation({ taskId: task.id, kind: 'chief-web-intent', status: 'reserved' });
  });
  assert.equal(inserted[0].action, 'super_agent.integration_native');
  assert.equal(inserted[0].details.sequence, 5);
  assert.equal(inserted[0].entityId, task.id);
});

test('fences a conversation reset and refuses an ambiguous completed turn', async () => {
  const { bindings, task, conversation, rows, inserted } = fixture();
  conversation.conversationSessionGeneration = 2;
  await bindings.repository.transaction(async transaction => {
    await transaction.lockTask(task.id);
    assert.equal(await bindings.readGrant({ task, transaction }), null);
    await assert.rejects(transaction.appendOperation({ taskId: task.id, kind: 'chief-web-intent', status: 'reserved' }), {
      code: 'CHIEF_WEB_PAPERCLIP_WRITE_DENIED',
    });
  });
  assert.equal(inserted.length, 0);
  conversation.conversationSessionGeneration = 1;
  rows.heartbeatRuns.push({ id: 'other-run' });
  await bindings.repository.transaction(async transaction => {
    await transaction.lockTask(task.id);
    const grant = await bindings.readGrant({ task, transaction });
    assert.equal(await bindings.readNativeEvidence({
      transaction, binding: grant, messageId: 'message', chiefAgentId: 'chief',
    }), null);
  });
});

test('allocates distinct activity sequences for the recovery proof and effect claim in one transaction', async () => {
  const { bindings, task, inserted } = fixture();
  await bindings.repository.transaction(async transaction => {
    await transaction.lockTask(task.id);
    await bindings.readGrant({ task, transaction });
    await transaction.appendOperation({ taskId: task.id, kind: 'chief-web-recovery-claim', status: 'claimed' });
    await transaction.appendOperation({ taskId: task.id, kind: 'chief-web-effect-claim', status: 'claimed' });
    assert.deepEqual((await transaction.listTaskOperations(task.id)).map(row => row.sequence), [4, 5, 6]);
  });
  assert.deepEqual(inserted.map(row => row.details.sequence), [5, 6]);
});

test('resolves only the current locked conversation and Native direct wake source', async () => {
  const { bindings, conversation } = fixture();
  const contextSnapshot = {
    issueId: conversation.id, wakeCommentId: 'message',
    conversationSessionGeneration: 1, source: 'issue.comment',
  };
  const run = { agentId: conversation.conversationAgentId, companyId: conversation.companyId, contextSnapshot };
  assert.equal((await bindings.resolveTurn({ run })).messageId, 'message');
  contextSnapshot.source = 'manual';
  assert.equal(await bindings.resolveTurn({ run }), null);
  contextSnapshot.source = 'issue.comment';
  conversation.conversationSessionGeneration = 2;
  assert.equal(await bindings.resolveTurn({ run }), null);
});
