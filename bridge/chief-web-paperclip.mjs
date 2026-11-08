import { createChiefWebNativeStore } from './chief-web-native-store.mjs';
import { createChiefWebPilot } from './chief-web-pilot.mjs';
import { mountChiefWebRoutes } from './chief-web-routes.mjs';
import { createChiefWebSupplementEvidence } from './chief-web-supplement-evidence.mjs';
import { createChiefWebSettlement } from './chief-web-settlement.mjs';

/** Compose the pinned app hook with the server's trusted Native pilot bindings. */
export function createChiefWebPaperclipMount({ loadBindings, log, now = Date.now, onMounted } = {}) {
  if (![loadBindings, log, now].every(fn => typeof fn === 'function') ||
      (onMounted !== undefined && typeof onMounted !== 'function')) {
    throw new Error('CHIEF_WEB_MOUNT_CONFIGURATION_INVALID');
  }

  return async ({ api, db, deploymentMode, getIssue, trustedBoardMutationOrigin }) => {
    if (deploymentMode !== 'authenticated') throw new Error('CHIEF_WEB_MOUNT_AUTH_REQUIRED');
    try {
      const bindings = await loadBindings({ db });
      if (!bindings) throw new Error('CHIEF_WEB_MOUNT_BINDINGS_MISSING');
      const { chiefAgentId, repository, readGrant, readProjection, readNativeEvidence, readChiefCallReceipt } = bindings;
      const verifyOwnerSupplement = createChiefWebSupplementEvidence({ chiefAgentId, readNativeEvidence, readChiefCallReceipt, log });
      const store = createChiefWebNativeStore({ repository, readGrant, readProjection, verifyOwnerSupplement, now });
      const pilot = createChiefWebPilot({ ...store, log, now });
      mountChiefWebRoutes(api, { enabled: true, deploymentMode, pilot, chiefAgentId, getIssue, trustedBoardMutationOrigin, log });
      await onMounted?.(pilot);
      await log({ code: 'CHIEF_WEB_MOUNT_READY' });
    } catch {
      try {
        await log({ code: 'CHIEF_WEB_MOUNT_FAILED' });
      } catch {
        throw new Error('CHIEF_WEB_MOUNT_LOG_UNAVAILABLE');
      }
      throw new Error('CHIEF_WEB_MOUNT_FAILED');
    }
  };
}

/** Options consumed by the pinned server loader when the pilot is explicitly enabled. */
export function createChiefWebPaperclipRuntime({ resolveTurn, ...options } = {}) {
  if (typeof resolveTurn !== 'function') throw new Error('CHIEF_WEB_SETTLEMENT_CONFIGURATION_INVALID');
  let settle;
  return Object.freeze({
    mountChiefWebPilot: createChiefWebPaperclipMount({
      ...options,
      onMounted(pilot) {
        settle = createChiefWebSettlement({ pilot, resolveTurn, log: options.log });
      },
    }),
    settleChiefWebPilot(context) {
      if (!settle) throw new Error('CHIEF_WEB_MOUNT_BINDINGS_MISSING');
      return settle(context);
    },
  });
}
