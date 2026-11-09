import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY, realDigest } from '../bridge/chief-web-real-engine.mjs';
import { chiefWebRealDeliveryIdentity } from '../bridge/chief-web-real-publisher.mjs';
import { chiefWebRealDigest } from '../bridge/chief-web-real-executor.mjs';

const repoEndpoint = 'repos/' + REAL_RWB_REPOSITORY;
const remotes = new Set(['git@github.com:' + REAL_RWB_REPOSITORY + '.git', 'https://github.com/' + REAL_RWB_REPOSITORY + '.git']);
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = code => { throw Object.assign(new Error('RWB_REAL_' + code), { code: 'RWB_REAL_' + code }); };
const same = (value, fields) => Object.entries(fields).every(([key, expected]) => value?.[key] === expected);
const checkNames = ['documentation-governance', 'project-constraints', 'python-file-index'];
const preflightLockCodes = new Set(['REPOSITORY_LOCKED', 'NATIVE_LOCKED']);
const lockWaitMs = 120_000;
const lockPollMs = 4_000;

/** The journal exposes read(taskId, inputRevision, name) and durable createExclusive with the same keys. */
export function createChiefWebRealRwbWorkspace({ projectRoot, worktreeRoot, gitBinary, controller, runDelivery, github, journal,
  recordResources, verifyCandidate, assertWorkspaceLease, readReview, log, run = spawnSync, now = Date.now, wait = delay } = {}) {
  if (![projectRoot, worktreeRoot, gitBinary].every(value => typeof value === 'string' && path.isAbsolute(value) &&
    path.normalize(value) === value) || ![controller?.readDeliveryReceipt, runDelivery, github?.get, journal?.read,
    journal?.createExclusive, recordResources, verifyCandidate, assertWorkspaceLease, readReview, log, run, now, wait].every(fn => typeof fn === 'function')) {
    fail('WORKSPACE_CONFIGURATION_INVALID');
  }
  const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  function command(root, args, { mayMiss = false, maxBuffer = 128 * 1024 } = {}) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' };
    for (const name of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|REPLACE_REF_BASE|SSH_COMMAND|SSH|NO_VERIFY)/.test(name)) delete env[name];
    const result = run(gitBinary, args, { cwd: root, env, timeout: 120_000, maxBuffer });
    if (!result?.error && !result?.signal && mayMiss && result?.status === 1) return null;
    if (result?.error || result?.signal || result?.status !== 0 || !Buffer.isBuffer(result.stdout)) fail('WORKSPACE_GIT_FAILED');
    return decode(result.stdout);
  }
  const git = (root, args, options) => command(root, args, options)?.trimEnd();
  const head = root => git(root, ['rev-parse', '--verify', 'HEAD']);
  const ancestor = (root, older, newer) => command(root, ['merge-base', '--is-ancestor', older, newer], { mayMiss: true }) !== null;
  function directory(location) {
    if (!fs.lstatSync(location).isDirectory() || fs.realpathSync(location) !== location) fail('WORKSPACE_DIRECTORY_UNSAFE');
  }
  function clean(root, branch, expectedHead) {
    directory(root);
    if (git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']) !==
        git(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']) ||
        git(root, ['symbolic-ref', '--short', 'HEAD']) !== branch || head(root) !== expectedHead ||
        command(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])) fail('WORKSPACE_CHANGED');
  }
  function remoteRef(name, allowAbsent = false) {
    const ref = github.get(repoEndpoint + '/git/ref/heads/' + name);
    if (allowAbsent && ref === null) return null;
    if (ref?.ref !== 'refs/heads/' + name || ref.object?.type !== 'commit' || !sha.test(ref.object.sha ?? '')) fail('REMOTE_REF_UNPROVEN');
    return ref.object.sha;
  }
  function scope(request) {
    const { deliveryTaskId, branch } = chiefWebRealDeliveryIdentity(request?.taskId);
    if (![1, 2].includes(request.revision) || !digest.test(request.inputRevision ?? '')) fail('WORKSPACE_SCOPE_DENIED');
    return { taskId: request.taskId, inputRevision: request.inputRevision, deliveryTaskId, branch, revision: request.revision };
  }
  function receipt(scope) {
    const result = controller.readDeliveryReceipt({ projectRoot, taskId: scope.deliveryTaskId });
    if (!same(result, { taskId: scope.deliveryTaskId, repositoryRoot: projectRoot, defaultBranch: 'master', remote: 'origin',
      featureWorktree: path.join(worktreeRoot, scope.deliveryTaskId), featureBranch: 'codex/' + scope.deliveryTaskId + '-chief-web' }) ||
      !remotes.has(result.remoteUrl) || !sha.test(result.baseCommit ?? '') || !sha.test(result.featureCommit ?? '') ||
      (result.integrationWorktree !== null && (result.integrationWorktree !== path.join(worktreeRoot, scope.deliveryTaskId + '-integration') ||
        result.integrationBranch !== scope.branch || !sha.test(result.integrationCommit ?? '')))) fail('WORKSPACE_RECEIPT_UNVERIFIED');
    return result;
  }
  function remote(scope, previousHead, number) {
    if (!same(github.get(repoEndpoint), { full_name: REAL_RWB_REPOSITORY, private: false,
      allow_auto_merge: false, default_branch: 'master' }) || !remotes.has(git(projectRoot, ['remote', 'get-url', 'origin']))) {
      fail('REPOSITORY_CHANGED');
    }
    const baseSha = remoteRef('master');
    if (remoteRef(scope.branch, true) !== previousHead) fail('REMOTE_BRANCH_CHANGED');
    if (previousHead !== null) {
      const url = 'https://github.com/' + REAL_RWB_REPOSITORY + '/pull/' + number;
      const pr = github.get(repoEndpoint + '/pulls/' + number);
      if (!Number.isSafeInteger(number) || number < 1 || !same(pr, { number, html_url: url, state: 'open', merged: false, auto_merge: null }) ||
        !same(pr.head, { ref: scope.branch, sha: previousHead }) || pr.head.repo?.full_name !== REAL_RWB_REPOSITORY ||
        pr.base?.ref !== 'master' || pr.base.repo?.full_name !== REAL_RWB_REPOSITORY) fail('REMOTE_PR_CHANGED');
    }
    return baseSha;
  }
  function resourceProbe(scope, repository, taskId, phase) {
    if (!same(repository, { repositoryRoot: projectRoot }) || taskId !== scope.deliveryTaskId || phase !== 'record') fail('RESOURCE_SCOPE_DENIED');
    const result = recordResources({ projectRoot, taskId, phase });
    if (!same(result, { verified: true, projectRoot, taskId, phase })) fail('RESOURCE_RECORD_UNPROVEN');
    return result;
  }
  async function managedOnce(scope, action, request) {
    let recorded = false;
    let callbackEntered = false;
    const track = method => (...args) => {
      callbackEntered = true;
      return controller[method](...args);
    };
    const input = { projectRoot, taskId: scope.deliveryTaskId, action, worktreeRoot,
      ...(action === 'start' ? { slug: 'chief-web' } : {}) };
    const options = {
      identityRoot: projectRoot,
      controller: { readDeliveryReceipt: track('readDeliveryReceipt'), startDelivery: track('startDelivery'),
        prepareDelivery: track('prepareDelivery') },
      resourceRevalidationProbe(repository, taskId, phase) {
        callbackEntered = true;
        if (recorded) fail('RESOURCE_SCOPE_DENIED');
        const record = resourceProbe(scope, repository, taskId, phase);
        recorded = true;
        return record;
      },
      githubRunner(executable, args, extra) {
        callbackEntered = true;
        const eq = expected => realDigest(args) === realDigest(expected);
        if (executable !== 'gh' || extra?.cwd !== projectRoot || action !== 'prepare' || scope.revision !== 2) fail('GITHUB_COMMAND_DENIED');
        let data;
        if (eq(['api', repoEndpoint + '/git/ref/heads/master'])) {
          data = github.get(repoEndpoint + '/git/ref/heads/master');
          if (data?.object?.sha !== request.baseSha) fail('REMOTE_BASE_CHANGED');
        } else if (eq(['pr', 'view', request.prUrl, '--repo', REAL_RWB_REPOSITORY, '--json', 'state,headRefOid,headRefName,baseRefName'])) {
          if (remote(scope, request.previousHead, request.prNumber) !== request.baseSha) fail('REMOTE_BASE_CHANGED');
          data = { state: 'OPEN', headRefOid: request.previousHead, headRefName: scope.branch, baseRefName: 'master' };
        } else fail('GITHUB_COMMAND_DENIED');
        return { status: 0, stdout: JSON.stringify(data), stderr: '' };
      },
    };
    let result;
    try { result = await runDelivery(input, options); }
    catch (error) {
      if (callbackEntered || !preflightLockCodes.has(error?.code)) throw error;
      return { lockDenied: error };
    }
    if (!recorded || result?.taskId !== scope.deliveryTaskId) fail('WORKSPACE_MANAGED_RESULT_UNVERIFIED');
    return { receipt: receipt(scope) };
  }
  async function managed(scope, action, snapshot, leaseSubject, assertCandidate = undefined) {
    const deadline = Math.min(now() + lockWaitMs,
      Number.isSafeInteger(leaseSubject.expiresAt) ? leaseSubject.expiresAt : Infinity);
    let lockDenied;
    for (;;) {
      if (lockDenied) {
        await assertWorkspaceLease(leaseSubject);
        if (now() >= deadline) throw lockDenied;
        if (remote(scope, snapshot.previousHead, snapshot.prNumber) !== snapshot.baseSha) fail('REMOTE_BASE_CHANGED');
      }
      assertCandidate?.();
      await assertWorkspaceLease(leaseSubject);
      if (lockDenied && now() >= deadline) throw lockDenied;
      const result = await managedOnce(scope, action, snapshot);
      if (result.receipt) return result.receipt;
      lockDenied = result.lockDenied;
      const remaining = deadline - now();
      if (remaining <= 0) throw lockDenied;
      await log({ code: 'RWB_REAL_WORKSPACE_LOCK_WAIT', action, lockCode: lockDenied.code,
        operationId: leaseSubject.operationId ?? leaseSubject.slotId });
      await wait(Math.min(lockPollMs, remaining));
    }
  }
  function document(root, commit) {
    const item = command(root, ['ls-tree', '-z', commit, '--', REAL_RWB_DOCUMENT]);
    if (!item) return { exists: false, content: '', digest: chiefWebRealDigest('') };
    if (!new RegExp('^100644 blob [a-f0-9]{40}\\t' + REAL_RWB_DOCUMENT.replaceAll('.', '\\.') + '\\x00$').test(item)) fail('DOCUMENT_MODE_DENIED');
    const content = command(root, ['show', commit + ':' + REAL_RWB_DOCUMENT]);
    if (!content.trim() || content.includes('\0') || Buffer.byteLength(content) > 65536) fail('DOCUMENT_INVALID');
    return { exists: true, content, digest: chiefWebRealDigest(content) };
  }
  function writeDocument(root, source, content) {
    const filename = path.join(root, REAL_RWB_DOCUMENT);
    const docs = path.join(root, 'docs');
    const parent = path.dirname(filename);
    directory(docs);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { mode: 0o755 });
    directory(parent);
    const descriptor = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW |
      (source.exists ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL), 0o644);
    try {
      const info = fs.fstatSync(descriptor);
      if (!info.isFile() || info.nlink !== 1 || info.size !== Buffer.byteLength(source.content) ||
          (info.mode & 0o111) !== 0 || (source.exists && fs.readFileSync(filename, 'utf8') !== source.content)) fail('DOCUMENT_WORKTREE_CHANGED');
      fs.ftruncateSync(descriptor, 0);
      fs.writeFileSync(descriptor, content);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    git(root, ['add', '--', REAL_RWB_DOCUMENT]);
    git(root, ['commit', '--only', '-m', 'docs: verify Chief task delivery', '--', REAL_RWB_DOCUMENT]);
  }
  function changedPaths(root, baseSha, candidateSha) {
    const paths = command(root, ['diff', '--name-only', '--no-renames', '-z', baseSha, candidateSha, '--']).split('\0').filter(Boolean);
    if (paths.length !== 1 || paths[0] !== REAL_RWB_DOCUMENT) fail('WORKSPACE_DIFF_SCOPE_DENIED');
    return paths;
  }
  function validVerification(verification, candidateSha) {
    if (!same(verification, { status: 'passed', candidateSha }) || typeof verification.command !== 'string' || !verification.command.trim() ||
        !Number.isSafeInteger(verification.durationSeconds) || verification.durationSeconds < 0 ||
        !Array.isArray(verification.checks) || verification.checks.length !== checkNames.length ||
        checkNames.some(name => !verification.checks.some(check => same(check, { name, exitCode: 0 }) &&
          Number.isSafeInteger(check.durationMs) && check.durationMs >= 0))) fail('VERIFICATION_UNPROVEN');
    return verification;
  }
  function sourceRecord(value) {
    return { ...value, document: undefined };
  }
  async function read(request, { readOnly = false } = {}) {
    const current = scope(request);
    if (!['developer', 'reviewer'].includes(request.role) || request.repository !== REAL_RWB_REPOSITORY ||
        request.targetDoc !== REAL_RWB_DOCUMENT) fail('WORKSPACE_SCOPE_DENIED');
    let snapshot = await journal.read(current.taskId, current.inputRevision, 'source');
    if (!snapshot) {
      if (readOnly) return null;
      if (request.role !== 'developer') fail('WORKSPACE_SOURCE_UNAVAILABLE');
      await assertWorkspaceLease(request);
      const pr = request.pr;
      const previousHead = current.revision === 2 ? pr?.headSha : null;
      if (current.revision === 2 && (!sha.test(previousHead ?? '') || pr?.branch !== current.branch)) fail('WORKSPACE_SCOPE_DENIED');
      const baseSha = remote(current, previousHead, pr?.number);
      if (current.revision === 1) {
        const start = await journal.read(current.taskId, current.inputRevision, 'start');
        let started;
        if (start === null) {
          // Record intent before provisioning. Recovery can only adopt the exact started worktree.
          await journal.createExclusive(current.taskId, current.inputRevision, 'start', { ...current, baseSha });
          started = await managed(current, 'start', { baseSha, previousHead: null, prNumber: null }, request);
        } else {
          if (!same(start, { ...current, baseSha })) fail('WORKSPACE_START_CLAIM_CHANGED');
          started = receipt(current);
        }
        if (!same(started, { status: 'started', baseCommit: baseSha, featureCommit: baseSha,
          mode: null, pullRequest: null, integrationWorktree: null })) fail('WORKSPACE_RECEIPT_UNVERIFIED');
        clean(started.featureWorktree, started.featureBranch, baseSha);
        if (start !== null) {
          if (document(projectRoot, baseSha).exists) fail('DOCUMENT_ALREADY_PRESENT');
          await assertWorkspaceLease(request);
          if (remote(current, null, null) !== baseSha) fail('REMOTE_BASE_CHANGED');
          resourceProbe(current, { repositoryRoot: projectRoot }, current.deliveryTaskId, 'record');
          await log({ code: 'RWB_REAL_STARTED_WORKTREE_RECOVERED', operationId: request.operationId });
        }
      } else {
        const prior = receipt(current);
        if (!same(prior, { mode: 'pr', status: 'awaiting_ci', integrationCommit: previousHead }) ||
          !same(prior.pullRequest, { number: pr.number, url: pr.url })) fail('WORKSPACE_RECEIPT_UNVERIFIED');
      }
      snapshot = { ...current, verified: true, repository: REAL_RWB_REPOSITORY, targetDoc: REAL_RWB_DOCUMENT,
        baseSha, currentHead: previousHead ?? baseSha, previousHead, prNumber: pr?.number ?? null, prUrl: pr?.url ?? null };
      snapshot.evidenceDigest = realDigest(snapshot);
      await journal.createExclusive(current.taskId, current.inputRevision, 'source', snapshot);
    }
    if (!same(snapshot, current)) fail('WORKSPACE_SOURCE_CHANGED');
    const source = { ...snapshot, document: document(projectRoot, snapshot.currentHead) };
    if (current.revision === 1 && source.document.exists) fail('DOCUMENT_ALREADY_PRESENT');
    if (request.role === 'reviewer') {
      const recorded = await journal.read(current.taskId, current.inputRevision, 'candidate');
      if (!same(recorded, { candidateSha: request.candidateSha, baseSha: snapshot.baseSha }) || !recorded.checksPassed) fail('CANDIDATE_UNPROVEN');
      source.candidate = { ...recorded, document: document(projectRoot, recorded.candidateSha) };
    }
    return source;
  }
  async function observeCandidate(artifact) {
    const current = scope(artifact?.claim);
    const row = await journal.read(current.taskId, current.inputRevision, 'candidate');
    if (row) return row;
    if (await journal.read(current.taskId, current.inputRevision, 'prepare')) fail('CANDIDATE_RESULT_UNKNOWN');
    return null;
  }
  async function prepare(artifact) {
    const { claim, workspace, content, providerReceiptDigest, developerSessionId } = artifact ?? {};
    const current = scope(claim);
    if (claim.role !== 'developer' || !uuid.test(claim.slotId ?? '') || !uuid.test(developerSessionId ?? '') ||
        !digest.test(providerReceiptDigest ?? '') || typeof content !== 'string' || !content.trim() ||
        content.includes('\0') || Buffer.byteLength(content) > 65536) fail('WORKSPACE_ARTIFACT_INVALID');
    const prior = await observeCandidate(artifact);
    if (prior) return prior;
    const snapshot = await journal.read(current.taskId, current.inputRevision, 'source');
    if (realDigest(sourceRecord(workspace)) !== realDigest(snapshot)) fail('WORKSPACE_SOURCE_CHANGED');
    const before = document(projectRoot, snapshot.currentHead);
    if (content === before.content || (current.revision === 2 && (!before.exists || !content.startsWith(before.content)))) fail('DOCUMENT_APPEND_ONLY');
    await assertWorkspaceLease(claim);
    if (remote(current, snapshot.previousHead, snapshot.prNumber) !== snapshot.baseSha) fail('REMOTE_BASE_CHANGED');
    let managedReceipt = receipt(current);
    await journal.createExclusive(current.taskId, current.inputRevision, 'prepare', { ...current,
      slotId: claim.slotId, providerReceiptDigest, documentDigest: chiefWebRealDigest(content) });
    await log({ code: 'RWB_REAL_CANDIDATE_PREPARING', operationId: claim.slotId });
    await assertWorkspaceLease(claim);
    let repair = false;
    if (current.revision === 1) {
      if (!same(managedReceipt, { status: 'started', mode: null, baseCommit: snapshot.baseSha })) fail('WORKSPACE_RECEIPT_UNVERIFIED');
      clean(managedReceipt.featureWorktree, managedReceipt.featureBranch, snapshot.baseSha);
      writeDocument(managedReceipt.featureWorktree, before, content);
      const { featureWorktree, featureBranch } = managedReceipt;
      const featureHead = head(featureWorktree);
      managedReceipt = await managed(current, 'prepare', snapshot, claim, () => clean(featureWorktree, featureBranch, featureHead));
      if (!same(managedReceipt, { status: 'prepared', mode: null, baseCommit: snapshot.baseSha })) fail('WORKSPACE_RECEIPT_UNVERIFIED');
    } else {
      if (!same(managedReceipt, { status: 'awaiting_ci', mode: 'pr', integrationCommit: snapshot.previousHead, repairAttempts: 0 }) ||
          !same(managedReceipt.pullRequest, { number: snapshot.prNumber, url: snapshot.prUrl })) fail('WORKSPACE_RECEIPT_UNVERIFIED');
      const { integrationWorktree } = managedReceipt;
      clean(integrationWorktree, current.branch, snapshot.previousHead);
      repair = managedReceipt.baseCommit === snapshot.baseSha;
      if (!repair) {
        git(projectRoot, ['fetch', '--no-tags', 'origin', 'refs/heads/master:refs/remotes/origin/master']);
        if (git(projectRoot, ['rev-parse', 'refs/remotes/origin/master']) !== snapshot.baseSha ||
          !ancestor(projectRoot, managedReceipt.baseCommit, snapshot.baseSha)) fail('REMOTE_BASE_CHANGED');
        git(integrationWorktree, ['merge', '--no-edit', snapshot.baseSha]);
        if (document(integrationWorktree, head(integrationWorktree)).digest !== before.digest) fail('DOCUMENT_WORKTREE_CHANGED');
      }
      writeDocument(integrationWorktree, before, content);
      if (!repair) {
        const integrationHead = head(integrationWorktree);
        managedReceipt = await managed(current, 'prepare', snapshot, claim, () => clean(integrationWorktree, current.branch, integrationHead));
      }
      if (!repair && !same(managedReceipt, { status: 'prepared', mode: 'pr', baseCommit: snapshot.baseSha,
        baseRefreshPublishedHead: snapshot.previousHead })) fail('WORKSPACE_RECEIPT_UNVERIFIED');
    }
    const root = managedReceipt.integrationWorktree;
    const candidateSha = head(root);
    clean(root, current.branch, candidateSha);
    if ((!repair && managedReceipt.integrationCommit !== candidateSha) || !ancestor(root, snapshot.baseSha, candidateSha) ||
        (snapshot.previousHead !== null && !ancestor(root, snapshot.previousHead, candidateSha)) ||
        document(root, candidateSha).content !== content) fail('CANDIDATE_UNPROVEN');
    const paths = changedPaths(root, snapshot.baseSha, candidateSha);
    const verification = validVerification(await verifyCandidate({ worktree: root, candidateSha, changedPaths: paths }), candidateSha);
    clean(root, current.branch, candidateSha);
    if (remote(current, snapshot.previousHead, snapshot.prNumber) !== snapshot.baseSha) fail('REMOTE_BASE_CHANGED');
    const result = { verified: true, taskId: current.taskId, inputRevision: current.inputRevision, slotId: claim.slotId,
      targetDoc: REAL_RWB_DOCUMENT, checksPassed: true, baseSha: snapshot.baseSha, branch: current.branch,
      candidateSha, checksDigest: realDigest(verification), documentDigest: chiefWebRealDigest(content), developerSessionId,
      providerReceiptDigest, changedPaths: paths, verification, repair, managedReceiptDigest: realDigest(managedReceipt) };
    await journal.createExclusive(current.taskId, current.inputRevision, 'candidate', result);
    await log({ code: 'RWB_REAL_CANDIDATE_VERIFIED', operationId: claim.slotId });
    return result;
  }
  async function readPrepared(request) {
    const current = scope(request);
    const candidate = await journal.read(current.taskId, current.inputRevision, 'candidate');
    const review = await readReview(request);
    if (!same(candidate, { verified: true, candidateSha: request.candidateSha, baseSha: request.baseSha,
      branch: request.branch }) || !same(review, { verified: true, taskId: current.taskId, inputRevision: current.inputRevision,
      candidateSha: request.candidateSha, reviewDigest: request.reviewDigest, approved: true }) ||
      !uuid.test(review.reviewerSessionId ?? '') || review.reviewerSessionId === candidate.developerSessionId) fail('REVIEW_UNPROVEN');
    const managedReceipt = receipt(current);
    if (candidate.managedReceiptDigest !== realDigest(managedReceipt)) fail('WORKSPACE_RECEIPT_UNVERIFIED');
    const root = managedReceipt.integrationWorktree;
    clean(root, current.branch, candidate.candidateSha);
    clean(managedReceipt.featureWorktree, managedReceipt.featureBranch, managedReceipt.featureCommit);
    if (document(root, candidate.candidateSha).digest !== candidate.documentDigest ||
        !ancestor(root, candidate.baseSha, candidate.candidateSha) ||
        !ancestor(root, managedReceipt.featureCommit, candidate.candidateSha) ||
        (request.previousHead !== null && !ancestor(root, request.previousHead, candidate.candidateSha))) fail('CANDIDATE_UNPROVEN');
    return { ...candidate, changedPaths: changedPaths(root, candidate.baseSha, candidate.candidateSha),
      previousHead: request.previousHead, clean: true, descendsFromBase: true, descendsFromPreviousHead: true,
      operationId: request.operationId, reviewDigest: request.reviewDigest };
  }
  return Object.freeze({ read, observeSource: request => read(request, { readOnly: true }),
    prepare, observeCandidate, readPrepared, safeCandidateHandoffReplay: true });
}
