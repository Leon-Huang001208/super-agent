import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

export const HARNESS_RELATIVE_DIRECTORY = path.join(".ai", "harness");

function runGit(projectRoot, args) {
  return spawnSync("git", ["-C", projectRoot, ...args], {encoding: "utf8"});
}

function existingDirectory(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.trim().length === 0) {
    throw new Error("project root is required");
  }
  const root = fs.realpathSync(path.resolve(projectRoot));
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid project root");
  return root;
}

function resolvedCommonDirectory(repositoryRoot, value) {
  const candidate = path.resolve(repositoryRoot, value);
  const real = fs.realpathSync(candidate);
  const stat = fs.lstatSync(real);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid Git common directory");
  return real;
}

export function resolveHarnessStorage({projectRoot}) {
  const root = existingDirectory(projectRoot);
  const repository = runGit(root, ["rev-parse", "--show-toplevel"]);
  const common = runGit(root, ["rev-parse", "--git-common-dir"]);
  if (repository.status !== 0 || common.status !== 0) {
    const directory = path.join(root, HARNESS_RELATIVE_DIRECTORY);
    return {
      projectRoot: root,
      workspaceRoot: root,
      repositoryRoot: null,
      commonDirectory: null,
      directory,
      legacyDirectory: directory,
      kind: "project-local"
    };
  }
  const workspaceRoot = fs.realpathSync(repository.stdout.trim());
  const commonDirectory = resolvedCommonDirectory(workspaceRoot, common.stdout.trim());
  const repositoryRoot = path.basename(commonDirectory) === ".git"
    ? fs.realpathSync(path.dirname(commonDirectory))
    : workspaceRoot;
  const workspaceLegacy = path.join(workspaceRoot, HARNESS_RELATIVE_DIRECTORY);
  const repositoryLegacy = path.join(repositoryRoot, HARNESS_RELATIVE_DIRECTORY);
  return {
    projectRoot: repositoryRoot,
    workspaceRoot,
    repositoryRoot,
    commonDirectory,
    directory: path.join(commonDirectory, "leon-engineering", "harness"),
    legacyDirectory: fs.existsSync(workspaceLegacy) ? workspaceLegacy : repositoryLegacy,
    kind: "git-common"
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function enumerateRegularFiles(root) {
  const files = [];
  const conflicts = [];
  if (!fs.existsSync(root)) return {files, conflicts};
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) return {files, conflicts: ["symlink:."]};
  if (!rootStat.isDirectory()) return {files, conflicts: ["unsupported:."]};

  function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    const entries = fs.readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const portable = relative.split(path.sep).join("/");
      const absolute = path.join(root, relative);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        conflicts.push(`symlink:${portable}`);
      } else if (stat.isDirectory()) {
        visit(relative);
      } else if (stat.isFile()) {
        if ((stat.mode & 0o444) === 0) {
          conflicts.push(`unreadable:${portable}`);
          continue;
        }
        try {
          const content = fs.readFileSync(absolute);
          files.push({relative: portable, absolute, bytes: content.length, sha256: sha256(content)});
        } catch {
          conflicts.push(`unreadable:${portable}`);
        }
      } else {
        conflicts.push(`unsupported:${portable}`);
      }
    }
  }

  visit("");
  return {files, conflicts};
}

function aggregateTreeHash(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file.relative);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function destinationConflicts(destination, files) {
  if (!fs.existsSync(destination)) return [];
  const stat = fs.lstatSync(destination);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return ["invalid-destination:."];
  const conflicts = [];
  for (const file of files) {
    const candidate = path.resolve(destination, file.relative);
    if (!within(destination, candidate)) {
      conflicts.push(`unsafe:${file.relative}`);
      continue;
    }
    if (!fs.existsSync(candidate)) continue;
    const candidateStat = fs.lstatSync(candidate);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
      conflicts.push(`invalid:${file.relative}`);
      continue;
    }
    try {
      if (sha256(fs.readFileSync(candidate)) !== file.sha256) conflicts.push(`different:${file.relative}`);
    } catch {
      conflicts.push(`unreadable-destination:${file.relative}`);
    }
  }
  return conflicts;
}

export function previewHarnessMigration({projectRoot}) {
  const storage = resolveHarnessStorage({projectRoot});
  if (storage.kind !== "git-common" || !fs.existsSync(storage.legacyDirectory)) {
    return {
      needed: false,
      source: storage.legacyDirectory,
      destination: storage.directory,
      files: [],
      bytes: 0,
      conflicts: [],
      treeHash: aggregateTreeHash([])
    };
  }
  const scanned = enumerateRegularFiles(storage.legacyDirectory);
  const conflicts = [
    ...scanned.conflicts,
    ...destinationConflicts(storage.directory, scanned.files)
  ].sort();
  return {
    needed: true,
    source: storage.legacyDirectory,
    destination: storage.directory,
    files: scanned.files.map(file => ({path: file.relative, bytes: file.bytes, sha256: file.sha256})),
    bytes: scanned.files.reduce((total, file) => total + file.bytes, 0),
    conflicts,
    treeHash: aggregateTreeHash(scanned.files)
  };
}

