import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChiefWebRealEngine, REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY, REAL_CI_TRANSPORT_UNKNOWN, realDigest, resolveChiefWebRealScope } from '../bridge/chief-web-real-engine.mjs';

const conversationId = randomUUID();
const taskId = randomUUID();
const firstHead = 'a'.repeat(40);
const secondHead = 'b'.repeat(40);
const baseSha = 'c'.repeat(40);
const branch = 'codex/integrate-super-agent-' + taskId;
const receiptDigest = 'e'.repeat(64);
const singleImage = 'docs/super-agent/chief-single-image-verification.md';
const packagedDoc = 'docs/super-agent/chief-browser-acceptance.md';
const pilotPaths = ['intake', 'recovery', 'status'].map(name => 'docs/super-agent/chief-resident-' + name + '.md');

function setup({ scope = {}, firstCiSucceeds = false, chiefTarget, factory = createChiefWebRealEngine } = {}) {
  const calls = [], publications = [], records = [], messages = [], statuses = [];
  let issued = 0, staleCi = true, clock = 100;
  let respondToReview = true, failDeveloper = false, recoverDeveloper = false;
  const repository = {
    async readOwnerMessages() { return structuredClone(messages); },
    async transaction(work) {
      return work({
        readState: () => structuredClone(records.at(-1)),
        createTask() { issued++; return { id: taskId, identifier: 'CHI-2' }; },
        setTask({ status }) { statuses.push(status); },
        appendState(state) { records.push(structuredClone(state)); },
      });
    },
  };
  const receipt = (request, result) => ({
    status: 'completed', taskId: request.taskId, operationId: request.operationId,
    inputRevision: request.inputRevision, evidenceDigest: receiptDigest, result,
  });
  const models = request => {
    if (request.role === 'chief') return receipt(request, { accepted: true, targetDoc: chiefTarget ?? request.targetDoc, requirements: request.text });
    if (request.role === 'developer') {
      if (failDeveloper && !recoverDeveloper) return { status: 'unknown', code: 'CHIEF_WEB_REAL_EXECUTION_UNKNOWN' };
      return { ...receipt(request, { candidateSha: request.revision === 1 ? firstHead : secondHead, baseSha, branch, checksPassed: true }), ...(recoverDeveloper && { recoveryVerified: true }) };
    }
    return respondToReview ? receipt(request, { approved: true, candidateSha: request.candidateSha, reviewDigest: receiptDigest }) :
      { status: 'pending' };
  };
  const config = { conversationId, generation: 0, expiresAt: 9_000_000, ...scope };
  let failPublication = false, recoverPublication = false;
  let ciObservation;
  const publishReceipt = request => receipt(request, { headSha: request.candidateSha, baseSha, branch, number: 123,
    url: 'https://github.com/' + REAL_RWB_REPOSITORY + '/pull/123' });
  const publisher = {
    async publish(request) {
      publications.push(request);
      return failPublication ? { status: 'unknown', code: 'RWB_REAL_PUBLICATION_UNKNOWN' } : publishReceipt(request);
    },
    async observePublication(request) {
      if (!failPublication) assert.fail('unrequested publication replay');
      return recoverPublication ? { ...publishReceipt(request), recoveryVerified: true } :
        { status: 'unknown', code: 'RWB_REAL_PUBLICATION_UNKNOWN' };
    },
    async readCi(request) {
      if (ciObservation) return ciObservation(request, result => receipt(request, result));
      if (request.revision === 1) return firstCiSucceeds
        ? receipt(request, { number: 123, headSha: firstHead, conclusion: 'success', checksDigest: receiptDigest })
        : { status: 'pending' };
      return receipt(request, { number: 123, headSha: staleCi ? firstHead : secondHead, conclusion: 'success',
        checksDigest: receiptDigest });
    },
  };
  const engine = () => factory({
    repository, config, publisher, log: async () => {}, now: () => clock,
    executor: {
      async execute(request) { calls.push(request); return models(request); },
      async observe(request) { return models(request); },
    },
  });
  return { engine, records, messages, calls, publications, statuses, issued: () => issued,
    newMessage: text => messages.push({ id: randomUUID(), text, generation: 0 }),
    advanceClock: value => { clock += value; }, answerReview: value => { respondToReview = value; },
    correctCi: () => { staleCi = false; },
    setCiObservation: observe => { ciObservation = observe; },
    failDev: () => { failDeveloper = true; }, recoverDev: () => { recoverDeveloper = true; },
    failPublish: () => { failPublication = true; }, recoverPublish: () => { recoverPublication = true; },
  };
}

