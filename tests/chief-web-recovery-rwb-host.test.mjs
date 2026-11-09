import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createChiefWebRecoveryRwbHost, loadChiefWebRecoveryRwbTool, runChiefWebRecoveryHostPublication } from '../bridge/chief-web-recovery-rwb-host.mjs';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';

const { taskId, repository, pullRequest, previousHead, path } = CHIEF_WEB_PILOT;
const deliveryTaskId = 'super-agent-' + taskId;
const branch = 'codex/integrate-' + deliveryTaskId;
const prUrl = 'https://github.com/' + repository + '/pull/' + pullRequest;
const projectRoot = '/fixture/rwb';
const worktreeRoot = '/fixture/worktree';
const candidateSha = 'a'.repeat(40);
const baseCommit = 'b'.repeat(40);
const prefix = 'repos/' + repository;
const receipt = {
  taskId: deliveryTaskId, repositoryRoot: projectRoot, status: 'prepared', mode: 'pr',
  integrationBranch: branch, integrationCommit: candidateSha, integrationWorktree: worktreeRoot + '/one',
  baseCommit, baseRefreshPublishedHead: previousHead, pullRequest: { url: prUrl },
  remote: 'origin', remoteUrl: 'git@github.com:' + repository + '.git', defaultBranch: 'master',
};
const bytes = Buffer.from(JSON.stringify(receipt));
const confirmationOperationId = '4'.repeat(64);
const scope = Object.freeze({
  taskId, repository, pullRequest, previousHead, path, branch, candidateSha, baseCommit, expiresAt: 100,
  scopeDigest: '1'.repeat(64), leaseDigest: '2'.repeat(64), inputRevision: '3'.repeat(64),
  grantId: '00000000-0000-0000-0000-000000000001', conversationId: '00000000-0000-0000-0000-000000000002', generation: 0,
  confirmationOperationId, reviewDigest: '5'.repeat(64),
  operationId: createHash('sha256').update(JSON.stringify([confirmationOperationId, 'publish'])).digest('hex'),
  deliveryReceiptDigest: createHash('sha256').update(bytes).digest('hex'),
});

