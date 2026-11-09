import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRwbFeishuDelivery } from '../bridge/project-adapters/rwb/feishu-adapter.mjs';
import { appendScopedCompletion, requireProjectDeliveryChecks, scopedCompletionReceipt } from '../bridge/feishu-project-delivery.mjs';

const operationId = 'ac5fd1ba-91bd-4d15-90cb-40418bbdbfd4';
const taskId = 'b9e6b56d-744b-4d1b-8d5c-029153e06d20';
const target = 'docs/super-agent/feishu-auto-delivery.md';
const inputRevision = 'b'.repeat(64);
const pathsJson = JSON.stringify([target]);

function setup({ enabled = true, failAfterRegister = false, encode = () => pathsJson } = {}) {
  const events = [];
  const ports = {
    text: '/rwb 记录验收方法\n文件：\n' + target,
    operationId, externalRef: { chatId: 'oc_owner', messageId: 'om_test' },
    sourceEventKey: 'ev_test', ownerOpenId: 'ou_owner', codePathsFromGoal: encode,
    async log(row) { events.push(['log', row.code]); },
    admission: {
      async enabled() { return enabled; },
      async reserve(value) { events.push(['reserve', value]); return { pathsJson }; },
      bind(value) { events.push(['bind', value]); },
    },
    native: {
      async getTaskContext(value) {
        assert.equal(value.taskId, taskId);
        return { inputRevision, fullTaskInput: { taskKind: 'code_patch', codeAllowedPathsJson: pathsJson } };
      },
      async registerExternalTask(value) {
        events.push(['register', value]);
        if (failAfterRegister) throw Error('Transport lost');
        return { taskId, operationId, revision: 'a'.repeat(64), inputRevision, created: true };
      },
    },
    async onAccepted(value) { events.push(['accepted', value]); },
  };
  return { events, ports };
}

test('scoped Feishu registration reserves the exact source before Native then binds only the confirmed revision', async () => {
  const { events, ports } = setup();
  const result = await routeRwbFeishuDelivery(ports);
  assert.equal(result.type, 'registered');
  assert.deepEqual(events.map(([kind]) => kind), ['reserve', 'register', 'accepted', 'bind']);
  assert.equal(events[1][1].autoScopePathsJson, pathsJson);
  assert.deepEqual(events[3][1], { operationId, taskId, inputRevision, pathsJson });
});

test('disabled scoped admission leaves the legacy path available', async () => {
  const { events, ports } = setup({ enabled: false });
  assert.equal(await routeRwbFeishuDelivery(ports), null);
  assert.equal(events.length, 0);
});

test('a named project command never falls through to legacy without a scoped admission', async () => {
  const { events, ports } = setup();
  ports.admission = undefined;
  ports.text = '/任务 sandbox 验收\n文件：\nsrc/worker.js';
  assert.equal((await routeRwbFeishuDelivery(ports)).code, 'FRA_POLICY_DISABLED');
  assert.equal(events.length, 0);
});

test('Native scope encoding drift blocks before creating a task', async () => {
  const { events, ports } = setup({ encode: () => null });
  assert.equal((await routeRwbFeishuDelivery(ports)).code, 'FRA_SCOPE_ENCODING_MISMATCH');
  assert.deepEqual(events.map(([kind]) => kind), ['reserve', 'log']);
});

test('unknown Native outcome keeps the original operation reserved and does not admit it', async () => {
  const { events, ports } = setup({ failAfterRegister: true });
  assert.deepEqual(await routeRwbFeishuDelivery(ports),
    { type: 'scoped_blocked', status: 'blocked', operationId, code: 'FRA_NATIVE_RESULT_UNKNOWN' });
  assert.deepEqual(events.map(([kind]) => kind), ['reserve', 'register', 'log']);
});

test('a retired scoped supplement cannot fall back to the legacy registration path', async () => {
  const { events, ports } = setup({ enabled: false });
  ports.text = '/rwb ' + taskId + ' 补充 修改措辞';
  ports.admission.lookup = id => id === taskId ? { taskId } : null;
  assert.equal((await routeRwbFeishuDelivery(ports)).code, 'FRA_POLICY_DISABLED');
  assert.deepEqual(events, []);
});

test('a passing host receipt must include the admitted checks at the exact candidate and input revision', () => {
  const candidateSha = 'd'.repeat(40);
  const scope = { inputRevision, checks: ['project-constraints-local'] };
  const result = { candidateSha, status: 'passed', checks: [{ name: 'project-constraints-local', exitCode: 0 }] };
  assert.equal(requireProjectDeliveryChecks(scope, { inputRevision, candidateSha, result }), result);
  assert.throws(() => requireProjectDeliveryChecks(scope, { inputRevision, candidateSha, result: { ...result, checks: [] } }),
    { code: 'FRA_VALIDATION_SCOPE_CHANGED' });
  assert.throws(() => requireProjectDeliveryChecks(scope, { inputRevision, candidateSha: 'e'.repeat(40), result }),
    { code: 'FRA_VALIDATION_SCOPE_CHANGED' });
});

test('an original delivery receipt is rendered the same after the next input version binds', () => {
  const previousHead = 'c'.repeat(40);
  const before = scopedCompletionReceipt({ version: 1, inputRevision }, previousHead);
  const scope = { version: 2, previousHead, previousInputRevision: inputRevision, inputRevision: 'd'.repeat(64) };
  const after = scopedCompletionReceipt(scope, previousHead);
  assert.deepEqual(before, after);
  assert.equal(appendScopedCompletion('完成', before), appendScopedCompletion('完成', after));
  assert.equal(scopedCompletionReceipt(scope, 'd'.repeat(40)).autoVersion, 2);
});
