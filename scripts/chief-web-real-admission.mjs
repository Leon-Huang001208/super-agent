import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AdmissionMeter } from '../bridge/admission.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const shanghaiDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Use the existing shared SQLite meter. The private handoff owns lease evidence. */
export function createChiefWebRealAdmission({ databasePath, projectId, verifyLegacyDrained, storageReceipt, journal, log, now = Date.now } = {}) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath) || !uuid.test(projectId ?? '') ||
      ![verifyLegacyDrained, storageReceipt, journal?.read, journal?.create, journal?.readIntent, journal?.markIntent,
        journal?.readReleaseIntent, journal?.markReleaseIntent, journal?.markReleased, log, now]
        .every(fn => typeof fn === 'function')) fail('CHIEF_WEB_REAL_ADMISSION_CONFIGURATION_INVALID');

  function requireExistingDatabase() {
    if (fs.realpathSync(databasePath) !== databasePath || (fs.lstatSync(databasePath).mode & 0o777) !== 0o600) {
      fail('CHIEF_WEB_REAL_SHARED_ADMISSION_UNSAFE');
    }
  }

  function verifyReadOnlyAdmission() {
    requireExistingDatabase();
    const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
    try {
      if (db.prepare('SELECT task_id FROM admission_lease WHERE slot=1').get()) fail('CHIEF_WEB_REAL_SHARED_LEASE_BUSY');
      const date = shanghaiDay.formatToParts(now());
      const parts = Object.fromEntries(date.map(part => [part.type, part.value]));
      const day = parts.year + '-' + parts.month + '-' + parts.day;
      if (db.prepare('SELECT COUNT(*) AS count FROM admission_meter WHERE first_day=?').get(day).count >= 10) {
        fail('CHIEF_WEB_REAL_DAILY_LIMIT');
      }
    } finally { db.close(); }
  }

  function sharedLease() {
    const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
    try {
      return db.prepare('SELECT a.task_id AS taskId, m.project_id AS projectId, a.nonce FROM admission_lease a JOIN admission_meter m ON a.task_id=m.task_id WHERE a.slot=1').get();
    } finally { db.close(); }
  }

  return Object.freeze({
    async run(request, work) {
      if (!uuid.test(request?.operationId ?? '') || !sha.test(request.inputRevision ?? '') ||
          await verifyLegacyDrained() !== true) fail('CHIEF_WEB_REAL_LEGACY_DISPATCH_UNCERTAIN');
      if (request.role === 'chief' && request.taskId === null) {
        verifyReadOnlyAdmission();
        return work(null);
      }
      if (!uuid.test(request.taskId ?? '')) fail('CHIEF_WEB_REAL_ADMISSION_SCOPE_DENIED');
      requireExistingDatabase();
      const meter = new AdmissionMeter({ filename: databasePath, allowedProjectIds: [projectId], log });
      try {
        let lease = await journal.read(request.operationId);
        if (lease && (lease.taskId !== request.taskId || lease.projectId !== projectId ||
            lease.inputRevision !== request.inputRevision || !sha.test(lease.nonce ?? ''))) {
          fail('CHIEF_WEB_REAL_ADMISSION_SCOPE_DENIED');
        }
        if (lease?.released) return work(null);
        if (!lease) {
          const expected = { taskId: request.taskId, projectId, inputRevision: request.inputRevision };
          const intent = await journal.readIntent(request.operationId);
          const observed = sharedLease();
          if (intent && (intent.taskId !== request.taskId || intent.projectId !== projectId ||
              intent.inputRevision !== request.inputRevision)) fail('CHIEF_WEB_REAL_SHARED_LEASE_UNKNOWN');
          if (!intent) {
            if (observed) fail('CHIEF_WEB_REAL_SHARED_LEASE_BUSY');
            await journal.markIntent(request.operationId, expected);
          }
          let nonce;
          if (observed) {
            if (observed.taskId !== request.taskId || observed.projectId !== projectId ||
                !sha.test(observed.nonce ?? '')) fail('CHIEF_WEB_REAL_SHARED_LEASE_BUSY');
            nonce = observed.nonce;
          } else {
            const reserved = meter.reserveTask({ taskId: request.taskId, projectId, storageReceipt: await storageReceipt(), now: now() });
            if (reserved.allowed !== true) fail('CHIEF_WEB_REAL_SHARED_LEASE_UNAVAILABLE');
            nonce = reserved.nonce;
          }
          lease = { ...expected, nonce };
          await journal.create(request.operationId, lease);
        }
        const releaseIntent = await journal.readReleaseIntent(request.operationId);
        if (releaseIntent && (releaseIntent.taskId !== lease.taskId || releaseIntent.projectId !== projectId ||
            releaseIntent.inputRevision !== lease.inputRevision || releaseIntent.nonce !== lease.nonce)) {
          fail('CHIEF_WEB_REAL_SHARED_LEASE_UNKNOWN');
        }
        if (meter.verifyLease(lease).allowed !== true) {
          if (!releaseIntent || sharedLease()?.taskId === lease.taskId) fail('CHIEF_WEB_REAL_SHARED_LEASE_UNKNOWN');
          await journal.markReleased(request.operationId, lease);
          return work(null);
        }
        const result = await work(lease);
        if (['completed', 'blocked'].includes(result?.status)) {
          if (!releaseIntent) await journal.markReleaseIntent(request.operationId, lease);
          if (meter.release({ ...lease, terminalEvidence: true }).released !== true) fail('CHIEF_WEB_REAL_SHARED_LEASE_UNKNOWN');
          await journal.markReleased(request.operationId, lease);
        }
        return result;
      } finally { meter.close(); }
    },
  });
}
