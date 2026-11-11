import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

export const DEFAULT_POLICY = Object.freeze({cacheBudgetBytes: 20 * 1024 ** 3,
  recordLimit: 100, recordBudgetBytes: 10 * 1024 ** 2});
const KINDS = new Set(["temporary", "evidence", "safety-backup", "deployment", "cache"]);
const EVENTS = new Set(["delivery-accepted", "deployment-accepted", "task-retired", "resume"]);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = code => { throw Object.assign(new Error(code), {code}); };
const inside = (root, file) => file.startsWith(root + path.sep);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const empty = () => ({schemaVersion: 1, host: os.hostname(), projects: {}, resources: [], tasks: [], records: [], sequence: 0});
const cacheTotal = state => state.resources.filter(r => r.kind === "cache").reduce((n, r) => {
  try { return n + fingerprint(r.state === "reclaiming" && fs.existsSync(r.quarantine) ? r.quarantine : r.path).bytes; }
  catch { fail("CACHE_MEASUREMENT_UNKNOWN"); }
}, 0)
  + Object.values(state.externalCaches ?? {}).reduce((n, r) => n + r.bytes, 0);

export function defaultStoreRoot() {
  return path.join(os.homedir(), ".agents", "leon-engineering", "resources", digest(os.hostname()).slice(0, 16));
}

export function prepareResourceDirectory(directory) {
  safePath(directory, true);
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  return safePath(directory);
}

// Inspect each ancestor, including those of the private store. Never follow a symlink.
function safePath(candidate, missing = false) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) fail("PATH_INVALID");
  const resolved = path.resolve(candidate);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail("SYMLINK_FORBIDDEN"); }
    catch (error) { if (missing && error.code === "ENOENT") return resolved; throw error; }
  }
  return resolved;
}

function atomic(file, value) {
  safePath(path.dirname(file));
  if (fs.existsSync(file)) safePath(file);
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value) + "\n", {mode: 0o600, flag: "wx"});
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

// A populated directory is published atomically. Recovery unlinks only the old
// owner's unpredictable filename; rmdir cannot remove a new owner's populated lock.
function acquireLock(lock) {
  const token = crypto.randomUUID(), stage = `${lock}-stage-${token}`, ownerName = `${token}.json`;
  const retireDead = directory => {
    if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) return false;
    const names = fs.readdirSync(directory);
    if (!names.length) {
      try { fs.rmdirSync(directory); return true; }
      catch (error) { if (["ENOENT", "ENOTEMPTY"].includes(error.code)) return false; throw error; }
    }
    if (names.length !== 1 || !/^[a-f0-9-]{36}\.json$/.test(names[0])) return false;
    const filename = path.join(directory, names[0]); safePath(filename);
    const owner = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (owner.schemaVersion !== 1 || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { if (error.code !== "ESRCH") return false; }
    try { fs.unlinkSync(filename); fs.rmdirSync(directory); return true; }
    catch (error) { if (["ENOENT", "ENOTEMPTY"].includes(error.code)) return false; throw error; }
  };
  for (const name of fs.readdirSync(path.dirname(lock)).filter(n => /^\.lock-stage-[a-f0-9-]{36}$/.test(n))) retireDead(path.join(path.dirname(lock), name));
  if (fs.existsSync(lock) && !retireDead(lock)) fail("STORE_LOCKED");
  fs.mkdirSync(stage, {mode: 0o700});
  fs.writeFileSync(path.join(stage, ownerName), JSON.stringify({schemaVersion: 1, pid: process.pid, host: os.hostname()}), {flag: "wx", mode: 0o600});
  try { fs.renameSync(stage, lock); }
  catch (error) {
    fs.unlinkSync(path.join(stage, ownerName)); fs.rmdirSync(stage);
    if (["EEXIST", "ENOTEMPTY", "ENOTDIR"].includes(error.code)) fail("STORE_LOCKED"); throw error;
  }
  return () => {
    fs.unlinkSync(path.join(lock, ownerName));
    try { fs.rmdirSync(lock); }
    catch (error) {
      // A contender may retire the empty release state and publish its populated lock.
      if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  };
}

// Fingerprints cover bytes, inode and permissions. Bounded scans fail closed.
function fingerprint(candidate) {
  safePath(candidate);
  const entries = []; let total = 0, count = 0;
  const walk = (file, relative) => {
    if (++count > 100000) fail("RESOURCE_SCAN_LIMIT");
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) fail("SYMLINK_FORBIDDEN");
    if (path.basename(file) === ".git") fail("GIT_RESOURCE_FORBIDDEN");
    if (!st.isFile() && !st.isDirectory()) fail("RESOURCE_TYPE_INVALID");
    if (st.isFile() && st.nlink !== 1) fail("HARDLINK_FORBIDDEN");
    // Root ctime changes on quarantine rename; file bytes and child identities do not.
    const item = [relative, String(st.dev), String(st.ino), st.mode];
    if (st.isFile()) {
      total += st.size;
      const hash = crypto.createHash("sha256");
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const buffer = Buffer.alloc(1024 * 1024); let n;
        while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
        const after = fs.fstatSync(fd);
        if (st.ino !== after.ino || st.size !== after.size || st.mtimeMs !== after.mtimeMs) fail("RESOURCE_CHANGED_DURING_SCAN");
      } finally { fs.closeSync(fd); }
      item.push(st.size, st.mtimeMs, hash.digest("hex"));
    }
    entries.push(item);
    if (st.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), `${relative}/${name}`);
  };
  walk(candidate, ".");
  return {sha256: digest(JSON.stringify(entries)), bytes: total, entries: count};
}

