import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ROLE_KEYS } from './role-labels.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const token = /^[a-z][a-z0-9-]{0,47}$/;
const opaque = /^[A-Za-z0-9_-]{1,256}$/;
const message = /^om_[A-Za-z0-9]{1,245}$/;
const chat = /^oc_[A-Za-z0-9]{1,253}$/;
const digest = /^[a-f0-9]{64}$/;
const kinds = new Set(['fact', 'decision', 'experience', 'source']);
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 1000;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function frozen(value) {
  const copy = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
}

function instant(value, code) {
  if (!(typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) &&
      !(value instanceof Date) && !(typeof value === 'number' && Number.isSafeInteger(value))) fail(code);
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time < 0) fail(code);
  return new Date(time).toISOString();
}

function scopeOf(scope) {
  if (!object(scope) || !uuid.test(scope.companyId ?? '') || !opaque.test(scope.ownerId ?? '') ||
      !uuid.test(scope.projectId ?? '') || !token.test(scope.projectKey ?? '')) fail('PROJECT_KNOWLEDGE_SCOPE_INVALID');
  return { companyId: scope.companyId, ownerId: scope.ownerId, projectId: scope.projectId, projectKey: scope.projectKey };
}

function sourceOf(source) {
  if (!object(source) || !message.test(source.messageId ?? '') || !chat.test(source.chatId ?? '') ||
      !digest.test(source.bodySha256 ?? '') || source.eventId !== undefined && !opaque.test(source.eventId)) {
    fail('PROJECT_KNOWLEDGE_SOURCE_INVALID');
  }
  return { messageId: source.messageId, chatId: source.chatId, bodySha256: source.bodySha256,
    ...(source.eventId !== undefined && { eventId: source.eventId }),
    createdAt: instant(source.createdAt, 'PROJECT_KNOWLEDGE_SOURCE_INVALID') };
}

function visibilityOf(visibility, role) {
  if (!['project', 'private'].includes(visibility) ||
      visibility === 'private' && !ROLE_KEYS.includes(role) ||
      role !== undefined && role !== null && !ROLE_KEYS.includes(role)) fail('PROJECT_KNOWLEDGE_INPUT_INVALID');
  return { visibility, role: visibility === 'private' ? role : null };
}

function inputOf(action, input) {
  if (!object(input) || !token.test(input.id ?? '') || !uuid.test(input.operationId ?? '') ||
      typeof input.text !== 'string' || !input.text.trim() || Buffer.byteLength(input.text) > 16384 ||
      typeof input.condition !== 'string' || !input.condition.trim() || Buffer.byteLength(input.condition) > 2048 ||
      action === 'remember' && !kinds.has(input.kind) ||
      action === 'remember' && input.expectedVersion !== undefined && input.expectedVersion !== null ||
      action === 'correct' && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    fail('PROJECT_KNOWLEDGE_INPUT_INVALID');
  }
  return frozen({ action, scope: scopeOf(input.scope), id: input.id,
    kind: action === 'remember' ? input.kind : null, ...visibilityOf(input.visibility, input.role),
    text: input.text, condition: input.condition, source: sourceOf(input.source), operationId: input.operationId,
    expectedVersion: action === 'correct' ? input.expectedVersion : null });
}

function recordPayload(record) {
  const copy = { ...record };
  delete copy.sha256;
  return copy;
}

function requestForRecord(record, scope, action) {
  return { action, scope, id: record.id, kind: action === 'remember' ? record.kind : null,
    visibility: record.visibility, role: record.visibility === 'private' ? record.role : null,
    text: record.text, condition: record.condition, source: record.confirmation.source,
    operationId: record.confirmation.operationId, expectedVersion: action === 'correct' ? record.version - 1 : null };
}

function searchTerms(query) {
  const terms = new Set();
  for (const word of query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    for (const part of word.split(/\p{Script=Han}+/u)) if (part) terms.add(part);
    for (const run of word.match(/\p{Script=Han}+/gu) ?? []) {
      const chars = Array.from(run);
      if (chars.length === 1) terms.add(run);
      for (let width = 2; width <= Math.min(4, chars.length); width++) {
        for (let start = 0; start <= chars.length - width; start++) terms.add(chars.slice(start, start + width).join(''));
      }
    }
  }
  const all = [...terms];
  // A bounded sample spans the whole allowed query instead of dropping its suffix.
  return all.length <= 128 ? all : Array.from({ length: 128 }, (_, index) => all[Math.floor(index * (all.length - 1) / 127)]);
}

