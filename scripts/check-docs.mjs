import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'logs', 'dist', 'coverage']);

function checkedPath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('UNSAFE_DOCUMENT_PATH');
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('UNSAFE_DOCUMENT_PATH');
  let current = root;
  for (const component of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('UNSAFE_DOCUMENT_PATH');
  }
  return target;
}

function markdownWithoutCode(body, removeInline = true) {
  let fence;
  return body.split('\n').map(line => {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) {
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : removeInline ? line.replace(/`+[^`\n]*`+/g, '') : line;
  }).join('\n');
}

function links(body) {
  const text = markdownWithoutCode(body);
  const definitions = new Map([...text.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)].map(m => [m[1].trim().toLowerCase(), m[2]]));
  const result = [...text.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)].map(m => ({ target: m[1].replace(/^<|>$/g, '') }));
  for (const m of text.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const key = (m[2] || m[1]).trim().toLowerCase();
    result.push(definitions.has(key) ? { target: definitions.get(key) } : { missingReference: true });
  }
  for (const m of text.matchAll(/!?\[([^\]\n]+)\](?![\[(:])/g)) {
    const target = definitions.get(m[1].trim().toLowerCase());
    if (target) result.push({ target });
  }
  return result;
}

function anchors(body) {
  const seen = new Map(); const result = new Set();
  for (const m of markdownWithoutCode(body, false).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = m[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').trim().replace(/\s/g, '-');
    const count = seen.get(slug) ?? 0; result.add(count ? `${slug}-${count}` : slug); seen.set(slug, count + 1);
  }
  return result;
}

function validManifest(m) {
  const strings = x => Array.isArray(x) && x.every(v => typeof v === 'string' && v.length > 0);
  return m?.schemaVersion === 1 && strings(m.required) && m.required.length > 0 &&
    m.entrypoints && typeof m.entrypoints === 'object' && !Array.isArray(m.entrypoints) && Object.values(m.entrypoints).every(strings) &&
    Array.isArray(m.rules) && m.rules.every(r => typeof r.prefix === 'string' && r.prefix.length > 0 && strings(r.docs) && r.docs.length > 0) &&
    strings(m.snapshots) && strings(m.historicalPrefixes) && strings(m.nonCode);
}

function independentApproval(context) {
  if (!/^[a-f0-9]{40}$/.test(context?.headSha ?? '') || typeof context?.author !== 'string' || !context.author || !Array.isArray(context.reviews)) return false;
  const latest = new Map();
  for (const r of context.reviews) {
    const login = r?.user?.login;
    if (typeof login !== 'string' || !login || !Number.isFinite(Date.parse(r.submitted_at))) continue;
    if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) continue;
    if (!latest.has(login) || Date.parse(r.submitted_at) >= Date.parse(latest.get(login).submitted_at)) latest.set(login, r);
  }
  return [...latest.values()].some(r => r.user.login.toLowerCase() !== context.author.toLowerCase() && r.state === 'APPROVED' && r.commit_id === context.headSha);
}

export function checkDocumentation(root, { changedFiles = [], reviewContext, baselineManifest } = {}) {
  root = path.resolve(root);
  const errors = []; const documents = new Map();
  const add = (code, file) => errors.push({ code, file });
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(checkedPath(root, 'docs/documentation-governance.json'), 'utf8'));
    if (!validManifest(manifest)) throw new Error('INVALID_GOVERNANCE_MANIFEST');
  } catch { return { ok: false, errors: [{ code: 'INVALID_GOVERNANCE_MANIFEST', file: 'docs/documentation-governance.json' }], documentCount: 0 }; }
  if (baselineManifest !== undefined && !validManifest(baselineManifest)) return { ok: false, errors: [{ code: 'INVALID_BASELINE_MANIFEST', file: 'docs/documentation-governance.json' }], documentCount: 0 };
  const isHistorical = f => manifest.historicalPrefixes.some(p => f.startsWith(p));
  for (const f of [...manifest.required, ...Object.keys(manifest.entrypoints), ...Object.values(manifest.entrypoints).flat(), ...manifest.rules.flatMap(r => r.docs)]) {
    try {
      const target = checkedPath(root, f);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) add('REQUIRED_DOCUMENT_MISSING', f);
      if (isHistorical(f) || manifest.snapshots.includes(f)) add('HISTORICAL_AUTHORITY', f);
    } catch (error) { add(error.message === 'UNSAFE_DOCUMENT_PATH' ? error.message : 'DOCUMENT_READ_FAILED', f); }
  }
  function walk(relative = '') {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (ignoredDirectories.has(entry.name)) continue;
      if (entry.isSymbolicLink()) { if (entry.name.endsWith('.md') || entry.isDirectory()) add('UNSAFE_DOCUMENT_PATH', name); continue; }
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && entry.name.endsWith('.md')) documents.set(name, fs.readFileSync(checkedPath(root, name), 'utf8'));
    }
  }
  try { walk(); } catch { add('DOCUMENT_READ_FAILED', '.'); }
  const resolvedLinks = new Map();
  for (const [file, body] of documents) {
    const targets = new Set(); resolvedLinks.set(file, targets);
    for (const link of links(body)) {
      if (link.missingReference) { add('LINK_REFERENCE_MISSING', file); continue; }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link.target)) continue;
      try {
        const [rawPath, rawAnchor] = link.target.split('#', 2);
        const local = decodeURIComponent(rawPath.split('?')[0]);
        const relative = local ? path.posix.join(path.posix.dirname(file), local) : file;
        // An absolute URL path is outside the portable checkout contract.
        if (local.startsWith('/')) throw new Error('UNSAFE_DOCUMENT_PATH');
        const target = checkedPath(root, relative);
        targets.add(path.relative(root, target).split(path.sep).join('/'));
        if (!fs.existsSync(target)) add('LINK_TARGET_MISSING', file);
        else if (rawAnchor && target.endsWith('.md') && !anchors(fs.readFileSync(target, 'utf8')).has(decodeURIComponent(rawAnchor))) add('LINK_ANCHOR_MISSING', file);
      } catch (error) { add(error.message === 'UNSAFE_DOCUMENT_PATH' ? error.message : 'INVALID_DOCUMENT_LINK', file); }
    }
  }
  for (const [file, expected] of Object.entries(manifest.entrypoints)) {
    for (const target of expected) if (!resolvedLinks.get(file)?.has(target)) add('AUTHORITY_LINK_MISSING', file);
  }
  let exceptions = [];
  try {
    const target = checkedPath(root, '.github/documentation-exceptions.json');
    if (fs.existsSync(target)) exceptions = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!Array.isArray(exceptions) || exceptions.some(e => typeof e.path !== 'string' || typeof e.reason !== 'string' || e.reason.trim().length < 12)) throw new Error('INVALID_DOCUMENTATION_EXCEPTION');
  } catch { add('INVALID_DOCUMENTATION_EXCEPTION', '.github/documentation-exceptions.json'); exceptions = []; }
  if (!Array.isArray(changedFiles) || changedFiles.some(f => typeof f !== 'string')) {
    add('INVALID_CHANGED_FILES', '.'); changedFiles = [];
  }
  const changed = new Set(changedFiles);
  for (const file of changed) {
    try { checkedPath(root, file); } catch { add('UNSAFE_DOCUMENT_PATH', file); continue; }
    if (file.endsWith('.md')) continue;
    for (const policy of [manifest, ...(baselineManifest ? [baselineManifest] : [])]) {
      if (policy.nonCode.includes(file)) continue;
      const rule = policy.rules.filter(r => file.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
      // New paths may acquire a new candidate mapping; existing base mappings remain binding.
      if (!rule) { if (policy === manifest) add('UNMAPPED_CHANGE', file); continue; }
      if (rule.docs.some(f => changed.has(f) && documents.has(f) && !isHistorical(f) && !manifest.snapshots.includes(f) && !policy.snapshots.includes(f) && !policy.historicalPrefixes.some(p => f.startsWith(p)))) continue;
      if (exceptions.some(e => e.path === file) && independentApproval(reviewContext)) continue;
      add(policy === manifest ? 'DOCUMENTATION_UPDATE_REQUIRED' : 'BASELINE_DOCUMENTATION_UPDATE_REQUIRED', file);
    }
  }
  return { ok: errors.length === 0, errors, documentCount: documents.size, changedFileCount: changed.size };
}

export function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--changes', '--review-context', '--baseline-manifest'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('INVALID_DOCUMENTATION_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  const result = checkDocumentation(projectRoot, {
    changedFiles: options['--changes'] ? JSON.parse(fs.readFileSync(options['--changes'], 'utf8')) : [],
    reviewContext: options['--review-context'] ? JSON.parse(fs.readFileSync(options['--review-context'], 'utf8')) : undefined,
    baselineManifest: options['--baseline-manifest'] ? JSON.parse(fs.readFileSync(options['--baseline-manifest'], 'utf8')) : undefined,
  });
  const directory = process.env.SUPER_AGENT_LOG_ROOT || path.join(projectRoot, 'logs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('UNSAFE_LOG_DIRECTORY');
  const receipt = { component: 'documentation-governance', at: new Date().toISOString(), mode: options['--changes'] ? 'structure-and-change-mapping' : 'structure-only', ...result };
  const log = path.join(directory, `documentation-${crypto.randomUUID()}.json`);
  fs.writeFileSync(log, JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ...receipt, log }));
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ component: 'documentation-governance', errorCode: /^[A-Z_]+$/.test(error.message) ? error.message : 'DOCUMENTATION_CHECK_FAILED', status: 'failed' }));
    process.exitCode = 1;
  }
}
