import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeishuAutoRwbIntake, validateFeishuAutoRwbSupplement } from '../bridge/feishu-auto-rwb-policy.mjs';

const doc = 'docs/super-agent/feishu-scope.md';
const ui = 'app/research_web/ui/progress.mjs';
const uiTest = 'tests/javascript/research_web_progress.test.mjs';
const taskId = 'a72b6bf3-12c0-4a97-8e73-bd6aef23f921';
const request = (goal, ...paths) => '/rwb ' + goal + '\n文件：\n' + paths.join('\n');

test('recognizes only the RWB command and requires an explicit file list', () => {
  for (const text of [null, '请修改文档', '/rwb-other 修改']) {
    assert.deepEqual(parseFeishuAutoRwbIntake(text), { kind: 'ignored' });
  }
  assert.deepEqual(parseFeishuAutoRwbIntake('/rwb'), { kind: 'invalid', code: 'RWB_AUTO_GOAL_REQUIRED' });
  assert.deepEqual(parseFeishuAutoRwbIntake('/rwb 请修改 ' + doc),
    { kind: 'invalid', code: 'RWB_AUTO_FILE_LIST_REQUIRED' });
  assert.deepEqual(parseFeishuAutoRwbIntake('/rwb \n文件：\n' + doc),
    { kind: 'invalid', code: 'RWB_AUTO_GOAL_REQUIRED' });
  assert.deepEqual(parseFeishuAutoRwbIntake(request('修改')), { kind: 'invalid', code: 'RWB_AUTO_FILE_LIST_INVALID' });
});

test('canonicalizes explicit document, UI and test paths without deriving scope from the goal', () => {
  assert.deepEqual(parseFeishuAutoRwbIntake(request('补充飞书说明', doc)), {
    kind: 'new', goal: '补充飞书说明', title: '补充飞书说明', paths: [doc], pathsJson: JSON.stringify([doc]),
  });
  const goal = '调整进度页显示\n请修改 ' + ui + ' 并补对应测试。';
  const value = '/rwb ' + goal.replaceAll('\n', '\r\n') + '\r\n允许修改:\r\n- ' + uiTest + '\r\n- ' + ui;
  assert.deepEqual(parseFeishuAutoRwbIntake(value), {
    kind: 'new', goal, title: '调整进度页显示', paths: [ui, uiTest], pathsJson: JSON.stringify([ui, uiTest]),
  });
});

test('denies duplicates, oversized lists, glob paths, escape paths and protected files', () => {
  assert.equal(parseFeishuAutoRwbIntake(request('修改', doc, '- ' + doc)).code, 'RWB_AUTO_FILE_LIST_INVALID');
  assert.equal(parseFeishuAutoRwbIntake(request('修改', ...Array.from({ length: 9 }, (_, index) =>
    'docs/super-agent/file-' + index + '.md'))).code, 'RWB_AUTO_FILE_LIST_INVALID');
  for (const path of [
    '../' + doc, '/' + doc, 'docs/super-agent//note.md', 'docs/super-agent/.secret.md',
    'docs/super-agent/../note.md', 'docs/super-agent/.%2e/note.md', 'docs/super-agent\\note.md',
    'docs/super-agent/*.md', 'docs/super-agent/note.md?x', 'docs/super-agent/AGENTS.md',
    'app/research_web/ui/session-auth.mjs', 'app/research_web/ui/progress-data.json',
    'app/research_web/ui/progress.mjs.exe', 'tests/javascript/other.test.mjs',
    'tests/javascript/research_web_progress.test.mjs/child.mjs', 'scripts/verify.mjs',
  ]) {
    assert.deepEqual(parseFeishuAutoRwbIntake(request('修改', path)), { kind: 'invalid', code: 'RWB_AUTO_PATH_DENIED' }, path);
  }
  assert.equal(parseFeishuAutoRwbIntake(request('a'.repeat(16000), doc)).code, 'RWB_AUTO_MESSAGE_INVALID');
  assert.equal(parseFeishuAutoRwbIntake(request('修改\u0000', doc)).code, 'RWB_AUTO_MESSAGE_INVALID');
});

test('rejects explicit file references outside the declaration, including aliases and path prefixes', () => {
  for (const path of [ui, '/' + doc, '../' + doc, doc + '.bak', 'app/research_web/ui/*.mjs',
    'docs/super-agent/%2e%2e/other.md', 'app\\research_web\\ui\\progress.mjs', 'scripts/check.py']) {
    assert.deepEqual(parseFeishuAutoRwbIntake(request('同时修改「' + path + '」。', doc)),
      { kind: 'invalid', code: 'RWB_AUTO_SCOPE_EXPANSION' }, path);
  }
  assert.equal(parseFeishuAutoRwbIntake(request('修改「' + doc + '」。', doc)).kind, 'new');
});

test('recognizes an existing task supplement and fences it to the original canonical scope', () => {
  const text = '把 ' + ui + ' 的空状态改为明确提示';
  const scope = JSON.stringify([ui, uiTest]);
  assert.deepEqual(parseFeishuAutoRwbIntake('/rwb ' + taskId + ' 补充：' + text), {
    kind: 'supplement', taskId, text,
  });
  assert.equal(parseFeishuAutoRwbIntake('/rwb ' + taskId + ' 补充： ').code, 'RWB_AUTO_SUPPLEMENT_INVALID');
  assert.deepEqual(validateFeishuAutoRwbSupplement(text, scope), { ok: true });
  assert.deepEqual(validateFeishuAutoRwbSupplement('另外修改 ' + doc, scope),
    { ok: false, code: 'RWB_AUTO_SCOPE_EXPANSION' });
  assert.deepEqual(validateFeishuAutoRwbSupplement('修改说明\n文件：\n' + ui, scope),
    { ok: false, code: 'RWB_AUTO_SCOPE_EXPANSION' });
  for (const invalid of [undefined, '[]', '{', JSON.stringify([uiTest, ui]), JSON.stringify([ui, ui]), JSON.stringify(['/etc/passwd'])]) {
    assert.deepEqual(validateFeishuAutoRwbSupplement(text, invalid), { ok: false, code: 'RWB_AUTO_SCOPE_INVALID' });
  }
});
