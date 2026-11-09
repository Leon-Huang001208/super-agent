import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { CHIEF_WEB_REAL_MODEL, CHIEF_WEB_REAL_REPOSITORY, CHIEF_WEB_REAL_TARGET, chiefWebRealDigest,
  chiefWebRealRequestDigest, chiefWebRealRequestIdentity, createChiefWebRealExecutor } from '../bridge/chief-web-real-executor.mjs';
import { createChiefWebRealFileProvider, createChiefWebRealProviderWorker, decodeChiefWebRealCodex } from '../bridge/chief-web-real-executor-provider.mjs';
import { chiefWebRealDockerArguments, createChiefWebRealDockerExecutor,
  retireChiefWebRealCredentialCopy } from '../scripts/chief-web-real-executor-host.mjs';
import { preserveChiefWebRealRotatedAuth } from '../scripts/chief-web-real-executor.mjs';

const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const before = '# 原始文档\n';
const after = before + '\n## 补充\n\n核对同一 PR。\n';
const conversationId = id(1);
const accountFingerprint = 'a'.repeat(64);
const credentialGrantId = id(2);
const baseSha = 'a'.repeat(40);
const currentHead = 'b'.repeat(40);
const candidateSha = 'c'.repeat(40);
const branch = 'codex/integrate-super-agent-' + id(4);
const checksDigest = 'd'.repeat(64);
const developerSessionId = id(3);

function request(role, revision = 2) {
  const taskId = role === 'chief' && revision === 1 ? null : id(4);
  const roleId = { chief: 1, developer: 2, reviewer: 3 }[role];
  return { taskId, role, conversationId, generation: 2, inputRevision: String(revision).repeat(64), revision,
    slotId: id(10 * revision + roleId), text: '请补充一小节说明如何核对同一个 PR。', taskDescription: '追加核对同一 PR 的小节。',
    ...(role === 'reviewer' && { candidateSha }) };
}

function claimFor(value) {
  return { ...chiefWebRealRequestIdentity(value), requestDigest: chiefWebRealRequestDigest(value),
    ...CHIEF_WEB_REAL_MODEL, accountFingerprint, credentialGrantId, claimedAt: 10, expiresAt: 1000 };
}

function codexResult(result, sessionId = id(5)) {
  return Buffer.from([
    { type: 'thread.started', thread_id: sessionId },
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } },
    { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 8 } },
  ].map(row => JSON.stringify(row)).join('\n'));
}

function fixture() {
  const files = new Map();
  const claims = new Map();
  const candidates = new Map();
  const calls = [];
  let clock = 20;
  let mayDispatch = true;
  let result;
  const read = name => files.get(name);
  const write = (name, value) => {
    if (files.has(name)) throw Object.assign(Error('existing'), { code: 'EEXIST' });
    files.set(name, structuredClone(value));
  };
  const fileProvider = createChiefWebRealFileProvider({ read, write, now: () => clock });
  const worker = createChiefWebRealProviderWorker({
    read, write, now: () => clock, log() {},
    readCredential() { return { verified: true, accountFingerprint, credentialGrantId }; },
    run({ binding }) { calls.push(binding.slotId); if (result instanceof Error) throw result; return result; },
  });
  const workspace = {
    safeCandidateHandoffReplay: true,
    read(value) {
      return {
        taskId: value.taskId, inputRevision: value.inputRevision, verified: true, repository: CHIEF_WEB_REAL_REPOSITORY,
        targetDoc: CHIEF_WEB_REAL_TARGET, baseSha, currentHead, branch, evidenceDigest: 'e'.repeat(64),
        document: { exists: true, content: before, digest: chiefWebRealDigest(before) },
        candidate: { candidateSha, developerSessionId, checksPassed: true, changedPaths: [CHIEF_WEB_REAL_TARGET], checksDigest,
          document: { exists: true, content: after, digest: chiefWebRealDigest(after) } },
      };
    },
    prepare({ claim, content, providerReceiptDigest, developerSessionId: sessionId }) {
      const prepared = { verified: true, slotId: claim.slotId, taskId: claim.taskId, inputRevision: claim.inputRevision,
        targetDoc: CHIEF_WEB_REAL_TARGET, checksPassed: true, baseSha, branch, candidateSha, checksDigest,
        documentDigest: chiefWebRealDigest(content), developerSessionId: sessionId,
        providerReceiptDigest, changedPaths: [CHIEF_WEB_REAL_TARGET] };
      candidates.set(claim.slotId, prepared);
      return prepared;
    },
    observeCandidate({ claim }) { return candidates.get(claim.slotId); },
  };
  function create() {
    return createChiefWebRealExecutor({
      admission: {
        claim({ slotId }) { return { status: 'claimed_now', claim: claims.get(slotId), dispatchAllowed: mayDispatch }; },
        read({ slotId }) { return { status: 'claimed', claim: claims.get(slotId), dispatchAllowed: mayDispatch }; },
      },
      workspace, provider: fileProvider, log() {}, now: () => clock,
    });
  }
  function reserve(value) {
    const claim = claimFor(value);
    claims.set(value.slotId, claim);
    const prefix = '/paperclip/control/chief-web/recovery-host/real-model/' + value.slotId + '/';
    files.set(prefix + 'reservation.json', { ...claim, status: 'reserved' });
    return prefix;
  }
  return {
    create, reserve, files, worker, calls, setResult(value) { result = value; },
    expire() { clock = 2000; }, setPaused() { mayDispatch = false; },
  };
}

