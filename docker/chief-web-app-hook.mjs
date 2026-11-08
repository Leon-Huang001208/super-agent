import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const appSha256 = 'ae6821fee52aa2d261d9b541613e621d16c631f5937874803727a012cbaa5e62';
const conversationSha256 = 'df9c186fd1d1a78f04cc37cb37996e5e70096e447554ad073881a00414105039';
const settleSignature = 'export async function settleConversationTurn(db, run) {';
const marker = '    api.use(boardMutationGuard());';
let mount;
let settle;

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

export async function notifyConfiguredChiefWebSettlement(db, run) {
  if (typeof settle !== 'function') return;
  try {
    await settle({ db, run });
  } catch {
    // Native has already committed its own settlement. Keep its result intact.
    // The integration can reconcile the same durable owner wake later.
    console.error(JSON.stringify({ code: 'CHIEF_WEB_SETTLEMENT_RECONCILIATION_REQUIRED' }));
  }
}

export function patchChiefWebConversationSource(source) {
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== conversationSha256 ||
      source.split(settleSignature).length !== 2) {
    fail('CHIEF_WEB_CONVERSATION_BASE_DRIFT');
  }
  return 'import { notifyConfiguredChiefWebSettlement } from ' + JSON.stringify(import.meta.url) + ';\n' +
    source.replace(settleSignature, 'async function settleConversationTurnNative(db, run) {') + `
export async function settleConversationTurn(db, run) {
    const settled = await settleConversationTurnNative(db, run);
    if (settled) await notifyConfiguredChiefWebSettlement(db, run);
    return settled;
}
`;
}

/** Explicit and process-local. No change is made to the installed release. */
export function installChiefWebAppHook({ appFile, conversationFile, mountPilot, settlePilot }) {
  if (mount || typeof mountPilot !== 'function') fail('CHIEF_WEB_APP_NOT_CONFIGURED');
  if (settlePilot !== undefined && (typeof settlePilot !== 'function' || typeof conversationFile !== 'string')) {
    fail('CHIEF_WEB_APP_NOT_CONFIGURED');
  }
  const appUrl = pathToFileURL(appFile).href;
  const conversationUrl = settlePilot === undefined ? null : pathToFileURL(conversationFile).href;
  const applied = new Set();
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== appUrl && url !== conversationUrl) return loaded;
      if (loaded.format !== 'module' || loaded.source == null) fail('CHIEF_WEB_APP_BASE_DRIFT');
      const source = Buffer.from(loaded.source).toString('utf8');
      const patched = url === appUrl ? patchChiefWebAppSource(source) : patchChiefWebConversationSource(source);
      applied.add(url);
      return { ...loaded, source: patched };
    },
  });
  mount = mountPilot;
  settle = settlePilot;
  return {
    verify() {
      if (!applied.has(appUrl) || (conversationUrl && !applied.has(conversationUrl))) fail('CHIEF_WEB_APP_HOOK_NOT_APPLIED');
    },
    close() { hook.deregister(); },
  };
}
