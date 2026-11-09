import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chiefWebRealDigest, CHIEF_WEB_REAL_MODEL } from '../bridge/chief-web-real-executor.mjs';
import { createChiefWebRealProviderWorker, CHIEF_WEB_REAL_MODEL_TIMEOUT } from '../bridge/chief-web-real-executor-provider.mjs';

const root = '/executor-sessions';
const binary = '/opt/paperclip/node_modules/.bin/codex';
const fixedBinary = '/opt/paperclip/node_modules/@openai/codex/bin/codex.js';
const stableCode = /^CHIEF_WEB_REAL_[A-Z_]+$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

async function privateBytes(filename, { uid, size }) {
  const fd = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await fd.stat();
    if (!metadata.isFile() || metadata.uid !== uid || metadata.gid !== uid ||
        metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600 ||
        metadata.size < 1 || metadata.size > size) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
    const content = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await fd.read(content, offset, content.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== metadata.size) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
    return content.subarray(0, offset);
  } finally { await fd.close(); }
}

async function readCredential(binding) {
  const { conversationId, inputRevision, role, slotId } = binding;
  if (![conversationId, slotId].every(id => uuid.test(id)) || !digest.test(inputRevision) ||
      !['chief', 'developer', 'reviewer'].includes(role)) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  const directory = path.join(root, conversationId, inputRevision, role);
  const home = path.join(directory, slotId);
  if (await fs.realpath(home) !== home) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  for (const pathname of [root, path.join(root, conversationId), path.join(root, conversationId, inputRevision), directory]) {
    const state = await fs.lstat(pathname);
    if (!state.isDirectory() || state.uid !== 0 || state.gid !== 0 ||
        (state.mode & 0o777) !== 0o711) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  }
  const state = await fs.lstat(home);
  if (!state.isDirectory() || state.uid !== 0 || state.gid !== 0 ||
      (state.mode & 0o777) !== 0o711) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');

  const permit = JSON.parse(await privateBytes(path.join(directory, slotId + '.json'), { uid: 0, size: 4096 }));
  const { credentialGrantId, accountFingerprint, requestDigest, generation } = binding;
  const required = { conversationId, generation, inputRevision, role, slotId, requestDigest, credentialGrantId, accountFingerprint,
    source: 'verified_personal_subscription' };
  if (Object.entries(required).some(([key, value]) => permit?.[key] !== value)) {
    fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  }
  const sourceBytes = await privateBytes(path.join(home, 'auth.json'), { uid: 0, size: 1048576 });
  if (permit.sourceSha256 !== chiefWebRealDigest(sourceBytes)) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  const auth = JSON.parse(sourceBytes);
  if (!auth || (auth.auth_mode && auth.auth_mode !== 'chatgpt') || auth.OPENAI_API_KEY || auth.CODEX_API_KEY ||
      !['account_id', 'access_token', 'refresh_token', 'id_token'].every(key =>
        typeof auth.tokens?.[key] === 'string' && auth.tokens[key].length > 0) ||
      chiefWebRealDigest(auth.tokens.account_id) !== accountFingerprint) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  return { verified: true, credentialGrantId, accountFingerprint, home, sourceBytes };
}

export function chiefWebRealCodexArguments() {
  return ['--no-daemon', 'exec', '--json', '--model', CHIEF_WEB_REAL_MODEL.model, '--sandbox', 'read-only',
    '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-c', 'approval_policy="never"',
    '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false', '-c', 'features.shell_tool=false',
    '-c', 'features.apps=false', '-c', 'features.multi_agent=false', '-c', 'mcp_servers={}',
    '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'shell_environment_policy.inherit="none"',
    '-c', 'model_reasoning_effort="low"', '-'];
}