export function nativeOccupancy(candidate) {
  if (process.platform !== "darwin") return "unknown";
  const result = spawnSync("/usr/sbin/lsof", ["-nP", "-Fpn", ...(fs.statSync(candidate).isDirectory() ? ["+D", candidate] : ["--", candidate])],
    {encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024});
  if (result.error || result.signal || result.stderr?.trim()) return "unknown";
  if (result.status === 1 && !result.stdout.trim()) return "idle";
  return result.status === 0 && /^p\d+/m.test(result.stdout) ? "busy" : "unknown";
}

export function inventoryPaths({paths, state = empty()}) {
  if (!Array.isArray(paths) || paths.length > 50 || paths.some(p => typeof p !== "string" || !path.isAbsolute(p))) fail("INVENTORY_INVALID");
  const items = paths.map(candidate => {
    const item = {path: candidate, action: "review-required", ownership: "unknown", occupancy: "not-probed"};
    try {
      const file = safePath(candidate), st = fs.statSync(file);
      const matching = state.resources.filter(r => r.path === file || inside(file, r.path));
      if (matching.length) { item.ownership = "registered"; item.owners = matching.flatMap(r => r.owners); }
      if (st.isFile()) { item.logicalBytes = st.size; item.allocatedBytes = st.blocks * 512; }
      else if (st.isDirectory() && process.platform === "darwin") {
        const result = spawnSync("/usr/bin/du", ["-sk", file], {encoding: "utf8", timeout: 8000, maxBuffer: 4096});
        if (result.error || result.status !== 0 || !/^\d+\s/.test(result.stdout)) item.measurement = result.error?.code ?? "MEASUREMENT_INCOMPLETE";
        else item.allocatedBytes = Number(result.stdout.match(/^\d+/)[0]) * 1024;
      } else item.measurement = "NOT_RUN";
    } catch (error) { item.measurement = error.code ?? "INVENTORY_FAILED"; }
    return item;
  });
  return {schemaVersion: 1, status: "inventory", items, note: "Allocated bytes are not a promise of reclaimable APFS space."};
}

function validateProof(type, task, proof) {
  if (type === "resume") return;
  if (!proof || proof.schemaVersion !== 1 || proof.task !== task || typeof proof.source !== "string"
    || !ID.test(proof.source)) fail("PROOF_INVALID");
  if (type === "task-retired") {
    if (!["cancelled", "superseded"].includes(proof.disposition) || proof.uniqueWorkPreserved !== true
      || (proof.disposition === "superseded" && !ID.test(proof.successor ?? ""))) fail("PROOF_INVALID");
  } else if (!/^[a-f0-9]{40,64}$/.test(proof.revision ?? "") || proof.verification !== "passed"
    || (type === "deployment-accepted" && (proof.health !== "passed" || !ID.test(proof.target ?? "")
      || !Number.isSafeInteger(proof.generation) || proof.generation < 1))) fail("PROOF_INVALID");
}

