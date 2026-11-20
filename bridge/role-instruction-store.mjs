import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { ROLE_ROOT, readControl, writeControl, editRoleRegistry } from './role-control-store.mjs';

const active = new AsyncLocalStorage();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(Error(code), { code }); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identityKey = value => value.companyId + '/' + value.agentId;
function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(directory) !== directory || !fs.lstatSync(directory).isDirectory()) fail('ROLE_INSTRUCTION_PATH_DENIED');
}
function immutable(file, value) {
  const text = JSON.stringify(value) + '\n';
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const parent = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (fs.readFileSync(file, 'utf8') !== text) fail('ROLE_INSTRUCTION_SNAPSHOT_CHANGED');
  }
}

/** A small, bounded material bundle. Binary agent storage is not instruction material. */
export function readRoleInstructionBundle(entry, { requireEntry = true } = {}) {
  const root = entry.materialRoot;
  if (!path.isAbsolute(root ?? '') || path.normalize(root) !== root || root === '/' ||
      fs.realpathSync(root) !== root) fail('ROLE_INSTRUCTION_PATH_DENIED');
  const files = []; let total = 0;
  const visit = (directory, prefix = '') => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + item.name, filename = path.join(directory, item.name), stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) fail('ROLE_INSTRUCTION_PATH_DENIED');
      if (stat.isDirectory()) { visit(filename, relative + '/'); continue; }
      if (stat.nlink !== 1 || stat.size > 262144 || files.length >= 32 || total + stat.size > 1048576) fail('ROLE_INSTRUCTION_SIZE_DENIED');
      const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      let bytes;
      try {
        const before = fs.fstatSync(fd); bytes = fs.readFileSync(fd); const after = fs.fstatSync(fd);
        if (!before.isFile() || before.ino !== stat.ino || bytes.length !== before.size ||
            before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail('ROLE_INSTRUCTION_CHANGED');
      } finally { fs.closeSync(fd); }
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('ROLE_INSTRUCTION_ENCODING_DENIED'); }
      total += bytes.length; files.push({ path: relative, sha256: hash(bytes), contentBase64: bytes.toString('base64') });
    }
  };
  visit(root);
  const seen = new Set(files.map(file => file.path));
  if (requireEntry && (!seen.has(entry.manifest.instructionsFilePath) || entry.manifest.requiredReferences.some(file => !seen.has(file)))) fail('ROLE_INSTRUCTION_ENTRY_MISSING');
  return { schemaVersion: 1, materialRoot: root, manifest: { ...entry.manifest,
    files: files.map(({ path: file, sha256 }) => ({ path: file, sha256 })) }, files };
}

export function saveRoleInstructionSnapshot(entry, { root = ROLE_ROOT } = {}) {
  const bundle = readRoleInstructionBundle(entry);
  const directory = root + '/instruction-history/' + entry.profile.agentId;
  privateDirectory(directory);
  const snapshotPath = directory + '/' + hash(JSON.stringify(bundle)) + '.json';
  immutable(snapshotPath, bundle);
  return { ...bundle, snapshotPath };
}

