import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY } from '../bridge/chief-web-real-engine.mjs';
import { chiefWebRealDeliveryIdentity } from '../bridge/chief-web-real-publisher.mjs';
import { createChiefWebRealRwbWorkspace } from '../scripts/chief-web-real-publisher-workspace.mjs';

const taskId = '10000000-1000-4000-8000-100000000001';
const slotId = '20000000-2000-4000-8000-200000000001';
const developerSessionId = '30000000-3000-4000-8000-300000000001';
const reviewerSessionId = '30000000-3000-4000-8000-300000000002';
const first = '1'.repeat(64), second = '2'.repeat(64), reviewDigest = '3'.repeat(64);
const baseSha = '4'.repeat(40), featureSha = '5'.repeat(40), firstSha = '6'.repeat(40), secondSha = '7'.repeat(40);
const movedBase = '8'.repeat(40), mergeSha = '9'.repeat(40);
const { deliveryTaskId, branch } = chiefWebRealDeliveryIdentity(taskId);
const featureBranch = 'codex/' + deliveryTaskId + '-chief-web';
const repository = REAL_RWB_REPOSITORY, targetDoc = REAL_RWB_DOCUMENT;
const url = 'https://github.com/' + repository + '/pull/321';
const repo = 'repos/' + repository;

function fixture(t, { failFirstResourceRecord = false, preflightErrors = {}, postProbeError = null,
  pauseOnWait = false, pauseOnRetryRemote = false } = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'sa-publisher-workspace-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const projectRoot = path.join(tmp, 'rwb'), worktreeRoot = path.join(tmp, 'worktrees');
  const featureWorktree = path.join(worktreeRoot, deliveryTaskId), integrationWorktree = featureWorktree + '-integration';
  const init = root => mkdirSync(path.join(root, 'docs'), { recursive: true });
  init(projectRoot);
  let featureHead = baseSha, integrationHead = null, remoteHead = null, remoteBase = baseSha, managed = null, dirty = false;
  const documents = new Map();
  const journalRows = new Map();
  const actions = [];
  const actionInputs = [];
  const checks = [];
  const waits = [];
  const leases = [];
  let clock = 1000;
  let commits = 0;
  let paused = false;
  let resourceAttempts = 0;
  const raised = code => Object.assign(new Error(code), { code });
  const exit = (stdout = '', status = 0) => ({ stdout: Buffer.from(stdout), status });
  const workspace = createChiefWebRealRwbWorkspace({ projectRoot, worktreeRoot, gitBinary: '/usr/bin/git',
    controller: { readDeliveryReceipt: () => managed },
    async runDelivery(input, options) {
      const attempt = actions.filter(action => action === input.action).length;
      actions.push(input.action);
      actionInputs.push(input);
      const preflightError = preflightErrors[input.action]?.[attempt];
      if (preflightError) throw raised(preflightError);
      if (input.action === 'start') {
        init(featureWorktree);
        managed = { taskId: deliveryTaskId, repositoryRoot: projectRoot, defaultBranch: 'master', remote: 'origin',
          remoteUrl: 'git@github.com:' + repository + '.git', featureWorktree, featureBranch, featureCommit: baseSha,
          baseCommit: baseSha, integrationWorktree: null, mode: null, status: 'started', pullRequest: null };
      } else {
        assert.equal(input.action, 'prepare');
        if (managed.mode === 'pr') {
          const result = options.githubRunner('gh', ['api', repo + '/git/ref/heads/master'], { cwd: projectRoot });
          assert.equal(JSON.parse(result.stdout).object.sha, movedBase);
          managed = { ...managed, integrationCommit: secondSha, baseCommit: movedBase,
            status: 'prepared', baseRefreshPublishedHead: firstSha };
        } else {
          init(integrationWorktree);
          mkdirSync(path.join(integrationWorktree, 'docs', 'super-agent'));
          writeFileSync(path.join(integrationWorktree, targetDoc), documents.get(featureSha));
          documents.set(firstSha, documents.get(featureSha));
          integrationHead = firstSha;
          managed = { ...managed, featureCommit: featureSha, integrationWorktree, integrationBranch: branch,
            integrationCommit: firstSha, status: 'prepared', repairAttempts: 0 };
        }
      }
      options.resourceRevalidationProbe({ repositoryRoot: projectRoot }, deliveryTaskId, 'record');
      if (postProbeError?.action === input.action) throw raised(postProbeError.code);
      return managed;
    },
    github: { get(endpoint) {
      if (endpoint === repo) return { full_name: repository, private: false, allow_auto_merge: false, default_branch: 'master' };
      if (endpoint === repo + '/git/ref/heads/master') {
        if (pauseOnRetryRemote && waits.length) paused = true;
        return { ref: 'refs/heads/master', object: { type: 'commit', sha: remoteBase } };
      }
      if (endpoint === repo + '/git/ref/heads/' + branch) return remoteHead && { ref: 'refs/heads/' + branch,
        object: { type: 'commit', sha: remoteHead } };
      if (endpoint === repo + '/pulls/321') return { number: 321, html_url: url, state: 'open', merged: false, auto_merge: null,
        head: { ref: branch, sha: remoteHead, repo: { full_name: repository } }, base: { ref: 'master', repo: { full_name: repository } } };
      throw new Error('unexpected endpoint');
    } },
    journal: { async read(task, revision, name) { return journalRows.get([task, revision, name].join(':')) ?? null; },
      async createExclusive(task, revision, name, value) {
        const key = [task, revision, name].join(':');
        if (journalRows.has(key)) throw Object.assign(new Error(), { code: 'EEXIST' });
        journalRows.set(key, value);
      } },
    recordResources(record) {
      resourceAttempts++;
      if (failFirstResourceRecord && resourceAttempts === 1) throw new Error('first resource registration failed');
      return { ...record, verified: true };
    },
    verifyCandidate(input) {
      checks.push(input.candidateSha);
      return { status: 'passed', candidateSha: input.candidateSha, durationSeconds: 0, command: 'three RWB checks',
        checks: ['documentation-governance', 'project-constraints', 'python-file-index'].map(name => ({ name, exitCode: 0, durationMs: 1 })) };
    },
    async assertWorkspaceLease(subject) {
      leases.push(subject.operationId ?? subject.slotId);
      if (paused) throw raised('WORKSPACE_PAUSED');
    },
    async readReview(input) { return { ...input, verified: true, approved: true, reviewerSessionId }; },
    async log() {},
    now: () => clock,
    async wait(ms) {
      waits.push(ms);
      clock += ms;
      if (pauseOnWait) paused = true;
    },
    run(_binary, args, { cwd }) {
      if (args[0] === 'remote') return exit(managed?.remoteUrl ?? 'git@github.com:' + repository + '.git');
      if (args[0] === 'ls-tree') return documents.has(args[2]) ? exit('100644 blob ' + args[2] + '\t' + targetDoc + '\0') : exit();
      if (args[0] === 'show') return exit(documents.get(args[1].slice(0, 40)));
      if (args[0] === 'rev-parse') {
        if (args.at(-1) === 'refs/remotes/origin/master') return exit(remoteBase);
        return exit(args.at(-1) === 'HEAD' ? (cwd === featureWorktree ? featureHead : integrationHead) : projectRoot + '/.git');
      }
      if (args[0] === 'symbolic-ref') return exit(cwd === featureWorktree ? featureBranch : branch);
      if (args[0] === 'status') return exit(dirty ? ' M other.md\0' : '');
      if (args[0] === 'merge-base') return exit();
      if (args[0] === 'fetch') return exit();
      if (args[0] === 'merge') {
        documents.set(mergeSha, documents.get(integrationHead));
        integrationHead = mergeSha;
        return exit();
      }
      if (args[0] === 'add') return exit();
      if (args[0] === 'commit') {
        commits++;
        const content = readFileSync(path.join(cwd, targetDoc), 'utf8');
        if (cwd === featureWorktree) { featureHead = featureSha; documents.set(featureSha, content); }
        else { integrationHead = secondSha; documents.set(secondSha, content); }
        return exit();
      }
      if (args[0] === 'diff') return exit(targetDoc + '\0');
      throw new Error('unexpected git command ' + args[0]);
    },
  });
  const request = (revision, role = 'developer') => ({ taskId, repository, targetDoc, role, revision, slotId, operationId: slotId,
    inputRevision: revision === 1 ? first : second, pr: revision === 1 ? null : { number: 321, url, branch, headSha: firstSha, baseSha } });
  const artifact = (claim, workspace, content) => ({ claim, workspace, content, providerReceiptDigest: 'a'.repeat(64), developerSessionId });
  return { workspace, request, artifact, actions, actionInputs, checks, waits, leases, commits: () => commits,
    resourceAttempts: () => resourceAttempts,
    setDirty: () => { dirty = true; }, moveBase: () => { remoteBase = movedBase; }, markFirstPublished() {
    managed = { ...managed, mode: 'pr', status: 'awaiting_ci', pullRequest: { number: 321, url }, remoteCommit: baseSha };
    remoteHead = firstSha;
  } };
}

