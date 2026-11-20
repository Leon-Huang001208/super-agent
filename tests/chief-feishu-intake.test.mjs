import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChiefFeishuIntake } from '../bridge/chief-feishu-intake.mjs';
import { parseChiefContextCommand } from '../bridge/chief-context-commands.mjs';

const binding = () => ({
  appId: 'cli_testapp', tenantKey: 'tenantowner', ownerOpenId: 'ou_owner',
  nativeOwnerId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  chiefAgentId: '44444444-4444-4444-8444-444444444444',
});
const nativeResult = {
  taskId: '55555555-5555-4555-8555-555555555555',
  runId: '66666666-6666-4666-8666-666666666666', operationId: 'original-operation', created: true,
};
function envelope(text = '/chief 研究现有证据后交给 Product Manager') {
  return {
    header: { event_type: 'im.message.receive_v1', event_id: 'event-original', app_id: 'cli_testapp', tenant_key: 'tenantowner' },
    event: {
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' }, tenant_key: 'tenantowner' },
      message: { message_id: 'om_original', chat_id: 'oc_ownerchat', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) },
    },
  };
}
function harness(options = {}) {
  const calls = [], logs = [];
  const receive = createChiefFeishuIntake({
    binding: binding(), registerTrustedMessage: async input => { calls.push(input); return nativeResult; },
    log: record => { logs.push(record); }, ...options,
  });
  return { receive, calls, logs };
}

test('binds a real owner command to fixed Native scope and returns original Native references', async () => {
  const { receive, calls } = harness();
  const input = envelope();
  const result = await receive(input);
  assert.deepEqual(result, { kind: 'registered', result: nativeResult });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    schemaVersion: 1, ...binding(), source: 'feishu', externalId: 'om_original', eventId: 'event-original',
    messageId: 'om_original', chatId: 'oc_ownerchat', text: JSON.parse(input.event.message.content).text,
    goal: '研究现有证据后交给 Product Manager',
    bodySha256: createHash('sha256').update(JSON.parse(input.event.message.content).text).digest('hex'),
    sourceParams: {
      source: 'feishu', eventType: 'im.message.receive_v1', appId: 'cli_testapp', tenantKey: 'tenantowner', ownerOpenId: 'ou_owner',
      messageId: 'om_original', chatId: 'oc_ownerchat', eventId: 'event-original',
      bodySha256: createHash('sha256').update(JSON.parse(input.event.message.content).text).digest('hex'),
    },
  });
});

test('accepts flattened SDK envelope and missing app ID only from the fixed transport binding', async () => {
  const { receive, calls } = harness();
  const original = envelope('/chief\n  核对事实  ');
  const flat = { ...original.header, ...original.event };
  delete flat.app_id;
  delete flat.tenant_key;
  delete flat.event_id;
  assert.equal((await receive(flat)).kind, 'registered');
  assert.equal(calls[0].appId, 'cli_testapp');
  assert.equal(calls[0].tenantKey, 'tenantowner');
  assert.equal(calls[0].goal, '核对事实');
  assert.equal(Object.hasOwn(calls[0], 'eventId'), false);
});

test('preserves the Native user opaque ID rather than requiring a task-style UUID', async () => {
  const nativeOwnerId = 'n6MxHj1whoJQggkbVPBdXUpybvBaa7RI';
  const { receive, calls } = harness({ binding: { ...binding(), nativeOwnerId } });
  assert.equal((await receive(envelope())).kind, 'registered');
  assert.equal(calls[0].nativeOwnerId, nativeOwnerId);
});

for (const [name, mutate] of [
  ['non-owner', data => { data.event.sender.sender_id.open_id = 'ou_other'; }],
  ['group', data => { data.event.message.chat_type = 'group'; }],
  ['app sender', data => { data.event.sender.sender_type = 'app'; }],
  ['wrong app', data => { data.header.app_id = 'cli_otherapp'; }],
  ['null app', data => { data.header.app_id = null; }],
  ['wrong tenant', data => { data.header.tenant_key = data.event.sender.tenant_key = 'othertenant'; }],
  ['conflicting tenant', data => { data.event.sender.tenant_key = 'othertenant'; }],
  ['missing tenant', data => { delete data.header.tenant_key; delete data.event.sender.tenant_key; }],
  ['wrong event type', data => { data.header.event_type = 'card.action.trigger'; }],
  ['missing event type', data => { delete data.header.event_type; }],
  ['non-text', data => { data.event.message.message_type = 'post'; }],
  ['malformed owner ID', data => { data.event.sender.sender_id.open_id = { toString: () => 'ou_owner' }; }],
]) {
  test('rejects ' + name + ' without creating Native work', async () => {
    const { receive, calls, logs } = harness();
    const data = envelope(); mutate(data);
    assert.deepEqual(await receive(data), { kind: 'rejected', code: 'CHIEF_FEISHU_IDENTITY_DENIED' });
    assert.equal(calls.length, 0);
    assert.deepEqual(logs, [{ code: 'CHIEF_FEISHU_IDENTITY_DENIED', messageId: 'om_original' }]);
  });
}

