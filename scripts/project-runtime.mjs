import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(projectRoot, 'scripts/vendor/leon-engineering');
const commands = Object.freeze({
  session: 'harness-session.mjs',
  delivery: 'iteration-delivery.mjs',
  record: 'harness-project.mjs',
  run: 'harness-run.mjs',
  enforce: 'harness-enforce.mjs',
  storage: 'harness-storage.mjs',
  lifecycle: 'resource-lifecycle.mjs'
});
const runtimeFiles = [...Object.values(commands), 'profile-project.mjs', 'harness-execution.mjs', 'lib/resources/lifecycle.mjs'].sort();

function regularFile(root, relative) {
  if (typeof relative !== 'string' || !/^[a-z0-9][a-z0-9./-]*$/.test(relative)
    || relative.split('/').some(part => part === '..' || part === '.' || part === '')) {
    throw new Error('PROJECT_RUNTIME_PATH_INVALID');
  }
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('PROJECT_RUNTIME_SYMLINK');
  }
  if (!fs.statSync(current).isFile()) throw new Error('PROJECT_RUNTIME_FILE_INVALID');
  return current;
}

export function verifyProjectRuntime() {
  if (fs.lstatSync(runtimeRoot).isSymbolicLink()) throw new Error('PROJECT_RUNTIME_SYMLINK');
  if (fs.existsSync(path.join(runtimeRoot, '../lib/resources/lifecycle.mjs'))) {
    throw new Error('PROJECT_RUNTIME_UNVERIFIED_RESOURCE_ENGINE');
  }
  const manifest = JSON.parse(fs.readFileSync(regularFile(runtimeRoot, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.frameworkVersion !== '0.19.4'
    || manifest.sourceCommit !== '3913ddb9ac612760fb95bf8d8f7102f948c32d0f'
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
    || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(runtimeFiles)) {
    throw new Error('PROJECT_RUNTIME_MANIFEST_INVALID');
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    const content = fs.readFileSync(regularFile(runtimeRoot, name));
    if (!/^[a-f0-9]{64}$/.test(expected) || crypto.createHash('sha256').update(content).digest('hex') !== expected) {
      throw new Error('PROJECT_RUNTIME_CHECKSUM_MISMATCH');
    }
  }
  return { status: 'verified', frameworkVersion: manifest.frameworkVersion,
    sourceCommit: manifest.sourceCommit, fileCount: Object.keys(manifest.files).length };
}

function log(action, status, exitCode) {
  const directory = process.env.SUPER_AGENT_LOG_ROOT || path.join(projectRoot, 'logs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(directory, 'project-runtime.jsonl'), `${JSON.stringify({
    at: new Date().toISOString(), component: 'project-runtime', action, status, exitCode
  })}\n`, { mode: 0o600 });
}

function main(args) {
  const [action, ...forwarded] = args;
  if (!['verify', ...Object.keys(commands)].includes(action)) throw new Error('PROJECT_RUNTIME_ACTION_INVALID');
  const verified = verifyProjectRuntime();
  if (action === 'verify') {
    if (forwarded.length) throw new Error('PROJECT_RUNTIME_ARGUMENT_INVALID');
    log(action, 'passed', 0);
    process.stdout.write(`${JSON.stringify(verified)}\n`);
    return;
  }
  const child = spawnSync(process.execPath, [path.join(runtimeRoot, commands[action]), ...forwarded], { stdio: 'inherit' });
  if (child.error) throw new Error('PROJECT_RUNTIME_SPAWN_FAILED');
  const exitCode = child.status ?? 1;
  log(action, child.signal ? 'interrupted' : exitCode === 0 ? 'passed' : 'failed', exitCode);
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const code = /^PROJECT_RUNTIME_[A-Z_]+$/.test(error.message) ? error.message : 'PROJECT_RUNTIME_FAILED';
    try { log(Object.hasOwn(commands, process.argv[2]) ? process.argv[2] : 'verify', code, 1); }
    catch { process.stderr.write('PROJECT_RUNTIME_LOG_FAILED\n'); }
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
