import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const activityAction = 'super_agent.integration_native';
const activityActor = 'super-agent-integration';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** A single-task view of Paperclip's issue locks and existing integration activity. */
export function createChiefWebPaperclipRepository({ db, issueService, schema, orm } = {}) {
  const { activityLog, issueComments, heartbeatRuns, agentWakeupRequests, companies, agents } = schema ?? {};
  if (typeof db?.transaction !== 'function' || typeof issueService !== 'function' ||
      !activityLog || !issueComments || !heartbeatRuns || !agentWakeupRequests ||
      !['eq', 'and', 'asc', 'sql'].every(key => typeof orm?.[key] === 'function')) {
    fail('CHIEF_WEB_PAPERCLIP_REPOSITORY_INVALID');
  }
  const { eq, and, asc, sql } = orm;
  const issues = issueService(db);
  if (typeof issues?.getByIdForUpdate !== 'function') fail('CHIEF_WEB_PAPERCLIP_REPOSITORY_INVALID');

  return Object.freeze({
    transaction(callback) {
      return db.transaction(async tx => {
        let task;
        let conversation;
        let history;

        function requireTask(taskId) {
          if (!task || task.id !== taskId || taskId !== CHIEF_WEB_PILOT.taskId) fail('CHIEF_WEB_NATIVE_TASK_DENIED');
        }

        async function insert(record) {
          const records = await port.listTaskOperations(record.taskId);
          const sequence = records.reduce((max, row) => Math.max(max, Number.isSafeInteger(row.sequence) ? row.sequence : 0), 0) + 1;
          const details = { ...record, schemaVersion: 1, sequence };
          await tx.insert(activityLog).values({
            companyId: task.companyId, actorType: 'system', actorId: activityActor, action: activityAction,
            entityType: 'issue', entityId: task.id, agentId: null, runId: null, details,
          });
          records.push(details);
        }

        const port = {
          async lockTask(taskId) {
            if (taskId !== CHIEF_WEB_PILOT.taskId) fail('CHIEF_WEB_NATIVE_TASK_DENIED');
            const locked = await issues.getByIdForUpdate(taskId, tx);
            if (locked?.id !== taskId || locked.originKind !== 'task_bridge' || !locked.responsibleUserId) return null;
            task = locked;
            return task;
          },
          async lockConversation(binding, chiefAgentId) {
            requireTask(binding.taskId);
            if (binding.companyId !== task.companyId || binding.ownerId !== task.responsibleUserId ||
                binding.conversationId === task.id) return null;
            const locked = await issues.getByIdForUpdate(binding.conversationId, tx);
            if (locked?.id !== binding.conversationId || locked.companyId !== task.companyId ||
                locked.conversationAgentId !== chiefAgentId || locked.conversationUserId !== binding.ownerId ||
                locked.conversationSessionGeneration !== binding.generation) return null;
            conversation = locked;
            return conversation;
          },
          async listTaskOperations(taskId) {
            requireTask(taskId);
            if (!history) {
              const rows = await tx.select({ details: activityLog.details }).from(activityLog).where(and(
                eq(activityLog.companyId, task.companyId), eq(activityLog.entityId, taskId),
                eq(activityLog.action, activityAction), eq(activityLog.actorType, 'system'),
                eq(activityLog.actorId, activityActor),
              )).orderBy(asc(sql`(${activityLog.details}->>'sequence')::bigint`), asc(activityLog.createdAt), asc(activityLog.id));
              history = rows.map(row => row.details);
            }
            return history;
          },
          async appendOperation(record) {
            requireTask(record.taskId);
            const expectedStatus = {
              'chief-web-intent': 'reserved',
              'chief-web-effect-claim': 'claimed',
              'chief-web-effect-completion': 'completed',
              'chief-web-recovery-claim': 'claimed',
              'chief-web-recovery-completion': 'completed',
            }[record.kind];
            if (!expectedStatus || expectedStatus !== record.status) fail('CHIEF_WEB_PAPERCLIP_WRITE_DENIED');
            const history = await port.listTaskOperations(record.taskId);
            if (!conversation) {
              const claims = history.filter(row => row.kind === 'chief-web-effect-claim' && row.status === 'claimed' &&
                row.parentOperationId === record.parentOperationId && row.grantId === record.grantId &&
                row.payloadHash === record.payloadHash && row.taskId === record.taskId);
              if (record.kind !== 'chief-web-effect-completion' || claims.length !== 1) {
                fail('CHIEF_WEB_PAPERCLIP_WRITE_DENIED');
              }
            }
            await insert(record);
          },
          async recoveryIsDrained(taskId, chiefAgentId) {
            requireTask(taskId);
            if (!conversation || !companies || !agents || conversation.conversationAgentId !== chiefAgentId) return false;
            const [company] = await tx.select({ status: companies.status }).from(companies)
              .where(eq(companies.id, task.companyId)).limit(1);
            if (company?.status !== 'paused') return false;
            const team = await tx.select({ id: agents.id, status: agents.status, lifecycleState: agents.lifecycleState })
              .from(agents).where(eq(agents.companyId, task.companyId)).limit(101);
            if (!team.some(agent => agent.id === chiefAgentId) || team.length > 100 ||
                team.some(agent => agent.status !== 'paused' || agent.lifecycleState !== 'paused')) return false;
            const active = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
              eq(heartbeatRuns.companyId, task.companyId),
              sql`${heartbeatRuns.status} not in ('succeeded', 'failed', 'cancelled', 'timed_out')`,
            )).limit(1);
            return active.length === 0;
          },
          async appendRecoveryContext({ record, stage, claimOperationId, scopeDigest, nativeStatus }) {
            requireTask(record?.taskId);
            const records = await port.listTaskOperations(task.id);
            const claim = records.find(row => row.operationId === claimOperationId && row.kind === 'chief-web-recovery-claim');
            if (!conversation || !claim || claim.status !== 'claimed' || claim.stage !== stage ||
                claim.scopeDigest !== scopeDigest || claim.taskId !== task.id ||
                record.kind !== 'execution-context' || record.status !== 'completed' ||
                record.operationId !== 'chief-web-recovery:' + claimOperationId ||
                records.some(row => row.operationId === record.operationId) ||
                (nativeStatus !== undefined && (stage !== 'ci' || !['done', 'blocked'].includes(nativeStatus) ||
                  task.status !== 'in_progress' || typeof issues.update !== 'function'))) {
              fail('CHIEF_WEB_PAPERCLIP_WRITE_DENIED');
            }
            if (nativeStatus !== undefined) {
              const publications = [], actions = [];
              const updated = await issues.update(task.id, { status: nativeStatus, companyGuard: task.companyId,
                actorAgentId: null, actorUserId: null, updatedByAgentId: null, updatedByUserId: null }, tx, publications, actions);
              if (updated?.status !== nativeStatus || publications.length || actions.length) fail('CHIEF_WEB_PAPERCLIP_WRITE_DENIED');
            }
            await insert(record);
          },
          async readChiefEvidence({ binding, messageId, chiefAgentId }) {
            requireTask(binding.taskId);
            if (!conversation || conversation.id !== binding.conversationId || conversation.conversationAgentId !== chiefAgentId) {
              fail('CHIEF_WEB_CONVERSATION_LOCK_REQUIRED');
            }
            const boundary = conversation.conversationBoundaryCommentId;
            if (binding.generation > 0 && !boundary) return null;
            const afterBoundary = boundary ? sql`
              (${issueComments.createdAt}, ${issueComments.id}) >
              (select ${issueComments.createdAt}, ${issueComments.id} from ${issueComments}
                where ${issueComments.id} = ${boundary}
                  and ${issueComments.companyId} = ${conversation.companyId}
                  and ${issueComments.issueId} = ${conversation.id})
            ` : undefined;
            const [message] = await tx.select().from(issueComments).where(and(
              eq(issueComments.id, messageId), eq(issueComments.companyId, conversation.companyId),
              eq(issueComments.issueId, conversation.id), afterBoundary,
            )).limit(1);
            if (!message) return null;
            const context = heartbeatRuns.contextSnapshot;
            const runs = await tx.select().from(heartbeatRuns).where(and(
              eq(heartbeatRuns.companyId, conversation.companyId), eq(heartbeatRuns.agentId, chiefAgentId),
              eq(heartbeatRuns.status, 'succeeded'),
              sql`${context}->>'issueId' = ${conversation.id}`,
              sql`${context}->>'conversationSessionGeneration' = ${String(binding.generation)}`,
              sql`coalesce(${context}->>'wakeCommentId', ${context}->>'commentId') = ${messageId}`,
            )).limit(2);
            if (runs.length !== 1 || !runs[0].wakeupRequestId) return null;
            const [run] = runs;
            const [wake] = await tx.select().from(agentWakeupRequests).where(and(
              eq(agentWakeupRequests.id, run.wakeupRequestId),
              eq(agentWakeupRequests.companyId, conversation.companyId),
            )).limit(1);
            return { message, run, wake, boundaryChecked: true };
          },
        };
        return callback(Object.freeze(port));
      });
    },
  });
}

