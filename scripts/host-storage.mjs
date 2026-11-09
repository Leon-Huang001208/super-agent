import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MIN_FREE_BYTES = 5 * 1024 ** 3;
export const MAX_RECEIPT_AGE_MS = 90_000;
const EXTERNAL_MOUNT = '/Volumes/SuperAgentDockerData';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clock = options => Object.hasOwn(options, 'now') ? options.now : Date.now();
const validClock = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;

// Parse host-supplied bytes only. Container statfs/df cannot establish host readiness.
export function parseDfPk(output) {
  if (typeof output !== 'string' || output.length > 64 * 1024) throw new Error('DF_STATUS_UNKNOWN');
  const lines = output.trim().split(/\r?\n/);
  if (!/^Filesystem\s+1024-blocks\s+Used\s+Available\s+Capacity\s+Mounted on$/.test(lines.shift()?.trim() ?? '') || lines.length === 0) {
    throw new Error('DF_STATUS_UNKNOWN');
  }
  return lines.map(line => {
    const match = /^(.*?)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)%\s+(.+?)\s*$/.exec(line);
    if (!match || !match[1].trim()) throw new Error('DF_STATUS_UNKNOWN');
    const [blocks, used, available, capacity] = match.slice(2, 6).map(Number);
    if (![blocks, used, available, capacity].every(Number.isSafeInteger) || blocks <= 0 || used < 0 ||
        available <= 0 || used > blocks || available > blocks || capacity < 0 || capacity > 100 ||
        !Number.isSafeInteger(available * 1024)) throw new Error('DF_STATUS_UNKNOWN');
    return { filesystem: match[1].trim(), mountedOn: match[6], availableBytes: available * 1024 };
  });
}

export function createHostStorageReceipt(input, options = {}) {
  const at = clock(options);
  const evidence = {
    hostPlatform: input?.hostPlatform ?? null,
    capturedAt: input?.capturedAt ?? null,
    externalFilesystem: input?.externalFilesystem ?? null,
    dfPk: input?.dfPk ?? null,
  };
  const problems = [];
  if (evidence.hostPlatform !== 'darwin') problems.push('HOST_PLATFORM_UNVERIFIED');
  if (evidence.externalFilesystem !== 'apfs') problems.push('EXTERNAL_APFS_UNVERIFIED');
  const captured = typeof evidence.capturedAt === 'string' ? Date.parse(evidence.capturedAt) : NaN;
  if (!validClock(at)) problems.push('HOST_CLOCK_UNKNOWN');
  if (!validClock(captured) || new Date(captured).toISOString() !== evidence.capturedAt) problems.push('HOST_STORAGE_TIME_UNKNOWN');
  else if (validClock(at)) {
    if (captured > at) problems.push('HOST_STORAGE_FUTURE');
    else if (at - captured > MAX_RECEIPT_AGE_MS) problems.push('HOST_STORAGE_STALE');
  }
  let disks = [];
  try {
    disks = parseDfPk(evidence.dfPk);
    if (disks.length !== 2 || disks.filter(disk => disk.mountedOn === '/').length !== 1 ||
        disks.filter(disk => disk.mountedOn === EXTERNAL_MOUNT).length !== 1) throw new Error('DF_STATUS_UNKNOWN');
    if (disks.find(disk => disk.mountedOn === '/').availableBytes < MIN_FREE_BYTES) problems.push('HOST_ROOT_LOW_SPACE');
    if (disks.find(disk => disk.mountedOn === EXTERNAL_MOUNT).availableBytes < MIN_FREE_BYTES) problems.push('HOST_EXTERNAL_LOW_SPACE');
  } catch {
    disks = [];
    problems.push('DF_STATUS_UNKNOWN');
  }
  return {
    kind: 'macos-host-storage', schemaVersion: 1,
    ...evidence, evaluatedAt: validClock(at) ? new Date(at).toISOString() : null,
    dfSha256: typeof evidence.dfPk === 'string' ? hash(evidence.dfPk) : null,
    minFreeBytes: MIN_FREE_BYTES, maxAgeMs: MAX_RECEIPT_AGE_MS,
    disks, allowed: problems.length === 0, problems, modelCalls: 0,
  };
}