test('first candidate and append-only repair share the managed RWB worktrees and evidence', async t => {
  const sample = fixture(t);
  const firstRequest = sample.request(1);
  const firstSnapshot = await sample.workspace.read(firstRequest);
  assert.equal(firstSnapshot.document.exists, false);
  assert.deepEqual(sample.actions, ['start']);
  const content = '# Acceptance\n';
  const firstArtifact = sample.artifact(firstRequest, firstSnapshot, content);
  const firstResult = await sample.workspace.prepare(firstArtifact);
  assert.equal(firstResult.candidateSha, firstSha);
  assert.equal(firstResult.repair, false);
  assert.deepEqual(await sample.workspace.observeCandidate(firstArtifact), firstResult);
  assert.deepEqual(sample.actions, ['start', 'prepare']);
  assert.equal((await sample.workspace.read({ ...sample.request(1, 'reviewer'), candidateSha: firstSha })).candidate.document.content, content);
  assert.equal((await sample.workspace.readPrepared({ ...sample.request(1, 'publish'), candidateSha: firstSha,
    baseSha, branch, previousHead: null, reviewDigest })).managedReceiptDigest, firstResult.managedReceiptDigest);
  sample.markFirstPublished();
  const secondRequest = sample.request(2);
  const secondSnapshot = await sample.workspace.read(secondRequest);
  assert.equal(secondSnapshot.document.content, content);
  await assert.rejects(sample.workspace.prepare(sample.artifact(secondRequest, secondSnapshot, 'replaced')), { code: 'RWB_REAL_DOCUMENT_APPEND_ONLY' });
  const secondResult = await sample.workspace.prepare(sample.artifact(secondRequest, secondSnapshot, content + '\n## Supplement\n'));
  assert.equal(secondResult.candidateSha, secondSha);
  assert.equal(secondResult.repair, true);
  assert.deepEqual(sample.actions, ['start', 'prepare']);
  assert.deepEqual(sample.checks, [firstSha, secondSha]);
  sample.setDirty();
  await assert.rejects(sample.workspace.readPrepared({ ...sample.request(2, 'publish'), candidateSha: secondSha, baseSha,
    branch, previousHead: firstSha, reviewDigest }), { code: 'RWB_REAL_WORKSPACE_CHANGED' });
});

