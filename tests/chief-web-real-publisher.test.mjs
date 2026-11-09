import assert from 'node:assert/strict';
import test from 'node:test';
import { REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY, realDigest } from '../bridge/chief-web-real-engine.mjs';
import { chiefWebRealDeliveryIdentity, createChiefWebRealPublisher } from '../bridge/chief-web-real-publisher.mjs';
import { createChiefWebRealGitHub } from '../scripts/chief-web-real-publisher-github.mjs';

const taskId = '10000000-1000-4000-8000-100000000001';
const operationId = '20000000-2000-4000-8000-200000000001';
const confirmationId = '30000000-3000-4000-8000-300000000001';
const projectRoot = '/rwb';
const worktreeRoot = '/rwb-worktrees';
const baseSha = '1'.repeat(40);
const firstSha = '2'.repeat(40);
const secondSha = '3'.repeat(40);
const clock = Date.parse('2026-11-09T04:00:00.000Z');
const { deliveryTaskId, branch } = chiefWebRealDeliveryIdentity(taskId);
const endpoint = 'repos/' + REAL_RWB_REPOSITORY;
const number = 310;
const url = 'https://github.com/' + REAL_RWB_REPOSITORY + '/pull/' + number;
const reviewDigest = '4'.repeat(64);
const inputRevision = '5'.repeat(64);

