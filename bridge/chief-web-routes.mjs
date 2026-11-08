const route = '/issues/:issueId/chief-web-pilot';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const controls = new Set(['pause', 'resume', 'confirm']);
const requestDenials = new Set(['CHIEF_WEB_ACTION_INVALID', 'CHIEF_WEB_AUDIENCE_DENIED']);
const temporary = new Set(['CHIEF_WEB_STATE_UNAVAILABLE', 'CHIEF_WEB_LOG_UNAVAILABLE', 'CHIEF_WEB_OPERATION_UNKNOWN']);

function isUuid(value) {
  return typeof value === 'string' && uuid.test(value);
}

/** Mount on Paperclip's authenticated API router, after actor resolution. */
export function mountChiefWebRoutes(router, options = {}) {
  if (options.enabled !== true) return;
  const { pilot, chiefAgentId, getIssue, trustedBoardMutationOrigin, log } = options;
  if (options.deploymentMode !== 'authenticated' || !isUuid(chiefAgentId) ||
      ![router?.get, router?.post, pilot?.handle, getIssue, trustedBoardMutationOrigin, log]
        .every(fn => typeof fn === 'function')) {
    throw new Error('CHIEF_WEB_ROUTE_CONFIGURATION_INVALID');
  }

  function handler(mutation) {
    return async (request, response) => {
      response.set('Cache-Control', 'no-store');
      try {
        const actor = request.actor;
        const issueId = request.params.issueId;
        if (actor?.type !== 'board' || typeof actor.sessionId !== 'string' || !actor.sessionId ||
            typeof actor.userId !== 'string' || !actor.userId || !Array.isArray(actor.companyIds) ||
            !isUuid(issueId)) {
          return response.status(404).json({ code: 'CHIEF_WEB_AUDIENCE_DENIED' });
        }
        if (mutation) {
          const origin = await trustedBoardMutationOrigin(request);
          if (typeof origin !== 'string' || !/^https?:\/\//.test(origin)) {
            return response.status(403).json({ code: 'CHIEF_WEB_ORIGIN_DENIED' });
          }
        }
        if (mutation && !controls.has(request.body?.action)) {
          return response.status(400).json({ code: 'CHIEF_WEB_ACTION_INVALID' });
        }

        const issue = await getIssue(issueId);
        if (issue?.id !== issueId || issue.conversationAgentId !== chiefAgentId ||
            issue.conversationUserId !== actor.userId || !actor.companyIds.includes(issue.companyId) ||
            !Number.isSafeInteger(issue.conversationSessionGeneration)) {
          return response.status(404).json({ code: 'CHIEF_WEB_AUDIENCE_DENIED' });
        }
        const receipt = await pilot.handle({
          userId: actor.userId,
          companyId: issue.companyId,
          conversationId: issue.id,
          generation: issue.conversationSessionGeneration,
        }, mutation ? request.body : { action: 'status' });
        return response.status(mutation ? 202 : 200).json(receipt);
      } catch (error) {
        const code = typeof error?.code === 'string' && /^CHIEF_WEB_[A-Z_]+$/.test(error.code)
          ? error.code : 'CHIEF_WEB_STATE_UNAVAILABLE';
        try {
          await log({ code });
        } catch {
          return response.status(503).json({ code: 'CHIEF_WEB_LOG_UNAVAILABLE' });
        }
        const status = requestDenials.has(code)
          ? (code === 'CHIEF_WEB_ACTION_INVALID' ? 400 : 404)
          : (temporary.has(code) ? 503 : 409);
        return response.status(status).json({ code });
      }
    };
  }

  router.get(route, handler(false));
  router.post(route, handler(true));
}
