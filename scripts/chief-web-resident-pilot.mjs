import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CHIEF_WEB_DAILY_DOCUMENTS as DAILY_TARGETS, matchChiefWebDailyTarget } from '../bridge/chief-web-real-engine.mjs';

export { DAILY_TARGETS };

export const RESIDENT_PROJECT = 'super-agent-chief-web-resident-rwb';
export const RESIDENT_ORIGIN = 'http://localhost:8112';
export const RESIDENT_OWNER_TRANSPORT = 'http://127.0.0.1:8112';
export const RESIDENT_TARGETS = Object.freeze(['intake', 'recovery', 'status'].map(name =>
  'docs/super-agent/chief-resident-' + name + '.md'));
export const DAILY_PROJECT = 'super-agent-chief-web-daily-rwb';
export const DAILY_ORIGIN = 'http://localhost:8113';
export const DAILY_OWNER_TRANSPORT = 'http://127.0.0.1:8113';
const deployments = Object.freeze({
  2: { project: RESIDENT_PROJECT, origin: RESIDENT_ORIGIN, ownerTransport: RESIDENT_OWNER_TRANSPORT, variant: 'resident' },
  3: { project: DAILY_PROJECT, origin: DAILY_ORIGIN, ownerTransport: DAILY_OWNER_TRANSPORT, variant: 'daily' },
});
const data = '/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0';
const logs = data + '/logs';
const leaseDatabase = data + '/state/control/admission.sqlite';
const bindingTarget = '/paperclip/control/chief-web-real.json';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/;
const hostDirectory = new RegExp('^' + logs.replaceAll('.', '\\.') + '/chief-web-real-rwb\\.[A-Za-z0-9._-]+$');
const supervisorDirectory = new RegExp('^' + logs.replaceAll('.', '\\.') + '/chief-web-(?:resident|daily)-rwb\\.[A-Za-z0-9._-]+$');
const phases = new Set(['activating', 'active', 'draining', 'blocked', 'complete', 'expired']);
const nativePhases = new Set(['ready', 'understanding', 'developing', 'reviewing', 'awaiting_confirmation', 'approved',
  'waiting_ci', 'awaiting_supplement', 'done', 'blocked']);
const codePattern = /^CHIEF_WEB_RESIDENT_[A-Z_]+$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const matches = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);

function absolute(value) {
  return typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !/[\0\r\n]/.test(value);
}

export function validateChiefWebResidentManifest(value) {
  const keys = ['schemaVersion', 'sourceRoot', 'sourceSha', 'imageId', 'dependenciesRoot', 'expiresAt', 'ownerSessionFile', 'slots'];
  const daily = value?.schemaVersion === 3;
  const targets = daily ? DAILY_TARGETS : RESIDENT_TARGETS;
  if (!value || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key)) ||
      (!daily && value.schemaVersion !== 2) || !absolute(value.sourceRoot) || !absolute(value.dependenciesRoot) ||
      !absolute(value.ownerSessionFile) || !sha.test(value.sourceSha ?? '') || !/^sha256:[a-f0-9]{64}$/.test(value.imageId ?? '') ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0 || !Array.isArray(value.slots) ||
      value.slots.length !== targets.length || value.slots.some(slot => !slot || Object.keys(slot).length !== 3 ||
        !hostDirectory.test(slot.scopeRoot ?? '') || !uuid.test(slot.conversationId ?? '') ||
        !uuid.test(slot.chiefAgentId ?? '')) ||
      new Set(value.slots.map(slot => slot.conversationId)).size !== (daily ? 1 : value.slots.length) ||
      new Set(value.slots.map(slot => slot.chiefAgentId)).size !== (daily ? 1 : value.slots.length) ||
      new Set(value.slots.map(slot => slot.scopeRoot)).size !== value.slots.length) fail('CHIEF_WEB_RESIDENT_MANIFEST_INVALID');
  return Object.freeze({ ...value, slots: Object.freeze(value.slots.map((slot, index) =>
    Object.freeze({ ...slot, targetDoc: targets[index] }))) });
}