/** Uses the existing registry control lock; never replaces a registry captured before a Native await. */
export function createRoleInstructionStore({ root = ROLE_ROOT,
  readRegistry = () => readControl(root + '/registry.json'), editRegistry = editRoleRegistry } = {}) {
  const registration = identity => {
    let registry;
    try { registry = readRegistry(); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (registry.companyId !== identity.companyId) return null;
    return registry.agents.find(entry => entry.profile.agentId === identity.agentId) ?? null;
  };
  const assertReady = identity => {
    const entry = registration(identity);
    if (entry?.instructionMutation || entry?.instructionMigration?.state === 'pending') fail('ROLE_INSTRUCTION_PENDING');
    return entry;
  };
  const publish = (identity, intent, after) => editRegistry(registry => {
    const entry = registry.agents.find(value => value.profile.agentId === identity.agentId);
    if (registry.companyId !== identity.companyId || entry?.instructionMutation?.id !== intent.id ||
        entry.materialRoot !== intent.before.materialRoot || !equal(entry.manifest, intent.before.manifest)) fail('ROLE_INSTRUCTION_REGISTRATION_CHANGED');
    if (!equal(entry.manifest, after.manifest)) {
      registry.materialHistory ??= [];
      if (!registry.materialHistory.some(value => value.operationId === intent.id)) registry.materialHistory.push({
        agentId: identity.agentId, materialRoot: entry.materialRoot, manifest: entry.manifest,
        snapshotPath: intent.before.snapshotPath, operationId: intent.id, source: 'native-instruction-mutation' });
      entry.manifest = after.manifest;
    }
    delete entry.instructionMutation;
    return registry;
  });
  async function withMutation(identity, mutation) {
    if (typeof mutation !== 'function') fail('ROLE_INSTRUCTION_MUTATION_INVALID');
    const key = identityKey(identity);
    if (active.getStore()?.has(key)) return mutation();
    const entry = assertReady(identity);
    if (!entry?.materialRoot) return mutation();
    const before = saveRoleInstructionSnapshot(entry, { root });
    if (!equal(before.manifest, entry.manifest)) fail('ROLE_INSTRUCTION_UNREGISTERED_CHANGE');
    const id = randomUUID(), directory = root + '/instruction-mutations'; privateDirectory(directory);
    const intentPath = directory + '/' + id + '.json';
    const intent = { schemaVersion: 1, id, ...identity, state: 'pending', before };
    writeControl(intentPath, intent);
    editRegistry(registry => {
      const current = registry.agents.find(value => value.profile.agentId === identity.agentId);
      if (registry.companyId !== identity.companyId || current?.instructionMutation || current?.instructionMigration?.state === 'pending' ||
          current?.materialRoot !== entry.materialRoot || !equal(current?.manifest, entry.manifest)) fail('ROLE_INSTRUCTION_REGISTRATION_CHANGED');
      current.instructionMutation = { id, state: 'pending', intentPath }; return registry;
    });
    return active.run(new Set([...(active.getStore() ?? []), key]), async () => {
      try {
        const result = await mutation();
        const after = saveRoleInstructionSnapshot(entry, { root });
        writeControl(intentPath, { ...intent, state: 'native_succeeded', after });
        publish(identity, intent, after);
        writeControl(intentPath, { ...intent, state: 'complete', after });
        return result;
      } catch (error) {
        // A Native transaction may roll back after replacing a disk file. Preserve both the failure and the original bytes.
        const recorded = readControl(intentPath);
        if (recorded.state === 'pending') {
          let unchanged = false;
          try { unchanged = equal(readRoleInstructionBundle(entry).manifest, before.manifest); } catch { /* A partial or invalid tree keeps the original pending intent. */ }
          writeControl(intentPath, { ...intent, state: unchanged ? 'failed_unmodified' : 'failed',
            errorCode: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'NATIVE_MUTATION_FAILED' });
          if (unchanged) publish(identity, intent, before);
        }
        throw error;
      }
    });
  }
  async function reconcile(identity, { decision = 'check' } = {}) {
    const entry = registration(identity), marker = entry?.instructionMutation;
    if (!marker) return { status: 'ready' };
    const intent = readControl(marker.intentPath);
    if (intent.id !== marker.id || intent.companyId !== identity.companyId || intent.agentId !== identity.agentId) fail('ROLE_INSTRUCTION_INTENT_CHANGED');
    if (intent.state === 'native_succeeded') {
      const current = readRoleInstructionBundle(entry);
      if (!equal(current.manifest, intent.after.manifest)) fail('ROLE_INSTRUCTION_CHANGED');
      publish(identity, intent, intent.after);
      writeControl(marker.intentPath, { ...intent, state: 'complete' });
      return { status: 'completed' };
    }
    if (decision !== 'rollback') return { status: 'pending', operationId: intent.id };
    // Native hooks reject new writes while this intent is pending. Only task-owned material files are restored.
    const current = readRoleInstructionBundle(entry, { requireEntry: false });
    for (const file of current.files) if (!intent.before.files.some(old => old.path === file.path)) fs.unlinkSync(path.join(entry.materialRoot, file.path));
    for (const file of intent.before.files) {
      const filename = path.join(entry.materialRoot, file.path); privateDirectory(path.dirname(filename));
      const temporary = filename + '.' + randomUUID() + '.tmp';
      fs.writeFileSync(temporary, Buffer.from(file.contentBase64, 'base64'), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, filename);
    }
    if (!equal(readRoleInstructionBundle(entry).manifest, intent.before.manifest)) fail('ROLE_INSTRUCTION_RESTORE_FAILED');
    publish(identity, intent, intent.before);
    writeControl(marker.intentPath, { ...intent, state: 'rolled_back' });
    return { status: 'rolled_back' };
  }
  return { withMutation, assertReady, reconcile };
}

const store = createRoleInstructionStore();
export const withRoleInstructionMutation = (identity, mutation) => store.withMutation(identity, mutation);
export const assertRoleInstructionsReady = identity => store.assertReady(identity);
export const reconcileRoleInstructionMutation = (identity, decision) => store.reconcile(identity, decision);