async function until(engine, phase) {
  for (let i = 0; i < 10; i++) {
    const state = await engine.status();
    if (state.phase === phase) return state;
    await engine.tick();
  }
  assert.equal((await engine.status()).phase, phase);
}

function command(state, action) {
  return { requestId: randomUUID(), generation: 0, expectedRevision: state.contextRevision, action };
}

function approval(state) {
  return { ...command(state, 'confirm'), candidateSha: state.candidateSha, reviewDigest: state.reviewDigest,
    baseSha: state.baseSha, previousHead: state.previousHead };
}

test('two owner inputs retain one Native task and PR across a restart and ignore stale CI', async () => {
  const f = setup();
  const live = f.engine();
  f.newMessage('请新建真实验收说明');
  const first = await until(live, 'awaiting_confirmation');
  const confirmed = approval(first);
  await assert.rejects(live.control({ ...confirmed, baseSha: 'd'.repeat(40) }), { code: 'CHIEF_WEB_REAL_CONFIRMATION_STALE' });
  await live.control(confirmed);
  await live.control(confirmed);
  await until(live, 'waiting_ci');
  await live.tick();
  f.newMessage('追加发布回执丢失时的核对步骤');
  const second = await until(live, 'awaiting_confirmation');
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.pr.headSha, firstHead);
  assert.equal(second.previousHead, firstHead);
  assert.equal(second.revision, 2);
  await live.control(approval(second));
  await until(live, 'waiting_ci');
  const restarted = f.engine();
  await restarted.tick();
  assert.equal((await restarted.status()).phase, 'waiting_ci');
  f.correctCi();
  const final = await until(restarted, 'done');
  assert.equal(final.ci.headSha, secondHead);
  assert.equal(final.pr.number, 123);
  assert.equal(final.pr.branch, branch);
  assert.equal(f.issued(), 1);
  assert.equal(f.calls.length, 6);
  assert.equal(f.publications.length, 2);
  assert.equal(new Set(f.calls.map(call => call.slotId)).size, 6);
  assert.equal(f.statuses.at(-1), 'done');
});

