import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';
import { createChiefWebRecoveryHostHandoff } from '../bridge/chief-web-recovery-io.mjs';
import { createChiefWebRecoveryLease } from '../bridge/chief-web-recovery-lease.mjs';
import { createChiefWebRecoveryNative } from '../bridge/chief-web-recovery-native.mjs';

const uuid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const sha = value => createHash('sha256').update(value).digest('hex');
const { taskId, repository, pullRequest, previousHead, path } = CHIEF_WEB_PILOT;
const prUrl = 'https://github.com/' + repository + '/pull/' + pullRequest;
const candidateSha = 'a'.repeat(40);
const confirmationOperationId = 'b'.repeat(64);
const scopeDigest = 'c'.repeat(64);
const reviewDigest = 'd'.repeat(64);
const projectId = uuid(1);
const task = { id: taskId, projectId, companyId: uuid(2), originId: uuid(3),
  responsibleUserId: uuid(4), status: 'in_progress', description: 'fixture', statusVersion: 1 };
const grant = { grantId: uuid(5), ownerId: task.responsibleUserId, chiefAgentId: uuid(6),
  conversationId: uuid(7), generation: 1 };
const fullTaskInput = { companyId: task.companyId, originId: task.originId, projectId,
  responsibleUserId: grant.ownerId, targetDoc: path, taskId };
const inputRevision = sha(JSON.stringify(fullTaskInput));
const scoped = { taskId, ...grant, inputRevision, candidateSha, repository, pullRequest,
  scopeDigest, confirmationOperationId, previousHead };

test('pinned Native recovery projects current evidence and uses CAS for wait and terminal CI receipt', async () => {
  const row = { ...task };
  const records = [
    { taskId, kind: 'input-state', fullTaskInput },
    { taskId, kind: 'execution-context', status: 'completed', executionContext: {
      phase: 'WAIT_DECISION', candidate: { head: candidateSha }, pr: { url: prUrl, headSha: previousHead },
      candidateScope: { head: candidateSha, baseCommit: 'e'.repeat(40), integrationBranch: 'codex/integrate-super-agent-fixture' },
      expectedWait: { inputRevision, candidateSha },
      proposal: { authorized: true, candidate: { digest: candidateSha }, action: { kind: 'publish_pr_update',
        scope: { prUrl, oldHead: previousHead, newHead: candidateSha, maxAction: 'update_pr_only' } } },
    } },
  ];
  let drained = true;
  let dispatchMode = 'off';
  const transaction = {
    lockTask: () => row, listTaskOperations: () => records, recoveryIsDrained: () => drained,
    appendRecoveryContext({ record, nativeStatus }) {
      records.push(record);
      if (nativeStatus) {
        row.status = nativeStatus;
        row.statusVersion++;
      }
    },
  };
  const { readExecution, nativeFinalization: api } = createChiefWebRecoveryNative({
    bindings: { repository: { transaction: run => run(transaction) }, readGrant: () => grant },
    readExecutionEvidence: () => ({ ...grant, prHead: previousHead, candidate: candidateSha, independentReview: { candidate: candidateSha,
      verdict: 'approved', digest: reviewDigest }, localChecks: { candidate: candidateSha, passed: true } }),
    readRuntime: () => ({ dispatchMode, allowedTaskIds: [taskId] }), readReviewCapability: () => null,
    lease: { read: () => ({ verified: true, active: true, leaseDigest: 'f'.repeat(64) }), release() {} },
    now: () => 1_000,
  });
  const execution = await readExecution({ task: row, grant, transaction, records, stage: 'claim', mode: 'admit',
    intent: { expected: { candidate: candidateSha, reviewDigest, prHead: previousHead, inputRevision } } });
  assert.equal(execution.branch, 'codex/integrate-super-agent-fixture');
  const initial = await api.readState(scoped);
  const wait = { ...scoped, operationId: '1'.repeat(64), publicationEvidenceDigest: '2'.repeat(64),
    expectedNativeRevision: initial.nativeRevision, expectedContextRevision: initial.contextRevision };
  await api.recordWait(wait);
  const current = await api.readState(scoped);
  assert.equal(current.phase, 'WAIT_CI');
  assert.equal(current.waitOperationId, wait.operationId);
  const ci = { ...scoped, operationId: '3'.repeat(64), ci: { eventId: 'event:1', conclusion: 'success', evidenceDigest: '4'.repeat(64) },
    expectedNativeRevision: current.nativeRevision, expectedContextRevision: initial.contextRevision };
  await assert.rejects(api.recordCi(ci), { code: 'CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED' });
  await api.recordCi({ ...ci, expectedContextRevision: current.contextRevision });
  assert.equal(row.status, 'done');
  const receipt = await api.readConversationReceipt(scoped);
  assert.equal(receipt.operationId, ci.operationId);
  assert.equal(receipt.ciProofDigest, ci.ci.evidenceDigest);
  dispatchMode = 'controlled';
  await assert.rejects(api.readState(scoped), { code: 'CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED' });
  dispatchMode = 'off';
  drained = false;
  await assert.rejects(api.readState(scoped), { code: 'CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED' });
});