test('retries only pre-callback Git lock denial for start and prepare without writing the feature twice', async t => {
  const sample = fixture(t, { preflightErrors: { start: ['NATIVE_LOCKED'], prepare: ['REPOSITORY_LOCKED', 'NATIVE_LOCKED'] } });
  const request = sample.request(1);
  const snapshot = await sample.workspace.read(request);
  const candidate = await sample.workspace.prepare(sample.artifact(request, snapshot, '# Acceptance\n'));
  assert.equal(candidate.candidateSha, firstSha);
  assert.deepEqual(sample.actions, ['start', 'start', 'prepare', 'prepare', 'prepare']);
  assert.deepEqual(sample.actionInputs[0], sample.actionInputs[1]);
  assert.equal(sample.actionInputs[0].slug, 'chief-web');
  assert.deepEqual(sample.actionInputs[2], sample.actionInputs[3]);
  assert.deepEqual(sample.actionInputs[3], sample.actionInputs[4]);
  assert.equal(Object.hasOwn(sample.actionInputs[2], 'slug'), false);
  assert.deepEqual(sample.waits, [4000, 4000, 4000]);
  assert.ok(sample.leases.length >= sample.actions.length);
  assert.ok(sample.leases.every(operationId => operationId === slotId));
  assert.equal(sample.commits(), 1);
  assert.equal(sample.resourceAttempts(), 2);
});

