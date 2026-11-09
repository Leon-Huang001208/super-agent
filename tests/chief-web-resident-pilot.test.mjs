import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  RESIDENT_PROJECT, RESIDENT_OWNER_TRANSPORT, RESIDENT_TARGETS, validateChiefWebResidentBindings,
  validateChiefWebResidentManifest, createChiefWebResidentPilot, verifyChiefWebResidentFreshComments,
  chiefWebResidentChildEnvironment, claimChiefWebResidentLock,
} from '../scripts/chief-web-resident-pilot.mjs';

const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const manifestInput = () => ({
  schemaVersion: 2, sourceRoot: '/tmp/work', sourceSha: 'a'.repeat(40), imageId: 'sha256:' + 'b'.repeat(64),
  dependenciesRoot: '/tmp/deps', expiresAt: 900, ownerSessionFile: '/tmp/session',
  slots: [1, 2, 3].map(n => ({ conversationId: id(n), chiefAgentId: id(n + 10),
    scopeRoot: '/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0/logs/chief-web-real-rwb.fixture' + n })),
});
const manifest = validateChiefWebResidentManifest(manifestInput());
const expectedBindings = () => manifest.slots.map((slot, n) => ({
  conversationId: slot.conversationId, maxRevisions: 1, targetDoc: slot.targetDoc,
  expiresAt: manifest.expiresAt, userId: 'owner', companyId: id(8), chiefAgentId: slot.chiefAgentId, projectId: id(10),
  generation: n, intakeFrom: 20,
}));
const bindings = validateChiefWebResidentBindings(manifest, expectedBindings());
const ready = index => ({ phase: 'ready', generation: index, revision: 0, taskId: null });
function done(index) {
  const number = index + 1;
  const headSha = String(number).repeat(40);
  return { phase: 'done', generation: index, revision: 1, taskId: id(number + 10), inputRevision: 'b'.repeat(64),
    pr: { number, headSha, url: 'https://github.com/Leon-Huang001208/ResearchWorkbench/pull/' + number },
    ci: { number, headSha, conclusion: 'success', checksDigest: 'f'.repeat(64) } };
}

function fixture() {
  let state;
  let clock = 100;
  let refuseDrain = false;
  let activateFailure = false;
  let inactiveComment = null;
  const seen = [];
  const statuses = bindings.map((_binding, index) => ready(index));
  const slotIndex = slot => manifest.slots.indexOf(slot);
  const store = {
    read: () => state,
    write(value) { state = value; seen.push(['write', value.phase, value.index]); },
  };
  const host = {
    drain() {
      seen.push(['drain']);
      if (refuseDrain) throw Object.assign(Error('lease held'), { code: 'CHIEF_WEB_RESIDENT_LEASE_PRESENT' });
    },
    activate(slot, binding) {
      assert.equal(slot.targetDoc, binding.targetDoc);
      seen.push(['activate', slotIndex(slot)]);
      if (activateFailure) throw Error('ambiguous activation');
    },
    verifyActive(slot) { seen.push(['verify', slotIndex(slot)]); },
    verifyFreshComments(slot) {
      if (inactiveComment === slotIndex(slot)) throw Object.assign(Error('inactive comment'), { code: 'CHIEF_WEB_RESIDENT_INACTIVE_OWNER_COMMENT' });
    },
    status(slot) { seen.push(['status', slotIndex(slot)]); return statuses[slotIndex(slot)]; },
    start(slot) { seen.push(['start', slotIndex(slot)]); },
    stop() { seen.push(['stop']); },
    disable(slot) { seen.push(['disable', slotIndex(slot)]); },
  };
  return {
    get current() { return state; }, statuses, seen,
    make: () => createChiefWebResidentPilot({ manifest, bindings, store, host, now: () => clock }),
    setExpiry: () => { clock = manifest.expiresAt; },
    setLease: value => { refuseDrain = value; },
    activationFails: () => { activateFailure = true; },
    rejectFreshSlot: index => { inactiveComment = index; },
  };
}

