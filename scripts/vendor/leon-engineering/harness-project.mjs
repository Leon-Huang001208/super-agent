import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildProfile} from "./profile-project.mjs";
import {resolveHarnessStorage, verifyHarnessMigration} from "./harness-storage.mjs";

export const HARNESS_DIRECTORY = ".ai/harness";
export const AGENT_MAP_FILENAME = "agent-map.md";
export const METRICS_FILENAME = "metrics.jsonl";
export const EVENTS_FILENAME = "events.jsonl";
export const VERIFIERS_FILENAME = "verifiers.json";
export const TASK_INDEX_FILENAME = "task-index.jsonl";
export const SESSION_DIRECTORY = "sessions";
const BLOCKER_CATEGORIES = new Set(["environment", "dependency", "permission", "requirements", "test", "external", "unknown"]);
const EVENT_NAMES = new Set(["task_started", "tool_completed", "policy_decision", "skill_selected", "agent_selected", "verification_completed", "task_finished", "reasoning_method_selected", "reasoning_method_completed"]);
const EVENT_HOSTS = new Set(["claude", "codex", "unknown"]);
const EVENT_TOOLS = new Set(["shell", "read", "write", "other"]);
const EVENT_DECISIONS = new Set(["allow", "ask", "deny"]);
const VERIFICATION_STATUSES = new Set(["passed", "failed", "not_run"]);
const REASONING_METHOD_SOURCES = new Set(["required", "user-selected", "recommended", "model-supplemented"]);
const SESSION_SCHEMA_VERSIONS = new Set([1, 2]);

function assertTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("task is required");
  if (typeof task.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(task.id)) {
    throw new Error("invalid task id");
  }
  if (typeof task.goal !== "string" || task.goal.trim().length === 0) throw new Error("task goal is required");
  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    throw new Error("at least one acceptance criterion is required");
  }
  const acceptanceCriteria = task.acceptanceCriteria.map(item => {
    if (typeof item !== "string" || item.trim().length === 0) throw new Error("invalid acceptance criterion");
    return item.trim();
  });
  if (task.deliveryRequired !== undefined && typeof task.deliveryRequired !== "boolean") {
    throw new Error("invalid delivery required flag");
  }
  if (task.delivery !== undefined && (
    !task.delivery || typeof task.delivery !== "object" || Array.isArray(task.delivery)
    || typeof task.delivery.required !== "boolean"
  )) throw new Error("invalid task delivery policy");
  return {
    id: task.id,
    goal: task.goal.trim(),
    acceptanceCriteria,
    delivery: {required: Boolean(task.deliveryRequired ?? task.delivery?.required)}
  };
}

export function buildHarness({projectRoot, task}) {
  const profile = buildProfile({projectRoot});
  const storage = resolveHarnessStorage({projectRoot: profile.projectRoot});
  const normalizedTask = assertTask(task);
  return {
    schemaVersion: 1,
    projectRoot: storage.projectRoot,
    profile: {
      instructions: profile.instructions,
      commands: profile.commands,
      ci: profile.ci,
      platformSignals: profile.platformSignals,
      uncertainties: profile.uncertainties
    },
    task: {
      ...normalizedTask,
      status: "ready",
      verification: {status: "not_run"}
    }
  };
}

export function formatAgentMap(harness) {
  const instructionLines = harness.profile.instructions.length === 0
    ? ["- No project instruction file was discovered."]
    : harness.profile.instructions.map(item => `- \`${item.path}\` (${item.kind})`);
  const commandLines = harness.profile.commands.length === 0
    ? ["- No candidate validation command was discovered."]
    : harness.profile.commands.map(item => `- \`${item.verifierId}\`: \`${item.command}\`; cwd \`${item.workingDirectory}\`; source \`${item.source}\`; non-interactive (candidate only)`);
  const ciLines = harness.profile.ci.length === 0
    ? ["- No CI workflow was discovered."]
    : harness.profile.ci.map(item => `- \`${item.path}\``);
  return [
    "# Agent Map",
    "",
    "This file is generated from bounded, local repository evidence. Project instructions override this map.",
    "",
    "## Start Here",
    "",
    ...instructionLines,
    "",
    "## Candidate Validation Commands",
    "",
    ...commandLines,
    "",
    "## CI Evidence",
    "",
    ...ciLines,
    "",
    "## Handoff Rule",
    "",
    "Read the task record before changing code. Record only executed verification evidence with --record-outcome; candidate commands are not proof of success."
  ].join("\n");
}