export function validateChiefWebResidentBindings(manifest, records) {
  const first = records?.[0];
  if (!Array.isArray(records) || records.length !== manifest.slots.length ||
      ![first?.companyId, first?.projectId].every(value => uuid.test(value ?? '')) ||
      typeof first?.userId !== 'string' || !first.userId) fail('CHIEF_WEB_RESIDENT_BINDING_INVALID');
  return records.map((binding, index) => {
    const slot = manifest.slots[index];
    const daily = manifest.schemaVersion === 3;
    if (!matches(binding, { companyId: first.companyId, projectId: first.projectId, userId: first.userId,
      chiefAgentId: slot.chiefAgentId, conversationId: slot.conversationId, expiresAt: manifest.expiresAt,
      targetDoc: slot.targetDoc, maxRevisions: daily ? index + 1 : 1 }) ||
      (daily ? binding.daily !== true || binding.generation !== first.generation : binding.daily === true) ||
      !Number.isSafeInteger(binding.generation) || binding.generation < 0 ||
      !Number.isSafeInteger(binding.intakeFrom) || binding.intakeFrom >= binding.expiresAt ||
      !uuid.test(binding.conversationId)) fail('CHIEF_WEB_RESIDENT_BINDING_INVALID');
    return Object.freeze({ ...binding });
  });
}

export function verifyChiefWebResidentFreshComments(comments, binding) {
  if (!Array.isArray(comments) || comments.length >= 65) fail('CHIEF_WEB_RESIDENT_COMMENTS_UNVERIFIED');
  for (const row of comments) {
    const created = typeof row?.createdAt === 'string' ? Date.parse(row.createdAt) : NaN;
    if (!matches(row, { issueId: binding.conversationId, companyId: binding.companyId }) ||
        !uuid.test(row?.id ?? '') || !Number.isFinite(created) ||
        !Object.hasOwn(row, 'authorUserId') || !Object.hasOwn(row, 'deletedAt')) {
      fail('CHIEF_WEB_RESIDENT_COMMENTS_UNVERIFIED');
    }
    if (created > binding.intakeFrom && row.authorUserId === binding.userId && row.deletedAt === null) {
      if (binding.daily === true) {
        if (typeof row.body !== 'string') fail('CHIEF_WEB_RESIDENT_COMMENTS_UNVERIFIED');
        if (matchChiefWebDailyTarget(row.body) !== binding.targetDoc) continue;
      }
      fail('CHIEF_WEB_RESIDENT_INACTIVE_OWNER_COMMENT');
    }
  }
}

function terminalReceipt(status, binding) {
  if (status?.phase !== 'done' || status.generation !== binding.generation || status.revision !== binding.maxRevisions ||
      !uuid.test(status.taskId ?? '') || !digest.test(status.inputRevision ?? '') || status.operationId ||
      !Number.isSafeInteger(status.pr?.number) || status.pr.number <= 0 ||
      status.pr.url !== 'https://github.com/Leon-Huang001208/ResearchWorkbench/pull/' + status.pr.number ||
      !sha.test(status.pr.headSha ?? '') ||
      !matches(status.ci, { number: status.pr.number, headSha: status.pr.headSha, conclusion: 'success' }) ||
      !digest.test(status.ci.checksDigest ?? '')) fail('CHIEF_WEB_RESIDENT_TERMINAL_UNVERIFIED');
  return { taskId: status.taskId, inputRevision: status.inputRevision, prNumber: status.pr.number, headSha: status.pr.headSha };
}

