import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const appSha256 = 'ae6821fee52aa2d261d9b541613e621d16c631f5937874803727a012cbaa5e62';
const queueSha256 = '30fd59f55e0a67a5cddfc73d10214d00eac4aac5a1170680b7007eaffd6405c6';
const conversationSha256 = 'df9c186fd1d1a78f04cc37cb37996e5e70096e447554ad073881a00414105039';
const prepareSignature = 'export async function prepareConversationTurn(db, run) {';
const settleSignature = 'export async function settleConversationTurn(db, run) {';
const deliveryLoop = '            for (const comment of await undeliveredConversationComments(tx, issue.companyId, issue.id)) {';
const enqueueStart = '                await enqueue(issue.conversationAgentId, {';
const enqueueEnd = '                    },\n                });\n            }\n            return true;';
const demandGuard = '        if (source !== "timer" && !policy.wakeOnDemand) {';
const recoveryContext = new AsyncLocalStorage();
const marker = '    api.use(boardMutationGuard());';
let mount;
let settle;
let admit;
let recoverSkippedWake;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export async function mountConfiguredChiefWebPilot(context) {
  if (typeof mount !== 'function' || context.deploymentMode !== 'authenticated') {
    fail('CHIEF_WEB_APP_NOT_CONFIGURED');
  }
  await mount(context);
}

export function patchChiefWebAppSource(source) {
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== appSha256 ||
      source.split(marker).length !== 2) {
    fail('CHIEF_WEB_APP_BASE_DRIFT');
  }
  const imports = [
    'import { mountConfiguredChiefWebPilot } from ' + JSON.stringify(import.meta.url) + ';',
    'import { issueService as chiefWebIssueService } from "./services/issues.js";',
    'import { trustedBoardMutationOrigin as chiefWebTrustedOrigin } from "./middleware/board-mutation-guard.js";',
  ].join('\n');
  const call = [
    marker,
    '    await mountConfiguredChiefWebPilot({',
    '        api, db, deploymentMode: opts.deploymentMode,',
    '        getIssue: chiefWebIssueService(db).getById, trustedBoardMutationOrigin: chiefWebTrustedOrigin,',
    '    });',
  ].join('\n');
  return imports + '\n' + source.replace(marker, call);
}

export function notifyConfiguredChiefWebSettlement(db, run) {
  if (typeof settle !== 'function' || run?.contextSnapshot?.conversationMode !== true) return;
  const context = run.contextSnapshot;
  const witness = {
    id: run.id,
    status: run.status,
    companyId: run.companyId,
    agentId: run.agentId,
    wakeupRequestId: run.wakeupRequestId,
    contextSnapshot: {
      issueId: context.issueId,
      source: context.source,
      wakeCommentId: context.wakeCommentId,
      commentId: context.commentId,
      conversationMode: context.conversationMode,
      conversationSessionGeneration: context.conversationSessionGeneration,
    },
  };
  setImmediate(async () => {
    try {
      await settle({ db, run: witness });
    } catch {
      // Preserve Native's result. Reconciliation reads the durable owner wake.
      console.error(JSON.stringify({ code: 'CHIEF_WEB_SETTLEMENT_RECONCILIATION_REQUIRED' }));
    }
  });
}

export async function admitConfiguredChiefWebCall(db, run, prepared) {
  if (admit) await admit({ db, run, prepared });
}

export async function recoverConfiguredChiefWebWake(tx, issue) {
  return recoverSkippedWake ? recoverSkippedWake(tx, issue) : null;
}

export function dispatchConfiguredChiefWebRecovery(issue, comment, dispatch) {
  return recoveryContext.run({ used: false, witness: Object.freeze({
    companyId: issue.companyId, agentId: issue.conversationAgentId, issueId: issue.id,
    messageId: comment.id, ownerId: comment.authorUserId,
  }) }, dispatch);
}

export function consumeConfiguredChiefWebRecoveredWake(companyId, agentId, source, opts, context) {
  const permit = recoveryContext.getStore();
  const witness = permit?.witness;
  const matched = Boolean(witness && !permit.used && companyId === witness.companyId && agentId === witness.agentId &&
    source === 'on_demand' && opts.triggerDetail === 'manual' && opts.reason === 'issue_commented' &&
    opts.requestedByActorType === 'user' && opts.requestedByActorId === witness.ownerId &&
    opts.idempotencyKey === 'conversation-comment:' + witness.messageId &&
    opts.payload?.issueId === witness.issueId && opts.payload?.commentId === witness.messageId &&
    context.source === 'issue.comment' && context.issueId === witness.issueId && context.wakeCommentId === witness.messageId);
  if (matched) permit.used = true;
  return matched;
}