function verifierManifest(harness) {
  return {
    schemaVersion: 1,
    projectRoot: harness.projectRoot,
    verifiers: harness.profile.commands.map(item => ({
      id: item.verifierId,
      kind: item.kind,
      command: item.command,
      argv: item.argv,
      workingDirectory: item.workingDirectory,
      source: item.source,
      interactive: item.interactive
    }))
  };
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeDirectory(root, relative) {
  const destination = path.resolve(root, relative);
  if (!isWithin(root, destination)) throw new Error("unsafe harness destination");
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current, {mode: 0o700});
    else if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new Error("invalid harness directory");
    }
  }
  return destination;
}

function existingSafeDirectory(root, relative) {
  const destination = path.resolve(root, relative);
  if (!isWithin(root, destination)) throw new Error("unsafe harness destination");
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!fs.existsSync(current)) return null;
    if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
      throw new Error("invalid harness directory");
    }
  }
  return destination;
}

function storageBoundary(storage) {
  return storage.kind === "git-common" ? storage.commonDirectory : storage.projectRoot;
}

function storageRelative(storage, relative = "") {
  return path.join(path.relative(storageBoundary(storage), storage.directory), relative);
}

function safeHarnessDirectory(projectRoot, relative = "") {
  const storage = resolveHarnessStorage({projectRoot});
  return safeDirectory(storageBoundary(storage), storageRelative(storage, relative));
}

function existingHarnessDirectory(projectRoot, relative = "") {
  const storage = resolveHarnessStorage({projectRoot});
  if (storage.kind === "git-common" && fs.existsSync(storage.legacyDirectory)) {
    const migration = verifyHarnessMigration({projectRoot});
    if (!migration.valid) throw new Error("legacy Harness migration required");
  }
  return existingSafeDirectory(storageBoundary(storage), storageRelative(storage, relative));
}

function writeAtomically(destination, content) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function taskFile(directory, taskId) {
  return path.join(directory, "tasks", `${taskId}.json`);
}

function taskIndexFile(directory) {
  return path.join(directory, TASK_INDEX_FILENAME);
}

export function buildTaskIndexRecord(task) {
  const outcomes = Array.isArray(task.outcomes) ? task.outcomes : [];
  const outcome = outcomes.at(-1);
  return {
    schemaVersion: 1,
    taskId: task.id,
    outcomeCount: outcomes.length,
    terminalStatus: outcome?.status ?? null,
    verificationStatus: outcome?.verification?.status ?? task.verification?.status ?? "not_run",
    updatedAt: new Date().toISOString(),
    ...(outcome ? {outcome: {
      status: outcome.status,
      clarificationRounds: outcome.clarificationRounds,
      reworkCount: outcome.reworkCount,
      verificationStatus: outcome.verification.status,
      ...(outcome.verificationDurationSeconds !== undefined ? {verificationDurationSeconds: outcome.verificationDurationSeconds} : {}),
      ...(outcome.blockerCategory ? {blockerCategory: outcome.blockerCategory} : {}),
      ...(outcome.invalidReason ? {invalidReason: outcome.invalidReason} : {})
    }} : {})
  };
}

function appendTaskIndex(directory, task) {
  const file = taskIndexFile(directory);
  fs.appendFileSync(file, `${JSON.stringify(buildTaskIndexRecord(task))}\n`, {mode: 0o600});
  return file;
}

