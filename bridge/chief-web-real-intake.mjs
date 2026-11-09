import { CHIEF_WEB_DAILY_DOCUMENTS, matchChiefWebDailyTarget, resolveChiefWebRealScope } from './chief-web-real-engine.mjs';

const route = '/issues/:issueId/chief-web-real';
const commentRoute = '/issues/:issueId/comments';
const activityAction = 'super_agent.chief_web_real';
const systemActor = 'super-agent-chief-web-real';
const originKind = 'super_agent_chief_web_real';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const nativeStatuses = new Set(['todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled']);
const is = (pattern, value) => typeof value === 'string' && pattern.test(value);
const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}
function checkConfig(config) {
  if (!config || !['companyId', 'chiefAgentId', 'conversationId', 'projectId'].every(key => is(uuid, config[key])) ||
      typeof config.userId !== 'string' || !config.userId || !Number.isSafeInteger(config.generation) || config.generation < 0 ||
      !Number.isSafeInteger(config.intakeFrom) || config.intakeFrom < 0 || !Number.isFinite(new Date(config.intakeFrom).getTime()) ||
      !Number.isSafeInteger(config.expiresAt) || config.expiresAt <= config.intakeFrom) {
    fail('CHIEF_WEB_REAL_CONFIGURATION_INVALID');
  }
}

function conversationMatches(conversation, config) {
  return same(conversation, {
    id: config.conversationId, companyId: config.companyId, conversationAgentId: config.chiefAgentId,
    conversationUserId: config.userId, conversationSessionGeneration: config.generation,
  });
}

export function verifyChiefWebRealOwnerMessage(message, config) {
  if (!same(message, {
    companyId: config.companyId, issueId: config.conversationId, authorUserId: config.userId, authorType: 'user',
    authorAgentId: null, createdByRunId: null, derivedAuthorAgentId: null, derivedCreatedByRunId: null,
    onBehalfOfUserId: null, deletedAt: null, origin: 'comment',
  }) || !is(uuid, message.id) || typeof message.clientRequestId !== 'string' || !message.clientRequestId ||
      (message.conversationSessionGeneration !== null && message.conversationSessionGeneration !== config.generation) ||
      !(message.createdAt instanceof Date) || message.createdAt.getTime() <= config.intakeFrom ||
      typeof message.body !== 'string' || !message.body.trim() || /^\s*\//.test(message.body) || message.body.length > 4000) {
    return null;
  }
  if (config.daily === true && matchChiefWebDailyTarget(message.body) !== config.targetDoc) return null;
  return Object.freeze({ id: message.id, text: message.body, generation: config.generation });
}

