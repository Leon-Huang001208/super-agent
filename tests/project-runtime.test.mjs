import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyProjectRuntime, resolveProjectPrStatus } from '../scripts/project-runtime.mjs';
import { buildHarness, writeHarness, appendHarnessEvent } from '../scripts/vendor/leon-engineering/harness-project.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(repositoryRoot, 'scripts/project-runtime.mjs');
const identity = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Runtime fixture', GIT_AUTHOR_EMAIL: 'runtime@example.invalid',
  GIT_COMMITTER_NAME: 'Runtime fixture', GIT_COMMITTER_EMAIL: 'runtime@example.invalid'
};

function temporary(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sa-project-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function invoke(entrypoint, root, ...args) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: root, encoding: 'utf8', env: { ...identity, SUPER_AGENT_LOG_ROOT: path.join(root, 'wrapper-logs') }
  });
}

test('the checked-in runtime verifies and every documented command resolves with no user installation', t => {
  assert.equal(verifyProjectRuntime().fileCount, 10);
  const root = temporary(t);
  const verified = invoke(entry, root, 'verify');
  assert.equal(verified.status, 0, verified.stderr);
  for (const action of ['session', 'delivery', 'record', 'run', 'enforce', 'storage']) {
    const checked = invoke(entry, root, action, '--help');
    assert.equal(checked.status, 0, `${action}: ${checked.stderr}`);
  }
  const lifecycle = invoke(entry, root, 'lifecycle', 'status', '--store', path.join(root, 'resources'));
  assert.equal(lifecycle.status, 0, lifecycle.stderr);
});

test('a modified pinned module is rejected before the session can create state', t => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(entry, path.join(root, 'scripts/project-runtime.mjs'));
  fs.cpSync(path.join(repositoryRoot, 'scripts/vendor'), path.join(root, 'scripts/vendor'), { recursive: true });
  fs.appendFileSync(path.join(root, 'scripts/vendor/leon-engineering/harness-session.mjs'), '\n// changed\n');
  const checked = invoke(path.join(root, 'scripts/project-runtime.mjs'), root, 'session', '--start', '--project', root,
    '--host', 'codex', '--session-id', 'tampered', '--task-id', 'tampered');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /PROJECT_RUNTIME_CHECKSUM_MISMATCH/);
  assert.equal(fs.existsSync(path.join(root, '.ai')), false);
});

test('legacy Harness session resumes the same task and preserves its original record', t => {
  const root = temporary(t);
  const taskId = 'old-task';
  const harness = buildHarness({ projectRoot: root, task: { id: taskId, goal: 'legacy task', acceptanceCriteria: ['same task'] } });
  writeHarness({ projectRoot: root, harness });
  appendHarnessEvent({ projectRoot: root, taskId, event: { event: 'task_started', host: 'codex' } });
  const sessionId = 'legacy-session';
  const legacyKey = crypto.createHash('sha256').update(sessionId).digest('hex');
  const sessionRoot = path.join(root, '.ai/harness/sessions');
  fs.mkdirSync(sessionRoot);
  const legacyFile = path.join(sessionRoot, `${legacyKey}.json`);
  const original = JSON.stringify({ schemaVersion: 1, sessionKey: legacyKey, host: 'codex', taskId });
  fs.writeFileSync(legacyFile, original);
  const checked = invoke(entry, root, 'session', '--start', '--project', root, '--host', 'codex', '--session-id', sessionId,
    '--task-id', 'a-new-task', '--goal', 'ignored on resume', '--acceptance', 'same task');
  assert.equal(checked.status, 0, checked.stderr);
  assert.deepEqual(JSON.parse(checked.stdout).session, { taskId, resumed: true, host: 'codex' });
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), original);
});

