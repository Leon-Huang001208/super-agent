import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const PROFILE_FILENAME = "project-profile.json";

const INSTRUCTION_FILES = [
  {kind: "agent-instructions", path: "AGENTS.md"},
  {kind: "readme", path: "README.md"},
  {kind: "architecture", path: "docs/ARCHITECTURE.md"},
  {kind: "development-map", path: "docs/DEVELOPMENT_MAP.md"}
];

function log(event, details = {}) {
  process.stderr.write(`${JSON.stringify({component: "project-profile", event, ...details})}\n`);
}

function compareEntries(left, right) {
  return String(left.path ?? "").localeCompare(String(right.path ?? ""))
    || String(left.kind ?? "").localeCompare(String(right.kind ?? ""))
    || String(left.command ?? "").localeCompare(String(right.command ?? ""));
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveProjectRoot(projectRoot) {
  if (!projectRoot) throw new Error("--project requires a directory");
  let resolved;
  try {
    resolved = fs.realpathSync(projectRoot);
  } catch {
    throw new Error("invalid project directory");
  }
  if (!fs.statSync(resolved).isDirectory()) throw new Error("invalid project directory");
  if (resolved === path.parse(resolved).root || resolved === fs.realpathSync(os.homedir())) {
    throw new Error("unsafe project root");
  }
  return resolved;
}

function existingPath(root, relative, type) {
  const candidate = path.join(root, relative);
  if (!fs.existsSync(candidate)) return null;
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  if (!isWithin(root, resolved)) return null;
  const stat = fs.statSync(resolved);
  if ((type === "file" && !stat.isFile()) || (type === "directory" && !stat.isDirectory())) {
    return null;
  }
  return relative.split(path.sep).join("/");
}

function addEvidence(profile, pathValue, kind) {
  profile.evidence.push({kind, path: pathValue});
}

function addEcosystem(profile, kind, evidence) {
  if (evidence.length === 0) return;
  profile.ecosystems.push({kind, evidence: [...evidence].sort()});
}

function packageCommands(root, profile) {
  const manifest = existingPath(root, "package.json", "file");
  if (!manifest) return;
  addEvidence(profile, manifest, "manifest");
  addEcosystem(profile, "node", [manifest]);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(root, manifest), "utf8"));
  } catch {
    throw new Error("invalid package.json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid package.json");
  }
  const scripts = parsed.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return;
  const candidates = [
    {kind: "build", script: "build", command: "npm run build", argv: ["npm", "run", "build"]},
    {kind: "lint", script: "lint", command: "npm run lint", argv: ["npm", "run", "lint"]},
    {kind: "test", script: "test", command: "npm test", argv: ["npm", "test"]}
  ];
  for (const candidate of candidates) {
    if (typeof scripts[candidate.script] === "string" && scripts[candidate.script].trim()) {
      const workingDirectory = ".";
      const verifierId = `verifier-${candidate.kind}-${crypto.createHash("sha256")
        .update(`${candidate.command}\0${workingDirectory}\0${manifest}`)
        .digest("hex").slice(0, 12)}`;
      profile.commands.push({
        kind: candidate.kind,
        verifierId,
        command: candidate.command,
        argv: candidate.argv,
        workingDirectory,
        source: manifest,
        interactive: false,
        status: "candidate"
      });
    }
  }
}

function discoverWorkflows(root, profile) {
  const workflows = existingPath(root, ".github/workflows", "directory");
  if (!workflows) return;
  const directory = path.join(root, workflows);
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const relative = path.posix.join(workflows, entry.name);
    const file = existingPath(root, relative, "file");
    if (!file) continue;
    profile.ci.push({kind: "workflow", path: file});
    addEvidence(profile, file, "ci-workflow");
  }
}