function fixture({ revision = 1, repair = false, transportFails = false, fence = {}, addForeignPr = false,
  command = null, missingPushProof = false, attemptErrors = [], recoveryVerified = true } = {}) {
  const candidateSha = revision === 1 ? firstSha : secondSha;
  const previousHead = revision === 1 ? null : firstSha;
  let remoteHead = previousHead;
  let remoteBase = baseSha;
  let exists = revision === 2;
  let pushes = 0;
  let creates = 0;
  let attempts = 0;
  let attemptMode;
  let pushMode;
  const calls = [];
  const claims = new Map();
  const recoveryClaims = new Map();
  const logs = [];
  const named = full_name => ({ full_name });
  const pr = () => ({ number, html_url: url, state: 'open', merged: false, auto_merge: null,
    head: { ref: branch, sha: remoteHead, repo: named(REAL_RWB_REPOSITORY) },
    base: { ref: 'master', sha: remoteBase, repo: named(REAL_RWB_REPOSITORY) } });
  const check = (name, id, appId, conclusion = 'success', head = candidateSha) => ({ name, id, app: { id: appId },
    head_sha: head, status: conclusion === null ? 'in_progress' : 'completed', conclusion });
  let checkRuns = [check('Project Constraints', 1, 15368)];
  let commitStatuses = [{ context: 'Legacy', id: 2, state: 'success' }];
  let policy = { contexts: ['Project Constraints', 'Legacy'], checks: [{ context: 'Legacy', app_id: -1 },
    { context: 'Project Constraints', app_id: 15368 }] };
  const verification = { status: 'passed', candidateSha, command: 'RWB target checks', durationSeconds: 4,
    checks: ['documentation-governance', 'project-constraints', 'python-file-index'].map(name => ({ name, exitCode: 0, durationMs: 10 })) };
  let managed = { taskId: deliveryTaskId, repositoryRoot: projectRoot, integrationBranch: branch,
    integrationWorktree: worktreeRoot + '/' + deliveryTaskId + '-integration', integrationCommit: repair ? previousHead : candidateSha,
    baseCommit: baseSha, defaultBranch: 'master', remote: 'origin', remoteUrl: 'git@github.com:' + REAL_RWB_REPOSITORY + '.git',
    status: repair ? 'awaiting_ci' : 'prepared', mode: revision === 1 ? null : 'pr', pullRequest: revision === 1 ? null : { number, url },
    baseRefreshPublishedHead: revision === 1 || repair ? null : previousHead, repairAttempts: 0 };
  const github = {
    get(path) {
      calls.push(path);
      if (path === endpoint) return { full_name: REAL_RWB_REPOSITORY, default_branch: 'master', private: false, allow_auto_merge: false };
      if (path === endpoint + '/git/ref/heads/master') return { ref: 'refs/heads/master', object: { sha: remoteBase, type: 'commit' } };
      if (path === endpoint + '/git/ref/heads/' + branch) return remoteHead && { ref: 'refs/heads/' + branch,
        object: { sha: remoteHead, type: 'commit' } };
      if (path.startsWith(endpoint + '/pulls?')) return addForeignPr ? [pr(), { ...pr(), number: number + 1 }] : exists ? [pr()] : [];
      if (path === endpoint + '/pulls/' + number) return exists ? pr() : null;
      if (path === endpoint + '/actions/runs?per_page=20') return { workflow_runs: [{ status: 'completed', conclusion: 'success' }] };
      if (path.endsWith('/protection/required_status_checks')) return policy;
      if (path === endpoint + '/commits/' + candidateSha + '/check-runs?filter=latest&per_page=100') {
        return { total_count: checkRuns.length, check_runs: checkRuns };
      }
      if (path === endpoint + '/commits/' + candidateSha + '/status?per_page=100') {
        return { sha: candidateSha, total_count: commitStatuses.length, statuses: commitStatuses };
      }
      throw new Error('unexpected query');
    },
    createPullRequest(input) {
      creates++;
      assert.deepEqual([input.head, input.base, input.repository], [branch, 'master', REAL_RWB_REPOSITORY]);
      exists = true;
      return pr();
    },
  };
  const controller = {
    readDeliveryReceipt: () => managed,
    publishDelivery(input) {
      assert.equal(input.repair, repair);
      assert.equal(input.pushDefault().status, 'protected');
      pushes++;
      pushMode = attemptMode;
      remoteHead = candidateSha;
      if (transportFails) throw new Error('lost before receipt');
      if (revision === 1) {
        input.githubRunner('gh', ['pr', 'list', '--repo', REAL_RWB_REPOSITORY, '--head', branch,
          '--base', 'master', '--state', 'open', '--json', 'url,headRefOid'], { cwd: projectRoot });
        const response = input.githubRunner('gh', ['pr', 'create', '--repo', REAL_RWB_REPOSITORY,
          '--base', 'master', '--head', branch, '--title', 'merge: deliver ' + deliveryTaskId, '--body-file',
          '/private/pr-body-12345678-1234-1234-1234-123456789abc.md'], { cwd: projectRoot });
        assert.equal(response.stdout, url + '\n');
      }
      managed = { ...managed, status: 'awaiting_ci', mode: 'pr', integrationCommit: candidateSha,
        remoteCommit: baseSha, pullRequest: { number, url }, repairAttempts: repair ? 1 : 0,
        baseRefreshPublishedHead: revision === 1 || repair ? null : candidateSha,
        verification: { ...input.verification, recordedAt: new Date(clock).toISOString() }, ci: { status: 'pending' } };
      return managed;
    },
  };
  const publisher = createChiefWebRealPublisher({ projectRoot, worktreeRoot, controller, github,
    async readPrepared(scope) {
      return { ...scope, verified: true, clean: true, descendsFromBase: true, descendsFromPreviousHead: true,
        changedPaths: [REAL_RWB_DOCUMENT], verification, managedReceiptDigest: realDigest(managed), repair };
    },
    recordResources: input => ({ ...input, verified: true }),
    verifyPush: (_scope, mode) => !missingPushProof && pushes === 1 && mode === pushMode,
    verifyRecovery: () => recoveryVerified,
    withPublicationFence(scope, work, _lease, recovery) {
      attemptMode = recovery ? 'recovery' : 'initial';
      return work(() => ({ ...scope, verified: true, exclusive: true, drained: true, pauseFenceClear: true, ...fence }));
    },
    async runDelivery(input, options) {
      assert.equal(input.action, 'publish');
      if (attemptMode === 'recovery') assert.ok(recoveryClaims.has(operationId));
      const error = attemptErrors[attempts++];
      if (error) throw Object.assign(new Error(error), { code: error });
      if (command) options.githubRunner('gh', command, { cwd: projectRoot });
      options.resourceRevalidationProbe({ repositoryRoot: projectRoot }, deliveryTaskId, 'record');
      options.githubRunner('gh', ['api', endpoint], { cwd: projectRoot });
      return { ...options.controller.publishDelivery({ projectRoot, taskId: deliveryTaskId, verification: input.verification,
        repair: input.repair, githubRunner: options.githubRunner }), safetyAutoMergeDeferred: true };
    },
    journal: {
      read: async id => claims.get(id) ?? null,
      async createExclusive(id, claim) {
        if (claims.has(id)) throw Object.assign(new Error(), { code: 'EEXIST' });
        claims.set(id, claim);
      },
      readRecovery: async id => recoveryClaims.get(id) ?? null,
      async createRecoveryExclusive(id, claim) {
        if (recoveryClaims.has(id)) throw Object.assign(new Error(), { code: 'EEXIST' });
        recoveryClaims.set(id, claim);
      },
    },
    now: () => clock,
    log: async row => { logs.push(row); },
  });
  const request = { role: 'publish', taskId, operationId, revision, inputRevision, branch, candidateSha, baseSha, previousHead,
    repository: REAL_RWB_REPOSITORY, targetDoc: REAL_RWB_DOCUMENT, reviewDigest,
    pr: revision === 1 ? null : { number, url, branch, headSha: previousHead, baseSha },
    confirmation: { requestId: confirmationId, expiresAt: clock + 5000, candidateSha, baseSha, reviewDigest, previousHead } };
  const lease = { taskId, inputRevision, projectId: '40000000-4000-4000-8000-400000000001', nonce: '6'.repeat(64) };
  return { publisher, request, calls, check, logs, lease, claims, recoveryClaims, attempts: () => attempts,
    recovery: () => ({ schemaVersion: 1, action: 'recover_pre_push_lock_denial', taskId, operationId, inputRevision,
      branch, candidateSha, baseSha, previousHead: null, reviewDigest, confirmationId,
      originalClaimDigest: realDigest(claims.get(operationId) ?? null), managedReceiptDigest: realDigest(managed),
      originalHookPolicyDigest: '7'.repeat(64), evidenceDigest: '8'.repeat(64),
      leaseDigest: realDigest([taskId, lease.projectId, inputRevision, lease.nonce]) }),
    state: () => ({ pushes, creates }), setRemoteBase: base => { remoteBase = base; },
    setRemoteHead: head => { remoteHead = head; }, setChecks: values => { checkRuns = values; },
    setStatuses: values => { commitStatuses = values; }, setPolicy: value => { policy = value; },
    ci: () => ({ ...request, role: 'ci', confirmation: null, headSha: candidateSha,
      pr: { number, url, branch, headSha: candidateSha, baseSha } }) };
}