export function readHarnessTaskIndex({projectRoot}) {
  const {directory} = existingHarnessFiles(projectRoot);
  const file = taskIndexFile(directory);
  if (!fs.existsSync(file)) return {records: new Map(), invalidIndexEntries: 0, file};
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("invalid harness task index");
  const records = new Map();
  let invalidIndexEntries = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (
        record?.schemaVersion !== 1
        || typeof record.taskId !== "string"
        || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.taskId)
        || !Number.isInteger(record.outcomeCount)
        || record.outcomeCount < 0
        || ![null, "completed", "blocked", "rework", "invalidated"].includes(record.terminalStatus)
        || !["passed", "failed", "not_run"].includes(record.verificationStatus)
        || typeof record.updatedAt !== "string"
      ) throw new Error("invalid");
      records.set(record.taskId, record);
    } catch {
      invalidIndexEntries += 1;
    }
  }
  return {records, invalidIndexEntries, file};
}

function metricEvent(event, taskId, details = {}) {
  return {timestamp: new Date().toISOString(), event, taskId, ...details};
}

function assertTaskId(taskId) {
  if (typeof taskId !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(taskId)) throw new Error("invalid task id");
  return taskId;
}

function assertHost(host) {
  if (!EVENT_HOSTS.has(host)) throw new Error("invalid harness event host");
  return host;
}

function normalizeHarnessEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("harness event is required");
  const allowed = new Set(["event", "host", "tool", "decision", "verificationStatus", "methodId", "methodVersion", "source", "artifactRef"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error("invalid harness event field");
  if (!EVENT_NAMES.has(input.event)) throw new Error("invalid harness event name");
  const event = {event: input.event, host: assertHost(input.host)};
  if (input.tool !== undefined) {
    if (!EVENT_TOOLS.has(input.tool)) throw new Error("invalid harness event tool");
    event.tool = input.tool;
  }
  if (input.decision !== undefined) {
    if (!EVENT_DECISIONS.has(input.decision)) throw new Error("invalid harness event decision");
    event.decision = input.decision;
  }
  if (input.verificationStatus !== undefined) {
    if (!VERIFICATION_STATUSES.has(input.verificationStatus)) throw new Error("invalid harness verification status");
    event.verificationStatus = input.verificationStatus;
  }
  const isReasoningEvent = input.event === "reasoning_method_selected" || input.event === "reasoning_method_completed";
  if (isReasoningEvent) {
    if (typeof input.methodId !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.methodId)) throw new Error("invalid reasoning method id");
    if (typeof input.methodVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(input.methodVersion)) throw new Error("invalid reasoning method version");
    event.methodId = input.methodId;
    event.methodVersion = input.methodVersion;
  } else if (input.methodId !== undefined || input.methodVersion !== undefined || input.source !== undefined || input.artifactRef !== undefined) {
    throw new Error("invalid reasoning method event fields");
  }
  if (input.event === "reasoning_method_selected") {
    if (!REASONING_METHOD_SOURCES.has(input.source)) throw new Error("invalid reasoning method source");
    if (input.artifactRef !== undefined) throw new Error("invalid reasoning method artifact");
    event.source = input.source;
  }
  if (input.event === "reasoning_method_completed") {
    if (input.source !== undefined) throw new Error("invalid reasoning method source");
    if (typeof input.artifactRef !== "string" || input.artifactRef.length === 0 || input.artifactRef.length > 240 || /[\r\n]/.test(input.artifactRef)) {
      throw new Error("invalid reasoning method artifact");
    }
    event.artifactRef = input.artifactRef;
  }
  return event;
}

