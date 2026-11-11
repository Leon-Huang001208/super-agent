import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {readHarnessTask, VERIFIERS_FILENAME} from "./harness-project.mjs";
import {resolveHarnessStorage} from "./harness-storage.mjs";
import {registerObservedResources, retiredObservation, isManagedResource} from "./resource-lifecycle.mjs";

const LOGS_RELATIVE = "logs";
const DEFAULT_VISIBLE_BYTES = 4 * 1024;
const WIDE_VISIBLE_BYTES = 8 * 1024;
const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret|private[_-]?key)\s*[:=]\s*[^\s]+|\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b/i;

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertId(value, field, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`invalid ${field}`);
  return value;
}

function assertSafeExistingFile(root, relative, description) {
  const file = path.resolve(root, relative);
  if (!isWithin(root, file) || !fs.existsSync(file)) throw new Error(`missing ${description}`);
  let current = root;
  for (const part of path.relative(root, file).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`invalid ${description}`);
  }
  if (!fs.statSync(file).isFile()) throw new Error(`invalid ${description}`);
  return file;
}

function readVerifier(harnessRoot, workspaceRoot, verifierId) {
  const file = assertSafeExistingFile(harnessRoot, VERIFIERS_FILENAME, "verifier manifest");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("invalid verifier manifest");
  }
  if (manifest?.schemaVersion !== 1 || typeof manifest.projectRoot !== "string" || !path.isAbsolute(manifest.projectRoot)
    || !Array.isArray(manifest.verifiers)) {
    throw new Error("invalid verifier manifest");
  }
  const verifier = manifest.verifiers.find(item => item?.id === verifierId);
  if (!verifier) throw new Error("unknown verifier");
  if (verifier.interactive !== false || !Array.isArray(verifier.argv) || verifier.argv.length === 0
    || verifier.argv.some(item => typeof item !== "string" || item.length === 0)
    || typeof verifier.command !== "string" || typeof verifier.source !== "string"
    || typeof verifier.workingDirectory !== "string") {
    throw new Error("invalid verifier manifest");
  }
  const expectedId = `verifier-${verifier.kind}-${crypto.createHash("sha256")
    .update(`${verifier.command}\0${verifier.workingDirectory}\0${verifier.source}`)
    .digest("hex").slice(0, 12)}`;
  if (verifier.id !== expectedId || verifier.argv.join(" ") !== verifier.command) throw new Error("invalid verifier manifest");
  assertSafeExistingFile(workspaceRoot, verifier.source, "verifier source");
  return verifier;
}

function resolveWorkingDirectory(root, relative) {
  const directory = path.resolve(root, relative);
  if (!isWithin(root, directory) || !fs.existsSync(directory)) throw new Error("unsafe verifier working directory");
  let current = root;
  for (const part of path.relative(root, directory).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("unsafe verifier working directory");
  }
  if (!fs.statSync(directory).isDirectory()) throw new Error("unsafe verifier working directory");
  return directory;
}

function ensureSafeDirectory(root, relative) {
  const directory = path.resolve(root, relative);
  if (!isWithin(root, directory)) throw new Error("unsafe observation directory");
  let current = root;
  for (const part of path.relative(root, directory).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current, {mode: 0o700});
    else if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new Error("invalid observation directory");
    }
  }
  return directory;
}

function executeVerifier(verifier, cwd, {timeoutMs, signal: abortSignal}) {
  return new Promise((resolve, reject) => {
    const child = spawn(verifier.argv[0], verifier.argv.slice(1), {
      cwd,
      env: {...process.env, CI: "1"},
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let terminationReason = null;
    let forceKillTimer = null;
    const terminate = reason => {
      if (terminationReason) return;
      terminationReason = reason;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      forceKillTimer.unref();
    };
    const abort = () => terminate("cancelled");
    const timeout = timeoutMs === undefined ? null : setTimeout(() => terminate("timed_out"), timeoutMs);
    timeout?.unref();
    if (abortSignal) {
      if (abortSignal.aborted) abort();
      else abortSignal.addEventListener("abort", abort, {once: true});
    }
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      abortSignal?.removeEventListener("abort", abort);
      resolve(result);
    };
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", () => finish({
      exitCode: null,
      signal: null,
      terminationReason: null,
      startFailed: true,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.from("registered verifier could not start\n")
    }));
    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        terminationReason,
        startFailed: false,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr)
      });
    });
  });
}

