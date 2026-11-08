import { createChiefWebNativeStore } from './chief-web-native-store.mjs';
import { createChiefWebPilot } from './chief-web-pilot.mjs';
import { mountChiefWebRoutes } from './chief-web-routes.mjs';

/** Compose the pinned app hook with the server's trusted Native pilot bindings. */
export function createChiefWebPaperclipMount({ loadBindings, log, now = Date.now } = {}) {
  if (![loadBindings, log, now].every(fn => typeof fn === 'function')) {
    throw new Error('CHIEF_WEB_MOUNT_CONFIGURATION_INVALID');
  }

  return async ({ api, db, deploymentMode, getIssue, trustedBoardMutationOrigin }) => {
    if (deploymentMode !== 'authenticated') throw new Error('CHIEF_WEB_MOUNT_AUTH_REQUIRED');
    try {
      const bindings = await loadBindings({ db });
      if (!bindings) throw new Error('CHIEF_WEB_MOUNT_BINDINGS_MISSING');
      const { chiefAgentId, repository, readGrant, readProjection, verifyOwnerSupplement } = bindings;
      const store = createChiefWebNativeStore({ repository, readGrant, readProjection, verifyOwnerSupplement, now });
      const pilot = createChiefWebPilot({ ...store, log, now });
      mountChiefWebRoutes(api, { enabled: true, deploymentMode, pilot, chiefAgentId, getIssue, trustedBoardMutationOrigin, log });
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