export function writeHarness({projectRoot, harness}) {
  const storage = resolveHarnessStorage({projectRoot});
  if (!harness || harness.projectRoot !== storage.projectRoot) {
    throw new Error("harness project root mismatch");
  }
  if (storage.kind === "git-common" && !fs.existsSync(storage.directory) && fs.existsSync(storage.legacyDirectory)) {
    throw new Error("legacy Harness migration required");
  }
  const directory = safeHarnessDirectory(projectRoot);
  const tasks = safeHarnessDirectory(projectRoot, "tasks");
  const map = path.join(directory, AGENT_MAP_FILENAME);
  const task = taskFile(directory, harness.task.id);
  const metrics = path.join(directory, METRICS_FILENAME);
  const events = path.join(directory, EVENTS_FILENAME);
  const verifiers = path.join(directory, VERIFIERS_FILENAME);
  const index = taskIndexFile(directory);
  if (fs.existsSync(map) || fs.existsSync(metrics) || fs.existsSync(events) || fs.existsSync(verifiers) || fs.existsSync(index) || fs.existsSync(task)) {
    throw new Error("existing harness or task");
  }
  if (!isWithin(tasks, task)) throw new Error("unsafe task destination");
  writeAtomically(map, `${formatAgentMap(harness)}\n`);
  writeAtomically(task, `${JSON.stringify(harness.task, null, 2)}\n`);
  writeAtomically(metrics, `${JSON.stringify(metricEvent("task_created", harness.task.id, {status: harness.task.status}))}\n`);
  writeAtomically(events, "");
  writeAtomically(verifiers, `${JSON.stringify(verifierManifest(harness), null, 2)}\n`);
  writeAtomically(index, `${JSON.stringify(buildTaskIndexRecord(harness.task))}\n`);
  return {directory, map, task, metrics, events, verifiers, index};
}

function existingHarnessFiles(projectRoot) {
  const directory = existingHarnessDirectory(projectRoot);
  if (!directory) throw new Error("missing task harness");
  const tasks = existingHarnessDirectory(projectRoot, "tasks");
  const map = path.join(directory, AGENT_MAP_FILENAME);
  const metrics = path.join(directory, METRICS_FILENAME);
  const events = path.join(directory, EVENTS_FILENAME);
  const index = taskIndexFile(directory);
  if (!tasks || !fs.existsSync(map) || !fs.existsSync(metrics)) throw new Error("missing task harness");
  for (const file of [map, metrics, ...(fs.existsSync(events) ? [events] : []), ...(fs.existsSync(index) ? [index] : [])]) {
    if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error("invalid harness file");
  }
  return {directory, tasks, metrics, events, index};
}

export function addHarnessTask({projectRoot, task}) {
  const normalizedTask = assertTask(task);
  const {directory, tasks, metrics} = existingHarnessFiles(projectRoot);
  const destination = taskFile(directory, normalizedTask.id);
  if (!isWithin(tasks, destination)) throw new Error("unsafe task destination");
  if (fs.existsSync(destination)) throw new Error("existing harness task");
  const record = {...normalizedTask, status: "ready", verification: {status: "not_run"}};
  writeAtomically(destination, `${JSON.stringify(record, null, 2)}\n`);
  fs.appendFileSync(metrics, `${JSON.stringify(metricEvent("task_created", normalizedTask.id, {status: record.status}))}\n`, {mode: 0o600});
  const index = appendTaskIndex(directory, record);
  return {directory, task: destination, metrics, index};
}

export function readHarnessTask({projectRoot, taskId}) {
  assertTaskId(taskId);
  const {directory, tasks} = existingHarnessFiles(projectRoot);
  const destination = taskFile(directory, taskId);
  if (!isWithin(tasks, destination) || !fs.existsSync(destination)) throw new Error(`missing harness task record: ${taskId}`);
  if (fs.lstatSync(destination).isSymbolicLink() || !fs.statSync(destination).isFile()) throw new Error("invalid task record");
  let record;
  try {
    record = JSON.parse(fs.readFileSync(destination, "utf8"));
  } catch {
    throw new Error("invalid task record");
  }
  if (!record || typeof record !== "object" || Array.isArray(record) || record.id !== taskId) throw new Error("invalid task record");
  return record;
}

export function appendHarnessEvent({projectRoot, taskId, event}) {
  assertTaskId(taskId);
  readHarnessTask({projectRoot, taskId});
  const normalized = normalizeHarnessEvent(event);
  const {events} = existingHarnessFiles(projectRoot);
  if (fs.existsSync(events)) {
    if (fs.lstatSync(events).isSymbolicLink() || !fs.statSync(events).isFile()) throw new Error("invalid harness file");
  } else {
    writeAtomically(events, "");
  }
  const recorded = {timestamp: new Date().toISOString(), taskId, ...normalized};
  fs.appendFileSync(events, `${JSON.stringify(recorded)}\n`, {mode: 0o600});
  return recorded;
}