function setup(options = {}) {
  let head = previousHead;
  let base = baseCommit;
  let held = false;
  let publication;
  let managedReceipt;
  let readCount = 0;
  const calls = [];
  const deniedCommands = [
    ['gh', ['pr', 'create'], { cwd: projectRoot }],
    ['gh', ['pr', 'merge', prUrl], { cwd: projectRoot }],
    ['gh', ['api', prefix, '--method', 'PATCH'], { cwd: projectRoot }],
    ['gh', ['api', 'repos/other/foreign'], { cwd: projectRoot }],
    ['git', ['push'], { cwd: projectRoot }],
    ['gh', ['api', prefix], { cwd: worktreeRoot }],
  ];
  const flags = {
    exclusive: true, sameRepo: true, autoMerge: false, ...options,
  };
  const host = createChiefWebRecoveryRwbHost({
    projectRoot, worktreeRoot, now: () => flags.timestamp ?? 10,
    readPrepared: () => ({
      ...scope, verified: true, clean: true, descendsFromBase: true, descendsFromPreviousHead: true,
      drained: true, pauseFenceClear: true, changedPaths: [path],
      verification: {
        status: 'passed', candidateSha, command: 'fixed local verification', durationSeconds: 1,
        checks: ['documentation-governance', 'project-constraints', 'python-file-index']
          .map(name => ({ name, exitCode: 0, durationMs: 1 })),
      },
      ...flags.prepared,
    }),
    withPublicationFence: async (_request, callback) => {
      assert.equal(held, false);
      held = true;
      try {
        return await callback(() => ({ ...scope, verified: true, exclusive: flags.exclusive,
          drained: true, pauseFenceClear: flags.pauseFenceClear ?? true }));
      } finally {
        held = false;
      }
    },
    readDeliveryReceipt: () => ({ bytes: flags.receipt ??
      (managedReceipt && !flags.hideManagedReceipt ? Buffer.from(JSON.stringify(managedReceipt)) : bytes) }),
    readPublicationReceipt: () => publication,
    readCiEvidence: (_scope, eventId) => ({ eventId }),
    async runDelivery(input, { identityRoot, githubRunner }) {
      assert.equal(held, true);
      calls.push(input.action);
      assert.equal(identityRoot, projectRoot);
      assert.equal(input.taskId, deliveryTaskId);
      assert.equal(input.projectRoot, projectRoot);
      assert.equal(input.repair, undefined);
      assert.deepEqual(input.verification, { status: 'passed', command: 'fixed local verification', durationSeconds: 1 });
      for (const denied of deniedCommands) {
        assert.throws(() => githubRunner(...denied), { code: 'CHIEF_WEB_RECOVERY_RWB_COMMAND_DENIED' });
      }
      if (flags.driftInsidePublisher) base = 'e'.repeat(40);
      if (flags.pauseInsidePublisher) flags.pauseFenceClear = false;
      assert.equal(JSON.parse(githubRunner('gh', ['api', prefix], { cwd: projectRoot }).stdout).allow_auto_merge, false);
      const quota = githubRunner('gh', ['repo', 'view', '--json', 'visibility,nameWithOwner'], { cwd: projectRoot });
      assert.deepEqual(JSON.parse(quota.stdout), { visibility: 'PUBLIC', nameWithOwner: repository });
      const actions = githubRunner('gh', ['run', 'list', '--repo', repository, '--limit', '20', '--json', 'status,conclusion'], { cwd: projectRoot });
      assert.equal(JSON.parse(actions.stdout)[0].conclusion, 'success');
      head = flags.wrongPublishedHead ?? candidateSha;
      const publishedReceipt = { ...receipt, status: 'awaiting_ci', baseRefreshPublishedHead: candidateSha,
        safetyAutoMergeDeferred: true, ...flags.result };
      if (!flags.responseLost || flags.persistResultOnLoss) {
        managedReceipt = { ...publishedReceipt, verification: { status: 'passed',
          recordedAt: new Date(flags.recordedAt ?? 10).toISOString() }, ci: { status: 'pending' } };
      }
      if (flags.expireDuringPublish) flags.timestamp = 1001;
      if (flags.pauseDuringPublish) flags.pauseFenceClear = false;
      if (flags.responseLost) throw new Error('lost RWB response');
      return publishedReceipt;
    },
    ghGet(target, operation) {
      assert.deepEqual(operation, { method: 'GET' });
      readCount++;
      if (target === prefix) {
        return { full_name: repository, default_branch: 'master', private: false, allow_auto_merge: flags.autoMerge };
      }
      if (target === prefix + '/pulls/' + pullRequest) {
        return { number: pullRequest, html_url: prUrl, state: 'open', auto_merge: null, merged: false,
          head: { sha: head, ref: branch, repo: { full_name: flags.sameRepo ? repository : 'elsewhere/rwb' } },
          base: { sha: '0'.repeat(40), ref: 'master', repo: { full_name: repository } } };
      }
      if (target === prefix + '/git/ref/heads/' + branch) return { ref: 'refs/heads/' + branch, object: { type: 'commit', sha: head } };
      if (target === prefix + '/git/ref/heads/master') return { ref: 'refs/heads/master', object: { type: 'commit', sha: base } };
      if (target === prefix + '/actions/runs?per_page=20') return { workflow_runs: [{ status: 'completed', conclusion: 'success' }] };
      assert.fail('unexpected network request');
    },
    recordPublication(value) {
      if (publication) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      publication = value;
    },
    async log({ code }) { assert.match(code, /^CHIEF_WEB_RECOVERY_RWB_[A-Z_]+$/); },
  });
  return { host, calls, getReadCount: () => readCount, showManagedReceipt: () => { flags.hideManagedReceipt = false; } };
}