export function patchChiefWebQueueSource(source) {
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== queueSha256 ||
      source.split(demandGuard).length !== 2) fail('CHIEF_WEB_QUEUE_BASE_DRIFT');
  return 'import { consumeConfiguredChiefWebRecoveredWake } from ' + JSON.stringify(import.meta.url) + ';\n' +
    source.replace(demandGuard, '        if (source !== "timer" && !policy.wakeOnDemand && !consumeConfiguredChiefWebRecoveredWake(agent.companyId, agentId, source, opts, enrichedContextSnapshot)) {');
}

export function patchChiefWebConversationSource(source) {
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== conversationSha256 ||
      source.split(settleSignature).length !== 2 || source.split(prepareSignature).length !== 2 || source.split(deliveryLoop).length !== 2 ||
      source.split(enqueueStart).length !== 2 || source.split(enqueueEnd).length !== 2) {
    fail('CHIEF_WEB_CONVERSATION_BASE_DRIFT');
  }
  return 'import { admitConfiguredChiefWebCall, notifyConfiguredChiefWebSettlement, recoverConfiguredChiefWebWake, dispatchConfiguredChiefWebRecovery } from ' + JSON.stringify(import.meta.url) + ';\n' +
    source.replace(settleSignature, 'async function settleConversationTurnNative(db, run) {')
      .replace(prepareSignature, 'async function prepareConversationTurnNative(db, run) {')
      .replace(deliveryLoop, [
        '            const pendingComments = await undeliveredConversationComments(tx, issue.companyId, issue.id);',
        '            const recoveredComment = await recoverConfiguredChiefWebWake(tx, issue);',
        '            if (recoveredComment) pendingComments.push(recoveredComment);',
        '            for (const comment of pendingComments) {',
      ].join('\n'))
      .replace(enqueueStart, '                const dispatch = () => enqueue(issue.conversationAgentId, {')
      .replace(enqueueEnd, [
        '                    },',
        '                });',
        '                if (comment === recoveredComment) await dispatchConfiguredChiefWebRecovery(issue, comment, dispatch);',
        '                else await dispatch();',
        '            }',
        '            return true;',
      ].join('\n')) + `
export async function prepareConversationTurn(db, run) {
    const prepared = await prepareConversationTurnNative(db, run);
    await admitConfiguredChiefWebCall(db, run, prepared);
    return prepared;
}
export async function settleConversationTurn(db, run) {
    const settled = await settleConversationTurnNative(db, run);
    if (settled) notifyConfiguredChiefWebSettlement(db, run);
    return settled;
}
`;
}

/** Explicit and process-local. No change is made to the installed release. */
export function installChiefWebAppHook({ appFile, conversationFile, queueFile, mountPilot, settlePilot, admitPilot, recoverSkippedWakePilot }) {
  if (mount || typeof mountPilot !== 'function') fail('CHIEF_WEB_APP_NOT_CONFIGURED');
  if (settlePilot !== undefined && (typeof settlePilot !== 'function' || typeof conversationFile !== 'string') ||
      admitPilot !== undefined && (typeof admitPilot !== 'function' || typeof settlePilot !== 'function') ||
      recoverSkippedWakePilot !== undefined && (typeof recoverSkippedWakePilot !== 'function' || typeof settlePilot !== 'function' || typeof queueFile !== 'string')) {
    fail('CHIEF_WEB_APP_NOT_CONFIGURED');
  }
  const appUrl = pathToFileURL(appFile).href;
  const conversationUrl = settlePilot === undefined ? null : pathToFileURL(conversationFile).href;
  const queueUrl = recoverSkippedWakePilot === undefined ? null : pathToFileURL(queueFile).href;
  const applied = new Set();
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== appUrl && url !== conversationUrl && url !== queueUrl) return loaded;
      if (loaded.format !== 'module' || loaded.source == null) fail('CHIEF_WEB_APP_BASE_DRIFT');
      const source = Buffer.from(loaded.source).toString('utf8');
      const patched = url === appUrl ? patchChiefWebAppSource(source)
        : url === queueUrl ? patchChiefWebQueueSource(source) : patchChiefWebConversationSource(source);
      applied.add(url);
      return { ...loaded, source: patched };
    },
  });
  mount = mountPilot;
  settle = settlePilot;
  admit = admitPilot;
  recoverSkippedWake = recoverSkippedWakePilot;
  return {
    verify() {
      if (!applied.has(appUrl) || (conversationUrl && !applied.has(conversationUrl)) || (queueUrl && !applied.has(queueUrl))) fail('CHIEF_WEB_APP_HOOK_NOT_APPLIED');
    },
    close() { hook.deregister(); },
  };
}