export function createChiefWebResidentPilot({ manifest, bindings, store, host, now = Date.now } = {}) {
  if (![store?.read, store?.write, host?.drain, host?.activate, host?.verifyActive, host?.status, host?.verifyFreshComments,
    host?.start, host?.stop, host?.disable, now].every(fn => typeof fn === 'function')) fail('CHIEF_WEB_RESIDENT_CONFIGURATION_INVALID');
  let localConsumer = false;
  const initial = { phase: 'ready', index: 0, completed: [] };

  function state(value) {
    if (!value) return initial;
    if (!phases.has(value.phase) || !Number.isSafeInteger(value.index) || value.index < 0 ||
        value.index >= manifest.slots.length || !Array.isArray(value.completed) ||
        value.completed.length !== value.index + (value.phase === 'complete' ? 1 : 0) ||
        value.completed.some((entry, index) => entry.conversationId !== manifest.slots[index].conversationId ||
          !uuid.test(entry.taskId ?? '') || !digest.test(entry.inputRevision ?? '') || !sha.test(entry.headSha ?? '') ||
          !Number.isSafeInteger(entry.prNumber) || entry.prNumber < 1)) {
      fail('CHIEF_WEB_RESIDENT_PROGRESS_INVALID');
    }
    return value;
  }

  async function commit(current, patch) {
    const next = { ...current, ...patch, at: now() };
    await store.write(next);
    return next;
  }

  async function stop() {
    if (localConsumer) {
      await host.stop();
      localConsumer = false;
    }
  }

  async function activate(current) {
    const slot = manifest.slots[current.index];
    const binding = bindings[current.index];
    const blocked = { phase: 'blocked', conversationId: slot.conversationId, code: 'CHIEF_WEB_RESIDENT_INACTIVE_OWNER_COMMENT' };
    const expired = { phase: 'expired', conversationId: slot.conversationId, code: null };
    await host.drain();
    try { await host.verifyFreshComments(slot, binding); }
    catch (error) { if (error?.code === blocked.code) return commit(current, blocked); throw error; }
    if (now() >= manifest.expiresAt) return commit(current, expired);
    await commit(current, { phase: 'activating', conversationId: slot.conversationId, code: null });
    if (now() >= manifest.expiresAt) return commit(current, expired);
    if (await host.activate(slot, binding) === false) return commit(current, expired);
    await host.verifyActive(slot, binding);
    try { await host.verifyFreshComments(slot, binding); }
    catch (error) {
      if (error?.code !== blocked.code) throw error;
      await host.drain();
      await host.disable(slot, binding);
      return commit(current, blocked);
    }
    const status = await host.status(slot);
    if (status?.phase !== 'ready' || status.generation !== binding.generation || status.taskId ||
        (binding.daily === true && !matches(status, { targetDoc: binding.targetDoc, maxRevisions: binding.maxRevisions })) ||
        status.revision !== 0 || status.operationId) fail('CHIEF_WEB_RESIDENT_INTAKE_NOT_EMPTY');
    if (now() >= manifest.expiresAt) {
      await host.drain();
      await host.disable(slot, binding);
      return commit(current, expired);
    }
    localConsumer = true;
    await host.start(slot);
    return commit(current, { phase: 'active', conversationId: slot.conversationId, code: null });
  }

  async function step() {
    const current = state(await store.read());
    const blocked = current.phase === 'blocked';
    if (['complete', 'expired'].includes(current.phase) ||
        (blocked && (current.code !== 'CHIEF_WEB_RESIDENT_TASK_BLOCKED' || now() >= manifest.expiresAt))) return current;
    if (['activating', 'draining'].includes(current.phase)) fail('CHIEF_WEB_RESIDENT_TRANSITION_UNKNOWN');
    const slot = manifest.slots[current.index];
    const binding = bindings[current.index];
    if (now() >= manifest.expiresAt) {
      if (current.phase === 'active') {
        await commit(current, { phase: 'draining' });
        await stop();
        await host.drain();
        await host.disable(slot, binding);
      }
      return commit(current, { phase: 'expired' });
    }
    if (current.phase === 'ready') return activate(current);
    if (current.conversationId !== slot.conversationId) fail('CHIEF_WEB_RESIDENT_PROGRESS_INVALID');
    if (!localConsumer) await host.verifyActive(slot, binding);
    const status = await host.status(slot);
    if (!nativePhases.has(status?.phase) || status.generation !== binding.generation || !Number.isSafeInteger(status.revision) ||
        status.revision < 0 || status.revision > binding.maxRevisions ||
        (status.phase === 'awaiting_supplement' && (binding.daily !== true || status.revision !== 1 || binding.maxRevisions !== 2)) ||
        (binding.daily === true && !matches(status, { targetDoc: binding.targetDoc, maxRevisions: binding.maxRevisions }))) {
      fail('CHIEF_WEB_RESIDENT_NATIVE_STATUS_UNVERIFIED');
    }
    // The operator may have reconciled the original Native operation while the supervisor was stopped.
    // Only adopt a terminal receipt. The supervisor must never start an executor for a blocked slot.
    if (blocked && status.phase !== 'done') return current;
    if (status.phase === 'blocked') {
      await commit(current, { phase: 'draining' });
      await stop();
      return commit(current, { phase: 'blocked', code: 'CHIEF_WEB_RESIDENT_TASK_BLOCKED' });
    }
    if (status.phase === 'done') {
      const result = terminalReceipt(status, binding);
      if (current.completed.some(entry => entry.taskId === result.taskId || entry.prNumber === result.prNumber)) {
        fail('CHIEF_WEB_RESIDENT_TERMINAL_UNVERIFIED');
      }
      const completed = [...current.completed, { conversationId: slot.conversationId, ...result }];
      if (blocked) {
        await host.drain();
        if (now() >= manifest.expiresAt) return current;
      }
      await commit(current, { phase: 'draining' });
      await stop();
      await host.drain();
      if (current.index + 1 === manifest.slots.length) {
        // Daily receipts remain readable after the capped terminal lane stops.
        if (binding.daily !== true) await host.disable(slot, binding);
        return commit(current, { phase: 'complete', completed, code: null });
      }
      return activate({ ...current, index: current.index + 1, completed });
    }
    if (!localConsumer) {
      await host.drain();
      if (now() >= manifest.expiresAt) {
        await host.disable(slot, binding);
        return commit(current, { phase: 'expired', code: null });
      }
      localConsumer = true;
      await host.start(slot);
    }
    return current;
  }
  return Object.freeze({ step, stop });
}

