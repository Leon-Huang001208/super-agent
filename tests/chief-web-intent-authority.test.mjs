import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { createChiefWebIntentAuthority } from '../bridge/chief-web-intent-authority.mjs';

const id = index => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
const taskId = CHIEF_WEB_PILOT.taskId;
const operationId = 'a'.repeat(64);
const grantId = id(1);
const messageId = id(2);
const intent = {
  taskId, operationId, grantId, messageId, expiresAt: 100, kind: 'chief-web-intent',
  status: 'reserved', action: 'supplement', payloadHash: 'b'.repeat(64),
  receipt: { status: 'reserved', operationId },
  sourceEvidence: { messageId, messageDigest: 'c'.repeat(64), runId: id(3), wakeId: id(4), providerClaimId: id(5) },
  expected: { inputRevision: CHIEF_WEB_PILOT.previousInputRevision, prHead: CHIEF_WEB_PILOT.previousHead },
};

function fixture() {
  const records = [structuredClone(intent)];
  let tail = Promise.resolve();
  let allowed = true;
  let now = 10;
  const repository = {
    transaction(callback) {
      const result = tail.then(() => callback({
        lockTask: id => ({ id }),
        listTaskOperations: () => structuredClone(records),
        appendOperation: record => records.push(structuredClone(record)),
      }));
      tail = result.catch(() => {});
      return result;
    },
  };
  const createAuthority = () => createChiefWebIntentAuthority({
    repository, readGrant: () => ({ grantId, expiresAt: 100 }),
    verifyExecution: () => allowed, now: () => now,
  });
  return { records, createAuthority, deny: () => { allowed = false; }, expire: () => { now = 100; } };
}

test('serializes claim once and records only a validated replayable completion', async () => {
  const { records, createAuthority, expire } = fixture();
  const first = createAuthority();
  const [left, right] = await Promise.all([first.claim(operationId), first.claim(operationId)]);
  assert.deepEqual([left.status, right.status], ['claimed_now', 'claimed']);
  expire();
  const restored = createAuthority();
  assert.equal((await restored.claim(operationId)).status, 'claimed');
  const result = {
    taskId, grantId, operationId, status: 'completed', previousInputRevision: intent.expected.inputRevision,
    inputRevision: 'd'.repeat(64), messageDigest: intent.sourceEvidence.messageDigest, private: 'drop this field',
  };
  await assert.rejects(restored.complete({ operationId, result: { ...result, messageDigest: 'e'.repeat(64) } }), {
    code: 'CHIEF_WEB_EFFECT_COMPLETION_DENIED',
  });
  await restored.complete({ operationId, result });
  await restored.complete({ operationId, result });
  assert.equal(records.length, 3);
  assert.equal((await restored.claim(operationId)).status, 'completed');
  assert.equal(records.at(-1).result.private, undefined);
});

test('refuses a new claim when paused, denied by existing execution admission or expired', async () => {
  const paused = fixture();
  const controlId = 'e'.repeat(64);
  paused.records.push({
    ...intent, action: 'pause', operationId: controlId, receipt: { status: 'reserved', operationId: controlId },
  });
  assert.equal((await paused.createAuthority().claim(operationId)).status, 'blocked');
  const denied = fixture();
  denied.deny();
  assert.equal((await denied.createAuthority().claim(operationId)).status, 'blocked');
  const expired = fixture();
  expired.expire();
  assert.equal((await expired.createAuthority().claim(operationId)).status, 'blocked');
  assert.equal(expired.records.length, 1);
});
