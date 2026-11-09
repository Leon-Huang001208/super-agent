import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT, projectChiefWebStatus } from '../bridge/chief-web-pilot.mjs';
import { createChiefWebProjection } from '../bridge/chief-web-projection.mjs';

const id = index => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { taskId, path: targetDoc, previousHead, previousInputRevision } = CHIEF_WEB_PILOT;

function fixture() {
  const fullTaskInput = { targetDoc, taskId };
  const inputRevision = hash(fullTaskInput);
  const grantId = id(1);
  const operationId = 'a'.repeat(64);
  const messageId = id(2);
  const payloadHash = 'b'.repeat(64);
  const candidate = 'c'.repeat(40);
  const related = { taskId, grantId, payloadHash, parentOperationId: operationId };
  const records = [
    { taskId, kind: 'input-state', fullTaskInput },
    {
      taskId, kind: 'execution-context', status: 'completed',
      executionContext: {
        phase: 'WAIT_DECISION',
        expectedWait: { inputRevision, candidateSha: candidate },
        candidate: { head: candidate },
        pr: { url: 'https://github.com/Leon-Huang001208/ResearchWorkbench/pull/261' },
      },
    },
    {
      taskId, operationId, grantId, payloadHash, kind: 'chief-web-intent', status: 'reserved',
      receipt: { operationId, status: 'reserved' }, action: 'supplement', messageId,
      sourceEvidence: { messageId, messageDigest: 'd'.repeat(64), runId: id(3), wakeId: id(4), providerClaimId: id(5) },
      expected: { prHead: previousHead, inputRevision: previousInputRevision },
    },
    {
      ...related, kind: 'chief-web-effect-claim', status: 'claimed',
      operationId: hash([operationId, 'chief-web-effect-claim']),
    },
    {
      ...related, kind: 'chief-web-effect-completion', status: 'completed',
      operationId: hash([operationId, 'chief-web-effect-completion']),
      result: { operationId, taskId, grantId, status: 'completed', previousInputRevision, inputRevision, messageDigest: 'd'.repeat(64) },
    },
  ];
  const evidence = {
    prHead: previousHead, evidenceDigest: 'e'.repeat(64), inputRevision, candidate,
    independentReview: { candidate, verdict: 'approved' }, localChecks: { candidate, passed: true },
  };
  const read = createChiefWebProjection({ readExecutionEvidence: () => evidence });
  return { read, records, evidence, inputRevision, args: { task: { id: taskId, status: 'in_progress', statusVersion: 1 }, records, binding: { grantId } } };
}

test('uses the same Native input digest and derives the new grant lineage from the completed effect', async () => {
  const { read, args, evidence, inputRevision } = fixture();
  const first = await read(args);
  assert.equal(first.inputRevision, inputRevision);
  assert.equal(first.supplementGrantId, args.binding.grantId);
  assert.equal(first.phase, 'awaiting_confirmation');
  assert.equal(first.independentReview.verdict, 'approved');
  evidence.inputRevision = previousInputRevision;
  assert.equal((await read(args)).independentReview, undefined);
});

test('an exact publication blocker suppresses the confirmation action', async () => {
  const { read, args, evidence } = fixture();
  evidence.publicationBlocker = { code: 'CHIEF_WEB_MASTER_ADVANCED', operationId: id(9) };
  const state = await read(args);
  const binding = { ...args.binding, expiresAt: 1000, previousInputRevision, previousHead };
  const status = projectChiefWebStatus({ ...state, control: 'active' }, binding, 1);
  assert.equal(status.phase, 'blocked');
  assert.equal(status.code, 'CHIEF_WEB_MASTER_ADVANCED');
  assert.deepEqual(status.actions, []);
});

test('refuses an unrelated continuation or conflicting claimed effect', async () => {
  const { read, records, args } = fixture();
  const completion = records.pop();
  assert.equal((await read(args)).phase, 'blocked');
  completion.operationId = 'f'.repeat(64);
  records.push(completion);
  await assert.rejects(read(args), { code: 'CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS' });
});

test('gives authoritative Native cancellation and stale waits precedence over confirmation', async () => {
  const { read, records, args } = fixture();
  for (const status of ['blocked', 'cancelled']) {
    assert.equal((await read({ ...args, task: { ...args.task, status } })).phase, 'blocked');
  }
  const wait = records[1].executionContext.expectedWait;
  const currentRevision = wait.inputRevision;
  wait.inputRevision = previousInputRevision;
  assert.equal((await read(args)).phase, 'blocked');
  wait.inputRevision = currentRevision;
  wait.candidateSha = previousHead;
  assert.equal((await read(args)).phase, 'blocked');
});
