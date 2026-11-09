import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const route = '/issues/:issueId/chief-web-evaluation';
const action = 'super_agent.chief_web_evaluation';
const systemActor = 'super-agent-chief-web-evaluation';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const fixture = Object.freeze({
  version: 1,
  path: 'docs/fixtures/chief-web-evaluation.md',
  input: '# Chief 网页演练\n',
  supplement: '\n纸夹任务完成后，按本次候选校验模拟 CI。\n',
});
const statusByPhase = { queued: 'todo', running: 'todo', waiting_ci: 'in_review', done: 'done', blocked: 'blocked' };

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function matchesConversation(row, config) {
  return row?.id === config.conversationId && row.companyId === config.companyId &&
    row.conversationAgentId === config.chiefAgentId && row.conversationUserId === config.userId &&
    Number.isSafeInteger(row.conversationSessionGeneration);
}

function scopedTo(state, conversation) {
  return state.generation === conversation.conversationSessionGeneration;
}

function executeFixture(state) {
  if (state.input?.version !== fixture.version || state.input.path !== fixture.path || state.input.content !== fixture.input) {
    fail('CHIEF_WEB_EVALUATION_FIXTURE_CHANGED');
  }
  const artifact = state.input.content + fixture.supplement;
  return {
    artifact,
    candidateSha: digest(JSON.stringify([state.taskId, state.operationId, fixture.version, fixture.path, artifact])),
  };
}

function project(conversation, state) {
  const generation = conversation.conversationSessionGeneration;
  if (!state) return { generation, phase: 'ready' };
  if (!scopedTo(state, conversation)) return { generation, phase: 'closed', code: 'CHIEF_WEB_EVALUATION_GENERATION_CHANGED' };
  const { taskId, identifier, operationId, candidateSha, phase, receipt, leaseHeld } = state;
  return { generation, taskId, identifier, operationId, candidateSha, phase, receipt, leaseReleased: !leaseHeld };
}

export function createChiefWebEvaluation({ repository, log, execute = executeFixture } = {}) {
  if (![repository?.transaction, log, execute].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_EVALUATION_CONFIGURATION_INVALID');
  }

  async function observe(code) {
    try {
      await log({ code });
    } catch {
      console.error(JSON.stringify({ code: 'CHIEF_WEB_EVALUATION_LOG_UNAVAILABLE' }));
    }
  }

  async function transaction(work) {
    return repository.transaction(async port => {
      const conversation = await port.lockConversation();
      if (!conversation) fail('CHIEF_WEB_EVALUATION_AUDIENCE_DENIED', 404);
      const state = await port.readState();
      return work(port, conversation, state);
    });
  }

  async function blockReset(port, state) {
    await port.settleTask(state, 'blocked');
    await port.appendState({ ...state, sequence: state.sequence + 1, phase: 'blocked', leaseHeld: false,
      receipt: { kind: 'blocked', code: 'CHIEF_WEB_EVALUATION_GENERATION_CHANGED' } });
  }

  return Object.freeze({
    observe,
    status: () => transaction(async (port, conversation, state) => {
      if (state && scopedTo(state, conversation)) await port.lockTask(state);
      return project(conversation, state);
    }),
    async create({ requestId, generation }) {
      if (typeof requestId !== 'string' || !uuid.test(requestId) || !Number.isSafeInteger(generation)) {
        fail('CHIEF_WEB_EVALUATION_REQUEST_INVALID', 400);
      }
      const result = await transaction(async (port, conversation, state) => {
        if (generation !== conversation.conversationSessionGeneration || (state && !scopedTo(state, conversation))) {
          fail('CHIEF_WEB_EVALUATION_GENERATION_CHANGED');
        }
        if (state) {
          if (requestId !== state.requestId) fail('CHIEF_WEB_EVALUATION_ALREADY_REGISTERED');
          await port.lockTask(state);
          return project(conversation, state);
        }
        const task = await port.createTask({ requestId });
        const next = {
          sequence: 1, generation, requestId, operationId: randomUUID(), taskId: task.id, identifier: task.identifier,
          phase: 'queued', leaseHeld: false,
          input: { version: fixture.version, path: fixture.path, content: fixture.input },
          receipt: { kind: 'registered' },
        };
        await port.appendState(next);
        return project(conversation, next);
      });
      await observe('CHIEF_WEB_EVALUATION_REGISTERED');
      return result;
    },
    async tick() {
      const claim = await transaction(async (port, conversation, state) => {
        if (!state || state.phase === 'done' || state.phase === 'blocked') return null;
        if (!scopedTo(state, conversation)) {
          await port.lockTask(state);
          await blockReset(port, state);
          return null;
        }
        if (state.phase === 'waiting_ci') return null;
        await port.lockTask(state);
        if (state.phase === 'running') return state;
        const next = { ...state, sequence: state.sequence + 1, phase: 'running', leaseHeld: true,
          receipt: { kind: 'executor_claimed' } };
        await port.appendState(next);
        return next;
      });
      if (!claim) return;
      // Pure fixture evaluation. Reconcile a durable claim with the same attempt and bytes after a crash.
      const result = await execute(claim);
      await transaction(async (port, conversation, state) => {
        if (state?.phase !== 'running' || state.operationId !== claim.operationId) return;
        await port.lockTask(state);
        if (!scopedTo(state, conversation)) {
          await blockReset(port, state);
          return;
        }
        await port.settleTask(state, 'waiting_ci', result.artifact);
        await port.appendState({ ...state, ...result, sequence: state.sequence + 1, phase: 'waiting_ci', leaseHeld: false,
          receipt: { kind: 'waiting_ci', source: 'fixture', candidateSha: result.candidateSha, path: fixture.path } });
      });
      await observe('CHIEF_WEB_EVALUATION_TICK_SETTLED');
    },
    async acceptCi({ operationId, candidateSha, conclusion }) {
      if (typeof operationId !== 'string' || !uuid.test(operationId) || typeof candidateSha !== 'string' ||
          !sha.test(candidateSha) || (conclusion !== 'success' && conclusion !== 'failure')) {
        fail('CHIEF_WEB_EVALUATION_REQUEST_INVALID', 400);
      }
      const result = await transaction(async (port, conversation, state) => {
        if (!state || !scopedTo(state, conversation) || operationId !== state.operationId || candidateSha !== state.candidateSha) {
          fail('CHIEF_WEB_EVALUATION_CI_MISMATCH');
        }
        await port.lockTask(state);
        if (state.receipt?.kind === 'ci' && state.receipt.conclusion === conclusion) return project(conversation, state);
        if (state.phase !== 'waiting_ci') fail('CHIEF_WEB_EVALUATION_CI_MISMATCH');
        const phase = conclusion === 'success' ? 'done' : 'blocked';
        const next = { ...state, sequence: state.sequence + 1, phase, leaseHeld: false,
          receipt: { kind: 'ci', source: 'simulation', conclusion, candidateSha, operationId, taskId: state.taskId, path: fixture.path } };
        await port.settleTask(state, phase);
        await port.appendState(next);
        return project(conversation, next);
      });
      await observe('CHIEF_WEB_EVALUATION_CI_SETTLED');
      return result;
    },
  });
}