test('publishes and reconciles the same PR across first and updated branches', async () => {
  for (const options of [{}, { revision: 2 }, { revision: 2, repair: true }]) {
    const { publisher, request, state } = fixture(options);
    const published = await publisher.publish(request);
    assert.equal(published.status, 'completed');
    assert.deepEqual(published.result, { number, url, branch, headSha: request.candidateSha, baseSha });
    assert.deepEqual(await publisher.observePublication(request), published);
    assert.deepEqual(await publisher.publish(request), published);
    assert.deepEqual(state(), { pushes: 1, creates: options.revision === 2 ? 0 : 1 });
  }
});

test('fails closed for moved remote base, denied fence, ambiguous PR and an injected merge command', async () => {
  const moved = fixture();
  moved.setRemoteBase('7'.repeat(40));
  assert.equal((await moved.publisher.publish(moved.request)).code, 'RWB_REAL_REMOTE_BASE_CHANGED');
  for (const options of [{ fence: { pauseFenceClear: false } }, { revision: 2, addForeignPr: true }]) {
    const { publisher, request, state } = fixture(options);
    assert.equal((await publisher.publish(request)).status, 'blocked');
    assert.deepEqual(state(), { pushes: 0, creates: 0 });
  }
  const denied = fixture({ command: ['pr', 'merge', '--auto', url] });
  assert.equal((await denied.publisher.publish(denied.request)).status, 'unknown');
  assert.deepEqual(denied.state(), { pushes: 0, creates: 0 });
});