test('the preferred sibling resource engine cannot escape the pinned file set', t => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(entry, path.join(root, 'scripts/project-runtime.mjs'));
  fs.cpSync(path.join(repositoryRoot, 'scripts/vendor'), path.join(root, 'scripts/vendor'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts/vendor/lib/resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/vendor/lib/resources/lifecycle.mjs'), 'throw new Error("unverified");\n');
  const checked = invoke(path.join(root, 'scripts/project-runtime.mjs'), root, 'verify');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /PROJECT_RUNTIME_UNVERIFIED_RESOURCE_ENGINE/);
});

const prUrl = 'https://github.com/Leon-Huang001208/super-agent/pull/16';
const prIdentity = { url: prUrl, headRefOid: 'b'.repeat(40), baseRefName: 'main' };
const passingChecks = [{ __typename: 'CheckRun', name: 'governance', conclusion: 'SUCCESS' },
  { __typename: 'CheckRun', name: 'offline-regression', conclusion: 'SUCCESS' },
  { __typename: 'StatusContext', context: 'independent-review', state: 'SUCCESS' }];

function prStatus(response, invocation = {}) {
  const checks = response.statusCheckRollup;
  const result = resolveProjectPrStatus({ repositoryRoot: '/fixture' }, {
    remoteUrl: 'https://github.com/Leon-Huang001208/super-agent.git',
    pullRequest: { url: prUrl }, integrationCommit: prIdentity.headRefOid, defaultBranch: prIdentity.baseRefName
  }, (command, args, options) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args.slice(0, 2), ['pr', 'view']);
    assert.equal(options.cwd, '/fixture');
    return { status: 0, stdout: JSON.stringify({ ...prIdentity, mergeCommit: { oid: 'a'.repeat(40) }, ...response }), ...invocation };
  });
  assert.deepEqual(result.runs, checks || []);
  return result;
}

test('merged CheckRun and StatusContext successes retain raw checks and merge SHA', () => {
  const result = prStatus({ state: 'MERGED', statusCheckRollup: passingChecks });
  assert.equal(result.status, 'passed');
  assert.equal(result.mergeCommit, 'a'.repeat(40));
});

test('open PR, pending and unknown checks keep delivery pending', () => {
  for (const response of [
    { state: 'OPEN', statusCheckRollup: passingChecks },
    { state: 'MERGED', statusCheckRollup: [...passingChecks, { state: 'PENDING' }] },
    { state: 'MERGED', statusCheckRollup: [...passingChecks, { conclusion: null, status: 'IN_PROGRESS' }] },
    { state: 'MERGED', statusCheckRollup: [...passingChecks, { state: 'UNKNOWN' }] },
    { state: 'MERGED', statusCheckRollup: passingChecks.slice(0, 2) },
    { state: 'MERGED', statusCheckRollup: passingChecks, mergeCommit: null },
    { state: 'MERGED', statusCheckRollup: passingChecks, headRefOid: null },
    { state: 'MERGED', statusCheckRollup: [] },
    { state: 'MERGED' }
  ]) assert.equal(prStatus(response).status, 'pending');
});

test('a mismatched PR, candidate SHA or base is refused', () => {
  for (const mismatch of [{ url: `${prUrl}0` }, { headRefOid: 'c'.repeat(40) }, { baseRefName: 'other' }]) {
    assert.throws(() => prStatus({ state: 'MERGED', statusCheckRollup: passingChecks, ...mismatch }),
      /PROJECT_RUNTIME_PR_IDENTITY_MISMATCH/);
  }
});

test('failed checks and error status contexts fail while query errors propagate', () => {
  for (const check of [{ conclusion: 'FAILURE' }, { conclusion: 'TIMED_OUT' }, { state: 'ERROR' }]) {
    assert.equal(prStatus({ state: 'MERGED', statusCheckRollup: [check] }).status, 'failed');
  }
  assert.throws(() => prStatus({}, { status: 1, stderr: 'private error detail' }), /PROJECT_RUNTIME_CI_QUERY_FAILED/);
  assert.throws(() => prStatus({}, { stdout: 'invalid JSON' }), /PROJECT_RUNTIME_CI_RESPONSE_INVALID/);
});
