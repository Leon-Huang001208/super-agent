import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProjectKnowledgeStore } from '../bridge/project-knowledge-store.mjs';
import { selectRoleKnowledge } from '../bridge/role-materials.mjs';

function fixture(t, options = {}) {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sa-memory-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'knowledge');
  const logs = [];
  const scope = { companyId: randomUUID(), ownerId: 'owner_1', projectId: randomUUID(), projectKey: 'personal-automation-m1' };
  const store = createProjectKnowledgeStore({ root, log: event => logs.push(event), authorizeOwner: async () => true,
    now: () => '2026-11-20T01:00:00.000Z', ...options });
  return { root, parent, logs, scope, store };
}

function request(f, overrides = {}) {
  return { scope: f.scope, id: 'report-policy', kind: 'decision', visibility: 'project',
    text: 'Owner confirmed: put a short evidence checklist first.', condition: 'Until explicitly corrected by the owner',
    source: { messageId: 'om_' + randomUUID().replaceAll('-', ''), chatId: 'oc_ownerchat',
      bodySha256: 'a'.repeat(64), eventId: randomUUID(), createdAt: '2026-11-20T00:00:00.000Z' },
    operationId: randomUUID(), ...overrides };
}

function partitionFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap(name => {
    const directory = path.join(root, name);
    if (!fs.lstatSync(directory).isDirectory()) return [];
    return fs.readdirSync(directory).filter(file => file.endsWith('.json')).map(file => path.join(directory, file));
  });
}

function partition(root, predicate) {
  const found = partitionFiles(root).find(file => predicate(JSON.parse(fs.readFileSync(file, 'utf8'))));
  assert.ok(found, 'fixture must locate the intended partition');
  return found;
}

test('memory writes require an explicit owner authorizer and rejection creates no store', async t => {
  const f = fixture(t, { authorizeOwner: async () => false });
  await assert.rejects(f.store.remember(request(f)), { code: 'PROJECT_KNOWLEDGE_OWNER_DENIED' });
  assert.equal(fs.existsSync(f.root), false);
  assert.ok(f.logs.some(event => event.code === 'PROJECT_KNOWLEDGE_OWNER_DENIED'));
  assert.throws(() => createProjectKnowledgeStore({ root: f.root, log() {} }), { code: 'PROJECT_KNOWLEDGE_CONFIG_INVALID' });
});

test('confirmed version one retains real-source provenance and the existing role-reader shape', async t => {
  const f = fixture(t), input = request(f), result = await f.store.remember(input);
  assert.equal(result.reused, false);
  assert.equal(result.record.version, 1);
  assert.equal(result.record.project, f.scope.projectKey);
  assert.equal(result.record.source, 'feishu:' + input.source.messageId);
  assert.equal(result.record.confirmation.status, 'owner-confirmed');
  assert.deepEqual(result.record.confirmation.source, input.source);
  assert.equal(result.record.confirmation.operationId, input.operationId);
  assert.match(result.record.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.record.supersedes, null);
  assert.equal(selectRoleKnowledge({ project: f.scope.projectKey, role: 'pm', records: [result.record] }).length, 1);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.record.confirmation.source));
  assert.throws(() => { result.record.text = 'changed'; }, TypeError);
  const file = partition(f.root, state => state.visibility === 'project');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.root).mode & 0o777, 0o700);
  assert.equal(JSON.stringify(f.logs).includes(input.text), false);
});

test('same source and operation replay returns the original record while source changes conflict', async t => {
  const f = fixture(t), input = request(f), first = await f.store.remember(input);
  const replay = await f.store.remember(structuredClone(input));
  assert.equal(replay.reused, true);
  assert.deepEqual(replay.record, first.record);
  await assert.rejects(f.store.remember({ ...input, text: 'A different value' }), { code: 'PROJECT_KNOWLEDGE_SOURCE_CONFLICT' });
  await assert.rejects(f.store.remember({ ...input, operationId: randomUUID() }), { code: 'PROJECT_KNOWLEDGE_SOURCE_CONFLICT' });
  await assert.rejects(f.store.remember({ ...input, source: { ...input.source, messageId: 'om_other' } }), { code: 'PROJECT_KNOWLEDGE_SOURCE_CONFLICT' });
  assert.equal(f.store.history({ scope: f.scope, id: input.id, visibility: 'project' }).length, 1);
});

