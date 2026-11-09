import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const { taskId, repository, pullRequest, previousHead } = CHIEF_WEB_PILOT;
const deliveryTaskId = 'super-agent-' + taskId;
const branch = 'codex/integrate-' + deliveryTaskId;
const prUrl = 'https://github.com/' + repository + '/pull/' + pullRequest;
const remoteUrls = new Set(['git@github.com:' + repository + '.git', 'https://github.com/' + repository + '.git']);
const endpoint = 'repos/' + repository;
const digest = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const checks = ['documentation-governance', 'project-constraints', 'python-file-index'];
const toolManifestDigest = '28bcf6be9fe003ee1e7a6395f6d0b42b9552d53c4c4d52a2d31eccdf9ed0274f';
const toolFiles = ['git_safety.mjs', 'git_backup_store.mjs', 'resource_lifecycle.mjs', 'backup_fd_clone.mjs', 'backup_fd_clone.py', 'backup_capacity.mjs'];
const is = (pattern, value) => typeof value === 'string' && pattern.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
const fail = code => { throw Object.assign(new Error(code), { code }); };

function checkRemoteScope(scope) {
  if (!same(scope, { repository, pullRequest, branch }) || !is(commit, scope.candidateSha)) {
    fail('CHIEF_WEB_RECOVERY_RWB_SCOPE_DENIED');
  }
}

function checkScope(scope) {
  checkRemoteScope(scope);
  if (!same(scope, { taskId, previousHead, path: CHIEF_WEB_PILOT.path }) ||
      scope.candidateSha === previousHead || !is(commit, scope.baseCommit) ||
      !['scopeDigest', 'leaseDigest', 'inputRevision', 'confirmationOperationId', 'reviewDigest']
        .every(key => is(digest, scope[key]))) {
    fail('CHIEF_WEB_RECOVERY_RWB_SCOPE_DENIED');
  }
}

function publicationProof(scope) {
  const proof = {
    verified: true, repository, pullRequest, taskId, branch, previousHead, candidateSha: scope.candidateSha,
    baseCommit: scope.baseCommit, inputRevision: scope.inputRevision, reviewDigest: scope.reviewDigest,
    scopeDigest: scope.scopeDigest, operationId: scope.operationId, confirmationOperationId: scope.confirmationOperationId,
    status: 'awaiting_ci', updatedExisting: true, safetyAutoMergeDeferred: true,
  };
  return Object.freeze({ ...proof, receiptDigest: hash(JSON.stringify(proof)) });
}

function readVerification(value, candidateSha) {
  if (!same(value, { status: 'passed', candidateSha }) || typeof value.command !== 'string' ||
      !value.command.trim() || value.command.length > 1024 ||
      !Number.isSafeInteger(value.durationSeconds) || value.durationSeconds < 0 ||
      !Array.isArray(value.checks) || value.checks.length !== checks.length ||
      value.checks.some((check, index) => !same(check, { name: checks[index], exitCode: 0 }) ||
        !Number.isSafeInteger(check.durationMs) || check.durationMs < 0)) {
    fail('CHIEF_WEB_RECOVERY_RWB_VERIFICATION_UNPROVEN');
  }
  return { status: value.status, command: value.command, durationSeconds: value.durationSeconds };
}

/** Load the exact immutable RWB safety bundle previously verified for this task. */
export async function loadChiefWebRecoveryRwbTool({ toolRoot, ownerUid = process.getuid?.() } = {}) {
  function directory(filename) {
    const stat = fs.lstatSync(filename);
    if (!stat.isDirectory() || stat.uid !== ownerUid || (stat.mode & 0o222) !== 0) throw new Error();
  }
  function read(filename) {
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.uid !== ownerUid || stat.nlink !== 1 || (stat.mode & 0o222) !== 0 ||
          stat.size < 1 || stat.size > 262144) throw new Error();
      const bytes = fs.readFileSync(descriptor);
      if (bytes.length !== stat.size) throw new Error();
      return bytes;
    } finally {
      fs.closeSync(descriptor);
    }
  }
  try {
    if (typeof toolRoot !== 'string' || !path.isAbsolute(toolRoot) || fs.realpathSync(toolRoot) !== toolRoot) throw new Error();
    directory(toolRoot);
    directory(path.join(toolRoot, 'scripts'));
    const bytes = read(path.join(toolRoot, 'manifest.json'));
    if (hash(bytes) !== toolManifestDigest) throw new Error();
    const { files } = JSON.parse(bytes);
    if (!Array.isArray(files) || files.length !== toolFiles.length) throw new Error();
    for (const [index, name] of toolFiles.entries()) {
      const relative = 'scripts/' + name;
      const file = read(path.join(toolRoot, relative));
      if (!same(files[index], { path: relative, bytes: file.length, sha256: hash(file) })) throw new Error();
    }
    const { runDelivery } = await import(pathToFileURL(path.join(toolRoot, 'scripts', toolFiles[0])).href);
    if (typeof runDelivery !== 'function') throw new Error();
    return runDelivery;
  } catch {
    fail('CHIEF_WEB_RECOVERY_RWB_TOOL_UNVERIFIED');
  }
}

