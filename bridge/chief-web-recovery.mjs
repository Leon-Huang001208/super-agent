import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT, chiefWebOperationExpiry } from './chief-web-pilot.mjs';
import { readChiefWebIntents } from './chief-web-native-store.mjs';
import { createChiefWebIntentAuthority, readChiefWebEffectHistory } from './chief-web-intent-authority.mjs';
import { validateChiefWebEffectResult, validateChiefWebIntent } from './chief-web-intent-consumer.mjs';

const digest = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const eventKey = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/;
const claimKind = 'chief-web-recovery-claim';
const completionKind = 'chief-web-recovery-completion';
const publicCode = /^CHIEF_WEB_RECOVERY_[A-Z_]+$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const is = (pattern, value) => typeof value === 'string' && pattern.test(value);
const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
const fail = (code, status = 'blocked') => { throw Object.assign(new Error(code), { code, status }); };
const stepStates = { publish: 'published', 'wait-ci': 'waiting_ci', ci: 'recorded', release: 'released' };

function scopeFrom({ grant, intent, evidence }) {
  if (grant?.grantId !== intent.grantId || intent.expiresAt !== chiefWebOperationExpiry(grant, 'confirm', intent.expected)) {
    fail('CHIEF_WEB_RECOVERY_GRANT_CHANGED');
  }
  const scope = {
    taskId: intent.taskId, grantId: grant.grantId,
    conversationId: grant.conversationId, generation: grant.generation,
    inputRevision: intent.expected.inputRevision, candidateSha: intent.expected.candidate,
    previousHead: intent.expected.prHead, reviewDigest: intent.expected.reviewDigest,
    repository: CHIEF_WEB_PILOT.repository, pullRequest: CHIEF_WEB_PILOT.pullRequest, path: CHIEF_WEB_PILOT.path,
    baseCommit: evidence?.baseCommit, branch: evidence?.branch, leaseDigest: evidence?.leaseDigest,
  };
  if (!same(evidence, scope) || evidence.reviewVerified !== true || evidence.checksPassed !== true ||
      !is(commit, scope.baseCommit) || !is(digest, scope.leaseDigest) ||
      !is(/^codex\/integrate-super-agent-[a-z0-9-]{1,63}$/, scope.branch) ||
      (grant.confirmationWindow && grant.confirmationWindow.baseCommit !== scope.baseCommit)) {
    fail('CHIEF_WEB_RECOVERY_EXECUTION_UNVERIFIED');
  }
  return Object.freeze({
    ...scope, confirmationOperationId: intent.operationId, expiresAt: intent.expiresAt,
    scopeDigest: hash([scope, intent.operationId, intent.payloadHash, intent.expiresAt]),
  });
}

function readStep(records, operationId, stage) {
  const stepId = hash([operationId, stage]);
  const completionId = hash([stepId, completionKind]);
  function find(kind, id, status) {
    const rows = records.filter(row => row.operationId === id ||
      (row.kind === kind && row.parentOperationId === operationId && row.stage === stage));
    if (rows.length > 1 || rows.some(row => !same(row, { kind, status, operationId: id, parentOperationId: operationId, stage }))) {
      fail('CHIEF_WEB_RECOVERY_HISTORY_AMBIGUOUS', 'unknown');
    }
    return rows[0];
  }
  const claim = find(claimKind, stepId, 'claimed');
  const completion = find(completionKind, completionId, 'completed');
  if (completion && (!claim || !is(digest, completion.evidenceDigest) || !same(completion, {
    taskId: claim.taskId, grantId: claim.grantId, scopeDigest: claim.scopeDigest, eventId: claim.eventId,
  }))) fail('CHIEF_WEB_RECOVERY_HISTORY_AMBIGUOUS', 'unknown');
  return { stepId, completionId, claim, completion };
}

function validateCi(event, scope, eventId) {
  if (event?.verified !== true || !same(event, {
    eventId, repository: scope.repository, pullRequest: scope.pullRequest, headSha: scope.candidateSha,
  }) || !['success', 'failure'].includes(event.conclusion) || !is(digest, event.evidenceDigest)) {
    fail('CHIEF_WEB_RECOVERY_CI_UNVERIFIED');
  }
  return Object.freeze({ eventId, conclusion: event.conclusion, evidenceDigest: event.evidenceDigest });
}

/**
 * The managed runtime supplies trusted readers and mutation ports. Operators
 * supply only IDs. A claimed step always observes its own receipt on replay.
 */
