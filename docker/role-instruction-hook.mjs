import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { withRoleInstructionMutation } from '../bridge/role-instruction-store.mjs';

const revisionSha256 = '5c5ee699cf5d4f0ff1438ba311167467130fa44eb34cb1ff654327a37d6cefef';
const fileStoreSha256 = '582468d90d2887abcb9e43c2e06e2fe06af0c0d985664976acc7fcf2be45a041';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

/** Preserve Native authorization, conflict checks, receipts and errors. */
export function wrapRoleInstructionService(service, methods, mutate = withRoleInstructionMutation) {
  const wrapped = { ...service };
  for (const method of methods) {
    if (typeof service[method] !== 'function') fail('ROLE_INSTRUCTION_SERVICE_UNSUPPORTED');
    wrapped[method] = (input, ...args) => mutate(
      { companyId: input.companyId, agentId: input.agentId },
      () => service[method].call(service, input, ...args),
    );
  }
  return wrapped;
}

function patchSource(source, { sha256, factory, methods, errorCode }) {
  const signature = `export function ${factory}(db) {`;
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== sha256 ||
      source.split(signature).length !== 2) fail(errorCode);
  return 'import { wrapRoleInstructionService } from ' + JSON.stringify(import.meta.url) + ';\n' +
    source.replace(signature, `function ${factory}Native(db) {`) + `
export function ${factory}(db) {
    return wrapRoleInstructionService(${factory}Native(db), ${JSON.stringify(methods)});
}
`;
}

export function patchRoleInstructionRevisionSource(source) {
  return patchSource(source, {
    sha256: revisionSha256, factory: 'agentInstructionRevisionService',
    methods: ['commit', 'restore', 'commitPluginReset'], errorCode: 'ROLE_INSTRUCTION_REVISION_BASE_DRIFT',
  });
}

export function patchRoleInstructionFileStoreSource(source) {
  return patchSource(source, {
    sha256: fileStoreSha256, factory: 'agentFileStore',
    methods: ['write', 'apply'], errorCode: 'ROLE_INSTRUCTION_FILE_STORE_BASE_DRIFT',
  });
}

/** Process-local loading only; the installed Paperclip release remains unchanged. */
export function installRoleInstructionHook({ directory = '/opt/paperclip', enabled = true } = {}) {
  if (!enabled) return { enabled: false, moduleUrls: [], verify() {}, close() {} };
  const root = fs.realpathSync(path.join(directory, 'node_modules', '@paperclipai', 'server'));
  const patches = new Map([
    ['agent-instruction-revisions.js', patchRoleInstructionRevisionSource],
    ['agent-file-store.js', patchRoleInstructionFileStoreSource],
  ].map(([filename, patch]) => {
    const expected = path.join(root, 'dist', 'services', filename);
    if (fs.realpathSync(expected) !== expected) fail('ROLE_INSTRUCTION_SERVICE_PATH_DENIED');
    return [pathToFileURL(expected).href, patch];
  }));
  const applied = new Set();
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      const patch = patches.get(url);
      if (!patch) return loaded;
      if (loaded.format !== 'module' || loaded.source == null) fail('ROLE_INSTRUCTION_SERVICE_BASE_DRIFT');
      const source = patch(Buffer.from(loaded.source).toString('utf8'));
      applied.add(url);
      return { ...loaded, source };
    },
  });
  return {
    enabled: true,
    moduleUrls: [...patches.keys()],
    verify() {
      if (applied.size !== patches.size) fail('ROLE_INSTRUCTION_HOOK_NOT_APPLIED');
    },
    close() { hook.deregister(); },
  };
}
