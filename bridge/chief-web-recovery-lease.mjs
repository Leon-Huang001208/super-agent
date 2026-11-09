import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CHIEF_WEB_PILOT } from './chief-web-pilot.mjs';
import { readRecoveryPrivate, writeRecoveryPrivate } from './chief-web-recovery-io.mjs';

const control = '/paperclip/control';
const admissionPath = control + '/admission.sqlite';
const activePath = control + '/active-lease.json';
const digest = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
const fail = () => { throw Object.assign(new Error('CHIEF_WEB_RECOVERY_LEASE_UNVERIFIED'), {
  code: 'CHIEF_WEB_RECOVERY_LEASE_UNVERIFIED', status: 'blocked',
}); };
const leaseDigest = lease => hash(JSON.stringify([lease.taskId, lease.projectId, lease.nonce]));
const validLease = (lease, scope) => same(lease, { taskId: scope.taskId, projectId: scope.projectId }) &&
  digest.test(lease.nonce ?? '');

async function openAdmission(readOnly) {
  for (const directory of ['/paperclip', control]) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) fail();
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    let stat;
    try { stat = await fs.lstat(admissionPath + suffix); }
    catch (error) { if (suffix && error?.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 ||
        stat.nlink !== 1 || (stat.mode & 0o077) !== 0) fail();
  }
  return new DatabaseSync(admissionPath, { readOnly, timeout: 5000 });
}

function ownedSlot(database, lease) {
  return database.prepare(`
    SELECT 1 AS matched FROM admission_lease AS lease
    JOIN admission_meter AS meter ON meter.task_id=lease.task_id
    WHERE lease.slot=1 AND lease.task_id=? AND meter.project_id=? AND lease.nonce=?
  `).get(lease.taskId, lease.projectId, lease.nonce)?.matched === 1;
}

export function createChiefWebRecoveryLease({
  readPrivate = readRecoveryPrivate, writePrivate = writeRecoveryPrivate, open = openAdmission,
  unlink = filename => fs.unlink(filename), sync = async directory => {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  },
} = {}) {
  function paths(scope) {
    if (scope.taskId !== CHIEF_WEB_PILOT.taskId || !uuid.test(scope.projectId ?? '') || !digest.test(scope.inputRevision ?? '')) fail();
    const directory = path.join(control, 'chief-web', 'recovery-leases');
    return { directory, intent: path.join(directory, scope.inputRevision + '.intent.json'),
      archive: path.join(directory, scope.inputRevision + '.archive.json') };
  }

  async function read(scope) {
    const files = paths(scope);
    const [active, intent, archived] = await Promise.all([readPrivate(activePath), readPrivate(files.intent), readPrivate(files.archive)]);
    const db = await open(true);
    try {
      if (validLease(active, scope) && ownedSlot(db, active) && !intent && !archived) {
        return { verified: true, taskId: scope.taskId, leaseDigest: leaseDigest(active), active: true, archived: false };
      }
      const lease = archived ?? active;
      if (!validLease(lease, scope) || !same(intent, { taskId: scope.taskId, inputRevision: scope.inputRevision,
        leaseDigest: leaseDigest(lease), nonceDigest: hash(lease.nonce) }) ||
        !digest.test(intent.operationId ?? '') || !digest.test(intent.ciEvidenceDigest ?? '')) return null;
      const owned = ownedSlot(db, lease);
      const ownMarker = validLease(active, scope) && leaseDigest(active) === leaseDigest(lease);
      if ((active?.taskId === scope.taskId && !ownMarker) ||
          (!owned && db.prepare('SELECT 1 FROM admission_lease WHERE task_id=?').get(scope.taskId))) return null;
      if (owned || ownMarker || !archived) return {
        verified: true, taskId: scope.taskId, leaseDigest: intent.leaseDigest, active: false,
        archived: false, reconciliationRequired: true,
      };
      return { verified: true, taskId: scope.taskId, operationId: intent.operationId,
        leaseDigest: intent.leaseDigest, ciEvidenceDigest: intent.ciEvidenceDigest, archiveDigest: hash(JSON.stringify(archived)),
        active: false, archived: true };
    } finally { db.close(); }
  }

  async function finish(scope, reconcile) {
    const files = paths(scope);
    if (!digest.test(scope.operationId ?? '') || !digest.test(scope.ciEvidenceDigest ?? '')) fail();
    const db = await open(false);
    let begun = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      begun = true;
      const [active, intent, archived] = await Promise.all([readPrivate(activePath), readPrivate(files.intent), readPrivate(files.archive)]);
      const lease = archived ?? active;
      if (!validLease(lease, scope) || leaseDigest(lease) !== scope.leaseDigest) fail();
      const owned = ownedSlot(db, lease);
      const ownMarker = validLease(active, scope) && leaseDigest(active) === scope.leaseDigest;
      const expectedIntent = {
        taskId: scope.taskId, inputRevision: scope.inputRevision, operationId: scope.operationId,
        leaseDigest: scope.leaseDigest, nonceDigest: hash(lease.nonce), ciEvidenceDigest: scope.ciEvidenceDigest,
      };
      if ((active?.taskId === scope.taskId && !ownMarker) ||
          (!owned && db.prepare('SELECT 1 FROM admission_lease WHERE task_id=?').get(scope.taskId))) fail();
      if (reconcile) {
        if (!same(intent, expectedIntent) || (!archived && (!owned || !ownMarker)) ||
            (owned && active && !ownMarker)) fail();
      } else {
        if (intent || archived || !owned || !ownMarker) fail();
        await writePrivate(files.intent, expectedIntent);
      }
      if (!archived) await writePrivate(files.archive, lease);
      if (owned) {
        const deleted = db.prepare('DELETE FROM admission_lease WHERE slot=1 AND task_id=? AND nonce=?').run(scope.taskId, lease.nonce);
        if (deleted.changes !== 1) fail();
      }
      if (ownMarker) {
        const current = await readPrivate(activePath);
        if (!validLease(current, scope) || leaseDigest(current) !== scope.leaseDigest) fail();
        await unlink(activePath);
        await sync(control);
      }
      db.exec('COMMIT');
      begun = false;
    } catch (error) {
      if (begun) db.exec('ROLLBACK');
      throw error;
    } finally { db.close(); }
  }

  return Object.freeze({ read, release: scope => finish(scope, false), reconcile: scope => finish(scope, true) });
}
