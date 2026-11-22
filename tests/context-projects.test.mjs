import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProjectCatalog } from '../bridge/context-projects.mjs';

function fixture() {
  const authority = {companyId:randomUUID(), ownerId:'owner-native',
    agentIds:{chief:randomUUID(),research:randomUUID(),pm:randomUUID(),qa:randomUUID()}};
  const make = (key, aliases, adapterKey, maximumAction) => {
    const projectId=randomUUID();
    return {key, aliases, companyId:authority.companyId, projectId, ownerId:authority.ownerId,
      adapterKey, allowedRoles:Object.keys(authority.agentIds), maximumAction,
      workspaceCwd:`/paperclip/instances/default/projects/${authority.companyId}/${projectId}/_default`};
  };
  const registry={schemaVersion:1,defaultProjectKey:'personal-automation-m1',projects:[
    make('personal-automation-m1',['个人','Personal'],'native-docs','pull_request'),
    make('rwb',['投研','ResearchWorkbench'],'rwb-docs','read_only'),
  ]};
  const events=[];
  const input={registry,authority,log:event=>events.push(event)};
  const actor={companyId:authority.companyId,ownerId:authority.ownerId};
  return {registry,authority,events,input,actor};
}

function roleRecord(f, role='pm') {
  const project=f.registry.projects[0];
  return {profile:{projectId:project.projectId,projectKey:project.key,
    agentId:f.authority.agentIds[role],role,engine:'codex_local',model:'gpt-6.1-sol',
    reasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:false,sandbox:'workspace-write',
    tools:['read_materials','read_sources','shell','apply_patch','apps','plugins']},
  manifest:{schemaVersion:1,project:project.key,role,instructionsFilePath:'roles/'+role+'/AGENTS.md',
    requiredReferences:['SKILL.md'],files:[{path:'roles/'+role+'/AGENTS.md',sha256:'a'.repeat(64)},
      {path:'SKILL.md',sha256:'b'.repeat(64)}]},metadata:{materialVersion:2}};
}

test('catalog resolves registered projects by canonical key, normalized aliases, default or Native ID',()=>{
  const f=fixture(),catalog=createProjectCatalog(f.input),[personal,rwb]=f.registry.projects;
  assert.equal(catalog.resolve(f.actor).projectId,personal.projectId);
  assert.equal(catalog.resolve({...f.actor,projectKeyOrAlias:'ＰＥＲＳＯＮＡＬ'}).key,personal.key);
  assert.equal(catalog.resolve({...f.actor,projectKeyOrAlias:'  RESEARCHWORKBENCH  '}).projectId,rwb.projectId);
  assert.equal(catalog.resolve({...f.actor,projectKeyOrAlias:'投研'}).key,'rwb');
  assert.equal(catalog.resolve({...f.actor,projectId:rwb.projectId}).workspaceCwd,rwb.workspaceCwd);
  assert.equal(catalog.list().length,2);
  assert.ok(f.events.some(event=>event.code==='CONTEXT_PROJECT_CATALOG_READY'));
});

test('scope resolution rejects mismatched or missing caller identity before returning project metadata',()=>{
  const f=fixture(),catalog=createProjectCatalog(f.input);
  for(const actor of [{},{companyId:f.authority.companyId},
    {...f.actor,ownerId:'other-owner'},{...f.actor,companyId:randomUUID()}]) {
    assert.throws(()=>catalog.resolve({...actor,projectKeyOrAlias:'rwb'}),/CONTEXT_PROJECT_CALLER_DENIED/);
  }
});

