import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { reconcileChiefWebHostFences } from '../bridge/chief-web-runtime-bootstrap.mjs';

test('reconciles an orphan pause and a committed resume without discarding markers', async () => {
  const taskId = CHIEF_WEB_PILOT.taskId, grantId = randomUUID(), orphan = 'a'.repeat(64), actual = 'b'.repeat(64);
  const grant = { taskId, grantId };
  const common = pauseOperationId => ({ schemaVersion: 1, taskId, grantId, pauseOperationId });
  const files = new Map([
    ['pause-' + orphan + '.json', common(orphan)],
    ['pause-' + actual + '.json', common(actual)],
  ]);
  const resumeOperationId = 'c'.repeat(64);
  const records = [
    { kind: 'chief-web-intent', action: 'pause', operationId: actual, grantId, status: 'reserved' },
    { kind: 'chief-web-intent', action: 'resume', operationId: resumeOperationId, grantId, status: 'reserved',
      releasedPauseOperationId: actual, releasedPauseGrantId: grantId },
  ];
  const io = {
    list: () => [...files.keys()],
    read: (_grant, name) => files.get(name),
    write(_grant, name, value) {
      if (files.has(name)) assert.deepEqual(files.get(name), value);
      else files.set(name, value);
    },
  };
  await reconcileChiefWebHostFences(records, grant, io);
  await reconcileChiefWebHostFences(records, grant, io);
  assert.equal(files.get('resolved-' + orphan + '.json').reason, 'native_pause_not_committed');
  assert.equal(files.get('resume-' + actual + '.json').resumeOperationId, resumeOperationId);
  assert.equal(files.size, 4);
});
