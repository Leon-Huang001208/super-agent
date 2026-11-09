import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const owner = /^ou_[A-Za-z0-9]{1,200}$/;
const chat = /^[A-Za-z0-9_.:-]{1,160}$/;
const check = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const maxBytes = 65_536;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);

function deny(code) {
  throw Object.assign(new Error(code), { code });
}

function validPaths(paths, validateSupplement) {
  return Array.isArray(paths) && validPathsJson(JSON.stringify(paths), validateSupplement);
}

function validChecks(checks) {
  return Array.isArray(checks) && checks.length > 0 && checks.length <= 20 &&
    checks.every(item => typeof item === 'string' && check.test(item)) && new Set(checks).size === checks.length;
}

function keysAre(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function readPrivate(filename, denied) {
  let fd;
  try {
    fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() ||
        (stat.mode & 0o777) !== 0o600 || stat.size > maxBytes) deny(denied);
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size <= maxBytes) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size !== stat.size || size > maxBytes) deny(denied);
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } catch (error) {
    if (fd === undefined && error?.code === 'ENOENT') return undefined;
    deny(denied);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writePrivate(filename, value) {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, '.admission-' + randomUUID());
  let fd;
  let directoryFd;
  let moved = false;
  try {
    const content = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(content) > maxBytes) deny('FRA_STATE_WRITE_FAILED');
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, filename);
    moved = true;
    directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    fsyncSync(directoryFd);
  } catch {
    deny('FRA_STATE_WRITE_FAILED');
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (directoryFd !== undefined) closeSync(directoryFd);
    if (!moved) {
      try { unlinkSync(temporary); } catch (error) {
        if (error?.code !== 'ENOENT') deny('FRA_STATE_CLEANUP_FAILED');
      }
    }
  }
}

function validPathsJson(value, validateSupplement) {
  // A scope-only check uses the same canonical file policy as a real supplement.
  return validateSupplement('核对执行范围', value)?.ok === true;
}

function validatePolicy(value, validateSupplement) {
  if (!keysAre(value, ['schemaVersion', 'effectiveAt', 'expiresAt', 'scopes']) || value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.effectiveAt) || value.effectiveAt < 0 || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= value.effectiveAt || !Array.isArray(value.scopes) || !value.scopes.length ||
      value.scopes.length > 2) deny('FRA_POLICY_INVALID');
  const scopes = value.scopes.map(scope => {
    if (!keysAre(scope, ['paths', 'checks']) || !validPaths(scope.paths, validateSupplement) || !validChecks(scope.checks)) deny('FRA_POLICY_INVALID');
    return { pathsJson: JSON.stringify(scope.paths), checks: scope.checks };
  });
  if (new Set(scopes.map(scope => scope.pathsJson)).size !== scopes.length) deny('FRA_POLICY_INVALID');
  return { effectiveAt: value.effectiveAt, expiresAt: value.expiresAt, scopes };
}

function validateState(value, validateSupplement) {
  if (!keysAre(value, ['schemaVersion', 'policyDigest', 'reservations']) || value.schemaVersion !== 1 ||
      !matches(value.policyDigest, digest) || !Array.isArray(value.reservations) || value.reservations.length > 4) {
    deny('FRA_STATE_INVALID');
  }
  const keys = ['operationId', 'chatId', 'ownerOpenId', 'requestDigest', 'pathsJson', 'checks', 'version', 'taskId',
    'inputRevision', 'previousRevision', 'previousInputRevision', 'previousHead'];
  const records = value.reservations;
  if (new Set(records.map(record => record?.operationId)).size !== records.length ||
      records.some(record => !keysAre(record, keys) || !matches(record.operationId, uuid) ||
        !matches(record.chatId, chat) || !matches(record.ownerOpenId, owner) || !matches(record.requestDigest, digest) ||
        !validPathsJson(record.pathsJson, validateSupplement) || !validChecks(record.checks) || ![1, 2].includes(record.version) ||
        record.taskId !== null && !matches(record.taskId, uuid) ||
        record.inputRevision !== null && (!record.taskId || !matches(record.inputRevision, digest)) ||
        record.version === 1 && (record.previousRevision !== null || record.previousInputRevision !== null || record.previousHead !== null ||
          (record.taskId === null) !== (record.inputRevision === null)) ||
        record.version === 2 && (!record.taskId || !matches(record.previousRevision, digest) || !matches(record.previousInputRevision, digest) ||
          !matches(record.previousHead, commit) || record.inputRevision === record.previousInputRevision))) deny('FRA_STATE_INVALID');
  const initial = records.filter(record => record.version === 1);
  const supplements = records.filter(record => record.version === 2);
  if (initial.length > 2 || new Set(initial.map(record => record.pathsJson)).size !== initial.length ||
      new Set(initial.filter(record => record.taskId).map(record => record.taskId)).size !== initial.filter(record => record.taskId).length ||
      new Set(supplements.map(record => record.taskId)).size !== supplements.length ||
      supplements.some(record => !initial.some(first => first.taskId === record.taskId &&
        first.inputRevision === record.previousInputRevision && first.pathsJson === record.pathsJson &&
        first.ownerOpenId === record.ownerOpenId && first.chatId === record.chatId &&
        JSON.stringify(first.checks) === JSON.stringify(record.checks)))) deny('FRA_STATE_INVALID');
  return value;
}

