/** Called by Native after settling the original Chief reply, or during reconciliation. */
export function createChiefWebSettlement({ pilot, resolveTurn, log } = {}) {
  if (![pilot?.handle, resolveTurn, log].every(fn => typeof fn === 'function')) {
    throw new Error('CHIEF_WEB_SETTLEMENT_CONFIGURATION_INVALID');
  }

  return async function settleChiefWebPilot({ db, run }) {
    if (run?.status !== 'succeeded' || run.contextSnapshot?.conversationMode !== true) return;
    try {
      const turn = await resolveTurn({ db, run });
      if (!turn) return;
      const { actor, messageId } = turn;
      const status = await pilot.handle(actor, { action: 'status' });
      const receipt = await pilot.handle(actor, {
        action: 'supplement', messageId, requestId: messageId, contextRevision: status.contextRevision,
      });
      await log({ code: 'CHIEF_WEB_SETTLEMENT_RECORDED', operationId: receipt.operationId });
      return receipt;
    } catch (error) {
      const code = typeof error?.code === 'string' && /^CHIEF_WEB_[A-Z_]+$/.test(error.code)
        ? error.code : 'CHIEF_WEB_SETTLEMENT_UNKNOWN';
      await log({ code });
      throw Object.assign(new Error(code), { code });
    }
  };
}