/** Native issue and its registration ledger share the chat row lock and a transaction. */
export function createChiefWebRealIntakeRepository({ db, issueService, schema, orm, config }) {
  checkConfig(config);
  const { activityLog, issueComments, agents, instanceSettings } = schema;
  const { and, asc, desc, eq, gt, isNull, sql } = orm;
  const issues = issueService(db);
  const daily = config.daily === true;
  if (daily) resolveChiefWebRealScope(config);
  const ledgerAction = target => daily ? activityAction + ':' + target : activityAction;
  const action = ledgerAction(config.targetDoc);
  const requestKey = systemActor + ':' + config.conversationId + ':' + config.generation + (daily ? ':' + config.targetDoc : '');
  const activityScope = entry => and(eq(activityLog.companyId, config.companyId), eq(activityLog.entityId, config.conversationId),
    eq(activityLog.entityType, 'issue'), eq(activityLog.actorType, 'system'), eq(activityLog.actorId, systemActor),
    eq(activityLog.action, entry));

  async function lockConversation(tx) {
    const conversation = await issues.getByIdForUpdate(config.conversationId, tx);
    if (!conversationMatches(conversation, config)) fail('CHIEF_WEB_REAL_AUDIENCE_DENIED', 404);
    return conversation;
  }

  async function assertIsolation(tx) {
    const [chief] = await tx.select({ runtimeConfig: agents.runtimeConfig }).from(agents)
      .where(and(eq(agents.id, config.chiefAgentId), eq(agents.companyId, config.companyId))).limit(1);
    const heartbeat = chief?.runtimeConfig?.heartbeat;
    const [settings] = await tx.select({ experimental: instanceSettings.experimental }).from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, 'default')).limit(1);
    // Disable both independent Native provider paths for this dedicated chat.
    if (heartbeat?.enabled !== false || heartbeat.wakeOnDemand !== false ||
        settings?.experimental?.enableFastResponses === true) {
      fail('CHIEF_WEB_REAL_NATIVE_DISPATCH_UNFENCED', 503);
    }
  }

  return Object.freeze({
    assertNativeIntakeSafe() {
      return db.transaction(async tx => {
        await lockConversation(tx);
        await assertIsolation(tx);
      });
    },

    transaction(work) {
      return db.transaction(async tx => {
        await lockConversation(tx);
        let latest;
        async function readLatest() {
          if (latest !== undefined) return latest;
          const [record] = await tx.select({ details: activityLog.details }).from(activityLog).where(activityScope(action))
            .orderBy(desc(sql`(${activityLog.details}->>'sequence')::bigint`)).limit(1);
          latest = record?.details ?? null;
          if (latest && (latest.schemaVersion !== 1 || latest.generation !== config.generation ||
              !Number.isSafeInteger(latest.sequence) || latest.sequence < 1 || !latest.state)) {
            fail('CHIEF_WEB_REAL_LEDGER_CHANGED');
          }
          return latest;
        }

        return work({
          async readState() {
            return (await readLatest())?.state ?? null;
          },
          async createTask({ title, description }) {
            if (typeof title !== 'string' || !title.trim() || title.length > 250 ||
                typeof description !== 'string' || description.length > 16384) fail('CHIEF_WEB_REAL_TASK_INPUT_INVALID');
            const task = await issues.create(config.companyId, {
              title, description, projectId: config.projectId, status: 'in_progress', visibility: 'private',
              createdByUserId: config.userId, responsibleUserId: config.userId, assigneeUserId: config.userId,
              originKind, originId: config.conversationId, idempotencyKey: requestKey,
            }, tx);
            if (!is(uuid, task?.id) || !task.identifier || !same(task, {
              projectId: config.projectId, companyId: config.companyId, originKind, originId: config.conversationId,
              responsibleUserId: config.userId, assigneeUserId: config.userId, assigneeAgentId: null,
            })) fail('CHIEF_WEB_REAL_TASK_WRITE_FAILED');
            return { id: task.id, identifier: task.identifier };
          },
          async setTask({ taskId, status, description }) {
            if (!is(uuid, taskId) || !nativeStatuses.has(status) ||
                (description !== undefined && (typeof description !== 'string' || description.length > 16384))) {
              fail('CHIEF_WEB_REAL_TASK_INPUT_INVALID');
            }
            if (daily && (await readLatest())?.state?.taskId !== taskId) fail('CHIEF_WEB_REAL_TASK_CHANGED');
            const task = await issues.getByIdForUpdate(taskId, tx);
            if (!same(task, {
              id: taskId, companyId: config.companyId, projectId: config.projectId, originKind,
              originId: config.conversationId, responsibleUserId: config.userId, assigneeUserId: config.userId, assigneeAgentId: null,
            })) fail('CHIEF_WEB_REAL_TASK_CHANGED');
            const updated = await issues.update(taskId, {
              status, companyGuard: config.companyId, ...(description !== undefined && { description }),
            }, tx);
            if (!same(updated, { id: taskId, status })) fail('CHIEF_WEB_REAL_TASK_WRITE_FAILED');
          },
          async appendState(state) {
            if (!state || typeof state !== 'object' || Array.isArray(state)) fail('CHIEF_WEB_REAL_LEDGER_CHANGED');
            const current = await readLatest();
            const details = {
              schemaVersion: 1, generation: config.generation, sequence: (current?.sequence ?? 0) + 1, state,
            };
            await tx.insert(activityLog).values({
              companyId: config.companyId, actorType: 'system', actorId: systemActor, action,
              entityType: 'issue', entityId: config.conversationId, responsibleUserId: config.userId, details,
            });
            latest = details;
          },
        });
      });
    },

    async readHistory() {
      if (!daily || config.targetDoc !== CHIEF_WEB_DAILY_DOCUMENTS[1]) return [];
      return db.transaction(async tx => {
        await lockConversation(tx);
        const priorDoc = CHIEF_WEB_DAILY_DOCUMENTS[0];
        const [row] = await tx.select({ details: activityLog.details }).from(activityLog)
          .where(activityScope(ledgerAction(priorDoc)))
          .orderBy(desc(sql`(${activityLog.details}->>'sequence')::bigint`)).limit(1);
        const state = row?.details?.state;
        const { pr, ci } = state ?? {};
        if (!same(row?.details, { schemaVersion: 1, generation: config.generation }) ||
            !same(state, { phase: 'done', targetDoc: priorDoc, generation: config.generation, revision: 1 }) ||
            !is(uuid, state.taskId) || !is(digest, state.inputRevision) || typeof state.identifier !== 'string' ||
            !Number.isSafeInteger(pr?.number) || pr.number < 1 || !is(sha, pr.headSha) ||
            !same(ci, { conclusion: 'success', headSha: pr.headSha, number: pr.number }) ||
            !is(digest, ci.checksDigest)) return [];
        return [{ taskId: state.taskId, identifier: state.identifier, targetDoc: priorDoc, revision: state.revision,
          prNumber: pr.number, headSha: pr.headSha, conclusion: ci.conclusion }];
      });
    },

    readOwnerMessages() {
      return db.transaction(async tx => {
        const conversation = await lockConversation(tx);
        await assertIsolation(tx);
        const boundary = conversation.conversationBoundaryCommentId;
        if (config.generation > 0 && !boundary) fail('CHIEF_WEB_REAL_AUDIENCE_DENIED', 404);
        const afterBoundary = boundary ? sql`
          (${issueComments.createdAt}, ${issueComments.id}) >
          (select ${issueComments.createdAt}, ${issueComments.id} from ${issueComments}
            where ${issueComments.id} = ${boundary} and ${issueComments.issueId} = ${config.conversationId}
              and ${issueComments.companyId} = ${config.companyId})
        ` : undefined;
        const messages = await tx.select().from(issueComments).where(and(
          eq(issueComments.companyId, config.companyId), eq(issueComments.issueId, config.conversationId),
          eq(issueComments.authorUserId, config.userId), isNull(issueComments.deletedAt),
          gt(issueComments.createdAt, new Date(config.intakeFrom)), afterBoundary,
        )).orderBy(asc(issueComments.createdAt), asc(issueComments.id)).limit(65);
        if (messages.length > 64) fail('CHIEF_WEB_REAL_MESSAGE_WINDOW_EXCEEDED');
        return messages.map(message => verifyChiefWebRealOwnerMessage(message, config)).filter(Boolean);
      });
    },
  });
}

