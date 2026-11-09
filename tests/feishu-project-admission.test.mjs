import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRwbFeishuAdmission } from '../bridge/project-adapters/rwb/feishu-adapter.mjs';

const operation = '10000000-0000-4000-8000-000000000001';
const secondOperation = '10000000-0000-4000-8000-000000000002';
const supplementOperation = '10000000-0000-4000-8000-000000000003';
const fourthOperation = '10000000-0000-4000-8000-000000000004';
const task = '20000000-0000-4000-8000-000000000001';
const secondTask = '20000000-0000-4000-8000-000000000002';
const revision = 'a'.repeat(64);
const nextRevision = 'b'.repeat(64);
const contextRevision = 'd'.repeat(64);
const previousHead = 'c'.repeat(40);
const paths = ['docs/super-agent/feishu-verification.md'];
const codePaths = ['app/research_web/ui/progress.mjs', 'tests/javascript/research_web_progress.test.mjs'];
const checks = ['rwb-docs'];
const codeChecks = ['rwb-ui', 'node-test:tests/javascript/research_web_progress.test.mjs'];
const ownerOpenId = 'ou_owner123';
const chatId = 'oc_chat123';
const base = Object.freeze({ schemaVersion: 1, dispatchMode: 'off', effectiveAtUTCms: 0, githubMode: 'off',
  watchdogMode: 'observe', requireUpdateDecision: true, allowedTaskIds: ['existing'] });

function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'feishu-auto-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'feishu-project-rwb');
  const policyFile = path.join(directory, 'policy.json');
  const policy = { schemaVersion: 1, effectiveAt: 10, expiresAt: 30, scopes: [{ paths, checks },
    { paths: codePaths, checks: codeChecks }] };
  const contexts = new Map();
  let now = 20;
  const open = (readTaskContext = taskId => contexts.get(taskId)) =>
    createRwbFeishuAdmission({ root, now: () => now, readTaskContext });
  function enable() {
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(policyFile, JSON.stringify(policy), { mode: 0o600 });
  }
  return { open, enable, directory, policyFile, policy, setTime: value => { now = value; }, contexts };
}

function initial(operationId = operation, requestedPaths = paths) {
  return { operationId, chatId, ownerOpenId, request: { kind: 'new', title: 'RWB 验收',
    goal: '补充说明', paths: requestedPaths, pathsJson: JSON.stringify(requestedPaths) } };
}

function supplement(operationId = supplementOperation, text = '说明如何复核最新 CI') {
  return { operationId, chatId, ownerOpenId, request: { kind: 'supplement', taskId: task, text },
    previousContext: { taskId: task, revision: contextRevision, inputRevision: revision, status: 'done', finalized: true,
      pr: { headSha: previousHead } } };
}

test('an absent or inactive policy grants no execution', async t => {
  const { open, enable, setTime } = setup(t);
  const admission = open();
  assert.equal(admission.enabled(), false);
  assert.equal(admission.runtimeConfig(base), base);
  assert.equal(admission.lookup(task), null);
  await assert.rejects(admission.reserve(initial()), { code: 'FRA_POLICY_DISABLED' });
  enable();
  setTime(9);
  assert.equal(admission.enabled(), false);
  setTime(30);
  assert.equal(admission.enabled(), false);
  assert.equal(admission.runtimeConfig(base), base);
});

test('binding the exact Native receipt is required for controlled execution and is durable', async t => {
  const { open, enable, directory, setTime } = setup(t);
  enable();
  const admission = open();
  assert.throws(() => admission.runtimeConfig({ ...base, dispatchMode: 'enabled' }), { code: 'FRA_RUNTIME_NOT_OFF' });
  assert.deepEqual(admission.runtimeConfig(base), { ...base, dispatchMode: 'controlled', effectiveAtUTCms: 10, allowedTaskIds: [] });
  const reserved = await admission.reserve(initial());
  assert.equal(reserved.pathsJson, JSON.stringify(paths));
  assert.deepEqual(reserved.checks, checks);
  assert.equal(reserved.taskId, null);
  assert.equal(reserved.version, 1);
  assert.equal(admission.lookup(task), null);
  const bind = { operationId: operation, taskId: task, inputRevision: revision, pathsJson: reserved.pathsJson };
  assert.throws(() => admission.bind({ ...bind, pathsJson: JSON.stringify(codePaths) }), { code: 'FRA_BINDING_CONFLICT' });
  const record = admission.bind(bind);
  assert.equal(record.taskId, task);
  assert.deepEqual(open().bind(bind), record);
  assert.deepEqual(open().runtimeConfig(base).allowedTaskIds, [task]);
  assert.deepEqual(await open().reserve(initial()), record);
  assert.deepEqual(open().lookup(task), record);
  const stored = readFileSync(path.join(directory, 'admission.json'), 'utf8');
  assert.ok(!stored.includes('补充说明'));
  assert.ok(!stored.includes('RWB 验收'));
  await assert.rejects(admission.reserve({ ...initial(), chatId: 'different' }), { code: 'FRA_OPERATION_CONFLICT' });
  assert.throws(() => admission.bind({ ...bind, inputRevision: nextRevision }), { code: 'FRA_BINDING_CONFLICT' });
  setTime(30);
  assert.deepEqual(await open().reserve(initial()), record);
  assert.deepEqual(open().lookup(task), record);
  assert.equal(open().runtimeConfig(base), base);
});

test('an expired window can bind a reserved Native receipt but cannot authorize execution', async t => {
  const { open, enable, setTime } = setup(t);
  enable();
  const admission = open();
  const reserved = await admission.reserve(initial());
  setTime(30);
  const bind = { operationId: operation, taskId: task, inputRevision: revision, pathsJson: reserved.pathsJson };
  const bound = open().bind(bind);
  assert.deepEqual(open().bind(bind), bound);
  assert.deepEqual(await open().reserve(initial()), bound);
  assert.equal(open().runtimeConfig(base), base);
  await assert.rejects(open().reserve(initial(secondOperation, codePaths)), { code: 'FRA_POLICY_DISABLED' });
});

