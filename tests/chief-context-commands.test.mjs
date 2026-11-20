import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChiefContextCommand, contextMemoryId } from '../bridge/chief-context-commands.mjs';

test('M1 new goals and unrelated Feishu command namespaces retain their meaning', () => {
  assert.deepEqual(parseChiefContextCommand('/chief 研究产品需求\n保留证据'), {kind:'new',goal:'研究产品需求\n保留证据'});
  for (const text of ['/rwb LEO-1 补充', '/任务 rwb', '/Chief goal', ' /chief goal', 'ordinary chat']) assert.equal(parseChiefContextCommand(text), null);
});
test('new goals bind optional explicit project and plan-first intent without choosing paths', () => {
  assert.deepEqual(parseChiefContextCommand('/chief --project RWB --plan-first 形成清单'), {kind:'new',goal:'形成清单',projectKeyOrAlias:'rwb',reviewBeforeDispatch:true});
  assert.deepEqual(parseChiefContextCommand('/chief --plan-first --project 个人 new status notes'), {kind:'new',goal:'status notes',projectKeyOrAlias:'个人',reviewBeforeDispatch:true});
  assert.deepEqual(parseChiefContextCommand('/chief 新建 项目 资料调研'), {kind:'new',goal:'项目 资料调研'});
});
test('project selection and listing have distinct actions, without a Native task', () => {
  assert.deepEqual(parseChiefContextCommand('/chief projects'), {kind:'projects'});
  assert.deepEqual(parseChiefContextCommand('/chief 项目'), {kind:'projects'});
  assert.deepEqual(parseChiefContextCommand('/chief 项目 RWB'), {kind:'select_project',projectKeyOrAlias:'rwb'});
  assert.deepEqual(parseChiefContextCommand('/chief'), {kind:'help'});
});
test('status and continue address an explicit identifier or the persisted current task', () => {
  assert.deepEqual(parseChiefContextCommand('/chief 状态'), {kind:'status'});
  assert.deepEqual(parseChiefContextCommand('/chief status leo-28'), {kind:'status',taskIdentifier:'LEO-28'});
  assert.deepEqual(parseChiefContextCommand('/chief 继续 LEO-28'), {kind:'continue',taskIdentifier:'LEO-28'});
  assert.deepEqual(parseChiefContextCommand('/chief continue'), {kind:'continue'});
  assert.throws(() => parseChiefContextCommand('/chief 继续 LEO-28 更多内容'), {code:'CHIEF_CONTEXT_COMMAND_INVALID'});
});
test('append never turns a task identifier into a new-goal request', () => {
  assert.deepEqual(parseChiefContextCommand('/chief 补充 LEO-28 增加失败验收\n保留旧结果'), {kind:'append',taskIdentifier:'LEO-28',text:'增加失败验收\n保留旧结果'});
  assert.deepEqual(parseChiefContextCommand('/chief add 增加来源日期'), {kind:'append',text:'增加来源日期'});
  assert.deepEqual(parseChiefContextCommand('/chief --project 个人 add LEO-28 增加限制'), {kind:'append',taskIdentifier:'LEO-28',text:'增加限制',projectKeyOrAlias:'个人'});
  assert.throws(() => parseChiefContextCommand('/chief add LEO-28'), {code:'CHIEF_CONTEXT_COMMAND_INVALID'});
});
test('a linked new goal requires the explicit followup verb', () => {
  assert.deepEqual(parseChiefContextCommand('/chief 后续 LEO-28 将清单整理为三项优先级'), {kind:'followup',taskIdentifier:'LEO-28',goal:'将清单整理为三项优先级'});
  assert.deepEqual(parseChiefContextCommand('/chief --plan-first followup 增加一个新功能'), {kind:'followup',goal:'增加一个新功能',reviewBeforeDispatch:true});
});
test('owner memory commands preserve text and declare visibility instead of granting authority', () => {
  assert.deepEqual(parseChiefContextCommand('/chief 记住 报告规范 先结论，后证据\n保留未验证项'), {kind:'remember',key:'报告规范',text:'先结论，后证据\n保留未验证项'});
  assert.deepEqual(parseChiefContextCommand('/chief correct --role pm Report-Style 先写P0风险'), {kind:'correct',key:'report-style',text:'先写P0风险',role:'pm'});
  assert.deepEqual(parseChiefContextCommand('/chief 记忆 --role pm 报告规范'), {kind:'memory',key:'报告规范',role:'pm'});
  assert.deepEqual(parseChiefContextCommand('/chief 记忆'), {kind:'memory'});
  assert.deepEqual(parseChiefContextCommand('/chief 记忆历史 报告规范'), {kind:'memory_history',key:'报告规范'});
});
test('explicit sharing names one source memory and one registered target alias', () => {
  assert.deepEqual(parseChiefContextCommand('/chief 共享 报告规范 RWB'), {kind:'share',key:'报告规范',targetProjectKeyOrAlias:'rwb'});
  assert.throws(() => parseChiefContextCommand('/chief share --role pm 报告规范 rwb'), {code:'CHIEF_CONTEXT_OPTION_DENIED'});
});
test('memory IDs are stable opaque ASCII keys, independent of project paths', () => {
  assert.equal(contextMemoryId('Report-Style'), contextMemoryId('ｒｅｐｏｒｔ-style'));
  assert.match(contextMemoryId('报告规范'), /^owner-[a-f0-9]{24}$/);
  assert.notEqual(contextMemoryId('报告规范'), contextMemoryId('另一个规范'));
  for (const value of ['../secret', 'has space', '', 'a'.repeat(65)]) assert.throws(() => contextMemoryId(value), {code:'CHIEF_CONTEXT_MEMORY_KEY_INVALID'});
});
test('malformed options and ambiguous command tails fail explicitly', () => {
  for (const text of ['/chief --bypass goal','/chief --project','/chief --project rwb --project 个人 goal','/chief --plan-first --plan-first goal','/chief --plan-first status','/chief --project rwb project 个人','/chief project rwb extra','/chief status LEO-01','/chief remember k','/chief memory k extra']) {
    assert.throws(() => parseChiefContextCommand(text), error => error.code?.startsWith('CHIEF_CONTEXT_'), text);
  }
  assert.throws(() => parseChiefContextCommand('/chief remember --role root k value'), {code:'CHIEF_CONTEXT_ROLE_INVALID'});
});
test('protocol inputs are bounded and returned values cannot be changed', () => {
  assert.throws(() => parseChiefContextCommand('/chief goal\u0000'), {code:'CHIEF_CONTEXT_COMMAND_INVALID'});
  assert.throws(() => parseChiefContextCommand('/chief '+'a'.repeat(12001)), {code:'CHIEF_CONTEXT_COMMAND_INVALID'});
  assert.throws(() => parseChiefContextCommand('/chief remember k '+'文'.repeat(6000)), {code:'CHIEF_CONTEXT_COMMAND_INVALID'});
  const result=parseChiefContextCommand('/chief --project RWB new goal');
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.projectKeyOrAlias='other'; }, TypeError);
});

test('invalid-looking Native targets never silently mutate the currently selected task', () => {
  for (const text of ['/chief add LEO-01 add criterion', '/chief followup LEO-28: refine output', '/chief 补充 LEO-28, 增加限制']) {
    assert.throws(() => parseChiefContextCommand(text), {code:'CHIEF_CONTEXT_COMMAND_INVALID'}, text);
  }
  assert.deepEqual(parseChiefContextCommand('/chief add -- LEO-01 is only an example'), {kind:'append',text:'LEO-01 is only an example'});
});

test('an explicit expected memory version is bound to a correction only', () => {
  assert.deepEqual(parseChiefContextCommand('/chief correct --version 1 --role pm 报告规范 先列验收风险'), {kind:'correct',key:'报告规范',text:'先列验收风险',role:'pm',expectedVersion:1});
  assert.throws(() => parseChiefContextCommand('/chief remember --version 1 k value'), {code:'CHIEF_CONTEXT_OPTION_DENIED'});
  assert.deepEqual(parseChiefContextCommand('/chief 暂停 LEO-28'), {kind:'pause',taskIdentifier:'LEO-28'});
});