test('partial branch push remains unknown and cannot dispatch again', async () => {
  const { publisher, request, state } = fixture({ transportFails: true });
  assert.equal((await publisher.publish(request)).status, 'unknown');
  assert.equal((await publisher.observePublication(request)).status, 'unknown');
  assert.equal((await publisher.publish(request)).status, 'unknown');
  assert.deepEqual(state(), { pushes: 1, creates: 0 });
});

test('operator-attested pre-push recovery retains the original claim and uses a single separate marker and push proof', async () => {
  const sample = fixture({ attemptErrors: ['REPOSITORY_LOCKED'] });
  const { publisher, request, lease } = sample;
  assert.equal((await publisher.publish(request)).status, 'unknown');
  assert.equal(sample.logs.find(row => row.preflightCode)?.preflightCode, 'REPOSITORY_LOCKED');
  assert.deepEqual(sample.state(), { pushes: 0, creates: 0 });
  const original = structuredClone(sample.claims.get(operationId));
  const recovery = sample.recovery();
  assert.equal((await publisher.publish(request)).status, 'unknown');
  const result = await publisher.publish(request, lease, recovery);
  assert.equal(result.status, 'completed');
  assert.equal(result.operationId, operationId);
  assert.deepEqual(sample.claims.get(operationId), original);
  assert.equal(sample.recoveryClaims.get(operationId).recoveryDigest, realDigest(recovery));
  assert.deepEqual(await publisher.observePublication(request), result);
  assert.deepEqual(await publisher.publish(request, lease, recovery), result);
  assert.equal(sample.attempts(), 2);
  assert.deepEqual(sample.state(), { pushes: 1, creates: 1 });
});

test('a failed recovery marker only permits observation and cannot enter Git Safety twice', async () => {
  const sample = fixture({ attemptErrors: ['REPOSITORY_LOCKED', 'NATIVE_LOCKED'] });
  const { publisher, request, lease } = sample;
  assert.equal((await publisher.publish(request)).status, 'unknown');
  const recovery = sample.recovery();
  assert.equal((await publisher.publish(request, lease, recovery)).status, 'unknown');
  assert.equal((await publisher.publish(request, lease, recovery)).status, 'unknown');
  assert.equal(sample.attempts(), 2);
  assert.equal(sample.recoveryClaims.size, 1);
  assert.deepEqual(sample.state(), { pushes: 0, creates: 0 });
});

test('recovery rejects a changed claim, denied authority, prior push or nonempty remote branch', async () => {
  const changed = fixture({ attemptErrors: ['REPOSITORY_LOCKED'] });
  await changed.publisher.publish(changed.request);
  assert.equal((await changed.publisher.publish(changed.request, changed.lease, {
    ...changed.recovery(), originalClaimDigest: 'a'.repeat(64),
  })).code, 'RWB_REAL_PUBLICATION_RECOVERY_DENIED');
  const denied = fixture({ attemptErrors: ['REPOSITORY_LOCKED'], recoveryVerified: false });
  await denied.publisher.publish(denied.request);
  assert.equal((await denied.publisher.publish(denied.request, denied.lease, denied.recovery())).code, 'RWB_REAL_PUBLICATION_RECOVERY_DENIED');
  const pushed = fixture({ transportFails: true });
  await pushed.publisher.publish(pushed.request);
  assert.equal((await pushed.publisher.publish(pushed.request, pushed.lease, pushed.recovery())).code, 'RWB_REAL_PUBLICATION_RECOVERY_DENIED');
  const existing = fixture({ attemptErrors: ['REPOSITORY_LOCKED'] });
  await existing.publisher.publish(existing.request);
  existing.setRemoteHead(secondSha);
  assert.equal((await existing.publisher.publish(existing.request, existing.lease, existing.recovery())).code, 'RWB_REAL_REMOTE_BRANCH_ALREADY_USED');
  for (const sample of [changed, denied, pushed, existing]) {
    assert.equal(sample.attempts(), 1);
    assert.equal(sample.recoveryClaims.size, 0);
  }
});

