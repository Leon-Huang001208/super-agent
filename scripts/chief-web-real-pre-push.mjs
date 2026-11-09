import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const commit = /^[a-f0-9]{40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const allowed = new Set(['https://github.com/Leon-Huang001208/ResearchWorkbench.git',
  'https://github.com/Leon-Huang001208/ResearchWorkbench', 'git@github.com:Leon-Huang001208/ResearchWorkbench.git']);
const fail = () => { throw new Error('CHIEF_WEB_REAL_PRE_PUSH_DENIED'); };

export function verifyChiefWebRealPush({ policy, remoteName, remoteUrl, stdin }) {
  if (policy?.schemaVersion !== 1 || remoteName !== 'origin' || !allowed.has(remoteUrl) ||
      !/^codex\/integrate-super-agent-[a-f0-9-]{36}$/.test(policy.branch ?? '') ||
      !commit.test(policy.candidateSha ?? '') || (policy.previousHead !== null && !commit.test(policy.previousHead ?? '')) ||
      !Number.isSafeInteger(policy.expiresAt) || Date.now() >= policy.expiresAt || typeof stdin !== 'string') fail();
  const rows = stdin.trim().split(/\r?\n/);
  if (rows.length !== 1) fail();
  const [localRef, localSha, remoteRef, remoteSha, extra] = rows[0].split(' ');
  const branchRef = 'refs/heads/' + policy.branch;
  if (extra !== undefined || localRef !== branchRef || localSha !== policy.candidateSha || remoteRef !== branchRef ||
      remoteSha !== (policy.previousHead ?? '0'.repeat(40))) fail();
  return true;
}

function readPrivate(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || fs.realpathSync(filename) !== filename) fail();
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
        stat.size < 1 || stat.size > 8192) fail();
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

function main() {
  const policyPath = process.env.SUPER_AGENT_CHIEF_REAL_PUSH_POLICY;
  const policy = readPrivate(policyPath);
  const chunks = Buffer.alloc(8193);
  let length = 0;
  while (length < chunks.length) {
    const count = fs.readSync(0, chunks, length, chunks.length - length, null);
    if (count === 0) break;
    length += count;
  }
  if (length > 8192) fail();
  const stdin = chunks.subarray(0, length).toString('utf8');
  const [remoteName, remoteUrl, extra] = process.argv.slice(2);
  if (extra !== undefined) fail();
  verifyChiefWebRealPush({ policy, remoteName, remoteUrl, stdin });
  if (typeof policy.existingHook !== 'string' || fs.realpathSync(policy.existingHook) !== policy.existingHook ||
      hash(fs.readFileSync(policy.existingHook)) !== policy.existingHookDigest) fail();
  const prior = spawnSync(policy.existingHook, [remoteName, remoteUrl], { input: stdin, encoding: 'utf8', timeout: 120000, maxBuffer: 65536 });
  if (prior.error || prior.signal || prior.status !== 0) fail();
  if (!commit.test(policy.baseSha ?? '') || !/^[a-f0-9]{64}$/.test(policy.scopeDigest ?? '') ||
      !/^[a-f0-9-]{36}$/.test(policy.operationId ?? '')) fail();
  const base = spawnSync('/usr/bin/git', ['ls-remote', '--refs', 'origin', 'refs/heads/master'],
    { encoding: 'utf8', timeout: 12000, maxBuffer: 65536 });
  if (base.error || base.signal || base.status !== 0 ||
      base.stdout.trim() !== policy.baseSha + '\trefs/heads/master') fail();
  if (typeof policy.pauseFlag !== 'string' || !path.isAbsolute(policy.pauseFlag) || fs.existsSync(policy.pauseFlag)) fail();
  verifyChiefWebRealPush({ policy, remoteName, remoteUrl, stdin });
  const proof = path.join(path.dirname(policyPath), 'verified.json');
  const descriptor = fs.openSync(proof, 'wx', 0o600);
  try {
    const { branch, previousHead, candidateSha, baseSha, scopeDigest, operationId } = policy;
    fs.writeFileSync(descriptor, JSON.stringify({ branch, previousHead, candidateSha, baseSha, scopeDigest, operationId }) + '\n');
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch {
    console.error('{"code":"CHIEF_WEB_REAL_PRE_PUSH_DENIED"}');
    process.exitCode = 1;
  }
}