async function loadScopedEngine(targetDoc) {
  const key = 'SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT';
  const previous = process.env[key];
  process.env[key] = targetDoc;
  try {
    const { createChiefWebRealEngine: factory } = await import('../bridge/chief-web-real-engine.mjs?target=' + encodeURIComponent(targetDoc));
    return factory;
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('the finite allowlist binds the two original paths, Stage2, and the three one-input pilot paths', () => {
  assert.deepEqual(resolveChiefWebRealScope(), { targetDoc: REAL_RWB_DOCUMENT, maxRevisions: 2 });
  for (const targetDoc of [singleImage, packagedDoc]) {
    assert.deepEqual(resolveChiefWebRealScope({ targetDoc }), { targetDoc, maxRevisions: 2 });
  }
  for (const targetDoc of pilotPaths) {
    assert.deepEqual(resolveChiefWebRealScope({ targetDoc, maxRevisions: 1 }), { targetDoc, maxRevisions: 1 });
    assert.throws(() => resolveChiefWebRealScope({ targetDoc }), { code: 'CHIEF_WEB_REAL_SCOPE_CONFIGURATION_INVALID' });
  }
  for (const targetDoc of [REAL_RWB_DOCUMENT, singleImage, 'docs/super-agent/chief-resident-extra.md']) {
    assert.throws(() => resolveChiefWebRealScope({ targetDoc, maxRevisions: 1 }), { code: 'CHIEF_WEB_REAL_SCOPE_CONFIGURATION_INVALID' });
  }
});

test('resident pilot ends after exact first-head CI and leaves extra messages untouched', async () => {
  const [targetDoc] = pilotPaths;
  const fixture = setup({ scope: { targetDoc, maxRevisions: 1 }, firstCiSucceeds: true, factory: await loadScopedEngine(targetDoc) });
  const engine = fixture.engine();
  fixture.newMessage('请验证驻留入口');
  const first = await until(engine, 'awaiting_confirmation');
  assert.equal(first.targetDoc, targetDoc);
  assert.equal(first.maxRevisions, 1);
  assert.equal(first.inputRevision, realDigest([conversationId, 0, [fixture.messages[0].id], realDigest(fixture.messages[0].text), targetDoc]));
  await engine.control(approval(first));
  await until(engine, 'waiting_ci');
  fixture.newMessage('这条超出本试点的输入次数');
  const done = await until(fixture.engine(), 'done');
  assert.equal(done.revision, 1);
  assert.equal(done.ci.headSha, firstHead);
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.publications.length, 1);
  assert.ok([...fixture.calls, ...fixture.publications].every(request => request.targetDoc === targetDoc));
  assert.equal(fixture.issued(), 1);
  assert.equal(fixture.statuses.at(-1), 'done');
  fixture.records.at(-1).targetDoc = pilotPaths[1];
  await assert.rejects(fixture.engine().status(), { code: 'CHIEF_WEB_REAL_SCOPE_CHANGED' });
});

test('both historical state formats retain their original input hashes and approval on reopening', async () => {
  for (const targetDoc of [REAL_RWB_DOCUMENT, packagedDoc]) {
    const fixture = setup({ scope: { targetDoc }, factory: await loadScopedEngine(targetDoc) });
    const engine = fixture.engine();
    fixture.newMessage('请创建历史验证说明');
    const candidate = await until(engine, 'awaiting_confirmation');
    const fields = [conversationId, 0, [fixture.messages[0].id], realDigest(fixture.messages[0].text)];
    if (targetDoc === packagedDoc) fields.push(targetDoc);
    assert.equal(candidate.inputRevision, realDigest(fields));
    if (targetDoc === REAL_RWB_DOCUMENT) delete fixture.records.at(-1).targetDoc;
    delete fixture.records.at(-1).maxRevisions;
    const restarted = fixture.engine();
    assert.deepEqual(await restarted.status(), candidate);
    await restarted.control(approval(candidate));
    await until(restarted, 'waiting_ci');
    assert.equal(fixture.publications[0].inputRevision, candidate.inputRevision);
    assert.equal(fixture.calls.length, 3);
  }
});

test('same-image rehearsal retains two revisions and refuses a Chief result for another doc', async () => {
  const factory = await loadScopedEngine(singleImage);
  const scope = { targetDoc: singleImage };
  const fixture = setup({ scope, firstCiSucceeds: true, factory });
  const engine = fixture.engine();
  fixture.newMessage('请新建同镜像说明');
  await engine.control(approval(await until(engine, 'awaiting_confirmation')));
  assert.equal((await until(engine, 'awaiting_supplement')).revision, 1);
  fixture.newMessage('请补充同镜像验证');
  assert.equal((await until(engine, 'awaiting_confirmation')).revision, 2);
  assert.ok(fixture.calls.every(request => request.targetDoc === singleImage));

  const mismatch = setup({ scope, chiefTarget: REAL_RWB_DOCUMENT, factory });
  mismatch.newMessage('请修改另一个文档');
  assert.equal((await until(mismatch.engine(), 'blocked')).code, 'CHIEF_WEB_REAL_INTENT_DENIED');
  assert.equal(mismatch.issued(), 0);
});

test('resident spool admits only the exact private binding and first revision', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import os from 'node:os';
    import { randomUUID } from 'node:crypto';
    import { createChiefWebRealSpool } from './bridge/chief-web-real-spool.mjs';
    import { REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY } from './bridge/chief-web-real-engine.mjs';
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-real-resident-'));
    try {
      const config = { conversationId: randomUUID(), generation: 0, expiresAt: 30000, targetDoc: REAL_RWB_DOCUMENT, maxRevisions: 1 };
      const id = randomUUID();
      const request = { conversationId: config.conversationId, generation: 0, taskId: randomUUID(), inputRevision: 'a'.repeat(64),
        operationId: id, slotId: id, repository: REAL_RWB_REPOSITORY, targetDoc: REAL_RWB_DOCUMENT, revision: 1, role: 'developer' };
      const options = { root, config, log: () => {}, now: () => 100 };
      const spool = await createChiefWebRealSpool(options);
      assert.equal((await spool.executor.execute(request)).status, 'pending');
      for (const change of [{ revision: 2 }, { targetDoc: 'docs/super-agent/chief-resident-status.md' }, { conversationId: randomUUID() }]) {
        await assert.rejects(spool.executor.execute({ ...request, ...change }), { code: 'CHIEF_WEB_REAL_SPOOL_SCOPE_DENIED' });
      }
      await assert.rejects(createChiefWebRealSpool({ ...options, config: { ...config, targetDoc: 'docs/super-agent/chief-resident-status.md' } }),
        { code: 'CHIEF_WEB_REAL_DOCUMENT_BINDING_MISMATCH' });
      assert.deepEqual(await spool.list(), [id]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT: pilotPaths[1] }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('pause before dispatch revokes approval and repeated operation has one effect', async () => {
  const f = setup();
  const engine = f.engine();
  f.newMessage('创建验收文档');
  await engine.control(command(await engine.status(), 'pause'));
  await engine.tick();
  assert.equal(f.calls.length, 0);
  await engine.control(command(await engine.status(), 'resume'));
  const candidate = await until(engine, 'awaiting_confirmation');
  await engine.control(approval(candidate));
  await engine.control(command(await engine.status(), 'pause'));
  await engine.tick();
  assert.equal(f.publications.length, 0);
  assert.equal((await engine.status()).phase, 'awaiting_confirmation');
});

test('expiry discards an unlaunched approval without publishing', async () => {
  const f = setup();
  const engine = f.engine();
  f.newMessage('创建验收文档');
  const candidate = await until(engine, 'awaiting_confirmation');
  await engine.control(approval(candidate));
  f.advanceClock(15 * 60_000);
  await engine.tick();
  assert.equal(f.publications.length, 0);
  assert.equal((await engine.status()).code, 'CHIEF_WEB_REAL_CONFIRMATION_EXPIRED');
});

test('restart observes an already reserved review without a new model call', async () => {
  const f = setup();
  f.answerReview(false);
  const engine = f.engine();
  f.newMessage('创建验收文档');
  await until(engine, 'reviewing');
  await engine.tick();
  assert.equal(f.calls.length, 3);
  const op = (await engine.status()).operationId;
  assert.ok(op);
  const resumed = f.engine();
  f.answerReview(true);
  await until(resumed, 'awaiting_confirmation');
  assert.equal(f.calls.length, 3);
  assert.equal(f.records.at(-1).results.at(-1).operationId, op);
});

test('prelaunch recovery preserves the blocked original Native attempt', async () => {
  const f = setup();
  f.failDev();
  const original = f.engine();
  f.newMessage('创建验收文档');
  const blocked = await until(original, 'blocked');
  assert.equal(blocked.operationKind, 'developer');
  await original.tick();
  assert.equal((await original.status()).phase, 'blocked');
  f.recoverDev();
  const resumed = f.engine();
  const candidate = await until(resumed, 'awaiting_confirmation');
  assert.equal(candidate.taskId, blocked.taskId);
  assert.equal(candidate.inputRevision, blocked.inputRevision);
  assert.equal(f.issued(), 1);
  assert.equal(f.calls.filter(call => call.role === 'developer').length, 1);
  assert.equal(f.records.at(-1).recoveredOperationId, blocked.operationId);
});

test('a verified CI observation recovers the original blocked attempt and exact head only', async () => {
  const f = setup();
  f.setCiObservation(() => ({ status: 'blocked', code: REAL_CI_TRANSPORT_UNKNOWN }));
  const original = f.engine();
  f.newMessage('创建验收文档');
  await original.control(approval(await until(original, 'awaiting_confirmation')));
  const blocked = await until(original, 'blocked');
  assert.equal(blocked.operationKind, 'ci');
  const recovered = f.engine();
  f.setCiObservation((_request, receipt) => ({
    ...receipt({ number: 123, headSha: secondHead, conclusion: 'success', checksDigest: receiptDigest }),
    recoveryVerified: true,
  }));
  await recovered.tick();
  assert.equal((await recovered.status()).phase, 'blocked');
  f.setCiObservation((request, receipt) => {
    assert.equal(request.operationId, blocked.operationId);
    return { ...receipt({ number: 123, headSha: firstHead, conclusion: 'success', checksDigest: receiptDigest }), recoveryVerified: true };
  });
  const done = await until(recovered, 'awaiting_supplement');
  assert.equal(done.taskId, blocked.taskId);
  assert.equal(done.inputRevision, blocked.inputRevision);
  assert.equal(f.records.at(-1).recoveredOperationId, blocked.operationId);
  assert.equal(f.publications.length, 1);
  assert.equal(f.calls.length, 3);
});

test('packaged target requires a matching private binding and remains a single allowed document', async () => {
  const { spawnSync } = await import('node:child_process');
  const configured = 'docs/super-agent/chief-browser-acceptance.md';
  const name = 'SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT';
  const probe = `
    import assert from 'node:assert/strict';
    import { REAL_RWB_DOCUMENT, assertChiefWebRealDocumentBinding } from './bridge/chief-web-real-engine.mjs';
    import { CHIEF_WEB_REAL_TARGET } from './bridge/chief-web-real-executor.mjs';
    import { chiefWebRealDockerArguments } from './scripts/chief-web-real-executor-host.mjs';
    assert.equal(REAL_RWB_DOCUMENT, process.env.${name});
    assert.equal(CHIEF_WEB_REAL_TARGET, REAL_RWB_DOCUMENT);
    assertChiefWebRealDocumentBinding({ targetDoc: REAL_RWB_DOCUMENT });
    assert.throws(() => assertChiefWebRealDocumentBinding({}), { code: 'CHIEF_WEB_REAL_DOCUMENT_BINDING_MISMATCH' });
    const args = chiefWebRealDockerArguments({ imageId: 'sha256:' + '1'.repeat(64), network: 'super-agent-test_model',
      dependenciesRoot: '/deps', logRoot: '/logs', modelSlot: '/model', credentialSlot: '/auth',
      slotId: '10000000-0000-4000-8000-000000000001' });
    assert.ok(args.includes('${name}=' + REAL_RWB_DOCUMENT));
  `;
  const run = value => spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    env: { ...process.env, [name]: value }, encoding: 'utf8',
  });
  const accepted = run(configured);
  assert.equal(accepted.status, 0, accepted.stderr);
  const denied = run('docs/super-agent/unrelated.md');
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /CHIEF_WEB_REAL_DOCUMENT_DENIED/);
});

test('publication recovery observes the original confirmation operation', async () => {
  const f = setup();
  f.failPublish();
  const original = f.engine();
  f.newMessage('创建验收文档');
  await original.control(approval(await until(original, 'awaiting_confirmation')));
  const blocked = await until(original, 'blocked');
  assert.equal(blocked.operationKind, 'publish');
  await original.tick();
  assert.equal((await original.status()).phase, 'blocked');
  f.recoverPublish();
  const recovered = await until(f.engine(), 'waiting_ci');
  assert.equal(recovered.taskId, blocked.taskId);
  assert.equal(recovered.pr.number, 123);
  assert.equal(f.records.at(-1).recoveredOperationId, blocked.operationId);
  assert.equal(f.publications.length, 1);
  assert.equal(f.calls.length, 3);
});
