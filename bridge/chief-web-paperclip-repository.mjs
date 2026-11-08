import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const activityAction = 'super_agent.integration_native';
const activityActor = 'super-agent-integration';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** A single-task view of Paperclip's issue locks and existing integration activity. */
export function createChiefWebPaperclipRepository({ db, issueService, schema, orm } = {}) {
  const { activityLog, issueComments, heartbeatRuns, agentWakeupRequests } = schema ?? {};
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
            if (!conversation || record.kind !== 'chief-web-intent' || record.status !== 'reserved') {
              fail('CHIEF_WEB_PAPERCLIP_WRITE_DENIED');
            }
            const history = await port.listTaskOperations(record.taskId);
            const sequence = history.reduce((max, row) => Math.max(max, Number.isSafeInteger(row.sequence) ? row.sequence : 0), 0) + 1;
            await tx.insert(activityLog).values({
              companyId: task.companyId, actorType: 'system', actorId: activityActor, action: activityAction,
              entityType: 'issue', entityId: task.id, agentId: null, runId: null,
              details: { ...record, schemaVersion: 1, sequence },
            });
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

export function bindChiefWebPaperclipRepository({ chiefAgentId, readApprovedGrant, readProjection, readChiefCallReceipt, ...options } = {}) {
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
    readChiefCallReceipt,
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
