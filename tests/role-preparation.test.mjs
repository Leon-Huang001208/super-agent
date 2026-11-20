import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRolePreparation } from '../bridge/role-preparation.mjs';

test('M2 preparation passes the exact Native scope and records loaded material and knowledge identities',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-m2-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(root+'/instructions.md','Generic role instructions.');
 const id=n=>String(n).padStart(8,'0')+'-0000-4000-8000-000000000000';
 const binding={companyId:id(1),projectId:id(2),taskId:id(3),agentId:id(4),runId:id(5),ownerId:'owner',inputRevision:'a'.repeat(64)};
 const profile={...binding,projectKey:'beta',role:'pm',engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:false,sandbox:'workspace-write',tools:['read_materials']};
 const hash=createHash('sha256').update(fs.readFileSync(root+'/instructions.md')).digest('hex');
 const manifest={schemaVersion:1,project:'beta',role:'pm',instructionsFilePath:'instructions.md',requiredReferences:[],files:[{path:'instructions.md',sha256:hash}]};
 const context={...binding,projectKey:'beta',role:'pm',revision:'b'.repeat(64),runState:'authorized',sessionId:null,dispatchMode:'controlled',model:profile.model,reasoningEffort:'low'};
 const events=[];let observed;
 const prepare=createRolePreparation({readContext:async()=>context,readKnowledge:async value=>{observed=value;return[{id:'decision',project:'beta',visibility:'project',version:1,kind:'decision',source:'feishu:fixture',condition:'Current',text:'Private body'}];},log:e=>events.push(e)});
 const cwd='/paperclip/instances/default/projects/'+binding.companyId+'/'+binding.projectId+'/_default';
 const ready=await prepare({binding,profile,materialRoot:root,manifest,contextVersion:1,workspaceCwd:cwd,knowledgeQuery:'Report policy'});
 assert.deepEqual(observed.scope,{companyId:binding.companyId,ownerId:binding.ownerId,projectId:binding.projectId,projectKey:'beta'});
 assert.equal(observed.limit,32);assert.equal(ready.workspaceCwd,cwd);
 await assert.rejects(prepare({binding:{...binding,projectWorkspaceId:id(6)},profile,materialRoot:root,manifest,contextVersion:1,workspaceCwd:cwd}),/NATIVE_BINDING_DENIED/);
 assert.ok(events.some(x=>x.code==='ROLE_PREPARE_KNOWLEDGE_LOADED'&&x.loaded[0].id==='decision'));
 assert.equal(JSON.stringify(events).includes('Private body'),false);
});

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
  await assert.rejects(prepare({...input,profile:{...profile,tools:['arbitrary_admin_tool']}}),/SCOPE_DENIED/);
  fs.writeFileSync(root+'/SKILL.md','tampered');
  await assert.rejects(prepare(input),/DIGEST_MISMATCH/);
  assert.ok(events.some(e=>e.code==='ROLE_PREPARE_READY'));
});

test('shared role materials stay bound to manifest project while knowledge follows the task project',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-shared-'));t.after(()=>fs.rmSync(root,{recursive:true}));
 fs.writeFileSync(root+'/AGENTS.md','Shared company role');
 const id=n=>n.repeat(8)+'-'+n.repeat(4)+'-4'+n.repeat(3)+'-8'+n.repeat(3)+'-'+n.repeat(12);
 const binding={companyId:id('a'),projectId:id('b'),taskId:id('c'),agentId:id('d'),runId:id('e'),ownerId:'owner',inputRevision:'a'.repeat(64)};
 const profile={projectId:binding.projectId,projectKey:'research-workbench',agentId:binding.agentId,role:'pm',engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:false,sandbox:'read-only',tools:['read_materials']};
 const manifest={schemaVersion:1,project:'personal-automation-m1',role:'pm',instructionsFilePath:'AGENTS.md',requiredReferences:[],files:[{path:'AGENTS.md',sha256:createHash('sha256').update('Shared company role').digest('hex')}]};
 let knowledgeProject;
 const prepare=createRolePreparation({log(){},readKnowledge:async({project})=>{knowledgeProject=project;return[];},readContext:async()=>({...binding,projectKey:'research-workbench',role:'pm',revision:'b'.repeat(64),runState:'authorized',sessionId:null,dispatchMode:'controlled',model:'gpt-6.1-sol',reasoningEffort:'low'})});
 const ready=await prepare({binding,profile,materialRoot:root,manifest});
 assert.equal(knowledgeProject,'research-workbench');assert.equal(ready.config.instructionsFilePath,root+'/AGENTS.md');
});