export function readAllHarnessEvents({projectRoot, taskIds}) {
  const selected = taskIds === undefined ? null : new Set(taskIds.map(assertTaskId));
  const {events} = existingHarnessFiles(projectRoot);
  let eventStat;
  try {
    eventStat = fs.lstatSync(events);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("missing harness event stream");
    throw error;
  }
  if (eventStat.isSymbolicLink() || !eventStat.isFile()) throw new Error("invalid harness file");
  const lines = fs.readFileSync(events, "utf8").split("\n").filter(Boolean);
  const grouped = new Map();
  for (const line of lines) {
    let recorded;
    try {
      recorded = JSON.parse(line);
    } catch {
      throw new Error("invalid harness event stream");
    }
    if (!recorded || typeof recorded !== "object" || Array.isArray(recorded) || typeof recorded.timestamp !== "string" || typeof recorded.taskId !== "string") {
      throw new Error("invalid harness event stream");
    }
    assertTaskId(recorded.taskId);
    if (selected && !selected.has(recorded.taskId)) continue;
    const event = {...recorded};
    delete event.timestamp;
    delete event.taskId;
    const normalized = normalizeHarnessEvent(event);
    if (JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(Object.keys(normalized).sort())) {
      throw new Error("invalid harness event stream");
    }
    const items = grouped.get(recorded.taskId) ?? [];
    items.push(recorded);
    grouped.set(recorded.taskId, items);
  }
  return grouped;
}

export function readHarnessEvents({projectRoot, taskId}) {
  assertTaskId(taskId);
  readHarnessTask({projectRoot, taskId});
  return readAllHarnessEvents({projectRoot, taskIds: [taskId]}).get(taskId) ?? [];
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(sessionId)) throw new Error("invalid harness session id");
  return sessionId;
}

function sessionKey(sessionId, host) {
  return crypto.createHash("sha256").update(`${host}:${assertSessionId(sessionId)}`).digest("hex");
}

function legacySessionKey(sessionId) {
  return crypto.createHash("sha256").update(assertSessionId(sessionId)).digest("hex");
}

function readSessionContext(destination, key) {
  if (fs.lstatSync(destination).isSymbolicLink() || !fs.statSync(destination).isFile()) throw new Error("invalid harness session");
  let context;
  try {
    context = JSON.parse(fs.readFileSync(destination, "utf8"));
  } catch {
    throw new Error("invalid harness session");
  }
  if (
    !context || typeof context !== "object" || Array.isArray(context)
    || !SESSION_SCHEMA_VERSIONS.has(context.schemaVersion)
    || context.sessionKey !== key
    || !["claude", "codex"].includes(context.host)
  ) {
    throw new Error("invalid harness session");
  }
  try {
    assertTaskId(context.taskId);
  } catch {
    throw new Error("invalid harness session");
  }
  return context;
}