test('Chief slot precedes Native task registration and reconciles its pinned physical receipt', async () => {
  const env = fixture();
  const value = request('chief', 1);
  env.reserve(value);
  env.setResult(codexResult({ accepted: true }));
  const pending = await env.create().execute(value);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.taskId, null);
  const competing = await Promise.all([env.worker.execute(value.slotId), env.worker.execute(value.slotId)]);
  assert.ok(competing.some(row => row.status === 'completed'));
  env.expire();
  assert.equal((await env.worker.execute(value.slotId)).status, 'completed');
  const receipt = await env.create().observe(value);
  assert.deepEqual(receipt.result, { accepted: true, targetDoc: CHIEF_WEB_REAL_TARGET, requirements: value.text });
  assert.match(receipt.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.operationId, value.slotId);
  assert.deepEqual(env.calls, [value.slotId]);
});

test('same claimed slot resumes only from trusted admission while pause prevents missing handoff', async () => {
  const env = fixture();
  const value = request('chief', 1);
  const prefix = env.reserve(value);
  env.setPaused();
  assert.equal((await env.create().observe(value)).status, 'pending');
  assert.equal(env.files.has(prefix + 'request.json'), false);
  const active = fixture();
  const activePrefix = active.reserve(value);
  await active.create().observe(value);
  assert.equal(active.files.has(activePrefix + 'request.json'), true);
  const changed = await active.create().observe({ ...value, text: '尝试替换同一槽位的请求。' });
  assert.equal(changed.code, 'CHIEF_WEB_REAL_EXECUTION_RESERVATION_DENIED');
});

test('developer preserves the prior document and prepares only an exact fixed-file candidate', async () => {
  const env = fixture();
  const value = request('developer');
  env.reserve(value);
  env.setResult(codexResult({ content: after }, developerSessionId));
  await env.create().execute(value);
  await env.worker.execute(value.slotId);
  const result = await env.create().observe(value);
  assert.equal(result.status, 'completed');
  assert.equal(result.result.candidateSha, candidateSha);
  assert.equal(result.result.checksPassed, true);
  assert.deepEqual(env.calls, [value.slotId]);

  const changed = fixture();
  changed.reserve(value);
  changed.setResult(codexResult({ content: '# 改写原文档' }));
  await changed.create().execute(value);
  await changed.worker.execute(value.slotId);
  assert.equal((await changed.create().observe(value)).code, 'CHIEF_WEB_REAL_DOCUMENT_OUTPUT_DENIED');
});