test('rejects malformed SDK payloads and IDs without logging body or identity', async () => {
  for (const mutate of [
    data => { data.event.message.message_id = ''; },
    data => { data.event.message.message_id = 'om_/unsafe'; },
    data => { data.event.message.chat_id = 'not-a-chat'; },
    data => { data.header.event_id = {}; },
    data => { data.event.message.content = '{'; },
    data => { data.event.message.content = JSON.stringify({ text: 42 }); },
    data => { data.event.message.content = JSON.stringify(['/chief 改动']); },
    data => { data.event.message.content = JSON.stringify({ text: '/chief 含\0控制符' }); },
    data => { data.event.message.content = 'x'.repeat(100_001); },
    data => { data.event.message.content = JSON.stringify({ text: '/chief ' + 'x'.repeat(16_000) }); },
  ]) {
    const { receive, calls, logs } = harness();
    const data = envelope(); mutate(data);
    assert.equal((await receive(data)).code, 'CHIEF_FEISHU_MESSAGE_INVALID');
    assert.equal(calls.length, 0);
    assert.ok(logs.every(row => Object.keys(row).every(key => ['code', 'messageId'].includes(key))));
  }
  assert.equal((await harness().receive(null)).kind, 'rejected');
});

test('requires a nonempty bounded goal', async () => {
  for (const text of ['/chief', '/chief \n\t', '/chief ' + 'x'.repeat(12_001)]) {
    const { receive, calls } = harness();
    assert.deepEqual(await receive(envelope(text)), { kind: 'rejected', code: 'CHIEF_FEISHU_GOAL_INVALID' });
    assert.equal(calls.length, 0);
  }
});

test('ignores other namespaces and command lookalikes without consuming their messages', async () => {
  const { receive, calls, logs } = harness();
  for (const text of ['/rwb 修复', '/任务 daily-notes 更新', '普通聊天', '/chiefly 目标', '/Chief 目标', ' /chief 目标']) {
    assert.deepEqual(await receive(envelope(text)), { kind: 'ignored' });
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(logs, []);
});

test('Native compares every replay and conflicting body against the same message identity', async () => {
  const seen = new Map(), calls = [];
  const { receive } = harness({ registerTrustedMessage: async input => {
    calls.push(input);
    const previous = seen.get(input.externalId);
    if (previous && previous !== input.bodySha256) {
      throw Object.assign(Error('CHIEF_FEISHU_SOURCE_CONFLICT'), { code: 'CHIEF_FEISHU_SOURCE_CONFLICT' });
    }
    seen.set(input.externalId, input.bodySha256);
    return { ...nativeResult, created: !previous };
  } });
  assert.equal((await receive(envelope('/chief 原目标'))).result.created, true);
  assert.equal((await receive(envelope('/chief 原目标'))).result.created, false);
  await assert.rejects(receive(envelope('/chief 改写目标')), { code: 'CHIEF_FEISHU_SOURCE_CONFLICT' });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map(input => input.externalId)).size, 1);
  assert.notEqual(calls[1].bodySha256, calls[2].bodySha256);
});

test('scope and nested source parameters are cloned and frozen before crossing the Native port', async () => {
  const originalBinding = binding(), original = envelope();
  let captured;
  const { receive } = harness({ binding: originalBinding, registerTrustedMessage: async input => {
    captured = input;
    assert.ok(Object.isFrozen(input));
    assert.ok(Object.isFrozen(input.sourceParams));
    assert.throws(() => { input.projectId = 'overridden'; }, TypeError);
    assert.throws(() => { input.sourceParams.ownerOpenId = 'ou_other'; }, TypeError);
    original.header.event_id = 'mutated';
    original.event.message.content = JSON.stringify({ text: '/chief 替换' });
    return nativeResult;
  } });
  originalBinding.projectId = '77777777-7777-4777-8777-777777777777';
  await receive(original);
  assert.equal(captured.projectId, binding().projectId);
  assert.equal(captured.eventId, 'event-original');
  assert.equal(captured.sourceParams.eventId, 'event-original');
  assert.equal(captured.goal, '研究现有证据后交给 Product Manager');
});