test('lock waiting stops for pause, timeout, unknown errors or a lock code after resource entry', async t => {
  const paused = fixture(t, { preflightErrors: { start: ['REPOSITORY_LOCKED'] }, pauseOnWait: true });
  await assert.rejects(paused.workspace.read(paused.request(1)), { code: 'WORKSPACE_PAUSED' });
  assert.deepEqual(paused.actions, ['start']);
  const bounded = fixture(t, { preflightErrors: { start: Array(40).fill('REPOSITORY_LOCKED') } });
  await assert.rejects(bounded.workspace.read(bounded.request(1)), { code: 'REPOSITORY_LOCKED' });
  assert.equal(bounded.waits.reduce((sum, ms) => sum + ms, 0), 120_000);
  assert.equal(bounded.actions.length, 30);
  for (const options of [{ preflightErrors: { start: ['TASK_LOCKED'] } }, { postProbeError: { action: 'start', code: 'NATIVE_LOCKED' } }]) {
    const sample = fixture(t, options);
    await assert.rejects(sample.workspace.read(sample.request(1)));
    assert.deepEqual(sample.actions, ['start']);
    assert.deepEqual(sample.waits, []);
  }
});

test('a pause during retry evidence verification prevents re-entering Git Safety', async t => {
  const sample = fixture(t, { preflightErrors: { prepare: ['REPOSITORY_LOCKED'] }, pauseOnRetryRemote: true });
  const request = sample.request(1);
  const snapshot = await sample.workspace.read(request);
  await assert.rejects(sample.workspace.prepare(sample.artifact(request, snapshot, '# Acceptance\n')), { code: 'WORKSPACE_PAUSED' });
  assert.deepEqual(sample.actions, ['start', 'prepare']);
  assert.deepEqual(sample.waits, [4000]);
  assert.equal(sample.commits(), 1);
  assert.equal(sample.resourceAttempts(), 1);
});

test('resumes resource registration from the exact started worktree without replaying managed start', async t => {
  const sample = fixture(t, { failFirstResourceRecord: true });
  const request = sample.request(1);
  await assert.rejects(sample.workspace.read(request), /first resource registration failed/);
  assert.deepEqual(sample.actions, ['start']);
  const snapshot = await sample.workspace.read(request);
  assert.equal(snapshot.currentHead, baseSha);
  assert.equal(snapshot.document.exists, false);
  assert.deepEqual(await sample.workspace.read(request), snapshot);
  assert.deepEqual(sample.actions, ['start']);
  assert.equal(sample.resourceAttempts(), 2);
});

test('denies started worktree recovery after the base or worktree changed', async t => {
  const moved = fixture(t, { failFirstResourceRecord: true });
  await assert.rejects(moved.workspace.read(moved.request(1)), /first resource registration failed/);
  moved.moveBase();
  await assert.rejects(moved.workspace.read(moved.request(1)), { code: 'RWB_REAL_WORKSPACE_START_CLAIM_CHANGED' });
  const dirty = fixture(t, { failFirstResourceRecord: true });
  await assert.rejects(dirty.workspace.read(dirty.request(1)), /first resource registration failed/);
  dirty.setDirty();
  await assert.rejects(dirty.workspace.read(dirty.request(1)), { code: 'RWB_REAL_WORKSPACE_CHANGED' });
  for (const sample of [moved, dirty]) {
    assert.deepEqual(sample.actions, ['start']);
    assert.equal(sample.resourceAttempts(), 1);
  }
});

test('a moved master uses formal RWB prepare while preserving the existing PR and integration branch', async t => {
  const sample = fixture(t);
  const firstRequest = sample.request(1);
  const content = '# Acceptance\n';
  await sample.workspace.prepare(sample.artifact(firstRequest, await sample.workspace.read(firstRequest), content));
  sample.markFirstPublished();
  sample.moveBase();
  const secondRequest = sample.request(2);
  const snapshot = await sample.workspace.read(secondRequest);
  assert.equal(snapshot.baseSha, movedBase);
  const result = await sample.workspace.prepare(sample.artifact(secondRequest, snapshot, content + '\n## Supplement\n'));
  assert.equal(result.repair, false);
  assert.equal(result.baseSha, movedBase);
  assert.equal(result.branch, branch);
  assert.deepEqual(sample.actions, ['start', 'prepare', 'prepare']);
});