test('private manifest fixes ordered documents and a single Native owner scope', () => {
  assert.deepEqual(manifest.slots.map(slot => slot.targetDoc), RESIDENT_TARGETS);
  const repeated = manifestInput();
  repeated.slots[1].scopeRoot = repeated.slots[0].scopeRoot;
  assert.throws(() => validateChiefWebResidentManifest(repeated), { code: 'CHIEF_WEB_RESIDENT_MANIFEST_INVALID' });
  const repeatedChief = manifestInput();
  repeatedChief.slots[1].chiefAgentId = repeatedChief.slots[0].chiefAgentId;
  assert.throws(() => validateChiefWebResidentManifest(repeatedChief), { code: 'CHIEF_WEB_RESIDENT_MANIFEST_INVALID' });
  const swapped = expectedBindings();
  [swapped[0].chiefAgentId, swapped[1].chiefAgentId] = [swapped[1].chiefAgentId, swapped[0].chiefAgentId];
  assert.throws(() => validateChiefWebResidentBindings(manifest, swapped), { code: 'CHIEF_WEB_RESIDENT_BINDING_INVALID' });
  const foreign = expectedBindings();
  foreign[2].userId = 'foreign';
  assert.throws(() => validateChiefWebResidentBindings(manifest, foreign), { code: 'CHIEF_WEB_RESIDENT_BINDING_INVALID' });
  foreign[2].userId = 'owner';
  foreign[2].maxRevisions = 2;
  assert.throws(() => validateChiefWebResidentBindings(manifest, foreign), { code: 'CHIEF_WEB_RESIDENT_BINDING_INVALID' });
});

test('moves to the next exact chat only after each positive Native receipt and drain', async () => {
  const env = fixture();
  const pilot = env.make();
  assert.equal((await pilot.step()).index, 0);
  env.statuses[0] = done(0);
  assert.equal((await pilot.step()).index, 1);
  env.statuses[1] = done(1);
  const idle = await pilot.step();
  assert.equal(idle.index, 2);
  assert.equal(idle.phase, 'active');
  assert.deepEqual(idle.completed.map(item => item.prNumber), [1, 2]);
  assert.deepEqual(env.seen.filter(([type]) => ['activate', 'stop', 'start', 'disable'].includes(type)), [
    ['activate', 0], ['start', 0], ['stop'], ['activate', 1], ['start', 1], ['stop'], ['activate', 2], ['start', 2],
  ]);
  env.statuses[2] = done(2);
  assert.equal((await pilot.step()).phase, 'complete');
  assert.deepEqual(env.seen.slice(-3), [['drain'], ['disable', 2], ['write', 'complete', 2]]);
});

test('blocked task stops the local child and preserves the same slot', async () => {
  const env = fixture();
  const pilot = env.make();
  await pilot.step();
  env.statuses[0] = { phase: 'blocked', generation: 0, revision: 1 };
  assert.equal((await pilot.step()).phase, 'blocked');
  await env.make().step();
  assert.equal(env.current.index, 0);
  assert.deepEqual(env.seen.filter(([type]) => ['activate', 'stop', 'disable'].includes(type)), [['activate', 0], ['stop']]);
});

test('old head, ambiguous activation and nonempty lease never switch the app', async () => {
  const oldHead = fixture();
  const pilot = oldHead.make();
  await pilot.step();
  oldHead.statuses[0] = done(0);
  oldHead.statuses[0].ci.headSha = 'a'.repeat(40);
  await assert.rejects(pilot.step(), { code: 'CHIEF_WEB_RESIDENT_TERMINAL_UNVERIFIED' });
  assert.equal(oldHead.current.phase, 'active');
  const ambiguous = fixture();
  ambiguous.activationFails();
  await assert.rejects(ambiguous.make().step(), /ambiguous activation/);
  await assert.rejects(ambiguous.make().step(), { code: 'CHIEF_WEB_RESIDENT_TRANSITION_UNKNOWN' });
  assert.equal(ambiguous.seen.filter(([event]) => event === 'activate').length, 1);
  const leased = fixture();
  leased.setLease(true);
  await assert.rejects(leased.make().step(), { code: 'CHIEF_WEB_RESIDENT_LEASE_PRESENT' });
  assert.deepEqual(leased.seen, [['drain']]);
});