export function createChiefWebEvaluationRepository({ db, issueService, schema, orm, config }) {
  const { activityLog } = schema;
  const { eq, and, desc, sql } = orm;
  const issues = issueService(db);
  return Object.freeze({
    transaction(callback) {
      return db.transaction(async tx => {
        const scope = and(eq(activityLog.companyId, config.companyId), eq(activityLog.entityId, config.conversationId),
          eq(activityLog.entityType, 'issue'), eq(activityLog.actorType, 'system'),
          eq(activityLog.actorId, systemActor), eq(activityLog.action, action));
        return callback({
          async lockConversation() {
            const conversation = await issues.getByIdForUpdate(config.conversationId, tx);
            return matchesConversation(conversation, config) ? conversation : null;
          },
          async readState() {
            const [row] = await tx.select({ details: activityLog.details }).from(activityLog).where(scope)
              .orderBy(desc(sql`(${activityLog.details}->>'sequence')::bigint`)).limit(1);
            return row?.details ?? null;
          },
          async createTask({ requestId }) {
            const task = await issues.create(config.companyId, {
              title: 'Chief 网页新建任务演练', description: `固定文档夹具\n\n\`${fixture.path}\`\n\n${fixture.input}`,
              projectId: config.projectId, status: 'todo', priority: 'low', visibility: 'private',
              createdByUserId: config.userId, responsibleUserId: config.userId,
              originKind: 'super_agent_chief_web_evaluation', originId: config.conversationId,
              idempotencyKey: `${systemActor}:${config.conversationId}:${requestId}`,
            }, tx);
            if (!task?.id || !task.identifier) fail('CHIEF_WEB_EVALUATION_TASK_WRITE_FAILED');
            return task;
          },
          async lockTask(state) {
            const task = await issues.getByIdForUpdate(state.taskId, tx);
            if (task?.id !== state.taskId || task.companyId !== config.companyId || task.projectId !== config.projectId ||
                task.originKind !== 'super_agent_chief_web_evaluation' || task.originId !== config.conversationId ||
                task.responsibleUserId !== config.userId || task.assigneeAgentId || task.assigneeUserId ||
                task.status !== statusByPhase[state.phase]) {
              fail('CHIEF_WEB_EVALUATION_TASK_CHANGED');
            }
          },
          async settleTask(state, phase, artifact) {
            const data = { status: statusByPhase[phase], companyGuard: config.companyId };
            if (artifact) data.description = `演练产物 \`${fixture.path}\`\n\n${artifact}`;
            const task = await issues.update(state.taskId, data, tx);
            if (task?.status !== statusByPhase[phase]) fail('CHIEF_WEB_EVALUATION_TASK_WRITE_FAILED');
          },
          async appendState(state) {
            await tx.insert(activityLog).values({
              companyId: config.companyId, actorType: 'system', actorId: systemActor, action,
              entityType: 'issue', entityId: config.conversationId, responsibleUserId: config.userId, details: state,
            });
          },
        });
      });
    },
  });
}

