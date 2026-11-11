import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readDeliveryReceipt, startDelivery, prepareDelivery, publishDelivery, refreshDeliveryStatus, cleanupDelivery } from '../../scripts/vendor/leon-engineering/iteration-delivery.mjs';

const identity = { ...process.env,
  GIT_AUTHOR_NAME: 'Runtime fixture', GIT_AUTHOR_EMAIL: 'runtime@example.invalid',
  GIT_COMMITTER_NAME: 'Runtime fixture', GIT_COMMITTER_EMAIL: 'runtime@example.invalid' };

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: identity });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sa-project-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const project = path.join(root, 'project');
  fs.mkdirSync(remote); fs.mkdirSync(project);
  git(remote, 'init', '--bare', '--initial-branch=main');
  git(project, 'init', '--initial-branch=main');
  git(project, 'config', 'user.name', 'Runtime fixture');
  git(project, 'config', 'user.email', 'runtime@example.invalid');
  fs.writeFileSync(path.join(project, 'README.md'), 'fixture\n');
  git(project, 'add', '.'); git(project, 'commit', '-m', 'baseline');
  git(project, 'remote', 'add', 'origin', remote);
  git(project, 'push', '-u', 'origin', 'main');
  git(project, 'remote', 'set-head', 'origin', 'main');
  const started = startDelivery({ projectRoot: project, taskId: 'legacy-delivery', slug: 'runtime', worktreeRoot: path.join(root, 'features') });
  fs.writeFileSync(path.join(started.featureWorktree, 'feature.txt'), 'change\n');
  git(started.featureWorktree, 'add', '.'); git(started.featureWorktree, 'commit', '-m', 'feature');
  const receipt = prepareDelivery({ projectRoot: project, taskId: started.taskId, integrationWorktreeRoot: path.join(root, 'integration') });
  return { project, receipt };
}

test('legacy prepared receipt survives reads and stale remote candidate is refused', t => {
  const { project, receipt } = fixture(t);
  const filename = path.join(project, '.git/leon-engineering/deliveries/legacy-delivery.json');
  const original = fs.readFileSync(filename);
  assert.equal(readDeliveryReceipt({ projectRoot: project, taskId: receipt.taskId }).integrationCommit, receipt.integrationCommit);
  assert.deepEqual(fs.readFileSync(filename), original);
  fs.writeFileSync(path.join(project, 'advance.txt'), 'other task\n');
  git(project, 'add', '.'); git(project, 'commit', '-m', 'remote advance'); git(project, 'push', 'origin', 'main');
  assert.throws(() => publishDelivery({ projectRoot: project, taskId: receipt.taskId,
    verification: { command: 'fixture checks', status: 'passed', durationSeconds: 1 } }), /remote default branch moved/);
  assert.equal(readDeliveryReceipt({ projectRoot: project, taskId: receipt.taskId }).status, 'remote_moved');
});

test('failed CI prevents cleanup and resource blocker preserves both worktrees', t => {
  const { project, receipt } = fixture(t);
  publishDelivery({ projectRoot: project, taskId: receipt.taskId,
    verification: { command: 'fixture checks', status: 'passed', durationSeconds: 1 } });
  refreshDeliveryStatus({ projectRoot: project, taskId: receipt.taskId, resolveCiStatus: () => ({ status: 'failed', runs: [] }) });
  assert.throws(() => cleanupDelivery({ projectRoot: project, taskId: receipt.taskId }), /CI|cleanable/);
  refreshDeliveryStatus({ projectRoot: project, taskId: receipt.taskId, resolveCiStatus: () => ({ status: 'passed', runs: [] }) });
  const blocked = cleanupDelivery({ projectRoot: project, taskId: receipt.taskId,
    resourceCleaner: () => ({ status: 'blocked', code: 'RESOURCE_BUSY' }) });
  assert.equal(blocked.resourceCleanup.code, 'RESOURCE_BUSY');
  assert.notEqual(blocked.status, 'cleaned');
  assert.equal(fs.existsSync(receipt.featureWorktree), true);
  assert.equal(fs.existsSync(receipt.integrationWorktree), true);
});
