import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createChiefWebRealSpool } from '../bridge/chief-web-real-spool.mjs';
import { REAL_RWB_REPOSITORY, realDigest } from '../bridge/chief-web-real-engine.mjs';
import { createChiefWebRealBroker } from './chief-web-real-broker.mjs';
import { createChiefWebRealAdmission } from './chief-web-real-admission.mjs';
import { createChiefWebRealDockerExecutor } from './chief-web-real-executor-host.mjs';
import { loadChiefWebRealRwbHost } from './chief-web-real-publisher-host.mjs';
import { createChiefWebRealGitHub } from './chief-web-real-publisher-github.mjs';
import { createHostStorageReceipt } from './host-storage.mjs';

const mount = '/Volumes/SuperAgentDockerData';
const legacy = mount + '/paperclip-v2026.1023.0/state';
const git = '/usr/bin/git';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (value, fields) => Object.entries(fields).every(([key, expected]) => value?.[key] === expected);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hex = /^[a-f0-9]{64}$/;

function safeDirectory(filename) {
  if (!path.isAbsolute(filename) || fs.realpathSync(filename) !== filename) fail('CHIEF_WEB_REAL_OPERATOR_PATH_DENIED');
  const stat = fs.lstatSync(filename);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    fail('CHIEF_WEB_REAL_OPERATOR_PATH_DENIED');
  }
}

function readPrivate(filename) {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 ||
        stat.nlink !== 1 || stat.size > 160_000 || fs.realpathSync(filename) !== filename) fail('CHIEF_WEB_REAL_OPERATOR_PATH_DENIED');
    return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } finally { fs.closeSync(descriptor); }
}

