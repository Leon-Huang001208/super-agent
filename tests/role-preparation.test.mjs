import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRolePreparation } from '../bridge/role-preparation.mjs';

test('new run preparation binds Native identity, materials, knowledge and fixed permissions', async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'role-port-'));
  t.after(() => fs.rmSync(root, {recursive:true}));
  fs.writeFileSync(root + '/SKILL.md', 'Require sources. State assumptions.');
  const id = n => n.repeat(8)+'-'+n.repeat(4)+'-4'+n.repeat(3)+'-8'+n.repeat(3)+'-'+n.repeat(12);
  const binding = {companyId:id('a'),projectId:id('b'),taskId:id('c'),agentId:id('d'),runId:id('e'),ownerId:'owner',inputRevision:'a'.repeat(64)};
  const profile = {projectId:binding.projectId,projectKey:'demo',agentId:binding.agentId,role:'pm',engine:'codex_local',
    model:'gpt-6.1-sol',reasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:false,sandbox:'read-only',tools:['read_materials']};
  const sha256 = createHash('sha256').update(fs.readFileSync(root+'/SKILL.md')).digest('hex');
  const manifest = {schemaVersion:1,project:'demo',role:'pm',instructionsFilePath:'SKILL.md',requiredReferences:[],files:[{path:'SKILL.md',sha256}]};
  let changed = false, reads = 0;
  const context = {...binding,projectKey:'demo',role:'pm',revision:'b'.repeat(64),runState:'authorized',sessionId:null,dispatchMode:'controlled',model:profile.model,reasoningEffort:'low'};
  const events = [];
  const prepare = createRolePreparation({log:e=>events.push(e),readKnowledge:async()=>[],readContext:async()=>{reads++;return {...context,revision:changed&&reads%2===0?'c'.repeat(64):context.revision};}});
  const input = {binding,profile,materialRoot:root,manifest};
  const ready = await prepare(input);
  assert.equal(ready.sessionMode,'new');
  assert.equal(ready.dispatch,'NOT_RUN');
  assert.equal(ready.config.dangerouslyBypassApprovalsAndSandbox,false);
  await assert.rejects(prepare({...input,profile:{...profile,projectKey:'other'}}),/NATIVE_BINDING_DENIED/);
  const cached = {...context};
  let count = 0;
  const cachedPrepare = createRolePreparation({log(){},readKnowledge:async()=>[],readContext:async()=>{
    if (++count === 2) cached.revision = 'f'.repeat(64);
    return cached;
  }});
  await assert.rejects(cachedPrepare(input),/VERSION_CHANGED/);
  reads = 0;
  changed = true;
  await assert.rejects(prepare(input),/VERSION_CHANGED/);
  await assert.rejects(prepare({...input,binding:{...binding,ownerId:'other'}}),/NATIVE_BINDING_DENIED/);
  await assert.rejects(prepare({...input,profile:{...profile,tools:['shell']}}),/SCOPE_DENIED/);
  fs.writeFileSync(root+'/SKILL.md','tampered');
  await assert.rejects(prepare(input),/DIGEST_MISMATCH/);
  assert.ok(events.some(e=>e.code==='ROLE_PREPARE_READY'));
});