test('review rejects developer session reuse and binds approval to the exact candidate', async () => {
  for (const [session, expected] of [[developerSessionId, 'unknown'], [id(5), 'completed']]) {
    const env = fixture();
    const value = request('reviewer');
    env.reserve(value);
    env.setResult(codexResult({ approved: true }, session));
    await env.create().execute(value);
    await env.worker.execute(value.slotId);
    const result = await env.create().observe(value);
    assert.equal(result.status, expected);
    if (expected === 'completed') assert.match(result.result.reviewDigest, /^[a-f0-9]{64}$/);
    else assert.equal(result.code, 'CHIEF_WEB_REAL_REVIEW_NOT_INDEPENDENT');
  }
});

test('unknown physical outcome and a missing reservation never launch a second process', async () => {
  const env = fixture();
  const value = request('chief', 1);
  const prefix = env.reserve(value);
  await env.create().execute(value);
  env.files.delete(prefix + 'reservation.json');
  await assert.rejects(env.worker.execute(value.slotId), { code: 'CHIEF_WEB_REAL_EXECUTION_RESERVATION_DENIED' });
  assert.deepEqual(env.calls, []);
  env.reserve(value);
  env.setResult(new Error('response lost'));
  assert.equal((await env.worker.execute(value.slotId)).status, 'unknown');
  assert.equal((await env.worker.execute(value.slotId)).status, 'unknown');
  assert.equal((await env.create().observe(value)).status, 'unknown');
  assert.deepEqual(env.calls, [value.slotId]);
});

test('JSON protocol rejects failed, truncated and tool-execution turns', () => {
  const good = codexResult({ accepted: true });
  assert.equal(decodeChiefWebRealCodex(good).result.accepted, true);
  assert.throws(() => decodeChiefWebRealCodex(Buffer.from(good.toString().split('\n').slice(0, -1).join('\n'))));
  assert.throws(() => decodeChiefWebRealCodex(Buffer.from(good.toString().replace('turn.completed', 'turn.failed'))));
  assert.throws(() => decodeChiefWebRealCodex(Buffer.from(good.toString().replace('agent_message', 'command_execution'))));
});

test('Docker worker uses only the pinned image, dependencies and one scoped handoff', () => {
  const slotId = id(10);
  const source = { imageId: 'sha256:' + 'a'.repeat(64), network: 'super-agent-test_model', dependenciesRoot: '/tmp/deps',
    logRoot: '/tmp/logs', modelSlot: '/tmp/jobs/' + slotId, credentialSlot: '/tmp/scoped/' + slotId, slotId };
  const args = chiefWebRealDockerArguments(source);
  assert.equal(args[args.indexOf('--pull') + 1], 'never');
  assert.deepEqual(args.slice(-3), [source.imageId, '/opt/super-agent/scripts/chief-web-real-executor.mjs', slotId]);
  assert.equal(args.filter(value => value === '--mount').length, 4);
  assert.ok(args.some(value => value.endsWith('dst=/executor-sessions')));
  assert.ok(args.every(value => !value.includes('/.codex/') && !value.includes('docker.sock') && !value.includes('API_KEY')));
  assert.throws(() => chiefWebRealDockerArguments({ ...source, network: 'host' }));
  assert.throws(() => chiefWebRealDockerArguments({ ...source, imageId: 'super-agent:latest' }));
});

