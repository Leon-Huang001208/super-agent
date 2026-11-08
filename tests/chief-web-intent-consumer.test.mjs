import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { createChiefWebIntentConsumer } from '../bridge/chief-web-intent-consumer.mjs';

const operationId = 'a'.repeat(64);
const intent = {
  operationId, taskId: CHIEF_WEB_PILOT.taskId, kind: 'chief-web-intent', grantId: 'grant',
  action: 'supplement', messageId: 'message',
  sourceEvidence: { messageId: 'message', messageDigest: 'b'.repeat(64) },
  expected: { inputRevision: CHIEF_WEB_PILOT.previousInputRevision, prHead: CHIEF_WEB_PILOT.previousHead },
};

test('reconciles a lost append receipt without repeating the already claimed effect', async () => {
  const nativeReceipt = {
    status: 'completed', operationId, taskId: intent.taskId, grantId: intent.grantId,
    previousInputRevision: intent.expected.inputRevision, inputRevision: 'c'.repeat(64),
    messageDigest: intent.sourceEvidence.messageDigest,
  };
  let claims = 0;
  let calls = 0;
  let complete = false;
  const consumer = createChiefWebIntentConsumer({
    authority: {
      claim: () => ({ status: ++claims === 1 ? 'claimed_now' : 'claimed', intent }),
      complete({ result }) {
        assert.deepEqual(result, nativeReceipt);
        complete = true;
      },
    },
    native: {
      append(scope) {
        calls++;
        assert.equal(scope.path, CHIEF_WEB_PILOT.path);
        assert.equal(scope.sourceEvidence.messageDigest, nativeReceipt.messageDigest);
        throw new Error('lost response');
      },
      observe: () => nativeReceipt,
    },
    publication: { update() { assert.fail(); }, observe() { assert.fail(); } },
    log() {},
  });
  assert.equal((await consumer.consume(operationId)).status, 'unknown');
  assert.equal((await consumer.consume(operationId)).status, 'completed');
  assert.equal(calls, 1);
  assert.equal(complete, true);
});

test('will not complete a published receipt for a different candidate or repository', async () => {
  const candidate = 'd'.repeat(40);
  const updatedIntent = {
    ...intent, action: 'confirm',
    expected: { ...intent.expected, inputRevision: 'c'.repeat(64), candidate, reviewDigest: 'e'.repeat(64) },
  };
  let updateCalls = 0;
  const consumer = createChiefWebIntentConsumer({
    authority: {
      claim: () => ({ status: 'claimed_now', intent: updatedIntent }),
      complete() { assert.fail(); },
    },
    native: { append() { assert.fail(); }, observe() { assert.fail(); } },
    publication: {
      update(scope) {
        updateCalls++;
        assert.equal(scope.pullRequest, 261);
        assert.equal(scope.candidate, candidate);
        return { ...scope, status: 'completed', headSha: 'f'.repeat(40) };
      },
      observe() { assert.fail(); },
    },
    log() {},
  });
  assert.equal((await consumer.consume(operationId)).status, 'unknown');
  assert.equal(updateCalls, 1);
});
