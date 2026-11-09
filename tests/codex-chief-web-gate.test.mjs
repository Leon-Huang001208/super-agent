import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { isChiefExecInvocation, parseChiefCallOutput, validateChiefCallPermit } from '../docker/codex-chief-web-gate.mjs';

function fixture() {
  const body = '请补充同一任务续接的证据';
  const permit = {
    schemaVersion: 1, taskId: 'fc7af371-dd33-484b-b567-60af5411ceae',
    permitId: randomUUID(), grantId: randomUUID(), runId: randomUUID(), conversationId: randomUUID(),
    messageId: randomUUID(), agentId: randomUUID(), companyId: randomUUID(), credentialGrantId: randomUUID(),
    generation: 0, ownerId: 'owner', expiresAt: 4000,
    model: 'gpt-6.1-sol', reasoningEffort: 'low', apiFallback: false, body,
    messageDigest: createHash('sha256').update(body).digest('hex'),
  };
  const env = {
    PAPERCLIP_RUN_ID: permit.runId, PAPERCLIP_TASK_ID: permit.conversationId,
    PAPERCLIP_WAKE_COMMENT_ID: permit.messageId, PAPERCLIP_AGENT_ID: permit.agentId, PAPERCLIP_COMPANY_ID: permit.companyId,
    CODEX_HOME: `/tmp/paperclip-ai-${permit.companyId}-${permit.credentialGrantId}-abcd/provider`,
  };
  return { permit, env };
}

test('binds the one Chief permit to the actual Native run, message and existing subscription home', () => {
  const { permit, env } = fixture();
  assert.equal(validateChiefCallPermit(permit, env, 1).messageId, permit.messageId);
  for (const patch of [{ body: 'another' }, { reasoningEffort: 'medium' }, { expiresAt: 1 }, { extra: true }]) {
    assert.throws(() => validateChiefCallPermit({ ...permit, ...patch }, env, 1), /CHIEF_CALL_PERMIT_INVALID/);
  }
  for (const patch of [{ PAPERCLIP_RUN_ID: randomUUID() }, { OPENAI_API_KEY: 'api key' }, { CODEX_HOME: '/tmp/outside' }]) {
    assert.throws(() => validateChiefCallPermit(permit, { ...env, ...patch }, 1), /CHIEF_CALL_ENVIRONMENT_DENIED/);
  }
});

test('accepts one bounded classification and drops non-message model artifacts', () => {
  const answer = { type: 'item.completed', item: { type: 'agent_message', text: '{"intent":"supplement_rwb_pr261"}' } };
  const events = [{ type: 'thread.started', thread_id: 'thread' }, { type: 'item.started', item: { type: 'reasoning' } }, answer, { type: 'turn.completed' }];
  assert.equal(parseChiefCallOutput(events.map(JSON.stringify).join('\n')).events.length, 3);
  assert.throws(() => parseChiefCallOutput([answer, answer].map(JSON.stringify).join('\n')), /CHIEF_CALL_OUTPUT_UNVERIFIED/);
  assert.throws(() => parseChiefCallOutput(JSON.stringify({ ...answer, item: { ...answer.item, text: '{"intent":"merge"}' } })), /CHIEF_CALL_OUTPUT_UNVERIFIED/);
});

test('recognizes the pinned Native adapter identity prefix on a fresh exec', () => {
  const prefix = [
    '-c', 'features.shell_snapshot=false', '-c', 'shell_environment_policy.inherit="all"',
    '-c', 'shell_environment_policy.ignore_default_excludes=true',
    '-c', 'shell_environment_policy.include_only=["PATH","CODEX_HOME"]',
  ];
  assert.equal(isChiefExecInvocation([...prefix, 'exec', '--json', '-']), true);
  assert.equal(isChiefExecInvocation(['exec', '--json', '-']), true);
  assert.equal(isChiefExecInvocation([...prefix, 'exec', 'resume', 'previous']), false);
  assert.equal(isChiefExecInvocation([...prefix, 'app-server']), false);
  assert.equal(isChiefExecInvocation(['-c', 'unrelated=true', 'exec']), false);
});
