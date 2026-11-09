import path from 'node:path';
import { REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY, realDigest } from './chief-web-real-engine.mjs';
import { loadChiefWebRecoveryRwbTool } from './chief-web-recovery-rwb-host.mjs';

const endpoint = 'repos/' + REAL_RWB_REPOSITORY;
const base = 'master';
const owner = REAL_RWB_REPOSITORY.split('/')[0];
const prPrefix = 'https://github.com/' + REAL_RWB_REPOSITORY + '/pull/';
const allowedRemotes = new Set(['git@github.com:' + REAL_RWB_REPOSITORY + '.git', 'https://github.com/' + REAL_RWB_REPOSITORY + '.git']);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const commit = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const checks = ['documentation-governance', 'project-constraints', 'python-file-index'];
const checkSuccess = new Set(['success', 'neutral', 'skipped']);
const checkFailure = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure']);
const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
const validId = value => Number.isSafeInteger(value) && value > 0;
const fail = code => { throw Object.assign(new Error('RWB_REAL_' + code), { code: 'RWB_REAL_' + code }); };
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value;
const unknown = { status: 'unknown', code: 'RWB_REAL_PUBLICATION_UNKNOWN' };
const pending = { status: 'pending' };
const errorCode = (error, fallback) => /^RWB_REAL_[A-Z_]+$/.test(error?.code ?? '') ? error.code : fallback;

export function chiefWebRealDeliveryIdentity(taskId) {
  if (!uuid.test(taskId ?? '')) fail('SCOPE_DENIED');
  const deliveryTaskId = 'super-agent-' + taskId;
  return { deliveryTaskId, branch: 'codex/integrate-' + deliveryTaskId };
}

function scopeFor(request, role) {
  const { deliveryTaskId, branch } = chiefWebRealDeliveryIdentity(request?.taskId);
  if (!same(request, { role, branch, repository: REAL_RWB_REPOSITORY, targetDoc: REAL_RWB_DOCUMENT }) ||
      ![1, 2].includes(request.revision) || !digest.test(request.inputRevision ?? '') ||
      !uuid.test(request.operationId ?? '') || !commit.test(request.candidateSha ?? '') ||
      !commit.test(request.baseSha ?? '') || request.candidateSha === request.baseSha || !digest.test(request.reviewDigest ?? '')) {
    fail('SCOPE_DENIED');
  }
  const { taskId, operationId, inputRevision, revision, candidateSha, baseSha, reviewDigest } = request;
  const { pr, previousHead, confirmation } = request;
  const expectedPrior = role === 'ci' ? candidateSha : previousHead;
  if (role === 'ci' || revision === 2) {
    if (!validId(pr?.number) || !same(pr, { url: prPrefix + pr.number, branch, headSha: expectedPrior }) ||
        !commit.test(pr.headSha) || !commit.test(pr.baseSha) ||
        (role === 'ci' && (!same(request, { headSha: candidateSha }) || pr.baseSha !== baseSha))) fail('PR_SCOPE_DENIED');
  } else if (pr !== null || previousHead !== null) {
    fail('PR_SCOPE_DENIED');
  }
  const scope = { taskId, operationId, inputRevision, revision, deliveryTaskId, branch, candidateSha, baseSha, reviewDigest,
    previousHead, number: pr?.number ?? null };
  if (role === 'publish') {
    if (!same(confirmation, { candidateSha, baseSha, previousHead, reviewDigest }) || !uuid.test(confirmation.requestId ?? '') ||
        !Number.isSafeInteger(confirmation.expiresAt) || candidateSha === previousHead) fail('CONFIRMATION_DENIED');
    Object.assign(scope, { confirmationId: confirmation.requestId, expiresAt: confirmation.expiresAt });
  }
  return Object.freeze({ ...scope, scopeDigest: realDigest(scope) });
}

function proof(scope, evidenceDigest, result) {
  return { status: 'completed', taskId: scope.taskId, operationId: scope.operationId,
    inputRevision: scope.inputRevision, evidenceDigest, result };
}

