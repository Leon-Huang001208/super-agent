import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { createChiefWebRecoveryEntry } from '../bridge/chief-web-recovery-entry.mjs';

const id = number => '00000000-0000-0000-0000-' + String(number).padStart(12, '0');
const operationId = 'a'.repeat(64);
const eventId = 'checks:1';
const baseline = 'b'.repeat(40);
const candidateSha = 'c'.repeat(40);
const leaseDigest = 'd'.repeat(64);
const branch = 'codex/integrate-super-agent-fixture';
const { taskId, repository, pullRequest, path, previousHead } = CHIEF_WEB_PILOT;
const grantId = id(1);
const conversationId = id(2);
const generation = 1;
const inputRevision = 'e'.repeat(64);
const reviewDigest = 'f'.repeat(64);
const publicationDigest = '1'.repeat(64);
const ciDigest = '2'.repeat(64);
const proof = {
  taskId, grantId, conversationId, generation, inputRevision, candidateSha, previousHead, reviewDigest,
  repository, pullRequest, path, baseCommit: baseline, branch, leaseDigest, reviewVerified: true, checksPassed: true,
};

function fixture() {
  const records = [{
    kind: 'chief-web-intent', taskId, grantId, operationId, payloadHash: '3'.repeat(64), expiresAt: 100,
    status: 'reserved', action: 'confirm', receipt: { status: 'reserved', operationId },
    expected: { inputRevision, prHead: previousHead, candidate: candidateSha, reviewDigest },
  }];
  const intent = records[0];
  const calls = [];
  let queue = Promise.resolve();
  let now = 1;
  let grant = { grantId, conversationId, generation, expiresAt: 100 };
  let execution = { ...proof };
  let currentHead = previousHead;
  let baseSha = baseline;
  let observedCiHead = candidateSha;
  let phase = 'WAIT_DECISION';
  let nativeStatus = 'in_progress';
  let nativeHead = previousHead;
  let wait;
  let ci;
  let published;
  let released;
  let lost = {};
  let preflight;
  const bindings = {
    repository: {
      transaction(callback) {
        const pending = queue.then(async () => {
          const snapshot = structuredClone(records);
          const result = await callback({
            lockTask: () => ({ id: taskId }),
            listTaskOperations: () => snapshot,
            appendOperation: row => snapshot.push(structuredClone(row)),
          });
          records.splice(0, records.length, ...snapshot);
          return result;
        });
        queue = pending.catch(() => {});
        return pending;
      },
    },
    readGrant: () => grant,
  };

  const hostPublication = {
    readRemote() {
      return { verified: true, repository, pullRequest, headRepository: repository,
        headSha: currentHead, headRef: branch, baseRepository: repository, baseRef: 'master',
        baseSha, state: 'open', public: true, autoMergeAllowed: false, autoMergeRequested: false };
    },
    readPrepared(scope) {
      preflight?.();
      return { ...scope, verified: true, clean: true, descendsFromBase: true,
        descendsFromPreviousHead: true, drained: true, pauseFenceClear: true,
        changedPaths: [path], deliveryReceiptDigest: '4'.repeat(64) };
    },
    readPublicationReceipt: () => published,
    publishExisting(scope) {
      calls.push('publish');
      if (lost.publish === 'before') throw Error('no receipt');
      currentHead = scope.candidateSha;
      published = { ...scope, verified: true, status: 'awaiting_ci', updatedExisting: true,
        safetyAutoMergeDeferred: true, receiptDigest: publicationDigest };
      if (lost.publish === 'after') throw Error('transport lost');
    },
    readCiEvidence(_scope, suppliedEventId) {
      return { verified: true, eventId: suppliedEventId, repository, pullRequest, headSha: observedCiHead,
        requiredChecksVerified: true, terminal: true, conclusion: 'success', evidenceDigest: ciDigest };
    },
  };
  const nativeFinalization = {
    readState() {
      return { ...proof, verified: true, noExecutionInFlight: true, nativeRevision: '5'.repeat(64), contextRevision: '6'.repeat(64),
        phase, nativeStatus, prHead: nativeHead, waitOperationId: wait?.operationId,
        publicationEvidenceDigest: wait?.publicationEvidenceDigest, ciEventId: ci?.ci.eventId, ciProofDigest: ci?.ci.evidenceDigest };
    },
    recordWait(scope) {
      calls.push('wait');
      wait = scope;
      phase = 'WAIT_CI';
      nativeHead = candidateSha;
    },
    recordCi(scope) {
      calls.push('ci');
      ci = scope;
      nativeStatus = 'done';
      if (lost.ci) throw Error('writeback response lost');
    },
    readConversationReceipt() {
      if (!ci) return null;
      return { ...ci, verified: true, channel: 'chief-web', conclusion: ci.ci.conclusion, ciProofDigest: ci.ci.evidenceDigest,
        receiptDigest: '7'.repeat(64) };
    },
    readLease() {
      if (released) return released;
      return { verified: true, taskId, active: true, archived: false, leaseDigest };
    },
    releaseLease(scope) {
      calls.push('release');
      released = { ...scope, verified: true, active: false, archived: true, archiveDigest: '8'.repeat(64) };
      if (lost.release) throw Error('lease result lost');
    },
  };
  return {
    records, calls, create: () => createChiefWebRecoveryEntry({
      bindings, hostPublication, nativeFinalization, readExecution: () => execution, log: () => {}, now: () => now,
    }),
    setLost: value => { lost = value; },
    setCiHead: value => { observedCiHead = value; },
    setBase: value => { baseSha = value; },
    setPreflight: callback => { preflight = callback; },
    expire: () => { now = 100; },
    resetConversation: () => { grant = null; },
    swapLease: () => { execution = { ...proof, leaseDigest: '9'.repeat(64) }; },
    pause() {
      const pauseId = '9'.repeat(64);
      records.push({ ...intent, action: 'pause', operationId: pauseId, receipt: { status: 'reserved', operationId: pauseId } });
    },
  };
}

