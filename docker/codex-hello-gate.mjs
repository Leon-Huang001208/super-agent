import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const fail = code => { throw new Error(code); };
function parseArgs(args) {
  if (args[0] !== 'exec' || args.at(-1) !== '-') fail('HELLO_ARGUMENTS_REJECTED');
  const seen = new Set();
  let model, reasoningEffort;
  for (let i = 1; i < args.length - 1; i++) {
    const arg = args[i];
    if (['--json', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'].includes(arg)) {
      if (seen.has(arg)) fail('HELLO_ARGUMENTS_REJECTED');
      seen.add(arg);
    } else if (arg === '--model' && !model) {
      model = args[++i];
    } else if (arg === '-c') {
      const config = args[++i];
      if (['features.plugins=false', 'features.remote_plugin=false', 'project_doc_max_bytes=0', 'sandbox_mode="workspace-write"', 'sandbox_workspace_write.network_access=true'].includes(config)) continue;
      const effort = /^model_reasoning_effort="(minimal|low|medium|high|xhigh)"$/.exec(config ?? '');
      if (!effort || reasoningEffort) fail('HELLO_ARGUMENTS_REJECTED');
      reasoningEffort = effort[1];
    } else fail('HELLO_ARGUMENTS_REJECTED');
  }
  if (!seen.has('--json') || !seen.has('--ephemeral')) fail('HELLO_ARGUMENTS_REJECTED');
  return { model, reasoningEffort };
}

export async function authorizeHello({ directory, args, input, cwd, home, apiKeysPresent, now = Date.now() }) {
  if (input !== 'Respond with hello.' || cwd !== '/opt/paperclip' || apiKeysPresent) fail('HELLO_SCOPE_REJECTED');
  const selected = parseArgs(args);
  const permit = JSON.parse(await fs.readFile(path.join(directory, 'hello-permit.json'), 'utf8'));
  if (![permit.id, permit.companyId, permit.grantId].every(x => new RegExp(`^${uuid}$`).test(x ?? ''))) fail('HELLO_PERMIT_INVALID');
  const expiry = Date.parse(permit.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 15 * 60_000) fail('HELLO_PERMIT_EXPIRED');
  if (selected.model && permit.model !== selected.model) fail('HELLO_MODEL_REJECTED');
  if (!['gpt-6.1-sol', 'gpt-5.6-sol'].includes(permit.model)) fail('HELLO_MODEL_REJECTED');
  const defaultModelApplied = !selected.model;
  selected.model ??= permit.model;
  if (!new RegExp(`^/tmp/paperclip-ai-${permit.companyId}-${permit.grantId}-[A-Za-z0-9]+/provider$`).test(home ?? '')) fail('HELLO_ACCOUNT_HOME_REJECTED');
  // Claim before contacting the provider. Failure, timeout, or a missing receipt
  // never automatically restores this single attempt.
  const claim = { at: new Date(now).toISOString(), permitId: permit.id, model: selected.model, defaultModelApplied, engine: 'cli', sandbox: 'read-only', status: 'claimed' };
  const file = await fs.open(path.join(directory, `hello-${permit.id}.claim.json`), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(claim) + '\n'); await file.sync(); } finally { await file.close(); }
  const parent = await fs.open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
  return { ...selected, defaultModelApplied, permitId: permit.id };
}