export function startHarnessSession({projectRoot, host, sessionId, task, newTask = false}) {
  const requestedRoot = buildProfile({projectRoot}).projectRoot;
  const storage = resolveHarnessStorage({projectRoot: requestedRoot});
  const normalizedTask = assertTask(task);
  const normalizedHost = assertHost(host);
  if (normalizedHost === "unknown") throw new Error("invalid harness session host");
  if (typeof newTask !== "boolean") throw new Error("invalid harness new task flag");
  const key = sessionKey(sessionId, normalizedHost);
  const legacyKey = legacySessionKey(sessionId);
  const directory = existingHarnessDirectory(requestedRoot);
  if (!directory) {
    writeHarness({projectRoot: requestedRoot, harness: buildHarness({projectRoot: requestedRoot, task: normalizedTask})});
  }
  const {directory: harnessDirectory} = existingHarnessFiles(requestedRoot);
  const sessions = safeHarnessDirectory(requestedRoot, SESSION_DIRECTORY);
  const destination = path.join(sessions, `${key}.json`);
  if (!isWithin(sessions, destination)) throw new Error("unsafe harness session destination");
  if (fs.existsSync(destination)) {
    const context = readSessionContext(destination, key);
    if (context.host !== normalizedHost) throw new Error("invalid harness session");
    if (!newTask || context.taskId === normalizedTask.id) {
      readHarnessTask({projectRoot: requestedRoot, taskId: context.taskId});
      return {directory: harnessDirectory, taskId: context.taskId, sessionKey: key, resumed: true};
    }
  } else {
    const legacyDestination = path.join(sessions, `${legacyKey}.json`);
    if (!isWithin(sessions, legacyDestination)) throw new Error("unsafe harness session destination");
    if (fs.existsSync(legacyDestination)) {
      const legacyContext = readSessionContext(legacyDestination, legacyKey);
      if (legacyContext.host === normalizedHost && (!newTask || legacyContext.taskId === normalizedTask.id)) {
        readHarnessTask({projectRoot: requestedRoot, taskId: legacyContext.taskId});
        writeAtomically(destination, `${JSON.stringify({...legacyContext, sessionKey: key}, null, 2)}\n`);
        return {directory: harnessDirectory, taskId: legacyContext.taskId, sessionKey: key, resumed: true};
      }
    }
  }
  if (directory) {
    try {
      readHarnessTask({projectRoot: requestedRoot, taskId: normalizedTask.id});
    } catch (error) {
      if (!String(error.message).startsWith("missing harness task record:")) throw error;
      addHarnessTask({projectRoot: requestedRoot, task: normalizedTask});
    }
  }
  const newContext = {schemaVersion: 1, sessionKey: key, taskId: normalizedTask.id, host: normalizedHost, startedAt: new Date().toISOString()};
  writeAtomically(destination, `${JSON.stringify(newContext, null, 2)}\n`);
  appendHarnessEvent({projectRoot: requestedRoot, taskId: normalizedTask.id, event: {event: "task_started", host: normalizedHost}});
  return {directory: harnessDirectory, taskId: normalizedTask.id, sessionKey: key, resumed: false};
}

export function refreshAgentMap({projectRoot}) {
  const requestedRoot = buildProfile({projectRoot}).projectRoot;
  const storage = resolveHarnessStorage({projectRoot: requestedRoot});
  const directory = existingHarnessDirectory(requestedRoot);
  if (!directory) throw new Error("missing task harness");
  const map = path.join(directory, AGENT_MAP_FILENAME);
  const metrics = path.join(directory, METRICS_FILENAME);
  const verifiers = path.join(directory, VERIFIERS_FILENAME);
  if (!fs.existsSync(map) || !fs.existsSync(metrics)) throw new Error("missing task harness");
  if (fs.lstatSync(map).isSymbolicLink() || fs.lstatSync(metrics).isSymbolicLink() || (fs.existsSync(verifiers) && fs.lstatSync(verifiers).isSymbolicLink())) {
    throw new Error("invalid harness file");
  }
  const profile = buildProfile({projectRoot: requestedRoot});
  const refreshed = {schemaVersion: 1, projectRoot: storage.projectRoot, profile, task: {id: "agent-map-refresh", goal: "refresh", acceptanceCriteria: ["refresh"]}};
  writeAtomically(map, `${formatAgentMap(refreshed)}\n`);
  writeAtomically(verifiers, `${JSON.stringify(verifierManifest(refreshed), null, 2)}\n`);
  fs.appendFileSync(metrics, `${JSON.stringify(metricEvent("agent_map_refreshed", "agent-map", {}))}\n`, {mode: 0o600});
  return {directory, map, metrics, verifiers};
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`invalid ${field}`);
  return value;
}