function validateCommand(command) {
  const controlFields = ['action', 'requestId', 'generation', 'expectedRevision'];
  const confirmFields = ['candidateSha', 'reviewDigest', 'previousHead', 'baseSha'];
  if (!['pause', 'resume', 'confirm'].includes(command?.action) || !is(uuid, command.requestId) ||
      !Number.isSafeInteger(command.generation) || !is(digest, command.expectedRevision)) {
    fail('CHIEF_WEB_REAL_ACTION_INVALID', 400);
  }
  if (command.action === 'confirm') {
    controlFields.push(...confirmFields);
    if (!is(sha, command.candidateSha) || !is(digest, command.reviewDigest) ||
        !(command.previousHead === null || is(sha, command.previousHead)) || !is(sha, command.baseSha)) {
      fail('CHIEF_WEB_REAL_ACTION_INVALID', 400);
    }
  }
  if (Object.keys(command).length !== controlFields.length || !controlFields.every(field => Object.hasOwn(command, field))) {
    fail('CHIEF_WEB_REAL_ACTION_INVALID', 400);
  }
  return Object.freeze({ ...command });
}

/** Polling only reads state. Native comment completion and process boot wake the managed intake. */
export function mountChiefWebRealRoutes(router, { config, origin, repository, engine, trustedBoardMutationOrigin, log }) {
  if (![router?.get, router?.post, repository?.assertNativeIntakeSafe,
    engine?.tick, engine?.status, engine?.control, trustedBoardMutationOrigin, log].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_REAL_CONFIGURATION_INVALID');
  }

  async function reportError(error, response) {
    const known = typeof error?.code === 'string' && /^CHIEF_WEB_REAL_[A-Z_]+$/.test(error.code);
    const code = known ? error.code : 'CHIEF_WEB_REAL_STATE_UNAVAILABLE';
    try {
      await log({ code });
    } catch {
      return response?.status(503).json({ code: 'CHIEF_WEB_REAL_LOG_UNAVAILABLE' });
    }
    if (response) return response.status(known ? error.status ?? 409 : 503).json({ code });
  }

  let queued = false;
  let active = false;
  function wake() {
    queued = true;
    if (active) return;
    active = true;
    setImmediate(async () => {
      try {
        while (queued) {
          queued = false;
          await engine.tick();
        }
      } catch (error) {
        await reportError(error);
      } finally {
        active = false;
        if (queued) wake();
      }
    });
  }

  function matchesBoard(request) {
    const { actor } = request;
    return request.params.issueId === config.conversationId && actor?.type === 'board' &&
      typeof actor.sessionId === 'string' && Boolean(actor.sessionId) && actor.userId === config.userId &&
      Array.isArray(actor.companyIds) && actor.companyIds.includes(config.companyId);
  }

  async function assertOrigin(request) {
    if (await trustedBoardMutationOrigin(request) !== origin) fail('CHIEF_WEB_REAL_ORIGIN_DENIED', 403);
  }

  router.post(commentRoute, async (request, response, next) => {
    if (request.params.issueId !== config.conversationId) return next();
    if (!matchesBoard(request)) return response.status(404).json({ code: 'CHIEF_WEB_REAL_AUDIENCE_DENIED' });
    try {
      await assertOrigin(request);
      await repository.assertNativeIntakeSafe();
      if (typeof request.body?.body === 'string' && /^\s*\//.test(request.body.body)) {
        fail('CHIEF_WEB_REAL_NATIVE_COMMAND_DENIED', 400);
      }
      if (config.daily === true && matchChiefWebDailyTarget(request.body?.body) !== config.targetDoc) {
        fail('CHIEF_WEB_REAL_DAILY_TARGET_DENIED', 409);
      }
    } catch (error) {
      return reportError(error, response);
    }
    const nativeJson = response.json;
    response.json = function (body) {
      const result = nativeJson.call(this, body);
      if (this.statusCode === 201 && is(uuid, body?.id)) wake();
      return result;
    };
    return next();
  });

  function handler(mutation) {
    return async (request, response) => {
      response.set('Cache-Control', 'no-store');
      if (!matchesBoard(request)) return response.status(404).json({ code: 'CHIEF_WEB_REAL_AUDIENCE_DENIED' });
      try {
        if (!mutation) {
          const view = await engine.status();
          if (config.daily === true) return response.status(200).json({ ...view, daily: true, history: await repository.readHistory() });
          return response.status(200).json(view);
        }
        await assertOrigin(request);
        const command = validateCommand(request.body);
        if (command.generation !== config.generation) fail('CHIEF_WEB_REAL_GENERATION_CHANGED');
        const result = await engine.control(command);
        if (command.action !== 'pause') wake();
        if (config.daily === true) return response.status(202).json({ ...result, daily: true, history: await repository.readHistory() });
        return response.status(202).json(result);
      } catch (error) {
        return reportError(error, response);
      }
    };
  }

  router.get(route, handler(false));
  router.post(route, handler(true));
  wake();
}

