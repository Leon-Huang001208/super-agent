/** Consume only durable Paperclip handoffs. This worker never creates tasks. */
export function createChiefWebRealBroker({ spool, executor, publisher, admission, log } = {}) {
  if (![spool?.list, spool?.readRequest, spool?.observe, spool?.claim, spool?.complete, spool?.isClaimed, spool?.rejectUnclaimed,
    spool?.isPaused, spool?.withFence, executor?.execute, executor?.observe, publisher?.publish,
    publisher?.observePublication, publisher?.readCi, admission?.run, log].every(fn => typeof fn === 'function')) {
    throw new Error('CHIEF_WEB_REAL_BROKER_CONFIGURATION_INVALID');
  }

  async function consume(operationId) {
    const envelope = await spool.readRequest(operationId);
    if (!envelope || await spool.observe(operationId)) return false;
    const { request } = envelope;
    if (request.role === 'ci') {
      const reply = await publisher.readCi(request);
      if (['completed', 'blocked', 'unknown'].includes(reply?.status)) await spool.complete(operationId, reply);
      return false;
    }
    return spool.withFence(async () => {
      if (await spool.observe(operationId)) return false;
      const wasClaimed = await spool.isClaimed(operationId);
      const paused = await spool.isPaused();
      if (!wasClaimed && paused) return false;
      try {
        const result = await admission.run(request, async lease => {
          if (await spool.isPaused() && !wasClaimed) return { status: 'pending' };
          let fresh;
          try { fresh = await spool.claim(operationId); }
          catch (error) {
            if (error.code === 'CHIEF_WEB_REAL_SCOPE_EXPIRED') return { status: 'blocked', code: error.code, unclaimed: true };
            throw error;
          }
          if (request.role === 'publish') {
            return publisher[fresh ? 'publish' : 'observePublication'](request, lease);
          }
          return executor[fresh ? 'execute' : 'observe'](request, lease, { dispatchAllowed: !await spool.isPaused() });
        });
        if (result?.unclaimed === true) await spool.rejectUnclaimed(operationId, result.code);
        else if (['completed', 'blocked', 'unknown'].includes(result?.status)) await spool.complete(operationId, result);
      } catch (error) {
        if (await spool.isClaimed(operationId)) throw error;
        const code = /^ADMISSION_[A-Z_]+$/.test(error?.code ?? '') ? 'CHIEF_WEB_REAL_' + error.code : error?.code;
        if (!/^CHIEF_WEB_REAL_[A-Z_]+$/.test(code ?? '')) throw error;
        await spool.rejectUnclaimed(operationId, code);
      }
      return true;
    });
  }

  return Object.freeze({
    async tick() {
      for (const operationId of await spool.list()) {
        try {
          if (await consume(operationId)) break;
        } catch (error) {
          const code = /^[A-Z][A-Z0-9_]{3,90}$/.test(error?.code ?? '') ? error.code : 'CHIEF_WEB_REAL_BROKER_UNKNOWN';
          await log({ code, operationId });
          break;
        }
      }
    },
  });
}
