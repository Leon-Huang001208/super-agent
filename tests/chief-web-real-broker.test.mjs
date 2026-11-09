import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChiefWebRealSpool } from '../bridge/chief-web-real-spool.mjs';
import { REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY, REAL_CI_TRANSPORT_UNKNOWN } from '../bridge/chief-web-real-engine.mjs';
import { createChiefWebRealBroker } from '../scripts/chief-web-real-broker.mjs';
import { verifyChiefWebRealPush } from '../scripts/chief-web-real-pre-push.mjs';

test('private broker dispatches a fixed model operation once and observes it after pause', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-real-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { conversationId: randomUUID(), generation: 0, expiresAt: 30000 };
  const id = randomUUID();
  const request = { conversationId: config.conversationId, generation: 0, taskId: null, inputRevision: 'a'.repeat(64),
    operationId: id, slotId: id, repository: REAL_RWB_REPOSITORY, targetDoc: REAL_RWB_DOCUMENT, revision: 1, role: 'chief' };
  const log = () => {};
  const spool = await createChiefWebRealSpool({ root, config, log, now: () => 100 });
  let launches = 0, observations = 0;
  const create = () => createChiefWebRealBroker({
    spool, log,
    admission: { run: (_request, work) => work(null) },
    executor: {
      async execute() { launches++; return { status: 'pending' }; },
      async observe() { observations++; return { status: 'unknown', code: 'CHIEF_WEB_REAL_PROVIDER_OUTCOME_UNKNOWN' }; },
    },
    publisher: { publish() {}, observePublication() {}, readCi() {} },
  });
  await spool.executor.execute(request);
  await spool.setPaused(true);
  await create().tick();
  assert.equal(launches, 0);
  await spool.setPaused(false);
  await create().tick();
  assert.equal(launches, 1);
  await spool.setPaused(true);
  await create().tick();
  await create().tick();
  assert.equal(launches, 1);
  assert.equal(observations, 1);
  assert.equal((await spool.executor.observe(request)).status, 'unknown');
  await assert.rejects(spool.executor.observe({ ...request, revision: 2 }), { code: 'CHIEF_WEB_REAL_SPOOL_SCOPE_DENIED' });
});

test('CI transport interruptions retain the original attempt without claiming execution', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-real-ci-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { conversationId: randomUUID(), generation: 0, expiresAt: 30000 };
  const log = () => {};
  const spool = await createChiefWebRealSpool({ root, config, log, now: () => 100 });
  const id = randomUUID();
  const headSha = 'b'.repeat(40);
  const request = { conversationId: config.conversationId, generation: 0, taskId: randomUUID(),
    inputRevision: 'a'.repeat(64), operationId: id, slotId: id, repository: REAL_RWB_REPOSITORY,
    targetDoc: REAL_RWB_DOCUMENT, revision: 1, role: 'ci', pr: { number: 123, headSha }, headSha };
  const error = { status: 'blocked', code: REAL_CI_TRANSPORT_UNKNOWN };
  const receipt = { status: 'completed', taskId: request.taskId, inputRevision: request.inputRevision, operationId: id,
    evidenceDigest: 'e'.repeat(64), result: { number: 123, headSha, conclusion: 'success', checksDigest: 'f'.repeat(64) } };
  let observation = error;
  const broker = createChiefWebRealBroker({ spool, log,
    admission: { run() { assert.fail('CI must not claim execution'); } },
    executor: { execute() {}, observe() {} },
    publisher: { publish() {}, observePublication() {}, readCi() { return observation; } },
  });
  await spool.publisher.readCi(request);
  await broker.tick();
  assert.equal((await spool.publisher.readCi(request)).status, 'pending');
  await spool.complete(id, error);
  const original = await fs.readFile(path.join(root, id, 'response.json'), 'utf8');
  await assert.rejects(spool.complete(id, { ...receipt, result: { ...receipt.result, headSha: 'c'.repeat(40) } }),
    { code: 'CHIEF_WEB_REAL_SPOOL_RECOVERY_MISMATCH' });
  assert.deepEqual(await spool.publisher.readCi(request), error);
  observation = receipt;
  await broker.tick();
  assert.deepEqual(await spool.publisher.readCi(request), { ...receipt, recoveryVerified: true });
  assert.equal(await fs.readFile(path.join(root, id, 'response.json'), 'utf8'), original);
  assert.equal(await spool.isClaimed(id), false);
});

