import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClosedClaimHistory, selectRetainedClaimIdentifiers } from '../bridge/project-adapters/rwb/closed-claim-history.mjs';

const id = n => '11111111-1111-4111-8111-11111111111' + n;
const taskId = id(1);
const review = {
  taskId, schemaVersion: 2, role: 'review', scopeRevision: 10, status: 'claimed', retryAllowed: false,
  ownerRevisionAllowanceSha256: 'a'.repeat(64), scopeId: id(2), attemptId: id(3), permitId: id(4), nativeRunId: id(5),
};

test('retained historical candidates carry only the exact identifiers required by the audit', () => {
  assert.deepEqual(selectRetainedClaimIdentifiers([review], taskId), [{
    taskId, role: 'review', revision: 10, scopeId: id(2), attemptId: id(3), permitId: id(4), runId: id(5),
  }]);
  for (const claims of [[review, review], [{ ...review, taskId: id(6) }], [{ ...review, scopeRevision: 9 }]]) {
    assert.throws(() => selectRetainedClaimIdentifiers(claims, taskId), { code: 'CCA_HISTORY_INPUT_INVALID' });
  }
});

test('the historical overlay rejects source drift before preparing an artifact', () => {
  assert.throws(() => renderClosedClaimHistory('different baseline', [review], taskId), { code: 'CCA_HISTORY_BASE_MISMATCH' });
});
