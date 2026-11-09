import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const prUrl = 'https://github.com/' + CHIEF_WEB_PILOT.repository + '/pull/' + CHIEF_WEB_PILOT.pullRequest;
const matches = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
const canonical = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code, status: 'blocked' }); };
const scopeFields = ['taskId', 'grantId', 'conversationId', 'generation', 'inputRevision', 'candidateSha', 'repository', 'pullRequest'];

function binding(scope) {
  return Object.fromEntries(scopeFields.map(key => [key, scope[key]]));
}

function nativeEvidence(task, grant, records) {
  const fullInput = records.findLast(row => row.kind === 'input-state' && row.taskId === task.id)?.fullTaskInput;
  const context = records.findLast(row => row.kind === 'execution-context' && row.taskId === task.id &&
    row.status === 'completed')?.executionContext;
  if (!matches(fullInput, { taskId: task.id, targetDoc: CHIEF_WEB_PILOT.path, originId: task.originId,
    responsibleUserId: grant.ownerId, projectId: task.projectId, companyId: task.companyId }) ||
      context?.pr?.url !== prUrl || !task.originId || !task.projectId) fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
  const inputRevision = hash(fullInput);
  return { context, inputRevision, contextRevision: hash(context),
    nativeRevision: hash([task.status, task.statusVersion, task.updatedAt, task.description, inputRevision, context]) };
}

