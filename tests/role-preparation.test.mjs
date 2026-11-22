import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRolePreparation } from '../bridge/role-preparation.mjs';
import {getRoleRuntimeProfile,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS} from '../bridge/role-runtime-profiles.mjs';
import {createNativeRoleAdapter} from '../bridge/native-role-adapter.mjs';

// Mechanical current bindings for preparation contracts, not permanent role preferences.
const API_BINDING_FIXTURE=Object.freeze({...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,research:'deepseek_opencode',devops:'minimax_opencode'});

function apiFixture(t,role='research',runtimeProfileId){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-api-prepare-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(root+'/AGENTS.md','Private fixture role material.');
 const id=n=>String(n).padStart(8,'0')+'-0000-4000-8000-000000000000';
 const binding={companyId:id(1),projectId:id(2),taskId:id(3),agentId:id(4),runId:id(5),ownerId:'owner',inputRevision:'a'.repeat(64)};
 const assignments={...API_BINDING_FIXTURE,...(runtimeProfileId?{[role]:runtimeProfileId}:{})};
 const selected=getRoleRuntimeProfile(role,assignments);
 const executionPolicy={executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'};
 const profile={projectId:binding.projectId,projectKey:'isolated',agentId:binding.agentId,role,
  engine:selected.adapterType,model:selected.model,reasoningEffort:null,dangerouslySkipPermissions:true,
  sandbox:'none',executionPolicy,tools:['read_materials','shell']};
 const manifest={schemaVersion:1,project:'isolated',role,instructionsFilePath:'AGENTS.md',requiredReferences:[],
  files:[{path:'AGENTS.md',sha256:createHash('sha256').update(fs.readFileSync(root+'/AGENTS.md')).digest('hex')}]};
 const context={...binding,projectKey:'isolated',role,revision:'b'.repeat(64),runState:'authorized',sessionId:null,dispatchMode:'controlled',model:selected.model,reasoningEffort:null};
 const input={binding,profile,materialRoot:root,manifest,runtimeAssignments:assignments};
 const events=[];let reads=0;
 const prepare=createRolePreparation({readContext:async()=>{reads++;return context;},readKnowledge:async()=>[],log:event=>events.push(event)});
 return {input,profile,context,prepare,events,root,selected,getReads:()=>reads};
}

test('Claude preparation uses its own canonical model and adapter without changing tools or material guards',async t=>{
 for(const runtimeProfileId of ['deepseek_claude','minimax_claude']){
  const f=apiFixture(t,'devops',runtimeProfileId),ready=await f.prepare(f.input);
  assert.equal(ready.adapterType,'claude_local');assert.equal(ready.config.model,f.selected.model);
  assert.equal(ready.config.reasoningEffort,null);assert.equal(ready.config.dangerouslySkipPermissions,true);
  assert.deepEqual(ready.requestedTools,['read_materials','shell']);assert.equal(ready.sessionMode,'new');
  f.context.sessionId='prior';await assert.rejects(f.prepare(f.input),/NATIVE_BINDING_DENIED/);
 }
});

test('explicit API preparation keeps Native materials, execution policy and fresh session for both providers',async t=>{
 for(const role of ['research','devops']){
  const f=apiFixture(t,role),before=structuredClone(f.input);
  const ready=await f.prepare(f.input);
  assert.equal(ready.adapterType,'opencode_local');assert.equal(ready.sessionMode,'new');
  assert.equal(ready.config.model,f.selected.model);assert.equal(ready.config.reasoningEffort,null);
  assert.equal(ready.config.dangerouslySkipPermissions,true);
  assert.equal(Object.hasOwn(ready.config,'dangerouslyBypassApprovalsAndSandbox'),false);
  assert.equal(ready.config.sandbox,'none');assert.deepEqual(ready.config.executionPolicy,f.profile.executionPolicy);
  assert.deepEqual(ready.requestedTools,['read_materials','shell']);assert.equal(ready.config.instructionsFilePath,f.root+'/AGENTS.md');
  assert.equal(ready.dispatch,'NOT_RUN');assert.equal(ready.toolVerification,'NOT_RUN');assert.equal(f.getReads(),2);
  assert.deepEqual(f.input,before);assert.equal(JSON.stringify(f.events).includes('Private fixture role material.'),false);
 }
});

test('API preparation needs complete explicit routing and cannot introduce Docker OpenCode or another model',async t=>{
 for(const mutate of [f=>{delete f.input.runtimeAssignments;},f=>{delete f.input.runtimeAssignments.qa;},
  f=>{f.profile.engine='codex_local';},f=>{f.profile.model='other/model';},f=>{f.profile.reasoningEffort='low';},
  f=>{delete f.profile.executionPolicy;f.profile.sandbox='workspace-write';f.profile.dangerouslySkipPermissions=false;},
  f=>{f.profile.dangerouslySkipPermissions=false;},f=>{f.profile.tools=['arbitrary_admin_tool'];}]){
  const f=apiFixture(t);mutate(f);
  await assert.rejects(f.prepare(f.input),{code:'ROLE_PREPARE_SCOPE_DENIED'});
 }
});

test('API preparation preserves context, material and version guards with canonical null effort',async t=>{
 const f=apiFixture(t);delete f.profile.reasoningEffort;
 assert.equal((await f.prepare(f.input)).config.reasoningEffort,null);
 f.context.reasoningEffort='low';await assert.rejects(f.prepare(f.input),/NATIVE_BINDING_DENIED/);f.context.reasoningEffort=null;
 f.context.sessionId='old';await assert.rejects(f.prepare(f.input),/NATIVE_BINDING_DENIED/);f.context.sessionId=null;
 f.context.projectId='foreign';await assert.rejects(f.prepare(f.input),/NATIVE_BINDING_DENIED/);f.context.projectId=f.input.binding.projectId;
 let reads=0;
 const changed=createRolePreparation({readContext:async()=>({...f.context,revision:++reads===1?'b'.repeat(64):'c'.repeat(64)}),readKnowledge:async()=>[],log(){}});
 await assert.rejects(changed(f.input),/VERSION_CHANGED/);
 fs.writeFileSync(f.root+'/AGENTS.md','changed');await assert.rejects(f.prepare(f.input),/DIGEST_MISMATCH/);
});

test('real API preparation composes with Native dispatch without model or credential work',async t=>{
 for(const role of ['research','devops']){
  const f=apiFixture(t,role),binding=f.input.binding;let calls=0;
  const ctx={runId:binding.runId,agent:{id:binding.agentId,companyId:binding.companyId},runtime:{sessionId:null},
   context:{issueId:binding.taskId,projectId:binding.projectId,responsibleUserId:binding.ownerId,inputRevision:binding.inputRevision},
   config:{engine:'cli',command:'/opt/super-agent/bin/opencode',model:f.selected.model,dangerouslySkipPermissions:true,
    extraArgs:[],instructionsFilePath:f.root+'/AGENTS.md'}};
  const execute=createNativeRoleAdapter({basePromptTemplate:'Assigned role',log:event=>f.events.push(event),
   readRegistration:async()=>f.input,prepareRole:f.prepare,nativeExecute:async value=>{
    calls++;assert.equal(value.config.model,f.selected.model);assert.equal(value.config.command,ctx.config.command);
    assert.equal(value.config.dangerouslySkipPermissions,true);assert.equal(value.runtime.sessionId,null);return{exitCode:0};
   }});
  assert.equal((await execute(ctx)).exitCode,0);assert.equal(calls,1);
  assert.ok(f.events.some(event=>event.code==='ROLE_PREPARE_READY'));
  assert.ok(f.events.some(event=>event.code==='NATIVE_ROLE_DISPATCH'));
 }
});

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