export function createChiefWebRecovery({ repository, readGrant, readExecution, publisher, finalization, log, now = Date.now } = {}) {
  if (![repository?.transaction, readGrant, readExecution, publisher?.verify, publisher?.observe, publisher?.update, publisher?.readCi,
    finalization?.observe, finalization?.apply, log, now].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_RECOVERY_CONFIGURATION_INVALID');
  }

  async function verifiedScope(context) {
    return scopeFrom({ ...context, evidence: await readExecution(context) });
  }

  const authority = createChiefWebIntentAuthority({
    repository, readGrant, now,
    verifyExecution: ({ intent }) => intent.action === 'confirm',
    async onClaim(context) {
      const scope = await verifiedScope({ ...context, stage: 'claim', mode: 'admit' });
      const { stepId, claim } = readStep(context.records, context.intent.operationId, 'confirm');
      if (claim || now() >= context.intent.expiresAt) fail('CHIEF_WEB_RECOVERY_CONFIRMATION_DENIED');
      await context.transaction.appendOperation({
        kind: claimKind, status: 'claimed', operationId: stepId, parentOperationId: context.intent.operationId,
        taskId: scope.taskId, grantId: scope.grantId, scopeDigest: scope.scopeDigest, stage: 'confirm', eventId: null,
      });
    },
  });

  function locked(operationId, handle) {
    return repository.transaction(async transaction => {
      const task = await transaction.lockTask(CHIEF_WEB_PILOT.taskId);
      if (task?.id !== CHIEF_WEB_PILOT.taskId) fail('CHIEF_WEB_RECOVERY_TASK_UNVERIFIED');
      const records = await transaction.listTaskOperations(task.id);
      const intents = readChiefWebIntents(records);
      const intent = intents.find(row => row.operationId === operationId && row.action === 'confirm');
      if (!validateChiefWebIntent(intent, operationId)) fail('CHIEF_WEB_RECOVERY_CONFIRMATION_MISSING');
      const grant = await readGrant({ task, transaction });
      if (!grant) fail('CHIEF_WEB_RECOVERY_GRANT_CHANGED');
      const effect = readChiefWebEffectHistory(records, intent);
      if (effect.claim?.status !== 'claimed') fail('CHIEF_WEB_RECOVERY_CONFIRMATION_UNCLAIMED');
      const paused = intents.findLast(row => row.action === 'pause' || row.action === 'resume')?.action === 'pause';
      return handle({ transaction, task, records, intent, grant, effect, paused });
    });
  }

  function dependencies({ records, effect, intent }, scope, stage) {
    if (stage === 'publish') return {};
    function requireStep(prerequisite) {
      const { completion } = readStep(records, intent.operationId, prerequisite);
      if (completion?.scopeDigest !== scope.scopeDigest) fail('CHIEF_WEB_RECOVERY_PREREQUISITE_MISSING');
      return completion;
    }
    const publication = requireStep('publish');
    if (effect.completion?.status !== 'completed' || !validateChiefWebEffectResult(effect.completion.result, intent)) {
      fail('CHIEF_WEB_RECOVERY_PUBLICATION_UNVERIFIED');
    }
    if (stage === 'wait-ci') return { publicationEvidenceDigest: publication.evidenceDigest };
    requireStep('wait-ci');
    if (stage === 'ci') return {};
    const ci = requireStep('ci');
    return { ciEvidenceDigest: ci.evidenceDigest, ciEventId: ci.eventId, ciConclusion: ci.conclusion };
  }

  function reserve(operationId, stage, eventId, ci, expectedScopeDigest) {
    return locked(operationId, async context => {
      const { records, paused, transaction, intent } = context;
      const { stepId, claim, completion } = readStep(records, operationId, stage);
      const scope = await verifiedScope({ ...context, stage, mode: claim ? 'observe' : 'admit' });
      const confirmation = readStep(records, operationId, 'confirm').claim;
      if (!same(confirmation, { taskId: scope.taskId, grantId: scope.grantId, scopeDigest: scope.scopeDigest }) ||
          (expectedScopeDigest && scope.scopeDigest !== expectedScopeDigest)) fail('CHIEF_WEB_RECOVERY_SCOPE_CHANGED');
      const prerequisite = dependencies(context, scope, stage);
      const binding = { taskId: scope.taskId, grantId: scope.grantId, scopeDigest: scope.scopeDigest,
        parentOperationId: operationId, stage, eventId: eventId ?? null };
      if (claim && !same(claim, binding)) fail(stage === 'ci'
        ? 'CHIEF_WEB_RECOVERY_CI_EVENT_CHANGED' : 'CHIEF_WEB_RECOVERY_SCOPE_CHANGED');
      const ciProof = claim && stage === 'ci'
        ? validateCi({ ...scope, headSha: scope.candidateSha, eventId: claim.eventId, verified: true,
          conclusion: claim.conclusion, evidenceDigest: claim.ciProofDigest }, scope, eventId)
        : ci;
      const request = Object.freeze({ ...scope, ...prerequisite, operationId: stepId, ...(ciProof && { ci: ciProof }) });
      if (claim) return { scope, request, completion, reconcile: true };
      if (stage === 'publish' && (paused || now() >= intent.expiresAt)) {
        fail(paused ? 'CHIEF_WEB_RECOVERY_PAUSED' : 'CHIEF_WEB_RECOVERY_EXPIRED');
      }
      if ((stage === 'ci' && !ci) || (stage === 'publish' && !expectedScopeDigest)) return { scope };
      await transaction.appendOperation({ ...binding, operationId: stepId, kind: claimKind, status: 'claimed',
        ...(ci && { conclusion: ci.conclusion, ciProofDigest: ci.evidenceDigest }) });
      return { scope, request };
    });
  }

  async function complete(operationId, stage, request, result) {
    if (result?.verified !== true || !same(result, {
      operationId: request.operationId, scopeDigest: request.scopeDigest, state: stepStates[stage],
    }) || !is(digest, result.evidenceDigest)) fail('CHIEF_WEB_RECOVERY_RESULT_UNKNOWN', 'unknown');
    await locked(operationId, async ({ transaction, records, grant }) => {
      const { claim, completion, completionId } = readStep(records, operationId, stage);
      if (claim?.scopeDigest !== request.scopeDigest || grant.grantId !== request.grantId ||
          grant.conversationId !== request.conversationId || grant.generation !== request.generation) {
        fail('CHIEF_WEB_RECOVERY_SCOPE_CHANGED', 'unknown');
      }
      if (completion) {
        if (completion.evidenceDigest !== result.evidenceDigest) fail('CHIEF_WEB_RECOVERY_HISTORY_AMBIGUOUS', 'unknown');
        return;
      }
      await transaction.appendOperation({
        taskId: claim.taskId, grantId: claim.grantId, scopeDigest: claim.scopeDigest, stage, eventId: claim.eventId,
        operationId: completionId, parentOperationId: operationId, kind: completionKind, status: 'completed',
        evidenceDigest: result.evidenceDigest, ...(stage === 'ci' && { conclusion: claim.conclusion }),
      });
    });
  }

  async function run(operationId, stage, eventId) {
    let selected = await reserve(operationId, stage, eventId);
    if (!selected.request) {
      let ci;
      if (stage === 'ci') ci = validateCi(await publisher.readCi(selected.scope, eventId), selected.scope, eventId);
      if (stage === 'publish') await publisher.verify(selected.scope);
      selected = await reserve(operationId, stage, eventId, ci, selected.scope.scopeDigest);
    }
    const { request, completion, reconcile } = selected;
    if (!completion) {
      let result;
      try {
        if (stage === 'publish') {
          result = reconcile ? await publisher.observe(request) : await publisher.update(request);
        } else {
          if (stage === 'ci' && !reconcile) {
            const currentCi = validateCi(await publisher.readCi(request, eventId), request, eventId);
            if (!same(currentCi, request.ci)) fail('CHIEF_WEB_RECOVERY_CI_EVENT_CHANGED');
          }
          result = reconcile ? await finalization.observe(stage, request) : await finalization.apply(stage, request);
        }
      } catch {
        fail('CHIEF_WEB_RECOVERY_RESULT_UNKNOWN', 'unknown');
      }
      await complete(operationId, stage, request, result);
    }
    return selected.scope;
  }

  async function execute(operationId, callback) {
    if (!is(digest, operationId)) return { status: 'blocked', code: 'CHIEF_WEB_RECOVERY_OPERATION_INVALID' };
    let outcome;
    try {
      outcome = { operationId, ...await callback() };
    } catch (error) {
      outcome = is(publicCode, error?.code)
        ? { operationId, status: error.status, code: error.code }
        : { operationId, status: 'unknown', code: 'CHIEF_WEB_RECOVERY_RESULT_UNKNOWN' };
    }
    await log(outcome);
    return outcome;
  }

  return Object.freeze({
    claim({ operationId } = {}) {
      return execute(operationId, async () => {
        const result = await authority.claim(operationId);
        if (result.status === 'blocked') fail('CHIEF_WEB_RECOVERY_CONFIRMATION_DENIED');
        if (result.intent?.action !== 'confirm') fail('CHIEF_WEB_RECOVERY_CONFIRMATION_MISSING');
        return { status: 'claimed', code: 'CHIEF_WEB_RECOVERY_CONFIRMATION_CLAIMED' };
      });
    },
    publish({ operationId } = {}) {
      return execute(operationId, async () => {
        const scope = await run(operationId, 'publish');
        await authority.complete({ operationId, result: {
          operationId, confirmationOperationId: operationId, taskId: scope.taskId, grantId: scope.grantId,
          status: 'completed', inputRevision: scope.inputRevision, repository: scope.repository,
          pullRequest: scope.pullRequest, previousHead: scope.previousHead, headSha: scope.candidateSha,
        } });
        await run(operationId, 'wait-ci');
        return { status: 'waiting_ci', code: 'CHIEF_WEB_RECOVERY_WAITING_CI' };
      });
    },
    recordCi({ operationId, eventId } = {}) {
      return execute(operationId, async () => {
        if (!is(eventKey, eventId)) fail('CHIEF_WEB_RECOVERY_CI_EVENT_INVALID');
        await run(operationId, 'ci', eventId);
        return { status: 'recorded', code: 'CHIEF_WEB_RECOVERY_CI_RECORDED' };
      });
    },
    release({ operationId } = {}) {
      return execute(operationId, async () => {
        await run(operationId, 'release');
        return { status: 'released', code: 'CHIEF_WEB_RECOVERY_LEASE_RELEASED' };
      });
    },
  });
}