test('unknown and conflicting selectors are explicit and cannot expand project scope',()=>{
  const f=fixture(),catalog=createProjectCatalog(f.input);
  assert.throws(()=>catalog.resolve({...f.actor,projectKeyOrAlias:'unknown-secret-name'}),/CONTEXT_PROJECT_UNKNOWN/);
  assert.throws(()=>catalog.resolve({...f.actor,projectId:randomUUID()}),/CONTEXT_PROJECT_UNKNOWN/);
  assert.throws(()=>catalog.resolve({...f.actor,projectKeyOrAlias:'rwb',projectId:f.registry.projects[0].projectId}),/CONTEXT_PROJECT_SELECTOR_CONFLICT/);
  assert.throws(()=>catalog.resolve({...f.actor,projectKeyOrAlias:'../rwb'}),/CONTEXT_PROJECT_SELECTOR_INVALID/);
  assert.throws(()=>catalog.resolve({...f.actor,projectId:'not-a-native-id'}),/CONTEXT_PROJECT_SELECTOR_INVALID/);
  assert.equal(JSON.stringify(f.events).includes('unknown-secret-name'),false);
});

test('catalog rejects foreign company/owner, duplicate project identity and alias ambiguity',()=>{
  for(const change of [
    f=>{f.registry.projects[1].companyId=randomUUID();},
    f=>{f.registry.projects[1].ownerId='another-owner';},
    f=>{f.registry.projects[1].projectId=f.registry.projects[0].projectId;},
    f=>{f.registry.projects[1].aliases.push('ＰＥＲＳＯＮＡＬ');},
    f=>{f.registry.projects[1].key=f.registry.projects[0].key;},
  ]) {
    const f=fixture();change(f);
    assert.throws(()=>createProjectCatalog(f.input),error=>/^CONTEXT_PROJECT_/.test(error.code));
  }
});

test('registration validates keys, aliases and the actual Native workspace rather than accepting a path override',()=>{
  for(const change of [
    f=>{f.registry.projects[0].key='../personal';},
    f=>{f.registry.projects[0].aliases=['two words'];},
    f=>{f.registry.projects[0].aliases=['rwb/elsewhere'];},
    f=>{f.registry.projects[0].workspaceCwd='/tmp/arbitrary';},
    f=>{f.registry.projects[0].workspaceCwd=f.registry.projects[1].workspaceCwd;},
    f=>{f.registry.projects[0].workspaceCwd+='/.hidden/..';},
    f=>{f.registry.defaultProjectKey='unknown';},
    f=>{f.registry.schemaVersion=2;},
  ]) {
    const f=fixture();change(f);
    assert.throws(()=>createProjectCatalog(f.input),error=>/^CONTEXT_PROJECT_/.test(error.code));
  }
});

test('owner registered merge ceiling is retained without changing role identity or accepting deployment',()=>{
 const f=fixture();f.registry.projects[1].maximumAction='merge';
 const catalog=createProjectCatalog(f.input),project=catalog.resolve({...f.actor,projectKeyOrAlias:'rwb'});
 assert.equal(project.maximumAction,'merge');
 const original=roleRecord(f,'research'),bound=catalog.roleBinding(original,project);
 assert.equal(bound.profile.agentId,original.profile.agentId);
 assert.deepEqual(bound.profile.tools,original.profile.tools);
 const tampered=structuredClone(project);tampered.maximumAction='deploy';
 assert.throws(()=>catalog.roleBinding(original,tampered),/CONTEXT_PROJECT_BINDING_DENIED/);
});

test('project bindings accept only registered role identities and nondeployment adapter/action ceilings',()=>{
  for(const change of [
    f=>{f.registry.projects[0].adapterKey='old-rwb-executor';},
    f=>{f.registry.projects[0].maximumAction='deploy';},
    f=>{f.registry.projects[0].allowedRoles=['admin'];},
    f=>{f.registry.projects[0].allowedRoles=['designer'];},
    f=>{f.authority.agentIds.qa=f.authority.agentIds.pm;},
    f=>{f.authority.agentIds.pm='made-up-agent';},
  ]) {
    const f=fixture();change(f);
    assert.throws(()=>createProjectCatalog(f.input),error=>/^CONTEXT_PROJECT_/.test(error.code));
  }
});