test('pre-push rejects a different advertised old head and extra refs', () => {
  const branch = 'codex/integrate-super-agent-' + randomUUID();
  const policy = { schemaVersion: 1, branch, candidateSha: 'c'.repeat(40), previousHead: 'b'.repeat(40), expiresAt: Date.now() + 10000 };
  const remote = { remoteName: 'origin', remoteUrl: 'https://github.com/' + REAL_RWB_REPOSITORY + '.git', policy };
  const ref = 'refs/heads/' + branch;
  const line = ref + ' ' + policy.candidateSha + ' ' + ref + ' ' + policy.previousHead;
  assert.equal(verifyChiefWebRealPush({ ...remote, stdin: line + '\n' }), true);
  assert.throws(() => verifyChiefWebRealPush({ ...remote, stdin: line + '\n' + line + '\n' }), /PRE_PUSH_DENIED/);
  assert.throws(() => verifyChiefWebRealPush({ ...remote, stdin: line.replace(policy.previousHead, 'a'.repeat(40)) }), /PRE_PUSH_DENIED/);
});

test('shared lease journal resumes reservation and terminal release across lost file commits', async t => {
  const { AdmissionMeter } = await import('../bridge/admission.mjs');
  const { createHostStorageReceipt } = await import('../scripts/host-storage.mjs');
  const { createChiefWebRealAdmission } = await import('../scripts/chief-web-real-admission.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-lease-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'admission.sqlite');
  const projectId = randomUUID();
  const log = () => {};
  new AdmissionMeter({ filename: databasePath, allowedProjectIds: [projectId], log }).close();
  const request = { taskId: randomUUID(), role: 'developer', operationId: randomUUID(), inputRevision: 'b'.repeat(64) };
  const at = Date.UTC(2026, 10, 9, 6);
  const storageReceipt = () => createHostStorageReceipt({
    hostPlatform: 'darwin', capturedAt: new Date(at).toISOString(), externalFilesystem: 'apfs',
    dfPk: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/a 10000000 2000000 8000000 20% /\n/dev/b 10000000 2000000 8000000 20% /Volumes/SuperAgentDockerData',
  }, { now: at });
  let intent, lease, releaseIntent, released = false;
  let loseClaim = true, loseRelease = true;
  const admission = createChiefWebRealAdmission({
    databasePath, projectId, log, now: () => at, verifyLegacyDrained: () => true, storageReceipt,
    journal: {
      read: () => lease && { ...lease, released },
      readIntent: () => intent, markIntent: (_id, value) => { intent = value; },
      create: (_id, value) => {
        if (loseClaim) { loseClaim = false; throw new Error('reservation response lost'); }
        lease = value;
      },
      readReleaseIntent: () => releaseIntent,
      markReleaseIntent: (_id, value) => { releaseIntent = value; },
      markReleased: () => {
        if (loseRelease) { loseRelease = false; throw new Error('release response lost'); }
        released = true;
      },
    },
  });
  let executions = 0;
  await assert.rejects(admission.run(request, () => assert.fail('unrecorded lease must not execute')), /reservation response lost/);
  await assert.rejects(admission.run(request, observed => {
    assert.equal(observed.taskId, request.taskId);
    executions++;
    return { status: 'completed' };
  }), /release response lost/);
  const result = await admission.run(request, observed => {
    assert.equal(observed, null);
    return { status: 'completed' };
  });
  assert.equal(result.status, 'completed');
  assert.equal(executions, 1);
  assert.equal(released, true);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS count FROM admission_lease').get().count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM admission_meter').get().count, 1);
  } finally { db.close(); }
});