function readOptional(filename) {
  try { return readPrivate(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function record(filename, value) {
  const directory = path.dirname(filename);
  safeDirectory(directory);
  const temporary = path.join(directory, '.write-' + randomUUID());
  const handle = fs.openSync(temporary, 'wx', 0o600);
  try {
    try { fs.writeFileSync(handle, JSON.stringify(value) + '\n'); fs.fsyncSync(handle); }
    finally { fs.closeSync(handle); }
    fs.linkSync(temporary, filename);
    fs.unlinkSync(temporary);
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function treeDigest(directory) {
  const files = [];
  function scan(root) {
    for (const name of fs.readdirSync(root).sort()) {
      const filename = path.join(root, name);
      const info = fs.lstatSync(filename);
      if (info.isDirectory()) scan(filename);
      else {
        if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() ||
            (info.mode & 0o022) || info.size > 2_000_000) fail('CHIEF_WEB_REAL_RESOURCE_SOURCE_DENIED');
        files.push([path.relative(directory, filename), digest(fs.readFileSync(filename))]);
        if (files.length > 1000) fail('CHIEF_WEB_REAL_RESOURCE_SOURCE_DENIED');
      }
    }
  }
  scan(directory);
  return digest(JSON.stringify(files));
}

function pinnedStorage() {
  const plist = execFileSync('/usr/sbin/diskutil', ['info', '-plist', mount], { timeout: 10000, maxBuffer: 65536 });
  const externalFilesystem = execFileSync('/usr/bin/plutil', ['-extract', 'FilesystemType', 'raw', '-o', '-', '-'],
    { input: plist, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 }).trim();
  const dfPk = execFileSync('/bin/df', ['-Pk', '/', mount], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  return createHostStorageReceipt({ hostPlatform: process.platform, externalFilesystem, dfPk, capturedAt: new Date().toISOString() });
}

export { treeDigest };

export async function runChiefWebRealBroker(filename, recoverOperationId) {
  const root = path.dirname(filename);
  safeDirectory(root);
  if (process.platform !== 'darwin' || !root.startsWith(mount + '/paperclip-v2026.1023.0/logs/chief-web-real-rwb.') ||
      !['host-scope.json', 'host-scope-recovery.json'].includes(path.basename(filename))) fail('CHIEF_WEB_REAL_OPERATOR_PATH_DENIED');
  const options = readPrivate(filename);
  const config = readPrivate(path.join(root, 'binding.json'));
  if (!uuid.test(config.conversationId ?? '') || !uuid.test(options.credentialGrantId ?? '') ||
      !hex.test(options.resourceSourceDigest ?? '') || !hex.test(options.controllerSha256 ?? '')) fail('CHIEF_WEB_REAL_OPERATOR_SCOPE_DENIED');
  const journalRoot = path.join(root, 'broker-journal');
  safeDirectory(journalRoot);
  const log = event => {
    const fields = Object.fromEntries(['code', 'operationId', 'taskId', 'role', 'status', 'slotId']
      .filter(key => typeof event[key] === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(event[key]))
      .map(key => [key, event[key]]));
    fs.appendFileSync(path.join(root, 'broker.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...fields }) + '\n', { mode: 0o600 });
  };
  const spool = await createChiefWebRealSpool({ root: path.join(root, 'broker'), config, log });
  const databasePath = legacy + '/control/admission.sqlite';
  function journalFile(kind, id, field = '') {
    if (!uuid.test(id ?? '') || !/^[a-z0-9-]{0,90}$/.test(field)) fail('CHIEF_WEB_REAL_OPERATOR_SCOPE_DENIED');
    return path.join(journalRoot, [kind, id, field].filter(Boolean).join('-') + '.json');
  }
  function readLease(id) {
    const lease = readOptional(journalFile('lease', id));
    const released = readOptional(journalFile('released', id));
    if (released && (!lease || !same(released, lease))) fail('CHIEF_WEB_REAL_SHARED_LEASE_UNKNOWN');
    return lease && { ...lease, released: Boolean(released) };
  }
  function legacyDrained() {
    const runtime = readPrivate(legacy + '/integration-v1/runtime.json');
    const health = readPrivate(legacy + '/integration-v1/broker/health.json');
    const age = Date.now() - Date.parse(health.capturedAt);
    if (!same(runtime, { dispatchMode: 'off', githubMode: 'off' }) ||
        !same(health, { status: 'ready', activeTask: null, activeWindow: null }) ||
        !Number.isFinite(age) || age < 0 || age >= 45000 || fs.existsSync(legacy + '/control/active-lease.json')) return false;
    const stdout = execFileSync(options.dockerBinary, ['exec', 'super-agent-paperclip-eval-db-1', 'psql', '-X', '-At', '-U', 'paperclip',
      '-d', 'paperclip', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT count(*) FROM heartbeat_runs WHERE status IN ('queued','running');"],
    { encoding: 'utf8', timeout: 12000, maxBuffer: 65536 }).trim();
    return stdout === '0';
  }
  function exactLease(lease) {
    if (!lease || fs.realpathSync(databasePath) !== databasePath || !uuid.test(lease.taskId ?? '') ||
        lease.projectId !== config.projectId || !hex.test(lease.nonce ?? '')) return false;
    const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
    try {
      return Boolean(db.prepare('SELECT 1 AS ok FROM admission_lease a JOIN admission_meter m ON a.task_id=m.task_id WHERE a.slot=1 AND a.task_id=? AND a.nonce=? AND m.project_id=?')
        .get(lease.taskId, lease.nonce, lease.projectId)?.ok);
    } finally { db.close(); }
  }
  async function assertWorkspaceLease(request) {
    const lease = readLease(request.operationId ?? request.slotId);
    if (!same(lease, { taskId: request.taskId, inputRevision: request.inputRevision, released: false }) ||
        !exactLease(lease) || !legacyDrained() || await spool.isPaused() ||
        Date.now() >= config.expiresAt) fail('CHIEF_WEB_REAL_WORKSPACE_LEASE_DENIED');
  }
  const admission = createChiefWebRealAdmission({
    databasePath, projectId: config.projectId, verifyLegacyDrained: legacyDrained, storageReceipt: pinnedStorage, log,
    journal: {
      read: readLease,
      create: (id, lease) => record(journalFile('lease', id), lease),
      readIntent: id => readOptional(journalFile('lease-intent', id)),
      markIntent: (id, value) => record(journalFile('lease-intent', id), value),
      readReleaseIntent: id => readOptional(journalFile('release-intent', id)),
      markReleaseIntent: (id, { released, ...lease }) => record(journalFile('release-intent', id), lease),
      markReleased: (id, { released, ...lease }) => record(journalFile('released', id), lease),
    },
  });
  async function readReview(request) {
    const candidates = [];
    for (const id of await spool.list()) {
      const envelope = await spool.readRequest(id);
      if (same(envelope?.request, { role: 'reviewer', taskId: request.taskId,
        inputRevision: request.inputRevision, candidateSha: request.candidateSha })) {
        const receipt = await spool.observe(id);
        if (receipt?.status === 'completed' && hex.test(receipt.evidenceDigest ?? '') &&
            same(receipt.result, { approved: true, candidateSha: request.candidateSha, reviewDigest: request.reviewDigest })) {
          candidates.push({ ...receipt.result, verified: true, taskId: request.taskId, inputRevision: request.inputRevision });
        }
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const workspaceField = (inputRevision, name) => {
    if (!hex.test(inputRevision ?? '') || !['start', 'source', 'prepare', 'candidate'].includes(name)) {
      fail('CHIEF_WEB_REAL_OPERATOR_SCOPE_DENIED');
    }
    return inputRevision + '-' + name;
  };
  const rwb = await loadChiefWebRealRwbHost({
    ...options,
    verifyResourceSource: value => value === options.resourceSource && treeDigest(value) === options.resourceSourceDigest,
    verifyPush: (scope, mode) => same(readOptional(path.join(root,
      (mode === 'recovery' ? 'push-recovery-' : 'push-') + scope.operationId, 'verified.json')), {
      branch: scope.branch, previousHead: scope.previousHead, candidateSha: scope.candidateSha,
      baseSha: scope.baseSha, scopeDigest: scope.scopeDigest, operationId: scope.operationId,
    }),
    verifyRecovery(scope, recovery, lease) {
      const directory = path.join(root, 'push-' + scope.operationId);
      const policy = readPrivate(path.join(directory, 'policy.json'));
      const resolution = readPrivate(path.join(root, 'broker', scope.operationId, 'prelaunch-recovery.json'));
      return exactLease(lease) && realDigest(resolution.recovery) === realDigest(recovery) &&
        realDigest(policy) === recovery.originalHookPolicyDigest &&
        !fs.existsSync(path.join(directory, 'verified.json')) &&
        same(policy, { scopeDigest: scope.scopeDigest, operationId: scope.operationId, branch: scope.branch,
          previousHead: null, baseSha: scope.baseSha, candidateSha: scope.candidateSha });
    },
    log, assertWorkspaceLease, readReview,
    workspaceJournal: {
      read: (taskId, revision, name) => readOptional(journalFile('workspace', taskId, workspaceField(revision, name))),
      createExclusive: (taskId, revision, name, value) => record(journalFile('workspace', taskId, workspaceField(revision, name)), value),
    },
    publicationJournal: {
      read: id => readOptional(journalFile('publication', id)),
      createExclusive: (id, value) => record(journalFile('publication', id), value),
      readRecovery: id => readOptional(journalFile('publication-recovery', id)),
      createRecoveryExclusive: (id, value) => record(journalFile('publication-recovery', id), value),
    },
    async withExclusiveBranch(scope, lease, work, recovery) {
      if (!exactLease(lease) || !legacyDrained() || await spool.isPaused()) fail('CHIEF_WEB_REAL_PUBLICATION_FENCE_DENIED');
      const directory = path.join(root, (recovery ? 'push-recovery-' : 'push-') + scope.operationId);
      fs.mkdirSync(directory, { mode: 0o700 });
      const existingHook = fs.realpathSync(path.join(options.projectRoot, '.git/hooks/pre-push'));
      const configured = execFileSync(git, ['-C', options.projectRoot, 'rev-parse', '--git-path', 'hooks/pre-push'], { encoding: 'utf8' }).trim();
      const resolved = fs.realpathSync(path.resolve(options.projectRoot, configured));
      if (resolved !== existingHook) fail('CHIEF_WEB_REAL_PUBLICATION_FENCE_DENIED');
      const policyPath = path.join(directory, 'policy.json');
      record(policyPath, { schemaVersion: 1, branch: scope.branch, candidateSha: scope.candidateSha, previousHead: scope.previousHead,
        baseSha: scope.baseSha, scopeDigest: scope.scopeDigest, operationId: scope.operationId,
        expiresAt: scope.expiresAt, pauseFlag: path.join(root, 'broker/paused.json'),
        existingHook, existingHookDigest: digest(fs.readFileSync(existingHook)) });
      fs.writeFileSync(path.join(directory, 'pre-push'), '#!/bin/sh\nexec "$SUPER_AGENT_CHIEF_REAL_PUSH_NODE" "$SUPER_AGENT_CHIEF_REAL_PUSH_HOOK" "$@"\n',
        { flag: 'wx', mode: 0o700 });
      const count = Number(process.env.GIT_CONFIG_COUNT ?? '0');
      if (!Number.isSafeInteger(count) || count < 0 || count > 64) fail('CHIEF_WEB_REAL_PUBLICATION_FENCE_DENIED');
      const overrides = {
        GIT_CONFIG_COUNT: String(count + 1),
        ['GIT_CONFIG_KEY_' + count]: 'core.hooksPath',
        ['GIT_CONFIG_VALUE_' + count]: directory,
        SUPER_AGENT_CHIEF_REAL_PUSH_POLICY: policyPath,
        SUPER_AGENT_CHIEF_REAL_PUSH_NODE: options.nodeBinary,
        SUPER_AGENT_CHIEF_REAL_PUSH_HOOK: path.join(sourceDirectory, 'chief-web-real-pre-push.mjs'),
      };
      const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
      Object.assign(process.env, overrides);
      try {
        const override = execFileSync(git, ['-C', options.projectRoot, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
        if (override !== directory) fail('CHIEF_WEB_REAL_PUBLICATION_FENCE_DENIED');
        return await work(() => {
          if (!exactLease(lease) || !legacyDrained() || fs.existsSync(path.join(root, 'broker/paused.json'))) {
            fail('CHIEF_WEB_REAL_PUBLICATION_FENCE_DENIED');
          }
          return { verified: true, exclusive: true, drained: true, pauseFenceClear: true, scopeDigest: scope.scopeDigest,
            leaseNonce: lease.nonce, expectedRemoteHead: scope.previousHead, allowedCandidateSha: scope.candidateSha };
        });
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
  });
  const executor = createChiefWebRealDockerExecutor({
    ...options, config: { ...config, credentialGrantId: options.credentialGrantId },
    modelRoot: path.join(root, 'model'), logRoot: path.join(root, 'model-logs'),
    credentialRoot: path.join(root, 'credential-slots'), workspace: rwb.workspace, log,
    async invokeDocker(args) {
      const spawn = () => new Promise((resolve, reject) => {
        execFile(options.dockerBinary, args, { timeout: 180000, maxBuffer: 65536 },
          (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
      });
      if (args[0] !== 'run') return spawn();
      const holder = await spool.withControlFence(async () => {
        if (await spool.isPaused()) fail('CHIEF_WEB_REAL_PAUSED_BEFORE_WORKER');
        const pending = spawn();
        pending.catch(() => {});
        return { pending };
      });
      return holder.pending;
    },
  });
  const broker = createChiefWebRealBroker({ spool, executor, publisher: rwb.publisher, admission, log });
  let stopped = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopped = true; });
  if (!legacyDrained() || !pinnedStorage().allowed) fail('CHIEF_WEB_REAL_OPERATOR_PREFLIGHT_FAILED');
  if (recoverOperationId !== undefined) {
    if (!uuid.test(recoverOperationId) || path.basename(filename) !== 'host-scope-recovery.json') {
      fail('CHIEF_WEB_REAL_RECOVERY_SCOPE_DENIED');
    }
    await spool.withFence(async () => {
      const envelope = await spool.readRequest(recoverOperationId);
      const request = envelope?.request;
      const reply = await spool.observe(recoverOperationId);
      const lease = readLease(recoverOperationId);
      if (request?.revision !== 1 || !exactLease(lease) ||
          !same(lease, { taskId: request.taskId, inputRevision: request.inputRevision, released: false }) ||
          reply?.status !== 'unknown' ||
          !await spool.isClaimed(recoverOperationId) || await spool.isPaused() ||
          Date.now() >= config.expiresAt || treeDigest(options.resourceSource) !== options.resourceSourceDigest) {
        fail('CHIEF_WEB_REAL_RECOVERY_SCOPE_DENIED');
      }
      if (request.role === 'publish') {
        const expectedBranch = 'codex/integrate-super-agent-' + request.taskId;
        if (reply.code !== 'RWB_REAL_PUBLICATION_UNKNOWN' || request.previousHead !== null ||
            request.branch !== expectedBranch || Date.now() >= (request.confirmation?.expiresAt ?? 0) ||
            !same(request.confirmation, { candidateSha: request.candidateSha, baseSha: request.baseSha,
              reviewDigest: request.reviewDigest, previousHead: null }) || !uuid.test(request.confirmation.requestId ?? '') ||
            fs.existsSync(path.join(options.projectRoot, '.git/leon-engineering/git-safety/repository.lock'))) {
          fail('CHIEF_WEB_REAL_RECOVERY_PUBLICATION_UNCERTAIN');
        }
        const initial = path.join(root, 'push-' + recoverOperationId);
        safeDirectory(initial);
        const policy = readPrivate(path.join(initial, 'policy.json'));
        const claim = readPrivate(journalFile('publication', recoverOperationId));
        if (!same(policy, { operationId: recoverOperationId, branch: expectedBranch, candidateSha: request.candidateSha,
          baseSha: request.baseSha, previousHead: null, expiresAt: request.confirmation.expiresAt, scopeDigest: claim.scopeDigest }) ||
            claim.operationId !== recoverOperationId || fs.existsSync(path.join(initial, 'verified.json')) ||
            !fs.lstatSync(path.join(initial, 'pre-push')).isFile()) fail('CHIEF_WEB_REAL_RECOVERY_PUBLICATION_UNCERTAIN');
        const prepared = await rwb.workspace.readPrepared(request);
        if (!same(prepared, { verified: true, taskId: request.taskId, inputRevision: request.inputRevision,
          candidateSha: request.candidateSha, baseSha: request.baseSha, branch: expectedBranch, reviewDigest: request.reviewDigest }) ||
            !hex.test(prepared.managedReceiptDigest ?? '')) fail('CHIEF_WEB_REAL_RECOVERY_PUBLICATION_UNCERTAIN');
        const github = createChiefWebRealGitHub({ ghBinary: options.ghBinary, projectRoot: options.projectRoot });
        const endpoint = 'repos/' + REAL_RWB_REPOSITORY;
        const owner = REAL_RWB_REPOSITORY.split('/')[0];
        const base = github.get(endpoint + '/git/ref/heads/master');
        const remote = github.get(endpoint + '/git/ref/heads/' + expectedBranch);
        const pullRequests = github.get(endpoint + '/pulls?state=all&head=' + encodeURIComponent(owner + ':' + expectedBranch) + '&base=master&per_page=2');
        if (base?.object?.sha !== request.baseSha || remote !== null || !Array.isArray(pullRequests) || pullRequests.length !== 0 ||
            Date.now() >= request.confirmation.expiresAt) fail('CHIEF_WEB_REAL_RECOVERY_PUBLICATION_UNCERTAIN');
        const evidenceDigest = realDigest([claim, policy, prepared.managedReceiptDigest, base.object.sha, remote, pullRequests]);
        record(path.join(root, 'broker', recoverOperationId, 'prelaunch-recovery.json'), {
          schemaVersion: 1, proofType: 'publication_before_push', operationId: recoverOperationId, requestDigest: envelope.requestDigest,
          taskId: request.taskId, inputRevision: request.inputRevision, candidateSha: request.candidateSha,
          prePushProofAbsent: true, remoteAbsent: true, preflightDigest: evidenceDigest,
          recovery: {
            schemaVersion: 1, action: 'recover_pre_push_lock_denial', taskId: request.taskId, operationId: recoverOperationId,
            inputRevision: request.inputRevision, branch: expectedBranch, candidateSha: request.candidateSha,
            baseSha: request.baseSha, previousHead: null, reviewDigest: request.reviewDigest, confirmationId: request.confirmation.requestId,
            originalClaimDigest: realDigest(claim), managedReceiptDigest: prepared.managedReceiptDigest,
            originalHookPolicyDigest: realDigest(policy), leaseDigest: realDigest([lease.taskId, lease.projectId, lease.inputRevision, lease.nonce]),
            evidenceDigest,
          },
        });
        log({ code: 'CHIEF_WEB_REAL_PUBLICATION_PRE_PUSH_RECOVERY_READY', operationId: recoverOperationId });
        return;
      }
      if (request.role !== 'developer' || reply.code !== 'CHIEF_WEB_REAL_EXECUTION_UNKNOWN') fail('CHIEF_WEB_REAL_RECOVERY_SCOPE_DENIED');
      const model = path.join(root, 'model', recoverOperationId);
      safeDirectory(model);
      const reservation = readPrivate(path.join(model, 'reservation.json'));
      const start = readPrivate(journalFile('workspace', request.taskId, workspaceField(request.inputRevision, 'start')));
      const workers = execFileSync(options.dockerBinary, ['ps', '-aq', '--filter', 'label=io.super-agent.chief-model-slot=' + recoverOperationId],
        { encoding: 'utf8', timeout: 12000, maxBuffer: 65536 }).trim();
      if (workers || fs.readdirSync(model).some(name => name !== 'reservation.json') ||
          !same(reservation, { taskId: request.taskId, role: 'developer', slotId: recoverOperationId, inputRevision: request.inputRevision }) ||
          !same(start, { taskId: request.taskId, inputRevision: request.inputRevision, revision: 1 })) {
        fail('CHIEF_WEB_REAL_RECOVERY_LAUNCH_UNCERTAIN');
      }
      const preflightDigest = digest(JSON.stringify([start, reservation, options.resourceSourceDigest]));
      record(path.join(root, 'broker', recoverOperationId, 'prelaunch-recovery.json'), {
        schemaVersion: 1, operationId: recoverOperationId, requestDigest: envelope.requestDigest,
        taskId: request.taskId, inputRevision: request.inputRevision, physicalLaunchAbsent: true, preflightDigest,
      });
      log({ code: 'CHIEF_WEB_REAL_PRELAUNCH_RECOVERY_READY', operationId: recoverOperationId });
    });
  }
  log({ code: 'CHIEF_WEB_REAL_OPERATOR_READY' });
  while (!stopped && Date.now() < config.expiresAt) {
    await broker.tick();
    await delay(1500);
  }
  log({ code: 'CHIEF_WEB_REAL_OPERATOR_STOPPED' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (![3, 4].includes(process.argv.length) || process.env.SUPER_AGENT_CHIEF_WEB_REAL_BROKER_ENABLED !== '1') fail('CHIEF_WEB_REAL_OPERATOR_DISABLED');
    await runChiefWebRealBroker(process.argv[2], process.argv[3]);
  } catch (error) {
    const code = /^(CHIEF_WEB_REAL|RWB_REAL)_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'CHIEF_WEB_REAL_OPERATOR_FAILED';
    console.error(JSON.stringify({ code }));
    process.exitCode = 1;
  }
}