/** The mounted runtime uses the same pinned Paperclip database and issue service as Native Chat. */
export async function loadPinnedChiefWebRealIntake({ config, createEngine, ports, log, publicUrl = process.env.PAPERCLIP_PUBLIC_URL } = {}) {
  checkConfig(config);
  const parsed = URL.parse(publicUrl ?? '');
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || typeof createEngine !== 'function' || typeof log !== 'function') {
    fail('CHIEF_WEB_REAL_CONFIGURATION_INVALID');
  }
  const binding = Object.freeze({ ...config });
  const [{ issueService }, schema, orm] = await Promise.all([
    import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/issues.js'),
    import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),
    import('/opt/paperclip/node_modules/drizzle-orm/index.js'),
  ]);
  return async ({ api, db, deploymentMode, trustedBoardMutationOrigin }) => {
    if (deploymentMode !== 'authenticated') fail('CHIEF_WEB_REAL_AUTH_REQUIRED');
    const repository = createChiefWebRealIntakeRepository({ db, issueService, schema, orm, config: binding });
    await repository.assertNativeIntakeSafe();
    const engine = await createEngine({ ...ports, repository, config: binding, log });
    mountChiefWebRealRoutes(api, { config: binding, origin: parsed.origin, repository, engine, trustedBoardMutationOrigin, log });
    await log({ code: 'CHIEF_WEB_REAL_INTAKE_READY' });
  };
}