// A caller must invoke this immediately before admission; saved allowed=true expires.
export function verifyHostStorageReceipt(receipt, options = {}) {
  try {
    if (!receipt || typeof receipt !== 'object') throw new Error('HOST_STORAGE_RECEIPT_INVALID');
    const evaluated = Date.parse(receipt.evaluatedAt);
    if (!validClock(evaluated)) throw new Error('HOST_STORAGE_RECEIPT_INVALID');
    const original = createHostStorageReceipt(receipt, { now: evaluated });
    // Rebuild rather than trusting projected free bytes, policy values or allowed.
    for (const key of Object.keys(original)) {
      if (JSON.stringify(receipt[key]) !== JSON.stringify(original[key])) throw new Error('HOST_STORAGE_RECEIPT_INVALID');
    }
    if (!original.allowed) return { allowed: false, problems: original.problems };
    const at = clock(options);
    if (validClock(at) && evaluated > at) return { allowed: false, problems: ['HOST_STORAGE_FUTURE'] };
    const current = createHostStorageReceipt(receipt, { now: at });
    return { allowed: current.allowed, problems: current.problems };
  } catch {
    return { allowed: false, problems: ['HOST_STORAGE_RECEIPT_INVALID'] };
  }
}

export function writeHostStorageReceipt(receipt, { directory = process.env.SUPER_AGENT_LOG_ROOT || '/logs' } = {}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'host-storage.json');
  const eventFile = path.join(directory, 'host-storage-events.jsonl');
  for (const target of [directory, file, eventFile]) {
    try {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error('UNSAFE_RECEIPT_PATH');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const body = JSON.stringify(receipt, null, 2) + '\n';
  const sha256 = hash(body);
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  const descriptor = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  // If logging fails, leave the prior receipt intact and propagate the IO error.
  fs.appendFileSync(eventFile, JSON.stringify({
    event: 'host-storage-capture', at: new Date().toISOString(), sha256,
    allowed: receipt.allowed, problems: receipt.problems, modelCalls: 0,
  }) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  return { file, sha256 };
}

export function main(args = process.argv.slice(2)) {
  const directory = process.env.SUPER_AGENT_LOG_ROOT || '/logs';
  if (process.platform !== 'linux') throw new Error('DOCKER_NODE_REQUIRED');
  if (args.length !== 1 || !['capture', 'verify'].includes(args[0])) throw new Error('INVALID_HOST_STORAGE_COMMAND');
  if (args[0] === 'verify') {
    let result;
    try { result = verifyHostStorageReceipt(JSON.parse(fs.readFileSync(path.join(directory, 'host-storage.json'), 'utf8'))); }
    catch { result = { allowed: false, problems: ['HOST_STORAGE_RECEIPT_UNREADABLE'] }; }
    fs.appendFileSync(path.join(directory, 'host-storage-events.jsonl'), JSON.stringify({
      event: 'host-storage-verify', at: new Date().toISOString(), ...result, modelCalls: 0,
    }) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(result));
    if (!result.allowed) process.exitCode = 1;
    return result;
  }
  let input;
  try {
    const bytes = fs.readFileSync(0);
    if (bytes.length > 64 * 1024) throw new Error('HOST_STORAGE_INPUT_TOO_LARGE');
    input = JSON.parse(bytes.toString('utf8'));
  } catch { input = null; }
  const receipt = createHostStorageReceipt(input);
  const saved = writeHostStorageReceipt(receipt, { directory });
  console.log(JSON.stringify({ allowed: receipt.allowed, problems: receipt.problems, ...saved }));
  if (!receipt.allowed) process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(JSON.stringify({ event: 'host-storage-error', errorCode: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'HOST_STORAGE_IO_FAILED', modelCalls: 0 }));
    process.exitCode = 1;
  }
}