function archiveObservation({root, taskId, relativeDirectory = path.posix.join(LOGS_RELATIVE, taskId), observationId, stdout, stderr, metadata}) {
  const directory = ensureSafeDirectory(root, relativeDirectory);
  const metadataFile = path.join(directory, `${observationId}.json`);
  const stdoutFile = path.join(directory, `${observationId}.stdout.bin`);
  const stderrFile = path.join(directory, `${observationId}.stderr.bin`);
  for (const file of [metadataFile, stdoutFile, stderrFile]) {
    if (fs.existsSync(file) || fs.lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error("invalid observation archive");
  }
  fs.writeFileSync(stdoutFile, stdout, {flag: "wx", mode: 0o600});
  fs.writeFileSync(stderrFile, stderr, {flag: "wx", mode: 0o600});
  fs.writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, {flag: "wx", mode: 0o600});
  return [metadataFile, stdoutFile, stderrFile];
}

function fallbackRelativeDirectory(root, taskId) {
  const projectKey = crypto.createHash("sha256").update(root).digest("hex").slice(0, 24);
  return path.posix.join("leon-harness-observation-fallback", projectKey, taskId);
}

function fallbackBaseRoot() {
  return fs.realpathSync(os.tmpdir());
}

function isUnsafeArchiveError(error) {
  return /(?:unsafe|invalid) observation (?:directory|archive)/.test(error?.message ?? "");
}

function appendObservationMetric(root, metric) {
  const file = assertSafeExistingFile(root, "metrics.jsonl", "harness metrics");
  fs.appendFileSync(file, `${JSON.stringify({timestamp: new Date().toISOString(), ...metric})}\n`, {mode: 0o600});
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", {fatal: true}).decode(buffer);
  } catch {
    return null;
  }
}

function utf8Prefix(text, limit) {
  let bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  bytes = bytes.subarray(0, limit);
  while (bytes.length > 0) {
    try {
      return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
      bytes = bytes.subarray(0, bytes.length - 1);
    }
  }
  return "";
}

function utf8Suffix(text, limit) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let start = bytes.length - limit;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return new TextDecoder("utf-8", {fatal: false}).decode(bytes.subarray(start));
}

function errorContext(text, head, tail, limit) {
  if (limit <= 0) return "";
  const matches = [...text.matchAll(/error|fail(?:ed|ure)?|exception|fatal|panic/gi)].slice(0, 8);
  const contexts = [];
  for (const match of matches) {
    const start = Math.max(0, match.index - 180);
    const end = Math.min(text.length, match.index + match[0].length + 260);
    const context = text.slice(start, end).trim();
    if (!context || head.includes(context) || tail.includes(context) || contexts.includes(context)) continue;
    contexts.push(context);
  }
  return utf8Prefix(contexts.join("\n...\n"), limit);
}

function receiptHeader(metadata, logRef) {
  return [
    "HARNESS_OBSERVATION v1",
    `observation_id=${metadata.observationId}`,
    `verifier_id=${metadata.verifierId}`,
    `status=${metadata.status}`,
    `exit_code=${metadata.exitCode ?? "null"}`,
    `signal=${metadata.signal ?? "null"}`,
    `duration_ms=${metadata.durationMs}`,
    `full_bytes=${metadata.fullBytes}`,
    `returned_bytes=${metadata.returnedBytes}`,
    `sha256=${metadata.sha256}`,
    `truncated=${metadata.truncated}`,
    `secret_suppressed=${metadata.secretSuppressed}`,
    `log_ref=${logRef}`
  ].join("\n");
}