async function privateDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o700 || await fs.realpath(directory) !== directory) fail('CHIEF_WEB_RESIDENT_PRIVATE_PATH_DENIED');
}

async function privateText(filename, max = 32768) {
  if (!absolute(filename) || await fs.realpath(filename) !== filename) fail('CHIEF_WEB_RESIDENT_PRIVATE_PATH_DENIED');
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || info.size < 1 ||
        info.size > max || (info.mode & 0o777) !== 0o600) fail('CHIEF_WEB_RESIDENT_PRIVATE_PATH_DENIED');
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size) fail('CHIEF_WEB_RESIDENT_PRIVATE_PATH_DENIED');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally { await file.close(); }
}

async function readPrivate(filename, optional = false) {
  try { return JSON.parse(await privateText(filename)); }
  catch (error) { if (optional && error?.code === 'ENOENT') return null; throw error; }
}

async function syncDirectory(directory) {
  const fd = await fs.open(directory, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}

export async function claimChiefWebResidentLock(directory, project = RESIDENT_PROJECT) {
  if (![RESIDENT_PROJECT, DAILY_PROJECT].includes(project)) fail('CHIEF_WEB_RESIDENT_CONFIGURATION_INVALID');
  await privateDirectory(directory);
  const lock = path.join(directory, project + '.supervisor.lock');
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error?.code === 'EEXIST') fail('CHIEF_WEB_RESIDENT_SUPERVISOR_OWNED'); throw error; }
  const handle = await fs.open(lock, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const owned = await handle.stat();
  await syncDirectory(directory);
  return async ({ drained }) => {
    try {
      if (!drained) return;
      const current = await fs.lstat(lock);
      if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino || current.uid !== owned.uid) {
        fail('CHIEF_WEB_RESIDENT_SUPERVISOR_OWNED');
      }
      await fs.rmdir(lock);
      await syncDirectory(directory);
    } finally { await handle.close(); }
  };
}

async function writeProgress(filename, state) {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, '.progress-' + randomUUID());
  const file = await fs.open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(state) + '\n'); await file.sync(); } finally { await file.close(); }
  try { await fs.rename(temporary, filename); }
  catch (error) { await fs.unlink(temporary); throw error; }
  await syncDirectory(directory);
}

function hostEnvironment() {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME', 'DOCKER_CONFIG'];
  return Object.fromEntries(names.filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));
}

export function chiefWebResidentChildEnvironment(slot) {
  if (!RESIDENT_TARGETS.includes(slot?.targetDoc) && !DAILY_TARGETS.includes(slot?.targetDoc)) fail('CHIEF_WEB_RESIDENT_BINDING_INVALID');
  return { ...hostEnvironment(), SUPER_AGENT_CHIEF_WEB_REAL_BROKER_ENABLED: '1',
    SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT: slot.targetDoc };
}

function command(binary, args, { input, env = hostEnvironment(), timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { env, timeout, maxBuffer: 524288 }, (error, stdout) =>
      error ? reject(Object.assign(new Error('CHIEF_WEB_RESIDENT_COMMAND_FAILED'), { code: 'CHIEF_WEB_RESIDENT_COMMAND_FAILED' })) : resolve(stdout.trim()));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input);
  });
}

