import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CHIEF_WEB_REAL_MODEL, chiefWebRealDigest, chiefWebRealRequestDigest,
  chiefWebRealRequestIdentity, createChiefWebRealExecutor } from '../bridge/chief-web-real-executor.mjs';
import { CHIEF_WEB_REAL_MODEL_FILE_LIMIT, createChiefWebRealFileProvider } from '../bridge/chief-web-real-executor-provider.mjs';

const exec = promisify(execFile);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const image = /^sha256:[a-f0-9]{64}$/;
const networkName = /^super-agent-[a-z0-9-]+_[a-z0-9_-]+$/;
const files = new Set(['reservation.json', 'request.json', 'physical.json', 'receipt.json', 'credential-changed.json']);
const workerRoot = '/paperclip/control/chief-web/recovery-host/real-model';
const fileMax = CHIEF_WEB_REAL_MODEL_FILE_LIMIT;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);

async function safeDirectory(directory, { mode, create = false } = {}) {
  if (typeof directory !== 'string' || path.resolve(directory) !== directory || directory.includes(',')) {
    fail('CHIEF_WEB_REAL_HOST_DIRECTORY_DENIED');
  }
  if (create) {
    try { await fs.mkdir(directory, { mode }); await fs.chmod(directory, mode); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  const state = await fs.lstat(directory);
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== process.getuid() ||
      (mode === undefined ? (state.mode & 0o022) !== 0 : (state.mode & 0o777) !== mode) ||
      await fs.realpath(directory) !== directory) fail('CHIEF_WEB_REAL_HOST_DIRECTORY_DENIED');
}

async function privateBytes(filename, size) {
  let file;
  try { file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  try {
    const state = await file.stat();
    if (!state.isFile() || state.uid !== process.getuid() || (state.mode & 0o777) !== 0o600 ||
        ![1, 2].includes(state.nlink) || state.size < 1 || state.size > size) fail('CHIEF_WEB_REAL_HOST_PRIVATE_FILE_DENIED');
    if (state.nlink === 2) {
      const directory = path.dirname(filename);
      const prefix = '.' + path.basename(filename) + '.tmp-';
      let owned = false;
      for (const name of await fs.readdir(directory)) {
        if (!name.startsWith(prefix) || !uuid.test(name.slice(prefix.length))) continue;
        const temp = await fs.lstat(path.join(directory, name)).catch(error => {
          if (error?.code === 'ENOENT') return null;
          throw error;
        });
        if (temp?.ino === state.ino && temp.dev === state.dev && temp.isFile() && temp.uid === state.uid) owned = true;
      }
      if (!owned && (await file.stat()).nlink !== 1) fail('CHIEF_WEB_REAL_HOST_PRIVATE_FILE_DENIED');
    }
    const buffer = Buffer.alloc(state.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== state.size) fail('CHIEF_WEB_REAL_HOST_PRIVATE_FILE_DENIED');
    return buffer.subarray(0, offset);
  } finally { await file.close(); }
}

async function atomicWrite(filename, body, max) {
  if (body.length > max) fail('CHIEF_WEB_REAL_HOST_FILE_LIMIT');
  const directory = path.dirname(filename);
  const temporary = path.join(directory, '.' + path.basename(filename) + '.tmp-' + randomUUID());
  const file = await fs.open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(body); await file.sync(); }
    finally { await file.close(); }
    await fs.link(temporary, filename);
    const parent = await fs.open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await fs.unlink(temporary); }
}

const writeJson = (filename, value) => atomicWrite(filename, Buffer.from(JSON.stringify(value) + '\n'), fileMax);
const readJson = async filename => {
  const data = await privateBytes(filename, fileMax);
  return data && JSON.parse(data);
};

async function readPersonalSubscription() {
  const directory = path.join(os.userInfo().homedir, '.codex');
  await safeDirectory(directory);
  const bytes = await privateBytes(path.join(directory, 'auth.json'), 1048576);
  if (!bytes) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  const value = JSON.parse(bytes);
  if ((value.auth_mode && value.auth_mode !== 'chatgpt') || value.OPENAI_API_KEY || value.CODEX_API_KEY ||
      !['account_id', 'access_token', 'refresh_token', 'id_token'].every(key =>
        typeof value.tokens?.[key] === 'string' && value.tokens[key].length > 0)) {
    fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  }
  return { bytes, fingerprint: chiefWebRealDigest(value.tokens.account_id), sha: chiefWebRealDigest(bytes) };
}