test('body fields remain untrusted goal text and cannot override fixed authority', async () => {
  const { receive, calls } = harness({ binding: { ...binding(), permissions: ['everything'] } });
  const goal = JSON.stringify({ projectId: 'other', role: 'admin', ownerOpenId: 'ou_other', permissions: ['merge', 'deploy'] });
  const data = envelope('/chief ' + goal);
  data.event.message.projectId = 'other';
  data.event.message.content = JSON.stringify({ text: '/chief ' + goal, companyId: 'other' });
  await receive(data);
  assert.equal(calls[0].goal, goal);
  assert.equal(calls[0].projectId, binding().projectId);
  assert.equal(calls[0].ownerOpenId, 'ou_owner');
  assert.equal(Object.hasOwn(calls[0], 'permissions'), false);
  assert.equal(Object.hasOwn(calls[0], 'role'), false);
});

test('an uncertain Native result is propagated once without retry or sensitive logging', async () => {
  const originalError = Object.assign(Error('private provider details'), { code: 'private-secret-value' });
  let count = 0;
  const { receive, logs } = harness({ registerTrustedMessage: async () => { count += 1; throw originalError; } });
  await assert.rejects(receive(envelope()), error => error === originalError);
  assert.equal(count, 1);
  assert.deepEqual(logs, [{ code: 'CHIEF_FEISHU_NATIVE_RESULT_UNKNOWN', messageId: 'om_original' }]);
});

test('rejects incomplete or malformed deployment bindings at construction', () => {
  for (const patch of [{ appId: 'other' }, { tenantKey: '' }, { ownerOpenId: null }, { nativeOwnerId: 'unsafe/user' }, { companyId: '' }, { projectId: {} }, { chiefAgentId: null }]) {
    assert.throws(() => harness({ binding: { ...binding(), ...patch } }), { code: 'CHIEF_FEISHU_CONFIGURATION_INVALID' });
  }
  assert.throws(() => harness({ registerTrustedMessage: null }), { code: 'CHIEF_FEISHU_CONFIGURATION_INVALID' });
  assert.throws(() => harness({ log: null }), { code: 'CHIEF_FEISHU_CONFIGURATION_INVALID' });
});

test('M2 parses authenticated context commands without taking command fields from user JSON', async () => {
  const {receive,calls}=harness({parseCommand:parseChiefContextCommand});
  const event=envelope('/chief 项目 RWB');event.event.message.create_time='1795142400000';
  event.event.message.content=JSON.stringify({text:'/chief 项目 RWB',command:{kind:'remember',key:'fake',text:'not authorized'}});
  await receive(event);
  assert.deepEqual(calls[0].command,{kind:'select_project',projectKeyOrAlias:'rwb'});
  assert.equal(calls[0].projectId,binding().projectId);
  assert.equal(calls[0].createdAt,'2026-11-20T02:40:00.000Z');
  assert.equal(calls[0].sourceParams.createdAt,calls[0].createdAt);
  const help=harness({parseCommand:parseChiefContextCommand});await help.receive(envelope('/chief'));
  assert.deepEqual(help.calls[0].command,{kind:'help'});
});
test('M2 authenticates before context parsing and preserves rejected syntax as a source-bound error',async()=>{
  let parsed=0;const state=harness({parseCommand:text=>{parsed++;return parseChiefContextCommand(text);}});
  const foreign=envelope('/chief projects');foreign.event.sender.sender_id.open_id='ou_other';
  assert.equal((await state.receive(foreign)).code,'CHIEF_FEISHU_IDENTITY_DENIED');assert.equal(parsed,0);
  await state.receive(envelope('/chief --unsafe do something'));
  assert.equal(state.calls[0].commandError,'CHIEF_CONTEXT_OPTION_DENIED');
  assert.equal(Object.hasOwn(state.calls[0],'command'),false);
  assert.equal(state.calls[0].bodySha256,createHash('sha256').update('/chief --unsafe do something').digest('hex'));
});
