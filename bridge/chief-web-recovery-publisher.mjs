import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code, status: 'blocked' }); };

/**
 * Guard for the existing project publisher. The trusted host port is the
 * pinned RWB safety publisher and its owned receipt readers. This adapter
 * issues one prepared publish request and requires the original PR afterward.
 */
export function createChiefWebRecoveryPublisher({
  readPrepared, readRemote, readPublicationReceipt, publishExisting, readCiEvidence, recoverRequest, now = Date.now,
} = {}) {
  if (![readPrepared, readRemote, readPublicationReceipt, publishExisting, readCiEvidence, now]
    .every(fn => typeof fn === 'function')) fail('CHIEF_WEB_RECOVERY_PUBLISHER_UNAVAILABLE');

  function verifyScope(scope) {
    if (!same(scope, { taskId: CHIEF_WEB_PILOT.taskId, repository: CHIEF_WEB_PILOT.repository,
      pullRequest: CHIEF_WEB_PILOT.pullRequest, path: CHIEF_WEB_PILOT.path, previousHead: CHIEF_WEB_PILOT.previousHead }) ||
      !validDigest(scope.scopeDigest)) fail('CHIEF_WEB_RECOVERY_PUBLICATION_SCOPE_DENIED');
  }

  async function remote(scope, headSha, requireBase) {
    verifyScope(scope);
    const evidence = await readRemote(scope);
    if (!same(evidence, {
      verified: true, repository: scope.repository, pullRequest: scope.pullRequest, headRepository: scope.repository,
      headSha, headRef: scope.branch, baseRepository: scope.repository, baseRef: 'master', state: 'open',
      public: true, autoMergeAllowed: false, autoMergeRequested: false,
    })) fail('CHIEF_WEB_RECOVERY_REMOTE_PR_CHANGED');
    if (requireBase && evidence.baseSha !== scope.baseCommit) fail('CHIEF_WEB_RECOVERY_REMOTE_BASE_CHANGED');
  }

  async function verify(scope) {
    verifyScope(scope);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp >= scope.expiresAt) fail('CHIEF_WEB_RECOVERY_EXPIRED');
    await remote(scope, scope.previousHead, true);
    const prepared = await readPrepared(scope);
    if (!same(prepared, {
      verified: true, taskId: scope.taskId, inputRevision: scope.inputRevision, candidateSha: scope.candidateSha,
      previousHead: scope.previousHead, baseCommit: scope.baseCommit, branch: scope.branch, leaseDigest: scope.leaseDigest,
      confirmationOperationId: scope.confirmationOperationId, reviewDigest: scope.reviewDigest,
      clean: true, descendsFromBase: true, descendsFromPreviousHead: true, drained: true, pauseFenceClear: true,
    }) || prepared.changedPaths?.length !== 1 || prepared.changedPaths[0] !== scope.path ||
      !validDigest(prepared.deliveryReceiptDigest)) fail('CHIEF_WEB_RECOVERY_PREPARED_PUBLICATION_DENIED');
    return prepared.deliveryReceiptDigest;
  }

  async function observe(scope) {
    await remote(scope, scope.candidateSha, false);
    const evidence = await readPublicationReceipt(scope);
    if (!same(evidence, {
      verified: true, operationId: scope.operationId, confirmationOperationId: scope.confirmationOperationId,
      repository: scope.repository, pullRequest: scope.pullRequest, previousHead: scope.previousHead,
      candidateSha: scope.candidateSha, inputRevision: scope.inputRevision, reviewDigest: scope.reviewDigest,
      status: 'awaiting_ci', updatedExisting: true, safetyAutoMergeDeferred: true,
    }) || !validDigest(evidence.receiptDigest)) fail('CHIEF_WEB_RECOVERY_PUBLICATION_RECEIPT_UNVERIFIED');
    return { verified: true, operationId: scope.operationId, scopeDigest: scope.scopeDigest,
      state: 'published', evidenceDigest: evidence.receiptDigest };
  }

  return Object.freeze({
    verify,
    async update(scope) {
      const deliveryReceiptDigest = await verify(scope);
      // The pinned publisher must compare this prepared receipt, base, old head,
      // and live pause fence immediately before its existing branch update.
      await publishExisting(Object.freeze({ ...scope, deliveryReceiptDigest }));
      return observe(scope);
    },
    ...(typeof recoverRequest === 'function' && {
      async recoverHandoff(scope) {
        const deliveryReceiptDigest = await verify(scope);
        return recoverRequest(Object.freeze({ ...scope, deliveryReceiptDigest }));
      },
    }),
    observe,
    async readCi(scope, eventId) {
      await remote(scope, scope.candidateSha, false);
      const evidence = await readCiEvidence(scope, eventId);
      if (!same(evidence, {
        verified: true, eventId, repository: scope.repository, pullRequest: scope.pullRequest, headSha: scope.candidateSha,
        requiredChecksVerified: true, terminal: true,
      }) || !['success', 'failure'].includes(evidence.conclusion) || !validDigest(evidence.evidenceDigest)) {
        fail('CHIEF_WEB_RECOVERY_CI_UNVERIFIED');
      }
      return { verified: true, eventId, repository: scope.repository, pullRequest: scope.pullRequest,
        headSha: scope.candidateSha, conclusion: evidence.conclusion,
        evidenceDigest: hash([eventId, scope.scopeDigest, evidence.conclusion, evidence.evidenceDigest]) };
    },
  });
}
