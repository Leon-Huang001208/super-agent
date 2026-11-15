#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkState, imageMatches, readRecordSnapshot } from './runtime-image.mjs';
import { dockerCloseoutDriver } from './runtime-image-closeout-docker.mjs';

const REPOSITORY = 'super-agent-paperclip-runtime';
const KEY = /^[0-9a-f]{64}$/;
const ID = /^sha256:[0-9a-f]{64}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;
const REF = /^(?:(?:docker\.io\/)?library\/)?super-agent-paperclip-runtime(?::[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$/;
const IMAGE_FIELD = /(?:^|[\n,{])\s*["']?image["']?\s*:\s*([^\n]+)/g;
const EXTERNAL_CONFIG_FIELD = /(?:^|[\n,{])\s*["']?(?:include|extends)["']?\s*:/;
const TAG = key => REPOSITORY + ':input-' + key;

function fail(code) {
  throw new Error(code);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function statMatches(a, b) {
  return ['dev', 'ino', 'uid', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
}

function readFile(filename, code, secret = true) {
  try {
    if (!path.isAbsolute(filename) || fs.realpathSync(filename) !== filename) fail(code);
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd);
      const mode = before.mode & 0o777;
      if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid() ||
          (mode & 0o022) || (secret && mode !== 0o600) || before.size > 1024 * 1024) fail(code);
      const bytes = fs.readFileSync(fd);
      if (bytes.length !== before.size || !statMatches(before, fs.fstatSync(fd)) ||
          !statMatches(before, fs.lstatSync(filename))) fail(code);
      return bytes;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    fail(code);
  }
}

function readJson(filename, code) {
  const bytes = readFile(filename, code);
  try {
    return { value: JSON.parse(bytes), hash: digest(bytes) };
  } catch {
    fail(code);
  }
}

function isImage(entry) {
  return entry && typeof entry.key === 'string' && KEY.test(entry.key) &&
    typeof entry.imageId === 'string' && ID.test(entry.imageId);
}

function loadPlan(data, name) {
  if (typeof name !== 'string' || !NAME.test(name)) fail('IMAGE_CLOSEOUT_PLAN_INVALID');
  const planFile = path.join(data, 'image-closeout-plans', name + '.json');
  const { value: plan, hash: planHash } = readJson(planFile, 'IMAGE_CLOSEOUT_PLAN_INVALID');
  if (plan?.schemaVersion !== 1 || !isImage(plan.current) ||
      !(plan.previousImageId === null || (typeof plan.previousImageId === 'string' && ID.test(plan.previousImageId))) ||
      typeof plan.verification !== 'string' || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.json$/.test(plan.verification) ||
      plan.verification.split('/').some(part => part === '.' || part === '..') ||
      !Array.isArray(plan.configs) || plan.configs.length > 128 ||
      !Array.isArray(plan.retire) || plan.retire.length > 64 || !plan.retire.every(isImage) ||
      new Set(plan.retire.map(row => row.key)).size !== plan.retire.length ||
      new Set(plan.retire.map(row => row.imageId)).size !== plan.retire.length) fail('IMAGE_CLOSEOUT_PLAN_INVALID');
  const configurations = new Map();
  for (const config of plan.configs) {
    if (!['startup', 'rollback'].includes(config?.kind) || typeof config.path !== 'string' ||
        !path.isAbsolute(config.path) || configurations.has(config.path) ||
        !Array.isArray(config.images) || !config.images.length ||
        config.images.some(ref => typeof ref !== 'string' || !(ID.test(ref) || REF.test(ref)))) {
      fail('IMAGE_CLOSEOUT_PLAN_INVALID');
    }
    configurations.set(config.path, config);
  }
  if (!plan.configs.some(config => config.kind === 'startup') ||
      (plan.previousImageId !== null && !plan.configs.some(config => config.kind === 'rollback'))) {
    fail('IMAGE_CLOSEOUT_PLAN_INVALID');
  }
  const verificationFile = path.join(data, 'logs', plan.verification);
  const { value: verification, hash: verificationHash } =
    readJson(verificationFile, 'IMAGE_CLOSEOUT_VERIFICATION_INVALID');
  if (verification?.status !== 'PASS' || verification.imageId !== plan.current.imageId ||
      verification.executionClosed !== true || verification.activeSharedLeases !== 0 ||
      verification.liveModelWorkers !== 0) fail('IMAGE_CLOSEOUT_VERIFICATION_INVALID');
  return { plan, planFile, planHash, configurations, verificationFile, verificationHash };
}

function canonical(ref) {
  return typeof ref === 'string' ? ref.replace(/^(?:docker\.io\/)?library\//, '') : '';
}

function refersTo(ref, row) {
  const value = canonical(ref);
  const id = value.split('@').at(-1).replace(/^sha256:/, '');
  return value === TAG(row.key) || (/^[a-f0-9]{12,64}$/.test(id) && row.imageId.slice(7).startsWith(id));
}

function snapshotProtection(closeout, driver) {
  const { plan, configurations } = closeout;
  const files = new Set(configurations.keys());
  const refs = new Set([plan.current.imageId, TAG(plan.current.key), plan.previousImageId]);
  for (const row of driver.observe()) {
    refs.add(row.imageId);
    refs.add(row.image);
    if (/^super-agent(?:-|$)/.test(row.project) || REF.test(row.image) ||
        [plan.current, ...plan.retire].some(image => refersTo(row.imageId, image))) {
      for (const file of row.configFiles) files.add(file);
    }
  }
  const snapshots = new Map();
  for (const file of files) {
    const bytes = readFile(file, 'IMAGE_CLOSEOUT_CONFIG_UNVERIFIED', false);
    const config = configurations.get(file);
    const source = bytes.toString('utf8');
    for (const ref of source.match(/super-agent-paperclip-runtime(?::[a-zA-Z0-9_.-]+|@sha256:[a-f0-9]{64})|sha256:[a-f0-9]{64}/g) ?? []) {
      refs.add(ref);
    }
    const computed = Array.from(source.matchAll(IMAGE_FIELD), match => match[1]);
    if (EXTERNAL_CONFIG_FIELD.test(source) ||
        (!config && computed.some(value => value.includes('${') || /^["']?[>*|]/.test(value)))) {
      fail('IMAGE_CLOSEOUT_CONFIG_UNVERIFIED');
    }
    for (const value of computed) {
      const shortId = /^["']?((?:sha256:)?[a-f0-9]{12,64})(?=[\s"',}#]|$)/.exec(value);
      if (shortId) refs.add(shortId[1]);
    }
    for (const ref of config?.images ?? []) refs.add(ref);
    snapshots.set(file, digest(bytes));
  }
  return { refs, snapshots };
}

function refreshProtection(closeout, prior, driver, identity) {
  if (driver.identity() !== identity) fail('IMAGE_CLOSEOUT_DOCKER_CHANGED');
  if (digest(readFile(closeout.planFile, 'IMAGE_CLOSEOUT_PLAN_CHANGED')) !== closeout.planHash ||
      digest(readFile(closeout.verificationFile, 'IMAGE_CLOSEOUT_VERIFICATION_CHANGED')) !== closeout.verificationHash) {
    fail('IMAGE_CLOSEOUT_EVIDENCE_CHANGED');
  }
  const next = snapshotProtection(closeout, driver);
  for (const [file, hash] of prior.snapshots) {
    if (next.snapshots.get(file) !== hash) fail('IMAGE_CLOSEOUT_CONFIG_CHANGED');
  }
  return next;
}

function observeRecord(state, row) {
  const reference = TAG(row.key);
  const filename = path.join(state, row.key + '.json');
  try {
    fs.lstatSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const { record, bytes } = readRecordSnapshot(filename, row.key, reference);
  if (record.imageId !== row.imageId) return null;
  return { filename, bytes, hash: digest(bytes), reference };
}

function exactImage(image, row) {
  return imageMatches(image, row.key) && image.id === row.imageId &&
    Array.isArray(image.tags) && image.tags.length === 1 && canonical(image.tags[0]) === TAG(row.key) &&
    Array.isArray(image.digests) && image.digests.every(ref => canonical(ref) === REPOSITORY + '@' + row.imageId);
}

function protects(refs, row) {
  return Array.from(refs).some(ref => refersTo(ref, row));
}

function verifyCurrent(state, row, driver) {
  const current = observeRecord(state, row);
  const image = current && driver.inspect(current.reference);
  if (!imageMatches(image, row.key) || image.id !== row.imageId) fail('IMAGE_CLOSEOUT_CURRENT_UNVERIFIED');
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeEvidence(filename, value) {
  fs.writeFileSync(filename, value, { mode: 0o600, flag: 'wx', flush: true });
  syncDirectory(path.dirname(filename));
}

function writeJson(filename, value) {
  writeEvidence(filename, JSON.stringify(value) + '\n');
}

function archiveDirectory(data, name, planHash, create) {
  let parent = data;
  for (const part of ['archives', 'image-closeout-v1', name + '-' + planHash]) {
    const directory = path.join(parent, part);
    if (!checkState(directory, create)) return null;
    if (create) syncDirectory(parent);
    parent = directory;
  }
  return parent;
}

function alreadyRetired(candidate, row, driver) {
  const resultPath = path.join(candidate, 'result.json');
  if (!fs.existsSync(resultPath)) return false;
  const { value } = readJson(resultPath, 'IMAGE_CLOSEOUT_RESULT_UNVERIFIED');
  return value?.decision === 'retired' && value.key === row.key && value.imageId === row.imageId &&
    !driver.inspect(row.imageId) && !driver.inspect(TAG(row.key));
}

export function runImageCloseout({ data, name, driver = dockerCloseoutDriver, log = () => {} }) {
  if (typeof data !== 'string' || !path.isAbsolute(data) || fs.realpathSync(data) !== data) {
    fail('IMAGE_DATA_ROOT_INVALID');
  }
  const closeout = loadPlan(data, name);
  const { plan } = closeout;
  const state = path.join(data, 'image-reuse-v1');
  if (!checkState(state, false)) fail('IMAGE_CLOSEOUT_STATE_REQUIRED');
  const lock = path.join(state, 'build.lock');
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') fail('IMAGE_BUILD_IN_PROGRESS');
    throw error;
  }
  const lockIdentity = fs.lstatSync(lock);
  const lockEvidence = path.join(lock, 'retirement.json');
  let preserve = false;
  try {
    const identity = driver.identity();
    verifyCurrent(state, plan.current, driver);
    let protection = snapshotProtection(closeout, driver);
    let archive = archiveDirectory(data, name, closeout.planHash, false);
    const images = [];
    function record(row, decision) {
      const result = { ...row, decision };
      log({ action: 'image-closeout', name, ...result });
      images.push(result);
    }
    for (const row of plan.retire) {
      protection = refreshProtection(closeout, protection, driver, identity);
      if (protects(protection.refs, row)) {
        record(row, 'keep-protected');
        continue;
      }
      const enrolled = observeRecord(state, row);
      const priorArchive = archive && path.join(archive, row.key);
      if (priorArchive && checkState(priorArchive, false)) {
        record(row, !enrolled && alreadyRetired(priorArchive, row, driver) ? 'retired' : 'keep-unknown');
        continue;
      }
      if (!enrolled || !exactImage(driver.inspect(enrolled.reference), row)) {
        record(row, 'keep-unknown');
        continue;
      }
      archive ??= archiveDirectory(data, name, closeout.planHash, true);
      const candidate = path.join(archive, row.key);
      fs.mkdirSync(candidate, { mode: 0o700 });
      syncDirectory(archive);
      const archiveFile = path.join(candidate, 'image.tar');
      const archiveHash = driver.save({ target: archiveFile, reference: enrolled.reference, imageId: row.imageId });
      if (typeof archiveHash !== 'string' || !KEY.test(archiveHash)) fail('IMAGE_ARCHIVE_UNVERIFIED');
      writeEvidence(path.join(candidate, 'record.json'), enrolled.bytes);
      const evidence = { ...row, reference: enrolled.reference, archiveHash, recordHash: enrolled.hash,
        planHash: closeout.planHash, verificationHash: closeout.verificationHash,
        configurations: Array.from(protection.snapshots, ([file, sha256]) => ({ file, sha256 })) };
      writeJson(path.join(candidate, 'archive.json'), evidence);
      protection = refreshProtection(closeout, protection, driver, identity);
      if (protects(protection.refs, row)) {
        writeJson(path.join(candidate, 'result.json'), { decision: 'keep-protected' });
        record(row, 'keep-protected');
        continue;
      }
      const observed = observeRecord(state, row);
      if (!observed || observed.hash !== enrolled.hash ||
          !exactImage(driver.inspect(enrolled.reference), row)) {
        writeJson(path.join(candidate, 'result.json'), { decision: 'keep-unknown' });
        record(row, 'keep-unknown');
        continue;
      }
      verifyCurrent(state, plan.current, driver);
      writeJson(path.join(candidate, 'intent.json'), evidence);
      preserve = true;
      writeJson(lockEvidence, { archive: candidate, ...row });
      syncDirectory(state);
      try {
        driver.remove(row.imageId, identity);
        if (driver.identity() !== identity || driver.inspect(row.imageId) || driver.inspect(enrolled.reference)) {
          fail('IMAGE_REMOVAL_OUTCOME_UNKNOWN');
        }
        const remaining = observeRecord(state, row);
        if (!remaining || remaining.hash !== enrolled.hash) fail('IMAGE_REMOVAL_OUTCOME_UNKNOWN');
        fs.unlinkSync(remaining.filename);
        syncDirectory(state);
        writeJson(path.join(candidate, 'result.json'), { decision: 'retired', ...row });
        fs.unlinkSync(lockEvidence);
        syncDirectory(lock);
        preserve = false;
      } catch {
        fail('IMAGE_REMOVAL_OUTCOME_UNKNOWN');
      }
      record(row, 'retired');
    }
    return { status: images.some(row => row.decision === 'keep-unknown') ? 'BLOCKED' : 'PASS', images };
  } finally {
    if (!preserve) {
      const actual = fs.lstatSync(lock);
      if (!actual.isDirectory() || actual.dev !== lockIdentity.dev || actual.ino !== lockIdentity.ino ||
          actual.uid !== lockIdentity.uid) fail('IMAGE_CLOSEOUT_LOCK_CHANGED');
      fs.rmdirSync(lock);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = event => process.stderr.write(JSON.stringify({ component: 'image-closeout', ...event }) + '\n');
  try {
    if (process.argv.length !== 3) fail('IMAGE_CLOSEOUT_PLAN_REQUIRED');
    const result = runImageCloseout({ data: process.env.SUPER_AGENT_DATA_ROOT, name: process.argv[2], log });
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    const errorCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'IMAGE_CLOSEOUT_IO_ERROR';
    log({ errorCode });
    process.exitCode = 1;
  }
}