test('publishes only the prepared existing RWB branch and records a scoped proof', async () => {
  const { host, calls } = setup();
  assert.equal(host.readRemote(scope).headSha, previousHead);
  const published = await host.publishExisting(scope);
  assert.deepEqual(calls, ['publish']);
  assert.equal(published.updatedExisting, true);
  assert.equal(published.safetyAutoMergeDeferred, true);
  assert.equal(published.operationId, scope.operationId);
  assert.equal(published.candidateSha, candidateSha);
  assert.match(published.receiptDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(host.readPublicationReceipt(scope), published);
  assert.equal(host.readRemote(scope).headSha, candidateSha);
  await assert.rejects(host.publishExisting(scope), { code: 'CHIEF_WEB_RECOVERY_RWB_REMOTE_PR_CHANGED' });
  assert.deepEqual(calls, ['publish']);
});

test('blocks wrong task, branch, PR, remote fork, auto-merge, receipt and insufficient review before publish', async () => {
  for (const drift of [{ taskId: 'wrong' }, { branch: branch + '-r1' }, { pullRequest: 262 }, { path: 'README.md' }]) {
    const { host, calls, getReadCount } = setup();
    await assert.rejects(host.publishExisting({ ...scope, ...drift }), { code: 'CHIEF_WEB_RECOVERY_RWB_SCOPE_DENIED' });
    assert.equal(getReadCount(), 0);
    assert.deepEqual(calls, []);
  }
  for (const [options, code] of [
    [{ sameRepo: false }, 'REMOTE_PR_CHANGED'],
    [{ autoMerge: true }, 'REPOSITORY_CHANGED'],
    [{ receipt: Buffer.from('{}') }, 'DELIVERY_RECEIPT_CHANGED'],
    [{ prepared: { changedPaths: [path, 'README.md'] } }, 'PREPARED_EVIDENCE_DENIED'],
    [{ prepared: { verification: { status: 'passed' } } }, 'VERIFICATION_UNPROVEN'],
    [{ prepared: { reviewDigest: '0'.repeat(64) } }, 'PREPARED_EVIDENCE_DENIED'],
    [{ timestamp: scope.expiresAt }, 'FENCE_DENIED'],
    [{ exclusive: false }, 'FENCE_DENIED'],
  ]) {
    const { host, calls } = setup(options);
    await assert.rejects(host.publishExisting(scope), { code: 'CHIEF_WEB_RECOVERY_RWB_' + code });
    assert.deepEqual(calls, []);
  }
});

test('rechecks the branch and the pause fence inside the publisher and refuses unproven results', async () => {
  for (const [options, code] of [
    [{ driftInsidePublisher: true }, 'REMOTE_PR_CHANGED'],
    [{ pauseInsidePublisher: true }, 'FENCE_DENIED'],
    [{ result: { safetyAutoMergeDeferred: false } }, 'PUBLICATION_UNPROVEN'],
    [{ result: { updatedExisting: false } }, 'PUBLICATION_UNPROVEN'],
    [{ wrongPublishedHead: 'f'.repeat(40) }, 'PUBLICATION_UNPROVEN'],
  ]) {
    const { host, calls } = setup(options);
    await assert.rejects(host.publishExisting(scope), { code: 'CHIEF_WEB_RECOVERY_RWB_' + code });
    assert.deepEqual(calls, ['publish']);
    assert.equal(host.readPublicationReceipt(scope), undefined);
  }
});

test('lost response produces no success receipt and a moved head cannot trigger a second update', async () => {
  const { host, calls } = setup({ responseLost: true });
  await assert.rejects(host.publishExisting(scope), { message: 'lost RWB response' });
  assert.equal(host.readRemote(scope).headSha, candidateSha);
  assert.equal(host.readPublicationReceipt(scope), undefined);
  await assert.rejects(host.publishExisting(scope), { code: 'CHIEF_WEB_RECOVERY_RWB_REMOTE_PR_CHANGED' });
  assert.deepEqual(calls, ['publish']);
});

test('the tool loader refuses a relative or unverified bundle', async () => {
  await assert.rejects(loadChiefWebRecoveryRwbTool({ toolRoot: '.' }), { code: 'CHIEF_WEB_RECOVERY_RWB_TOOL_UNVERIFIED' });
});

function operator(options) {
  const { host, calls, showManagedReceipt } = setup(options);
  const request = { schemaVersion: 1, action: 'publish_existing_pr', scope };
  const files = new Map([['request.json', request]]);
  const journal = {
    async read(id, filename) {
      assert.equal(id, confirmationOperationId);
      return files.get(filename) ?? null;
    },
    async createExclusive(id, filename, value) {
      assert.equal(id, confirmationOperationId);
      assert.equal(filename, 'host-dispatch.json');
      if (files.has(filename)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      files.set(filename, value);
    },
  };
  const ports = { journal, host, log: () => {}, now: () => 10 };
  return { ports, files, request, calls, showManagedReceipt,
    run: () => runChiefWebRecoveryHostPublication(confirmationOperationId, ports) };
}

test('concurrent operators durably claim the immutable request once and replay only the receipt', async () => {
  const { run, ports, calls, files } = operator();
  const attempts = await Promise.all([run(), run()]);
  assert.ok(attempts.some(result => result.status === 'published'));
  assert.deepEqual(calls, ['publish']);
  assert.equal(files.get('host-dispatch.json').operationId, scope.operationId);
  const replay = await runChiefWebRecoveryHostPublication(confirmationOperationId, { ...ports, now: () => 1000 });
  assert.equal(replay.status, 'published');
  assert.equal(replay.evidenceDigest, (await ports.host.readPublicationReceipt(scope)).receiptDigest);
  assert.deepEqual(calls, ['publish']);
});

test('a lost result leaves a claim and cannot be dispatched again', async () => {
  const { run, files, calls } = operator({ responseLost: true });
  assert.equal((await run()).status, 'unknown');
  assert.equal((await run()).status, 'unknown');
  assert.ok(files.has('host-dispatch.json'));
  assert.deepEqual(calls, ['publish']);
});

test('records an observed push when the window expires or pause arrives after dispatch', async () => {
  const { run, calls } = operator({ expireDuringPublish: true, pauseDuringPublish: true });
  assert.equal((await run()).status, 'published');
  assert.equal((await run()).status, 'published');
  assert.deepEqual(calls, ['publish']);
});

test('reconciles a lost reply from fresh remote head and the exact managed receipt', async () => {
  const { run, ports, calls, showManagedReceipt } = operator({
    responseLost: true, persistResultOnLoss: true, hideManagedReceipt: true, expireDuringPublish: true,
  });
  assert.equal((await run()).status, 'unknown');
  showManagedReceipt();
  const replay = await runChiefWebRecoveryHostPublication(confirmationOperationId, { ...ports, now: () => 1000 });
  assert.equal(replay.status, 'published');
  assert.equal((await ports.host.readPublicationReceipt(scope)).receiptDigest, replay.evidenceDigest);
  assert.deepEqual(calls, ['publish']);
});

test('an exact remote candidate alone or a historical managed receipt cannot settle a claim', async () => {
  const { run, calls } = operator({ responseLost: true, persistResultOnLoss: true, recordedAt: 9 });
  assert.equal((await run()).status, 'unknown');
  assert.equal((await run()).status, 'unknown');
  assert.deepEqual(calls, ['publish']);
});

test('rejects an unrelated operation ID and a changed request under an existing claim', async () => {
  const { run, request, files, calls } = operator({ responseLost: true });
  files.set('request.json', { ...request, scope: { ...scope, operationId: '0'.repeat(64) } });
  await assert.rejects(run(), { code: 'CHIEF_WEB_RECOVERY_RWB_REQUEST_INVALID' });
  assert.equal(files.has('host-dispatch.json'), false);
  files.set('request.json', request);
  await run();
  files.set('request.json', { ...request, scope: { ...scope, inputRevision: '0'.repeat(64) } });
  await assert.rejects(run(), { code: 'CHIEF_WEB_RECOVERY_RWB_DISPATCH_CLAIM_CHANGED' });
  assert.deepEqual(calls, ['publish']);
});
