import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {resolveHarnessStorage} from "./harness-storage.mjs";

const enginePath = [new URL("../lib/resources/lifecycle.mjs", import.meta.url), new URL("./lib/resources/lifecycle.mjs", import.meta.url)]
  .find(file => fs.existsSync(file));
if (!enginePath) throw new Error("LIFECYCLE_RUNTIME_MISSING");
export const {createLifecycle, prepareResourceDirectory, inventoryPaths} = await import(enginePath.href);

export function activateProjectResources({projectRoot}) {
  const storage = resolveHarnessStorage({projectRoot});
  const api = createLifecycle();
  const enrolled = api.isEnrolled(storage.projectRoot);
  if (!enrolled) {
    const config = path.join(os.homedir(), ".agents/leon-engineering/resource-policy.json");
    if (!fs.existsSync(config)) return null;
    if (fs.lstatSync(config).isSymbolicLink()) throw new Error("POLICY_INVALID");
    const policy = JSON.parse(fs.readFileSync(config, "utf8"));
    if (policy.schemaVersion !== 1 || policy.enabled !== true) return null;
  }
  // Auto-enrollment owns only future Harness observation files, never existing unknown artifacts.
  const logs = path.join(storage.directory, "logs");
  if (fs.existsSync(logs) && fs.lstatSync(logs).isSymbolicLink()) throw new Error("SYMLINK_FORBIDDEN");
  prepareResourceDirectory(logs);
  const roots = enrolled ? api.status().projects[storage.projectRoot].roots : [];
  const logRoot = fs.realpathSync(logs);
  if (!roots.includes(logRoot)) api.enroll({project: storage.projectRoot, roots: [...roots, logRoot]});
  return {api, storage};
}

export function resumeProjectResources({projectRoot, taskId}) {
  const context = activateProjectResources({projectRoot});
  if (!context) return null;
  return context.api.resumeOnce({project: context.storage.projectRoot, task: taskId});
}

export function registerObservedResources({projectRoot, taskId, metadata, archiveFiles}) {
  const context = activateProjectResources({projectRoot});
  if (!context) return null;
  if (metadata.archiveLocation === "fallback") {
    const key = crypto.createHash("sha256").update(context.storage.projectRoot).digest("hex").slice(0,24);
    const root = path.join(fs.realpathSync(os.tmpdir()),"leon-harness-observation-fallback",key);
    const expectedDirectory = path.join(root,taskId);
    if (archiveFiles.length !== 3 || archiveFiles.some(file => path.dirname(file) !== expectedDirectory)) throw new Error("FALLBACK_ARCHIVE_INVALID");
    const roots = context.api.status().projects[context.storage.projectRoot].roots;
    if (!roots.includes(root)) context.api.enroll({project:context.storage.projectRoot,roots:[...roots,root]});
  }
  const evidence = Object.fromEntries(["observationId", "verifierId", "status", "sha256", "fullBytes", "durationMs"].map(k => [k, metadata[k]]));
  return archiveFiles.map(file => context.api.register({project: context.storage.projectRoot, task: taskId,
    kind: "evidence", path: fs.realpathSync(file), evidence}));
}

export function retiredObservation({projectRoot, taskId, observationId}) {
  const storage = resolveHarnessStorage({projectRoot}), api = createLifecycle();
  if (!api.isEnrolled(storage.projectRoot)) return null;
  const retired = api.retiredEvidence({project: storage.projectRoot, task: taskId, observationId});
  return retired ? {...retired.evidence, originalEvidence: "retired", summarySeal: retired.seal, output: "", archiveFiles: []} : null;
}

export function isManagedResource({projectRoot, file}) {
  const storage = resolveHarnessStorage({projectRoot}), api = createLifecycle();
  return api.isEnrolled(storage.projectRoot) && api.status().resources.some(r => r.path === fs.realpathSync(file));
}

export function acceptedDeliveryResources({projectRoot, receipt}) {
  const storage = resolveHarnessStorage({projectRoot}), api = createLifecycle();
  if (!api.isEnrolled(storage.projectRoot)) return null;
  if (!["ci_passed", "cleaned"].includes(receipt.status) || !["passed", "not_configured"].includes(receipt.ci?.status)
    || receipt.verification?.status !== "passed") throw new Error("DELIVERY_UNVERIFIED");
  return api.event({project: storage.projectRoot, task: receipt.taskId, type: "delivery-accepted",
    proof: {schemaVersion: 1, task: receipt.taskId, revision: receipt.integrationCommit,
      verification: "passed", source: "delivery-controller"}});
}

export function runLifecycleCli(args) {
  const [action, ...rest] = args;
  if (!["enroll", "register", "event", "preview", "status", "inventory"].includes(action)) throw new Error("CLI_ACTION_INVALID");
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!["--store", "--spec"].includes(key) || !rest[i + 1] || options[key]) throw new Error("CLI_OPTION_INVALID");
    options[key] = rest[i + 1];
  }
  const api = createLifecycle({storeRoot: options["--store"]});
  if (["preview", "status"].includes(action)) {
    if (options["--spec"]) throw new Error("CLI_OPTION_INVALID");
    const result = api[action]();
    return action === "status" ? {schemaVersion: 1, projects: Object.keys(result.projects).length,
      resources: result.resources.length, cacheBytes: result.cacheBytes, recordOverBudget: result.recordOverBudget} : result;
  }
  if (!options["--spec"]) throw new Error("CLI_SPEC_REQUIRED");
  const spec = JSON.parse(fs.readFileSync(options["--spec"], "utf8"));
  if (action === "inventory") return inventoryPaths({...spec, state: api.status()});
  return api[action](spec);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runLifecycleCli(process.argv.slice(2));
    // Ordinary receipts stay bounded. Full state is private in the store, never printed by default.
    const view = JSON.stringify(result);
    process.stdout.write((Buffer.byteLength(view) <= 4096 ? view : JSON.stringify({status: result.status,
      items: result.items?.length, reclaimed: result.reclaimed?.length, notify: result.notify, detail: "private-ledger"})) + "\n");
    if (result.status === "blocked") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(JSON.stringify({status: "error", code: /^[A-Z_]+$/.test(error.message) ? error.message : "LIFECYCLE_FAILED"}) + "\n");
    process.exitCode = 1;
  }
}