export function recordOutcome({projectRoot, taskId, outcome, host = "unknown"}) {
  assertTaskId(taskId);
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) throw new Error("outcome is required");
  if (!new Set(["completed", "blocked", "rework", "invalidated"]).has(outcome.status)) throw new Error("invalid outcome status");
  if (typeof outcome.verificationCommand !== "string" || outcome.verificationCommand.trim().length === 0) {
    throw new Error("verification command is required");
  }
  if (!new Set(["passed", "failed", "not_run"]).has(outcome.verificationStatus)) {
    throw new Error("invalid verification status");
  }
  const verificationDurationSeconds = nonNegativeInteger(outcome.verificationDurationSeconds, "verification duration seconds");
  let blockerCategory;
  let invalidReason;
  if (outcome.status === "blocked") {
    if (typeof outcome.blockerCategory !== "string" || !BLOCKER_CATEGORIES.has(outcome.blockerCategory)) {
      throw new Error("blocker category is required");
    }
    blockerCategory = outcome.blockerCategory;
  } else if (outcome.blockerCategory !== undefined) {
    throw new Error("invalid blocker category");
  }
  if (outcome.status === "invalidated") {
    if (typeof outcome.invalidReason !== "string" || outcome.invalidReason.trim().length === 0) {
      throw new Error("invalid reason is required");
    }
    invalidReason = outcome.invalidReason.trim();
  } else if (outcome.invalidReason !== undefined) {
    throw new Error("invalid invalid reason");
  }
  const record = {
    status: outcome.status,
    clarificationRounds: nonNegativeInteger(outcome.clarificationRounds, "clarification rounds"),
    reworkCount: nonNegativeInteger(outcome.reworkCount, "rework count"),
    verification: {command: outcome.verificationCommand.trim(), status: outcome.verificationStatus},
    verificationDurationSeconds,
    ...(blockerCategory ? {blockerCategory} : {}),
    ...(invalidReason ? {invalidReason} : {})
  };
  const {directory, metrics} = existingHarnessFiles(projectRoot);
  const task = taskFile(directory, taskId);
  const taskRecord = readHarnessTask({projectRoot, taskId});
  taskRecord.status = record.status;
  taskRecord.verification = record.verification;
  taskRecord.outcomes = [...(Array.isArray(taskRecord.outcomes) ? taskRecord.outcomes : []), record];
  writeAtomically(task, `${JSON.stringify(taskRecord, null, 2)}\n`);
  appendTaskIndex(directory, taskRecord);
  fs.appendFileSync(metrics, `${JSON.stringify(metricEvent("task_outcome", taskId, record))}\n`, {mode: 0o600});
  appendHarnessEvent({projectRoot, taskId, event: {event: "verification_completed", host: assertHost(host), verificationStatus: record.verification.status}});
  if (record.status === "completed" || record.status === "blocked") {
    appendHarnessEvent({projectRoot, taskId, event: {event: "task_finished", host: assertHost(host)}});
  }
  return record;
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {acceptanceCriteria: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--task-id", "--goal", "--acceptance", "--status", "--clarification-rounds", "--rework-count", "--verification-command", "--verification-status", "--verification-duration-seconds", "--blocker-category", "--invalid-reason", "--host", "--method-id", "--method-version", "--method-source", "--artifact-ref"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--acceptance") options.acceptanceCriteria.push(value);
      else options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (argument === "--write-harness") options.writeHarness = true;
    else if (argument === "--add-task") options.addTask = true;
    else if (argument === "--refresh-agent-map") options.refreshAgentMap = true;
    else if (argument === "--record-outcome") options.recordOutcome = true;
    else if (argument === "--record-method-selected") options.recordMethodSelected = true;
    else if (argument === "--record-method-completed") options.recordMethodCompleted = true;
    else if (argument === "--delivery-required") options.deliveryRequired = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!options.project) throw new Error("--project requires a value");
  const methodModes = Number(Boolean(options.recordMethodSelected)) + Number(Boolean(options.recordMethodCompleted));
  if (methodModes > 1) throw new Error("use one reasoning method event mode");
  if (options.refreshAgentMap) {
    if (options.writeHarness || options.addTask || options.recordOutcome || options.task_id || options.goal || options.acceptanceCriteria.length || options.deliveryRequired) throw new Error("refresh mode cannot set task options");
    return options;
  }
  if (!options.task_id) throw new Error("--task-id requires a value");
  if (methodModes === 1) {
    if (options.writeHarness || options.addTask || options.recordOutcome || options.goal || options.acceptanceCriteria.length || options.deliveryRequired) {
      throw new Error("reasoning method event mode cannot create or complete a task");
    }
    return options;
  }
  if (options.recordOutcome) {
    if (options.writeHarness || options.addTask || options.goal || options.acceptanceCriteria.length || options.deliveryRequired) {
      throw new Error("outcome mode cannot create a task");
    }
    return options;
  }
  if (options.addTask && options.writeHarness) throw new Error("task mode cannot create a harness");
  if (!options.goal || options.acceptanceCriteria.length === 0) {
    throw new Error("--goal and at least one --acceptance are required");
  }
  return options;
}