export async function preserveChiefWebRealRotatedAuth({ credentialHome, original, current }) {
  if (current.equals(original)) return false;
  const before = JSON.parse(original);
  const after = JSON.parse(current);
  const tokens = ['account_id', 'access_token', 'refresh_token', 'id_token'];
  if (!tokens.some(key => before.tokens?.[key] !== after.tokens?.[key])) return false;
  if (!after.tokens?.account_id || after.tokens.account_id !== before.tokens?.account_id ||
      !tokens.every(key => typeof after.tokens[key] === 'string' && after.tokens[key].length > 0) ||
      (after.auth_mode && after.auth_mode !== 'chatgpt') || after.OPENAI_API_KEY || after.CODEX_API_KEY) {
    fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  }
  const temporary = path.join(credentialHome, '.rotated-auth.json.tmp-' + randomUUID());
  const fd = await fs.open(temporary, 'wx', 0o600);
  try {
    try { await fd.writeFile(current); await fd.sync(); } finally { await fd.close(); }
    await fs.link(temporary, path.join(credentialHome, 'rotated-auth.json'));
    const directory = await fs.open(credentialHome, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.unlink(temporary); }
  return true;
}

async function runPinnedCodex({ binding, prompt, credential }) {
  if (await fs.realpath(binary) !== fixedBinary) fail('CHIEF_WEB_REAL_PROVIDER_BINARY_DENIED');
  const installed = JSON.parse(await fs.readFile(path.dirname(path.dirname(fixedBinary)) + '/package.json', 'utf8'));
  if (installed.name !== '@openai/codex' || installed.version !== '0.159.0') fail('CHIEF_WEB_REAL_PROVIDER_BINARY_DENIED');
  if (['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'PAPERCLIP_AI_PROVIDER_KEY', 'PAPERCLIP_AI_PROVIDER_URL']
    .some(key => Boolean(process.env[key]))) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
  const cwd = '/tmp/sa-chief-web-real-' + binding.slotId;
  await fs.mkdir(cwd, { mode: 0o700 });
  await fs.chown(cwd, 1000, 1000);
  const consumerHome = path.join(cwd, 'consumer');
  await fs.mkdir(consumerHome, { mode: 0o700 });
  const consumerAuth = path.join(consumerHome, 'auth.json');
  const consumer = await fs.open(consumerAuth, 'wx', 0o600);
  try { await consumer.writeFile(credential.sourceBytes); await consumer.sync(); }
  finally { await consumer.close(); }
  await fs.chown(consumerAuth, 1000, 1000);
  await fs.chown(consumerHome, 1000, 1000);
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: cwd, CODEX_HOME: consumerHome,
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: '/tmp', TZ: 'UTC' };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY']) {
    if (!process.env[key]) continue;
    if (!['http://host.docker.internal:29758', 'http://host.docker.internal:29758/'].includes(process.env[key])) {
      fail('CHIEF_WEB_REAL_PROVIDER_PROXY_DENIED');
    }
    env[key] = 'http://host.docker.internal:29758';
  }
  if (env.HTTP_PROXY || env.HTTPS_PROXY) env.NO_PROXY = '127.0.0.1,localhost';
  const child = spawn(binary, chiefWebRealCodexArguments(), { cwd, env, uid: 1000, gid: 1000, detached: true,
    stdio: ['pipe', 'pipe', 'pipe'] });
  let failed = false, stdoutBytes = 0, stderrBytes = 0, escalation;
  const chunks = [];
  const signalGroup = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error?.code !== 'ESRCH') failed = true; }
  };
  const stop = () => {
    if (failed) return;
    failed = true;
    signalGroup('SIGTERM');
    escalation = setTimeout(() => signalGroup('SIGKILL'), 3_000);
  };
  const timer = setTimeout(stop, CHIEF_WEB_REAL_MODEL_TIMEOUT);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('error', stop);
  child.stdin.on('error', stop);
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 524288) stop();
    if (!failed) chunks.push(chunk);
  });
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length;
    if (stderrBytes > 131072) stop();
  });
  child.stdin.end(prompt);
  let result;
  try {
    result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    if (child.pid) {
      try { process.kill(-child.pid, 0); signalGroup('SIGKILL'); failed = true; }
      catch (error) { if (error?.code !== 'ESRCH') failed = true; }
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  const current = await privateBytes(consumerAuth, { uid: 1000, size: 1048576 });
  if (await preserveChiefWebRealRotatedAuth({ credentialHome: credential.home, original: credential.sourceBytes, current })) {
    fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED');
  }
  if (failed || result.code !== 0 || result.signal) fail('CHIEF_WEB_REAL_PROVIDER_OUTCOME_UNKNOWN');
  return Buffer.concat(chunks);
}

async function log(event) {
  const directory = '/paperclip/logs';
  const state = await fs.lstat(directory);
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== 0 || state.gid !== 0 ||
      (state.mode & 0o022) !== 0) fail('CHIEF_WEB_REAL_PROVIDER_LOG_DENIED');
  const fd = await fs.open(path.join(directory, 'chief-web-real-model.jsonl'),
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const metadata = await fd.stat();
    if (!metadata.isFile() || metadata.uid !== 0 || metadata.gid !== 0 ||
        metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) fail('CHIEF_WEB_REAL_PROVIDER_LOG_DENIED');
    await fd.writeFile(JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
    await fd.sync();
  } finally { await fd.close(); }
}

async function main(args) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0 ||
        process.env.SUPER_AGENT_CHIEF_WEB_REAL_MODEL_ENABLED !== '1' ||
        args.length !== 1 || !uuid.test(args[0])) fail('CHIEF_WEB_REAL_PROVIDER_WORKER_DISABLED');
    await fs.access('/.dockerenv', constants.R_OK);
    const worker = createChiefWebRealProviderWorker({ readCredential, run: runPinnedCodex, log });
    const result = await worker.execute(args[0]);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status !== 'completed') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ code: stableCode.test(error?.code ?? '') ? error.code : 'CHIEF_WEB_REAL_PROVIDER_WORKER_FAILED' }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
