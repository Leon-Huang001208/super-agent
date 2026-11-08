import { createHash } from 'node:crypto';

export const CHIEF_WEB_PILOT = Object.freeze({
  taskId: 'fc7af371-dd33-484b-b567-60af5411ceae',
  repository: 'Leon-Huang001208/ResearchWorkbench',
  pullRequest: 261,
  path: 'docs/super-agent/unified-integration.md',
  previousInputRevision: 'dee1e7b0f0c669004da61be427532572039cd03b24f5aeff2c6f3894275894b8',
  previousHead: '38926b90eb916dba00765e9ac9a21fe208e2d73f',
  previousCalls: 8,
  chiefCalls: 1,
  developerCalls: 1,
  reviewerCalls: 1,
  model: 'gpt-6.1-sol',
  reasoningEffort: 'low',
  action: 'update_existing_pr_only',
});

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const actionFields = {
  supplement: ['messageId'],
  pause: [],
  resume: [],
  confirm: ['candidate', 'reviewDigest'],
};

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function hash(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function sameAudience(binding, actor) {
  return binding && binding.taskId === CHIEF_WEB_PILOT.taskId &&
    typeof binding.ownerId === 'string' && binding.ownerId.length > 0 &&
    binding.ownerId === actor?.userId && matches(uuid, binding.companyId) &&
    binding.companyId === actor.companyId && matches(uuid, binding.conversationId) &&
    binding.conversationId === actor.conversationId &&
    Number.isSafeInteger(binding.generation) && binding.generation >= 0 &&
    binding.generation === actor.generation;
}

function validateCommand(command) {
  if (command?.action === 'status' && Object.keys(command).length === 1) return;
  if (!command || !Object.hasOwn(actionFields, command.action)) fail('CHIEF_WEB_ACTION_INVALID');
  const fields = ['action', 'contextRevision', 'requestId', ...actionFields[command.action]];
  if (Object.keys(command).length !== fields.length || !fields.every(field => Object.hasOwn(command, field)) ||
      !matches(uuid, command.requestId) || !matches(digest, command.contextRevision)) {
    fail('CHIEF_WEB_ACTION_INVALID');
  }
  if (command.action === 'supplement' && !matches(uuid, command.messageId)) fail('CHIEF_WEB_ACTION_INVALID');
  if (command.action === 'confirm' && (!matches(sha, command.candidate) || !matches(digest, command.reviewDigest))) {
    fail('CHIEF_WEB_ACTION_INVALID');
  }
}

function requireGrant(binding, now) {
  if (!matches(uuid, binding.grantId) || !Number.isSafeInteger(binding.expiresAt) ||
      !Number.isSafeInteger(now) || binding.expiresAt <= now || binding.previousInputRevision !== CHIEF_WEB_PILOT.previousInputRevision ||
      binding.previousHead !== CHIEF_WEB_PILOT.previousHead) {
    fail('CHIEF_WEB_GRANT_UNAVAILABLE');
  }
}

function requireTransition(command, state, binding) {
  if (command.contextRevision !== state.contextRevision) fail('CHIEF_WEB_CONTEXT_CHANGED');
  if (command.action === 'supplement') {
    if (state.control !== 'active' || state.inputRevision !== CHIEF_WEB_PILOT.previousInputRevision ||
        state.supplementReserved !== false ||
        state.observedCalls !== CHIEF_WEB_PILOT.previousCalls || state.prHead !== CHIEF_WEB_PILOT.previousHead ||
        state.phase !== 'done') {
      fail('CHIEF_WEB_SUPPLEMENT_UNAVAILABLE');
    }
    return;
  }
  if (state.phase === 'done' || !matches(digest, state.inputRevision) ||
      state.inputRevision === CHIEF_WEB_PILOT.previousInputRevision ||
      state.supplementGrantId !== binding.grantId) {
    fail('CHIEF_WEB_CONTINUATION_UNBOUND');
  }
  if (command.action === 'pause' && state.control === 'active') return;
  if (command.action === 'resume' && state.control === 'paused' && state.reconciled === true) return;
  if (command.action === 'confirm') {
    if (state.control !== 'active' || state.phase !== 'awaiting_confirmation' || state.confirmationReserved !== false ||
        state.prHead !== CHIEF_WEB_PILOT.previousHead || command.candidate === state.prHead ||
        state.candidate !== command.candidate ||
        state.independentReview?.candidate !== command.candidate ||
        state.independentReview?.digest !== command.reviewDigest ||
        state.independentReview?.verdict !== 'approved' ||
        state.localChecks?.candidate !== command.candidate || state.localChecks?.passed !== true) {
      fail('CHIEF_WEB_CONFIRMATION_STALE');
    }
    return;
  }
  fail('CHIEF_WEB_TRANSITION_DENIED');
}

export function projectChiefWebStatus(state, binding, now) {
  const status = {
    taskId: CHIEF_WEB_PILOT.taskId,
    contextRevision: state.contextRevision,
    inputRevision: state.inputRevision,
    phase: state.phase,
    control: state.control,
    prHead: state.prHead,
    historical: state.inputRevision === CHIEF_WEB_PILOT.previousInputRevision,
    actions: [],
  };
  if (state.phase === 'done' && !status.historical) {
    const { ci, publication, confirmationReceipt } = state;
    if (!matches(digest, state.inputRevision) || state.supplementGrantId !== binding.grantId ||
        !matches(sha, state.prHead) || state.prHead === CHIEF_WEB_PILOT.previousHead ||
        publication?.status !== 'completed' || publication.grantId !== binding.grantId ||
        publication.inputRevision !== state.inputRevision ||
        publication.repository !== CHIEF_WEB_PILOT.repository || publication.pullRequest !== CHIEF_WEB_PILOT.pullRequest ||
        publication.previousHead !== CHIEF_WEB_PILOT.previousHead || publication.headSha !== state.prHead ||
        !matches(digest, publication.confirmationOperationId) ||
        confirmationReceipt?.operationId !== publication.confirmationOperationId ||
        confirmationReceipt?.expected?.inputRevision !== state.inputRevision ||
        confirmationReceipt?.expected?.candidate !== state.prHead ||
        ci?.headSha !== state.prHead || ci?.checksPassed !== true ||
        ci?.repository !== CHIEF_WEB_PILOT.repository || ci?.pullRequest !== CHIEF_WEB_PILOT.pullRequest) {
      status.phase = 'blocked';
      status.code = 'CHIEF_WEB_DELIVERY_EVIDENCE_MISSING';
    }
  }
  try {
    requireGrant(binding, now);
  } catch {
    return status;
  }
  for (const action of ['pause', 'resume', 'confirm']) {
    const command = {
      action, contextRevision: state.contextRevision, candidate: state.candidate,
      reviewDigest: state.independentReview?.digest,
    };
    if (action === 'confirm' && (!matches(sha, command.candidate) || !matches(digest, command.reviewDigest))) continue;
    try {
      requireTransition(command, state, binding);
      status.actions.push(action === 'confirm' ? { action, candidate: command.candidate, reviewDigest: command.reviewDigest } : { action });
    } catch {
      // The authoritative state does not currently permit this control.
    }
  }
  return status;
}

/**
 * The caller supplies the authenticated Paperclip actor. The transaction must lock
 * the original Native task and persist the operation and control fence together.
 * The reservation enforces expiresAt inside the same transaction.
 * It may reserve work, but must not perform any model, Git or notification call.
 */
export function createChiefWebPilot({ withTaskTransaction, log, now = Date.now } = {}) {
  if (typeof withTaskTransaction !== 'function' || typeof log !== 'function' || typeof now !== 'function') {
    fail('CHIEF_WEB_CONFIGURATION_INVALID');
  }

  async function handle(actor, command) {
    let operationId;
    try {
      actor = Object.freeze({ ...actor });
      command = Object.freeze({ ...command });
      validateCommand(command);
      const result = await withTaskTransaction(CHIEF_WEB_PILOT.taskId, async tx => {
        const binding = await tx.readBinding();
        if (!sameAudience(binding, actor)) fail('CHIEF_WEB_AUDIENCE_DENIED');
        if (command.action === 'status') return tx.readStatus(binding);

        if (!matches(uuid, binding.grantId)) fail('CHIEF_WEB_GRANT_UNAVAILABLE');
        const identity = {
          supplement: command.messageId,
          confirm: [command.candidate, command.reviewDigest],
        }[command.action] ?? command.requestId;
        operationId = hash([binding.grantId, binding.conversationId, binding.generation, command.action, identity]);
        const payloadHash = hash([command.action, command.action === 'supplement' ? null : command.contextRevision,
          command.candidate ?? null,
          command.reviewDigest ?? null, command.messageId ?? null]);
        const previous = await tx.readOperation(operationId);
        if (previous) {
          if (previous.payloadHash !== payloadHash) fail('CHIEF_WEB_OPERATION_CONFLICT');
          return previous.receipt;
        }

        requireGrant(binding, now());
        const state = await tx.readState();
        requireTransition(command, state, binding);
        let sourceEvidence;
        if (command.action === 'supplement') {
          const proof = await tx.isOwnerSupplement(binding, command.messageId);
          if (proof?.messageId !== command.messageId || !matches(digest, proof.messageDigest) ||
              ![proof.runId, proof.wakeId, proof.providerClaimId].every(value => matches(uuid, value))) {
            fail('CHIEF_WEB_MESSAGE_DENIED');
          }
          sourceEvidence = {
            messageId: proof.messageId, messageDigest: proof.messageDigest,
            runId: proof.runId, wakeId: proof.wakeId, providerClaimId: proof.providerClaimId,
          };
        }

        requireGrant(binding, now());
        return tx.reserveOperation({
          action: command.action,
          operationId,
          payloadHash,
          grantId: binding.grantId,
          expiresAt: binding.expiresAt,
          messageId: command.messageId,
          sourceEvidence,
          expected: {
            contextRevision: state.contextRevision,
            inputRevision: state.inputRevision,
            prHead: state.prHead,
            candidate: command.candidate,
            reviewDigest: command.reviewDigest,
          },
          policy: CHIEF_WEB_PILOT,
        });
      });
      await log({ code: 'CHIEF_WEB_REQUEST_HANDLED', operationId });
      return result;
    } catch (error) {
      const code = /^CHIEF_WEB_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'CHIEF_WEB_STATE_UNAVAILABLE';
      try {
        await log({ code, operationId });
      } catch {
        fail('CHIEF_WEB_LOG_UNAVAILABLE');
      }
      fail(code);
    }
  }

  return Object.freeze({ handle });
}
