import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadRoleMaterials, selectRoleKnowledge } from '../bridge/role-materials.mjs';

test('mandatory files are hashed, missing references and symlinks block readiness', t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'role-materials-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.writeFileSync(root + '/instructions.md', 'Research with attributable sources.');
  const sha256 = createHash('sha256').update(fs.readFileSync(root + '/instructions.md')).digest('hex');
  const manifest = { schemaVersion: 1, project: 'demo', role: 'research', instructionsFilePath: 'instructions.md',
    requiredReferences: [], files: [{ path: 'instructions.md', sha256 }] };
  const events = [], input = { root, project: 'demo', role: 'research', manifest, log: event => events.push(event) };
  assert.equal(loadRoleMaterials(input).files.length, 1);
  assert.equal(events[0].code, 'ROLE_MATERIAL_READY');
  fs.mkdirSync(root + '/directory.md');
  assert.throws(() => loadRoleMaterials({ ...input, manifest: { ...manifest, files: [{path: 'directory.md', sha256}] } }), /TYPE_DENIED/);
  assert.throws(() => loadRoleMaterials({ ...input, manifest: { ...manifest, requiredReferences: ['missing.md'] } }), /REFERENCE_MISSING/);
  assert.throws(() => loadRoleMaterials({ ...input, project: 'foreign' }), /CONFIG_INVALID/);
  fs.writeFileSync(root + '/instructions.md', 'changed');
  assert.throws(() => loadRoleMaterials(input), /DIGEST_MISMATCH/);
  fs.unlinkSync(root + '/instructions.md');
  fs.symlinkSync('/etc/passwd', root + '/instructions.md');
  assert.throws(() => loadRoleMaterials(input), /LINK_DENIED/);
  assert.throws(() => loadRoleMaterials({ ...input, manifest: { ...manifest, files: [{path: '../escape', sha256}] } }), /PATH_DENIED/);
});

test('new knowledge read returns corrected decision and excludes foreign/private records', () => {
  const decision = { project: 'demo', id: 'choice', version: 1, kind: 'decision', visibility: 'project',
    source: 'owner-confirmation:1', condition: 'pilot', text: 'original' };
  const records = [decision, { ...decision, version: 2, text: 'corrected', source: 'owner-confirmation:2' },
    { ...decision, project: 'other', text: 'foreign' },
    { ...decision, id: 'private-note', visibility: 'private', role: 'research', kind: 'experience', text: 'private' }];
  assert.deepEqual(selectRoleKnowledge({ project: 'demo', role: 'pm', records }).map(r => r.text), ['corrected']);
  assert.equal(selectRoleKnowledge({ project: 'demo', role: 'research', records }).length, 2);
  assert.throws(() => selectRoleKnowledge({ project: 'demo', role: 'pm', records: [decision, { ...decision, text: 'conflict' }] }), /VERSION_CONFLICT/);
  assert.throws(() => selectRoleKnowledge({ project: 'demo', role: 'pm', records: [records[1], decision, { ...decision, text: 'conflict' }] }), /VERSION_CONFLICT/);
  const reordered = Object.fromEntries(Object.entries(decision).reverse());
  assert.equal(selectRoleKnowledge({ project: 'demo', role: 'pm', records: [decision, reordered] }).length, 1);
});

test('material byte budgets reject oversize file and cumulative expansion', t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'role-budget-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const write = (name, count) => {
    const bytes = Buffer.alloc(count, 65);
    fs.writeFileSync(root + '/' + name, bytes);
    return { path: name, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const large = write('large.md', 262145);
  const check = files => loadRoleMaterials({ root, project: 'demo', role: 'pm', log() {},
    manifest: {schemaVersion: 1, project: 'demo', role: 'pm', instructionsFilePath: files[0].path, requiredReferences: [], files} });
  assert.throws(() => check([large]), /SIZE_DENIED/);
  const files = Array.from({ length: 5 }, (_, i) => write('part-' + i + '.md', 262144));
  assert.throws(() => check(files), /SIZE_DENIED/);
});
