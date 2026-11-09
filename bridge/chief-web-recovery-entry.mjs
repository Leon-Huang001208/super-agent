import { createChiefWebRecovery } from './chief-web-recovery.mjs';
import { createChiefWebRecoveryPublisher } from './chief-web-recovery-publisher.mjs';
import { createChiefWebRecoveryFinalization } from './chief-web-recovery-finalization.mjs';

/**
 * Managed controller entry. Bindings come from the pinned Paperclip issue
 * repository, and the host and Native capabilities are deployment-owned.
 * The HTTP/browser path does not select or load capabilities.
 */
export function createChiefWebRecoveryEntry({
  bindings, readExecution, hostPublication, nativeFinalization, log, now = Date.now,
} = {}) {
  if (!hostPublication || !nativeFinalization || !bindings?.repository || !bindings?.readGrant) {
    throw new Error('CHIEF_WEB_RECOVERY_CONFIGURATION_INVALID');
  }
  return createChiefWebRecovery({
    repository: bindings.repository, readGrant: bindings.readGrant, readExecution,
    publisher: createChiefWebRecoveryPublisher({ ...hostPublication, now }),
    finalization: createChiefWebRecoveryFinalization(nativeFinalization), log, now,
  });
}
