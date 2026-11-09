import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFeishuProjectDeliveryAdmission } from '../bridge/feishu-auto-rwb-admission.mjs';
import { validateProjectDeliverySupplement } from '../bridge/feishu-project-delivery-policy.mjs';
import { routeFeishuProjectDelivery } from '../bridge/feishu-project-delivery.mjs';

const rwbTask = '11111111-1111-4111-8111-111111111111';
const sandboxTask = '22222222-2222-4222-8222-222222222222';
const digest = 'a'.repeat(64);
const versionTwo = 'b'.repeat(64);
const head = 'c'.repeat(40);
const newerHead = 'd'.repeat(40);

function projectsFor(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'project-intake-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const effects = [];
  const profile = (key, taskId, file) => {
    const namespace = 'feishu-auto-' + key;
    mkdirSync(path.join(root, namespace), { mode: 0o700 });
    const now = Date.now();
    writeFileSync(path.join(root, namespace, 'policy.json'), JSON.stringify({
      schemaVersion: 1, effectiveAt: now - 1, expiresAt: now + 60_000,
      scopes: [{ paths: [file], checks: ['check'] }],
    }), { mode: 0o600 });
    const admission = createFeishuProjectDeliveryAdmission({ root, namespace, validateSupplement: validateProjectDeliverySupplement });
    let context;
    return { admission, tasks: {
      async register(input) {
        effects.push([key, 'register', input.paths]);
        context = { taskId, projectKey: key, inputRevision: digest, pathsJson: input.pathsJson,
          revision: digest, status: 'done', finalized: true, pr: { headSha: head } };
        return { taskId, operationId: input.operationId, inputRevision: digest, revision: digest };
      },
      async append(input) {
        effects.push([key, 'append', input.taskId]);
        assert.equal(input.expectedRevision, digest);
        context = { ...context, inputRevision: versionTwo, revision: versionTwo, pr: { headSha: newerHead } };
        return { taskId, operationId: input.operationId, inputRevision: versionTwo, revision: versionTwo };
      },
      async readContext({ taskId: wanted }) { return wanted === taskId ? context : null; },
      async getContext({ taskId: wanted }) { return wanted === taskId ? context : null; },
      matchesScope(value, pathsJson) { return value.projectKey === key && value.pathsJson === pathsJson; },
      async onAccepted() {},
    } };
  };
  const projects = { rwb: profile('rwb', rwbTask, 'docs/super-agent/intake.md'),
    sandbox: profile('sandbox', sandboxTask, 'src/worker.js') };
  const route = (text, slot) => routeFeishuProjectDelivery({
    text, projects, operationId: '33333333-3333-4333-8333-33333333333' + slot,
    externalRef: { chatId: 'oc_owner', messageId: 'om_' + slot }, ownerOpenId: 'ou_owner',
    sourceEventKey: 'ev_' + slot, log: () => {},
  });
  return { route, effects, projects };
}

test('two projects share intake but keep scopes, permits and continuations isolated', async t => {
  const { route, effects, projects } = projectsFor(t);
  assert.equal((await route('/任务 rwb 新增文档\n文件：\ndocs/super-agent/intake.md', 1)).taskId, rwbTask);
  assert.equal((await route('/任务 sandbox 改进工作程序\n文件：\nsrc/worker.js', 2)).taskId, sandboxTask);
  assert.equal((await route('/任务 unregistered 改进工作程序\n文件：\nsrc/worker.js', 3)).code, 'FPD_PROJECT_NOT_REGISTERED');
  assert.equal((await route('/任务 rwb ' + sandboxTask + ' 补充 修改说明', 4)).code, 'FRA_SUPPLEMENT_OWNER_DENIED');
  assert.equal((await route('/任务 sandbox ' + sandboxTask + ' 补充 修改说明', 5)).inputRevision, versionTwo);
  assert.equal(projects.rwb.admission.lookup(sandboxTask), null);
  assert.equal(projects.sandbox.admission.lookup(rwbTask), null);
  assert.deepEqual(effects, [
    ['rwb', 'register', ['docs/super-agent/intake.md']],
    ['sandbox', 'register', ['src/worker.js']],
    ['sandbox', 'append', sandboxTask],
  ]);
});