/** The worker is assembled on the RWB host with the pinned, read-only tool bundle. */
export async function loadChiefWebRealPublisher({ toolRoot, ...ports } = {}) {
  const runDelivery = await loadChiefWebRecoveryRwbTool({ toolRoot });
  return createChiefWebRealPublisher({ ...ports, runDelivery });
}

/** All injected ports belong to the deployment. The fence covers local and remote branch writers, confirmation and pause. */
export function createChiefWebRealPublisher({ projectRoot, worktreeRoot, runDelivery, controller, readPrepared,
  withPublicationFence, verifyPush, recordResources, journal, github, log, now = Date.now } = {}) {
  if (![projectRoot, worktreeRoot].every(absolute) || projectRoot === worktreeRoot ||
      ![runDelivery, controller?.readDeliveryReceipt, controller?.publishDelivery, readPrepared, withPublicationFence,
        verifyPush, recordResources, journal?.read, journal?.createExclusive, github?.get, github?.createPullRequest, log, now]
        .every(fn => typeof fn === 'function')) fail('PUBLISHER_CONFIGURATION_INVALID');

  function get(suffix, { absent = false, array = false } = {}) {
    const data = github.get(endpoint + suffix);
    if (absent && data === null) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data) !== array || typeof data.then === 'function') {
      fail('GITHUB_READ_FAILED');
    }
    return data;
  }

  function settings() {
    const repo = get('');
    if (!same(repo, { full_name: REAL_RWB_REPOSITORY, default_branch: base, private: false, allow_auto_merge: false })) {
      fail('REPOSITORY_CHANGED');
    }
    return repo;
  }

  function refSha(name, absent = false) {
    const ref = get('/git/ref/heads/' + name, { absent });
    if (ref === null) return null;
    if (ref.ref !== 'refs/heads/' + name || ref.object?.type !== 'commit' || !commit.test(ref.object.sha ?? '')) {
      fail('REMOTE_REF_UNPROVEN');
    }
    return ref.object.sha;
  }

  function matchingPrs(scope) {
    return get('/pulls?' + new URLSearchParams({ state: 'all', head: owner + ':' + scope.branch,
      base, per_page: '2' }), { array: true });
  }

  function assertPullRequest(row, scope, number, headSha) {
    if (!same(row, { number, html_url: prPrefix + number, state: 'open', auto_merge: null }) || row.merged === true ||
        !same(row.head, { ref: scope.branch, sha: headSha }) || !same(row.base, { ref: base }) ||
        row.head.repo?.full_name !== REAL_RWB_REPOSITORY || row.base.repo?.full_name !== REAL_RWB_REPOSITORY) {
      fail('REMOTE_PR_CHANGED');
    }
  }

  function readPullRequest(scope, number, headSha) {
    const pr = get('/pulls/' + number);
    assertPullRequest(pr, scope, number, headSha);
    if (pr.merged !== false || refSha(scope.branch) !== headSha) fail('REMOTE_PR_CHANGED');
    return pr;
  }

  function readUniquePullRequest(scope, number, headSha) {
    const matches = matchingPrs(scope);
    if (matches.length !== 1) fail('REMOTE_PR_IDENTITY_UNPROVEN');
    assertPullRequest(matches[0], scope, number, headSha);
    return readPullRequest(scope, number, headSha);
  }

  function assertBefore(scope) {
    if (refSha(base) !== scope.baseSha) fail('REMOTE_BASE_CHANGED');
    if (scope.number !== null) {
      readUniquePullRequest(scope, scope.number, scope.previousHead);
    } else if (refSha(scope.branch, true) !== null || matchingPrs(scope).length) {
      fail('REMOTE_BRANCH_ALREADY_USED');
    }
  }

  function readManaged(scope, published, repair) {
    const receipt = controller.readDeliveryReceipt({ projectRoot, taskId: scope.deliveryTaskId });
    if (!same(receipt, { taskId: scope.deliveryTaskId, repositoryRoot: projectRoot, integrationBranch: scope.branch,
      integrationCommit: repair && !published ? scope.previousHead : scope.candidateSha,
      baseCommit: scope.baseSha, defaultBranch: base, remote: 'origin',
      status: published || repair ? 'awaiting_ci' : 'prepared', mode: published || scope.revision === 2 ? 'pr' : null }) ||
      !allowedRemotes.has(receipt.remoteUrl) || !absolute(receipt.integrationWorktree) ||
      path.dirname(receipt.integrationWorktree) !== worktreeRoot || !/^[a-z0-9-]+$/.test(path.basename(receipt.integrationWorktree))) {
      fail('MANAGED_RECEIPT_CHANGED');
    }
    if (scope.revision === 2) {
      const expectedPublishedHead = published ? scope.candidateSha : scope.previousHead;
      if (!same(receipt.pullRequest, { number: scope.number, url: prPrefix + scope.number }) ||
          (receipt.baseRefreshPublishedHead !== expectedPublishedHead && !(repair && receipt.baseRefreshPublishedHead == null)) ||
          (repair && receipt.repairAttempts !== (published ? 1 : 0))) fail('MANAGED_RECEIPT_CHANGED');
    } else if (receipt.baseRefreshPublishedHead != null || (published
      ? !validId(receipt.pullRequest?.number) || receipt.pullRequest.url !== prPrefix + receipt.pullRequest.number
      : receipt.pullRequest !== null)) {
      fail('MANAGED_RECEIPT_CHANGED');
    }
    return receipt;
  }

  function preparedVerification(scope, prepared) {
    if (!same(prepared, { verified: true, taskId: scope.taskId, inputRevision: scope.inputRevision,
      operationId: scope.operationId, candidateSha: scope.candidateSha, baseSha: scope.baseSha,
      branch: scope.branch, previousHead: scope.previousHead, reviewDigest: scope.reviewDigest,
      clean: true, descendsFromBase: true }) || (scope.revision === 2 && prepared.descendsFromPreviousHead !== true) ||
      !digest.test(prepared.managedReceiptDigest ?? '') || !Array.isArray(prepared.changedPaths) ||
      prepared.changedPaths.length !== 1 || prepared.changedPaths[0] !== REAL_RWB_DOCUMENT) fail('PREPARED_UNVERIFIED');
    const verification = prepared.verification;
    if (!same(verification, { status: 'passed', candidateSha: scope.candidateSha }) ||
        typeof verification.command !== 'string' || !verification.command.trim() || verification.command.length > 1024 ||
        !Number.isSafeInteger(verification.durationSeconds) || verification.durationSeconds < 0 ||
        !Array.isArray(verification.checks) || verification.checks.length !== checks.length ||
        checks.some(name => !verification.checks.some(row => same(row, { name, exitCode: 0 }) &&
          Number.isSafeInteger(row.durationMs) && row.durationMs >= 0))) fail('VERIFICATION_UNPROVEN');
    return { status: 'passed', command: verification.command.trim(), durationSeconds: verification.durationSeconds };
  }

  function githubRunner(scope, assertCurrent) {
    let attemptedCreate = false;
    return (executable, args, extra) => {
      assertCurrent();
      if (executable !== 'gh' || !Array.isArray(args) || !same(extra, { cwd: projectRoot }) ||
          Object.keys(extra).length !== 1 || args.some(arg => typeof arg !== 'string')) fail('GITHUB_COMMAND_DENIED');
      const [repo, branch] = [REAL_RWB_REPOSITORY, scope.branch];
      const equalArgs = expected => expected.length === args.length && expected.every((item, index) => item === args[index]);
      let response;
      if (equalArgs(['api', endpoint])) {
        response = settings();
        assertBefore(scope);
      } else if (equalArgs(['repo', 'view', '--json', 'visibility,nameWithOwner'])) {
        settings();
        response = { visibility: 'PUBLIC', nameWithOwner: repo };
      } else if (equalArgs(['run', 'list', '--repo', repo, '--limit', '20', '--json', 'status,conclusion'])) {
        response = get('/actions/runs?per_page=20').workflow_runs;
        if (!Array.isArray(response)) fail('GITHUB_READ_FAILED');
      } else if (scope.revision === 1 && equalArgs(['pr', 'list', '--repo', repo, '--head', branch,
        '--base', base, '--state', 'open', '--json', 'url,headRefOid'])) {
        if (matchingPrs(scope).length) fail('REMOTE_BRANCH_ALREADY_USED');
        response = [];
      } else if (scope.revision === 1 && !attemptedCreate && args.length === 12 &&
          equalArgs(['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title',
            'merge: deliver ' + scope.deliveryTaskId, '--body-file', args[11]]) && absolute(args[11]) &&
          /^pr-body-[a-f0-9-]{36}\.md$/.test(path.basename(args[11]))) {
        if (verifyPush(scope) !== true || refSha(base) !== scope.baseSha ||
            refSha(branch) !== scope.candidateSha || matchingPrs(scope).length) {
          fail('REMOTE_PR_CREATION_DENIED');
        }
        assertCurrent();
        attemptedCreate = true;
        const created = github.createPullRequest({ repository: repo, head: branch, base,
          title: args[9], body: 'Managed ResearchWorkbench delivery ' + scope.deliveryTaskId +
            '.\n\nCandidate: ' + scope.candidateSha + '\nVerification: passed.\n' });
        if (!validId(created?.number) || created.html_url !== prPrefix + created.number) fail('PR_CREATION_UNPROVEN');
        readUniquePullRequest(scope, created.number, scope.candidateSha);
        assertCurrent();
        return { status: 0, stdout: created.html_url + '\n', stderr: '' };
      } else {
        fail('GITHUB_COMMAND_DENIED');
      }
      assertCurrent();
      return { status: 0, stdout: JSON.stringify(response), stderr: '' };
    };
  }

  async function observe(scope, claim = undefined) {
    const entry = claim ?? await journal.read(scope.operationId);
    if (!same(entry, { schemaVersion: 1, scopeDigest: scope.scopeDigest, operationId: scope.operationId }) ||
        !Number.isSafeInteger(entry.claimedAt) || entry.claimedAt >= scope.expiresAt ||
        typeof entry.repair !== 'boolean' || (entry.repair && scope.revision !== 2) ||
        !digest.test(entry.verificationDigest ?? '')) return unknown;
    try {
      if (verifyPush(scope) !== true) return unknown;
      const receipt = readManaged(scope, true, entry.repair);
      const { status, command, durationSeconds, recordedAt } = receipt.verification ?? {};
      if (receipt.ci?.status !== 'pending' || realDigest({ status, command, durationSeconds }) !== entry.verificationDigest ||
          !(Date.parse(recordedAt) >= entry.claimedAt && Date.parse(recordedAt) <= now()) ||
          receipt.remoteCommit !== scope.baseSha) return unknown;
      settings();
      const { number, url } = receipt.pullRequest;
      readUniquePullRequest(scope, number, scope.candidateSha);
      if (refSha(base) !== scope.baseSha) return unknown;
      const result = { number, url, branch: scope.branch, headSha: scope.candidateSha, baseSha: scope.baseSha };
      await log({ code: 'RWB_REAL_PUBLICATION_OBSERVED', operationId: scope.operationId });
      return proof(scope, realDigest([entry, realDigest(receipt), result]), result);
    } catch {
      await log({ code: 'RWB_REAL_PUBLICATION_UNKNOWN', operationId: scope.operationId });
      return unknown;
    }
  }

  async function publish(request, lease) {
    const scope = scopeFor(request, 'publish');
    const existing = await journal.read(scope.operationId);
    if (existing !== null) return observe(scope, existing);
    let entered = false;
    let claimed = false;
    try {
      await withPublicationFence(scope, async readFence => {
        if (entered || typeof readFence !== 'function') fail('FENCE_DENIED');
        entered = true;
        function assertCurrent() {
          const at = now();
          if (!Number.isSafeInteger(at) || at >= scope.expiresAt || !same(readFence(), {
            verified: true, exclusive: true, drained: true, pauseFenceClear: true, scopeDigest: scope.scopeDigest,
            taskId: scope.taskId, operationId: scope.operationId, branch: scope.branch, previousHead: scope.previousHead,
            candidateSha: scope.candidateSha, baseSha: scope.baseSha, confirmationId: scope.confirmationId,
          })) fail('FENCE_DENIED');
        }
        assertCurrent();
        const prepared = await readPrepared(request);
        const verification = preparedVerification(scope, prepared);
        const repair = prepared.repair === true;
        if (repair && scope.revision !== 2) fail('MANAGED_SCOPE_DENIED');
        const assertReceipt = () => {
          if (realDigest(readManaged(scope, false, repair)) !== prepared.managedReceiptDigest) fail('MANAGED_RECEIPT_CHANGED');
        };
        assertReceipt();
        settings();
        assertBefore(scope);
        requiredChecks();
        await log({ code: 'RWB_REAL_PUBLICATION_RESERVING', operationId: scope.operationId });
        assertCurrent();
        try {
          await journal.createExclusive(scope.operationId, { schemaVersion: 1, scopeDigest: scope.scopeDigest,
            operationId: scope.operationId, claimedAt: now(), verificationDigest: realDigest(verification), repair });
          claimed = true;
        } catch (error) {
          if (error?.code !== 'EEXIST') fail('PUBLICATION_CLAIM_UNKNOWN');
          return;
        }
        assertCurrent();
        let resourcesRecorded = false;
        let controllerDispatched = false;
        const result = await runDelivery({ projectRoot, taskId: scope.deliveryTaskId, action: 'publish', verification, repair }, {
          identityRoot: projectRoot,
          controller: {
            readDeliveryReceipt: input => {
              if (!same(input, { projectRoot, taskId: scope.deliveryTaskId })) fail('MANAGED_SCOPE_DENIED');
              return controller.readDeliveryReceipt(input);
            },
            publishDelivery(input) {
              if (controllerDispatched || !resourcesRecorded || !same(input, { projectRoot, taskId: scope.deliveryTaskId,
                verification, repair }) || typeof input.githubRunner !== 'function') fail('MANAGED_SCOPE_DENIED');
              assertCurrent();
              assertReceipt();
              assertBefore(scope);
              requiredChecks();
              assertCurrent();
              controllerDispatched = true;
              return controller.publishDelivery({ projectRoot, taskId: scope.deliveryTaskId, verification,
                repair, pushDefault: () => ({ status: 'protected' }), githubRunner: input.githubRunner });
            },
          },
          githubRunner: githubRunner(scope, assertCurrent),
          resourceRevalidationProbe(repository, taskId, phase) {
            assertCurrent();
            if (resourcesRecorded || repository?.repositoryRoot !== projectRoot || taskId !== scope.deliveryTaskId || phase !== 'record') {
              fail('RESOURCE_SCOPE_DENIED');
            }
            const record = recordResources({ projectRoot, taskId, phase });
            if (!same(record, { verified: true, projectRoot, taskId, phase })) fail('RESOURCE_RECORD_UNPROVEN');
            resourcesRecorded = true;
            assertCurrent();
            return record;
          },
        });
        if (!controllerDispatched || !same(result, { taskId: scope.deliveryTaskId, status: 'awaiting_ci', mode: 'pr',
          safetyAutoMergeDeferred: true, integrationCommit: scope.candidateSha }) || verifyPush(scope) !== true) {
          fail('PUBLICATION_RESULT_UNPROVEN');
        }
        assertCurrent();
      }, lease);
    } catch (error) {
      if (!claimed && error?.code !== 'RWB_REAL_PUBLICATION_CLAIM_UNKNOWN') {
        const code = errorCode(error, 'RWB_REAL_PUBLICATION_BLOCKED');
        await log({ code, operationId: scope.operationId });
        return { status: 'blocked', code };
      }
      await log({ code: 'RWB_REAL_PUBLICATION_RECONCILIATION_REQUIRED', operationId: scope.operationId });
    }
    if (!entered) fail('FENCE_DENIED');
    return observe(scope);
  }

  function requiredChecks() {
    const policy = get('/branches/' + base + '/protection/required_status_checks');
    if (!Array.isArray(policy.checks) || !policy.checks.length || !Array.isArray(policy.contexts) ||
        policy.checks.some(item => typeof item?.context !== 'string' || !item.context ||
          !(item.app_id === -1 || validId(item.app_id))) ||
        new Set(policy.checks.map(item => item.context)).size !== policy.checks.length ||
        policy.contexts.length !== policy.checks.length || new Set(policy.contexts).size !== policy.contexts.length ||
        !policy.contexts.every(name => policy.checks.some(item => item.context === name))) fail('CI_POLICY_UNPROVEN');
    return policy.checks.map(({ context, app_id: appId }) => ({ context, appId }))
      .sort((a, b) => a.context.localeCompare(b.context));
  }

  async function readCi(request) {
    const scope = scopeFor(request, 'ci');
    settings();
    readPullRequest(scope, scope.number, scope.candidateSha);
    const policy = requiredChecks();
    const prefix = '/commits/' + scope.candidateSha;
    const runs = get(prefix + '/check-runs?filter=latest&per_page=100');
    const statuses = get(prefix + '/status?per_page=100');
    if (!Array.isArray(runs.check_runs) || runs.total_count !== runs.check_runs.length ||
        !Array.isArray(statuses.statuses) || statuses.total_count !== statuses.statuses.length ||
        statuses.sha !== scope.candidateSha || runs.check_runs.some(run => run?.head_sha !== scope.candidateSha)) {
      fail('CI_HEAD_UNPROVEN');
    }
    const evidence = [];
    let missing = false;
    let failed = false;
    for (const { context, appId } of policy) {
      const matchingRuns = runs.check_runs.filter(run => run.name === context && (appId === -1 || run.app?.id === appId));
      const matchingStatuses = statuses.statuses.filter(status => status.context === context);
      if (matchingRuns.length > 1 || matchingStatuses.length > 1) fail('CI_CONTEXT_AMBIGUOUS');
      const run = matchingRuns[0];
      const status = matchingStatuses[0];
      if ((!run && !status) || (appId !== -1 && !run)) missing = true;
      if (run) {
        if (!validId(run.id) || !validId(run.app?.id)) fail('CI_CHECK_UNPROVEN');
        if (run.status !== 'completed') missing = true;
        else if (checkFailure.has(run.conclusion)) failed = true;
        else if (!checkSuccess.has(run.conclusion)) fail('CI_CHECK_UNPROVEN');
        evidence.push([context, 'check_run', run.id, run.app.id, run.status, run.conclusion]);
      }
      if (status) {
        if (appId !== -1 || !validId(status.id)) fail('CI_STATUS_APP_UNPROVEN');
        if (['error', 'failure'].includes(status.state)) failed = true;
        else if (status.state === 'pending') missing = true;
        else if (status.state !== 'success') fail('CI_STATUS_UNPROVEN');
        evidence.push([context, 'status', status.id, status.state]);
      }
    }
    if (realDigest(requiredChecks()) !== realDigest(policy)) fail('CI_POLICY_CHANGED');
    readPullRequest(scope, scope.number, scope.candidateSha);
    if (!failed && missing) return pending;
    const checksDigest = realDigest([scope.number, scope.candidateSha, policy, evidence]);
    await log({ code: failed ? 'RWB_REAL_CI_FAILED' : 'RWB_REAL_CI_PASSED', operationId: scope.operationId });
    return proof(scope, realDigest([scope.scopeDigest, checksDigest]), {
      number: scope.number, headSha: scope.candidateSha, conclusion: failed ? 'failure' : 'success', checksDigest,
    });
  }

  async function call(request, work) {
    try { return await work(); }
    catch (error) {
      const code = errorCode(error, 'RWB_REAL_OPERATION_UNKNOWN');
      await log({ code, ...(uuid.test(request?.operationId ?? '') && { operationId: request.operationId }) });
      return { status: code === 'RWB_REAL_OPERATION_UNKNOWN' ? 'unknown' : 'blocked', code };
    }
  }
  return Object.freeze({
    publish: (request, lease) => call(request, () => publish(request, lease)),
    observePublication: request => call(request, () => observe(scopeFor(request, 'publish'))),
    readCi: request => call(request, () => readCi(request)),
  });
}
