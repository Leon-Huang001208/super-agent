/** Resume one metadata migration; Native services own the agent configuration and managed directory. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROLE_ROOT, readControl, writeControl, editRoleRegistry } from '../bridge/role-control-store.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(Error(code), { code }); };
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b) => stable(a) === stable(b);
function filesWithin(root) {
  if (!fs.existsSync(root)) return [];
  if (fs.realpathSync(root) !== root) fail('ROLE_MIGRATION_PATH_DENIED');
  const files = [];
  const visit = (directory, prefix = '') => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name), relative = prefix + item.name, stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) fail('ROLE_MIGRATION_PATH_DENIED');
      if (stat.isDirectory()) visit(filename, relative + '/');
      else files.push(relative);
    }
  };
  visit(root); return files.sort();
}
function verifyFiles(root, files, { allowMissing = false } = {}) {
  const actual = filesWithin(root);
  if (actual.some(file => !Object.hasOwn(files, file))) fail('ROLE_MIGRATION_FOREIGN_FILE');
  for (const [file, content] of Object.entries(files)) {
    if (!actual.includes(file)) { if (allowMissing) continue; fail('ROLE_MIGRATION_FILE_MISSING'); }
    if (fs.readFileSync(path.join(root, file), 'utf8') !== content) fail('ROLE_MIGRATION_FILE_CHANGED');
  }
}
function protectFiles(root, files) {
  fs.chmodSync(root, 0o700);
  for (const file of Object.keys(files)) {
    let directory = root;
    for (const part of file.split('/').slice(0, -1)) { directory = path.join(directory, part); fs.chmodSync(directory, 0o700); }
    fs.chmodSync(path.join(root, file), 0o600);
  }
}
function restorePendingFiles(item) {
  if (filesWithin(item.materialRoot).some(file => !Object.hasOwn(item.files, file))) fail('ROLE_MIGRATION_FOREIGN_FILE');
  const checked = item.original.manifest.files.map(file => {
    const target = file.path === item.original.manifest.instructionsFilePath ? item.role + '/AGENTS.md' : item.role + '/materials/' + file.path;
    const source = path.join(item.original.materialRoot, file.path), stat = fs.lstatSync(source);
    if (fs.realpathSync(source) !== source || !stat.isFile() || stat.nlink !== 1) fail('ROLE_MIGRATION_SOURCE_CHANGED');
    const bytes = fs.readFileSync(source);
    if (sha(bytes) !== file.sha256 || bytes.toString('utf8') !== item.files[target] ||
        item.manifest.files.find(value => value.path === target)?.sha256 !== sha(bytes)) fail('ROLE_MIGRATION_SOURCE_CHANGED');
    return { target, bytes };
  });
  for (const { target, bytes } of checked) {
    const filename = path.join(item.materialRoot, target), temporary = filename + '.' + randomUUID() + '.tmp';
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, filename);
      const parent = fs.openSync(path.dirname(filename), 'r');
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}

export async function migrateRoleInstructions({ root = ROLE_ROOT, migrationId = 'managed-role-instructions-v1', ports,
  readRegistry = () => readControl(root + '/registry.json'), editRegistry = editRoleRegistry } = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(migrationId) || !ports ||
      !['assertIdle', 'getAgent', 'resolveManagedRoot', 'materializeManagedBundle', 'updateAgentConfiguration'].every(key => typeof ports[key] === 'function')) fail('ROLE_MIGRATION_CONFIG_INVALID');
  const idle = async () => {
    const current = readRegistry();
    if (current.team?.enabled !== false || fs.existsSync(root + '/call.lock') || await ports.assertIdle() !== true) fail('ROLE_MIGRATION_BUSY');
    return current;
  };
  const registry = await idle(), directory = root + '/instruction-migrations';
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const intentPath = directory + '/' + migrationId + '.json';
  let intent;
  if (fs.existsSync(intentPath)) {
    intent = readControl(intentPath);
    if (intent.companyId !== registry.companyId || intent.ownerId !== registry.ownerId || intent.projectId !== registry.projectId) fail('ROLE_MIGRATION_IDENTITY_CHANGED');
  } else {
    const entries = [];
    for (const entry of registry.agents) {
      const agent = await ports.getAgent(entry.profile.agentId);
      if (!agent || agent.companyId !== registry.companyId || entry.instructionMutation || entry.instructionMigration?.state === 'pending') fail('ROLE_MIGRATION_AGENT_CHANGED');
      if (entry.materialRoot) fail('ROLE_MIGRATION_ALREADY_MANAGED');
      const sourceRoot = root + '/materials', role = entry.profile.role;
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(role)) fail('ROLE_MIGRATION_ROLE_DENIED');
      const mapping = Object.fromEntries(entry.manifest.files.map(file => [file.path,
        file.path === entry.manifest.instructionsFilePath ? role + '/AGENTS.md' : role + '/materials/' + file.path]));
      const files = {};
      for (const file of entry.manifest.files) {
        if (!file.path || path.posix.normalize(file.path) !== file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').includes('..')) fail('ROLE_MIGRATION_PATH_DENIED');
        const filename = path.join(sourceRoot, file.path), stat = fs.lstatSync(filename);
        if (fs.realpathSync(filename) !== filename || !stat.isFile() || stat.nlink !== 1 || stat.size > 262144) fail('ROLE_MIGRATION_PATH_DENIED');
        const bytes = fs.readFileSync(filename);
        if (sha(bytes) !== file.sha256) fail('ROLE_MIGRATION_SOURCE_CHANGED');
        files[mapping[file.path]] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      const materialRoot = ports.resolveManagedRoot(agent);
      if (!path.isAbsolute(materialRoot) || path.normalize(materialRoot) !== materialRoot || materialRoot === '/') fail('ROLE_MIGRATION_PATH_DENIED');
      verifyFiles(materialRoot, files, { allowMissing: true });
      const manifest = { ...entry.manifest, instructionsFilePath: mapping[entry.manifest.instructionsFilePath],
        requiredReferences: entry.manifest.requiredReferences.map(file => mapping[file]),
        files: Object.entries(files).map(([file, content]) => ({ path: file, sha256: sha(content) })).sort((a, b) => a.path.localeCompare(b.path)) };
      entries.push({ agentId: agent.id, role, original: { materialRoot: sourceRoot, manifest: entry.manifest, adapterConfig: agent.adapterConfig },
        materialRoot, manifest, files, state: 'prepared' });
    }
    intent = { schemaVersion: 1, migrationId, companyId: registry.companyId, ownerId: registry.ownerId,
      projectId: registry.projectId, entries, state: 'pending' };
    writeControl(intentPath, intent);
  }
  for (const item of intent.entries) {
    await idle();
    let current = readRegistry().agents.find(entry => entry.profile.agentId === item.agentId);
    const agent = await ports.getAgent(item.agentId);
    if (!current || !agent || agent.companyId !== intent.companyId || ports.resolveManagedRoot(agent) !== item.materialRoot) fail('ROLE_MIGRATION_AGENT_CHANGED');
    const nextConfig = { ...item.original.adapterConfig, instructionsBundleMode: 'managed', instructionsRootPath: item.materialRoot,
      instructionsEntryFile: item.manifest.instructionsFilePath, instructionsFilePath: item.materialRoot + '/' + item.manifest.instructionsFilePath };
    if (item.state === 'complete' || current.materialRoot === item.materialRoot && same(current.manifest, item.manifest)) {
      if (current.materialRoot !== item.materialRoot || !same(current.manifest, item.manifest) || !same(agent.adapterConfig, nextConfig)) fail('ROLE_MIGRATION_RESULT_CHANGED');
      verifyFiles(item.materialRoot, item.files);
      if (item.state !== 'complete') { item.state = 'complete'; writeControl(intentPath, intent); }
      continue;
    }
    if (current.instructionMutation || !same(current.manifest, item.original.manifest) ||
        !same(agent.adapterConfig, item.original.adapterConfig) && !same(agent.adapterConfig, nextConfig)) fail('ROLE_MIGRATION_SOURCE_CHANGED');
    editRegistry(latest => {
      const target = latest.agents.find(entry => entry.profile.agentId === item.agentId);
      if (!target || target.instructionMutation || target.instructionMigration && target.instructionMigration.id !== migrationId ||
          !same(target.manifest, item.original.manifest)) fail('ROLE_MIGRATION_REGISTRATION_CHANGED');
      target.instructionMigration = { id: migrationId, state: 'pending', intentPath }; return latest;
    });
    try { verifyFiles(item.materialRoot, item.files, { allowMissing: true }); }
    catch (error) {
      if (error.code !== 'ROLE_MIGRATION_FILE_CHANGED' || current.instructionMigration?.id !== migrationId ||
          current.instructionMigration.state !== 'pending' || current.instructionMigration.intentPath !== intentPath ||
          !same(agent.adapterConfig, item.original.adapterConfig)) throw error;
      restorePendingFiles(item);
      verifyFiles(item.materialRoot, item.files);
    }
    const materialized = await ports.materializeManagedBundle(agent, item.files, { entryFile: item.manifest.instructionsFilePath, replaceExisting: false });
    if (!same(materialized.adapterConfig, nextConfig)) fail('ROLE_MIGRATION_NATIVE_CONFIG_CHANGED');
    verifyFiles(item.materialRoot, item.files); protectFiles(item.materialRoot, item.files);
    item.state = 'files_materialized'; writeControl(intentPath, intent);
    if (!same(agent.adapterConfig, nextConfig)) await ports.updateAgentConfiguration(item.agentId, { adapterConfig: nextConfig });
    const updated = await ports.getAgent(item.agentId);
    if (!same(updated?.adapterConfig, nextConfig)) fail('ROLE_MIGRATION_CONFIG_NOT_APPLIED');
    item.state = 'config_applied'; writeControl(intentPath, intent);
    await idle();
    editRegistry(latest => {
      const target = latest.agents.find(entry => entry.profile.agentId === item.agentId);
      if (!target || target.instructionMigration?.id !== migrationId || !same(target.manifest, item.original.manifest)) fail('ROLE_MIGRATION_REGISTRATION_CHANGED');
      latest.materialHistory ??= [];
      if (!latest.materialHistory.some(value => value.agentId === item.agentId && value.migrationId === migrationId)) latest.materialHistory.push({
        agentId: item.agentId, materialRoot: item.original.materialRoot, manifest: item.original.manifest, migrationId,
        source: 'managed-instruction-migration', migrationIntentPath: intentPath });
      target.materialRoot = item.materialRoot; target.manifest = item.manifest; delete target.instructionMigration; return latest;
    });
    item.state = 'complete'; writeControl(intentPath, intent);
  }
  intent.state = 'complete'; writeControl(intentPath, intent);
  return { status: 'complete', migrationId, roles: intent.entries.length, newModelCalls: 0 };
}

async function main() {
  if (process.platform !== 'linux' || process.getuid() !== 0 || process.argv[2] !== '--apply') fail('ROLE_MIGRATION_EXPLICIT_DOCKER_APPLY_REQUIRED');
  process.umask(0o077);
  const P = '/opt/paperclip/node_modules';
  const schema = await import(P + '/@paperclipai/db/dist/index.js'), orm = await import(P + '/drizzle-orm/index.js');
  const password = fs.readFileSync('/paperclip/secrets/postgres-password', 'utf8').trim();
  const url = 'postgres://paperclip:' + encodeURIComponent(password) + '@db:5432/paperclip';
  process.env.DATABASE_URL = url;
  const db = schema.createDb(url, { maxConnections: 2, applicationName: 'role-instruction-migration' });
  try {
    const native = await import(P + '/@paperclipai/server/dist/services/agent-instructions.js');
    const configuration = await import(P + '/@paperclipai/server/dist/services/agent-configuration-transaction.js');
    const instructions = native.agentInstructionsService(db);
    const result = await migrateRoleInstructions({ ports: {
      assertIdle: async () => {
        const runs = await db.select({ id: schema.heartbeatRuns.id }).from(schema.heartbeatRuns).where(orm.inArray(schema.heartbeatRuns.status, ['running', 'queued', 'scheduled_retry']));
        const leases = await db.select({ id: schema.environmentLeases.id }).from(schema.environmentLeases).where(orm.inArray(schema.environmentLeases.status, ['active', 'pending_cleanup']));
        return runs.length === 0 && leases.length === 0;
      },
      getAgent: async id => (await db.select().from(schema.agents).where(orm.eq(schema.agents.id, id)))[0],
      resolveManagedRoot: native.resolveManagedInstructionsRoot,
      materializeManagedBundle: (...args) => instructions.materializeManagedBundle(...args),
      updateAgentConfiguration: (id, patch) => db.transaction(tx => configuration.updateAgentConfigurationInTransaction(tx, id, patch, {
        allowPendingApprovalConfigUpdate: true, recordRevision: { createdByUserId: readControl(ROLE_ROOT + '/registry.json').ownerId, source: 'role_instructions_managed_migration' },
      })),
    } });
    console.log(JSON.stringify(result));
  } finally { await schema.closeRegisteredClients(url); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) {
    console.error(JSON.stringify({ code: /^ROLE_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'ROLE_MIGRATION_FAILED' })); process.exitCode = 1;
  }
}