export function chiefWebRealDockerArguments({ imageId, network, dependenciesRoot, logRoot, modelSlot, credentialSlot, slotId, proxy } = {}) {
  if (!image.test(imageId ?? '') || !networkName.test(network ?? '') || !uuid.test(slotId ?? '') ||
      ![dependenciesRoot, logRoot, modelSlot, credentialSlot].every(value =>
        typeof value === 'string' && path.resolve(value) === value && !value.includes(',')) ||
      (proxy !== undefined && proxy !== 'http://host.docker.internal:29758')) fail('CHIEF_WEB_REAL_WORKER_CONFIGURATION_DENIED');
  const mount = (source, target, readOnly = false) => 'type=bind,src=' + source + ',dst=' + target + (readOnly ? ',readonly' : '');
  return ['run', '--rm', '--pull', 'never', '--platform', 'linux/arm64', '--network', network,
    '--name', 'sa-chief-model-' + slotId, '--label', 'io.super-agent.chief-model-slot=' + slotId,
    '--read-only', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
    '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'KILL',
    '--pids-limit', '128', '--memory', '768m', '--cpus', '1.5', '--tmpfs', '/tmp:size=128m,mode=1777',
    '--mount', mount(dependenciesRoot, '/opt/paperclip', true),
    '--mount', mount(logRoot, '/paperclip/logs'),
    '--mount', mount(modelSlot, workerRoot + '/' + slotId),
    '--mount', mount(credentialSlot, '/executor-sessions'),
    '--env', 'SUPER_AGENT_CHIEF_WEB_REAL_MODEL_ENABLED=1',
    ...(proxy ? ['--env', 'HTTP_PROXY=' + proxy, '--env', 'HTTPS_PROXY=' + proxy] : []),
    '--entrypoint', 'node', imageId, '/opt/super-agent/scripts/chief-web-real-executor.mjs', slotId];
}

