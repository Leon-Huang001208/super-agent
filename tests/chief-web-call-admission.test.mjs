import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createChiefWebCallAdmission } from '../bridge/chief-web-call-admission.mjs';
import { CHIEF_WEB_PILOT } from '../bridge/chief-web-pilot.mjs';

test('only the exact owner wake and approved body produce a short lived Chief permit', async () => {
  const messageId = randomUUID(), body = '补充原任务续接的证据';
  const grant = {
    taskId: CHIEF_WEB_PILOT.taskId, grantId: randomUUID(), companyId: randomUUID(),
    conversationId: randomUUID(), chiefAgentId: randomUUID(), credentialGrantId: randomUUID(),
    ownerId: 'owner', generation: 0, expiresAt: 800000,
    messageDigest: createHash('sha256').update(body).digest('hex'),
  };
  const run = { id: randomUUID(), companyId: grant.companyId, agentId: grant.chiefAgentId };
  const prepared = { conversation: true, context: { issueId: grant.conversationId, source: 'issue.comment',
    conversationSessionGeneration: 0, wakeCommentId: messageId, wakeCommentIds: [messageId] } };
  const permits = [];
  const admission = createChiefWebCallAdmission({
    readApprovedGrant: () => grant, readWitness: () => ({ verified: true, body }),
    writePermit(permit) { permits.push(permit); return permit; }, log() {}, now: () => 1000,
  });
  await admission({ run, prepared });
  await admission({ run, prepared });
  assert.equal(permits[0].permitId, permits[1].permitId);
  assert.equal(permits[0].expiresAt, 601000);
  assert.equal(permits[0].messageId, messageId);
  prepared.context.wakeCommentIds.push(randomUUID());
  await assert.rejects(admission({ run, prepared }), /CHIEF_CALL_ADMISSION_DENIED/);
  prepared.context.wakeCommentIds = [messageId];
  grant.messageDigest = 'e'.repeat(64);
  await assert.rejects(admission({ run, prepared }), /CHIEF_CALL_ADMISSION_DENIED/);
  assert.equal(permits.length, 2);
});