/**
 * Private deployment store, not a model-facing authorization API.
 * Callers derive query scope from a freshly checked Native binding. Writes additionally
 * require authorizeOwner to check the exact immutable Feishu/Native source operation.
 * Each authorized visibility partition has one atomically replaced state file, including
 * its immutable versions and replay receipts. Other partitions are not opened by query.
 */
export function createProjectKnowledgeStore({ root, log, authorizeOwner, now = () => Date.now() } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root || root === '/' ||
      typeof log !== 'function' || typeof authorizeOwner !== 'function' || typeof now !== 'function' ||
      typeof process.getuid !== 'function') fail('PROJECT_KNOWLEDGE_CONFIG_INVALID');
  const uid = process.getuid();

  function emit(event) {
    try {
      const pending = log(event);
      if (pending && typeof pending.then === 'function') {
        // Reject the synchronous contract now, and consume a later rejection safely.
        Promise.resolve(pending).catch(() => undefined);
        fail('PROJECT_KNOWLEDGE_LOG_FAILED');
      }
    } catch { fail('PROJECT_KNOWLEDGE_LOG_FAILED'); }
  }

  function report(error, extra = {}) {
    const code = /^PROJECT_KNOWLEDGE_[A-Z_]+$/.test(error?.code ?? '')
      ? error.code : 'PROJECT_KNOWLEDGE_READ_FAILED';
    let auditFailed = false;
    try { emit({ code, ...extra }); } catch { auditFailed = true; }
    return Object.assign(new Error(code), { code, ...(auditFailed && { auditFailed: true }) });
  }

  function syncDirectory(name) {
    const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
    try {
      if (!fs.fstatSync(fd).isDirectory()) fail('PROJECT_KNOWLEDGE_DIRECTORY_DENIED');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }

  function directory(name, { privateDirectory = false, create = false } = {}) {
    let stat, created = false;
    try { stat = fs.lstatSync(name); }
    catch (error) {
      if (error.code !== 'ENOENT') fail('PROJECT_KNOWLEDGE_DIRECTORY_DENIED');
      if (!create) return false;
      try { fs.mkdirSync(name, { mode: 0o700 });stat = fs.lstatSync(name);created = true; }
      catch { fail('PROJECT_KNOWLEDGE_DIRECTORY_DENIED'); }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        privateDirectory && (stat.uid !== uid || (stat.mode & 0o077))) fail('PROJECT_KNOWLEDGE_DIRECTORY_DENIED');
    if (created) {
      try { syncDirectory(path.dirname(name)); }
      catch { fail('PROJECT_KNOWLEDGE_DIRECTORY_DENIED'); }
    }
    return true;
  }

  function location(scope, visibility, role, create = false) {
    // Ancestors are inspected without following links. Missing parents are not created.
    let cursor = path.parse(root).root;
    const parts = root.slice(cursor.length).split(path.sep);
    for (let i = 0; i < parts.length; i++) {
      cursor = path.join(cursor, parts[i]);
      if (!directory(cursor, { privateDirectory: cursor === root, create: create && cursor === root })) return null;
    }
    // Native identity owns the partition. A key rename must not silently lose its history.
    const scopeDirectory = path.join(root, hash({ companyId: scope.companyId, ownerId: scope.ownerId, projectId: scope.projectId }));
    if (!directory(scopeDirectory, { privateDirectory: true, create })) return null;
    return { directory: scopeDirectory, file: path.join(scopeDirectory, visibility === 'project' ? 'project.json' : 'private-' + role + '.json') };
  }

  function emptyState(scope, visibility, role) {
    return { schemaVersion: 1, scope, visibility, role, records: [], receipts: [] };
  }

  function validateState(state, scope, visibility, role) {
    if (!object(state) || state.schemaVersion !== 1 || !isDeepStrictEqual(state.scope, scope) ||
        state.visibility !== visibility || state.role !== role || !Array.isArray(state.records) ||
        state.records.length > MAX_RECORDS || !Array.isArray(state.receipts) || state.receipts.length !== state.records.length) {
      fail('PROJECT_KNOWLEDGE_RECORD_INVALID');
    }
    const latest = new Map(), records = new Map();
    for (const record of state.records) {
      if (!object(record) || !token.test(record.id ?? '') || !Number.isSafeInteger(record.version) || record.version < 1 ||
          record.project !== scope.projectKey || record.companyId !== scope.companyId || record.ownerId !== scope.ownerId ||
          record.projectId !== scope.projectId || record.visibility !== visibility ||
          (visibility === 'private' ? record.role !== role : record.role !== undefined) || !kinds.has(record.kind) ||
          typeof record.text !== 'string' || !record.text.trim() || Buffer.byteLength(record.text) > 16384 ||
          typeof record.condition !== 'string' || !record.condition.trim() || Buffer.byteLength(record.condition) > 2048 ||
          !digest.test(record.sha256 ?? '') || hash(recordPayload(record)) !== record.sha256 ||
          !object(record.confirmation) || record.confirmation.status !== 'owner-confirmed' ||
          !uuid.test(record.confirmation.operationId ?? '')) fail('PROJECT_KNOWLEDGE_RECORD_INVALID');
      try {
        if (!isDeepStrictEqual(sourceOf(record.confirmation.source), record.confirmation.source) ||
            instant(record.confirmation.confirmedAt, 'PROJECT_KNOWLEDGE_RECORD_INVALID') !== record.confirmation.confirmedAt ||
            record.source !== 'feishu:' + record.confirmation.source.messageId) fail('PROJECT_KNOWLEDGE_RECORD_INVALID');
      } catch { fail('PROJECT_KNOWLEDGE_RECORD_INVALID'); }
      const previous = latest.get(record.id);
      if ((!previous && (record.version !== 1 || record.supersedes !== null)) ||
          previous && (record.version !== previous.version + 1 || record.kind !== previous.kind ||
            !isDeepStrictEqual(record.supersedes, { version: previous.version, sha256: previous.sha256 }) ||
            record.confirmation.source.createdAt < previous.confirmation.source.createdAt)) fail('PROJECT_KNOWLEDGE_RECORD_INVALID');
      latest.set(record.id, record);
      records.set(record.id + ':' + record.version, record);
    }
    const operations = new Set(), sources = new Set(), references = new Set();
    for (const receipt of state.receipts) {
      const record = records.get(receipt?.id + ':' + receipt?.version);
      if (!object(receipt) || !record || !['remember', 'correct'].includes(receipt.action) ||
          receipt.action !== (record.version === 1 ? 'remember' : 'correct') ||
          receipt.operationId !== record.confirmation.operationId || receipt.messageId !== record.confirmation.source.messageId ||
          receipt.bodySha256 !== record.confirmation.source.bodySha256 || receipt.recordSha256 !== record.sha256 ||
          receipt.payloadSha256 !== hash(requestForRecord(record, scope, receipt.action)) ||
          operations.has(receipt.operationId) || sources.has(receipt.messageId) || references.has(record.sha256)) {
        fail('PROJECT_KNOWLEDGE_RECORD_INVALID');
      }
      operations.add(receipt.operationId);sources.add(receipt.messageId);references.add(record.sha256);
    }
    return state;
  }

  function checkReadLock(place, ownedLock) {
    let stat;
    try { stat = fs.lstatSync(place.file + '.lock'); }
    catch (error) {
      if (error.code === 'ENOENT') {
        if (ownedLock) fail('PROJECT_KNOWLEDGE_LOCK_CHANGED');
        return;
      }
      fail('PROJECT_KNOWLEDGE_FILE_DENIED');
    }
    if (!ownedLock) fail('PROJECT_KNOWLEDGE_LOCKED');
    const owned = fs.fstatSync(ownedLock.fd);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== owned.dev || stat.ino !== owned.ino) {
      fail('PROJECT_KNOWLEDGE_LOCK_CHANGED');
    }
  }

  function readState(place, scope, visibility, role, ownedLock = null) {
    if (!place) return emptyState(scope, visibility, role);
    checkReadLock(place, ownedLock);
    let before;
    try { before = fs.lstatSync(place.file); }
    catch (error) {
      if (error.code === 'ENOENT') return emptyState(scope, visibility, role);
      fail('PROJECT_KNOWLEDGE_FILE_DENIED');
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== uid ||
        (before.mode & 0o077) || before.size > MAX_FILE_BYTES) fail('PROJECT_KNOWLEDGE_FILE_DENIED');
    let fd;
    try {
      fd = fs.openSync(place.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o077) || stat.size > MAX_FILE_BYTES) {
        fail('PROJECT_KNOWLEDGE_FILE_DENIED');
      }
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) fail('PROJECT_KNOWLEDGE_READ_FAILED');
        offset += count;
      }
      const after = fs.fstatSync(fd);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('PROJECT_KNOWLEDGE_READ_FAILED');
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { fail('PROJECT_KNOWLEDGE_READ_FAILED'); }
      const state = validateState(value, scope, visibility, role);
      checkReadLock(place, ownedLock);
      return state;
    } catch (error) {
      if (/^PROJECT_KNOWLEDGE_/.test(error?.code ?? '')) throw error;
      fail('PROJECT_KNOWLEDGE_FILE_DENIED');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }

  function release(lock) {
    if (!lock) return;
    try {
      const actual = fs.lstatSync(lock.file), owned = fs.fstatSync(lock.fd);
      if (!actual.isFile() || actual.isSymbolicLink() || actual.dev !== owned.dev || actual.ino !== owned.ino) {
        fail('PROJECT_KNOWLEDGE_LOCK_CHANGED');
      }
      fs.unlinkSync(lock.file);
      syncDirectory(path.dirname(lock.file));
    } catch (error) {
      if (/^PROJECT_KNOWLEDGE_/.test(error?.code ?? '')) throw error;
      fail('PROJECT_KNOWLEDGE_LOCK_RELEASE_FAILED');
    }
  }

  async function write(action, input) {
    let request, lock, writeFailure, keepLock = false, ioStarted = false;
    try {
      request = inputOf(action, input);
      emit({ code: 'PROJECT_KNOWLEDGE_WRITE_REQUESTED', action, project: request.scope.projectKey, id: request.id, operationId: request.operationId });
      let authorized;
      try { authorized = await authorizeOwner(request); }
      catch { fail('PROJECT_KNOWLEDGE_OWNER_CHECK_FAILED'); }
      if (authorized !== true) fail('PROJECT_KNOWLEDGE_OWNER_DENIED');
      const place = location(request.scope, request.visibility, request.role, true);
      const lockFile = place.file + '.lock';
      let fd;
      try { fd = fs.openSync(lockFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
      catch (error) { fail(error.code === 'EEXIST' ? 'PROJECT_KNOWLEDGE_LOCKED' : 'PROJECT_KNOWLEDGE_FILE_DENIED'); }
      lock = { file: lockFile, fd };
      try {
        fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, operationId: request.operationId, payloadSha256: hash(request), at: instant(now(), 'PROJECT_KNOWLEDGE_CLOCK_INVALID') }) + '\n');
        fs.fsyncSync(fd);
        syncDirectory(place.directory);
      } catch { keepLock = true;fail('PROJECT_KNOWLEDGE_COMMIT_UNKNOWN'); }
      const state = readState(place, request.scope, request.visibility, request.role, lock);
      const priorSource = state.receipts.find(item => item.messageId === request.source.messageId);
      const priorOperation = state.receipts.find(item => item.operationId === request.operationId);
      if (priorSource || priorOperation) {
        if (!priorSource || !priorOperation || priorSource !== priorOperation || priorSource.payloadSha256 !== hash(request)) {
          fail('PROJECT_KNOWLEDGE_SOURCE_CONFLICT');
        }
        const record = state.records.find(item => item.id === priorSource.id && item.version === priorSource.version);
        emit({ code: 'PROJECT_KNOWLEDGE_REPLAYED', project: request.scope.projectKey, id: record.id, version: record.version, sha256: record.sha256 });
        return frozen({ record, receipt: priorSource, reused: true });
      }
      const history = state.records.filter(item => item.id === request.id);
      const previous = history.at(-1);
      if (action === 'remember' && previous) fail('PROJECT_KNOWLEDGE_ALREADY_EXISTS');
      if (action === 'correct' && (!previous || request.expectedVersion !== previous.version)) fail('PROJECT_KNOWLEDGE_VERSION_CONFLICT');
      if (previous && request.source.createdAt < previous.confirmation.source.createdAt) fail('PROJECT_KNOWLEDGE_STALE_SOURCE');
      if (state.records.length >= MAX_RECORDS) fail('PROJECT_KNOWLEDGE_CAPACITY_EXCEEDED');
      const payload = {
        id: request.id, version: previous ? previous.version + 1 : 1, project: request.scope.projectKey,
        visibility: request.visibility, ...(request.visibility === 'private' && { role: request.role }),
        kind: previous?.kind ?? request.kind, source: 'feishu:' + request.source.messageId,
        condition: request.condition, text: request.text,
        companyId: request.scope.companyId, ownerId: request.scope.ownerId, projectId: request.scope.projectId,
        confirmation: { status: 'owner-confirmed', source: request.source, operationId: request.operationId,
          confirmedAt: instant(now(), 'PROJECT_KNOWLEDGE_CLOCK_INVALID') },
        supersedes: previous ? { version: previous.version, sha256: previous.sha256 } : null,
      };
      const record = { ...payload, sha256: hash(payload) };
      const receipt = { action, operationId: request.operationId, messageId: request.source.messageId,
        bodySha256: request.source.bodySha256, payloadSha256: hash(request), id: request.id,
        version: record.version, recordSha256: record.sha256 };
      const next = { ...state, records: [...state.records, record], receipts: [...state.receipts, receipt] };
      const bytes = JSON.stringify(next) + '\n';
      if (Buffer.byteLength(bytes) > MAX_FILE_BYTES) fail('PROJECT_KNOWLEDGE_CAPACITY_EXCEEDED');
      const temporary = place.file + '.' + randomUUID() + '.tmp';
      ioStarted = true;
      let temporaryFd;
      try {
        temporaryFd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        fs.writeFileSync(temporaryFd, bytes);fs.fsyncSync(temporaryFd);
      } finally { if (temporaryFd !== undefined) fs.closeSync(temporaryFd); }
      fs.renameSync(temporary, place.file);
      const directoryFd = fs.openSync(place.directory, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      emit({ code: 'PROJECT_KNOWLEDGE_WRITTEN', action, project: request.scope.projectKey, id: record.id, version: record.version, sha256: record.sha256 });
      return frozen({ record, receipt, reused: false });
    } catch (error) {
      if (ioStarted) { keepLock = true;error = Object.assign(new Error('PROJECT_KNOWLEDGE_COMMIT_UNKNOWN'), { code: 'PROJECT_KNOWLEDGE_COMMIT_UNKNOWN' }); }
      writeFailure = report(error, { ...(request && { project: request.scope.projectKey, id: request.id, operationId: request.operationId }) });
      throw writeFailure;
    } finally {
      if (lock) {
        try { if (!keepLock) release(lock); }
        catch (error) {
          const cleanup = report(error);
          if (writeFailure) writeFailure.cleanupCode = cleanup.code;
          else throw cleanup;
        } finally {
          try { fs.closeSync(lock.fd); }
          catch {
            const cleanup = report({ code: 'PROJECT_KNOWLEDGE_LOCK_RELEASE_FAILED' });
            if (writeFailure) writeFailure.cleanupCode = cleanup.code;
            else throw cleanup;
          }
        }
      }
    }
  }

  function query({ scope, role, query = '', limit = 32 } = {}) {
    try {
      const checked = scopeOf(scope);
      if (!ROLE_KEYS.includes(role) || typeof query !== 'string' || Buffer.byteLength(query) > 4096 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 64) fail('PROJECT_KNOWLEDGE_QUERY_INVALID');
      const current = new Map();
      for (const [visibility, privateRole] of [['project', null], ['private', role]]) {
        const state = readState(location(checked, visibility, privateRole), checked, visibility, privateRole);
        for (const record of state.records) current.set(visibility + ':' + record.id, record);
      }
      const terms = searchTerms(query);
      const score = record => {
        const text = (record.id + '\n' + record.condition + '\n' + record.text).normalize('NFKC').toLowerCase();
        return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
      };
      const records = [...current.values()].map(record => ({ record, score: score(record) }))
        .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id) || a.record.visibility.localeCompare(b.record.visibility))
        .slice(0, limit).map(item => item.record);
      emit({ code: 'PROJECT_KNOWLEDGE_QUERIED', project: checked.projectKey, role, count: records.length });
      return frozen(records);
    } catch (error) { throw report(error); }
  }

  function history({ scope, id, visibility, role } = {}) {
    try {
      const checked = scopeOf(scope), partition = visibilityOf(visibility, role);
      if (!token.test(id ?? '')) fail('PROJECT_KNOWLEDGE_INPUT_INVALID');
      const state = readState(location(checked, partition.visibility, partition.role), checked, partition.visibility, partition.role);
      const records = state.records.filter(record => record.id === id);
      emit({ code: 'PROJECT_KNOWLEDGE_HISTORY_READ', project: checked.projectKey, id, count: records.length });
      return frozen(records);
    } catch (error) { throw report(error); }
  }

  return Object.freeze({ remember: input => write('remember', input), correct: input => write('correct', input), query, history });
}
