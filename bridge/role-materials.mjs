import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import {ROLE_KEYS} from './role-labels.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const token = /^[a-z][a-z0-9-]{0,47}$/;
const digest = /^[a-f0-9]{64}$/;

/** Deployment-owned manifest. This reader neither grants tools nor creates sessions. */
export function loadRoleMaterials({ root, project, role, manifest, log }) {
  try {
    if (!path.isAbsolute(root ?? '') || !token.test(project ?? '') ||
        !ROLE_KEYS.includes(role) || typeof log !== 'function' ||
        manifest?.schemaVersion !== 1 || manifest.project !== project || manifest.role !== role ||
        !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 32) {
      fail('ROLE_MATERIAL_CONFIG_INVALID');
    }
    const seen = new Set();
    let total = 0;
    const files = manifest.files.map(entry => {
      if (!entry || typeof entry.path !== 'string' || !entry.path ||
          path.posix.normalize(entry.path) !== entry.path || entry.path.includes('\\') ||
          entry.path.split('/').some(part => !part || part === '..' || part === '.') ||
          path.isAbsolute(entry.path) || !digest.test(entry.sha256 ?? '') || seen.has(entry.path)) {
        fail('ROLE_MATERIAL_PATH_DENIED');
      }
      seen.add(entry.path);
      const filename = path.resolve(root, entry.path);
      if (!filename.startsWith(path.resolve(root) + path.sep)) fail('ROLE_MATERIAL_PATH_DENIED');
      let cursor = path.parse(filename).root;
      for (const part of filename.slice(cursor.length).split(path.sep)) {
        cursor = path.join(cursor, part);
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink() || (cursor !== filename && !stat.isDirectory())) fail('ROLE_MATERIAL_LINK_DENIED');
      }
      if (!fs.lstatSync(filename).isFile()) fail('ROLE_MATERIAL_TYPE_DENIED');
      const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      let bytes;
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 262144) fail('ROLE_MATERIAL_SIZE_DENIED');
        total += stat.size;
        if (total > 1048576) fail('ROLE_MATERIAL_SIZE_DENIED');
        bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
          if (!count) fail('ROLE_MATERIAL_CHANGED');
          offset += count;
        }
        const after = fs.fstatSync(fd);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('ROLE_MATERIAL_CHANGED');
      } finally { fs.closeSync(fd); }
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) fail('ROLE_MATERIAL_DIGEST_MISMATCH');
      return { path: entry.path, sha256: entry.sha256, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    });
    if (!seen.has(manifest.instructionsFilePath) || !Array.isArray(manifest.requiredReferences) ||
        manifest.requiredReferences.some(file => !seen.has(file))) fail('ROLE_MATERIAL_REFERENCE_MISSING');
    log({ code: 'ROLE_MATERIAL_READY', project, role, fileCount: files.length, bytes: total });
    return { project, role, instructionsFilePath: path.join(root, manifest.instructionsFilePath), files };
  } catch (error) {
    const code = /^ROLE_MATERIAL_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'ROLE_MATERIAL_READ_FAILED';
    if (typeof log === 'function') log({ code, project, role });
    fail(code);
  }
}

/** No task status or authorization is derived from memory content. */
export function selectRoleKnowledge({ project, role, records }) {
  if (!token.test(project ?? '') || !ROLE_KEYS.includes(role) ||
      !Array.isArray(records) || records.length > 1000) fail('ROLE_KNOWLEDGE_CONFIG_INVALID');
  const latest = new Map(), versions = new Map();
  for (const record of records) {
    if (record?.project !== project || !(record.visibility === 'project' ||
        record.visibility === 'private' && record.role === role)) continue;
    if (!token.test(record.id ?? '') || !Number.isSafeInteger(record.version) || record.version < 1 ||
        !['fact', 'decision', 'experience', 'source'].includes(record.kind) ||
        typeof record.source !== 'string' || !record.source.trim() ||
        typeof record.condition !== 'string' || !record.condition.trim() ||
        typeof record.text !== 'string' || Buffer.byteLength(record.text) > 16384) fail('ROLE_KNOWLEDGE_RECORD_INVALID');
    const key = record.visibility + ':' + (record.visibility === 'private' ? role + ':' : '') + record.id;
    const versionKey = key + ':' + record.version;
    const known = versions.get(versionKey);
    if (known && !isDeepStrictEqual(known, record)) fail('ROLE_KNOWLEDGE_VERSION_CONFLICT');
    versions.set(versionKey, structuredClone(record));
    const previous = latest.get(key);
    if (!previous || previous.version < record.version) latest.set(key, structuredClone(record));
  }
  return [...latest.values()].sort((a, b) => a.id.localeCompare(b.id));
}