test('owner correction appends version two and retains immutable predecessor evidence', async t => {
  const f = fixture(t), original = await f.store.remember(request(f));
  const next = request(f, { expectedVersion: 1, text: 'Owner corrected: start with the decision, then evidence.' });
  next.source.createdAt = '2026-11-20T00:01:00.000Z';
  const corrected = await f.store.correct(next);
  assert.equal(corrected.record.version, 2);
  assert.deepEqual(corrected.record.supersedes, { version: 1, sha256: original.record.sha256 });
  assert.equal(corrected.record.kind, original.record.kind);
  assert.equal((await f.store.correct(next)).reused, true);
  const history = f.store.history({ scope: f.scope, id: 'report-policy', visibility: 'project' });
  assert.deepEqual(history.map(record => record.version), [1, 2]);
  assert.equal(history[0].text, original.record.text);
  assert.equal(f.store.query({ scope: f.scope, role: 'pm' })[0].text, corrected.record.text);
  assert.ok(Object.isFrozen(history));
  await assert.rejects(f.store.correct(request(f, { expectedVersion: 1, text: 'stale correction' })), { code: 'PROJECT_KNOWLEDGE_VERSION_CONFLICT' });
  await assert.rejects(f.store.remember(request(f)), { code: 'PROJECT_KNOWLEDGE_ALREADY_EXISTS' });
});

test('a delayed owner correction cannot overwrite a later confirmed source', async t => {
  const f = fixture(t), first = request(f);
  first.source.createdAt = '2026-11-20T00:02:00.000Z';
  await f.store.remember(first);
  await assert.rejects(f.store.correct(request(f, { expectedVersion: 1, text: 'older source' })), { code: 'PROJECT_KNOWLEDGE_STALE_SOURCE' });
  assert.equal(f.store.history({ scope: f.scope, id: first.id, visibility: 'project' }).length, 1);
});

