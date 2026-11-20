import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { migrateRoleInstructions } from '../scripts/migrate-role-instructions.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'role-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root + '/materials'); fs.mkdirSync(root + '/permits'); fs.mkdirSync(root + '/claims');
  fs.writeFileSync(root + '/permits/retained.json', 'original permit');
  const companyId = randomUUID(), ownerId = 'owner', agents = new Map();
  let registry = { companyId, ownerId, projectId: randomUUID(), team: { enabled: false }, operations: [{ id: 'original' }], agents: [] };
  for (const role of ['research', 'pm']) {
    const agentId = randomUUID(), file = randomUUID() + '.md', content = role + ' instructions';
    fs.writeFileSync(root + '/materials/' + file, content, { mode: 0o600 });
    registry.agents.push({ profile: { agentId, role, projectKey: 'demo' }, manifest: { schemaVersion: 1, project: 'demo', role,
      instructionsFilePath: file, requiredReferences: [], files: [{ path: file, sha256: sha(content) }] } });
    agents.set(agentId, { id: agentId, companyId, adapterConfig: { model: 'fixed-model', instructionsFilePath: root + '/materials/' + file } });
  }
  let failAgent = null, failOnce = false;
  const options = { root, migrationId: 'managed-role-instructions-v1', readRegistry: () => structuredClone(registry),
    editRegistry: edit => { registry = edit(structuredClone(registry)) ?? registry; return structuredClone(registry); },
    ports: {
      assertIdle: async () => true,
      getAgent: async id => structuredClone(agents.get(id)),
      resolveManagedRoot: agent => root + '/native/' + agent.id + '/instructions',
      materializeManagedBundle: async (agent, files, input) => {
        const destination = root + '/native/' + agent.id + '/instructions';
        for (const [name, content] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(destination + '/' + name), { recursive: true, mode: 0o700 });
          fs.writeFileSync(destination + '/' + name, content, { mode: 0o600 });
        }
        return { adapterConfig: { ...agent.adapterConfig, instructionsBundleMode: 'managed', instructionsRootPath: destination,
          instructionsEntryFile: input.entryFile, instructionsFilePath: destination + '/' + input.entryFile } };
      },
      updateAgentConfiguration: async (id, patch) => {
        if (id === failAgent && !failOnce) { failOnce = true; throw Error('simulated configuration failure'); }
        agents.set(id, { ...agents.get(id), ...patch });
      },
    } };
  return { options, agents, get registry() { return registry; }, failOn(id) { failAgent = id; } };
}

test('migration isolates native role bundles, keeps UUID evidence and resumes partial configuration failure', async t => {
  const f = fixture(t), secondId = f.registry.agents[1].profile.agentId;
  f.failOn(secondId);
  await assert.rejects(migrateRoleInstructions(f.options), /simulated configuration failure/);
  assert.ok(f.registry.agents[0].materialRoot);
  assert.equal(f.registry.agents[1].instructionMigration.state, 'pending');
  const result = await migrateRoleInstructions(f.options);
  assert.equal(result.status, 'complete');
  for (const entry of f.registry.agents) {
    assert.equal(entry.manifest.instructionsFilePath, entry.profile.role + '/AGENTS.md');
    assert.equal(fs.readFileSync(entry.materialRoot + '/' + entry.manifest.instructionsFilePath, 'utf8'), entry.profile.role + ' instructions');
    assert.deepEqual(fs.readdirSync(entry.materialRoot), [entry.profile.role]);
    assert.equal(f.agents.get(entry.profile.agentId).adapterConfig.model, 'fixed-model');
  }
  assert.equal(fs.readdirSync(f.options.root + '/materials').length, 2);
  assert.equal(fs.readFileSync(f.options.root + '/permits/retained.json', 'utf8'), 'original permit');
  assert.equal(f.registry.materialHistory.length, 2);
  assert.equal(f.registry.operations[0].id, 'original');
  assert.equal((await migrateRoleInstructions(f.options)).status, 'complete');
  assert.equal(f.registry.materialHistory.length, 2);
});

test('migration refuses active dispatch and unowned target files before touching Native configuration', async t => {
  const f = fixture(t);
  f.options.ports.assertIdle = async () => { throw Error('MIGRATION_BUSY'); };
  await assert.rejects(migrateRoleInstructions(f.options), /MIGRATION_BUSY/);
  assert.equal(f.registry.agents.some(a => a.materialRoot), false);
});

test('migration resumes a crash after publishing a role registry entry without duplicating its history', async t => {
  const f = fixture(t), edit = f.options.editRegistry;
  let interrupted = false;
  f.options.editRegistry = callback => {
    const next = edit(callback);
    if (!interrupted && next.agents[0].materialRoot) { interrupted = true; throw Error('crash after registry publish'); }
    return next;
  };
  await assert.rejects(migrateRoleInstructions(f.options), /crash after registry publish/);
  assert.equal(f.registry.materialHistory.length, 1);
  f.options.editRegistry = edit;
  assert.equal((await migrateRoleInstructions(f.options)).status, 'complete');
  assert.equal(f.registry.materialHistory.length, 2);
});

test('migration refuses a pre-existing foreign file instead of copying or deleting it', async t => {
  const f = fixture(t), agent = f.agents.get(f.registry.agents[0].profile.agentId), destination = f.options.ports.resolveManagedRoot(agent);
  fs.mkdirSync(destination, { recursive: true }); fs.writeFileSync(destination + '/foreign.md', 'retain me');
  await assert.rejects(migrateRoleInstructions(f.options), /ROLE_MIGRATION_FOREIGN_FILE/);
  assert.equal(fs.readFileSync(destination + '/foreign.md', 'utf8'), 'retain me');
  assert.equal(f.registry.agents.some(a => a.materialRoot), false);
});
