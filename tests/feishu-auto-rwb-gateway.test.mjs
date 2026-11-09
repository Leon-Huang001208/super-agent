import test from 'node:test';
import assert from 'node:assert/strict';
import { maybeRegisterFeishuAutoRwb } from '../bridge/feishu-auto-rwb-gateway.mjs';

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
  const result = await maybeRegisterFeishuAutoRwb(ports);
  assert.equal(result.type, 'registered');
  assert.deepEqual(events.map(([kind]) => kind), ['reserve', 'register', 'accepted', 'bind']);
  assert.equal(events[1][1].autoScopePathsJson, pathsJson);
  assert.deepEqual(events[3][1], { operationId, taskId, inputRevision, pathsJson });
});

test('disabled scoped admission leaves the legacy path available', async () => {
  const { events, ports } = setup({ enabled: false });
  assert.equal(await maybeRegisterFeishuAutoRwb(ports), null);
  assert.equal(events.length, 0);
});

test('Native scope encoding drift blocks before creating a task', async () => {
  const { events, ports } = setup({ encode: () => null });
  assert.equal((await maybeRegisterFeishuAutoRwb(ports)).code, 'FRA_SCOPE_ENCODING_MISMATCH');
  assert.deepEqual(events.map(([kind]) => kind), ['reserve']);
});

test('unknown Native outcome keeps the original operation reserved and does not admit it', async () => {
  const { events, ports } = setup({ failAfterRegister: true });
  assert.deepEqual(await maybeRegisterFeishuAutoRwb(ports),
    { type: 'scoped_blocked', status: 'blocked', operationId, code: 'FRA_NATIVE_RESULT_UNKNOWN' });
  assert.deepEqual(events.map(([kind]) => kind), ['reserve', 'register', 'log']);
});
