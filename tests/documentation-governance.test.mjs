import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDocumentation } from '../scripts/check-docs.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-docs-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const write = (name, body) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body); };
  const manifest = { schemaVersion: 1, required: ['README.md', 'docs/architecture.md'], entrypoints: { 'README.md': ['docs/architecture.md'] }, rules: [{ prefix: 'src/', docs: ['docs/architecture.md'] }], snapshots: ['docs/status.md'], historicalPrefixes: ['docs/archive/'], nonCode: [] };
  write('README.md', '# Entry\n\n[Architecture](docs/architecture.md)\n');
  write('docs/architecture.md', '# Architecture\n\n## Recovery\n');
  write('docs/documentation-governance.json', JSON.stringify(manifest));
  return { root, write, manifest };
}
const codes = r => r.errors.map(e => e.code);
test('valid project accepts structural and mapped changes', t => {
  const f = fixture(t);
  assert.equal(checkDocumentation(f.root).ok, true);
  assert.equal(checkDocumentation(f.root, { changedFiles: ['src/executor.mjs', 'docs/architecture.md'] }).ok, true);
});
test('missing required document and stale authority entry fail closed', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'docs/architecture.md'));
  assert.ok(codes(checkDocumentation(f.root)).includes('REQUIRED_DOCUMENT_MISSING'));
  f.write('docs/architecture.md', '# Current\n'); f.write('README.md', '[old](docs/archive/old.md)'); f.write('docs/archive/old.md', '# Historical\n');
  assert.ok(codes(checkDocumentation(f.root)).includes('AUTHORITY_LINK_MISSING'));
});
test('broken links, missing anchors and unsafe paths fail', t => {
  const f = fixture(t); f.write('docs/architecture.md', '# Architecture\n[missing](missing.md)\n[anchor](#no-such-heading)\n[out](../../outside.md)');
  const result = codes(checkDocumentation(f.root));
  for (const code of ['LINK_TARGET_MISSING', 'LINK_ANCHOR_MISSING', 'UNSAFE_DOCUMENT_PATH']) assert.ok(result.includes(code));
});
test('reference links and headings work; code samples do not create broken links', t => {
  const f = fixture(t); f.write('docs/architecture.md', '# Architecture\n## Recovery\n[read][recovery]\n[recovery]: #recovery\n```md\n[example](does-not-exist.md)\n```\n');
  assert.equal(checkDocumentation(f.root).ok, true);
  f.write('docs/architecture.md', '# Architecture\n[read][missing-reference]\n');
  assert.ok(codes(checkDocumentation(f.root)).includes('LINK_REFERENCE_MISSING'));
});
test('symlink documents and targets do not expose outside files', t => {
  const f = fixture(t); fs.symlinkSync('/etc/hosts', path.join(f.root, 'docs/external.md'));
  assert.ok(codes(checkDocumentation(f.root)).includes('UNSAFE_DOCUMENT_PATH'));
});
test('shortcut reference links cannot hide traversal or broken targets', t => {
  const f = fixture(t); f.write('docs/architecture.md', '# Architecture\n[escape]\n\n[escape]: ../../outside.md\n[broken]\n\n[broken]: absent.md\n');
  const result = codes(checkDocumentation(f.root));
  assert.ok(result.includes('UNSAFE_DOCUMENT_PATH'));
  assert.ok(result.includes('LINK_TARGET_MISSING'));
});
test('inline code in a heading remains part of its anchor', t => {
  const f = fixture(t); f.write('docs/architecture.md', '# Architecture\n## API `run`\n[run](#api-run)\n');
  assert.equal(checkDocumentation(f.root).ok, true);
});
test('mapped change needs relevant current documentation; snapshots cannot substitute', t => {
  const f = fixture(t);
  for (const changedFiles of [['src/a.mjs'], ['src/a.mjs', 'docs/status.md'], ['src/a.mjs', 'docs/archive/old.md']]) {
    assert.ok(codes(checkDocumentation(f.root, { changedFiles })).includes('DOCUMENTATION_UPDATE_REQUIRED'));
  }
  assert.ok(codes(checkDocumentation(f.root, { changedFiles: ['new-module/a.mjs'] })).includes('UNMAPPED_CHANGE'));
});
test('reason alone, self approval, stale approval or later dismissal cannot waive updates', t => {
  const f = fixture(t); f.write('.github/documentation-exceptions.json', JSON.stringify([{ path: 'src/a.mjs', reason: '仅修改局部变量名，行为和接口保持完全一致。' }]));
  const approval = { user: { login: 'reviewer' }, state: 'APPROVED', commit_id: 'a'.repeat(40), submitted_at: '2026-11-04T00:00:00Z', id: 1 };
  for (const reviewContext of [undefined, { headSha: 'b'.repeat(40), author: 'author', reviews: [approval] }, { headSha: approval.commit_id, author: 'reviewer', reviews: [approval] }, { headSha: approval.commit_id, author: 'author', reviews: [approval, { ...approval, id: 2, state: 'DISMISSED', submitted_at: '2026-11-04T01:00:00Z' }] }]) {
    assert.ok(codes(checkDocumentation(f.root, { changedFiles: ['src/a.mjs'], reviewContext })).includes('DOCUMENTATION_UPDATE_REQUIRED'));
  }
});
test('exact-head independent approval permits reasoned exemption only for mapped path', t => {
  const f = fixture(t); f.write('.github/documentation-exceptions.json', JSON.stringify([{ path: 'src/a.mjs', reason: '仅修改局部变量名，行为和接口保持完全一致。' }]));
  const reviewContext = { headSha: 'a'.repeat(40), author: 'author', reviews: [{ user: { login: 'reviewer' }, state: 'APPROVED', commit_id: 'a'.repeat(40), submitted_at: '2026-11-04T00:00:00Z', id: 1 }] };
  assert.equal(checkDocumentation(f.root, { changedFiles: ['src/a.mjs'], reviewContext }).ok, true);
  assert.ok(codes(checkDocumentation(f.root, { changedFiles: ['src/other.mjs'], reviewContext })).includes('DOCUMENTATION_UPDATE_REQUIRED'));
});
test('ordinary later comments do not cancel an approval, but change requests do', t => {
  const f = fixture(t); f.write('.github/documentation-exceptions.json', JSON.stringify([{ path: 'src/a.mjs', reason: '仅修改局部变量名，行为和接口保持完全一致。' }]));
  const review = { user: { login: 'reviewer' }, state: 'APPROVED', commit_id: 'a'.repeat(40), submitted_at: '2026-11-04T00:00:00Z', id: 1 };
  const context = { headSha: review.commit_id, author: 'author', reviews: [review, { ...review, id: 2, state: 'COMMENTED', submitted_at: '2026-11-04T01:00:00Z' }] };
  assert.equal(checkDocumentation(f.root, { changedFiles: ['src/a.mjs'], reviewContext: context }).ok, true);
  context.reviews.push({ ...review, id: 3, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-04T02:00:00Z' });
  assert.equal(checkDocumentation(f.root, { changedFiles: ['src/a.mjs'], reviewContext: context }).ok, false);
});
test('invalid manifest and traversal in change input cannot pass', t => {
  const f = fixture(t); f.write('docs/documentation-governance.json', '{}');
  assert.ok(codes(checkDocumentation(f.root)).includes('INVALID_GOVERNANCE_MANIFEST'));
  f.write('docs/documentation-governance.json', JSON.stringify(f.manifest));
  assert.ok(codes(checkDocumentation(f.root, { changedFiles: ['../outside.mjs'] })).includes('UNSAFE_DOCUMENT_PATH'));
});
test('candidate policy cannot exempt existing base mappings without review', t => {
  const f = fixture(t); const baselineManifest = structuredClone(f.manifest);
  f.manifest.nonCode.push('src/a.mjs');
  f.write('docs/documentation-governance.json', JSON.stringify(f.manifest));
  const result = checkDocumentation(f.root, { changedFiles: ['src/a.mjs'], baselineManifest });
  assert.ok(codes(result).includes('BASELINE_DOCUMENTATION_UPDATE_REQUIRED'));
  assert.equal(checkDocumentation(f.root, { changedFiles: ['src/a.mjs', 'docs/architecture.md'], baselineManifest }).ok, true);
  assert.ok(codes(checkDocumentation(f.root, { baselineManifest: {} })).includes('INVALID_BASELINE_MANIFEST'));
});