test('Native lookup checks current task and responsible owner without changing task state',()=>{
  const f=fixture(),catalog=createProjectCatalog(f.input),project=f.registry.projects[1];
  const task={id:randomUUID(),companyId:f.authority.companyId,projectId:project.projectId,
    responsibleUserId:f.authority.ownerId,status:'in_progress',description:'source data'};
  const snapshot=structuredClone(task);
  assert.equal(catalog.forNativeTask(task,{ownerId:f.authority.ownerId}).key,'rwb');
  assert.deepEqual(task,snapshot);
  for(const change of [t=>{t.companyId=randomUUID();},t=>{t.projectId=randomUUID();},t=>{delete t.projectId;},
    t=>{t.responsibleUserId='foreign';},t=>{delete t.responsibleUserId;}]) {
    const altered=structuredClone(task);change(altered);
    assert.throws(()=>catalog.forNativeTask(altered,{ownerId:f.authority.ownerId}),error=>/^CONTEXT_PROJECT_/.test(error.code));
  }
  assert.throws(()=>catalog.forNativeTask(task,{ownerId:'foreign'}),/CONTEXT_PROJECT_CALLER_DENIED/);
});

test('an optional dedicated Native workspace ID survives catalog projection without replacing workspaceCwd or Agent configuration',()=>{
  const f=fixture(),rwb=f.registry.projects[1];
  rwb.projectWorkspaceId=randomUUID();
  const catalog=createProjectCatalog(f.input),project=catalog.resolve({...f.actor,projectKeyOrAlias:'rwb'});
  assert.equal(project.projectWorkspaceId,rwb.projectWorkspaceId);
  assert.equal(project.workspaceCwd,rwb.workspaceCwd);
  assert.equal(catalog.list()[1].projectWorkspaceId,rwb.projectWorkspaceId);
  assert.equal(Object.hasOwn(catalog.resolve(f.actor),'projectWorkspaceId'),false);
  const original=roleRecord(f),bound=catalog.roleBinding(original,project),expected=structuredClone(original);
  expected.profile.projectId=rwb.projectId;expected.profile.projectKey=rwb.key;expected.manifest.project=rwb.key;
  assert.deepEqual(bound,expected);
  assert.equal(Object.hasOwn(bound.profile,'projectWorkspaceId'),false);
});

test('a configured dedicated workspace must be a Native UUID and cannot relax the canonical cwd',()=>{
  for(const value of [null,'','not-a-workspace',123,{}]) {
    const f=fixture();f.registry.projects[1].projectWorkspaceId=value;
    assert.throws(()=>createProjectCatalog(f.input),error=>/^CONTEXT_PROJECT_/.test(error.code));
  }
  const f=fixture();f.registry.projects[1].projectWorkspaceId=randomUUID();
  f.registry.projects[1].workspaceCwd='/old/primary/workspace';
  assert.throws(()=>createProjectCatalog(f.input),/CONTEXT_PROJECT_WORKSPACE_DENIED/);
});

test('Native task lookup requires the dedicated projectWorkspaceId and rejects a missing or old primary binding',()=>{
  const f=fixture(),rwb=f.registry.projects[1];rwb.projectWorkspaceId=randomUUID();
  const catalog=createProjectCatalog(f.input),task={id:randomUUID(),companyId:f.authority.companyId,
    projectId:rwb.projectId,projectWorkspaceId:rwb.projectWorkspaceId,responsibleUserId:f.authority.ownerId,status:'todo'};
  const before=structuredClone(task);
  assert.equal(catalog.forNativeTask(task,{ownerId:f.authority.ownerId}).projectWorkspaceId,rwb.projectWorkspaceId);
  for(const replacement of [undefined,null,randomUUID()]) {
    const stale=structuredClone(task);
    if(replacement===undefined)delete stale.projectWorkspaceId;else stale.projectWorkspaceId=replacement;
    assert.throws(()=>catalog.forNativeTask(stale,{ownerId:f.authority.ownerId}),/CONTEXT_PROJECT_NATIVE_WORKSPACE_DENIED/);
  }
  assert.deepEqual(task,before);
});