test('a sibling scope waits for its predecessor and concurrent reservations do not both consume a slot', async t => {
  const { open, enable, contexts } = setup(t);
  enable();
  const admission = open();
  const together = await Promise.allSettled([admission.reserve(initial()), admission.reserve(initial(secondOperation, codePaths))]);
  assert.equal(together[0].status, 'fulfilled');
  assert.equal(together[1].status, 'rejected');
  assert.equal(together[1].reason.code, 'FRA_BUSY');
  admission.bind({ operationId: operation, taskId: task, inputRevision: revision, pathsJson: JSON.stringify(paths) });
  contexts.set(task, { taskId: task, inputRevision: revision, status: 'in_progress' });
  await assert.rejects(admission.reserve(initial(secondOperation, codePaths)), { code: 'FRA_BUSY' });
  contexts.set(task, { taskId: task, inputRevision: nextRevision, status: 'done', finalized: true });
  await assert.rejects(admission.reserve(initial(secondOperation, codePaths)), { code: 'FRA_BUSY' });
  contexts.set(task, { taskId: task, inputRevision: revision, status: 'done' });
  await assert.rejects(admission.reserve(initial(secondOperation, codePaths)), { code: 'FRA_BUSY' });
  contexts.set(task, { taskId: task, inputRevision: revision, status: 'done', finalized: true });
  assert.deepEqual((await admission.reserve(initial(secondOperation, codePaths))).checks, codeChecks);
  admission.bind({ operationId: secondOperation, taskId: secondTask, inputRevision: revision, pathsJson: JSON.stringify(codePaths) });
  assert.deepEqual(admission.runtimeConfig(base).allowedTaskIds, [task, secondTask]);
  await assert.rejects(admission.reserve(initial(fourthOperation)), { code: 'FRA_SCOPE_ALREADY_RESERVED' });
  await assert.rejects(admission.reserve(initial(fourthOperation, ['docs/super-agent/other.md'])), { code: 'FRA_SCOPE_NOT_APPROVED' });
});

test('one supplement preserves the same owner, chat, task, original paths and old PR head', async t => {
  const { open, enable } = setup(t);
  enable();
  const admission = open();
  await admission.reserve(initial());
  admission.bind({ operationId: operation, taskId: task, inputRevision: revision, pathsJson: JSON.stringify(paths) });
  await assert.rejects(admission.reserve({ ...supplement(), ownerOpenId: 'ou_someoneelse' }), { code: 'FRA_SUPPLEMENT_OWNER_DENIED' });
  await assert.rejects(admission.reserve({ ...supplement(), chatId: 'oc_different' }), { code: 'FRA_SUPPLEMENT_OWNER_DENIED' });
  await assert.rejects(admission.reserve({ ...supplement(), previousContext: { ...supplement().previousContext, inputRevision: nextRevision } }),
    { code: 'FRA_SUPPLEMENT_CONTEXT_CHANGED' });
  await assert.rejects(admission.reserve({ ...supplement(), previousContext: { ...supplement().previousContext, finalized: false } }),
    { code: 'FRA_SUPPLEMENT_CONTEXT_CHANGED' });
  await assert.rejects(admission.reserve(supplement(supplementOperation, '修改 docs/super-agent/outside.md')), { code: 'FRA_SUPPLEMENT_SCOPE_DENIED' });
  const reserved = await admission.reserve(supplement());
  assert.equal(reserved.version, 2);
  assert.equal(reserved.previousRevision, contextRevision);
  assert.equal(reserved.previousHead, previousHead);
  assert.equal(reserved.previousInputRevision, revision);
  assert.equal(reserved.pathsJson, JSON.stringify(paths));
  assert.equal(reserved.inputRevision, null);
  assert.equal(admission.lookup(task).inputRevision, revision);
  assert.throws(() => admission.bind({ ...reserved, inputRevision: revision }), { code: 'FRA_BINDING_CONFLICT' });
  assert.throws(() => admission.bind({ ...reserved, taskId: secondTask, inputRevision: nextRevision }), { code: 'FRA_BINDING_CONFLICT' });
  const bound = open().bind({ ...reserved, inputRevision: nextRevision });
  assert.deepEqual(open().lookup(task), bound);
  const replay = await open().reserve({ ...supplement(), previousContext: null });
  assert.deepEqual(replay, bound);
  assert.equal(replay.previousRevision, contextRevision);
  assert.deepEqual(open().runtimeConfig(base).allowedTaskIds, [task]);
  await assert.rejects(open().reserve(supplement(fourthOperation)), { code: 'FRA_SUPPLEMENT_ALREADY_RESERVED' });
});

test('policy changes and unsafe private files fail closed', async t => {
  const { open, enable, policy, policyFile, directory } = setup(t);
  enable();
  const admission = open();
  await admission.reserve(initial());
  writeFileSync(policyFile, JSON.stringify({ ...policy, expiresAt: 31 }));
  assert.throws(() => admission.runtimeConfig(base), { code: 'FRA_POLICY_CHANGED' });
  assert.throws(() => admission.deadline(), { code: 'FRA_POLICY_CHANGED' });
  const state = path.join(directory, 'admission.json');
  const backup = path.join(directory, 'unexpected-link-target.json');
  writeFileSync(backup, readFileSync(state), { mode: 0o600 });
  rmSync(state);
  symlinkSync(backup, state);
  assert.throws(() => open().lookup(task), { code: 'FRA_STATE_INVALID' });
});