function rotate(state, policy) {
  for (const project of Object.keys(state.projects)) {
    const protectedRecord = r => r.project === project && (state.resources.some(x => x.owners.some(o => o.project === project && o.task === r.task))
      || Object.values(state.projects[project].deployments).some(versions => versions.some(v => v.task === r.task)));
    let own = state.records.filter(r => r.project === project);
    for (const record of own) {
      if (own.length <= policy.recordLimit && bytes(own) <= policy.recordBudgetBytes) break;
      if (protectedRecord(record)) continue;
      state.records = state.records.filter(r => r !== record); own = own.filter(r => r !== record);
    }
  }
  state.tasks = state.tasks.filter(t => t.phase === "active" || state.records.some(r => r.project === t.project && r.task === t.task)
    || state.resources.some(r => r.owners.some(o => o.project === t.project && o.task === t.task)));
}

export function createLifecycle({storeRoot = defaultStoreRoot(), occupancy = nativeOccupancy, policy = {}, afterQuarantine} = {}) {
  const rules = {...DEFAULT_POLICY, ...policy};
  if (Object.keys(policy).some(k => !(k in DEFAULT_POLICY)) || Object.values(rules).some(n => !Number.isSafeInteger(n) || n < 1)) fail("POLICY_INVALID");
  safePath(storeRoot, true);
  const ledger = path.join(storeRoot, "ledger.json"), lock = path.join(storeRoot, ".lock");
  const read = () => {
    if (!fs.existsSync(ledger)) return empty();
    safePath(ledger);
    const state = JSON.parse(fs.readFileSync(ledger, "utf8"));
    if (state.schemaVersion !== 1 || state.host !== os.hostname() || !state.projects || !Array.isArray(state.resources)
      || !Array.isArray(state.tasks) || !Array.isArray(state.records)) fail("STORE_INVALID");
    return state;
  };
  const persist = state => atomic(ledger, state);
  const mutate = operation => {
    safePath(storeRoot, true); fs.mkdirSync(storeRoot, {recursive: true, mode: 0o700}); safePath(storeRoot);
    const release = acquireLock(lock);
    try {
      const state = read(); const result = operation(state); rotate(state, rules); persist(state);
      // A bounded current log, not another unbounded archive. Payloads contain no file contents or proof text.
      const logs = path.join(storeRoot, "logs"); safePath(logs, true); fs.mkdirSync(logs, {recursive: true, mode: 0o700});
      atomic(path.join(logs, "resource-lifecycle.json"), {schemaVersion: 1, sequence: state.sequence,
        status: result.status ?? "registered", resourceCount: state.resources.length, at: new Date().toISOString()});
      return result;
    } finally { release(); }
  };
  const projectKey = project => safePath(project);
  const enrolled = (state, project) => {
    const key = projectKey(project); if (!state.projects[key]) fail("PROJECT_NOT_ENROLLED"); return key;
  };
  const taskFor = (state, project, task) => {
    if (!ID.test(task ?? "")) fail("TASK_INVALID");
    let record = state.tasks.find(t => t.project === project && t.task === task);
    if (!record) { record = {project, task, phase: "active"}; state.tasks.push(record); }
    return record;
  };
  const activeOwner = (state, owner) => !state.tasks.some(t => t.project === owner.project && t.task === owner.task && t.phase !== "active");
  const classify = (state, resource, cacheBytes) => {
    if (resource.protection) return "protected";
    if (resource.owners.some(o => activeOwner(state, o))) return "task-active";
    if (resource.kind === "deployment") {
      if (resource.owners.some(o => (state.projects[o.project]?.deployments[resource.target] ?? []).some(v => v.revision === resource.revision))) return "rollback-version";
      if (resource.owners.some(o => !state.tasks.find(t => t.project === o.project && t.task === o.task)?.deployedTargets?.includes(resource.target))) return "deployment-not-accepted";
    }
    if (resource.kind === "cache" && cacheBytes <= rules.cacheBudgetBytes) return "cache-within-budget";
    return null;
  };
  const inspect = (state, verifyIdentity = true) => {
    let cacheBytes = cacheTotal(state);
    return [...state.resources].sort((a, b) => a.lastUsed - b.lastUsed).map(resource => {
      let reason = classify(state, resource, cacheBytes);
      if (!reason && verifyIdentity) {
        try {
          const target = resource.state === "reclaiming" && fs.existsSync(resource.quarantine) ? resource.quarantine : resource.path;
          if (fingerprint(target).sha256 !== resource.identity.sha256) reason = "IDENTITY_CHANGED";
          else { const used = occupancy(target); if (used !== "idle") reason = used === "busy" ? "RESOURCE_BUSY" : "OCCUPANCY_UNKNOWN"; }
        } catch (error) { reason = error.code === "ENOENT" && resource.state === "reclaiming" ? null : error.code ?? "INSPECTION_FAILED"; }
      }
      if (!reason && resource.kind === "cache") cacheBytes -= resource.identity.bytes;
      return {id: resource.id, path: resource.path, bytes: resource.identity.bytes,
        action: reason ? "retain" : "delete", reason};
    });
  };
  const sweep = state => {
    const items = inspect(state), reclaimed = [];
    for (const item of items.filter(i => i.action === "delete")) {
      const resource = state.resources.find(r => r.id === item.id);
      try {
        if (resource.state !== "reclaiming") {
          resource.state = "reclaiming";
          resource.quarantine = path.join(path.dirname(resource.path), `.leon-retired-${resource.id}`);
          if (fs.existsSync(resource.quarantine)) fail("QUARANTINE_CONFLICT");
          persist(state); // Journal before rename. Restart can locate either original or quarantine.
        }
        safePath(path.dirname(resource.path));
        if (fs.existsSync(resource.path)) {
          if (fs.existsSync(resource.quarantine)) fail("RESOURCE_RECREATED");
          if (fingerprint(resource.path).sha256 !== resource.identity.sha256) fail("IDENTITY_CHANGED");
          fs.renameSync(resource.path, resource.quarantine);
          if (afterQuarantine) afterQuarantine(resource);
        }
        if (fs.existsSync(resource.quarantine)) {
          if (fingerprint(resource.quarantine).sha256 !== resource.identity.sha256) fail("IDENTITY_CHANGED");
          const used = occupancy(resource.quarantine);
          if (used !== "idle") fail(used === "busy" ? "RESOURCE_BUSY" : "OCCUPANCY_UNKNOWN");
          fs.rmSync(resource.quarantine, {recursive: true});
        }
        reclaimed.push({id: resource.id, bytes: resource.identity.bytes});
        for (const owner of resource.owners) {
          const summary = state.records.find(r => r.project === owner.project && r.task === owner.task);
          if (summary) {
            const previous = summary.retiredResources ?? {count: 0, bytes: 0, seal: ""};
            summary.retiredResources = {count: previous.count + 1, bytes: previous.bytes + resource.identity.bytes,
              seal: digest(previous.seal + resource.id + resource.identity.sha256)};
          }
        }
        state.resources = state.resources.filter(r => r.id !== resource.id); persist(state);
      } catch (error) { item.action = "retain"; item.reason = error.code ?? "DELETE_INTERRUPTED"; }
    }
    const benign = new Set(["protected", "task-active", "rollback-version", "deployment-not-accepted", "cache-within-budget"]);
    const blocked = items.filter(i => i.reason && !benign.has(i.reason));
    const cacheBytes = cacheTotal(state);
    return {status: blocked.length || cacheBytes > rules.cacheBudgetBytes ? "blocked" : "cleaned", items, reclaimed, cacheBytes,
      cacheBudgetBytes: rules.cacheBudgetBytes};
  };
  return {
    enroll({project, roots}) {
      return mutate(state => {
        const key = projectKey(project);
        if (!Array.isArray(roots) || !roots.length) fail("ROOTS_INVALID");
        const safeRoots = roots.map(r => safePath(r));
        if (safeRoots.some(r => !fs.statSync(r).isDirectory() || r === path.parse(r).root || r === os.homedir()
          || r === key || inside(r, storeRoot) || inside(storeRoot, r))) fail("ROOTS_INVALID");
        if (state.projects[key] && state.projects[key].roots.some(r => !safeRoots.includes(r))) fail("ENROLLMENT_CONFLICT");
        state.projects[key] ??= {roots: safeRoots, deployments: {}};
        state.projects[key].roots = [...new Set(safeRoots)];
        return {status: "enrolled", project: key};
      });
    },
    register(spec) {
      return mutate(state => {
        const project = enrolled(state, spec.project), target = safePath(spec.path);
        if (!KINDS.has(spec.kind)) fail("KIND_INVALID");
        const roots = state.projects[project].roots;
        if (roots.includes(target)) fail("ROOT_RESOURCE_FORBIDDEN");
        if (!roots.some(root => inside(root, target)) || target === project || inside(target, project)
          || inside(target, storeRoot) || inside(storeRoot, target)) fail("RESOURCE_OUTSIDE_ROOTS");
        if (spec.kind === "deployment" && (!ID.test(spec.target ?? "") || !/^[a-f0-9]{40,64}$/.test(spec.revision ?? ""))) fail("DEPLOYMENT_INVALID");
        if (spec.protection !== undefined && !ID.test(spec.protection)) fail("PROTECTION_INVALID");
        const task = taskFor(state, project, spec.task);
        if (task.phase !== "active") fail("TASK_ALREADY_ACCEPTED");
        const overlap = state.resources.find(r => r.path !== target && (inside(target, r.path) || inside(r.path, target)));
        if (overlap) fail("RESOURCE_OVERLAP");
        const identity = fingerprint(target);
        if (spec.evidence !== undefined && (spec.kind !== "evidence" || !spec.evidence
          || !/^observation-[a-f0-9]{24}$/.test(spec.evidence.observationId ?? "")
          || !/^[a-f0-9]{64}$/.test(spec.evidence.sha256 ?? "") || bytes(spec.evidence) > 4096
          || Object.keys(spec.evidence).some(k => !["observationId", "verifierId", "status", "sha256", "fullBytes", "durationMs"].includes(k)))) fail("EVIDENCE_INVALID");
        let resource = state.resources.find(r => r.path === target);
        if (resource) {
          if (resource.state !== "registered" || resource.kind !== spec.kind || resource.identity.sha256 !== identity.sha256
            || resource.target !== spec.target || resource.revision !== spec.revision || resource.protection !== spec.protection) fail("REGISTRATION_CONFLICT");
        } else {
          resource = {id: crypto.randomUUID(), path: target, kind: spec.kind, target: spec.target, revision: spec.revision,
            protection: spec.protection, evidence: spec.evidence, identity, owners: [], state: "registered"}; state.resources.push(resource);
        }
        if (!resource.owners.some(o => o.project === project && o.task === spec.task)) resource.owners.push({project, task: spec.task});
        resource.lastUsed = ++state.sequence;
        return structuredClone(resource);
      });
    },
    event({project, task, type, proof}) {
      if (!EVENTS.has(type)) fail("EVENT_INVALID"); validateProof(type, task, proof);
      return mutate(state => {
        const key = enrolled(state, project);
        if (!ID.test(task ?? "")) fail("TASK_INVALID");
        const record = type === "resume" ? state.tasks.find(t => t.project === key && t.task === task) : taskFor(state, key, task);
        if (type === "task-retired" && proof.disposition === "superseded"
          && !state.tasks.some(t => t.project === key && t.task === proof.successor && t.phase === "accepted")) fail("SUCCESSOR_NOT_ACCEPTED");
        if (type === "delivery-accepted") {
          if (record.revision && record.revision !== proof.revision) fail("REVISION_CONFLICT");
          record.phase = "accepted"; record.revision = proof.revision;
        }
        if (type === "task-retired") record.phase = "retired";
        if (type === "deployment-accepted") {
          const versions = state.projects[key].deployments[proof.target] ?? [];
          const watermarks = state.projects[key].deploymentWatermarks ??= {};
          if (proof.generation <= (watermarks[proof.target] ?? 0)
            && !versions.some(v => v.generation === proof.generation && v.task === task && v.revision === proof.revision)) fail("DEPLOYMENT_EVENT_STALE");
          if (record.phase !== "accepted") fail("DELIVERY_NOT_ACCEPTED");
          if (record.revision !== proof.revision) fail("REVISION_CONFLICT");
          if (proof.generation <= (watermarks[proof.target] ?? 0)) {
            if (!versions.some(v => v.generation === proof.generation && v.task === task && v.revision === proof.revision)) fail("DEPLOYMENT_EVENT_STALE");
          } else {
            state.projects[key].deployments[proof.target] = [{task, revision: proof.revision, generation: proof.generation},
              ...versions.filter(v => v.revision !== proof.revision)].slice(0, 2);
            watermarks[proof.target] = proof.generation;
          }
          record.deployedTargets = [...new Set([...(record.deployedTargets ?? []), proof.target])];
        }
        if (proof) {
          const existing = state.records.find(r => r.project === key && r.task === task);
          const summary = {project: key, task, revision: proof.revision ?? null, verification: proof.verification ?? null,
            source: proof.source, proofSha256: digest(JSON.stringify(proof)), originalEvidence: "eligible-for-retirement"};
          if (existing) {
            existing.events ??= {}; existing.events[type] = summary.proofSha256;
            // Preserve the delivery revision when a retirement event has no revision.
            Object.assign(existing, {...summary, revision: proof.revision ?? existing.revision});
          } else { summary.events = {[type]: summary.proofSha256}; state.records.push(summary); }
        }
        for (const resource of state.resources.filter(r => r.evidence && r.owners.some(o => o.project === key && o.task === task))) {
          const summary = state.records.find(r => r.project === key && r.task === task);
          if (summary) {
            summary.observations ??= {};
            summary.observations[resource.evidence.observationId] = {evidence: resource.evidence,
              seal: digest(JSON.stringify(resource.evidence))};
          }
        }
        // Released cache leases are not permanent protection anchors for all old task summaries.
        for (const resource of state.resources.filter(r => r.kind !== "deployment")) {
          const active = resource.owners.filter(o => activeOwner(state, o));
          const released = resource.owners.filter(o => !activeOwner(state, o));
          resource.owners = [...active, ...released.slice(-1)];
        }
        persist(state); // Acceptance and summary survive an interrupted deletion.
        const result = sweep(state);
        const signature = digest(JSON.stringify({status: result.status, debt: result.items.filter(i => i.action === "retain").map(i => [i.id, i.reason])}));
        result.notify = state.lastSignature !== signature; state.lastSignature = signature;
        const own = state.records.find(r => r.project === key && r.task === task);
        if (own) own.cleanup = result.status;
        return result;
      });
    },
    preview() { return {status: "preview", items: inspect(read())}; },
    status() {
      const state = read();
      return {...state, cacheBytes: cacheTotal(state),
        policy: rules, recordOverBudget: Object.keys(state.projects).some(project => {
          const own = state.records.filter(r => r.project === project);
          return own.length > rules.recordLimit || bytes(own) > rules.recordBudgetBytes;
        })};
    },
    isEnrolled(project) { return Object.hasOwn(read().projects, projectKey(project)); },
    reportCache({project, adapter, bytes: measuredBytes, receiptSha256}) {
      return mutate(state => {
        const key = enrolled(state, project);
        if (!ID.test(adapter ?? "") || !Number.isSafeInteger(measuredBytes) || measuredBytes < 0
          || !/^[a-f0-9]{64}$/.test(receiptSha256 ?? "")) fail("CACHE_REPORT_INVALID");
        state.externalCaches ??= {};
        if (state.externalCaches[adapter] && state.externalCaches[adapter].project !== key) fail("CACHE_ADAPTER_OWNERSHIP_CONFLICT");
        state.externalCaches[adapter] = {project: key, bytes: measuredBytes, receiptSha256, sequence: ++state.sequence};
        return {status: "measured", cacheBytes: cacheTotal(state)};
      });
    },
    resumeOnce({project, task}) {
      const state = read(), key = enrolled(state, project);
      if (state.projects[key].lastResumeTask === task && !state.resources.length) return null;
      const result = this.event({project, task, type: "resume"});
      mutate(current => { current.projects[key].lastResumeTask = task; return {status: "resumed"}; });
      return result;
    },
    retiredEvidence({project, task, observationId}) {
      const key = enrolled(read(), project), state = read();
      const summary = state.records.find(r => r.project === key && r.task === task);
      const observation = summary?.observations?.[observationId];
      if (!observation) return null;
      if (observation.seal !== digest(JSON.stringify(observation.evidence))) fail("EVIDENCE_SUMMARY_INVALID");
      if (state.resources.some(r => r.evidence?.observationId === observationId)) return null;
      return {...observation, originalEvidence: "retired", cleanup: summary.cleanup};
    }
  };
}