test('a paused broker can observe a receipt without provisioning, launching or preparing a worktree', async t => {
  const root = await fs.realpath(await fs.mkdtemp('/tmp/sa-real-executor-test-'));
  t.after(() => fs.rm(root, { recursive: true }));
  const [modelRoot, credentialRoot, logRoot] = ['model', 'credentials', 'logs'].map(name => path.join(root, name));
  await Promise.all([modelRoot, credentialRoot, logRoot].map(directory => fs.mkdir(directory, { mode: 0o700 })));
  const value = request('developer');
  const hash = chiefWebRealDigest(JSON.stringify([value.conversationId, value.generation, value.inputRevision, value.role]));
  value.slotId = hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-5' + hash.slice(13, 16) + '-8' + hash.slice(17, 20) + '-' + hash.slice(20, 32);
  const forbidden = () => { throw Error('paused operation tried to dispatch'); };
  let observations = 0;
  const host = createChiefWebRealDockerExecutor({ config: { conversationId, generation: value.generation,
    expiresAt: 1000, credentialGrantId }, modelRoot, credentialRoot, logRoot, log() {}, now: () => 20,
    invokeDocker: forbidden, workspace: { read: forbidden, prepare: forbidden, observeCandidate: forbidden,
      observeSource() { observations++; return null; } },
  });
  const lease = { taskId: value.taskId, inputRevision: value.inputRevision, projectId: id(7), nonce: 'c'.repeat(64) };
  assert.equal((await host.execute(value, lease, { dispatchAllowed: false })).status, 'pending');
  assert.deepEqual(await fs.readdir(modelRoot), []);
  const slot = path.join(modelRoot, value.slotId);
  await fs.mkdir(slot, { mode: 0o700 });
  const claim = claimFor(value);
  const put = (name, body) => fs.writeFile(path.join(slot, name), JSON.stringify(body), { mode: 0o600 });
  await put('reservation.json', { ...claim, status: 'reserved' });
  assert.equal((await host.observe(value, lease, { dispatchAllowed: false })).status, 'pending');
  assert.deepEqual(await fs.readdir(slot), ['reservation.json']);
  const physical = { ...claim, status: 'claimed', dispatchedAt: 11, promptDigest: 'b'.repeat(64) };
  await put('physical.json', physical);
  await put('receipt.json', { ...physical, status: 'unknown', physicalCalls: 1 });
  assert.equal((await host.observe(value, lease, { dispatchAllowed: false })).status, 'pending');
  assert.equal(observations, 1);
  assert.deepEqual(await fs.readdir(credentialRoot), []);
});

test('retire only exact copied auth after receipt and Docker drain, preserving actual rotated credentials', async t => {
  const root = await fs.realpath(await fs.mkdtemp('/tmp/sa-real-executor-auth-test-'));
  t.after(() => fs.rm(root, { recursive: true }));
  const claim = claimFor(request('chief', 1));
  const identity = chiefWebRealRequestIdentity(claim);
  const slot = path.join(root, claim.slotId);
  const role = path.join(slot, claim.conversationId, claim.inputRevision, claim.role);
  const home = path.join(role, claim.slotId);
  await fs.mkdir(home, { recursive: true, mode: 0o711 });
  await fs.chmod(home, 0o711);
  const original = Buffer.from(JSON.stringify({ auth_mode: 'chatgpt', tokens: {
    account_id: 'fixture', access_token: 'access', refresh_token: 'refresh', id_token: 'identity',
  } }));
  const rotated = Buffer.from(original.toString().replace('"refresh"', '"rotated"'));
  const authPath = path.join(home, 'auth.json');
  await fs.writeFile(authPath, original, { mode: 0o600 });
  await fs.writeFile(path.join(role, claim.slotId + '.json'), JSON.stringify({ ...claim,
    sourceSha256: chiefWebRealDigest(original) }), { mode: 0o600 });
  assert.equal(await preserveChiefWebRealRotatedAuth({ credentialHome: home, original, current: original }), false);
  assert.equal(await preserveChiefWebRealRotatedAuth({ credentialHome: home, original, current: rotated }), true);
  const receipt = { ...claim, physicalCalls: 1, status: 'unknown', code: 'CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED' };
  let container = 'active';
  const args = { credentialSlot: slot, identity, claim, receipt, invokeDocker: input => {
    assert.ok(input.includes('label=io.super-agent.chief-model-slot=' + identity.slotId));
    return { stdout: container };
  } };
  assert.equal(await retireChiefWebRealCredentialCopy({ ...args, receipt: { ...receipt, physicalCalls: 0 } }), false);
  assert.equal(await retireChiefWebRealCredentialCopy(args), false);
  assert.deepEqual(await fs.readFile(authPath), original);
  container = '';
  assert.equal(await retireChiefWebRealCredentialCopy(args), true);
  await assert.rejects(fs.stat(authPath), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(home, 'rotated-auth.json')), rotated);
  assert.equal(await retireChiefWebRealCredentialCopy(args), true);
});