test('managed and remote receipts cannot substitute for the expected-old-head push proof', async () => {
  for (const revision of [1, 2]) {
    const { publisher, request, state } = fixture({ revision, missingPushProof: true });
    assert.equal((await publisher.publish(request)).status, 'unknown');
    assert.equal((await publisher.observePublication(request)).status, 'unknown');
    assert.deepEqual(state(), { pushes: 1, creates: 0 });
  }
});

test('CI follows protected contexts and App IDs for the exact PR head', async () => {
  const sample = fixture();
  assert.equal((await sample.publisher.publish(sample.request)).status, 'completed');
  assert.equal((await sample.publisher.readCi(sample.ci())).result.conclusion, 'success');
  sample.setChecks([sample.check('Project Constraints', 4, 9)]);
  assert.deepEqual(await sample.publisher.readCi(sample.ci()), { status: 'pending' });
  sample.setChecks([sample.check('Project Constraints', 5, 15368, null)]);
  assert.deepEqual(await sample.publisher.readCi(sample.ci()), { status: 'pending' });
  sample.setChecks([sample.check('Project Constraints', 6, 15368, 'failure')]);
  assert.equal((await sample.publisher.readCi(sample.ci())).result.conclusion, 'failure');
  sample.setChecks([sample.check('Project Constraints', 7, 15368, 'success', secondSha)]);
  assert.equal((await sample.publisher.readCi(sample.ci())).code, 'RWB_REAL_CI_HEAD_UNPROVEN');
  sample.setRemoteHead(secondSha);
  assert.equal((await sample.publisher.readCi(sample.ci())).code, 'RWB_REAL_REMOTE_PR_CHANGED');
});

test('GitHub transport only allows bounded reads and the fixed PR creation shape', () => {
  const calls = [];
  const github = createChiefWebRealGitHub({ projectRoot, ghBinary: '/opt/homebrew/bin/gh', run(executable, args, options) {
    calls.push({ executable, args, input: options.input });
    const verb = args[args.indexOf('--method') + 1];
    if (args.at(-1).includes('/git/ref/')) return { status: 1, stdout: 'HTTP/2.0 404 Not Found\r\n\r\n{}' };
    return { status: 0, stdout: 'HTTP/2.0 ' + (verb === 'GET' ? '200' : '201') + ' OK\r\n\r\n{}' };
  } });
  assert.equal(github.get(endpoint + '/git/ref/heads/' + branch), null);
  assert.deepEqual(github.get(endpoint), {});
  const body = 'Managed ResearchWorkbench delivery ' + deliveryTaskId + '.\n\nCandidate: ' + firstSha + '\nVerification: passed.\n';
  github.createPullRequest({ repository: REAL_RWB_REPOSITORY, head: branch, base: 'master', title: 'merge: deliver ' + deliveryTaskId, body });
  assert.deepEqual(JSON.parse(calls[2].input), { title: 'merge: deliver ' + deliveryTaskId, body, head: branch, base: 'master' });
  assert.throws(() => github.get(endpoint + '/pulls/310/merge'), { code: 'RWB_REAL_GITHUB_ENDPOINT_DENIED' });
  assert.throws(() => github.createPullRequest({ repository: 'outside/repo', head: branch }), { code: 'RWB_REAL_GITHUB_CREATION_SCOPE_DENIED' });
  assert.equal(calls.length, 3);
});