test('host handoff requires a fresh scope and writes one immutable request at the fixed location', async () => {
  const data = new Map();
  const ports = createChiefWebRecoveryHostHandoff({
    read: filename => data.get(filename), write: (filename, value) => {
      assert.equal(data.has(filename), false);
      data.set(filename, value);
    },
    now: () => 100_000,
  });
  const prefix = '/paperclip/control/chief-web/recovery-host/' + confirmationOperationId + '/';
  data.set(prefix + 'remote.json', { scopeDigest, observedAt: 1 });
  assert.equal(await ports.readRemote(scoped), null);
  data.set(prefix + 'remote.json', { scopeDigest: '0'.repeat(64), observedAt: 99_000 });
  assert.equal(await ports.readRemote(scoped), null);
  data.set(prefix + 'remote.json', { scopeDigest, observedAt: 99_000 });
  assert.equal((await ports.readRemote(scoped)).scopeDigest, scopeDigest);
  await ports.publishExisting(scoped);
  assert.deepEqual(data.get(prefix + 'request.json'), { schemaVersion: 1, action: 'publish_existing_pr', scope: scoped });
  assert.equal(await ports.recoverRequest(scoped), false);
  data.delete(prefix + 'request.json');
  data.set(prefix + 'host-dispatch.json', { scopeDigest });
  assert.equal(await ports.recoverRequest(scoped), false);
  data.delete(prefix + 'host-dispatch.json');
  assert.equal(await ports.recoverRequest(scoped), true);
  assert.equal(await ports.recoverRequest(scoped), false);
});

test('lease release compares the original admission slot and proves archived absence from SQLite', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE admission_meter(task_id TEXT PRIMARY KEY, project_id TEXT); CREATE TABLE admission_lease(slot INTEGER PRIMARY KEY, task_id TEXT, nonce TEXT);');
  const activePath = '/paperclip/control/active-lease.json';
  const nonce = '5'.repeat(64);
  db.prepare('INSERT INTO admission_meter VALUES (?, ?)').run(taskId, projectId);
  db.prepare('INSERT INTO admission_lease VALUES (1, ?, ?)').run(taskId, nonce);
  const files = new Map([[activePath, { taskId, projectId, nonce }]]);
  const lease = createChiefWebRecoveryLease({
    readPrivate: filename => files.get(filename), writePrivate: (filename, value) => {
      assert.equal(files.has(filename), false);
      files.set(filename, value);
    },
    open: () => ({ exec: command => db.exec(command), prepare: query => db.prepare(query), close() {} }),
    unlink: filename => files.delete(filename), sync() {},
  });
  const scope = { taskId, projectId, inputRevision, operationId: '6'.repeat(64), ciEvidenceDigest: '7'.repeat(64) };
  const active = await lease.read(scope);
  assert.equal(active.active, true);
  await assert.rejects(lease.release({ ...scope, leaseDigest: '8'.repeat(64) }), { code: 'CHIEF_WEB_RECOVERY_LEASE_UNVERIFIED' });
  await lease.release({ ...scope, leaseDigest: active.leaseDigest });
  assert.equal(db.prepare('SELECT * FROM admission_lease').all().length, 0);
  const released = await lease.read(scope);
  assert.equal(released.archived, true);
  assert.equal(released.operationId, scope.operationId);
  assert.equal(released.leaseDigest, active.leaseDigest);
  db.close();
});

test('the exact durable release intent reconciles crashes after the intent, archive or unlink', async () => {
  for (const interruption of ['intent', 'archive', 'unlink']) {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE admission_meter(task_id TEXT PRIMARY KEY, project_id TEXT); CREATE TABLE admission_lease(slot INTEGER PRIMARY KEY, task_id TEXT, nonce TEXT);');
    const activePath = '/paperclip/control/active-lease.json';
    const nonce = '5'.repeat(64);
    db.prepare('INSERT INTO admission_meter VALUES (?, ?)').run(taskId, projectId);
    db.prepare('INSERT INTO admission_lease VALUES (1, ?, ?)').run(taskId, nonce);
    const files = new Map([[activePath, { taskId, projectId, nonce }]]);
    let interrupt = true;
    const configured = {
      readPrivate: filename => files.get(filename), writePrivate: (filename, value) => {
        assert.equal(files.has(filename), false);
        files.set(filename, value);
        if (interrupt && filename.endsWith('.' + interruption + '.json')) throw new Error('interrupted');
      },
      open: () => ({ exec: command => db.exec(command), prepare: query => db.prepare(query), close() {} }),
      unlink(filename) {
        files.delete(filename);
        if (interrupt && interruption === 'unlink') throw new Error('interrupted');
      },
      sync() {},
    };
    const lease = createChiefWebRecoveryLease(configured);
    const scope = { taskId, projectId, inputRevision, operationId: '6'.repeat(64), ciEvidenceDigest: '7'.repeat(64) };
    const active = await lease.read(scope);
    const bound = { ...scope, leaseDigest: active.leaseDigest };
    await assert.rejects(lease.release(bound), /interrupted/);
    assert.equal(db.prepare('SELECT * FROM admission_lease').all().length, 1);
    assert.equal((await lease.read(bound)).reconciliationRequired, true);
    const restored = createChiefWebRecoveryLease(configured);
    interrupt = false;
    await assert.rejects(restored.reconcile({ ...bound, ciEvidenceDigest: '8'.repeat(64) }), {
      code: 'CHIEF_WEB_RECOVERY_LEASE_UNVERIFIED',
    });
    await restored.reconcile(bound);
    assert.equal((await restored.read(bound)).archived, true);
    assert.equal(db.prepare('SELECT * FROM admission_lease').all().length, 0);
    db.close();
  }
});
