import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';
import { readChiefWebIntents } from './chief-web-native-store.mjs';
import { validateChiefWebEffectResult, validateChiefWebIntent } from './chief-web-intent-consumer.mjs';

const digest = /^[a-f0-9]{64}$/;
const intentKind = 'chief-web-intent';
const claimKind = 'chief-web-effect-claim';
const completionKind = 'chief-web-effect-completion';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function childId(operationId, kind) {
  return createHash('sha256').update(JSON.stringify([operationId, kind])).digest('hex');
}

function canonical(value) {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}

function resultProjection(result, intent) {
  const { operationId, taskId, grantId, status, inputRevision } = result;
  const common = { operationId, taskId, grantId, status, inputRevision };
  if (intent.action === 'supplement') {
    return { ...common, previousInputRevision: result.previousInputRevision, messageDigest: result.messageDigest };
  }
  return {
    ...common, repository: result.repository, pullRequest: result.pullRequest,
    previousHead: result.previousHead, headSha: result.headSha, confirmationOperationId: result.confirmationOperationId,
  };
}

function one(records, kind, operationId) {
  const matches = records.filter(record => record.kind === kind && record.operationId === operationId);
  if (matches.length > 1) fail('CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS');
  return matches[0];
}

/** The trusted execution verifier runs under both Native issue locks. */
export function createChiefWebIntentAuthority({ repository, readGrant, verifyExecution, now = Date.now } = {}) {
  if (typeof repository?.transaction !== 'function' ||
      ![readGrant, verifyExecution, now].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_EFFECT_AUTHORITY_INVALID');
  }

  function locked(operationId, callback) {
    if (typeof operationId !== 'string' || !digest.test(operationId)) fail('CHIEF_WEB_OPERATION_INVALID');
    return repository.transaction(async transaction => {
      const task = await transaction.lockTask(CHIEF_WEB_PILOT.taskId);
      if (task?.id !== CHIEF_WEB_PILOT.taskId) fail('CHIEF_WEB_NATIVE_TASK_DENIED');
      const grant = await readGrant({ task, transaction });
      const records = await transaction.listTaskOperations(task.id);
      const intents = readChiefWebIntents(records);
      const intent = one(intents, intentKind, operationId);
      if (!grant || !intent || grant.grantId !== intent.grantId || intent.taskId !== task.id ||
          intent.expiresAt !== grant.expiresAt || !validateChiefWebIntent(intent, operationId)) return { operationId, status: 'blocked' };
      const claim = one(records, claimKind, childId(operationId, claimKind));
      const completion = one(records, completionKind, childId(operationId, completionKind));
      for (const record of [claim, completion]) {
        if (record && (record.parentOperationId !== operationId || record.taskId !== task.id ||
            record.grantId !== grant.grantId || record.payloadHash !== intent.payloadHash)) {
          fail('CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS');
        }
      }
      if (completion && !claim) fail('CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS');
      return callback({ transaction, task, grant, intent, intents, records, claim, completion });
    });
  }

  function append(transaction, intent, kind, fields) {
    return transaction.appendOperation({
      taskId: intent.taskId,
      grantId: intent.grantId,
      operationId: childId(intent.operationId, kind),
      parentOperationId: intent.operationId,
      payloadHash: intent.payloadHash,
      kind,
      ...fields,
    });
  }

  return Object.freeze({
    claim(operationId) {
      return locked(operationId, async ({ transaction, task, grant, intent, intents, records, claim, completion }) => {
        if (completion) {
          if (completion.status !== 'completed' || claim?.status !== 'claimed' ||
              !validateChiefWebEffectResult(completion.result, intent)) fail('CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS');
          return { status: 'completed', intent, receipt: completion.result };
        }
        if (claim?.status === 'claimed') return { status: 'claimed', intent };
        if (claim) fail('CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS');

        const lastControl = intents.findLast(record => ['pause', 'resume'].includes(record.action));
        if (lastControl?.action === 'pause' ||
            await verifyExecution({ transaction, task, grant, intent, records }) !== true) {
          return { operationId, status: 'blocked' };
        }
        const claimedAt = now();
        if (!Number.isSafeInteger(claimedAt) || claimedAt >= grant.expiresAt) return { operationId, status: 'blocked' };
        await append(transaction, intent, claimKind, { status: 'claimed', claimedAt });
        return { status: 'claimed_now', intent };
      });
    },
    complete({ operationId, result }) {
      return locked(operationId, async ({ transaction, intent, claim, completion }) => {
        if (claim?.status !== 'claimed' || !validateChiefWebEffectResult(result, intent)) {
          fail('CHIEF_WEB_EFFECT_COMPLETION_DENIED');
        }
        const projection = resultProjection(result, intent);
        if (completion) {
          if (completion.status !== 'completed' || canonical(completion.result) !== canonical(projection)) {
            fail('CHIEF_WEB_EFFECT_HISTORY_AMBIGUOUS');
          }
        } else {
          await append(transaction, intent, completionKind, { status: 'completed', result: projection });
        }
        return { operationId, status: 'completed' };
      });
    },
  });
}
