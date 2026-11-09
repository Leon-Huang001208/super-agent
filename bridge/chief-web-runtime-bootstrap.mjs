import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';
import { selectSkippedChiefWebMessage } from './chief-web-skipped-wake.mjs';
import { createChiefWebCallAdmission } from './chief-web-call-admission.mjs';
import { loadPinnedChiefWebPaperclipRuntime } from './chief-web-paperclip.mjs';
import { readChiefWebPrivateJson } from './chief-web-private-file.mjs';
import { bindChiefWebPaperclipRepository } from './chief-web-paperclip-repository.mjs';
import { createChiefWebRecoveryEntry } from './chief-web-recovery-entry.mjs';
import { createChiefWebRecoveryNative } from './chief-web-recovery-native.mjs';
import { createChiefWebRecoveryLease } from './chief-web-recovery-lease.mjs';
import { createChiefWebRecoveryHostHandoff } from './chief-web-recovery-io.mjs';
import { createChiefWebProjection } from './chief-web-projection.mjs';

const root = '/paperclip/control/chief-web';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };

async function readOptional(filename) {
  try { return await readChiefWebPrivateJson(filename); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function readPilotBinding() {
  const policy = await readChiefWebPrivateJson(path.join(root, 'pilot-binding.json'));
  if (!policy || Object.keys(policy).length !== 2 || !uuid.test(policy.companyId ?? '') ||
      !uuid.test(policy.chiefAgentId ?? '')) fail('CHIEF_WEB_PILOT_BINDING_INVALID');
  return policy;
}

export async function readChiefWebApprovedGrant() {
  const policy = await readPilotBinding();
  const grant = await readOptional(path.join(root, 'approved-grant.json'));
  if (!grant) return null;
  const keys = ['schemaVersion','taskId','grantId','ownerId','companyId','conversationId','generation',
    'chiefAgentId','credentialGrantId','issuedAt','expiresAt','messageDigest','previousInputRevision','previousHead'];
  if (Object.keys(grant).length !== keys.length || !keys.every(key => Object.hasOwn(grant, key)) ||
      grant.schemaVersion !== 1 || grant.taskId !== CHIEF_WEB_PILOT.taskId ||
      grant.companyId !== policy.companyId || grant.chiefAgentId !== policy.chiefAgentId ||
      !['grantId','conversationId','credentialGrantId'].every(key => typeof grant[key] === 'string' && uuid.test(grant[key])) ||
      typeof grant.ownerId !== 'string' || !grant.ownerId || !Number.isSafeInteger(grant.generation) ||
      grant.generation < 0 || !Number.isSafeInteger(grant.issuedAt) || !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > 86_400_000 || typeof grant.messageDigest !== 'string' ||
      !hash.test(grant.messageDigest) || grant.previousInputRevision !== CHIEF_WEB_PILOT.previousInputRevision ||
      grant.previousHead !== CHIEF_WEB_PILOT.previousHead) fail('CHIEF_WEB_APPROVED_GRANT_INVALID');
  return Object.freeze(grant);
}

/** A confirmation window never renews the original execution grant. */
export async function readChiefWebApprovalBinding() {
  const grant = await readChiefWebApprovedGrant();
  if (!grant) return null;
  const window = await readOptional(path.join(root, 'confirmation-window.json'));
  if (!window) return grant;
  const keys = ['schemaVersion','grantId','conversationId','generation','taskId','inputRevision',
    'candidate','prHead','reviewDigest','baseCommit','openedAt','expiresAt'];
  if (Object.keys(window).length !== keys.length || !keys.every(key => Object.hasOwn(window, key)) ||
      window.schemaVersion !== 1 || ['grantId','conversationId','generation','taskId'].some(key => window[key] !== grant[key]) ||
      !hash.test(window.inputRevision ?? '') || !hash.test(window.reviewDigest ?? '') ||
      !commit.test(window.candidate ?? '') || !commit.test(window.baseCommit ?? '') ||
      window.prHead !== grant.previousHead || window.prHead === window.candidate ||
      !Number.isSafeInteger(window.openedAt) || window.openedAt < grant.expiresAt || window.openedAt > Date.now() ||
      !Number.isSafeInteger(window.expiresAt) || window.expiresAt <= window.openedAt ||
      window.expiresAt - window.openedAt > 30 * 60_000) fail('CHIEF_WEB_CONFIRMATION_WINDOW_INVALID');
  return Object.freeze({ ...grant, confirmationWindow: Object.freeze(window) });
}

async function writePermit(permit) {
  const dir = path.join(root, 'permits');
  const metadata = await fs.lstat(dir);
  if (await fs.realpath(dir) !== dir || !metadata.isDirectory() || metadata.uid !== 0 || metadata.gid !== 0 ||
      (metadata.mode & 0o777) !== 0o700) fail('CHIEF_CALL_PRIVATE_PATH_DENIED');
  const filename = path.join(dir, permit.runId + '.json');
  let handle;
  try { handle = await fs.open(filename, 'wx', 0o600); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const old = await readOptional(filename);
    if (!old || Object.keys(old).length !== Object.keys(permit).length ||
        Object.keys(permit).some(key => key !== 'expiresAt' && old[key] !== permit[key])) fail('CHIEF_CALL_PERMIT_CONFLICT');
    return old;
  }
  try { await handle.writeFile(JSON.stringify(permit) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  const parent = await fs.open(dir, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
  return permit;
}

export async function readExecutionEvidence({ task, context, binding, inputRevision }, { read = readOptional } = {}) {
  if (inputRevision === CHIEF_WEB_PILOT.previousInputRevision && task.status === 'done' &&
      context.pr.headSha === CHIEF_WEB_PILOT.previousHead) {
    const history = await read('/paperclip/control/chief-web/historical-receipt.json');
    const observedCalls = Array.isArray(history?.providerSlots) ? history.providerSlots.length : history?.providerSlots;
    if (history?.taskId !== task.id || history.inputRevision !== inputRevision ||
        history.pr?.headSha !== context.pr.headSha || history.nativeStatus !== 'done' ||
        observedCalls !== CHIEF_WEB_PILOT.previousCalls) fail('CHIEF_WEB_HISTORICAL_EVIDENCE_UNAVAILABLE');
    return { prHead: context.pr.headSha, inputRevision, evidenceDigest: sha(JSON.stringify(history)), observedCalls };
  }
  const directory = path.join(root, 'execution-evidence');
  const candidate = context.candidate?.head;
  const refreshed = hash.test(inputRevision ?? '') && commit.test(candidate ?? '')
    ? await read(path.join(directory, inputRevision + '-' + candidate + '.json')) : null;
  if (refreshed && (refreshed.candidate !== candidate || refreshed.expectedMaster !== context.candidateScope?.baseCommit ||
      refreshed.grantId !== binding?.grantId || refreshed.conversationId !== binding?.conversationId ||
      refreshed.generation !== binding?.generation)) fail('CHIEF_WEB_EXECUTION_EVIDENCE_UNAVAILABLE');
  const evidence = refreshed ?? await read(path.join(directory, inputRevision + '.json'));
  if (evidence?.taskId !== task.id || evidence.inputRevision !== inputRevision) fail('CHIEF_WEB_EXECUTION_EVIDENCE_UNAVAILABLE');
  const recovery = context.chiefWebRecovery;
  if (recovery && context.pr.headSha === candidate && ['WAIT_CI', 'COMPLETED', 'BLOCKED'].includes(context.phase) &&
      recovery.taskId === task.id && recovery.inputRevision === inputRevision && recovery.candidateSha === candidate &&
      recovery.grantId === binding?.grantId && recovery.conversationId === binding?.conversationId &&
      recovery.generation === binding?.generation && recovery.repository === CHIEF_WEB_PILOT.repository &&
      recovery.pullRequest === CHIEF_WEB_PILOT.pullRequest && hash.test(recovery.publicationEvidenceDigest ?? '')) {
    const result = { ...evidence, prHead: candidate, evidenceDigest: sha(JSON.stringify([evidence, recovery])) };
    if (recovery.ci?.conclusion === 'success' && recovery.receipt?.conclusion === 'success' && task.status === 'done' &&
        recovery.receipt.ciProofDigest === recovery.ci.evidenceDigest && hash.test(recovery.receipt.receiptDigest ?? '')) {
      result.ci = { repository: recovery.repository, pullRequest: recovery.pullRequest, headSha: candidate, checksPassed: true };
    }
    return result;
  }
  if (context.phase === 'WAIT_DECISION' && context.pr.headSha === CHIEF_WEB_PILOT.previousHead) {
    const block = await read(path.join(root, 'publication-blockers', inputRevision + '.json'));
    if (block?.schemaVersion === 1 && block.code === 'CHIEF_WEB_MASTER_ADVANCED' &&
        uuid.test(block.operationId ?? '') && block.taskId === task.id &&
        block.inputRevision === inputRevision && block.grantId === binding?.grantId &&
        block.conversationId === binding?.conversationId && block.generation === binding?.generation &&
        block.candidate === evidence.candidate && block.candidate === context.candidate?.head &&
        block.reviewDigest === evidence.independentReview?.digest && hash.test(block.reviewDigest ?? '') &&
        evidence.independentReview.verdict === 'approved' && block.prHead === context.pr.headSha &&
        block.expectedMaster === context.candidateScope?.baseCommit &&
        commit.test(block.expectedMaster ?? '') && commit.test(block.observedMaster ?? '') &&
        block.expectedMaster !== block.observedMaster) {
      const publicationBlocker = {
        code: block.code, operationId: block.operationId, candidate: block.candidate,
        expectedMaster: block.expectedMaster, observedMaster: block.observedMaster,
      };
      return { ...evidence, publicationBlocker, evidenceDigest: sha(JSON.stringify([evidence, publicationBlocker])) };
    }
  }
  return { ...evidence, evidenceDigest: sha(JSON.stringify(evidence)) };
}

function createReadWitness({ schema, orm, issueService }) {
  const { issues, issueComments, agentWakeupRequests, connectionGrants } = schema;
  const { eq, and, sql } = orm;
  return async ({ db, run, grant, messageId }) => db.transaction(async tx => {
    const service = issueService(db);
    const task = await service.getByIdForUpdate(CHIEF_WEB_PILOT.taskId, tx);
    const conversation = await service.getByIdForUpdate(grant.conversationId, tx);
    if (task?.status !== 'done' || task.companyId !== grant.companyId || task.responsibleUserId !== grant.ownerId ||
        conversation?.conversationAgentId !== grant.chiefAgentId || conversation.companyId !== grant.companyId ||
        conversation.conversationUserId !== grant.ownerId || conversation.conversationSessionGeneration !== grant.generation) return null;
    const boundary = conversation.conversationBoundaryCommentId;
    if (grant.generation > 0 && !boundary) return null;
    const afterBoundary = boundary ? sql`
      (${issueComments.createdAt}, ${issueComments.id}) >
      (select ${issueComments.createdAt}, ${issueComments.id} from ${issueComments}
        where ${issueComments.id} = ${boundary} and ${issueComments.issueId} = ${conversation.id})
    ` : undefined;
    const [message] = await tx.select().from(issueComments).where(and(
      eq(issueComments.id, messageId), eq(issueComments.issueId, conversation.id),
      eq(issueComments.companyId, grant.companyId), afterBoundary,
    )).limit(1);
    const [wake] = await tx.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.id, run.wakeupRequestId), eq(agentWakeupRequests.companyId, grant.companyId),
    )).limit(1);
    const [credential] = await tx.select({ status: connectionGrants.status }).from(connectionGrants).where(and(
      eq(connectionGrants.id, grant.credentialGrantId), eq(connectionGrants.companyId, grant.companyId),
    )).limit(1);
    if (!message || message.authorUserId !== grant.ownerId || message.authorAgentId !== null ||
        message.createdByRunId !== null || message.deletedAt !== null ||
        !wake || wake.runId !== run.id || wake.status !== 'claimed' || wake.agentId !== grant.chiefAgentId ||
        wake.reason !== 'issue_commented' || wake.requestedByActorType !== 'user' || wake.requestedByActorId !== grant.ownerId ||
        wake.idempotencyKey !== 'conversation-comment:' + messageId || wake.payload?.issueId !== conversation.id ||
        wake.payload?.commentId !== messageId || credential?.status !== 'active' || !issues) return null;
    return { verified: true, body: message.body };
  });
}

export async function verifyChiefWebAppend({ transaction, task, intent, claim }) {
  const grant = await readChiefWebApprovedGrant();
  const source = intent.sourceEvidence;
  if (!grant || grant.grantId !== intent.grantId || grant.expiresAt <= Date.now() ||
      task.id !== CHIEF_WEB_PILOT.taskId || task.responsibleUserId !== grant.ownerId ||
      source?.messageDigest !== grant.messageDigest || claim.status !== 'claimed') return false;
  const lease = await readOptional('/paperclip/control/active-lease.json');
  if (lease && lease.taskId !== task.id) return false;
  const message = await transaction.readChiefWebOwnerMessage({
    taskId: task.id, conversationId: grant.conversationId, companyId: grant.companyId,
    chiefAgentId: grant.chiefAgentId, ownerId: grant.ownerId, generation: grant.generation, messageId: source.messageId,
  });
  if (!message || sha(message.body) !== source.messageDigest) return false;
  const receipt = await readOptional(path.join(root, 'receipts', grant.grantId + '.json'));
  return receipt?.status === 'completed' && receipt.intent === 'supplement_rwb_pr261' &&
    receipt.taskId === task.id && receipt.grantId === grant.grantId && receipt.conversationId === grant.conversationId &&
    receipt.generation === grant.generation && receipt.messageId === message.id &&
    receipt.messageDigest === source.messageDigest && receipt.runId === source.runId &&
    receipt.providerClaimId === source.providerClaimId && receipt.physicalCallsForGrant === 1 &&
    receipt.model === CHIEF_WEB_PILOT.model && receipt.reasoningEffort === CHIEF_WEB_PILOT.reasoningEffort &&
    receipt.apiFallback === false;
}

export async function readChiefWebCompletionReceipt({ operationId, binding }) {
  if (!uuid.test(operationId ?? '') || binding?.taskId !== CHIEF_WEB_PILOT.taskId) fail('CHIEF_WEB_COMPLETION_SCOPE_DENIED');
  const receipt = await readOptional(path.join(root, 'completion', operationId + '.json'));
  if (!receipt) return null;
  if (receipt.schemaVersion !== 1 || receipt.channel !== 'chief-web' || receipt.operationId !== operationId ||
      receipt.taskId !== binding.taskId || receipt.inputRevision !== binding.inputRevision ||
      receipt.headSha !== binding.candidateSha || receipt.prUrl !== binding.pullRequest ||
      !uuid.test(receipt.grantId ?? '') || !uuid.test(receipt.conversationId ?? '') ||
      !Number.isSafeInteger(receipt.generation) || receipt.generation < 0) fail('CHIEF_WEB_COMPLETION_SCOPE_DENIED');
  return receipt;
}

async function writeControlFence(grantId, name, value) {
  if (!uuid.test(grantId ?? '') || !/^(pause|resume|resolved)-[a-f0-9]{64}\.json$/.test(name)) {
    fail('CHIEF_WEB_CONTROL_SCOPE_DENIED');
  }
  const base = path.join(root, 'host-fences'), directory = path.join(base, grantId);
  for (const candidate of [base, directory]) {
    try { await fs.mkdir(candidate, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(candidate);
    if (await fs.realpath(candidate) !== candidate || !stat.isDirectory() || stat.uid !== 0 || stat.gid !== 0 ||
        (stat.mode & 0o777) !== 0o700) fail('CHIEF_WEB_CONTROL_SCOPE_DENIED');
  }
  const filename = path.join(directory, name);
  let file;
  try { file = await fs.open(filename, 'wx', 0o600); }
  catch (error) {
    if (error?.code !== 'EEXIST' || JSON.stringify(await readOptional(filename)) !== JSON.stringify(value)) throw error;
    return;
  }
  try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
  const parent = await fs.open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

/** Root calls under the original issue lock, after any in-flight Native transaction settles. */
export async function reconcileChiefWebHostFences(records, grant, {
  list = async grantId => {
    try { return await fs.readdir(path.join(root, 'host-fences', grantId)); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  },
  read = (grantId, name) => readOptional(path.join(root, 'host-fences', grantId, name)),
  write = writeControlFence,
} = {}) {
  if (!uuid.test(grant?.grantId ?? '') || grant.taskId !== CHIEF_WEB_PILOT.taskId) fail('CHIEF_WEB_CONTROL_SCOPE_DENIED');
  const files = await list(grant.grantId);
  if (files.some(name => !/^(pause|resume|resolved)-[a-f0-9]{64}\.json$/.test(name))) fail('CHIEF_WEB_CONTROL_SCOPE_DENIED');
  for (const filename of files.filter(name => name.startsWith('pause-'))) {
    const pauseOperationId = filename.slice(6, -5);
    const marker = await read(grant.grantId, filename);
    if (marker?.taskId !== grant.taskId || marker.grantId !== grant.grantId || marker.pauseOperationId !== pauseOperationId) {
      fail('CHIEF_WEB_CONTROL_SCOPE_DENIED');
    }
    const pause = records.find(row => row.kind === 'chief-web-intent' && row.operationId === pauseOperationId);
    const common = { schemaVersion: 1, taskId: grant.taskId, grantId: grant.grantId, pauseOperationId };
    if (!pause) {
      await write(grant.grantId, 'resolved-' + pauseOperationId + '.json', {
        ...common, reason: 'native_pause_not_committed',
      });
      continue;
    }
    if (pause.action !== 'pause' || pause.grantId !== grant.grantId || pause.status !== 'reserved') {
      fail('CHIEF_WEB_CONTROL_SCOPE_DENIED');
    }
    const resume = records.find(row => row.kind === 'chief-web-intent' && row.action === 'resume' &&
      row.releasedPauseOperationId === pauseOperationId && row.releasedPauseGrantId === grant.grantId &&
      row.status === 'reserved');
    if (resume) {
      await write(grant.grantId, 'resume-' + pauseOperationId + '.json', { ...common, resumeOperationId: resume.operationId });
    }
  }
}

function createSkippedWakeRecovery({ schema, orm, log }) {
  const { agents, issueComments, agentWakeupRequests, heartbeatRuns } = schema;
  const { and, eq, isNull, or, sql } = orm;
  return async (tx, issue) => {
    const grant = await readChiefWebApprovedGrant();
    if (!grant || issue.id !== grant.conversationId || issue.companyId !== grant.companyId ||
        issue.conversationAgentId !== grant.chiefAgentId) return null;
    const [agent] = await tx.select({ config: agents.runtimeConfig }).from(agents)
      .where(and(eq(agents.companyId, grant.companyId), eq(agents.id, grant.chiefAgentId))).limit(1);
    if (agent?.config?.heartbeat?.enabled !== false) return null;
    const comments = await tx.select().from(issueComments).where(and(
      eq(issueComments.companyId, grant.companyId), eq(issueComments.issueId, grant.conversationId),
      eq(issueComments.authorUserId, grant.ownerId), isNull(issueComments.deletedAt),
    )).limit(2);
    if (comments.length !== 1) return null;
    const wakes = await tx.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId, grant.companyId),
      sql`${agentWakeupRequests.payload}->>'issueId' = ${grant.conversationId}`,
      sql`${agentWakeupRequests.payload}->>'commentId' = ${comments[0].id}`,
    )).limit(3);
    const runs = await tx.select({
      id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId,
      wakeupRequestId: heartbeatRuns.wakeupRequestId, status: heartbeatRuns.status, exitCode: heartbeatRuns.exitCode,
      errorCode: heartbeatRuns.errorCode, error: heartbeatRuns.error, stderrExcerpt: heartbeatRuns.stderrExcerpt,
      contextSnapshot: heartbeatRuns.contextSnapshot, usageJson: heartbeatRuns.usageJson,
    }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, grant.companyId), or(
        eq(heartbeatRuns.nativeIssueId, grant.conversationId), eq(heartbeatRuns.issueId, grant.conversationId),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${grant.conversationId}`,
      ),
    )).limit(2);
    const [claim, receipt, permit] = await Promise.all([
      readOptional(path.join(root, 'claims', grant.grantId + '.json')),
      readOptional(path.join(root, 'receipts', grant.grantId + '.json')),
      runs.length === 1 && uuid.test(runs[0].id) ? readOptional(path.join(root, 'permits', runs[0].id + '.json')) : null,
    ]);
    const retry = selectSkippedChiefWebMessage({ grant, issue, comments, wakes, runs, permit, claim, receipt, now: Date.now() });
    if (retry) await log({ code: 'CHIEF_WEB_SKIPPED_WAKE_RECOVERY_READY', messageId: retry.id,
      skippedWakeId: wakes.find(wake => wake.status === 'skipped').id, preModelRunId: runs[0]?.id });
    return retry;
  };
}

export async function loadChiefWebRuntimeBootstrap({ log }) {
  const policy = await readPilotBinding();
  const [{ issueService }, schema, orm] = await Promise.all([
    import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/issues.js'),
    import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),
    import('/opt/paperclip/node_modules/drizzle-orm/index.js'),
  ]);
  const runtime = await loadPinnedChiefWebPaperclipRuntime({
    chiefAgentId: policy.chiefAgentId,
    readApprovedGrant: readChiefWebApprovalBinding,
    readExecutionEvidence,
    readChiefCallReceipt: ({ binding }) => readOptional(path.join(root, 'receipts', binding.grantId + '.json')),
    async beforeReserve(record) {
      if (record.action === 'pause') {
        if (await readOptional(path.join(root, 'host-fences', record.grantId, 'resolved-' + record.operationId + '.json'))) {
          fail('CHIEF_WEB_CONTROL_RECONCILED_RETRY_REQUIRED');
        }
        await writeControlFence(record.grantId, 'pause-' + record.operationId + '.json', {
          schemaVersion: 1, taskId: record.taskId, grantId: record.grantId, pauseOperationId: record.operationId,
        });
      }
    },
    async afterCommit(record) {
      if (record.action === 'resume' && record.releasedPauseOperationId) {
        await writeControlFence(record.releasedPauseGrantId, 'resume-' + record.releasedPauseOperationId + '.json', {
          schemaVersion: 1, taskId: record.taskId, grantId: record.releasedPauseGrantId,
          pauseOperationId: record.releasedPauseOperationId, resumeOperationId: record.operationId,
        });
      }
    },
    log,
  });
  return {
    ...runtime,
    recoverChiefWebSkippedWake: createSkippedWakeRecovery({ schema, orm, log }),
    admitChiefWebCall: createChiefWebCallAdmission({
      readApprovedGrant: readChiefWebApprovedGrant,
      readWitness: createReadWitness({ schema, orm, issueService }),
      writePermit, log,
    }),
  };
}

/** Fixed recovery operator path, outside the public/native browser endpoints. */
export async function runChiefWebRecoveryCommand(args, { db, log } = {}) {
  if (!Array.isArray(args) || args.length < 2 || args.length > 3 || typeof log !== 'function' ||
      !['claim', 'publish', 'record-ci', 'release', 'inspect'].includes(args[0]) || !hash.test(args[1] ?? '') ||
      (args[0] === 'record-ci' ? args.length !== 3 || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/.test(args[2]) : args.length !== 2)) {
    fail('CHIEF_WEB_RECOVERY_COMMAND_INVALID');
  }
  const [action, operationId, eventId] = args;
  const policy = await readPilotBinding();
  const [{ issueService }, schema, orm] = await Promise.all([
    import('/opt/paperclip/node_modules/@paperclipai/server/dist/services/issues.js'),
    import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),
    import('/opt/paperclip/node_modules/drizzle-orm/index.js'),
  ]);
  const bindings = bindChiefWebPaperclipRepository({ db, schema, orm, issueService,
    chiefAgentId: policy.chiefAgentId, readApprovedGrant: readChiefWebApprovalBinding,
    readProjection: createChiefWebProjection({ readExecutionEvidence }),
    readChiefCallReceipt: ({ binding }) => readOptional(path.join(root, 'receipts', binding.grantId + '.json')),
  });
  const native = createChiefWebRecoveryNative({ bindings, readExecutionEvidence,
    readRuntime: () => readOptional('/paperclip/integration-v1/runtime.json'),
    readReviewCapability: inputRevision => hash.test(inputRevision) ? readOptional(path.join(root, 'review-refresh', inputRevision + '.json')) : null,
    lease: createChiefWebRecoveryLease(),
  });
  const entry = createChiefWebRecoveryEntry({ bindings, ...native, hostPublication: createChiefWebRecoveryHostHandoff(), log });
  return entry[action === 'record-ci' ? 'recordCi' : action]({ operationId, eventId });
}