function buildReceipt(metadata, stdout, stderr, logRef, maxReceiptBytes) {
  const header = receiptHeader(metadata, logRef);
  if (metadata.secretSuppressed) return `${header}\ncontent=secret_suppressed`;
  const combined = [stdout.length ? `stdout:\n${stdout}` : "", stderr.length ? `stderr:\n${stderr}` : ""].filter(Boolean).join("\n");
  const separators = "\n--- head ---\n\n--- error context ---\n\n--- tail ---\n";
  const fixedBytes = Buffer.byteLength(header) + Buffer.byteLength(separators);
  const available = Math.max(0, maxReceiptBytes - fixedBytes);
  const headBudget = Math.min(2 * 1024, Math.floor(available * 0.45));
  const tailBudget = Math.min(1536, Math.floor(available * 0.3));
  const errorBudget = Math.min(2560, Math.max(0, available - headBudget - tailBudget));
  const head = utf8Prefix(combined, headBudget);
  const tail = utf8Suffix(combined, tailBudget);
  const errors = errorContext(combined, head, tail, errorBudget);
  const receipt = `${header}\n--- head ---\n${head}\n--- error context ---\n${errors}\n--- tail ---\n${tail}`;
  if (Buffer.byteLength(receipt) <= maxReceiptBytes) return receipt;
  return utf8Prefix(receipt, maxReceiptBytes);
}

function modelOutput(metadata, stdoutBuffer, stderrBuffer, logRef, visibleLimit) {
  const stdout = decodeUtf8(stdoutBuffer);
  const stderr = decodeUtf8(stderrBuffer);
  if (metadata.secretSuppressed || metadata.fullBytes > visibleLimit) {
    const text = buildReceipt(metadata, stdout ?? "[binary stdout]", stderr ?? "[binary stderr]", logRef, visibleLimit);
    return {output: {encoding: "receipt", text}, returnedBytes: Buffer.byteLength(text)};
  }
  if (stdout !== null && stderr !== null) {
    return {output: {encoding: "utf8", stdout, stderr}, returnedBytes: metadata.fullBytes};
  }
  const encoded = {encoding: "base64", stdout: stdoutBuffer.toString("base64"), stderr: stderrBuffer.toString("base64")};
  const returnedBytes = Buffer.byteLength(encoded.stdout) + Buffer.byteLength(encoded.stderr);
  return {output: encoded, returnedBytes};
}

function finalizeModelOutput(metadata, stdout, stderr, logRef, visibleLimit = DEFAULT_VISIBLE_BYTES) {
  let returnedBytes = metadata.returnedBytes ?? 0;
  let visible;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    visible = modelOutput({...metadata, returnedBytes}, stdout, stderr, logRef, visibleLimit);
    if (visible.returnedBytes === returnedBytes) {
      return {metadata: {...metadata, returnedBytes}, visible};
    }
    returnedBytes = visible.returnedBytes;
  }
  visible = modelOutput({...metadata, returnedBytes}, stdout, stderr, logRef, visibleLimit);
  return {metadata: {...metadata, returnedBytes: visible.returnedBytes}, visible};
}

function writeMetadata(file, metadata) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, {mode: 0o600});
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function validNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function assertObservationMetadata(metadata, taskId, observationId) {
  const expectedKeys = new Set([
    "schemaVersion", "observationId", "taskId", "verifierId", "status", "exitCode", "signal", "durationMs",
    "stdoutBytes", "stderrBytes", "fullBytes", "sha256", "truncated", "secretSuppressed", "archiveFailed",
    "archiveLocation", "recallCount", "returnedBytes"
  ]);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
    || Object.keys(metadata).some(key => !expectedKeys.has(key))
    || metadata.schemaVersion !== 1 || metadata.taskId !== taskId || metadata.observationId !== observationId
    || !/^verifier-[a-z0-9-]+-[a-f0-9]{12}$/.test(metadata.verifierId ?? "")
    || !new Set(["passed", "failed", "timed_out", "signaled", "cancelled"]).has(metadata.status)
    || !(metadata.exitCode === null || validNonNegativeInteger(metadata.exitCode))
    || !(metadata.signal === null || /^SIG[A-Z0-9]+$/.test(metadata.signal))
    || ![metadata.durationMs, metadata.stdoutBytes, metadata.stderrBytes, metadata.fullBytes, metadata.recallCount, metadata.returnedBytes].every(validNonNegativeInteger)
    || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? "")
    || ![metadata.truncated, metadata.secretSuppressed, metadata.archiveFailed].every(value => typeof value === "boolean")
    || !new Set(["primary", "fallback"]).has(metadata.archiveLocation)) {
    throw new Error("invalid observation");
  }
  return metadata;
}

