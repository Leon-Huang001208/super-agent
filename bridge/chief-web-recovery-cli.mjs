import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { runChiefWebRecoveryCommand } from './chief-web-runtime-bootstrap.mjs';

const log = async outcome => {
  const code = /^CHIEF_WEB_[A-Z_]+$/.test(outcome.code ?? '') ? outcome.code : 'CHIEF_WEB_RECOVERY_RESULT_UNKNOWN';
  const operationId = /^[a-f0-9]{64}$/.test(outcome.operationId ?? '') ? outcome.operationId : undefined;
  const filename = '/paperclip/logs/chief-web-recovery.jsonl';
  const directory = await fs.lstat('/paperclip/logs');
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || directory.gid !== 0 ||
      (directory.mode & 0o022) !== 0) throw new Error('CHIEF_WEB_RECOVERY_LOG_DENIED');
  const handle = await fs.open(filename, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600) {
      throw new Error('CHIEF_WEB_RECOVERY_LOG_DENIED');
    }
    await handle.writeFile(JSON.stringify({ timestamp: new Date().toISOString(), code, operationId }) + '\n');
  } finally { await handle.close(); }
};

async function password() {
  for (const filename of ['/paperclip', '/paperclip/secrets']) {
    const stat = await fs.lstat(filename);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) {
      throw new Error('CHIEF_WEB_RECOVERY_CONFIG_DENIED');
    }
  }
  const handle = await fs.open('/paperclip/secrets/postgres-password', constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 ||
        (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > 4096) throw new Error('CHIEF_WEB_RECOVERY_CONFIG_DENIED');
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const value = buffer.subarray(0, bytesRead).toString('utf8').trim();
    if (bytesRead !== stat.size || !value || /[\r\n\0]/.test(value)) throw new Error('CHIEF_WEB_RECOVERY_CONFIG_DENIED');
    return value;
  } finally { await handle.close(); }
}

let db;
try {
  if (process.getuid?.() !== 0 || process.env.SUPER_AGENT_CHIEF_WEB_RECOVERY_ENABLED !== '1') {
    throw new Error('CHIEF_WEB_RECOVERY_OPERATOR_DISABLED');
  }
  const { createDb } = await import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js');
  db = createDb('postgres://paperclip:' + encodeURIComponent(await password()) + '@db:5432/paperclip',
    { maxConnections: 2, applicationName: 'super-agent-chief-web-recovery' });
  const result = await runChiefWebRecoveryCommand(process.argv.slice(2), { db, log });
  process.stdout.write(JSON.stringify(result) + '\n');
  if (['blocked', 'unknown'].includes(result.status)) process.exitCode = 1;
} catch (error) {
  const code = /^CHIEF_WEB_[A-Z_]+$/.test(error?.code ?? error?.message ?? '')
    ? error.code ?? error.message : 'CHIEF_WEB_RECOVERY_COMMAND_FAILED';
  process.stderr.write(JSON.stringify({ code }) + '\n');
  process.exitCode = 1;
} finally {
  if (db) {
    try { await db.$client.end({ timeout: 5 }); }
    catch {
      process.stderr.write('{"code":"CHIEF_WEB_RECOVERY_DB_CLOSE_FAILED"}\n');
      process.exitCode = 1;
    }
  }
}
