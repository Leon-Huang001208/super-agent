import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const appSha256 = 'ae6821fee52aa2d261d9b541613e621d16c631f5937874803727a012cbaa5e62';
const marker = '    api.use(boardMutationGuard());';
let mount;

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

/** Explicit and process-local. No change is made to the installed release. */
export function installChiefWebAppHook(appFile, mountPilot) {
  if (mount || typeof mountPilot !== 'function') fail('CHIEF_WEB_APP_NOT_CONFIGURED');
  const appUrl = pathToFileURL(appFile).href;
  let applied = false;
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== appUrl) return loaded;
      if (loaded.format !== 'module' || loaded.source == null) fail('CHIEF_WEB_APP_BASE_DRIFT');
      const source = Buffer.from(loaded.source).toString('utf8');
      const patched = patchChiefWebAppSource(source);
      applied = true;
      return { ...loaded, source: patched };
    },
  });
  mount = mountPilot;
  return {
    verify() { if (!applied) fail('CHIEF_WEB_APP_HOOK_NOT_APPLIED'); },
    close() { hook.deregister(); },
  };
}