export async function retireChiefWebRealCredentialCopy({ credentialSlot, identity, claim, receipt, invokeDocker }) {
  chiefWebRealRequestIdentity(identity);
  if (path.basename(credentialSlot) !== identity.slotId) fail('CHIEF_WEB_REAL_CREDENTIAL_RETIREMENT_DENIED');
  if (!['completed', 'unknown'].includes(receipt?.status) || !same(receipt, {
    ...identity, physicalCalls: 1, requestDigest: claim.requestDigest, credentialGrantId: claim.credentialGrantId,
    accountFingerprint: claim.accountFingerprint,
  })) return false;
  const role = path.join(credentialSlot, identity.conversationId, identity.inputRevision, identity.role);
  const home = path.join(role, identity.slotId);
  try { await safeDirectory(home, { mode: 0o711 }); }
  catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
  const authPath = path.join(home, 'auth.json');
  const permit = await readJson(path.join(role, identity.slotId + '.json'));
  const auth = await privateBytes(authPath, 1048576);
  if (!auth) return true;
  if (!same(permit, { ...identity, requestDigest: claim.requestDigest, credentialGrantId: claim.credentialGrantId,
    accountFingerprint: claim.accountFingerprint, sourceSha256: chiefWebRealDigest(auth) })) {
    fail('CHIEF_WEB_REAL_CREDENTIAL_RETIREMENT_DENIED');
  }
  if (receipt.code === 'CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED' &&
      !await privateBytes(path.join(home, 'rotated-auth.json'), 1048576)) fail('CHIEF_WEB_REAL_CREDENTIAL_RETIREMENT_DENIED');
  const containers = await invokeDocker(['container', 'ls', '-a', '--filter',
    'label=io.super-agent.chief-model-slot=' + identity.slotId, '--format', '{{.ID}}']);
  if (containers.stdout.trim()) return false;
  const current = await privateBytes(authPath, 1048576);
  if (!current?.equals(auth)) fail('CHIEF_WEB_REAL_CREDENTIAL_RETIREMENT_DENIED');
  await fs.unlink(authPath);
  const directory = await fs.open(home, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return true;
}

function expectedSlot(identity) {
  const value = chiefWebRealDigest(JSON.stringify([identity.conversationId, identity.generation, identity.inputRevision, identity.role]));
  return value.slice(0, 8) + '-' + value.slice(8, 12) + '-5' + value.slice(13, 16) + '-8' + value.slice(17, 20) + '-' + value.slice(20, 32);
}

/** Consume admitted broker operations using a disposable Docker worker and one private personal credential scope. */
export function createChiefWebRealDockerExecutor({
  config, modelRoot, logRoot, credentialRoot, dependenciesRoot, imageId, network, workspace,
  log, proxy, now = Date.now, invokeDocker = args => exec('docker', args, { timeout: 180000, maxBuffer: 65536 }),
} = {}) {
  if (!uuid.test(config?.conversationId ?? '') || !uuid.test(config.credentialGrantId ?? '') ||
      !Number.isSafeInteger(config.generation) || !Number.isSafeInteger(config.expiresAt) ||
      ![log, now, invokeDocker].every(fn => typeof fn === 'function')) fail('CHIEF_WEB_REAL_WORKER_CONFIGURATION_DENIED');

  const modelSlot = slotId => path.join(modelRoot, slotId);
  const credentialSlot = slotId => path.join(credentialRoot, slotId);
  function translate(filename) {
    const [slotId, leaf, extra] = filename.slice(workerRoot.length + 1).split('/');
    if (!filename.startsWith(workerRoot + '/') || extra || !uuid.test(slotId ?? '') || !files.has(leaf)) {
      fail('CHIEF_WEB_REAL_HOST_PRIVATE_FILE_DENIED');
    }
    return path.join(modelSlot(slotId), leaf);
  }
  const provider = createChiefWebRealFileProvider({ read: filename => readJson(translate(filename)),
    write: (filename, value) => writeJson(translate(filename), value), now });

  async function provision(identity, requestDigest) {
    const source = await readPersonalSubscription();
    const accountPath = path.join(credentialRoot, 'account.json');
    const account = { conversationId: identity.conversationId, generation: identity.generation,
      credentialGrantId: config.credentialGrantId, accountFingerprint: source.fingerprint, sourceSha256: source.sha };
    try { await writeJson(accountPath, account); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    if (!same(await readJson(accountPath), account)) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED');
    const mount = credentialSlot(identity.slotId);
    const directory = path.join(mount, identity.conversationId, identity.inputRevision, identity.role);
    for (const item of [mount, path.join(mount, identity.conversationId), path.join(mount, identity.conversationId, identity.inputRevision),
      directory, path.join(directory, identity.slotId)]) await safeDirectory(item, { mode: 0o711, create: true });
    const permitPath = path.join(directory, identity.slotId + '.json');
    const authPath = path.join(directory, identity.slotId, 'auth.json');
    const permit = { ...identity, requestDigest, credentialGrantId: config.credentialGrantId,
      accountFingerprint: source.fingerprint, sourceSha256: source.sha, source: 'verified_personal_subscription' };
    let current = await privateBytes(authPath, 1048576);
    if (!current) {
      try { await atomicWrite(authPath, source.bytes, 1048576); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      current = await privateBytes(authPath, 1048576);
    }
    if (!current?.equals(source.bytes)) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED');
    try { await writeJson(permitPath, permit); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    if (!same(await readJson(permitPath), permit)) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED');
    return permit;
  }

  async function consume(request, lease, mode, options) {
    const identity = chiefWebRealRequestIdentity(request);
    const requestDigest = chiefWebRealRequestDigest(request);
    if (!same(identity, { conversationId: config.conversationId, generation: config.generation }) ||
        identity.slotId !== expectedSlot(identity) || (identity.taskId !== null && lease &&
          (!same(lease, { taskId: identity.taskId, inputRevision: identity.inputRevision }) ||
            !uuid.test(lease.projectId ?? '') || !/^[a-f0-9]{64}$/.test(lease.nonce ?? '')))) fail('CHIEF_WEB_REAL_HOST_SCOPE_DENIED');
    const dispatchAllowed = options?.dispatchAllowed !== false && now() < config.expiresAt &&
      (identity.taskId === null || Boolean(lease));
    for (const directory of [modelRoot, logRoot, credentialRoot]) await safeDirectory(directory, { mode: 0o700 });
    try { await safeDirectory(modelSlot(identity.slotId), { mode: 0o700, create: dispatchAllowed }); }
    catch (error) { if (!dispatchAllowed && error?.code === 'ENOENT') return { status: 'pending' }; throw error; }
    const file = name => path.join(modelSlot(identity.slotId), name);
    if (await readJson(file('credential-changed.json'))) return { status: 'unknown', code: 'CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED' };
    let claim = await readJson(file('reservation.json'));
    if (!claim && !dispatchAllowed) return { status: 'pending' };
    if (!claim) {
      const permit = await provision(identity, requestDigest);
      claim = { ...identity, requestDigest, ...CHIEF_WEB_REAL_MODEL, credentialGrantId: permit.credentialGrantId,
        accountFingerprint: permit.accountFingerprint, claimedAt: now(), expiresAt: config.expiresAt, status: 'reserved' };
      try { await writeJson(file('reservation.json'), claim); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      claim = await readJson(file('reservation.json'));
    }
    if (!same(claim, { ...identity, requestDigest, credentialGrantId: config.credentialGrantId })) {
      fail('CHIEF_WEB_REAL_EXECUTION_RESERVATION_DENIED');
    }
    async function retire() {
      const receipt = await provider.observe(claim);
      if (!receipt || !Number.isSafeInteger(receipt.physicalCalls)) return true;
      return retireChiefWebRealCredentialCopy({ credentialSlot: credentialSlot(identity.slotId), identity,
        claim, receipt, invokeDocker });
    }
    if (dispatchAllowed && !await retire()) return { status: 'pending' };
    let source = workspace;
    if (!dispatchAllowed && identity.role !== 'chief') {
      if (!await provider.observe(claim) || typeof workspace.observeSource !== 'function') return { status: 'pending' };
      const snapshot = await workspace.observeSource(request);
      if (!snapshot) return { status: 'pending' };
      source = { ...workspace, read: () => snapshot };
    }
    const evaluator = createChiefWebRealExecutor({
      admission: { claim: () => ({ status: dispatchAllowed ? 'claimed_now' : 'claimed', claim, dispatchAllowed }),
        read: () => ({ status: 'claimed', claim, dispatchAllowed }) },
      workspace: source, provider, log, now,
    });
    const first = await evaluator[dispatchAllowed ? mode : 'observe'](request);
    if (first.status !== 'pending' || !dispatchAllowed || !await readJson(file('request.json')) ||
        await readJson(file('physical.json'))) return first;

    const permit = await provision(identity, requestDigest);
    if (permit.accountFingerprint !== claim.accountFingerprint) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED');
    await safeDirectory(dependenciesRoot);
    const inspected = await invokeDocker(['image', 'inspect', '--format', '{{.Id}} {{.Architecture}}', imageId]);
    if (inspected.stdout.trim() !== imageId + ' arm64') fail('CHIEF_WEB_REAL_WORKER_IMAGE_DENIED');
    const args = chiefWebRealDockerArguments({ imageId, network, dependenciesRoot, logRoot,
      modelSlot: modelSlot(identity.slotId), credentialSlot: credentialSlot(identity.slotId), slotId: identity.slotId, proxy });
    let launched = false;
    try { await invokeDocker(args); launched = true; }
    catch { await log({ code: 'CHIEF_WEB_REAL_WORKER_RECONCILIATION_REQUIRED', operationId: identity.slotId }); }
    if (!await retire()) return { status: 'pending' };
    try {
      const current = await readPersonalSubscription();
      if (current.sha !== permit.sourceSha256) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED');
    } catch {
      await writeJson(file('credential-changed.json'), { slotId: identity.slotId, status: 'unknown' });
      return { status: 'unknown', code: 'CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED' };
    }
    const result = await evaluator.observe(request);
    return result.status === 'pending' && !launched && !await readJson(file('physical.json'))
      ? { status: 'blocked', code: 'CHIEF_WEB_REAL_WORKER_NOT_STARTED' } : result;
  }

  return Object.freeze({ execute: (request, lease, options) => consume(request, lease, 'execute', options),
    observe: (request, lease, options) => consume(request, lease, 'observe', options) });
}