function observationFiles(root, taskId, observationId) {
  const relativeDirectory = path.posix.join(LOGS_RELATIVE, taskId);
  const directory = path.resolve(root, relativeDirectory);
  const metadataFile = assertSafeExistingFile(root, path.posix.join(relativeDirectory, `${observationId}.json`), "observation");
  const stdoutFile = assertSafeExistingFile(root, path.posix.join(relativeDirectory, `${observationId}.stdout.bin`), "observation stdout");
  const stderrFile = assertSafeExistingFile(root, path.posix.join(relativeDirectory, `${observationId}.stderr.bin`), "observation stderr");
  return {directory, metadataFile, stdoutFile, stderrFile};
}

function fallbackObservationFiles(root, taskId, observationId) {
  const base = fallbackBaseRoot();
  const relativeDirectory = fallbackRelativeDirectory(root, taskId);
  const metadataFile = assertSafeExistingFile(base, path.posix.join(relativeDirectory, `${observationId}.json`), "observation");
  const stdoutFile = assertSafeExistingFile(base, path.posix.join(relativeDirectory, `${observationId}.stdout.bin`), "observation stdout");
  const stderrFile = assertSafeExistingFile(base, path.posix.join(relativeDirectory, `${observationId}.stderr.bin`), "observation stderr");
  return {directory: path.resolve(base, relativeDirectory), metadataFile, stdoutFile, stderrFile};
}

export async function runObserved(spec, dependencies = {}) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("observation spec is required");
  const storage = resolveHarnessStorage({projectRoot: spec.projectRoot});
  const root = storage.projectRoot;
  const workspaceRoot = storage.workspaceRoot;
  const harnessRoot = storage.directory;
  const taskId = assertId(spec.taskId, "task id", /^[a-z0-9][a-z0-9-]{0,79}$/);
  const verifierId = assertId(spec.verifierId, "verifier id", /^verifier-[a-z0-9-]+-[a-f0-9]{12}$/);
  readHarnessTask({projectRoot: root, taskId});
  const verifier = readVerifier(harnessRoot, workspaceRoot, verifierId);
  const cwd = resolveWorkingDirectory(workspaceRoot, verifier.workingDirectory);
  if (spec.timeoutMs !== undefined && (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > 3_600_000)) {
    throw new Error("invalid timeout");
  }
  if (spec.signal !== undefined && !(spec.signal instanceof AbortSignal)) throw new Error("invalid cancellation signal");
  if (spec.wideReceipt !== undefined && typeof spec.wideReceipt !== "boolean") throw new Error("invalid wide receipt flag");
  const visibleLimit = spec.wideReceipt ? WIDE_VISIBLE_BYTES : DEFAULT_VISIBLE_BYTES;
  const observationId = `observation-${crypto.randomBytes(12).toString("hex")}`;
  const started = process.hrtime.bigint();
  const executed = await executeVerifier(verifier, cwd, {timeoutMs: spec.timeoutMs, signal: spec.signal});
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const full = Buffer.concat([executed.stdout, executed.stderr]);
  const status = executed.terminationReason ?? (executed.exitCode === 0 ? "passed" : executed.signal ? "signaled" : "failed");
  let logRef = path.posix.join(LOGS_RELATIVE, taskId, `${observationId}.json`);
  let metadata = {
    schemaVersion: 1,
    observationId,
    taskId,
    verifierId,
    status,
    exitCode: executed.exitCode,
    signal: executed.signal,
    durationMs,
    stdoutBytes: executed.stdout.length,
    stderrBytes: executed.stderr.length,
    fullBytes: full.length,
    sha256: crypto.createHash("sha256").update(full).digest("hex"),
    truncated: full.length > visibleLimit,
    secretSuppressed: SECRET_PATTERN.test(full.toString("utf8")),
    archiveFailed: false,
    archiveLocation: "primary",
    recallCount: 0
  };
  if (metadata.secretSuppressed) metadata.truncated = true;
  let finalized = finalizeModelOutput(metadata, executed.stdout, executed.stderr, logRef, visibleLimit);
  metadata = finalized.metadata;
  let visible = finalized.visible;
  let archiveFiles;
  try {
    archiveFiles = (dependencies.archiveWriter ?? archiveObservation)({
      root: harnessRoot, taskId, observationId, stdout: executed.stdout, stderr: executed.stderr, metadata
    });
  } catch (error) {
    if (isUnsafeArchiveError(error)) throw error;
    const fallbackRoot = fallbackBaseRoot();
    const relativeDirectory = fallbackRelativeDirectory(root, taskId);
    metadata.archiveFailed = true;
    metadata.archiveLocation = "fallback";
    logRef = path.join(fallbackRoot, relativeDirectory, `${observationId}.json`);
    finalized = finalizeModelOutput(metadata, executed.stdout, executed.stderr, logRef, visibleLimit);
    metadata = finalized.metadata;
    visible = finalized.visible;
    archiveFiles = archiveObservation({
      root: fallbackRoot,
      relativeDirectory,
      observationId,
      stdout: executed.stdout,
      stderr: executed.stderr,
      metadata
    });
  }
  appendObservationMetric(harnessRoot, {
    event: "observation_recorded",
    taskId,
    verifierId,
    status,
    durationMs,
    fullBytes: metadata.fullBytes,
    returnedBytes: metadata.returnedBytes,
    truncated: metadata.truncated,
    archiveFailed: metadata.archiveFailed
  });
  // Failed fallback archives remain protected until explicitly enrolled; never silently omit a registration failure.
  registerObservedResources({projectRoot: root, taskId, metadata, archiveFiles});
  return {
    ...metadata,
    logRef,
    archiveFiles,
    output: visible.output
  };
}

