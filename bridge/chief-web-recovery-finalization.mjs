import { createHash } from 'node:crypto';

const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code, status: 'blocked' }); };

function binding(scope) {
  const { taskId, grantId, conversationId, generation, inputRevision, candidateSha, repository, pullRequest } = scope;
  return { taskId, grantId, conversationId, generation, inputRevision, candidateSha, repository, pullRequest };
}

/**
 * Validates Native phase changes and durable conversation/lease evidence. Native
 * writes use the supplied expected revisions and exact operation ID for CAS.
 */
export function createChiefWebRecoveryFinalization({
  readState, recordWait, recordCi, readConversationReceipt, readLease, releaseLease, reconcileLease,
} = {}) {
  if (![readState, recordWait, recordCi, readConversationReceipt, readLease, releaseLease]
    .every(fn => typeof fn === 'function')) fail('CHIEF_WEB_RECOVERY_NATIVE_UNAVAILABLE');

  async function verifiedState(scope) {
    const state = await readState(scope);
    if (!same(state, { ...binding(scope), verified: true, noExecutionInFlight: true }) ||
        !digest(state.nativeRevision) || !digest(state.contextRevision)) fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
    return state;
  }

  async function observation(stage, scope, state) {
    let evidence;
    let result;
    if (stage === 'wait-ci') {
      if (!same(state, { phase: 'WAIT_CI', nativeStatus: 'in_progress', prHead: scope.candidateSha,
        waitOperationId: scope.operationId, publicationEvidenceDigest: scope.publicationEvidenceDigest })) return null;
      evidence = { waitOperationId: state.waitOperationId, publicationEvidenceDigest: state.publicationEvidenceDigest };
      result = 'waiting_ci';
    } else if (stage === 'ci') {
      const terminalStatus = scope.ci.conclusion === 'success' ? 'done' : 'blocked';
      if (!same(state, { nativeStatus: terminalStatus, prHead: scope.candidateSha,
        ciEventId: scope.ci.eventId, ciProofDigest: scope.ci.evidenceDigest })) return null;
      evidence = await readConversationReceipt(scope);
      if (!same(evidence, { ...binding(scope), verified: true, channel: 'chief-web',
        operationId: scope.operationId, conclusion: scope.ci.conclusion, ciProofDigest: scope.ci.evidenceDigest }) ||
          !digest(evidence.receiptDigest)) return null;
      evidence = { receiptDigest: evidence.receiptDigest, ciProofDigest: evidence.ciProofDigest };
      result = 'recorded';
    } else if (stage === 'release') {
      const terminalStatus = scope.ciConclusion === 'success' ? 'done' : 'blocked';
      if (!same(state, { nativeStatus: terminalStatus, prHead: scope.candidateSha, ciEventId: scope.ciEventId })) return null;
      evidence = await readLease(scope);
      if (!same(evidence, { verified: true, taskId: scope.taskId, operationId: scope.operationId,
        leaseDigest: scope.leaseDigest, active: false, archived: true, ciEvidenceDigest: scope.ciEvidenceDigest }) ||
          !digest(evidence.archiveDigest)) return null;
      evidence = { leaseDigest: evidence.leaseDigest, archiveDigest: evidence.archiveDigest };
      result = 'released';
    } else fail('CHIEF_WEB_RECOVERY_NATIVE_STEP_DENIED');
    return { verified: true, operationId: scope.operationId, scopeDigest: scope.scopeDigest, state: result,
      evidenceDigest: createHash('sha256').update(JSON.stringify([stage, scope.scopeDigest, evidence])).digest('hex') };
  }

  async function applyWithState(stage, scope, state, resume) {
    const expected = Object.freeze({ ...scope, expectedNativeRevision: state.nativeRevision,
      expectedContextRevision: state.contextRevision });
    if (stage === 'wait-ci') {
      if (!same(state, { phase: 'WAIT_DECISION', nativeStatus: 'in_progress', prHead: scope.previousHead })) {
        fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
      }
      if (resume && state.operationAbsent !== true) return null;
      await recordWait(expected);
    } else if (stage === 'ci') {
      if (!same(state, { phase: 'WAIT_CI', nativeStatus: 'in_progress', prHead: scope.candidateSha })) {
        fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
      }
      if (resume && state.operationAbsent !== true) return null;
      await recordCi(expected);
    } else if (stage === 'release') {
      const terminalStatus = scope.ciConclusion === 'success' ? 'done' : 'blocked';
      const lease = await readLease(scope);
      if (!same(state, { nativeStatus: terminalStatus, prHead: scope.candidateSha, ciEventId: scope.ciEventId }) ||
          !same(lease, { verified: true, active: true, archived: false, taskId: scope.taskId, leaseDigest: scope.leaseDigest })) {
        fail('CHIEF_WEB_RECOVERY_LEASE_UNVERIFIED');
      }
      await releaseLease(expected);
    }
    return observation(stage, scope, await verifiedState(scope));
  }

  return Object.freeze({
    async observe(stage, scope) {
      const state = await verifiedState(scope);
      const observed = await observation(stage, scope, state);
      if (observed || stage !== 'release' || typeof reconcileLease !== 'function') return observed;
      const lease = await readLease(scope);
      if (lease?.reconciliationRequired !== true || lease.leaseDigest !== scope.leaseDigest) return null;
      await reconcileLease(Object.freeze({ ...scope, expectedNativeRevision: state.nativeRevision,
        expectedContextRevision: state.contextRevision }));
      return observation(stage, scope, await verifiedState(scope));
    },
    async apply(stage, scope) {
      const state = await verifiedState(scope);
      const observed = await observation(stage, scope, state);
      return observed ?? applyWithState(stage, scope, state, false);
    },
    async resumeUnstarted(stage, scope) {
      const state = await verifiedState(scope);
      const observed = await observation(stage, scope, state);
      return observed ?? applyWithState(stage, scope, state, true);
    },
  });
}