const command = { operationId };
const ciCommand = { operationId, eventId };

test('one confirmation and one application per stage across duplicate and restored requests', async () => {
  const env = fixture();
  const first = env.create();
  const claims = await Promise.all([first.claim(command), first.claim(command)]);
  assert.deepEqual(claims.map(result => result.status), ['claimed', 'claimed']);
  assert.equal(env.records.filter(row => row.kind === 'chief-web-effect-claim').length, 1);
  assert.equal((await first.release(command)).status, 'blocked');
  assert.equal((await first.publish(command)).status, 'waiting_ci');
  const resumed = env.create();
  assert.equal((await resumed.publish(command)).status, 'waiting_ci');
  assert.equal((await resumed.recordCi(ciCommand)).status, 'recorded');
  assert.equal((await resumed.recordCi(ciCommand)).status, 'recorded');
  assert.equal((await resumed.recordCi({ operationId, eventId: 'checks:2' })).code, 'CHIEF_WEB_RECOVERY_CI_EVENT_CHANGED');
  assert.equal((await resumed.release(command)).status, 'released');
  assert.equal((await resumed.release(command)).status, 'released');
  assert.deepEqual(env.calls, ['publish', 'wait', 'ci', 'release']);
});

test('a publication response lost after the write reconciles before writeback and never pushes again', async () => {
  const env = fixture();
  env.setLost({ publish: 'after', ci: true, release: true });
  const initial = env.create();
  assert.equal((await initial.claim(command)).status, 'claimed');
  assert.equal((await initial.publish(command)).status, 'unknown');
  const resumed = env.create();
  assert.equal((await resumed.publish(command)).status, 'waiting_ci');
  assert.equal((await resumed.recordCi(ciCommand)).status, 'unknown');
  assert.equal((await resumed.recordCi(ciCommand)).status, 'recorded');
  assert.equal((await resumed.release(command)).status, 'unknown');
  assert.equal((await resumed.release(command)).status, 'released');
  assert.deepEqual(env.calls, ['publish', 'wait', 'ci', 'release']);
});

test('an uncertain dispatch without a trusted postcondition stays unknown after restart', async () => {
  const env = fixture();
  env.setLost({ publish: 'before' });
  const initial = env.create();
  await initial.claim(command);
  assert.equal((await initial.publish(command)).status, 'unknown');
  env.setLost({});
  assert.equal((await env.create().publish(command)).status, 'unknown');
  assert.deepEqual(env.calls, ['publish']);
  assert.equal(env.records.filter(row => row.stage === 'publish').length, 1);
});

test('expired, reset, and changed lease confirmations cannot reach the publisher', async () => {
  for (const [invalidate, code] of [
    ['expire', 'CHIEF_WEB_RECOVERY_EXPIRED'],
    ['resetConversation', 'CHIEF_WEB_RECOVERY_GRANT_CHANGED'],
    ['swapLease', 'CHIEF_WEB_RECOVERY_SCOPE_CHANGED'],
  ]) {
    const env = fixture();
    const entry = env.create();
    await entry.claim(command);
    env[invalidate]();
    assert.equal((await entry.publish(command)).code, code);
    assert.deepEqual(env.calls, []);
  }
});

test('pause during preflight prevents dispatch and moving remote base blocks before a claim', async () => {
  const racing = fixture();
  const paused = racing.create();
  await paused.claim(command);
  racing.setPreflight(() => racing.pause());
  assert.equal((await paused.publish(command)).code, 'CHIEF_WEB_RECOVERY_PAUSED');
  assert.deepEqual(racing.calls, []);
  const moved = fixture();
  const entry = moved.create();
  await entry.claim(command);
  moved.setBase('9'.repeat(40));
  assert.equal((await entry.publish(command)).code, 'CHIEF_WEB_RECOVERY_REMOTE_BASE_CHANGED');
  assert.equal(moved.records.some(row => row.stage === 'publish'), false);
});

test('old-head CI is refused before acquiring a writeback claim', async () => {
  const env = fixture();
  const entry = env.create();
  await entry.claim(command);
  await entry.publish(command);
  env.setCiHead(previousHead);
  assert.equal((await entry.recordCi(ciCommand)).code, 'CHIEF_WEB_RECOVERY_CI_UNVERIFIED');
  assert.equal(env.records.some(row => row.stage === 'ci'), false);
  env.setCiHead(candidateSha);
  assert.equal((await entry.recordCi(ciCommand)).status, 'recorded');
});
