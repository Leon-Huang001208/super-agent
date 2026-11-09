import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';
import { readChiefWebEffectHistory } from './chief-web-intent-authority.mjs';
import { readChiefWebIntents } from './chief-web-native-store.mjs';
import { validateChiefWebEffectResult, validateChiefWebIntent } from './chief-web-intent-consumer.mjs';

const expectedPrUrl = 'https://github.com/' + CHIEF_WEB_PILOT.repository + '/pull/' + CHIEF_WEB_PILOT.pullRequest;
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;

function hash(value) {
  const canonical = JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
  return createHash('sha256').update(canonical).digest('hex');
}

function completedEffects(records, grantId) {
  const intents = readChiefWebIntents(records).filter(row => row.grantId === grantId);
  const effects = {};
  for (const intent of intents) {
    if (!validateChiefWebIntent(intent, intent.operationId)) continue;
    const { claim, completion } = readChiefWebEffectHistory(records, intent);
    if (!completion) continue;
    if (claim?.status !== 'claimed' || completion.status !== 'completed' || effects[intent.action] ||
        !validateChiefWebEffectResult(completion.result, intent)) throw new Error('CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS');
    effects[intent.action] = completion.result;
  }
  return effects;
}

/** Project the original task and the existing controller's verified evidence. */
export function createChiefWebProjection({ readExecutionEvidence } = {}) {
  if (typeof readExecutionEvidence !== 'function') throw new Error('CHIEF_WEB_PROJECTION_INVALID');

  return async function readProjection({ task, records, binding }) {
    const input = records.findLast(row => row.kind === 'input-state' && row.taskId === task.id)?.fullTaskInput;
    const context = records.findLast(row => row.kind === 'execution-context' && row.taskId === task.id &&
      row.status === 'completed')?.executionContext;
    if (task.id !== CHIEF_WEB_PILOT.taskId || input?.taskId !== task.id || input.targetDoc !== CHIEF_WEB_PILOT.path ||
        context?.pr?.url !== expectedPrUrl) throw new Error('CHIEF_WEB_PROJECTION_INVALID');
    const inputRevision = hash(input);
    const effects = completedEffects(records, binding.grantId);
    const evidence = await readExecutionEvidence({ task, context, binding, inputRevision });
    if (!evidence || typeof evidence.prHead !== 'string' || !sha.test(evidence.prHead) ||
        typeof evidence.evidenceDigest !== 'string' || !digest.test(evidence.evidenceDigest)) {
      throw new Error('CHIEF_WEB_PROJECTION_INVALID');
    }

    const historical = inputRevision === CHIEF_WEB_PILOT.previousInputRevision;
    const supplementGrantId = effects.supplement?.inputRevision === inputRevision ? binding.grantId : undefined;
    const complete = task.status === 'done' && context.phase === 'COMPLETED' &&
      context.terminalFinalization?.binding?.inputRevision === inputRevision;
    const candidate = context.candidate?.head;
    const waiting = ['WAIT_CI', 'WAIT_DECISION'].includes(context.phase);
    const currentWait = context.expectedWait?.inputRevision === inputRevision &&
      (context.expectedWait.candidateSha == null || context.expectedWait.candidateSha === candidate);
    const publicationBlocker = !historical && supplementGrantId && context.phase === 'WAIT_DECISION' && currentWait
      ? evidence.publicationBlocker : undefined;
    let phase = 'queued';
    if (['blocked', 'cancelled'].includes(task.status) || (!historical && !supplementGrantId) ||
        context.phase === 'PAUSED' || publicationBlocker || (waiting && !currentWait)) phase = 'blocked';
    else if (complete) phase = 'done';
    else if (context.phase === 'WAIT_CI') phase = 'waiting_ci';
    else if (context.phase === 'WAIT_DECISION') phase = 'awaiting_confirmation';
    else if (context.phase === 'EXECUTING') phase = 'executing';

    const exactCandidateEvidence = evidence.candidate === candidate && evidence.inputRevision === inputRevision;
    const window = binding.confirmationWindow;
    const confirmationWindow = Boolean(window && phase === 'awaiting_confirmation' && currentWait && exactCandidateEvidence &&
      window.inputRevision === inputRevision && window.candidate === candidate && window.prHead === evidence.prHead &&
      window.baseCommit === context.candidateScope?.baseCommit && window.reviewDigest === evidence.independentReview?.digest);
    return {
      contextRevision: hash([task.statusVersion, task.updatedAt ?? null, inputRevision, context, evidence.evidenceDigest, effects,
        ...(confirmationWindow ? [window] : [])]),
      inputRevision, supplementGrantId, phase, prHead: evidence.prHead, candidate,
      publicationBlocker, confirmationWindow,
      independentReview: exactCandidateEvidence ? evidence.independentReview : undefined,
      localChecks: exactCandidateEvidence ? evidence.localChecks : undefined,
      observedCalls: evidence.observedCalls,
      reconciled: evidence.reconciled === true && evidence.inputRevision === inputRevision,
      publication: effects.confirm,
      ci: evidence.ci,
    };
  };
}
