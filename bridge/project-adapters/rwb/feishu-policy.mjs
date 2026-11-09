const MAX_MESSAGE_BYTES = 16_000;
const MAX_FILES = 8;
const FILE_LIST = /^(?:文件|允许修改)[:：]$/;
const UUID = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const SUPPLEMENT = new RegExp('^(' + UUID + ')\\s+补充(?:[：:]\\s*|\\s+)([\\s\\S]+)$');
const TASK_ID_PREFIX = new RegExp('^' + UUID + '(?:\\s|$)');
const DOCUMENT = /^docs\/super-agent\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.md$/;
const UI_SOURCE = /^app\/research_web\/ui\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:mjs|js|jsx|ts|tsx|css|html)$/;
const UI_TEST = /^tests\/javascript\/research_web_[A-Za-z0-9_-]+\.test\.mjs$/;
const PROTECTED_PATH_TOKEN = /(?:^|[\/._-])(?:agents|claude|auth(?:entication|orization)?|credentials?|secrets?|token|security|polic(?:y|ies)|ci|cd|releases?|deploy(?:ment)?|migrations?|lock|skills?|desktop|install(?:er|ation)?|sidecar|updater|node_modules|vendor)(?=[\/._-]|$)/i;
const REFERENCE = /(?<![A-Za-z0-9_./\\%])(?:[\\/])?(?:[A-Za-z0-9_.%*?[\]-]+[\\/])+[A-Za-z0-9_.%*?[\]-]+/g;
const invalid = code => ({ kind: 'invalid', code });

function validMessage(value) {
  return typeof value === 'string' && Buffer.byteLength(value) <= MAX_MESSAGE_BYTES &&
    value.isWellFormed() && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/u.test(value.replaceAll('\r\n', '\n'));
}

function validPath(value) {
  return typeof value === 'string' && value.length <= 240 &&
    (DOCUMENT.test(value) || UI_SOURCE.test(value) || UI_TEST.test(value)) && !PROTECTED_PATH_TOKEN.test(value);
}

function hasUnlistedReference(text, paths) {
  for (const [reference] of text.matchAll(REFERENCE)) {
    const path = reference.replace(/\.$/, '');
    // Directory references in prose do not grant or expand a file scope.
    if (/[.*?%[\]]/.test(path.split(/[\\/]/).at(-1)) && !paths.includes(path)) return true;
  }
  return false;
}

/** Parse only the owner-bound message text. The caller verifies identity and persists the operation. */
export function parseFeishuAutoRwbIntake(text) {
  if (typeof text !== 'string' || !/^\/rwb(?:[ \t\r\n]|$)/.test(text)) return { kind: 'ignored' };
  if (!validMessage(text)) return invalid('RWB_AUTO_MESSAGE_INVALID');
  const body = text.slice(4).replaceAll('\r\n', '\n').trim();
  if (!body) return invalid('RWB_AUTO_GOAL_REQUIRED');

  if (TASK_ID_PREFIX.test(body)) {
    const match = SUPPLEMENT.exec(body);
    if (!match || !match[2].trim()) return invalid('RWB_AUTO_SUPPLEMENT_INVALID');
    return { kind: 'supplement', taskId: match[1], text: match[2].trim() };
  }

  const lines = body.split('\n');
  const marker = lines.findIndex(line => FILE_LIST.test(line.trim()));
  if (marker === -1) return invalid('RWB_AUTO_FILE_LIST_REQUIRED');
  const goal = lines.slice(0, marker).join('\n').trim();
  if (!goal) return invalid('RWB_AUTO_GOAL_REQUIRED');
  const paths = lines.slice(marker + 1).map(line => line.trim().replace(/^-[ \t]+/, '')).filter(Boolean);
  if (!paths.length || paths.length > MAX_FILES || new Set(paths).size !== paths.length) {
    return invalid('RWB_AUTO_FILE_LIST_INVALID');
  }
  if (!paths.every(validPath)) return invalid('RWB_AUTO_PATH_DENIED');
  if (hasUnlistedReference(goal, paths)) return invalid('RWB_AUTO_SCOPE_EXPANSION');
  paths.sort();
  const title = Array.from(goal.split('\n')[0]).slice(0, 50).join('');
  return { kind: 'new', goal, title, paths, pathsJson: JSON.stringify(paths) };
}

/** Check a supplement against the exact canonical path list recorded at registration. */
export function validateFeishuAutoRwbSupplement(text, pathsJson) {
  let paths;
  try { paths = typeof pathsJson === 'string' && pathsJson.length <= MAX_FILES * 244 ? JSON.parse(pathsJson) : null; }
  catch { return { ok: false, code: 'RWB_AUTO_SCOPE_INVALID' }; }
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_FILES || !paths.every(validPath) ||
      JSON.stringify([...new Set(paths)].sort()) !== pathsJson) return { ok: false, code: 'RWB_AUTO_SCOPE_INVALID' };
  if (!validMessage(text) || !text.trim()) return { ok: false, code: 'RWB_AUTO_SUPPLEMENT_INVALID' };
  if (text.replaceAll('\r\n', '\n').split('\n').some(line => FILE_LIST.test(line.trim())) || hasUnlistedReference(text, paths)) {
    return { ok: false, code: 'RWB_AUTO_SCOPE_EXPANSION' };
  }
  return { ok: true };
}
