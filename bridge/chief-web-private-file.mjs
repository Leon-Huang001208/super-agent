import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

function deny() {
  throw Object.assign(new Error('CHIEF_WEB_PRIVATE_FILE_DENIED'), { code: 'CHIEF_WEB_PRIVATE_FILE_DENIED' });
}

export async function readChiefWebPrivateJson(filename, { recoveryLink = false } = {}) {
  const max = 32_768;
  if (typeof filename !== 'string' || (!filename.startsWith('/paperclip/control/') && filename !== '/paperclip/integration-v1/runtime.json') ||
      path.resolve(filename) !== filename || filename.includes('\0')) deny();
  let cursor = '/';
  for (const part of filename.slice(1).split('/')) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 ||
        (cursor !== filename && (!stat.isDirectory() || (stat.mode & 0o022) !== 0))) deny();
  }
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== 0 || stat.gid !== 0 ||
        (stat.mode & 0o777) !== 0o600 || stat.size > max) deny();
    if (stat.nlink !== 1) {
      if (!recoveryLink || stat.nlink !== 2 ||
          !/^\/paperclip\/control\/chief-web\/recovery-(?:host|leases)\//.test(filename)) deny();
      const directory = path.dirname(filename);
      const prefix = '.' + path.basename(filename) + '.tmp-';
      let matched = false;
      for (const name of await fs.readdir(directory)) {
        if (!name.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(name.slice(prefix.length))) continue;
        const temporary = await fs.lstat(path.join(directory, name)).catch(error => {
          if (error?.code !== 'ENOENT') throw error;
          return null;
        });
        if (temporary?.ino === stat.ino && temporary.dev === stat.dev && temporary.isFile()) matched = true;
      }
      if (!matched && (await file.stat()).nlink !== 1) deny();
    }
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size <= max) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size !== stat.size || size > max) deny();
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally {
    await file.close();
  }
}