/**
 * Mac host port for one already-prepared RWB delivery. The deployment owns
 * private receipt reads, the pinned git_safety runDelivery function, and an
 * exclusive branch/pause fence held until the async callback completes.
 * ghGet is a synchronous GET-only transport. No raw runner is exposed.
 */
export function createChiefWebRecoveryRwbHost({
  projectRoot, worktreeRoot, readPrepared, readPublicationReceipt, readCiEvidence, readDeliveryReceipt,
  withPublicationFence, runDelivery, ghGet, recordPublication, log, now = Date.now,
} = {}) {
  if (![projectRoot, worktreeRoot].every(value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value) ||
      ![readPrepared, readPublicationReceipt, readCiEvidence, readDeliveryReceipt, withPublicationFence,
        runDelivery, ghGet, recordPublication, log, now].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_RECOVERY_RWB_CONFIGURATION_INVALID');
  }

  function get(target) {
    const data = ghGet(target, { method: 'GET' });
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.then === 'function') {
      fail('CHIEF_WEB_RECOVERY_RWB_GITHUB_READ_FAILED');
    }
    return data;
  }

  function settings() {
    const repo = get(endpoint);
    if (!same(repo, { full_name: repository, default_branch: 'master', private: false, allow_auto_merge: false })) {
      fail('CHIEF_WEB_RECOVERY_RWB_REPOSITORY_CHANGED');
    }
    return repo;
  }

  function refSha(name) {
    const remote = get(endpoint + '/git/ref/heads/' + name);
    if (remote.ref !== 'refs/heads/' + name || remote.object?.type !== 'commit' || !is(commit, remote.object.sha)) {
      fail('CHIEF_WEB_RECOVERY_RWB_REMOTE_REF_UNPROVEN');
    }
    return remote.object.sha;
  }

  function readRemote(scope) {
    checkRemoteScope(scope);
    settings();
    const pr = get(endpoint + '/pulls/' + pullRequest);
    const headSha = refSha(branch);
    const baseSha = refSha('master');
    if (!same(pr, { number: pullRequest, html_url: prUrl, state: 'open', auto_merge: null, merged: false }) ||
        !same(pr.head, { ref: branch, sha: headSha }) || !same(pr.base, { ref: 'master' }) ||
        pr.head.repo?.full_name !== repository || pr.base.repo?.full_name !== repository) {
      fail('CHIEF_WEB_RECOVERY_RWB_REMOTE_PR_CHANGED');
    }
    return {
      verified: true, repository, pullRequest, headRepository: repository, headSha, headRef: branch,
      baseRepository: repository, baseRef: 'master', baseSha, state: 'open', public: true,
      autoMergeAllowed: false, autoMergeRequested: false,
    };
  }

  function readManagedReceipt(scope, bytes, published = false) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 262144 ||
        (!published && hash(bytes) !== scope.deliveryReceiptDigest)) {
      fail('CHIEF_WEB_RECOVERY_RWB_DELIVERY_RECEIPT_CHANGED');
    }
    let receipt;
    try {
      receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      fail('CHIEF_WEB_RECOVERY_RWB_DELIVERY_RECEIPT_CHANGED');
    }
    if (!same(receipt, {
      taskId: deliveryTaskId, repositoryRoot: projectRoot, status: published ? 'awaiting_ci' : 'prepared', mode: 'pr',
      remote: 'origin', defaultBranch: 'master', integrationBranch: branch, integrationCommit: scope.candidateSha,
      baseCommit: scope.baseCommit, baseRefreshPublishedHead: published ? scope.candidateSha : previousHead,
    }) || !remoteUrls.has(receipt.remoteUrl) || receipt.pullRequest?.url !== prUrl ||
        typeof receipt.integrationWorktree !== 'string' || path.dirname(receipt.integrationWorktree) !== worktreeRoot ||
        !/^[a-z0-9-]+$/.test(path.basename(receipt.integrationWorktree))) {
      fail('CHIEF_WEB_RECOVERY_RWB_DELIVERY_RECEIPT_CHANGED');
    }
    return receipt;
  }

  async function persistPublication(scope) {
    const witnessed = publicationProof(scope);
    try {
      await recordPublication(witnessed);
    } catch (error) {
      if (error?.code !== 'EEXIST' || !same(await readPublicationReceipt(scope), witnessed)) {
        fail('CHIEF_WEB_RECOVERY_RWB_PUBLICATION_UNPROVEN');
      }
    }
    await log({ code: 'CHIEF_WEB_RECOVERY_RWB_PUBLISH_OBSERVED' });
    return witnessed;
  }

  async function observeClaimedPublication(scope, claim) {
    checkScope(scope);
    if (!same(claim, { schemaVersion: 1, action: 'publish_existing_pr', operationId: scope.operationId,
      confirmationOperationId: scope.confirmationOperationId, scopeDigest: scope.scopeDigest }) ||
        !Number.isSafeInteger(claim.claimedAt) || claim.claimedAt >= scope.expiresAt) {
      fail('CHIEF_WEB_RECOVERY_RWB_DISPATCH_CLAIM_CHANGED');
    }
    const remote = readRemote(scope);
    if (remote.headSha !== scope.candidateSha) return null;
    const owned = await readDeliveryReceipt({ projectRoot, taskId: deliveryTaskId });
    let receipt;
    try {
      receipt = readManagedReceipt(scope, owned?.bytes, true);
    } catch (error) {
      if (error?.code === 'CHIEF_WEB_RECOVERY_RWB_DELIVERY_RECEIPT_CHANGED') return null;
      throw error;
    }
    const recordedAt = Date.parse(receipt.verification?.recordedAt);
    if (receipt.verification?.status !== 'passed' || receipt.ci?.status !== 'pending' ||
        !Number.isSafeInteger(recordedAt) || recordedAt < claim.claimedAt || recordedAt > now()) return null;
    if (readRemote(scope).headSha !== scope.candidateSha) return null;
    return persistPublication(scope);
  }

  function assertPrepared(scope, prepared) {
    if (!same(prepared, {
      verified: true, taskId, inputRevision: scope.inputRevision, candidateSha: scope.candidateSha, previousHead,
      baseCommit: scope.baseCommit, branch, leaseDigest: scope.leaseDigest, scopeDigest: scope.scopeDigest,
      confirmationOperationId: scope.confirmationOperationId, reviewDigest: scope.reviewDigest,
      deliveryReceiptDigest: scope.deliveryReceiptDigest, clean: true, descendsFromBase: true,
      descendsFromPreviousHead: true, drained: true, pauseFenceClear: true,
    }) || !Array.isArray(prepared.changedPaths) || prepared.changedPaths.length !== 1 ||
        prepared.changedPaths[0] !== CHIEF_WEB_PILOT.path) {
      fail('CHIEF_WEB_RECOVERY_RWB_PREPARED_EVIDENCE_DENIED');
    }
  }

  function githubRunnerFor(assertCurrent, assertRemoteBefore) {
    return (executable, args, extra) => {
      if (executable !== 'gh' || !Array.isArray(args) || extra?.cwd !== projectRoot ||
          Object.keys(extra).length !== 1 || args.some(arg => typeof arg !== 'string')) {
        fail('CHIEF_WEB_RECOVERY_RWB_COMMAND_DENIED');
      }
      assertCurrent();
      let response;
      const signature = JSON.stringify(args);
      if (signature === JSON.stringify(['api', endpoint])) {
        response = settings();
        // This is the safety publisher's final GitHub preflight before it
        // enters the prepared-PR branch. The host fence remains held.
        assertRemoteBefore();
      } else if (signature === JSON.stringify(['repo', 'view', '--json', 'visibility,nameWithOwner'])) {
        settings();
        response = { visibility: 'PUBLIC', nameWithOwner: repository };
      } else if (signature === JSON.stringify(['run', 'list', '--repo', repository, '--limit', '20', '--json', 'status,conclusion'])) {
        response = get(endpoint + '/actions/runs?per_page=20').workflow_runs;
        if (!Array.isArray(response)) fail('CHIEF_WEB_RECOVERY_RWB_GITHUB_READ_FAILED');
      } else {
        fail('CHIEF_WEB_RECOVERY_RWB_COMMAND_DENIED');
      }
      assertCurrent();
      return { status: 0, stdout: JSON.stringify(response), stderr: '' };
    };
  }

  async function publishExisting(scope) {
    checkScope(scope);
    if (!is(digest, scope.operationId) || !is(digest, scope.deliveryReceiptDigest) || !Number.isSafeInteger(scope.expiresAt)) {
      fail('CHIEF_WEB_RECOVERY_RWB_SCOPE_DENIED');
    }
    const request = Object.freeze({ ...scope });
    let entered = false;
    return withPublicationFence(request, async readFence => {
      if (entered || typeof readFence !== 'function') fail('CHIEF_WEB_RECOVERY_RWB_FENCE_DENIED');
      entered = true;
      function assertCurrent() {
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp) || timestamp >= request.expiresAt || !same(readFence(), {
          verified: true, exclusive: true, drained: true, pauseFenceClear: true, taskId, repository, pullRequest, branch,
          operationId: request.operationId, scopeDigest: request.scopeDigest, leaseDigest: request.leaseDigest,
          confirmationOperationId: request.confirmationOperationId, previousHead, baseCommit: request.baseCommit,
          candidateSha: request.candidateSha, deliveryReceiptDigest: request.deliveryReceiptDigest,
        })) {
          fail('CHIEF_WEB_RECOVERY_RWB_FENCE_DENIED');
        }
      }

      assertCurrent();
      const prepared = await readPrepared(request);
      assertPrepared(request, prepared);
      const verification = readVerification(prepared.verification, request.candidateSha);
      function assertRemoteBefore() {
        const before = readRemote(request);
        if (before.headSha !== previousHead || before.baseSha !== request.baseCommit) {
          fail('CHIEF_WEB_RECOVERY_RWB_REMOTE_PR_CHANGED');
        }
      }
      assertRemoteBefore();
      await log({ code: 'CHIEF_WEB_RECOVERY_RWB_PUBLISH_DISPATCH' });
      const owned = await readDeliveryReceipt({ projectRoot, taskId: deliveryTaskId });
      const receipt = readManagedReceipt(request, owned?.bytes);
      assertCurrent();
      const result = await runDelivery({ projectRoot, taskId: deliveryTaskId, action: 'publish', verification }, {
        identityRoot: projectRoot, githubRunner: githubRunnerFor(assertCurrent, assertRemoteBefore),
      });
      if (!same(result, {
        taskId: deliveryTaskId, mode: 'pr', status: 'awaiting_ci', safetyAutoMergeDeferred: true,
        integrationBranch: branch, integrationWorktree: receipt.integrationWorktree, integrationCommit: request.candidateSha,
        baseCommit: request.baseCommit, baseRefreshPublishedHead: request.candidateSha,
      }) || result.updatedExisting === false || result.pullRequest?.url !== prUrl) {
        fail('CHIEF_WEB_RECOVERY_RWB_PUBLICATION_UNPROVEN');
      }
      const after = readRemote(request);
      if (after.headSha !== request.candidateSha) fail('CHIEF_WEB_RECOVERY_RWB_PUBLICATION_UNPROVEN');
      return persistPublication(request);
    });
  }

  return Object.freeze({
    readPrepared(scope) { checkScope(scope); return readPrepared(scope); },
    readRemote,
    readPublicationReceipt(scope) { checkScope(scope); return readPublicationReceipt(scope); },
    readCiEvidence(scope, eventId) { checkScope(scope); return readCiEvidence(scope, eventId); },
    observeClaimedPublication,
    publishExisting,
  });
}