export function readObservation(query) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new Error("observation query is required");
  const storage = resolveHarnessStorage({projectRoot: query.projectRoot});
  const root = storage.projectRoot;
  const harnessRoot = storage.directory;
  const taskId = assertId(query.taskId, "task id", /^[a-z0-9][a-z0-9-]{0,79}$/);
  const observationId = assertId(query.observationId, "observation id", /^observation-[a-f0-9]{24}$/);
  if (query.wideReceipt !== undefined && typeof query.wideReceipt !== "boolean") throw new Error("invalid wide receipt flag");
  const visibleLimit = query.wideReceipt ? WIDE_VISIBLE_BYTES : DEFAULT_VISIBLE_BYTES;
  readHarnessTask({projectRoot: root, taskId});
  const retired = retiredObservation({projectRoot: root, taskId, observationId});
  if (retired) return retired;
  let files;
  try {
    files = observationFiles(harnessRoot, taskId, observationId);
  } catch (error) {
    if (!/missing observation/.test(error.message)) throw error;
    try {
      files = fallbackObservationFiles(root, taskId, observationId);
    } catch (fallbackError) {
      if (/missing observation/.test(fallbackError.message)) throw new Error("missing observation");
      throw fallbackError;
    }
  }
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(files.metadataFile, "utf8"));
  } catch {
    throw new Error("invalid observation");
  }
  assertObservationMetadata(metadata, taskId, observationId);
  const stdout = fs.readFileSync(files.stdoutFile);
  const stderr = fs.readFileSync(files.stderrFile);
  const full = Buffer.concat([stdout, stderr]);
  if (metadata.stdoutBytes !== stdout.length || metadata.stderrBytes !== stderr.length || metadata.fullBytes !== full.length
    || metadata.sha256 !== crypto.createHash("sha256").update(full).digest("hex")) {
    throw new Error("invalid observation evidence");
  }
  metadata.recallCount += 1;
  // Metadata is immutable after registration; recall statistics are already recorded in metrics.
  if (!isManagedResource({projectRoot: root, file: files.metadataFile})) writeMetadata(files.metadataFile, metadata);
  const logRef = metadata.archiveLocation === "fallback"
    ? files.metadataFile
    : path.posix.join(LOGS_RELATIVE, taskId, `${observationId}.json`);
  const finalized = finalizeModelOutput(metadata, stdout, stderr, logRef, visibleLimit);
  metadata = finalized.metadata;
  const visible = finalized.visible;
  appendObservationMetric(harnessRoot, {
    event: "observation_recalled",
    taskId,
    verifierId: metadata.verifierId,
    status: metadata.status,
    durationMs: metadata.durationMs,
    fullBytes: metadata.fullBytes,
    returnedBytes: visible.returnedBytes,
    truncated: metadata.truncated,
    archiveFailed: metadata.archiveFailed,
    recallCount: metadata.recallCount
  });
  return {
    ...metadata,
    returnedBytes: visible.returnedBytes,
    logRef,
    archiveFiles: [files.metadataFile, files.stdoutFile, files.stderrFile],
    output: visible.output
  };
}
