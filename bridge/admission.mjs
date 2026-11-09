import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { verifyHostStorageReceipt } from '../scripts/host-storage.mjs';

const GUID = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
const guid = value => typeof value === 'string' && value.length === 36 && GUID.test(value);
const validNonce = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const failure = code => Object.assign(new Error(code), { code });
const shanghaiCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
const validClock = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;

// This ledger owns only quota and a global launch fence. Paperclip owns tasks.
export class AdmissionMeter {
  #db;
  #log;
  #allowed;
  #closed = false;
  #poisoned = false;

  constructor({ filename, allowedProjectIds, log } = {}) {
    if (typeof log !== 'function' || !Array.isArray(allowedProjectIds) ||
        allowedProjectIds.length === 0 || !allowedProjectIds.every(guid) ||
        typeof filename !== 'string' || !path.isAbsolute(filename)) {
      throw failure('ADMISSION_CONFIGURATION_INVALID');
    }
    this.#log = log;
    this.#allowed = new Set(allowedProjectIds.map(id => id.toLowerCase()));
    try {
      // Do not fix permissions or replace an existing file silently. A lease's
      // nonce must never enter a group/world-readable database or a symlink.
      try { fs.closeSync(fs.openSync(filename, 'wx', 0o600)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      for (const target of [filename, filename + '-wal', filename + '-shm', filename + '-journal']) {
        let info;
        try { info = fs.lstatSync(target); }
        catch (error) { if (error.code === 'ENOENT' && target !== filename) continue; throw error; }
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.nlink !== 1) {
          throw failure('ADMISSION_DATABASE_UNSAFE');
        }
      }
      this.#db = new DatabaseSync(filename);
      this.#db.exec(`
        PRAGMA busy_timeout=5000;
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA foreign_keys=ON;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS admission_meter (
          task_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          first_day TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS admission_meter_first_day ON admission_meter(first_day);
        CREATE TABLE IF NOT EXISTS admission_lease (
          slot INTEGER PRIMARY KEY CHECK (slot = 1),
          task_id TEXT NOT NULL UNIQUE REFERENCES admission_meter(task_id),
          nonce TEXT NOT NULL CHECK (length(nonce) = 64)
        ) STRICT;
        COMMIT;
      `);
    } catch (error) {
      // Closing rolls back a failed schema transaction. Preserve the file and
      // fail closed, including corrupt/unreadable or incompatible databases.
      if (this.#db) {
        try { this.#db.close(); }
        catch { this.#event('ADMISSION_DATABASE_CLOSE_FAILED', null); }
      }
      const code = error.code === 'ADMISSION_DATABASE_UNSAFE' ? error.code : 'ADMISSION_DATABASE_FAILED';
      this.#event(code, null);
      throw failure(code);
    }
  }

  #event(code, taskId) {
    try { this.#log({ code, taskId: guid(taskId) ? taskId.toLowerCase() : null }); }
    catch { throw failure('ADMISSION_LOG_FAILED'); }
  }

  #deny(code, taskId) {
    this.#event(code, taskId);
    throw failure(code);
  }

  #ensureUsable(taskId) {
    if (this.#closed || this.#poisoned) this.#deny('ADMISSION_DATABASE_FAILED', taskId);
  }

  #transaction(taskId, work) {
    this.#ensureUsable(taskId);
    let begun = false;
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      begun = true;
      const result = work();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      let code = /^ADMISSION_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'ADMISSION_DATABASE_FAILED';
      if (begun) {
        try { this.#db.exec('ROLLBACK'); }
        catch { this.#poisoned = true; code = 'ADMISSION_DATABASE_FAILED'; }
      }
      if (code !== 'ADMISSION_LOG_FAILED') this.#event(code, taskId);
      throw failure(code);
    }
  }

  reserveTask(input = {}) {
    this.#ensureUsable(input?.taskId);
    const { taskId, projectId, storageReceipt } = input ?? {};
    if (!guid(taskId)) return this.#deny('ADMISSION_TASK_ID_INVALID', null);
    const id = taskId.toLowerCase();
    if (!guid(projectId) || !this.#allowed.has(projectId.toLowerCase())) {
      return this.#deny('ADMISSION_PROJECT_DENIED', id);
    }
    const at = Object.hasOwn(input, 'now') ? input.now : Date.now();
    if (!validClock(at)) return this.#deny('ADMISSION_CLOCK_INVALID', id);
    if (verifyHostStorageReceipt(storageReceipt, { now: at }).allowed !== true) {
      return this.#deny('ADMISSION_STORAGE_DENIED', id);
    }
    const project = projectId.toLowerCase();
    const parts = Object.fromEntries(shanghaiCalendar.formatToParts(at).map(part => [part.type, part.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    return this.#transaction(id, () => {
      const prior = this.#db.prepare('SELECT project_id FROM admission_meter WHERE task_id=?').get(id);
      if (prior && prior.project_id !== project) throw failure('ADMISSION_TASK_PROJECT_CONFLICT');
      const lease = this.#db.prepare('SELECT task_id FROM admission_lease WHERE slot=1').get();
      if (lease) {
        if (lease.task_id !== id) throw failure('ADMISSION_BUSY');
        this.#event('ADMISSION_RECONCILIATION_REQUIRED', id);
        return { allowed: false, taskId: id, existing: true, reconciliationRequired: true };
      }
      if (!prior) {
        const count = this.#db.prepare('SELECT COUNT(*) AS count FROM admission_meter WHERE first_day=?').get(day).count;
        if (count >= 10) throw failure('ADMISSION_DAILY_LIMIT');
        this.#db.prepare('INSERT INTO admission_meter(task_id,project_id,first_day) VALUES(?,?,?)').run(id, project, day);
      }
      const nonce = randomBytes(32).toString('hex');
      this.#db.prepare('INSERT INTO admission_lease(slot,task_id,nonce) VALUES(1,?,?)').run(id, nonce);
      // This event describes an attempted reservation inside the transaction;
      // only the successfully returned result after COMMIT authorizes launch.
      this.#event('ADMISSION_RESERVING', id);
      return { allowed: true, taskId: id, nonce, newTask: !prior, day };
    });
  }

  release(input = {}) {
    this.#ensureUsable(input?.taskId);
    const { taskId, nonce, terminalEvidence } = input ?? {};
    if (!guid(taskId) || !validNonce(nonce) || terminalEvidence !== true) {
      return this.#deny('ADMISSION_RELEASE_DENIED', taskId);
    }
    const id = taskId.toLowerCase();
    return this.#transaction(id, () => {
      const deleted = this.#db.prepare('DELETE FROM admission_lease WHERE slot=1 AND task_id=? AND nonce=?').run(id, nonce);
      if (deleted.changes !== 1) throw failure('ADMISSION_RELEASE_DENIED');
      this.#event('ADMISSION_RELEASING', id);
      return { released: true, taskId: id };
    });
  }

  // A snapshot check of a previously issued capability, never a new grant.
  // It does not update quota, inspect a new calendar day, or release anything.
  verifyLease(input = {}) {
    this.#ensureUsable(input?.taskId);
    const { taskId, projectId, nonce } = input ?? {};
    const id = guid(taskId) ? taskId.toLowerCase() : null;
    if (!id || !guid(projectId) || !this.#allowed.has(projectId.toLowerCase()) || !validNonce(nonce)) {
      this.#event('ADMISSION_LEASE_DENIED', id);
      return { allowed: false };
    }
    try {
      const match = this.#db.prepare(`
        SELECT 1 AS matched FROM admission_lease AS lease
        JOIN admission_meter AS meter ON meter.task_id=lease.task_id
        WHERE lease.slot=1 AND lease.task_id=? AND meter.project_id=? AND lease.nonce=?
      `).get(id, projectId.toLowerCase(), nonce);
      const allowed = match?.matched === 1;
      this.#event(allowed ? 'ADMISSION_LEASE_VERIFIED' : 'ADMISSION_LEASE_DENIED', id);
      return { allowed };
    } catch (error) {
      if (error.code === 'ADMISSION_LOG_FAILED') throw error;
      return this.#deny('ADMISSION_DATABASE_FAILED', id);
    }
  }

  close() {
    if (this.#closed) return;
    try { this.#db.close(); this.#closed = true; }
    catch { this.#poisoned = true; this.#deny('ADMISSION_DATABASE_FAILED', null); }
  }
}