export function mountChiefWebEvaluationRoutes(router, { config, evaluation, trustedBoardMutationOrigin }) {
  let pending = false;
  function dispatch() {
    if (pending) return;
    pending = true;
    setImmediate(async () => {
      // Clear before taking the transaction so a concurrent committed create can wake again.
      pending = false;
      try {
        await evaluation.tick();
      } catch {
        await evaluation.observe('CHIEF_WEB_EVALUATION_RECONCILIATION_REQUIRED');
      }
    });
  }

  function handler(kind) {
    return async (request, response) => {
      response.set('Cache-Control', 'no-store');
      const actor = request.actor;
      if (request.params.issueId !== config.conversationId || actor?.type !== 'board' ||
          typeof actor.sessionId !== 'string' || !actor.sessionId ||
          actor.userId !== config.userId || !Array.isArray(actor.companyIds) || !actor.companyIds.includes(config.companyId)) {
        return response.status(404).json({ code: 'CHIEF_WEB_EVALUATION_AUDIENCE_DENIED' });
      }
      try {
        if (kind !== 'status' && await trustedBoardMutationOrigin(request) !== config.origin) {
          fail('CHIEF_WEB_EVALUATION_ORIGIN_DENIED', 403);
        }
        const body = request.body;
        if (kind === 'create') {
          if (body?.action !== 'create') fail('CHIEF_WEB_EVALUATION_REQUEST_INVALID', 400);
          const result = await evaluation.create(body);
          dispatch();
          return response.status(202).json(result);
        }
        if (kind === 'ci') {
          const suppliedToken = request.header('X-Super-Agent-Eval-Token');
          if (typeof suppliedToken !== 'string' || !timingSafeEqual(Buffer.from(digest(suppliedToken)), Buffer.from(digest(config.ciToken)))) {
            fail('CHIEF_WEB_EVALUATION_CI_DENIED', 403);
          }
          return response.status(200).json(await evaluation.acceptCi(body ?? {}));
        }
        return response.status(200).json(await evaluation.status());
      } catch (error) {
        const known = typeof error?.code === 'string' && /^CHIEF_WEB_EVALUATION_[A-Z_]+$/.test(error.code);
        const code = known ? error.code : 'CHIEF_WEB_EVALUATION_STATE_UNAVAILABLE';
        await evaluation.observe(code);
        return response.status(known ? error.status ?? 409 : 503).json({ code });
      }
    };
  }

  router.get(route, handler('status'));
  router.post(route, handler('create'));
  router.post(`${route}/ci`, handler('ci'));
  dispatch();
}

export async function loadPinnedChiefWebEvaluationMount({ config, log, publicUrl = process.env.PAPERCLIP_PUBLIC_URL } = {}) {
  const publicOrigin = URL.parse(publicUrl ?? '');
  if (!config || ![config.companyId, config.chiefAgentId, config.conversationId, config.projectId].every(value =>
    typeof value === 'string' && uuid.test(value)) || typeof config.userId !== 'string' || !config.userId ||
    typeof config.ciToken !== 'string' || config.ciToken.length < 32 || typeof log !== 'function' ||
    !publicOrigin || !['http:', 'https:'].includes(publicOrigin.protocol) ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(publicOrigin.hostname)) {
    fail('CHIEF_WEB_EVALUATION_CONFIGURATION_INVALID');
  }
  config = Object.freeze({ ...config, origin: publicOrigin.origin });
  const [{ issueService }, schema, orm] = await Promise.all([
    import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/issues.js'),
    import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),
    import('/opt/paperclip/node_modules/drizzle-orm/index.js'),
  ]);
  return ({ api, db, deploymentMode, trustedBoardMutationOrigin }) => {
    if (deploymentMode !== 'authenticated') fail('CHIEF_WEB_EVALUATION_AUTH_REQUIRED');
    const repository = createChiefWebEvaluationRepository({ db, issueService, schema, orm, config });
    const evaluation = createChiefWebEvaluation({ repository, log, async execute(claim) {
      // Keep the fixture attempt observable while the browser disconnects.
      await delay(5000, undefined, { ref: false });
      return executeFixture(claim);
    } });
    mountChiefWebEvaluationRoutes(api, { config, evaluation, trustedBoardMutationOrigin });
  };
}