function formatUsage() {
  return [
    "用法：harness-project.mjs --project <项目目录> --task-id <任务 ID> --goal <目标> --acceptance <验收标准> [--acceptance <验收标准>] [--delivery-required] [--write-harness|--add-task]",
    "      harness-project.mjs --project <项目目录> --task-id <任务 ID> --record-outcome --status <状态> --clarification-rounds <次数> --rework-count <次数> --verification-command <命令> --verification-status <状态> --verification-duration-seconds <秒数>",
    "      harness-project.mjs --project <项目目录> --task-id <任务 ID> --record-method-selected --host claude|codex --method-id <ID> --method-version <版本> --method-source <来源>",
    "      harness-project.mjs --project <项目目录> --task-id <任务 ID> --record-method-completed --host claude|codex --method-id <ID> --method-version <版本> --artifact-ref <引用>",
    "      harness-project.mjs --project <项目目录> --refresh-agent-map",
    "",
    "默认仅预览；--write-harness、--add-task、--record-outcome 和 --refresh-agent-map 会写入指定项目。"
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${formatUsage()}\n`);
    return;
  }
  if (options.refreshAgentMap) {
    const result = refreshAgentMap({projectRoot: options.project});
    process.stdout.write(`${JSON.stringify({refreshed: true, result})}\n`);
    return;
  }
  if (options.recordOutcome) {
    const result = recordOutcome({
      projectRoot: options.project,
      taskId: options.task_id,
      outcome: {
        status: options.status,
        clarificationRounds: Number(options.clarification_rounds),
        reworkCount: Number(options.rework_count),
        verificationCommand: options.verification_command,
        verificationStatus: options.verification_status,
        verificationDurationSeconds: Number(options.verification_duration_seconds),
        blockerCategory: options.blocker_category,
        invalidReason: options.invalid_reason
      }
    });
    process.stdout.write(`${JSON.stringify({recorded: true, result})}\n`);
    return;
  }
  if (options.recordMethodSelected || options.recordMethodCompleted) {
    const result = appendHarnessEvent({
      projectRoot: options.project,
      taskId: options.task_id,
      event: options.recordMethodSelected ? {
        event: "reasoning_method_selected",
        host: options.host,
        methodId: options.method_id,
        methodVersion: options.method_version,
        source: options.method_source
      } : {
        event: "reasoning_method_completed",
        host: options.host,
        methodId: options.method_id,
        methodVersion: options.method_version,
        artifactRef: options.artifact_ref
      }
    });
    process.stdout.write(`${JSON.stringify({recorded: true, result})}\n`);
    return;
  }
  const harness = buildHarness({
    projectRoot: options.project,
    task: {
      id: options.task_id,
      goal: options.goal,
      acceptanceCriteria: options.acceptanceCriteria,
      deliveryRequired: Boolean(options.deliveryRequired)
    }
  });
  const files = options.writeHarness
    ? writeHarness({projectRoot: options.project, harness})
    : options.addTask
      ? addHarnessTask({projectRoot: options.project, task: harness.task})
      : null;
  process.stdout.write(`${JSON.stringify({persisted: Boolean(files), harness, files}, null, 2)}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`harness project failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
