import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const kind = 'chief-web-intent';
const digest = /^[a-f0-9]{64}$/;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function readIntents(records) {
  const intents = records.filter(record => record.kind === kind);
  if (intents.some(record => record.status !== 'reserved' || record.receipt?.operationId !== record.operationId ||
      typeof record.operationId !== 'string' || !digest.test(record.operationId) ||
      !['supplement', 'pause', 'resume', 'confirm'].includes(record.action)) ||
      new Set(intents.map(record => record.operationId)).size !== intents.length) {
    fail('CHIEF_WEB_OPERATION_UNKNOWN');
  }
  return intents;
}

function controlFrom(records) {
  const lastControl = records.findLast(record => record.action === 'pause' || record.action === 'resume');
  return lastControl?.action === 'pause' ? 'paused' : 'active';
}

/**
 * Adapts the existing official Native repository. readProjection translates
 * the locked activity history and authoritative RWB evidence into pilot state.
 * The application must use the same task transaction before claiming work.
 */
export function createChiefWebNativeStore({ repository, readGrant, readProjection, verifyOwnerSupplement, now = Date.now } = {}) {
  if (typeof repository?.transaction !== 'function' ||
      ![readGrant, readProjection, verifyOwnerSupplement, now].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_NATIVE_STORE_INVALID');
  }

  async function withTaskTransaction(taskId, handle) {
    if (taskId !== CHIEF_WEB_PILOT.taskId) fail('CHIEF_WEB_NATIVE_TASK_DENIED');
    const outcome = await repository.transaction(async transaction => {
      const task = await transaction.lockTask(taskId);
      if (task?.id !== taskId) return { error: 'CHIEF_WEB_NATIVE_TASK_DENIED' };
      const grant = await readGrant({ task });
      const ownerMatches = grant?.taskId === taskId && grant.ownerId === task.responsibleUserId &&
        grant.companyId === task.companyId;
      const binding = ownerMatches ? Object.freeze({ ...grant }) : null;
      const records = await transaction.listTaskOperations(taskId);
      const intents = readIntents(records);
      const pilotRecords = intents.filter(record => record.grantId === binding?.grantId);
      let projection;
      let writeAttempted = false;

      async function readState() {
        if (projection) return projection;
        const state = await readProjection({ task, records, binding });
        if (typeof state?.contextRevision !== 'string' || !digest.test(state.contextRevision)) {
          fail('CHIEF_WEB_PROJECTION_INVALID');
        }
        const contextRevision = createHash('sha256').update(JSON.stringify([
          state.contextRevision, binding.grantId, intents.map(record => record.operationId),
        ])).digest('hex');
        projection = Object.freeze({
          ...state,
          contextRevision,
          control: controlFrom(pilotRecords),
          supplementReserved: intents.some(record => record.action === 'supplement'),
          confirmationReserved: intents.some(record => record.action === 'confirm'),
        });
        return projection;
      }

      function readOperation(operationId) {
        const matches = records.filter(record => record.operationId === operationId);
        if (matches.length === 0) return null;
        const [existing] = matches;
        if (matches.length !== 1 || existing.kind !== kind || existing.grantId !== binding.grantId ||
            existing.status !== 'reserved' || existing.receipt?.operationId !== operationId) {
          fail('CHIEF_WEB_OPERATION_UNKNOWN');
        }
        return { payloadHash: existing.payloadHash, receipt: existing.receipt };
      }

      const port = {
        readBinding: () => binding,
        readState,
        async readStatus() {
          const state = await readState();
          return {
            taskId,
            contextRevision: state.contextRevision,
            inputRevision: state.inputRevision,
            phase: state.phase,
            control: state.control,
            prHead: state.prHead,
          };
        },
        readOperation,
        isOwnerSupplement: (verifiedBinding, messageId) => verifyOwnerSupplement({ task, binding: verifiedBinding, messageId }),
        async reserveOperation(operation) {
          const state = await readState();
          const observedAt = now();
          if (operation.grantId !== binding.grantId || operation.expiresAt !== binding.expiresAt ||
              !Number.isSafeInteger(observedAt) || observedAt >= binding.expiresAt ||
              operation.expected.contextRevision !== state.contextRevision || readOperation(operation.operationId)) {
            fail('CHIEF_WEB_RESERVATION_CONFLICT');
          }
          const receipt = { operationId: operation.operationId, status: 'reserved' };
          writeAttempted = true;
          await transaction.appendOperation({ ...operation, taskId, kind, status: 'reserved', receipt });
          return receipt;
        },
      };

      try {
        return { value: await handle(port) };
      } catch (error) {
        // The repository maps exceptions to its own codes. Preserve the policy
        // denial only when no write was attempted in this transaction.
        if (!writeAttempted && /^CHIEF_WEB_[A-Z_]+$/.test(error?.code ?? '')) return { error: error.code };
        throw error;
      }
    });
    if (outcome.error) fail(outcome.error);
    return outcome.value;
  }

  return Object.freeze({ withTaskTransaction });
}
