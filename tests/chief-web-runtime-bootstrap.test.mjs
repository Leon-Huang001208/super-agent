import assert from 'node:assert/strict';
import test from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { readExecutionEvidence } from '../bridge/chief-web-runtime-bootstrap.mjs';

const { taskId, previousInputRevision: inputRevision, previousHead: headSha } = CHIEF_WEB_PILOT;
const input = { task: { id: taskId, status: 'done' }, context: { pr: { headSha } }, inputRevision };
const receipt = { taskId, inputRevision, nativeStatus: 'done', pr: { headSha }, providerSlots: 8 };
const read = value => async filename => {
  assert.equal(filename, '/paperclip/control/chief-web/historical-receipt.json');
  return value;
};

test('reads the historical numeric slot count and retains array compatibility', async () => {
  assert.equal((await readExecutionEvidence(input, { read: read(receipt) })).observedCalls, 8);
  const arrayReceipt = { ...receipt, providerSlots: Array.from({ length: 8 }, (_, i) => ({ ordinal: i })) };
  assert.equal((await readExecutionEvidence(input, { read: read(arrayReceipt) })).observedCalls, 8);
});

test('rejects a mismatched or nonnumeric historical count and an unrelated PR head', async () => {
  for (const bad of [
    { ...receipt, providerSlots: 7 },
    { ...receipt, providerSlots: '8' },
    { ...receipt, pr: { headSha: 'b'.repeat(40) } },
  ]) {
    await assert.rejects(readExecutionEvidence(input, { read: read(bad) }), {
      code: 'CHIEF_WEB_HISTORICAL_EVIDENCE_UNAVAILABLE',
    });
  }
});

test('reads a publication blocker only for the same conversation and reviewed candidate', async () => {
  const candidate = 'a'.repeat(40), expectedMaster = 'b'.repeat(40), observedMaster = 'c'.repeat(40);
  const binding = { grantId: '00000000-0000-0000-0000-000000000001',
    conversationId: '00000000-0000-0000-0000-000000000002', generation: 0 };
  const revision = 'd'.repeat(64), reviewDigest = 'e'.repeat(64);
  const evidence = { taskId, inputRevision: revision, prHead: headSha, candidate,
    independentReview: { verdict: 'approved', digest: reviewDigest } };
  const context = { phase: 'WAIT_DECISION', pr: { headSha }, candidate: { head: candidate },
    candidateScope: { baseCommit: expectedMaster } };
  const args = { task: { id: taskId, status: 'in_progress' }, binding, context, inputRevision: revision };
  const blocker = { ...binding, schemaVersion: 1, taskId, inputRevision: revision,
    code: 'CHIEF_WEB_MASTER_ADVANCED', operationId: '00000000-0000-0000-0000-000000000003',
    candidate, prHead: headSha, reviewDigest, expectedMaster, observedMaster };
  const fetch = patch => ({ read: async filename => filename.includes('/publication-blockers/') ? { ...blocker, ...patch }
    : filename.endsWith('/' + revision + '.json') ? evidence : null });
  assert.equal((await readExecutionEvidence(args, fetch())).publicationBlocker.observedMaster, observedMaster);
  for (const patch of [{ reviewDigest: '1'.repeat(64) }, { generation: 1 }, { expectedMaster: observedMaster }, { observedMaster: expectedMaster }]) {
    assert.equal((await readExecutionEvidence(args, fetch(patch))).publicationBlocker, undefined);
  }
  const nextCandidate = 'f'.repeat(40);
  const refreshed = { ...evidence, ...binding, candidate: nextCandidate, expectedMaster: observedMaster };
  const nextContext = { ...context, candidate: { head: nextCandidate }, candidateScope: { baseCommit: observedMaster } };
  const readNext = async filename => filename.endsWith('/' + revision + '-' + nextCandidate + '.json') ? refreshed
    : filename.includes('/publication-blockers/') ? blocker : null;
  const next = await readExecutionEvidence({ ...args, context: nextContext }, { read: readNext });
  assert.equal(next.candidate, nextCandidate);
  assert.equal(next.publicationBlocker, undefined);
});