export function safeHelloArgs({ model, reasoningEffort }) {
  return ['exec', '--json', '--model', model, '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
    '-c', 'approval_policy="never"', '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false', '-c', 'features.shell_tool=false',
    '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    ...(reasoningEffort ? ['-c', `model_reasoning_effort="${reasoningEffort}"`] : []), '-'];
}

export function isSubscriptionAuth(auth) {
  // Paperclip's verified-credential normalizer intentionally omits auth_mode.
  return (!auth.auth_mode || auth.auth_mode === 'chatgpt') && !auth.OPENAI_API_KEY &&
    ['access_token', 'refresh_token', 'id_token'].every(key => typeof auth.tokens?.[key] === 'string' && auth.tokens[key].length > 0);
}

export async function runHelloProcess({ command, args, input, stdout = process.stdout, stderr = process.stderr, signals = process, timeoutMs = 40_000, killGraceMs = 4_000 }) {
  const child = spawn(command, args, { env: process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let timedOut = false, spawnFailed = false, interrupted = false, escalation;
  const killGroup = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') spawnFailed = true; }
  };
  const stop = () => {
    killGroup('SIGTERM');
    escalation ??= setTimeout(() => killGroup('SIGKILL'), killGraceMs);
  };
  const interrupt = () => { interrupted = true; stop(); };
  signals.on('SIGTERM', interrupt); signals.on('SIGINT', interrupt);
  // A lost reader must stop the whole CLI process group; its native child must
  // not continue after the Paperclip probe stops collecting the result.
  stdout.on('error', interrupt); stderr.on('error', interrupt);
  child.on('error', () => { spawnFailed = true; });
  child.stdin.on('error', () => { spawnFailed = true; stop(); });
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  child.stdout.pipe(stdout); child.stderr.pipe(stderr);
  child.stdin.end(input);
  const result = await new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
  clearTimeout(timer); clearTimeout(escalation);
  signals.off('SIGTERM', interrupt); signals.off('SIGINT', interrupt);
  // Keep destination error handlers until this short-lived gate exits: a
  // buffered write can report EPIPE after the child has emitted close.
  return { ...result, timedOut, spawnFailed, interrupted };
}

async function main() {
  let selected, launchStarted = false;
  try {
    let input = '', length = 0;
    for await (const chunk of process.stdin) { length += chunk.length; if (length <= 4096) input += chunk; }
    selected = await authorizeHello({ directory: '/paperclip/evaluation', args: process.argv.slice(2), input: length <= 4096 ? input : '',
      cwd: process.cwd(), home: process.env.CODEX_HOME, apiKeysPresent: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.OPENAI_BASE_URL) });
    const auth = JSON.parse(await fs.readFile(path.join(process.env.CODEX_HOME, 'auth.json'), 'utf8'));
    if (!isSubscriptionAuth(auth)) fail('HELLO_SUBSCRIPTION_REQUIRED');
    launchStarted = true;
    const result = await runHelloProcess({ command: '/opt/paperclip/node_modules/.bin/codex', args: safeHelloArgs(selected), input: 'Respond with hello.' });
    const receipt = { at: new Date().toISOString(), permitId: selected.permitId, model: selected.model, defaultModelApplied: selected.defaultModelApplied, engine: 'cli', sandbox: 'read-only',
      ...result, modelRequestAttempted: !result.spawnFailed, apiFallback: false };
    await fs.appendFile('/paperclip/logs/hello-probes.jsonl', JSON.stringify(receipt) + '\n', { mode: 0o600 });
    process.exitCode = result.timedOut || result.spawnFailed || result.interrupted || result.exitCode === null ? 78 : result.exitCode;
  } catch (error) {
    const errorCode = /^HELLO_[A-Z_]+$/.test(error.message ?? '') ? error.message : 'EVALUATION_AUTH_ONLY';
    if (selected) await fs.appendFile('/paperclip/logs/hello-probes.jsonl', JSON.stringify({ at: new Date().toISOString(), permitId: selected.permitId, errorCode, status: launchStarted ? 'failed-or-uncertain' : 'failed-before-execution', modelRequestAttempted: launchStarted, retryAllowed: false }) + '\n', { mode: 0o600 }).catch(() => process.stderr.write('{"errorCode":"HELLO_AUDIT_FAILED"}\n'));
    process.stderr.write(JSON.stringify({ errorCode: 'EVALUATION_AUTH_ONLY', reasonCode: errorCode, provider: 'codex', modelRequest: launchStarted, retryAllowed: false }) + '\n');
    process.exitCode = 78;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