export function bindChiefWebPaperclipRepository({ chiefAgentId, readApprovedGrant, readProjection, readChiefCallReceipt, beforeReserve, afterCommit, ...options } = {}) {
  if (typeof chiefAgentId !== 'string' || !chiefAgentId ||
      ![readApprovedGrant, readProjection, readChiefCallReceipt].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_PAPERCLIP_BINDING_INVALID');
  }
  const repository = createChiefWebPaperclipRepository(options);
  async function readGrant({ task, transaction }) {
    const grant = await readApprovedGrant({ task });
    if (!grant || !await transaction.lockConversation(grant, chiefAgentId)) return null;
    return grant;
  }
  return Object.freeze({
    chiefAgentId,
    repository,
    readGrant,
    readProjection,
    readNativeEvidence: ({ transaction, ...scope }) => transaction.readChiefEvidence(scope),
    readChiefCallReceipt, beforeReserve, afterCommit,
    async resolveTurn({ run }) {
      const context = run?.contextSnapshot;
      const messageId = context?.wakeCommentId ?? context?.commentId;
      if (run?.agentId !== chiefAgentId || context?.source !== 'issue.comment' ||
          typeof messageId !== 'string' || !messageId) return null;
      return repository.transaction(async transaction => {
        const task = await transaction.lockTask(CHIEF_WEB_PILOT.taskId);
        if (!task) return null;
        const grant = await readGrant({ task, transaction });
        if (!grant || context.issueId !== grant.conversationId || run.companyId !== grant.companyId ||
            context.conversationSessionGeneration !== grant.generation) return null;
        return {
          actor: { userId: grant.ownerId, companyId: grant.companyId, conversationId: grant.conversationId, generation: grant.generation },
          messageId,
        };
      });
    },
  });
}
