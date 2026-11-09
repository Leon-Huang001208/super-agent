import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readChiefWebPrivateJson } from './chief-web-private-file.mjs';

const root = '/paperclip/control/chief-web';
const digest = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code, status: 'blocked' }); };

export async function readRecoveryPrivate(filename) {
  try { return await readChiefWebPrivateJson(filename, { recoveryLink: true }); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

export async function writeRecoveryPrivate(filename, value) {
  if (!filename.startsWith(root + '/') || path.resolve(filename) !== filename) fail('CHIEF_WEB_RECOVERY_PRIVATE_PATH_DENIED');
  const directory = path.dirname(filename);
  let cursor = '/';
  for (const part of directory.slice(1).split('/')) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 ||
        (stat.mode & 0o022) !== 0) fail('CHIEF_WEB_RECOVERY_PRIVATE_PATH_DENIED');
  }
  const dir = await fs.open(directory, constants.O_DIRECTORY | constants.O_RDONLY | constants.O_NOFOLLOW);
  const temporary = path.join(directory, '.' + path.basename(filename) + '.tmp-' + randomUUID());
  let created = false;
  try {
    const file = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await fs.link(temporary, filename);
    await dir.sync();
  } finally {
    try { if (created) { await fs.unlink(temporary); await dir.sync(); } }
    finally { await dir.close(); }
  }
}

/** Fixed root-only handoff to the installed Mac RWB Git Safety worker. */
export function createChiefWebRecoveryHostHandoff({ read = readRecoveryPrivate, write = writeRecoveryPrivate, now = Date.now } = {}) {
  const file = (scope, name) => {
    if (!digest.test(scope.confirmationOperationId ?? '')) fail('CHIEF_WEB_RECOVERY_PUBLICATION_SCOPE_DENIED');
    return path.join(root, 'recovery-host', scope.confirmationOperationId, name);
  };

  async function witness(scope, name, freshness) {
    const data = await read(file(scope, name));
    if (data?.scopeDigest !== scope.scopeDigest ||
        (freshness !== undefined && (!Number.isSafeInteger(data.observedAt) ||
          now() < data.observedAt || now() - data.observedAt >= freshness))) return null;
    return data;
  }

  const request = scope => ({ schemaVersion: 1, action: 'publish_existing_pr', scope });
  return Object.freeze({
    readPrepared: scope => witness(scope, 'prepared.json', 45_000),
    readRemote: scope => witness(scope, 'remote.json', 45_000),
    readPublicationReceipt: scope => witness(scope, 'publication.json'),
    readCiEvidence: (scope, eventId) => witness(scope, 'ci-' + hash(eventId) + '.json', 45_000),
    async publishExisting(scope) {
      await write(file(scope, 'request.json'), request(scope));
    },
    async recoverRequest(scope) {
      const names = ['request.json', 'host-dispatch.json', 'publication.json'];
      if ((await Promise.all(names.map(name => read(file(scope, name))))).some(record => record != null)) return false;
      try { await write(file(scope, 'request.json'), request(scope)); }
      catch (error) { if (error?.code === 'EEXIST') return false; throw error; }
      return true;
    },
  });
}
