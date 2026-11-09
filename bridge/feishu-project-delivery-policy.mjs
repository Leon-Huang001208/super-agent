const MAX_MESSAGE_BYTES = 16_000;
const MAX_PATH_BYTES = 240;
const MAX_FILES = 8;
const FILE_LIST = /^(?:文件|允许修改)[:：]$/;
const PROJECT_KEY = /^[a-z][a-z0-9-]{0,47}$/;
const UUID = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const TASK_ID_PREFIX = new RegExp('^' + UUID + '(?:\\s|$)', 'i');
const SUPPLEMENT = new RegExp('^(' + UUID + ')\\s+补充(?:[：:]\\s*|\\s+)([\\s\\S]+)$');
const PATH_SEGMENT = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_.-]*$/u;
const PATH_REFERENCE = /(?<![A-Za-z0-9_./\\%])(?:[\\/])?(?:[A-Za-z0-9_.%*?\[\]-]+[\\/])+[A-Za-z0-9_.%*?\[\]-]+/gu;
const UNICODE_FILE_REFERENCE = /(?<![\p{L}\p{M}\p{N}_./\\%])(?:[\\/])?[A-Za-z0-9_.%*?\[\]-]+[\\/](?:[\p{L}\p{M}\p{N}_.%*?\[\]-]+[\\/])*[\p{L}\p{M}\p{N}_.%*?\[\]-]+\.[A-Za-z0-9]+(?![A-Za-z0-9_.%*?\[\]\\/])/gu;
const QUOTED_REFERENCE = /\x60([^\x60\r\n]+)\x60|「([^」\r\n]+)」|“([^”\r\n]+)”/gu;
const FILE_REFERENCE = /(?:\.[\p{L}\p{N}]+$|[%*?\[\]])/u;
const NESTED_COMMAND = /(?:^|\n)[ \t]*\/(?:任务|rwb)(?:[ \t]|$)/u;
const denied = code => ({ ok: false, code });
const invalid = code => ({ kind: 'invalid', code });

function validMessage(value) {
  return typeof value === 'string' && Buffer.byteLength(value) <= MAX_MESSAGE_BYTES &&
    value.isWellFormed() && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/u.test(value.replaceAll('\r\n', '\n'));
}

function validPath(path) {
  return typeof path === 'string' && Buffer.byteLength(path) <= MAX_PATH_BYTES &&
    path === path.normalize('NFC') && path === path.normalize('NFKC') &&
    path.split('/').every(segment => PATH_SEGMENT.test(segment) && !segment.endsWith('.'));
}

/** Validate path syntax and collisions; a trusted project adapter verifies file type and write permission. */
export function validateProjectDeliveryPaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_FILES) return denied('FPD_FILE_LIST_INVALID');
  const occupied = new Map();
  for (const path of paths) {
    if (!validPath(path)) return denied('FPD_PATH_DENIED');
    let prefix = '';
    for (const segment of path.split('/')) {
      prefix += prefix ? '/' + segment : segment;
      const key = prefix.toUpperCase().toLowerCase().normalize('NFC');
      const file = prefix === path;
      const prior = occupied.get(key);
      if (prior && (prior.prefix !== prefix || prior.file || file)) return denied('FPD_PATH_COLLISION');
      occupied.set(key, { prefix, file });
    }
  }
  return { ok: true };
}

function hasUnlistedReference(text, paths) {
  for (const [raw] of text.matchAll(PATH_REFERENCE)) {
    const reference = raw.replace(/\.$/, '');
    if (FILE_REFERENCE.test(reference.split(/[\\/]/).at(-1)) && !paths.includes(reference)) return true;
  }
  for (const [reference] of text.matchAll(UNICODE_FILE_REFERENCE)) {
    if (!paths.includes(reference)) return true;
  }
  for (const [, inline, cjk, quoted] of text.matchAll(QUOTED_REFERENCE)) {
    const reference = (inline ?? cjk ?? quoted).trim();
    if (/^[\p{L}\p{M}\p{N}_.%*?\[\]\\/:-]+$/u.test(reference) &&
        (/[\\/]/.test(reference) || FILE_REFERENCE.test(reference)) &&
        !paths.includes(reference)) return true;
  }
  return false;
}

/** Parse owner-bound text only. The caller authenticates the chat and authorizes paths for the selected project. */
export function parseFeishuProjectDeliveryRequest(text) {
  if (typeof text !== 'string' || !/^\/任务(?:[ \t\r\n]|$)/u.test(text)) return { kind: 'ignored' };
  if (!validMessage(text)) return invalid('FPD_MESSAGE_INVALID');
  const input = text.replaceAll('\r\n', '\n').trimEnd();
  const match = /^\/任务[ \t]+([^ \t\n]+)(?:[ \t]+([\s\S]+))?$/u.exec(input);
  const projectKey = match?.[1];
  if (!PROJECT_KEY.test(projectKey ?? '')) return invalid('FPD_PROJECT_KEY_INVALID');
  const body = match[2]?.trim();
  if (!body) return invalid('FPD_GOAL_REQUIRED');
  if (NESTED_COMMAND.test(body)) return invalid('FPD_MIXED_REQUEST');
  if (TASK_ID_PREFIX.test(body)) {
    const supplement = SUPPLEMENT.exec(body);
    if (!supplement || !supplement[2].trim()) return invalid('FPD_SUPPLEMENT_INVALID');
    return { kind: 'supplement', projectKey, taskId: supplement[1], text: supplement[2].trim() };
  }

  const lines = body.split('\n');
  const marker = lines.findIndex(line => FILE_LIST.test(line.trim()));
  if (marker === -1) return invalid('FPD_FILE_LIST_REQUIRED');
  const goal = lines.slice(0, marker).join('\n').trim();
  if (!goal) return invalid('FPD_GOAL_REQUIRED');
  const paths = lines.slice(marker + 1).map(line => line.trim().replace(/^-[ \t]+/, '')).filter(Boolean);
  const scope = validateProjectDeliveryPaths(paths);
  if (!scope.ok) return invalid(scope.code);
  if (hasUnlistedReference(goal, paths)) return invalid('FPD_SCOPE_EXPANSION');
  paths.sort();
  const title = Array.from(goal.split('\n')[0]).slice(0, 50).join('');
  return { kind: 'new', projectKey, goal, title, paths, pathsJson: JSON.stringify(paths) };
}

/** A supplement reuses the initial canonical path list and cannot supply another one. */
export function validateProjectDeliverySupplement(text, pathsJson) {
  let paths;
  try {
    paths = typeof pathsJson === 'string' && Buffer.byteLength(pathsJson) <= MAX_FILES * (MAX_PATH_BYTES + 4) ?
      JSON.parse(pathsJson) : null;
  } catch {
    return denied('FPD_SCOPE_INVALID');
  }
  if (!validateProjectDeliveryPaths(paths).ok || JSON.stringify([...paths].sort()) !== pathsJson) {
    return denied('FPD_SCOPE_INVALID');
  }
  if (!validMessage(text) || !text.trim()) return denied('FPD_SUPPLEMENT_INVALID');
  const normalized = text.replaceAll('\r\n', '\n');
  if (NESTED_COMMAND.test(normalized) || normalized.split('\n').some(line => FILE_LIST.test(line.trim())) ||
      hasUnlistedReference(normalized, paths)) return denied('FPD_SCOPE_EXPANSION');
  return { ok: true };
}