export function buildProfile({projectRoot}) {
  const root = resolveProjectRoot(projectRoot);
  const profile = {
    schemaVersion: 1,
    projectRoot: root,
    instructions: [],
    ecosystems: [],
    commands: [],
    ci: [],
    platformSignals: [],
    evidence: [],
    uncertainties: ["Candidate commands have not been executed."]
  };

  for (const candidate of INSTRUCTION_FILES) {
    const discovered = existingPath(root, candidate.path, "file");
    if (!discovered) continue;
    profile.instructions.push({kind: candidate.kind, path: discovered});
    addEvidence(profile, discovered, "instruction");
  }

  packageCommands(root, profile);

  const pythonEvidence = [
    existingPath(root, "pyproject.toml", "file"),
    existingPath(root, "requirements.txt", "file")
  ].filter(Boolean);
  for (const evidence of pythonEvidence) addEvidence(profile, evidence, "manifest");
  addEcosystem(profile, "python", pythonEvidence);

  const rustManifest = existingPath(root, "Cargo.toml", "file");
  if (rustManifest) {
    addEvidence(profile, rustManifest, "manifest");
    addEcosystem(profile, "rust", [rustManifest]);
  }

  const goManifest = existingPath(root, "go.mod", "file");
  if (goManifest) {
    addEvidence(profile, goManifest, "manifest");
    addEcosystem(profile, "go", [goManifest]);
  }

  const tauriDirectory = existingPath(root, "src-tauri", "directory");
  if (tauriDirectory) {
    addEvidence(profile, tauriDirectory, "platform");
    addEcosystem(profile, "tauri", [tauriDirectory]);
    profile.platformSignals.push({kind: "desktop", path: tauriDirectory});
  }

  const dockerfile = existingPath(root, "Dockerfile", "file");
  if (dockerfile) {
    addEvidence(profile, dockerfile, "platform");
    profile.platformSignals.push({kind: "container", path: dockerfile});
  }

  discoverWorkflows(root, profile);
  for (const collection of [
    profile.instructions,
    profile.ecosystems,
    profile.commands,
    profile.ci,
    profile.platformSignals,
    profile.evidence
  ]) {
    collection.sort(compareEntries);
  }
  return profile;
}

export function formatMarkdown(profile) {
  const section = (title, rows) => {
    const body = rows.length === 0 ? "- None discovered." : rows.map(row => `- ${row}`).join("\n");
    return `## ${title}\n\n${body}`;
  };
  return [
    "# Project profile",
    "",
    `Root: \`${profile.projectRoot}\``,
    "",
    section("Instructions", profile.instructions.map(item => `\`${item.path}\` (${item.kind})`)),
    "",
    section(
      "Candidate validation commands",
      profile.commands.map(item => `\`${item.command}\` from \`${item.source}\` (${item.status})`)
    ),
    "",
    section("CI evidence", profile.ci.map(item => `\`${item.path}\` (${item.kind})`)),
    "",
    section("Uncertainties", profile.uncertainties)
  ].join("\n");
}

function writeAtomically(destination, content) {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(temporary, content, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function writeProfile({projectRoot, profile, replace = false}) {
  const root = resolveProjectRoot(projectRoot);
  if (!profile || profile.projectRoot !== root) throw new Error("profile project root mismatch");
  const directory = path.join(root, ".ai");
  const destination = path.resolve(directory, PROFILE_FILENAME);
  if (!isWithin(root, destination)) throw new Error("unsafe profile destination");
  if (fs.existsSync(destination) && !replace) throw new Error("existing project profile");
  fs.mkdirSync(directory, {recursive: true});
  writeAtomically(destination, `${JSON.stringify(profile, null, 2)}\n`);
  return destination;
}

function parseArgs(args) {
  const options = {format: "json", writeProfile: false, replaceProfile: false};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--project" || argument === "--format") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument === "--project" ? "projectRoot" : "format"] = value;
      index += 1;
    } else if (argument === "--write-profile") {
      options.writeProfile = true;
    } else if (argument === "--replace-profile") {
      options.replaceProfile = true;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.projectRoot) throw new Error("--project requires a directory");
  if (!["json", "markdown"].includes(options.format)) throw new Error("invalid format");
  if (options.replaceProfile && !options.writeProfile) {
    throw new Error("--replace-profile requires --write-profile");
  }
  return options;
}

function main(args) {
  const options = parseArgs(args);
  const profile = buildProfile({projectRoot: options.projectRoot});
  if (options.writeProfile) {
    writeProfile({
      projectRoot: options.projectRoot,
      profile,
      replace: options.replaceProfile
    });
  }
  const output = options.format === "markdown"
    ? formatMarkdown(profile)
    : JSON.stringify(profile, null, 2);
  process.stdout.write(`${output}\n`);
  log("profile_generated", {
    format: options.format,
    persisted: options.writeProfile,
    evidenceCount: profile.evidence.length
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    log("command_failed", {message: error.message});
    process.exitCode = 1;
  }
}