/**
 * Process the Docker handoff addressed by its confirmation operation ID. The
 * host journal maps (ID, filename) to the owned recovery-host directory.
 * createExclusive must durably persist a new record or throw EEXIST.
 */
export async function runChiefWebRecoveryHostPublication(confirmationOperationId, {
  journal, host, log, now = Date.now,
} = {}) {
  if (!is(digest, confirmationOperationId) || ![journal?.read, journal?.createExclusive,
    host?.publishExisting, host?.readPublicationReceipt, host?.observeClaimedPublication, log, now]
    .every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_RECOVERY_RWB_OPERATOR_CONFIGURATION_INVALID');
  }
  const request = await journal.read(confirmationOperationId, 'request.json');
  if (request === null) fail('CHIEF_WEB_RECOVERY_RWB_REQUEST_MISSING');
  const scope = request?.scope;
  checkScope(scope);
  const operationId = hash(JSON.stringify([confirmationOperationId, 'publish']));
  const expectedKeys = ['taskId', 'grantId', 'conversationId', 'generation', 'inputRevision', 'candidateSha', 'previousHead',
    'reviewDigest', 'repository', 'pullRequest', 'path', 'baseCommit', 'branch', 'leaseDigest', 'confirmationOperationId',
    'expiresAt', 'scopeDigest', 'operationId', 'deliveryReceiptDigest'];
  if (!same(request, { schemaVersion: 1, action: 'publish_existing_pr' }) || Object.keys(request).length !== 3 ||
      Object.keys(scope).length !== expectedKeys.length || !expectedKeys.every(key => Object.hasOwn(scope, key)) ||
      !same(scope, { confirmationOperationId, operationId }) || !is(uuid, scope.grantId) || !is(uuid, scope.conversationId) ||
      !Number.isSafeInteger(scope.generation) || scope.generation < 0 || !Number.isSafeInteger(scope.expiresAt) ||
      !is(digest, scope.deliveryReceiptDigest)) {
    fail('CHIEF_WEB_RECOVERY_RWB_REQUEST_INVALID');
  }
  const boundScope = Object.freeze({ ...scope });
  const claimName = 'host-dispatch.json';
  const claim = Object.freeze({
    schemaVersion: 1, action: 'publish_existing_pr', confirmationOperationId, operationId, scopeDigest: scope.scopeDigest,
    requestDigest: hash(JSON.stringify(expectedKeys.map(key => boundScope[key]))),
  });
  async function observe(existing) {
    const receipt = await host.readPublicationReceipt(boundScope) ?? await host.observeClaimedPublication(boundScope, existing);
    const expected = publicationProof(boundScope);
    if (receipt == null) {
      const code = 'CHIEF_WEB_RECOVERY_RWB_RESULT_UNKNOWN';
      await log({ code, operationId });
      return { status: 'unknown', code, operationId };
    }
    if (!same(receipt, expected)) fail('CHIEF_WEB_RECOVERY_RWB_PUBLICATION_UNPROVEN');
    const code = 'CHIEF_WEB_RECOVERY_RWB_PUBLISH_OBSERVED';
    await log({ code, operationId });
    return { status: 'published', code, operationId, evidenceDigest: receipt.receiptDigest };
  }

  let existing = await journal.read(confirmationOperationId, claimName);
  let createdAt = null;
  if (existing === null) {
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp >= boundScope.expiresAt) fail('CHIEF_WEB_RECOVERY_RWB_FENCE_DENIED');
    try {
      await journal.createExclusive(confirmationOperationId, claimName, Object.freeze({ ...claim, claimedAt: timestamp }));
      createdAt = timestamp;
    } catch (error) {
      if (error?.code !== 'EEXIST') fail('CHIEF_WEB_RECOVERY_RWB_DISPATCH_CLAIM_UNKNOWN');
    }
    existing = await journal.read(confirmationOperationId, claimName);
  }
  if (!same(existing, claim) || !Number.isSafeInteger(existing.claimedAt) || existing.claimedAt >= boundScope.expiresAt ||
      (createdAt !== null && existing.claimedAt !== createdAt)) {
    fail('CHIEF_WEB_RECOVERY_RWB_DISPATCH_CLAIM_CHANGED');
  }
  if (createdAt === null) return observe(existing);

  await log({ code: 'CHIEF_WEB_RECOVERY_RWB_DISPATCH_CLAIMED', operationId });
  try {
    await host.publishExisting(boundScope);
  } catch {
    // The durable claim reserves this attempt even if transport, tool or
    // observation failed. Authoritative receipt inspection is the only replay.
    await log({ code: 'CHIEF_WEB_RECOVERY_RWB_DISPATCH_RECONCILIATION_REQUIRED', operationId });
  }
  return observe(existing);
}
