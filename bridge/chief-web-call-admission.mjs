import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

function deterministicId(values) {
  const key = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return key.slice(0,8) + '-' + key.slice(8,12) + '-5' + key.slice(13,16) +
    '-8' + key.slice(17,20) + '-' + key.slice(20,32);
}

/** After Native prepared its owner turn, before the adapter may contact a provider. */
export function createChiefWebCallAdmission({ readApprovedGrant, readWitness, writePermit, log, now = Date.now } = {}) {
  if (![readApprovedGrant, readWitness, writePermit, log, now].every(fn => typeof fn === 'function')) {
    fail('CHIEF_CALL_ADMISSION_CONFIGURATION_INVALID');
  }
  return async function admitChiefCall({ db, run, prepared }) {
    if (!prepared?.conversation || prepared.reset || prepared.context?.source !== 'issue.comment') return;
    const grant = await readApprovedGrant();
    if (!grant || prepared.context.issueId !== grant.conversationId || run.agentId !== grant.chiefAgentId) return;
    const context = prepared.context;
    const messageId = context.wakeCommentId ?? context.commentId;
    if (![run.id, messageId, grant.grantId, grant.credentialGrantId].every(value => typeof value === 'string' && uuid.test(value)) ||
        grant.taskId !== CHIEF_WEB_PILOT.taskId || run.companyId !== grant.companyId ||
        !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now() ||
        grant.generation !== context.conversationSessionGeneration ||
        (context.conversationReplyBoundaryCommentId ?? messageId) !== messageId ||
        (context.wakeCommentIds !== undefined &&
          (!Array.isArray(context.wakeCommentIds) || context.wakeCommentIds.length !== 1 || context.wakeCommentIds[0] !== messageId))) {
      fail('CHIEF_CALL_ADMISSION_DENIED');
    }
    const witness = await readWitness({ db, run, grant, messageId });
    const body = witness?.body;
    if (witness?.verified !== true || typeof body !== 'string' || !body.trim() || body.includes('\0') ||
        Buffer.byteLength(body) > 4096 || !digest.test(grant.messageDigest ?? '') ||
        createHash('sha256').update(body).digest('hex') !== grant.messageDigest) {
      fail('CHIEF_CALL_ADMISSION_DENIED');
    }
    const issuedAt = now();
    if (!Number.isSafeInteger(issuedAt) || issuedAt >= grant.expiresAt) fail('CHIEF_CALL_ADMISSION_DENIED');
    const permit = {
      schemaVersion: 1, taskId: CHIEF_WEB_PILOT.taskId, permitId: deterministicId([grant.grantId, run.id, messageId]),
      grantId: grant.grantId, runId: run.id, conversationId: grant.conversationId, messageId,
      agentId: grant.chiefAgentId, companyId: grant.companyId, credentialGrantId: grant.credentialGrantId,
      generation: grant.generation, ownerId: grant.ownerId, expiresAt: Math.min(grant.expiresAt, issuedAt + 600_000),
      model: CHIEF_WEB_PILOT.model, reasoningEffort: CHIEF_WEB_PILOT.reasoningEffort,
      apiFallback: false, body, messageDigest: grant.messageDigest,
    };
    const recorded = await writePermit(permit);
    if (recorded?.runId !== run.id || recorded?.permitId !== permit.permitId || recorded?.expiresAt <= now()) {
      fail('CHIEF_CALL_PERMIT_UNCONFIRMED');
    }
    await log({ code: 'CHIEF_CALL_PERMIT_REGISTERED', permitId: permit.permitId });
  };
}