test('project and role partitions are selected before any unseen file is read', async t => {
  const f = fixture(t), other = { ...f.scope, projectId: randomUUID(), projectKey: 'research-workbench' };
  await f.store.remember(request(f));
  await f.store.remember(request(f, { scope: other, text: 'Only the other project may see this phrase.' }));
  await f.store.remember(request(f, { id: 'pm-private', visibility: 'private', role: 'pm', text: 'PM private experience' }));
  await f.store.remember(request(f, { id: 'qa-private', visibility: 'private', role: 'qa', text: 'QA private experience' }));
  const otherFile = partition(f.root, state => state.scope.projectId === other.projectId);
  const privateFile = partition(f.root, state => state.scope.projectId === f.scope.projectId && state.role === 'qa');
  fs.writeFileSync(otherFile, 'not JSON');
  fs.writeFileSync(privateFile, 'also not JSON');
  const visible = f.store.query({ scope: f.scope, role: 'pm' });
  assert.deepEqual(visible.map(record => record.id).sort(), ['pm-private', 'report-policy']);
  assert.equal(JSON.stringify(visible).includes('Only the other project'), false);
  assert.throws(() => f.store.query({ scope: other, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_READ_FAILED' });
});

test('query ranks only authorized current versions and applies a bounded result limit', async t => {
  const f = fixture(t);
  await f.store.remember(request(f, { id: 'alpha', text: 'API availability and endpoint freshness' }));
  await f.store.remember(request(f, { id: 'beta', text: 'Report heading and decision evidence' }));
  assert.equal(f.store.query({ scope: f.scope, role: 'pm', query: 'heading', limit: 1 })[0].id, 'beta');
  assert.throws(() => f.store.query({ scope: f.scope, role: 'pm', limit: 65 }), { code: 'PROJECT_KNOWLEDGE_QUERY_INVALID' });
  assert.throws(() => f.store.query({ scope: f.scope, role: 'unknown' }), { code: 'PROJECT_KNOWLEDGE_QUERY_INVALID' });
  assert.throws(() => f.store.query({ scope: { ...f.scope, projectKey: '../outside' }, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_SCOPE_INVALID' });
});

test('unsafe file links, hard links and broad permissions are rejected', async t => {
  for (const kind of ['symlink', 'hardlink', 'permissions']) await t.test(kind, async st => {
    const f = fixture(st);await f.store.remember(request(f));
    const file = partition(f.root, state => state.visibility === 'project');
    if (kind === 'symlink') { const original = file + '.original';fs.renameSync(file, original);fs.symlinkSync(original, file); }
    if (kind === 'hardlink') fs.linkSync(file, file + '.linked');
    if (kind === 'permissions') fs.chmodSync(file, 0o644);
    assert.throws(() => f.store.query({ scope: f.scope, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_FILE_DENIED' });
  });
});

test('a store directory symlink and an unsafe existing root are denied without changing them', async t => {
  const f = fixture(t), actual = path.join(f.parent, 'actual');fs.mkdirSync(actual, { mode: 0o700 });fs.symlinkSync(actual, f.root);
  await assert.rejects(f.store.remember(request(f)), { code: 'PROJECT_KNOWLEDGE_DIRECTORY_DENIED' });
  assert.equal(fs.readdirSync(actual).length, 0);
  fs.unlinkSync(f.root);fs.mkdirSync(f.root, { mode: 0o755 });
  await assert.rejects(f.store.remember(request(f)), { code: 'PROJECT_KNOWLEDGE_DIRECTORY_DENIED' });
});

test('an unknown write lock is retained and never treated as stale by elapsed time', async t => {
  const f = fixture(t);await f.store.remember(request(f));
  const file = partition(f.root, state => state.visibility === 'project'), lock = file + '.lock';
  fs.writeFileSync(lock, 'unknown owner and result', { mode: 0o600 });
  await assert.rejects(f.store.correct(request(f, { expectedVersion: 1, text: 'new' })), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
  assert.equal(fs.readFileSync(lock, 'utf8'), 'unknown owner and result');
  assert.throws(() => f.store.query({ scope: f.scope, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
  assert.throws(() => f.store.history({ scope: f.scope, id: 'report-policy', visibility: 'project' }), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).records.length, 1);
});

test('an interrupted atomic commit retains its lock and leaves the known history unchanged', async t => {
  const f = fixture(t);await f.store.remember(request(f));
  const file = partition(f.root, state => state.visibility === 'project'), input = request(f, { expectedVersion: 1, text: 'new' });
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { if (to === file) throw Object.assign(Error('I/O fixture'), { code: 'EIO' });return rename(from, to); });
  await assert.rejects(f.store.correct(input), { code: 'PROJECT_KNOWLEDGE_COMMIT_UNKNOWN' });
  t.mock.restoreAll();
  assert.equal(fs.existsSync(file + '.lock'), true);
  assert.throws(() => f.store.query({ scope: f.scope, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).records.length, 1);
  await assert.rejects(f.store.correct(input), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
});

test('tampered source records fail closed and oversized or untrusted data never reaches storage', async t => {
  const f = fixture(t);await f.store.remember(request(f));
  const file = partition(f.root, state => state.visibility === 'project'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.records[0].text = 'tampered';fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => f.store.query({ scope: f.scope, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_RECORD_INVALID' });
  const empty = fixture(t);
  await assert.rejects(empty.store.remember(request(empty, { text: 'x'.repeat(16385) })), { code: 'PROJECT_KNOWLEDGE_INPUT_INVALID' });
  await assert.rejects(empty.store.remember(request(empty, { source: { messageId: 'not-feishu' } })), { code: 'PROJECT_KNOWLEDGE_SOURCE_INVALID' });
  assert.equal(fs.existsSync(empty.root), false);
});

test('the authorization callback sees a frozen snapshot and caller mutation cannot alter confirmed content', async t => {
  let release, seen;
  const f = fixture(t, { authorizeOwner: input => { seen = input;return new Promise(resolve => { release = resolve; }); } });
  const input = request(f), original = input.text, pending = f.store.remember(input);
  assert.ok(Object.isFrozen(seen));
  assert.ok(Object.isFrozen(seen.source));
  input.text = 'caller changed after authorization';input.scope.projectKey = 'other';
  release(true);
  const result = await pending;
  assert.equal(result.record.text, original);
  assert.equal(result.record.project, 'personal-automation-m1');
});

test('two authenticated writes to different keys retain both records', async t => {
  const f = fixture(t);
  await Promise.all([f.store.remember(request(f, { id: 'first' })), f.store.remember(request(f, { id: 'second' }))]);
  assert.deepEqual(f.store.query({ scope: f.scope, role: 'pm' }).map(x => x.id), ['first', 'second']);
});

test('successful confirmation durably creates its private directories and removes the write intent', async t => {
  const f = fixture(t), sync = fs.fsyncSync, observed = [];
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd);
    const lockExists = fs.existsSync(f.root) && fs.readdirSync(f.root).some(name => {
      const directory = path.join(f.root, name);
      return fs.lstatSync(directory).isDirectory() && fs.readdirSync(directory).some(file => file.endsWith('.lock'));
    });
    if (stat.isDirectory()) observed.push({ ino: stat.ino, lockExists });
    return sync(fd);
  });
  await f.store.remember(request(f));
  const file = partition(f.root, state => state.visibility === 'project'), scopeDir = path.dirname(file);
  assert.ok(observed.some(item => item.ino === fs.statSync(f.parent).ino), 'the new root directory entry must be fsynced');
  assert.ok(observed.some(item => item.ino === fs.statSync(f.root).ino), 'the new scoped directory entry must be fsynced');
  assert.ok(observed.some(item => item.ino === fs.statSync(scopeDir).ino && item.lockExists === false), 'the completed intent removal must be fsynced before acknowledging');
});

test('a failure after rename does not expose an unreconciled correction to future tasks', async t => {
  const f = fixture(t);await f.store.remember(request(f));
  const file = partition(f.root, state => state.visibility === 'project'), directory = fs.statSync(path.dirname(file)), sync = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd);
    if (stat.isDirectory() && stat.ino === directory.ino && JSON.parse(fs.readFileSync(file, 'utf8')).records.length === 2) {
      throw Object.assign(Error('directory sync fixture'), { code: 'EIO' });
    }
    return sync(fd);
  });
  const correction = request(f, { expectedVersion: 1, text: 'written but durability not acknowledged' });
  await assert.rejects(f.store.correct(correction), { code: 'PROJECT_KNOWLEDGE_COMMIT_UNKNOWN' });
  t.mock.restoreAll();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).records.length, 2);
  assert.throws(() => f.store.query({ scope: f.scope, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
  await assert.rejects(f.store.correct(correction), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
});

test('changing a display project key cannot create a blank second store for the same Native project identity', async t => {
  const f = fixture(t);await f.store.remember(request(f));
  const renamed = { ...f.scope, projectKey: 'renamed-project' };
  assert.throws(() => f.store.query({ scope: renamed, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_RECORD_INVALID' });
  await assert.rejects(f.store.remember(request(f, { scope: renamed })), { code: 'PROJECT_KNOWLEDGE_RECORD_INVALID' });
  assert.equal(f.store.query({ scope: f.scope, role: 'pm' }).length, 1);
});

test('asynchronous audit logging is rejected before authorizing a write and its rejection is contained', async t => {
  const f = fixture(t, { log: () => Promise.reject(Error('asynchronous audit fixture')) });
  await assert.rejects(f.store.remember(request(f)), { code: 'PROJECT_KNOWLEDGE_LOG_FAILED' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(f.root), false);
});

test('an asynchronous failure logger does not hide the original denial or leak an unhandled rejection', async t => {
  const f = fixture(t, { authorizeOwner: async () => false,
    log: event => event.code === 'PROJECT_KNOWLEDGE_WRITE_REQUESTED' ? undefined : Promise.reject(Error('secondary async audit fixture')) });
  await assert.rejects(f.store.remember(request(f)), error => error.code === 'PROJECT_KNOWLEDGE_OWNER_DENIED' && error.auditFailed === true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(f.root), false);
});

test('an asynchronous post-commit audit leaves the operation unknown and its private lock intact', async t => {
  const f = fixture(t, { log: event => event.code === 'PROJECT_KNOWLEDGE_WRITTEN' ? Promise.reject(Error('post-commit async audit fixture')) : undefined });
  await assert.rejects(f.store.remember(request(f)), { code: 'PROJECT_KNOWLEDGE_COMMIT_UNKNOWN' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(partitionFiles(f.root).length, 1);
  assert.throws(() => f.store.query({ scope: f.scope, role: 'pm' }), { code: 'PROJECT_KNOWLEDGE_LOCKED' });
});

test('a Chinese question ranks a matching confirmed decision ahead of more than one result window of unrelated records', async t => {
  const f = fixture(t);
  for (let i = 0; i < 35; i++) await f.store.remember(request(f, { id: 'a-record-' + String(i).padStart(2, '0'), text: '这是独立部署记录第' + i + '项' }));
  await f.store.remember(request(f, { id: 'owner-report-format', text: '报告格式：先结论，再给证据和未验证项。' }));
  const result = f.store.query({ scope: f.scope, role: 'pm', query: '报告格式是什么' });
  assert.equal(result[0].id, 'owner-report-format');
  assert.equal(result.length, 32);
});
