import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { REAL_RWB_DOCUMENT, REAL_RWB_REPOSITORY, realDigest } from './chief-web-real-engine.mjs';

const guid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const roles = new Set(['chief', 'developer', 'reviewer', 'publish', 'ci']);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export async function createChiefWebRealSpool({ root, config, log, now = Date.now } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root ||
      !guid.test(config?.conversationId ?? '') || !Number.isSafeInteger(config.generation) ||
      !Number.isSafeInteger(config.expiresAt) || typeof log !== 'function') fail('CHIEF_WEB_REAL_SPOOL_CONFIGURATION_INVALID');

  const uid = process.getuid();
  const maxBytes = 48_000;
  async function safeDirectory(directory) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700 ||
        await fs.realpath(directory) !== directory) fail('CHIEF_WEB_REAL_SPOOL_DIRECTORY_UNSAFE');
  }

  await safeDirectory(root);
  const owner = {
    conversationId: config.conversationId, platform: process.platform, host: hostname(), pid: process.pid,
    namespace: process.platform === 'linux' ? await fs.readlink('/proc/self/ns/pid') : null,
  };

  function scoped(request) {
    return guid.test(request?.operationId ?? '') && request.operationId === request.slotId &&
      roles.has(request.role) && request.repository === REAL_RWB_REPOSITORY &&
      request.targetDoc === REAL_RWB_DOCUMENT && request.conversationId === config.conversationId &&
      request.generation === config.generation && [1, 2].includes(request.revision) &&
      digest.test(request.inputRevision ?? '') &&
      ((request.role === 'chief' && request.revision === 1 && request.taskId === null) || guid.test(request.taskId ?? ''));
  }

  async function read(directory, name) {
    const file = path.join(directory, name);
    let handle;
    try { handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== uid || stat.size > maxBytes || (stat.mode & 0o777) !== 0o600 ||
          ![1, 2].includes(stat.nlink)) fail('CHIEF_WEB_REAL_SPOOL_FILE_UNSAFE');
      // A successful atomic link exposes complete bytes. A retained scratch
      // link is allowed only when its private name names this exact inode.
      if (stat.nlink === 2) {
        const links = (await fs.readdir(directory)).filter(n => n.startsWith('.' + name + '.') && guid.test(n.slice(name.length + 2)));
        let owned = false;
        for (const temporary of links) {
          const other = await fs.lstat(path.join(directory, temporary)).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (other?.ino === stat.ino && other.dev === stat.dev && other.uid === uid && other.isFile()) owned = true;
        }
        if (!owned && (await handle.stat()).nlink !== 1) fail('CHIEF_WEB_REAL_SPOOL_FILE_UNSAFE');
      }
      const buffer = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size !== stat.size || size > maxBytes) fail('CHIEF_WEB_REAL_SPOOL_FILE_CHANGED');
      return JSON.parse(buffer.subarray(0, size).toString('utf8'));
    } finally { await handle.close(); }
  }

  async function write(directory, name, value) {
    const payload = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(payload) > maxBytes) fail('CHIEF_WEB_REAL_SPOOL_FILE_LIMIT');
    const temporary = path.join(directory, '.' + name + '.' + randomUUID());
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      try { await handle.writeFile(payload); await handle.sync(); }
      finally { await handle.close(); }
      try { await fs.link(temporary, path.join(directory, name)); }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      const parent = await fs.open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      return true;
    } finally { await fs.unlink(temporary); }
  }

  async function slot(operationId, create = false) {
    if (!guid.test(operationId ?? '')) fail('CHIEF_WEB_REAL_SPOOL_SCOPE_DENIED');
    const directory = path.join(root, operationId);
    if (create) {
      try { await fs.mkdir(directory, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    try { await safeDirectory(directory); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    return directory;
  }

  async function verifyRequest(operationId, directory) {
    const envelope = await read(directory, 'request.json');
    if (!envelope) return null;
    if (envelope.schemaVersion !== 1 || !scoped(envelope.request) || envelope.request.operationId !== operationId ||
        envelope.requestDigest !== realDigest(envelope.request)) fail('CHIEF_WEB_REAL_SPOOL_REQUEST_MISMATCH');
    return envelope;
  }

  async function submit(request) {
    if (!scoped(request)) fail('CHIEF_WEB_REAL_SPOOL_SCOPE_DENIED');
    const payload = JSON.parse(JSON.stringify(request));
    const hash = realDigest(payload);
    const directory = await slot(request.operationId, true);
    const prior = await verifyRequest(request.operationId, directory);
    if (!prior && now() >= config.expiresAt) fail('CHIEF_WEB_REAL_SCOPE_EXPIRED');
    if (!prior) {
      await write(directory, 'request.json', { schemaVersion: 1, requestDigest: hash, request: payload });
    }
    const envelope = await verifyRequest(request.operationId, directory);
    if (envelope?.requestDigest !== hash) fail('CHIEF_WEB_REAL_SPOOL_REQUEST_MISMATCH');
    const receipt = await read(directory, 'response.json');
    if (!receipt) return { status: 'pending' };
    if (receipt.schemaVersion !== 1 || receipt.requestDigest !== hash) fail('CHIEF_WEB_REAL_SPOOL_RESPONSE_MISMATCH');
    return receipt.reply;
  }

  async function withFence(work) {
    const name = 'dispatch-lock.json';
    const lock = path.join(root, name);
    const claim = { ...owner, token: randomUUID() };
    if (!await write(root, name, claim)) {
      const prior = await read(root, name);
      // The application only takes this fence for a board control. A replaced
      // PID namespace in the same container proves its prior holder exited.
      if (!prior || prior.platform !== 'linux' || owner.platform !== 'linux' ||
          prior.host !== owner.host || prior.namespace === owner.namespace ||
          prior.conversationId !== config.conversationId || !guid.test(prior.token ?? '')) {
        fail('CHIEF_WEB_REAL_DISPATCH_FENCE_BUSY');
      }
      const recovery = path.join(root, 'dispatch-lock-recovery');
      try { await fs.mkdir(recovery, { mode: 0o700 }); }
      catch (error) { if (error.code === 'EEXIST') fail('CHIEF_WEB_REAL_DISPATCH_FENCE_BUSY'); throw error; }
      try {
        if ((await read(root, name))?.token !== prior.token) fail('CHIEF_WEB_REAL_DISPATCH_FENCE_BUSY');
        await fs.unlink(lock);
      } finally { await fs.rmdir(recovery); }
      if (!await write(root, name, claim)) fail('CHIEF_WEB_REAL_DISPATCH_FENCE_BUSY');
    }
    try { return await work(); }
    finally {
      if ((await read(root, name))?.token !== claim.token) fail('CHIEF_WEB_REAL_DISPATCH_FENCE_CHANGED');
      await fs.unlink(lock);
    }
  }

  async function setPaused(value) {
    const filename = 'paused.json';
    if (value) await write(root, filename, { schemaVersion: 1, conversationId: config.conversationId });
    else if (await read(root, filename)) await fs.unlink(path.join(root, filename));
    const parent = await fs.open(root, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }

  async function isPaused() {
    const flag = await read(root, 'paused.json');
    if (flag && flag.conversationId !== config.conversationId) fail('CHIEF_WEB_REAL_CONTROL_FENCE_MISMATCH');
    return Boolean(flag);
  }

  async function dispatchFor(directory, envelope) {
    const dispatch = await read(directory, 'dispatch.json');
    if (dispatch && dispatch.requestDigest !== envelope.requestDigest) fail('CHIEF_WEB_REAL_SPOOL_CLAIM_MISMATCH');
    return dispatch;
  }

  return Object.freeze({
    withFence,
    setPaused,
    isPaused,
    async list() {
      return (await fs.readdir(root)).filter(name => guid.test(name)).sort();
    },
    async readRequest(operationId) {
      const directory = await slot(operationId);
      return directory ? verifyRequest(operationId, directory) : null;
    },
    async observe(operationId) {
      const directory = await slot(operationId);
      if (!directory) return null;
      const request = await verifyRequest(operationId, directory);
      if (!request) return null;
      const receipt = await read(directory, 'response.json');
      if (receipt && receipt.requestDigest !== request.requestDigest) fail('CHIEF_WEB_REAL_SPOOL_RESPONSE_MISMATCH');
      return receipt?.reply ?? null;
    },
    async claim(operationId) {
      const directory = await slot(operationId);
      const envelope = directory && await verifyRequest(operationId, directory);
      if (!envelope) fail('CHIEF_WEB_REAL_SPOOL_SCOPE_DENIED');
      if (await dispatchFor(directory, envelope)) return false;
      if (now() >= config.expiresAt || (envelope.request.role === 'publish' &&
        now() >= (envelope.request.confirmation?.expiresAt ?? 0))) fail('CHIEF_WEB_REAL_SCOPE_EXPIRED');
      const claimed = await write(directory, 'dispatch.json', { schemaVersion: 1, requestDigest: envelope.requestDigest, at: now() });
      if (!claimed) await dispatchFor(directory, envelope);
      return claimed;
    },
    async isClaimed(operationId) {
      const directory = await slot(operationId);
      const envelope = directory && await verifyRequest(operationId, directory);
      return Boolean(envelope && await dispatchFor(directory, envelope));
    },
    async rejectUnclaimed(operationId, code) {
      const directory = await slot(operationId);
      const envelope = directory && await verifyRequest(operationId, directory);
      if (!envelope || await dispatchFor(directory, envelope) || !/^CHIEF_WEB_REAL_[A-Z_]+$/.test(code)) {
        fail('CHIEF_WEB_REAL_SPOOL_CLAIM_MISMATCH');
      }
      await write(directory, 'response.json', { schemaVersion: 1, requestDigest: envelope.requestDigest,
        reply: { status: 'blocked', code } });
    },
    async complete(operationId, reply) {
      const directory = await slot(operationId);
      const envelope = directory && await verifyRequest(operationId, directory);
      if (!envelope || (envelope.request.role !== 'ci' &&
        (await read(directory, 'dispatch.json'))?.requestDigest !== envelope.requestDigest)) fail('CHIEF_WEB_REAL_SPOOL_CLAIM_MISSING');
      if (!['completed', 'blocked', 'unknown'].includes(reply?.status)) fail('CHIEF_WEB_REAL_SPOOL_RESPONSE_MISMATCH');
      const receipt = { schemaVersion: 1, requestDigest: envelope.requestDigest, reply };
      if (!await write(directory, 'response.json', receipt) &&
          realDigest(await read(directory, 'response.json')) !== realDigest(receipt)) fail('CHIEF_WEB_REAL_SPOOL_RESPONSE_MISMATCH');
      await log({ code: 'CHIEF_WEB_REAL_SPOOL_RESPONSE', operationId, status: reply.status });
    },
    executor: Object.freeze({ execute: submit, observe: submit }),
    publisher: Object.freeze({ publish: submit, observePublication: submit, readCi: submit }),
  });
}