const replaceBinding = String.raw`
const fs=require('node:fs');
const dir='/paperclip/control', target=dir+'/chief-web-real.json';
const current=fs.lstatSync(dir);
if(process.getuid()!==0||!current.isDirectory()||current.isSymbolicLink()||current.uid!==0||current.gid!==0||
   (current.mode&0o022)!==0||fs.realpathSync(dir)!==dir)process.exit(17);
try{
 const old=fs.lstatSync(target);
 if(!old.isFile()||old.isSymbolicLink()||old.uid!==0||old.gid!==0||old.nlink!==1||(old.mode&0o777)!==0o600)process.exit(17);
}catch(e){if(e.code!=='ENOENT')throw e}
const body=fs.readFileSync(0);
if(body.length<2||body.length>32768)process.exit(17);
JSON.parse(body);
const tmp=dir+'/.chief-web-resident-'+require('node:crypto').randomUUID();
const file=fs.openSync(tmp,'wx',0o600);
try{fs.writeFileSync(file,body);fs.fsyncSync(file)}finally{fs.closeSync(file)}
try{fs.renameSync(tmp,target)}catch(e){fs.unlinkSync(tmp);throw e}
const d=fs.openSync(dir,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
`;

const bindingDigest = String.raw`
const fs=require('node:fs'), name='/paperclip/control/chief-web-real.json';
const s=fs.lstatSync(name);
if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>32768)process.exit(17);
const body=JSON.stringify(JSON.parse(fs.readFileSync(name)));
process.stdout.write(require('node:crypto').createHash('sha256').update(body).digest('hex'));
`;