export function verifyHarnessMigration({projectRoot}) {
  const storage = resolveHarnessStorage({projectRoot});
  if (storage.kind !== "git-common" || !fs.existsSync(storage.legacyDirectory)) {
    return {valid: true, drift: []};
  }
  const drift = [];
  const manifestFile = path.join(storage.directory, "migration-manifest.json");
  let manifest;
  try {
    const stat = fs.lstatSync(manifestFile);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("invalid");
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch {
    return {valid: false, drift: ["manifest"]};
  }
  if (
    manifest?.schemaVersion !== 1
    || manifest.source !== storage.legacyDirectory
    || manifest.destination !== storage.directory
    || !Array.isArray(manifest.files)
    || !Number.isInteger(manifest.fileCount)
    || !Number.isInteger(manifest.bytes)
    || !/^[0-9a-f]{64}$/.test(manifest.treeHash ?? "")
  ) {
    return {valid: false, drift: ["manifest"]};
  }
  const scanned = enumerateRegularFiles(storage.legacyDirectory);
  if (scanned.conflicts.length > 0) drift.push(...scanned.conflicts);
  if (scanned.files.length !== manifest.fileCount) drift.push("file-count");
  if (scanned.files.reduce((total, file) => total + file.bytes, 0) !== manifest.bytes) drift.push("bytes");
  if (aggregateTreeHash(scanned.files) !== manifest.treeHash) drift.push("tree-hash");
  const manifestFiles = JSON.stringify(manifest.files);
  const scannedFiles = JSON.stringify(scanned.files.map(file => ({path: file.relative, bytes: file.bytes, sha256: file.sha256})));
  if (manifestFiles !== scannedFiles) drift.push("files");
  return {valid: drift.length === 0, drift: [...new Set(drift)].sort()};
}

function ensurePrivateDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("invalid migration directory");
    fs.chmodSync(directory, 0o700);
    return;
  }
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
}

function writePrivateJson(destination, value) {
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, {flag: "wx", mode: 0o600});
}

export function migrateHarnessStorage({projectRoot}) {
  const storage = resolveHarnessStorage({projectRoot});
  const preview = previewHarnessMigration({projectRoot});
  if (!preview.needed) return {migrated: false, manifest: null, rollback: null};
  const unsafe = preview.conflicts.filter(item => /^(?:symlink|unsupported|unreadable|unsafe|invalid-destination|invalid):/.test(item));
  if (unsafe.length > 0) throw new Error(`unsafe legacy Harness entries: ${unsafe.join(", ")}`);
  if (preview.conflicts.length > 0) throw new Error(`migration conflicts: ${preview.conflicts.join(", ")}`);
  if (fs.existsSync(storage.directory)) throw new Error("migration destination already exists");
  const managedRoot = path.dirname(storage.directory);
  if (!within(storage.commonDirectory, managedRoot)) throw new Error("unsafe migration destination");
  ensurePrivateDirectory(managedRoot);
  const staging = path.join(managedRoot, `.harness-migration-${crypto.randomUUID()}`);
  if (!within(managedRoot, staging)) throw new Error("unsafe migration staging directory");
  ensurePrivateDirectory(staging);
  try {
    for (const file of preview.files) {
      const source = path.resolve(preview.source, file.path);
      const destination = path.resolve(staging, file.path);
      if (!within(preview.source, source) || !within(staging, destination)) throw new Error("unsafe migration record");
      ensurePrivateDirectory(path.dirname(destination));
      const content = fs.readFileSync(source);
      if (sha256(content) !== file.sha256) throw new Error(`migration source changed: ${file.path}`);
      fs.writeFileSync(destination, content, {flag: "wx", mode: 0o600});
    }
    const verified = enumerateRegularFiles(staging);
    if (verified.conflicts.length > 0 || aggregateTreeHash(verified.files) !== preview.treeHash) {
      throw new Error("migration verification failed");
    }
    const rollback = {
      action: "remove_verified_destination",
      source: preview.source,
      destination: preview.destination
    };
    const manifest = {
      schemaVersion: 1,
      source: preview.source,
      destination: preview.destination,
      fileCount: preview.files.length,
      bytes: preview.bytes,
      treeHash: preview.treeHash,
      files: preview.files,
      verifiedAt: new Date().toISOString(),
      rollback
    };
    writePrivateJson(path.join(staging, "migration-manifest.json"), manifest);
    writePrivateJson(path.join(staging, "migration-rollback.json"), rollback);
    fs.renameSync(staging, storage.directory);
    return {migrated: true, manifest, rollback};
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--project") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--project requires a value");
      options.project = value;
      index += 1;
    } else if (argument === "--preview") options.preview = true;
    else if (argument === "--migrate") options.migrate = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!options.project) throw new Error("--project requires a value");
  if (Number(Boolean(options.preview)) + Number(Boolean(options.migrate)) !== 1) {
    throw new Error("use exactly one of --preview or --migrate");
  }
  return options;
}

function usage() {
  return [
    "Usage: harness-storage.mjs --preview --project <project>",
    "       harness-storage.mjs --migrate --project <project>",
    "",
    "Preview is read-only. Migration copies and verifies legacy records without deleting the legacy directory."
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = options.preview
    ? previewHarnessMigration({projectRoot: options.project})
    : migrateHarnessStorage({projectRoot: options.project});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`harness storage failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
