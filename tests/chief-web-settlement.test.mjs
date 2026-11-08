import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChiefWebSettlement } from '../bridge/chief-web-settlement.mjs';

test('uses the original message identity when a settled Native turn is replayed', async () => {
  const commands = [];
  const logs = [];
  const actor = { userId: 'owner' };
  const settle = createChiefWebSettlement({
    pilot: {
      handle(actualActor, command) {
        assert.equal(actualActor, actor);
        commands.push(command);
        return command.action === 'status' ? { contextRevision: String(commands.length) } : { operationId: 'operation' };
      },
    },
    resolveTurn: ({ db, run }) => db === 'native' && run.id === 'run' ? { actor, messageId: 'message' } : null,
    log: entry => logs.push(entry),
  });
  const run = { id: 'run', status: 'succeeded', contextSnapshot: { conversationMode: true } };
  await settle({ db: 'native', run: { ...run, status: 'running' } });
  await settle({ db: 'native', run: { ...run, id: 'other' } });
  assert.equal(commands.length, 0);
  await settle({ db: 'native', run });
  await settle({ db: 'native', run });
  assert.equal(commands[1].requestId, 'message');
  assert.equal(commands[3].requestId, commands[1].requestId);
  assert.notEqual(commands[3].contextRevision, commands[1].contextRevision);
  assert.deepEqual(logs, [
    { code: 'CHIEF_WEB_SETTLEMENT_RECORDED', operationId: 'operation' },
    { code: 'CHIEF_WEB_SETTLEMENT_RECORDED', operationId: 'operation' },
  ]);
});