test('role binding preserves Agent, permissions, tools and material identities while deriving only project discriminators',()=>{
  const f=fixture(),catalog=createProjectCatalog(f.input),original=roleRecord(f),before=structuredClone(original);
  const project=catalog.resolve({...f.actor,projectKeyOrAlias:'rwb'}),bound=catalog.roleBinding(original,project);
  assert.equal(bound.profile.agentId,f.authority.agentIds.pm);
  assert.equal(bound.profile.projectId,project.projectId);
  assert.equal(bound.profile.projectKey,'rwb');
  assert.equal(bound.manifest.project,'rwb');
  const expected=structuredClone(before);expected.profile.projectId=project.projectId;
  expected.profile.projectKey='rwb';expected.manifest.project='rwb';
  assert.deepEqual(bound,expected);
  assert.deepEqual(original,before);
  assert.deepEqual(bound.manifest.files,before.manifest.files);
  assert.deepEqual(bound.profile.tools,before.profile.tools);
  assert.equal('maximumAction' in bound.profile,false);
  assert.equal('onAccepted' in bound,false);
});

test('role binding rejects an unregistered Agent, disallowed role and modified project snapshot',()=>{
  const f=fixture();f.registry.projects[1].allowedRoles=['chief','research','qa'];
  const catalog=createProjectCatalog(f.input),project=catalog.resolve({...f.actor,projectKeyOrAlias:'rwb'});
  assert.throws(()=>catalog.roleBinding(roleRecord(f),project),/CONTEXT_PROJECT_ROLE_DENIED/);
  const badAgent=roleRecord(f,'research');badAgent.profile.agentId=randomUUID();
  assert.throws(()=>catalog.roleBinding(badAgent,project),/CONTEXT_PROJECT_ROLE_RECORD_INVALID/);
  const badManifest=roleRecord(f,'research');badManifest.manifest.project='another-project';
  assert.throws(()=>catalog.roleBinding(badManifest,project),/CONTEXT_PROJECT_ROLE_RECORD_INVALID/);
  const tampered=structuredClone(project);tampered.maximumAction='pull_request';
  assert.throws(()=>catalog.roleBinding(roleRecord(f,'research'),tampered),/CONTEXT_PROJECT_BINDING_DENIED/);
});

test('returned catalog values and derived role records cannot mutate trusted deployment data',()=>{
  const f=fixture(),catalog=createProjectCatalog(f.input),list=catalog.list();
  assert.ok(Object.isFrozen(catalog));assert.ok(Object.isFrozen(list));
  assert.ok(Object.isFrozen(list[0]));assert.ok(Object.isFrozen(list[0].allowedRoles));
  assert.throws(()=>{list[0].allowedRoles.push('admin');},TypeError);
  f.registry.projects[0].aliases.push('mutated-after-construction');
  assert.throws(()=>catalog.resolve({...f.actor,projectKeyOrAlias:'mutated-after-construction'}),/CONTEXT_PROJECT_UNKNOWN/);
  const bound=catalog.roleBinding(roleRecord(f),catalog.resolve(f.actor));
  assert.ok(Object.isFrozen(bound.profile.tools));assert.ok(Object.isFrozen(bound.manifest.files[0]));
  assert.throws(()=>{bound.manifest.files[0].sha256='f'.repeat(64);},TypeError);
});

test('missing logger and failed audit logging fail closed with stable errors',async()=>{
  const f=fixture();assert.throws(()=>createProjectCatalog({...f.input,log:undefined}),/CONTEXT_PROJECT_CONFIG_INVALID/);
  assert.throws(()=>createProjectCatalog({...f.input,log(){throw Error('private logging detail');}}),error=>
    error.code==='CONTEXT_PROJECT_LOG_FAILED'&&!error.message.includes('private logging detail'));
  assert.throws(()=>createProjectCatalog({...f.input,async log(){throw Error('private async logging detail');}}),
    /CONTEXT_PROJECT_LOG_FAILED/);
  await new Promise(resolve=>setImmediate(resolve));
});