async function createMacHost({ manifest, log }) {
  const docker = '/usr/local/bin/docker';
  const dockerDo = (args, options) => command(docker, args, options);
  const runner = path.join(manifest.sourceRoot, 'scripts/chief-web-real-runner.mjs');
  const { project, origin, ownerTransport, variant } = deployments[manifest.schemaVersion];
  const app = project + '-paperclip-1';
  const db = project + '-db-1';
  const gateway = project + '-gateway-1';
  let child;
  let childExit;

  function compose(slot, enabled, args, options) {
    return dockerDo(['compose', '--env-file', '/dev/null', '--project-name', project,
      '-f', path.join(manifest.sourceRoot, 'compose.chief-web-real.yaml'),
      '-f', path.join(manifest.sourceRoot, 'compose.chief-web-' + variant + '.yaml'), ...args], {
      env: { ...hostEnvironment(), SUPER_AGENT_RUNTIME_IMAGE: manifest.imageId,
        SUPER_AGENT_VERIFIED_DEPENDENCIES: manifest.dependenciesRoot,
        SUPER_AGENT_CHIEF_REAL_BROKER_ROOT: path.join(slot.scopeRoot, 'broker'),
        SUPER_AGENT_CHIEF_WEB_REAL_ENABLED: String(enabled),
        SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT: slot.targetDoc }, ...options,
    });
  }

  async function inspect(name, service, checks) {
    const format = '{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|' +
      '{{index .Config.Labels "com.docker.compose.service"}}|' + checks;
    const raw = await dockerDo(['inspect', '--type', 'container', '--format', format, name]);
    const parts = raw.split('|');
    if (parts[0] !== 'true' || parts[1] !== project || parts[2] !== service) fail('CHIEF_WEB_RESIDENT_CONTAINER_UNVERIFIED');
    return parts.slice(3);
  }

  async function stable(slot, enabled) {
    const document = slot?.targetDoc ?? '';
    const [appImage, appVolume, broker, feature, configuredDoc, dependencies] = await inspect(app, 'paperclip',
      '{{.Image}}|{{range .Mounts}}{{if eq .Destination "/paperclip"}}{{.Name}}{{end}}{{end}}|' +
      '{{range .Mounts}}{{if eq .Destination "/chief-real-broker"}}{{.Source}}{{end}}{{end}}|' +
      '{{range .Config.Env}}{{if eq . "SUPER_AGENT_CHIEF_WEB_REAL_ENABLED=true"}}true{{end}}' +
      '{{if eq . "SUPER_AGENT_CHIEF_WEB_REAL_ENABLED=false"}}false{{end}}{{end}}|' +
      '{{range .Config.Env}}{{if eq . "SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT=' + document + '"}}matched{{end}}{{end}}|' +
      '{{range .Mounts}}{{if eq .Destination "/opt/paperclip"}}{{.Type}}:{{.Source}}:{{.RW}}{{end}}{{end}}');
    const [dbVolume] = await inspect(db, 'db',
      '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}');
    await inspect(gateway, 'gateway', '');
    const port = await dockerDo(['port', gateway, '3100/tcp']);
    if (appImage !== manifest.imageId || appVolume !== project + '_state' ||
        dependencies !== 'bind:' + manifest.dependenciesRoot + ':false' ||
        dbVolume !== project + '_database' || port !== new URL(ownerTransport).host ||
        (enabled !== undefined && feature !== String(enabled)) || (slot && configuredDoc !== 'matched') ||
        (slot && broker !== path.join(slot.scopeRoot, 'broker')) ||
        (!slot && !manifest.slots.some(item => broker === path.join(item.scopeRoot, 'broker')))) {
      fail('CHIEF_WEB_RESIDENT_CONTAINER_UNVERIFIED');
    }
  }

  async function drain() {
    if (child && child.exitCode === null && child.signalCode === null) fail('CHIEF_WEB_RESIDENT_CONSUMER_PRESENT');
    const processes = await command('/bin/ps', ['-axo', 'pid=,command=']);
    if (processes.split('\n').some(line => /\/scripts\/chief-web-real-runner\.mjs\s/.test(line))) {
      fail('CHIEF_WEB_RESIDENT_CONSUMER_PRESENT');
    }
    const workers = await dockerDo(['ps', '-aq', '--filter', 'label=io.super-agent.chief-model-slot']);
    if (workers) fail('CHIEF_WEB_RESIDENT_MODEL_WORKER_PRESENT');
    for (const filename of [leaseDatabase, leaseDatabase + '-wal', leaseDatabase + '-shm', leaseDatabase + '-journal']) {
      let stat;
      try { stat = await fs.lstat(filename); }
      catch (error) { if (filename !== leaseDatabase && error?.code === 'ENOENT') continue; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.nlink !== 1 ||
          (stat.mode & 0o077) || await fs.realpath(filename) !== filename) fail('CHIEF_WEB_RESIDENT_LEASE_UNVERIFIED');
    }
    const ledger = new DatabaseSync(leaseDatabase, { readOnly: true, timeout: 5000 });
    try {
      if (ledger.prepare('SELECT 1 FROM admission_lease WHERE slot=1').get()) fail('CHIEF_WEB_RESIDENT_LEASE_PRESENT');
    } finally { ledger.close(); }
    try { await fs.lstat(path.join(path.dirname(leaseDatabase), 'active-lease.json')); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    fail('CHIEF_WEB_RESIDENT_LEASE_PRESENT');
  }

  async function ownerGet(slot, resource) {
    const cookie = (await privateText(manifest.ownerSessionFile, 4096)).trim();
    if (!cookie || /[^\x20-\x7e]/.test(cookie) || !cookie.includes('=')) fail('CHIEF_WEB_RESIDENT_OWNER_SESSION_DENIED');
    for (let attempt = 0; attempt < 8; attempt++) {
      let response;
      try {
        response = await fetch(ownerTransport + '/api/issues/' + slot.conversationId + '/' + resource, {
          headers: { cookie, accept: 'application/json', host: new URL(origin).host, origin },
          redirect: 'error', signal: AbortSignal.timeout(5000),
        });
      } catch {
        if (attempt === 7) fail('CHIEF_WEB_RESIDENT_NATIVE_STATUS_UNAVAILABLE');
        await delay(1000);
        continue;
      }
      if (response.status === 502 || response.status === 503) {
        await response.body?.cancel();
        if (attempt === 7) fail('CHIEF_WEB_RESIDENT_NATIVE_STATUS_UNAVAILABLE');
        await delay(1000);
        continue;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        fail('CHIEF_WEB_RESIDENT_NATIVE_STATUS_UNAVAILABLE');
      }
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > (resource === 'chief-web-real' ? 32768 : 524288)) fail('CHIEF_WEB_RESIDENT_NATIVE_STATUS_UNVERIFIED');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    fail('CHIEF_WEB_RESIDENT_NATIVE_STATUS_UNAVAILABLE');
  }

  async function verifyActive(slot, binding) {
    await stable(slot, true);
    const digest = await dockerDo(['exec', app, 'node', '-e', bindingDigest]);
    if (digest !== hash(JSON.stringify(binding))) fail('CHIEF_WEB_RESIDENT_BINDING_DRIFT');
  }

  return {
    drain, status: slot => ownerGet(slot, 'chief-web-real'), verifyActive,
    async verifyFreshComments(slot, binding) {
      verifyChiefWebResidentFreshComments(await ownerGet(slot, 'comments?limit=65&order=desc'), binding);
    },
    async activate(slot, binding) {
      await stable();
      if (hash(JSON.stringify(await readPrivate(path.join(slot.scopeRoot, 'binding.json')))) !== hash(JSON.stringify(binding))) {
        fail('CHIEF_WEB_RESIDENT_BINDING_DRIFT');
      }
      if (Date.now() >= manifest.expiresAt) return false;
      await dockerDo(['exec', '-i', app, 'node', '-e', replaceBinding], { input: JSON.stringify(binding) + '\n' });
      if (Date.now() >= manifest.expiresAt) {
        await compose(slot, false, ['up', '-d', '--wait', '--wait-timeout', '75', '--no-build', '--no-deps', '--force-recreate', 'paperclip'], { timeout: 90000 });
        await stable(slot, false);
        return false;
      }
      await compose(slot, true, ['up', '-d', '--wait', '--wait-timeout', '75', '--no-build', '--no-deps', '--force-recreate', 'paperclip'], { timeout: 90000 });
      return true;
    },
    async disable(slot, binding) {
      await verifyActive(slot, binding);
      await compose(slot, false, ['up', '-d', '--wait', '--wait-timeout', '75', '--no-build', '--no-deps', '--force-recreate', 'paperclip'], { timeout: 90000 });
      await stable(slot, false);
    },
    async start(slot) {
      if (child) fail('CHIEF_WEB_RESIDENT_CONSUMER_PRESENT');
      if (Date.now() >= manifest.expiresAt) fail('CHIEF_WEB_RESIDENT_PERMIT_EXPIRED');
      const processChild = spawn(process.execPath, [runner, path.join(slot.scopeRoot, 'host-scope.json')], {
        cwd: manifest.sourceRoot, env: chiefWebResidentChildEnvironment(slot), stdio: 'ignore',
      });
      child = processChild;
      childExit = new Promise(resolve => {
        processChild.once('error', () => resolve({ code: null, signal: null }));
        processChild.once('exit', (code, signal) => resolve({ code, signal }));
      });
      const startup = await Promise.race([childExit.then(() => false), delay(1500, true)]);
      if (!startup) fail('CHIEF_WEB_RESIDENT_CONSUMER_START_FAILED');
      await log({ code: 'CHIEF_WEB_RESIDENT_CONSUMER_STARTED', conversationId: slot.conversationId });
    },
    async stop() {
      if (!child) return;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const result = await Promise.race([childExit, delay(30000, null, { ref: false })]);
      if (!result || result.code !== 0) fail('CHIEF_WEB_RESIDENT_CONSUMER_STOP_UNVERIFIED');
      child = undefined;
      childExit = undefined;
    },
    ensureOwnedChild() {
      if (child && (child.exitCode !== null || child.signalCode !== null)) fail('CHIEF_WEB_RESIDENT_CONSUMER_EXITED');
    },
  };
}

async function runCli(mode, filename) {
  if (!['run', 'status'].includes(mode) || !absolute(filename) || path.basename(filename) !== 'manifest.json' ||
      !supervisorDirectory.test(path.dirname(filename))) fail('CHIEF_WEB_RESIDENT_COMMAND_INVALID');
  const directory = path.dirname(filename);
  await privateDirectory(directory);
  const manifest = validateChiefWebResidentManifest(await readPrivate(filename));
  const { project, origin, variant } = deployments[manifest.schemaVersion];
  if (!path.basename(directory).startsWith('chief-web-' + variant + '-rwb.')) fail('CHIEF_WEB_RESIDENT_COMMAND_INVALID');
  const progress = path.join(directory, 'progress.json');
  const manifestDigest = hash(JSON.stringify(manifest));
  const store = {
    async read() {
      const envelope = await readPrivate(progress, true);
      if (!envelope) return null;
      if (envelope.schemaVersion !== 1 || envelope.manifestDigest !== manifestDigest || !envelope.state) {
        fail('CHIEF_WEB_RESIDENT_PROGRESS_INVALID');
      }
      return envelope.state;
    },
    write: state => writeProgress(progress, { schemaVersion: 1, manifestDigest, state }),
  };
  if (mode === 'status') {
    return { project, origin, expiresAt: manifest.expiresAt,
      progress: await store.read() ?? { phase: 'ready', index: 0, completed: [] } };
  }
  if (process.platform !== 'darwin' || process.env.SUPER_AGENT_CHIEF_WEB_RESIDENT_ENABLED !== '1' ||
      manifest.expiresAt - Date.now() > 86_400_000 ||
      manifest.sourceRoot !== path.dirname(path.dirname(fileURLToPath(import.meta.url))) ||
      await fs.realpath(manifest.sourceRoot) !== manifest.sourceRoot ||
      await fs.realpath(manifest.dependenciesRoot) !== manifest.dependenciesRoot) fail('CHIEF_WEB_RESIDENT_OPERATOR_DISABLED');
  const source = ['/usr/bin/git', ['-C', manifest.sourceRoot]];
  if (await command(source[0], [...source[1], 'rev-parse', 'HEAD']) !== manifest.sourceSha ||
      await command(source[0], [...source[1], 'status', '--porcelain', '--untracked-files=all'])) fail('CHIEF_WEB_RESIDENT_SOURCE_DRIFT');
  const bindings = validateChiefWebResidentBindings(manifest, await Promise.all(manifest.slots.map(async slot => {
    await privateDirectory(slot.scopeRoot);
    for (const child of ['broker', 'broker-journal', 'credential-slots', 'model', 'model-logs']) {
      await privateDirectory(path.join(slot.scopeRoot, child));
    }
    const scope = await readPrivate(path.join(slot.scopeRoot, 'host-scope.json'));
    if (scope.imageId !== manifest.imageId || scope.dependenciesRoot !== manifest.dependenciesRoot) fail('CHIEF_WEB_RESIDENT_SCOPE_DRIFT');
    return readPrivate(path.join(slot.scopeRoot, 'binding.json'));
  })));
  const releaseLock = await claimChiefWebResidentLock(logs, project);
  const log = async event => {
    const file = await fs.open(path.join(directory, 'supervisor.jsonl'),
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 ||
          (stat.mode & 0o777) !== 0o600) fail('CHIEF_WEB_RESIDENT_PRIVATE_PATH_DENIED');
      await file.writeFile(JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
      await file.sync();
    } finally { await file.close(); }
  };
  let stop = false;
  const halt = () => { stop = true; };
  process.on('SIGINT', halt);
  process.on('SIGTERM', halt);
  let pilot;
  let childDrained = false;
  try {
    const host = await createMacHost({ manifest, log });
    pilot = createChiefWebResidentPilot({ manifest, bindings, store, host });
    while (!stop) {
      if (Date.now() < manifest.expiresAt) host.ensureOwnedChild();
      const previous = await store.read();
      const next = await pilot.step();
      if (next.phase !== previous?.phase || next.index !== previous?.index) {
        await log({ code: 'CHIEF_WEB_RESIDENT_PROGRESS', phase: next.phase, index: next.index });
      }
      if (['blocked', 'complete', 'expired'].includes(next.phase)) return next;
      await delay(2000);
    }
    return { phase: 'stopped', progress: await store.read() };
  } catch (error) {
    const code = codePattern.test(error?.code ?? '') ? error.code : 'CHIEF_WEB_RESIDENT_OPERATOR_FAILED';
    await log({ code });
    throw error;
  } finally {
    process.off('SIGINT', halt);
    process.off('SIGTERM', halt);
    try {
      if (pilot) await pilot.stop();
      childDrained = true;
    } finally {
      await releaseLock({ drained: childDrained });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) fail('CHIEF_WEB_RESIDENT_COMMAND_INVALID');
    const result = await runCli(process.argv[2], process.argv[3]);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const code = codePattern.test(error?.code ?? '') ? error.code : 'CHIEF_WEB_RESIDENT_OPERATOR_FAILED';
    process.stderr.write(JSON.stringify({ code }) + '\n');
    process.exitCode = 1;
  }
}