export function createChiefWebRecoveryNative({ bindings, readExecutionEvidence, readRuntime, readReviewCapability, lease, now = Date.now } = {}) {
  if (![bindings?.repository?.transaction, bindings?.readGrant, readExecutionEvidence, readRuntime,
    readReviewCapability, lease?.read, lease?.release, now]
    .every(fn => typeof fn === 'function')) fail('CHIEF_WEB_RECOVERY_NATIVE_UNAVAILABLE');

  async function drained(transaction, task, grant) {
    const runtime = await readRuntime();
    return runtime?.dispatchMode === 'off' && Array.isArray(runtime.allowedTaskIds) &&
      runtime.allowedTaskIds.length === 1 && runtime.allowedTaskIds[0] === task.id &&
      await transaction.recoveryIsDrained(task.id, grant.chiefAgentId);
  }

  async function readExecution({ task, grant, transaction, records, intent, stage, mode }) {
    if (!grant || (mode === 'admit' && !await drained(transaction, task, grant))) {
      fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
    }
    const { context, inputRevision } = nativeEvidence(task, grant, records);
    const { candidate, reviewDigest, prHead } = intent.expected;
    const candidateScope = context.candidateScope;
    const evidence = await readExecutionEvidence({ task, context, binding: grant, inputRevision });
    const proof = await lease.read({ taskId: task.id, projectId: task.projectId, inputRevision });
    const prePublication = ['claim', 'publish'].includes(stage) && mode === 'admit';
    if (prePublication) {
      const action = context.proposal?.action;
      const actionScope = action?.scope;
      if (context.proposal?.authorized !== true || context.proposal.candidate?.digest !== candidate ||
          action?.kind !== 'publish_pr_update' || !matches(actionScope, {
            prUrl, oldHead: prHead, newHead: candidate, maxAction: 'update_pr_only',
          })) fail('CHIEF_WEB_RECOVERY_EXECUTION_UNVERIFIED');
      if (grant.confirmationWindow) {
        const cap = await readReviewCapability(inputRevision);
        if (!cap?.operationId || !matches(cap, { operationId: actionScope.intentId, taskId: task.id,
          grantId: grant.grantId, inputRevision, candidate, oldHead: prHead, baseCommit: candidateScope?.baseCommit })) {
          fail('CHIEF_WEB_RECOVERY_EXECUTION_UNVERIFIED');
        }
      }
    }
    if (inputRevision !== intent.expected.inputRevision || context.candidate?.head !== candidate ||
        candidateScope?.head !== candidate || ![prHead, candidate].includes(context.pr?.headSha) ||
        (prePublication &&
          (task.status !== 'in_progress' || context.phase !== 'WAIT_DECISION' || context.pr.headSha !== prHead || evidence?.prHead !== prHead ||
            context.expectedWait?.inputRevision !== inputRevision || context.expectedWait?.candidateSha !== candidate || proof?.active !== true)) ||
        evidence?.candidate !== candidate || evidence.grantId !== grant.grantId ||
        evidence.conversationId !== grant.conversationId || evidence.generation !== grant.generation ||
        evidence.independentReview?.verdict !== 'approved' || evidence.independentReview.digest !== reviewDigest ||
        evidence.independentReview.candidate !== candidate || evidence.localChecks?.candidate !== candidate ||
        evidence.localChecks?.passed !== true || !proof?.verified || !proof.leaseDigest) {
      fail('CHIEF_WEB_RECOVERY_EXECUTION_UNVERIFIED');
    }
    return {
      taskId: task.id, grantId: grant.grantId, conversationId: grant.conversationId, generation: grant.generation,
      inputRevision, candidateSha: candidate, previousHead: prHead, reviewDigest, repository: CHIEF_WEB_PILOT.repository,
      pullRequest: CHIEF_WEB_PILOT.pullRequest, path: CHIEF_WEB_PILOT.path,
      baseCommit: candidateScope.baseCommit, branch: candidateScope.integrationBranch ?? candidateScope.branch,
      leaseDigest: proof.leaseDigest, reviewVerified: true, checksPassed: true,
    };
  }

  function locked(scope, callback) {
    return bindings.repository.transaction(async transaction => {
      const task = await transaction.lockTask(CHIEF_WEB_PILOT.taskId);
      if (task?.id !== scope.taskId) fail('CHIEF_WEB_RECOVERY_TASK_UNVERIFIED');
      const grant = await bindings.readGrant({ task, transaction });
      if (!matches(grant, { grantId: scope.grantId, conversationId: scope.conversationId, generation: scope.generation })) {
        fail('CHIEF_WEB_RECOVERY_GRANT_CHANGED');
      }
      const records = await transaction.listTaskOperations(task.id);
      const state = nativeEvidence(task, grant, records);
      if (state.inputRevision !== scope.inputRevision || state.context.candidate?.head !== scope.candidateSha ||
          !await drained(transaction, task, grant)) fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
      return callback({ ...state, task, transaction, records });
    });
  }

  function requireRevision(state, scope) {
    if (scope.expectedNativeRevision !== state.nativeRevision || scope.expectedContextRevision !== state.contextRevision) {
      fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
    }
  }

  async function append(state, scope, stage, patch, nativeStatus) {
    requireRevision(state, scope);
    const operationId = 'chief-web-recovery:' + scope.operationId;
    const executionContext = { ...state.context, ...patch };
    await state.transaction.appendRecoveryContext({
      stage, claimOperationId: scope.operationId, scopeDigest: scope.scopeDigest, nativeStatus,
      record: { taskId: scope.taskId, operationId, kind: 'execution-context', status: 'completed',
        payloadHash: hash([scope.scopeDigest, operationId, executionContext]), executionContext,
        result: { taskId: scope.taskId, operationId, status: 'completed', contextRevision: hash(executionContext) } },
    });
  }

  function settleLease(scope, method) {
    return locked(scope, state => {
      requireRevision(state, scope);
      const marker = state.context.chiefWebRecovery;
      const claims = state.records.filter(row => row.operationId === scope.operationId);
      if (!matches(marker, binding(scope)) || marker.ci?.eventId !== scope.ciEventId ||
          marker.ci?.conclusion !== scope.ciConclusion || !marker.receipt ||
          claims.length !== 1 || !matches(claims[0], { kind: 'chief-web-recovery-claim', status: 'claimed',
            stage: 'release', taskId: scope.taskId, grantId: scope.grantId, scopeDigest: scope.scopeDigest,
            parentOperationId: scope.confirmationOperationId }) ||
          state.task.status !== (scope.ciConclusion === 'success' ? 'done' : 'blocked')) {
        fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
      }
      return lease[method]({ ...scope, projectId: state.task.projectId });
    });
  }

  return Object.freeze({
    readExecution,
    nativeFinalization: Object.freeze({
      readState(scope) {
        return locked(scope, ({ task, context, nativeRevision, contextRevision, records }) => {
          const marker = context.chiefWebRecovery;
          const current = matches(marker, binding(scope)) ? marker : {};
          return {
            ...binding(scope), verified: true, noExecutionInFlight: true, nativeRevision, contextRevision,
            nativeStatus: task.status, phase: context.phase, prHead: context.pr.headSha,
            waitOperationId: current.waitOperationId, publicationEvidenceDigest: current.publicationEvidenceDigest,
            ciEventId: current.ci?.eventId, ciProofDigest: current.ci?.evidenceDigest,
            operationAbsent: !records.some(row => row.operationId === 'chief-web-recovery:' + scope.operationId),
          };
        });
      },
      recordWait(scope) {
        return locked(scope, async state => {
          const startedAt = now();
          if (!Number.isSafeInteger(startedAt) || state.task.status !== 'in_progress' ||
              state.context.phase !== 'WAIT_DECISION' || state.context.pr.headSha !== scope.previousHead) {
            fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
          }
          const deadline = startedAt + 30 * 60_000;
          await append(state, scope, 'wait-ci', {
            phase: 'WAIT_CI', proposal: null, pr: { ...state.context.pr, headSha: scope.candidateSha },
            expectedWait: { taskId: scope.taskId, inputRevision: scope.inputRevision, phase: 'WAIT_CI',
              candidateSha: scope.candidateSha, pullRequest: prUrl, deadline, registered: true, registrationId: scope.operationId,
              startedAt: new Date(startedAt).toISOString(), kind: 'ci', expectedAt: new Date(deadline).toISOString(),
              resumeCondition: 'exact-head-ci-success', resumeRefs: [scope.inputRevision, scope.candidateSha] },
            chiefWebRecovery: { ...binding(scope), waitOperationId: scope.operationId, confirmationOperationId: scope.confirmationOperationId,
              publicationEvidenceDigest: scope.publicationEvidenceDigest },
          });
        });
      },
      recordCi(scope) {
        return locked(scope, async state => {
          const marker = state.context.chiefWebRecovery;
          if (state.task.status !== 'in_progress' || state.context.phase !== 'WAIT_CI' ||
              state.context.pr.headSha !== scope.candidateSha || !matches(marker, {
                ...binding(scope), confirmationOperationId: scope.confirmationOperationId,
              }) || marker.waitOperationId !== state.context.expectedWait?.registrationId) {
            fail('CHIEF_WEB_RECOVERY_NATIVE_STATE_CHANGED');
          }
          const success = scope.ci.conclusion === 'success';
          const receipt = { ...binding(scope), verified: true, channel: 'chief-web', operationId: scope.operationId,
            conclusion: scope.ci.conclusion, ciProofDigest: scope.ci.evidenceDigest };
          await append(state, scope, 'ci', {
            phase: success ? 'COMPLETED' : 'BLOCKED', expectedWait: null,
            terminalFinalization: { binding: { taskId: scope.taskId, inputRevision: scope.inputRevision,
              candidateSha: scope.candidateSha, pullRequest: prUrl, journalMode: 'unified' } },
            chiefWebRecovery: { ...marker, ci: scope.ci, receipt: { ...receipt, receiptDigest: hash(receipt) } },
          }, success ? 'done' : 'blocked');
        });
      },
      readConversationReceipt(scope) {
        return locked(scope, ({ context }) => context.chiefWebRecovery?.receipt);
      },
      readLease(scope) {
        return locked(scope, ({ task }) => lease.read({ ...scope, projectId: task.projectId }));
      },
      releaseLease: scope => settleLease(scope, 'release'),
      reconcileLease: scope => settleLease(scope, 'reconcile'),
    }),
  });
}
