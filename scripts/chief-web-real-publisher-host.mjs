import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { REAL_RWB_DOCUMENT } from '../bridge/chief-web-real-engine.mjs';
import { loadChiefWebRecoveryRwbTool } from '../bridge/chief-web-recovery-rwb-host.mjs';
import { createChiefWebRealPublisher } from '../bridge/chief-web-real-publisher.mjs';
import { createChiefWebRealRwbWorkspace } from './chief-web-real-publisher-workspace.mjs';
import { createChiefWebRealGitHub } from './chief-web-real-publisher-github.mjs';

const fail = code => { throw Object.assign(new Error('RWB_REAL_' + code), { code: 'RWB_REAL_' + code }); };
const isAbsolute = value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value;
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const match = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);

async function loadController(filename, expected) {
  if (!isAbsolute(filename) || !digest.test(expected ?? '') || fs.realpathSync(filename) !== filename) fail('CONTROLLER_UNVERIFIED');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || (info.mode & 0o022) || info.size > 256 * 1024 ||
        createHash('sha256').update(fs.readFileSync(fd)).digest('hex') !== expected) fail('CONTROLLER_UNVERIFIED');
  } finally { fs.closeSync(fd); }
  const controller = await import(pathToFileURL(filename).href);
  if (!['readDeliveryReceipt', 'startDelivery', 'prepareDelivery', 'publishDelivery'].every(name => typeof controller[name] === 'function')) {
    fail('CONTROLLER_UNVERIFIED');
  }
  return controller;
}

function createHostChecks({ projectRoot, resourceSource, pythonBinary, nodeBinary, verifyResourceSource, run = spawnSync }) {
  if (![projectRoot, resourceSource, pythonBinary, nodeBinary].every(isAbsolute) || typeof verifyResourceSource !== 'function') {
    fail('HOST_CHECK_CONFIGURATION_INVALID');
  }
  function runChecked(binary, args, cwd, override = {}) {
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...override };
    if (!Object.hasOwn(override, 'PYTHONPATH')) delete env.PYTHONPATH;
    delete env.NODE_OPTIONS;
    const result = run(binary, args, { cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 512 * 1024 });
    if (result?.error || result?.signal || result?.status !== 0) fail('HOST_CHECK_FAILED');
    return result.stdout;
  }
  return Object.freeze({
    recordResources(input) {
      if (!match(input, { projectRoot, phase: 'record' }) || !/^super-agent-[a-f0-9-]{36}$/.test(input?.taskId ?? '') ||
          verifyResourceSource(resourceSource) !== true) fail('RESOURCE_SCOPE_DENIED');
      const output = runChecked(pythonBinary, ['-P', '-m', 'research_workbench_entrypoint.iteration_resources',
        '--project', projectRoot, '--task-id', input.taskId, '--phase', 'record'], projectRoot, { PYTHONPATH: resourceSource });
      let result;
      try { result = JSON.parse(output); } catch { fail('RESOURCE_RECORD_UNPROVEN'); }
      if (result.ok !== true || !isAbsolute(result.state) ||
          !result.state.endsWith('/leon-engineering/resource-closeout/' + input.taskId) ||
          !Number.isSafeInteger(result.registeredDirectories) || result.registeredDirectories < 0) fail('RESOURCE_RECORD_UNPROVEN');
      return { ...input, verified: true };
    },
    verifyCandidate({ worktree, candidateSha, changedPaths }) {
      if (!isAbsolute(worktree) || !sha.test(candidateSha ?? '') || changedPaths?.length !== 1 || changedPaths[0] !== REAL_RWB_DOCUMENT) {
        fail('CANDIDATE_CHECK_SCOPE_DENIED');
      }
      const checks = [];
      const started = Date.now();
      const steps = [
        ['documentation-governance', nodeBinary, ['scripts/check_documentation_governance.mjs', '--project', worktree]],
        ['project-constraints', nodeBinary, ['.agents/project-constraints.mjs', '--project', worktree, '--changed-file', REAL_RWB_DOCUMENT]],
        ['python-file-index', pythonBinary, ['-P', 'scripts/generate_py_file_index.py', '--check']],
      ];
      for (const [name, binary, args] of steps) {
        const begin = Date.now();
        runChecked(binary, args, worktree);
        checks.push({ name, exitCode: 0, durationMs: Math.max(0, Date.now() - begin) });
      }
      return { candidateSha, status: 'passed', command: 'RWB documentation governance, project constraints and Python file index',
        durationSeconds: Math.max(0, Math.ceil((Date.now() - started) / 1000)), checks };
    },
  });
}

/**
 * Mac-side ports for the existing broker. Its spool pause lock stays held across
 * this call. The deployment authority supplies a verified per-branch writer
 * fence and must keep it held until work settles.
 */
export async function loadChiefWebRealRwbHost({ toolRoot, controllerPath, controllerSha256, projectRoot, worktreeRoot,
  resourceSource, ghBinary, pythonBinary, nodeBinary, verifyResourceSource, workspaceJournal, publicationJournal,
  assertWorkspaceLease, readReview, withExclusiveBranch, verifyPush, log, now = Date.now } = {}) {
  if (process.platform !== 'darwin' || ![projectRoot, worktreeRoot, resourceSource].every(value => isAbsolute(value) &&
      fs.realpathSync(value) === value) || ![withExclusiveBranch, verifyPush, assertWorkspaceLease, readReview, log, now]
      .every(fn => typeof fn === 'function')) fail('HOST_CONFIGURATION_INVALID');
  const [runDelivery, controller] = await Promise.all([
    loadChiefWebRecoveryRwbTool({ toolRoot }), loadController(controllerPath, controllerSha256),
  ]);
  const github = createChiefWebRealGitHub({ ghBinary, projectRoot });
  const checks = createHostChecks({ projectRoot, resourceSource, pythonBinary, nodeBinary, verifyResourceSource });
  const workspace = createChiefWebRealRwbWorkspace({ projectRoot, worktreeRoot, gitBinary: '/usr/bin/git', controller,
    runDelivery, github, journal: workspaceJournal, ...checks, assertWorkspaceLease, readReview, log });
  const publisher = createChiefWebRealPublisher({ projectRoot, worktreeRoot, runDelivery, controller, github,
    recordResources: checks.recordResources, readPrepared: workspace.readPrepared, journal: publicationJournal, verifyPush, log, now,
    withPublicationFence(scope, work, lease) {
      if (!match(lease, { taskId: scope.taskId, inputRevision: scope.inputRevision }) || !digest.test(lease.nonce ?? '')) fail('PUBLICATION_LEASE_DENIED');
      return withExclusiveBranch(scope, lease, readAuthority => {
        if (typeof readAuthority !== 'function') fail('FENCE_DENIED');
        return work(() => {
          const authority = readAuthority();
          if (!match(authority, { verified: true, exclusive: true, drained: true, pauseFenceClear: true,
            scopeDigest: scope.scopeDigest, leaseNonce: lease.nonce, expectedRemoteHead: scope.previousHead,
            allowedCandidateSha: scope.candidateSha })) fail('FENCE_DENIED');
          return { ...scope, verified: true, exclusive: true, drained: true, pauseFenceClear: true };
        });
      });
    },
  });
  return Object.freeze({ workspace, publisher });
}