function requestKey(request, chatId, ownerOpenId, validateSupplement) {
  if (request?.kind === 'new' && validPaths(request.paths, validateSupplement) && request.pathsJson === JSON.stringify(request.paths) &&
      typeof request.goal === 'string' && request.goal.trim() && Buffer.byteLength(request.goal) <= 16_000 &&
      typeof request.title === 'string' && request.title.trim() && request.title.length <= 160) {
    return hash(['new', chatId, ownerOpenId, request.pathsJson, request.goal, request.title]);
  }
  if (request?.kind === 'supplement' && matches(request.taskId, uuid) && typeof request.text === 'string' &&
      request.text.trim() && Buffer.byteLength(request.text) <= 16_000) {
    return hash(['supplement', chatId, ownerOpenId, request.taskId, request.text]);
  }
  deny('FRA_REQUEST_INVALID');
}

function receipt(record) {
  const { requestDigest: _private, ...visible } = record;
  return structuredClone(visible);
}

/** Each trusted project selects its own scope policy and admission namespace. */
export function createFeishuProjectDeliveryAdmission({ root, namespace, validateSupplement, now = Date.now, readTaskContext } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root ||
      root.includes('\0') || typeof now !== 'function' ||
      typeof namespace !== 'string' || !/^feishu-project-[a-z0-9][a-z0-9-]{0,47}$/.test(namespace) ||
      typeof validateSupplement !== 'function' ||
      (readTaskContext !== undefined && typeof readTaskContext !== 'function')) deny('FRA_CONFIGURATION_INVALID');
  const directory = path.join(root, namespace);
  const stateFile = path.join(directory, 'admission.json');
  let reservationTail = Promise.resolve();
  function directoryExists() {
    try {
      const parent = lstatSync(root);
      if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o022) !== 0) deny('FRA_DIRECTORY_INVALID');
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) deny('FRA_DIRECTORY_INVALID');
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      deny('FRA_DIRECTORY_INVALID');
    }
  }
  function activePolicy() {
    const raw = directoryExists() && readPrivate(path.join(directory, 'policy.json'), 'FRA_POLICY_INVALID');
    if (raw === undefined || raw === false) return null;
    const policy = validatePolicy(raw, validateSupplement);
    const current = now();
    if (!Number.isSafeInteger(current)) deny('FRA_CLOCK_INVALID');
    return current >= policy.effectiveAt && current < policy.expiresAt ? policy : null;
  }
  function readState(policy) {
    const raw = directoryExists() ? readPrivate(stateFile, 'FRA_STATE_INVALID') : undefined;
    const state = raw === undefined ? null : validateState(raw, validateSupplement);
    if (policy && state && state.policyDigest !== hash(policy)) deny('FRA_POLICY_CHANGED');
    return state ?? (policy ? { schemaVersion: 1, policyDigest: hash(policy), reservations: [] } : null);
  }
  async function reserveOne({ operationId, chatId, ownerOpenId, request, previousContext } = {}) {
    if (!matches(operationId, uuid) || !matches(chatId, chat) || !matches(ownerOpenId, owner)) deny('FRA_IDENTITY_INVALID');
    const payload = requestKey(request, chatId, ownerOpenId, validateSupplement);
    const previous = readState()?.reservations.find(item => item.operationId === operationId);
    if (previous) {
      if (previous.requestDigest !== payload) deny('FRA_OPERATION_CONFLICT');
      return receipt(previous);
    }
    const policy = activePolicy();
    if (!policy) deny('FRA_POLICY_DISABLED');
    const state = readState(policy);
    const records = state.reservations;
    const binding = {
      operationId, chatId, ownerOpenId, requestDigest: payload, taskId: null, inputRevision: null,
      previousRevision: null, previousInputRevision: null, previousHead: null,
    };
    if (request.kind === 'new') {
      const scope = policy.scopes.find(item => item.pathsJson === request.pathsJson);
      if (!scope) deny('FRA_SCOPE_NOT_APPROVED');
      if (records.some(item => item.version === 1 && item.pathsJson === scope.pathsJson)) deny('FRA_SCOPE_ALREADY_RESERVED');
      Object.assign(binding, scope, { version: 1 });
    } else {
      const first = records.find(item => item.version === 1 && item.taskId === request.taskId);
      if (!first || first.chatId !== chatId || first.ownerOpenId !== ownerOpenId) deny('FRA_SUPPLEMENT_OWNER_DENIED');
      if (records.some(item => item.version === 2 && item.taskId === first.taskId)) deny('FRA_SUPPLEMENT_ALREADY_RESERVED');
      const previousHead = previousContext?.pr?.headSha ?? previousContext?.pr?.head;
      if (previousContext?.taskId !== first.taskId || previousContext?.status !== 'done' || previousContext.finalized !== true ||
          previousContext?.inputRevision !== first.inputRevision || !matches(previousContext.revision, digest) ||
          !matches(previousHead, commit)) deny('FRA_SUPPLEMENT_CONTEXT_CHANGED');
      const validation = validateSupplement(request.text, first.pathsJson);
      if (validation?.ok !== true) deny(/^FRA_[A-Z_]+$/.test(validation?.code ?? '') ? validation.code : 'FRA_SUPPLEMENT_SCOPE_DENIED');
      Object.assign(binding, { pathsJson: first.pathsJson, checks: first.checks, version: 2,
        taskId: first.taskId, previousRevision: previousContext.revision, previousInputRevision: first.inputRevision, previousHead });
    }
    // The Native controller restarts its epoch when the approved task IDs change.
    // Native done is written before notification and release. Require terminal proof
    // before admitting another task or a supplement into the controller.
    if (records.some(item => item.inputRevision === null)) deny('FRA_BUSY');
    for (const taskId of new Set(records.map(item => item.taskId))) {
      if (taskId === binding.taskId) continue;
      const latest = records.findLast(item => item.taskId === taskId);
      let context;
      try { context = await readTaskContext?.(taskId); } catch { deny('FRA_BUSY'); }
      if (context?.taskId !== taskId || context?.status !== 'done' || context.finalized !== true ||
          context.inputRevision !== latest.inputRevision) deny('FRA_BUSY');
    }
    const stillActive = activePolicy();
    if (!stillActive) deny('FRA_POLICY_DISABLED');
    if (hash(stillActive) !== state.policyDigest) deny('FRA_POLICY_CHANGED');
    records.push(binding);
    writePrivate(stateFile, validateState(state, validateSupplement));
    return receipt(binding);
  }
  function reserve(input) {
    const queued = reservationTail.then(() => reserveOne(input));
    reservationTail = queued.catch(() => {});
    return queued;
  }
  function bind({ operationId, taskId, inputRevision, pathsJson } = {}) {
    if (!matches(operationId, uuid) || !matches(taskId, uuid) || !matches(inputRevision, digest)) deny('FRA_BINDING_INVALID');
    const state = readState();
    const record = state?.reservations.find(item => item.operationId === operationId);
    if (!record || record.pathsJson !== pathsJson || record.taskId !== null && record.taskId !== taskId ||
        inputRevision === record.previousInputRevision || state.reservations.some(item => item !== record &&
          item.version === 1 && record.version === 1 && item.taskId === taskId)) deny('FRA_BINDING_CONFLICT');
    if (record.inputRevision !== null) {
      if (record.inputRevision !== inputRevision) deny('FRA_BINDING_CONFLICT');
      return receipt(record);
    }
    Object.assign(record, { taskId, inputRevision });
    writePrivate(stateFile, validateState(state, validateSupplement));
    return receipt(record);
  }
  function runtimeConfig(base) {
    const policy = activePolicy();
    if (!policy) return base;
    if (base?.dispatchMode !== 'off') deny('FRA_RUNTIME_NOT_OFF');
    const state = readState(policy);
    const allowedTaskIds = state.reservations.filter(item => item.version === 1 && item.inputRevision !== null).map(item => item.taskId);
    return { ...base, dispatchMode: 'controlled', effectiveAtUTCms: policy.effectiveAt, allowedTaskIds };
  }
  function lookup(taskId) {
    if (!matches(taskId, uuid)) return null;
    const state = readState();
    const latest = state?.reservations.findLast(item => item.taskId === taskId && item.inputRevision !== null);
    return latest ? receipt(latest) : null;
  }
  function operation(operationId) {
    if (!matches(operationId, uuid)) return null;
    const record = readState()?.reservations.find(item => item.operationId === operationId);
    return record ? receipt(record) : null;
  }
  function deadline() {
    const policy = activePolicy();
    if (!policy) return null;
    readState(policy);
    return policy.expiresAt;
  }
  return Object.freeze({ enabled: () => Boolean(activePolicy()), deadline,
    reserve, bind, runtimeConfig, lookup, operation });
}
