import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeishuProjectDeliveryRequest, validateProjectDeliveryPaths, validateProjectDeliverySupplement }
  from '../bridge/feishu-project-delivery-policy.mjs';

const taskId = 'a72b6bf3-12c0-4a97-8e73-bd6aef23f921';
const request = (project, goal, ...paths) => '/任务 ' + project + ' ' + goal + '\n文件：\n' + paths.join('\n');

test('selects the explicit project with the same request syntax and leaves legacy commands alone', () => {
  for (const projectKey of ['rwb', 'daily-notes']) {
    const goal = '修复src/example.mjs 中的提示，并补测试';
    const paths = ['src/example.mjs', 'tests/example.test.mjs'];
    const text = '/任务 ' + projectKey + ' ' + goal + '\r\n允许修改:\r\n- ' + paths[1] + '\r\n- ' + paths[0];
    assert.deepEqual(parseFeishuProjectDeliveryRequest(text),
      { kind: 'new', projectKey, goal, title: goal, paths, pathsJson: JSON.stringify(paths) });
  }
  assert.deepEqual(parseFeishuProjectDeliveryRequest('/rwb 修复旧任务'), { kind: 'ignored' });
  assert.deepEqual(parseFeishuProjectDeliveryRequest('/任务列表'), { kind: 'ignored' });
  assert.equal(parseFeishuProjectDeliveryRequest(request('../rwb', '修复提示', 'src/example.mjs')).code, 'FPD_PROJECT_KEY_INVALID');
  assert.equal(parseFeishuProjectDeliveryRequest('/任务 daily-notes').code, 'FPD_GOAL_REQUIRED');
  assert.equal(parseFeishuProjectDeliveryRequest('/任务 daily-notes 更新 README.md').code, 'FPD_FILE_LIST_REQUIRED');
});

test('validates generic file syntax independently of project write permission', () => {
  const paths = ['README.md', 'docs/接口说明.md', 'src/feature.go', 'Makefile'];
  assert.deepEqual(validateProjectDeliveryPaths(paths), { ok: true });
  assert.equal(parseFeishuProjectDeliveryRequest(request('daily-notes', '更新文档', ...paths)).kind, 'new');
  for (const path of [
    '.env', 'src/.hidden.js', '../README.md', 'docs/../../note.md', 'src//index.mjs', 'src/./index.mjs',
    '/src/index.mjs', 'C:/src/index.mjs', 'src\\index.mjs', 'src/*.mjs', 'src/[a-z].mjs',
    'src/%2e%2e/index.mjs', 'src/index.mjs -> ../target.mjs', 'docs/ａ.md', 'docs/e\u0301.md',
    'src/trailing.', 'src/space name.md',
  ]) {
    assert.deepEqual(validateProjectDeliveryPaths([path]), { ok: false, code: 'FPD_PATH_DENIED' }, path);
  }
  assert.deepEqual(validateProjectDeliveryPaths([]), { ok: false, code: 'FPD_FILE_LIST_INVALID' });
  assert.equal(validateProjectDeliveryPaths(Array.from({ length: 9 }, (_, i) => 'f' + i)).code, 'FPD_FILE_LIST_INVALID');
});

test('detects exact duplicates, case collisions, and directory/file prefix collisions', () => {
  for (const paths of [
    ['README.md', 'README.md'], ['README.md', 'readme.md'], ['Doc/a.md', 'doc/b.md'],
    ['src/note.md', 'src/note.md/chapter.md'], ['Doc', 'doc/note.md'],
  ]) {
    assert.deepEqual(validateProjectDeliveryPaths(paths), { ok: false, code: 'FPD_PATH_COLLISION' }, paths.join(', '));
  }
  assert.deepEqual(validateProjectDeliveryPaths(['src/a.js', 'src/b.js']), { ok: true });
});

test('rejects a second project command and unlisted explicit references', () => {
  const allowed = 'src/example.mjs';
  const extra = ['src/other.mjs', '/src/example.mjs', '../src/example.mjs', 'src/example.mjs.bak', 'src/*.mjs', 'README.md', 'docs/接口说明.md'];
  for (const path of extra) {
    assert.equal(parseFeishuProjectDeliveryRequest(request('rwb', '同时修改「' + path + '」。', allowed)).code, 'FPD_SCOPE_EXPANSION', path);
  }
  assert.equal(parseFeishuProjectDeliveryRequest(request('rwb', '先修复\n/任务 daily-notes 更新早报', allowed)).code, 'FPD_MIXED_REQUEST');
  assert.equal(parseFeishuProjectDeliveryRequest(request('rwb', '先修复\n/rwb 补充额外任务', allowed)).code, 'FPD_MIXED_REQUEST');
  assert.equal(parseFeishuProjectDeliveryRequest(request('rwb', '请读说明 https://example.com/guide.html', allowed)).kind, 'new');
  assert.equal(parseFeishuProjectDeliveryRequest(request('daily-notes', '更新 docs/接口说明.md 后汇报', 'docs/接口说明.md')).kind, 'new');
  assert.equal(parseFeishuProjectDeliveryRequest(request('daily-notes', '同时改 docs/接口说明.md 后汇报', 'README.md')).code, 'FPD_SCOPE_EXPANSION');
});

test('retains a project key for supplement lookup and requires the recorded canonical scope', () => {
  const text = '修改 src/example.mjs 的空状态';
  const pathsJson = JSON.stringify(['README.md', 'src/example.mjs']);
  assert.deepEqual(parseFeishuProjectDeliveryRequest('/任务 daily-notes ' + taskId + ' 补充：' + text),
    { kind: 'supplement', projectKey: 'daily-notes', taskId, text });
  assert.equal(parseFeishuProjectDeliveryRequest('/任务 daily-notes ' + taskId + ' 补充： ').code, 'FPD_SUPPLEMENT_INVALID');
  assert.deepEqual(validateProjectDeliverySupplement(text, pathsJson), { ok: true });
  for (const update of ['另外修改 src/other.mjs', '同时改 docs/接口说明.md', '另加「根目录说明.md」', text + '\n文件：\nsrc/example.mjs',
    text + '\n/任务 rwb 更新 UI']) {
    assert.deepEqual(validateProjectDeliverySupplement(update, pathsJson), { ok: false, code: 'FPD_SCOPE_EXPANSION' });
  }
  for (const invalid of [null, '[]', '{', '["src/example.mjs","README.md"]', '["README.md","readme.md"]']) {
    assert.deepEqual(validateProjectDeliverySupplement(text, invalid), { ok: false, code: 'FPD_SCOPE_INVALID' });
  }
});