test('restarts only the same observed active slot and expiry disables after a fresh drain', async () => {
  const env = fixture();
  const first = env.make();
  await first.step();
  await first.stop();
  const restored = env.make();
  await restored.step();
  assert.deepEqual(env.seen.slice(-4), [['verify', 0], ['status', 0], ['drain'], ['start', 0]]);
  env.setExpiry();
  assert.equal((await restored.step()).phase, 'expired');
  assert.deepEqual(env.seen.slice(-4), [['stop'], ['drain'], ['disable', 0], ['write', 'expired', 0]]);
});

test('inactive owner input blocks the next slot and stays blocked after restart', async () => {
  const env = fixture();
  const pilot = env.make();
  await pilot.step();
  env.statuses[0] = done(0);
  env.rejectFreshSlot(1);
  const blocked = await pilot.step();
  assert.deepEqual([blocked.phase, blocked.index, blocked.completed[0].prNumber], ['blocked', 1, 1]);
  assert.equal(blocked.code, 'CHIEF_WEB_RESIDENT_INACTIVE_OWNER_COMMENT');
  assert.deepEqual(await env.make().step(), blocked);
  assert.deepEqual(env.seen.filter(([type]) => type === 'activate'), [['activate', 0]]);
});

test('comment gate verifies exact conversation metadata and rejects a truncated list', () => {
  const binding = bindings[0];
  const old = { id: id(22), issueId: binding.conversationId, companyId: binding.companyId,
    authorUserId: binding.userId, deletedAt: null, createdAt: new Date(binding.intakeFrom).toISOString() };
  const recent = { ...old, createdAt: new Date(binding.intakeFrom + 1).toISOString() };
  verifyChiefWebResidentFreshComments([old, { ...recent, authorUserId: null }], binding);
  assert.throws(() => verifyChiefWebResidentFreshComments([recent], binding), { code: 'CHIEF_WEB_RESIDENT_INACTIVE_OWNER_COMMENT' });
  assert.throws(() => verifyChiefWebResidentFreshComments([{ ...recent, issueId: id(99) }], binding), { code: 'CHIEF_WEB_RESIDENT_COMMENTS_UNVERIFIED' });
  assert.throws(() => verifyChiefWebResidentFreshComments(Array(65).fill(old), binding), { code: 'CHIEF_WEB_RESIDENT_COMMENTS_UNVERIFIED' });
});

test('child receives only the fixed selected document and owner transport is numeric loopback', () => {
  for (const slot of manifest.slots) {
    const env = chiefWebResidentChildEnvironment(slot);
    assert.equal(env.SUPER_AGENT_CHIEF_WEB_REAL_BROKER_ENABLED, '1');
    assert.equal(env.SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT, slot.targetDoc);
  }
  assert.equal(RESIDENT_OWNER_TRANSPORT, 'http://127.0.0.1:8112');
});

test('project-wide lock refuses another manifest and preserves a replaced unknown owner', async t => {
  const parent = await fs.realpath(await fs.mkdtemp('/tmp/sa-resident-lock-'));
  t.after(() => fs.rm(parent, { recursive: true }));
  const release = await claimChiefWebResidentLock(parent);
  await assert.rejects(claimChiefWebResidentLock(parent), { code: 'CHIEF_WEB_RESIDENT_SUPERVISOR_OWNED' });
  const lock = path.join(parent, RESIDENT_PROJECT + '.supervisor.lock');
  await fs.rename(lock, path.join(parent, 'old-owner'));
  await fs.mkdir(lock, { mode: 0o700 });
  await assert.rejects(release({ drained: true }), { code: 'CHIEF_WEB_RESIDENT_SUPERVISOR_OWNED' });
  assert.equal((await fs.lstat(lock)).isDirectory(), true);
});
