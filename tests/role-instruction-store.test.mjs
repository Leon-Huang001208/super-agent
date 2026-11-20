import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRoleInstructionStore } from '../bridge/role-instruction-store.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'role-instructions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = { companyId: randomUUID(), agentId: randomUUID() };
  const materialRoot = path.join(root, 'native', identity.agentId, 'instructions');
  fs.mkdirSync(materialRoot + '/research', { recursive: true, mode: 0o700 });
  fs.writeFileSync(materialRoot + '/research/AGENTS.md', 'original', { mode: 0o600 });
  let registry = { companyId: identity.companyId, agents: [{ materialRoot,
    profile: { agentId: identity.agentId, role: 'research', projectKey: 'demo' },
    manifest: { schemaVersion: 1, project: 'demo', role: 'research', instructionsFilePath: 'research/AGENTS.md',
      requiredReferences: [], files: [{ path: 'research/AGENTS.md', sha256: sha('original') }] } }], operations: [] };
  const options = { root, readRegistry: () => structuredClone(registry),
    editRegistry: edit => { registry = edit(structuredClone(registry)) ?? registry; return structuredClone(registry); } };
  return { ...options, identity, materialRoot, store: createRoleInstructionStore(options),
    get registry() { return registry; }, set registry(value) { registry = value; } };
}

test('unregistered roles pass through and migrated writes preserve original bytes and unrelated operations', async t => {
  const f = fixture(t);
  assert.equal(await f.store.withMutation({ companyId: randomUUID(), agentId: randomUUID() }, async () => 17), 17);
  const result = await f.store.withMutation(f.identity, async () => {
    f.registry.operations.push({ id: 'concurrent-operation' });
    fs.writeFileSync(f.materialRoot + '/research/AGENTS.md', 'new version');
    return { changed: true };
  });
  assert.deepEqual(result, { changed: true });
  assert.equal(f.registry.agents[0].manifest.files[0].sha256, sha('new version'));
  assert.equal(f.registry.materialHistory.length, 1);
  assert.equal(f.registry.operations[0].id, 'concurrent-operation');
  const archived = JSON.parse(fs.readFileSync(f.registry.materialHistory[0].snapshotPath, 'utf8'));
  assert.equal(Buffer.from(archived.files[0].contentBase64, 'base64').toString(), 'original');
  assert.doesNotThrow(() => f.store.assertReady(f.identity));
  const historyCount = f.registry.materialHistory.length;
  await f.store.withMutation(f.identity, async () => ({ changed: false }));
  assert.equal(f.registry.materialHistory.length, historyCount);
});

test('same-agent nested writes use one intent and failures block execution until explicit recovery', async t => {
  const f = fixture(t);
  await f.store.withMutation(f.identity, () => f.store.withMutation(f.identity, async () => {
    fs.writeFileSync(f.materialRoot + '/research/AGENTS.md', 'nested');
  }));
  assert.equal(f.registry.materialHistory.length, 1);
  await assert.rejects(f.store.withMutation(f.identity, async () => {
    fs.writeFileSync(f.materialRoot + '/research/AGENTS.md', 'partial native write');
    throw Object.assign(Error('native rejected'), { code: 'NATIVE_REJECTED' });
  }), /native rejected/);
  assert.throws(() => f.store.assertReady(f.identity), /ROLE_INSTRUCTION_PENDING/);
  await assert.rejects(f.store.withMutation(f.identity, async () => assert.fail('must reconcile original intent')), /ROLE_INSTRUCTION_PENDING/);
  assert.equal((await f.store.reconcile(f.identity)).status, 'pending');
  assert.equal((await f.store.reconcile(f.identity, { decision: 'rollback' })).status, 'rolled_back');
  assert.equal(fs.readFileSync(f.materialRoot + '/research/AGENTS.md', 'utf8'), 'nested');
  assert.doesNotThrow(() => f.store.assertReady(f.identity));
  assert.equal((await f.store.reconcile(f.identity, { decision: 'rollback' })).status, 'ready');
});

test('symlink and missing entry changes remain visible pending failures', async t => {
  const f = fixture(t);
  await assert.rejects(f.store.withMutation(f.identity, async () => {
    fs.symlinkSync('/etc/passwd', f.materialRoot + '/research/foreign.md');
  }), /ROLE_INSTRUCTION_PATH_DENIED/);
  assert.throws(() => f.store.assertReady(f.identity), /ROLE_INSTRUCTION_PENDING/);
});

test('recovery restores an entry removed by a failed Native write', async t => {
  const f = fixture(t);
  await assert.rejects(f.store.withMutation(f.identity, async () => fs.unlinkSync(f.materialRoot + '/research/AGENTS.md')), /ROLE_INSTRUCTION_ENTRY_MISSING/);
  assert.equal((await f.store.reconcile(f.identity, { decision: 'rollback' })).status, 'rolled_back');
  assert.equal(fs.readFileSync(f.materialRoot + '/research/AGENTS.md', 'utf8'), 'original');
});

test('Native conflicts with unchanged bytes keep the original error and permit a normal retry', async t => {
  const f = fixture(t), conflict = Object.assign(Error('reload current entry'), { code: 'INSTRUCTION_REVISION_CONFLICT' });
  await assert.rejects(f.store.withMutation(f.identity, async () => { throw conflict; }), error => error === conflict);
  assert.doesNotThrow(() => f.store.assertReady(f.identity));
  const intents = fs.readdirSync(f.root + '/instruction-mutations').map(file => JSON.parse(fs.readFileSync(f.root + '/instruction-mutations/' + file)));
  assert.equal(intents[0].state, 'failed_unmodified');
  assert.equal(f.registry.materialHistory, undefined);
  await f.store.withMutation(f.identity, async () => fs.writeFileSync(f.materialRoot + '/research/AGENTS.md', 'retry succeeds'));
  assert.equal(f.registry.agents[0].manifest.files[0].sha256, sha('retry succeeds'));
});
