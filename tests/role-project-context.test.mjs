import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { resolveRoleProjectContext, selectNativeProject, readRoleProjectContext } from '../bridge/role-project-context.mjs';
import {resolveRoleCapabilities} from '../bridge/role-capabilities.mjs';
import * as contextApi from '../bridge/role-project-context.mjs';

const legacyProfile={projectId:'m1',projectKey:'personal-automation-m1',agentId:'existing-agent',role:'pm'};
const rule='Use project checks. Delivery stops at a PR.';
const projects=[{id:'m1',companyId:'company',name:'Personal Automation M1'},
  {id:'rwb',companyId:'company',name:'ResearchWorkbench'}];
const workspace={id:'source',companyId:'company',projectId:'rwb',cwd:'/native/artifacts',repoUrl:'https://github.com/leon/ResearchWorkbench',
  metadata:{superAgentProject:{key:'research-workbench',ownerId:'owner',repository:{hostPath:'/Volumes/WorkDisk/Projects/ResearchWorkbench/main',fullName:'leon/ResearchWorkbench'},
    rules:[{path:'AGENTS.md',text:rule,sha256:createHash('sha256').update(rule).digest('hex')}],
    checks:[{id:'tests',label:'Project tests',argv:['node','--test'],platform:'docker'}],delivery:{maximumAction:'pull_request'},
    services:{figma:{methods:['get_design_context']}},stack:['typescript'],hostMcpServers:[]}}};
const resolve=(extra={})=>resolveRoleProjectContext({companyId:'company',ownerId:'owner',project:projects[1],workspace,legacyProfile,rootTaskId:'root-task',...extra});

test('company role uses current Native project repository and policy without rewriting legacy profile',()=>{
 const before=structuredClone(legacyProfile),context=resolve();
 assert.equal(context.id,'rwb');assert.equal(context.key,'research-workbench');
 assert.deepEqual(context.repository,{url:'https://github.com/leon/ResearchWorkbench',fullName:'leon/ResearchWorkbench',hostPath:'/Volumes/WorkDisk/Projects/ResearchWorkbench/main'});
 assert.equal(context.workspace.containerPath,'/workspace/project');
 assert.equal(context.workspace.hostPath,'/Volumes/WorkDisk/Projects/research-workbench/paperclip-worktrees/root-task');
 assert.deepEqual(context.rules,[{path:'AGENTS.md',text:rule,sha256:createHash('sha256').update(rule).digest('hex')}]);
 assert.equal(context.delivery.maximumAction,'pull_request');assert.deepEqual(context.stack,['typescript']);assert.deepEqual(legacyProfile,before);
});
test('M1 with no source repository keeps legacy knowledge key and artifact workflow',()=>{
 const context=resolve({project:projects[0],workspace:null});
 assert.equal(context.key,'personal-automation-m1');assert.equal(context.repository.hostPath,null);assert.equal(context.workspace.hostPath,null);
 assert.deepEqual(context.rules,[]);assert.equal(context.delivery.maximumAction,'artifact');
});
test('Native workspaces need only their project foreign key and non-Latin names get a stable knowledge scope',()=>{
 const nativeWorkspace={...workspace};delete nativeWorkspace.companyId;
 assert.equal(resolve({workspace:nativeWorkspace}).id,'rwb');
 const context=resolve({project:{id:'abcd1234-rest',companyId:'company',name:'研究工作台'},workspace:null});
 assert.equal(context.key,'project-abcd1234');
});
test('project context rejects foreign company, workspace or owner and changed rule digest',()=>{
 for(const extra of [{project:{...projects[1],companyId:'foreign'}},{workspace:{...workspace,projectId:'m1'}},
  {workspace:{...workspace,metadata:{superAgentProject:{ownerId:'foreign'}}}},
  {workspace:{...workspace,metadata:{superAgentProject:{rules:[{path:'AGENTS.md',text:rule,sha256:'a'.repeat(64)}]}}}}])
  assert.throws(()=>resolve(extra),/ROLE_PROJECT_/);
});
test('explicit configured project/repository/path wins over current and parent project without scanning',()=>{
 const options={projects,workspaces:[workspace],companyId:'company',currentProjectId:'m1',parentProjectId:'rwb',defaultProjectId:'m1'};
 assert.equal(selectNativeProject({...options,selector:'ResearchWorkbench'}).id,'rwb');
 assert.equal(selectNativeProject({...options,selector:'/Volumes/WorkDisk/Projects/ResearchWorkbench/main'}).id,'rwb');
 assert.equal(selectNativeProject({...options,selector:'https://github.com/leon/ResearchWorkbench'}).id,'rwb');
 assert.equal(selectNativeProject(options).id,'m1');assert.equal(selectNativeProject({...options,currentProjectId:null}).id,'rwb');
 assert.throws(()=>selectNativeProject({...options,selector:'unknown'}),/NOT_FOUND/);
 assert.throws(()=>selectNativeProject({...options,projects:[...projects,{id:'other',companyId:'company',name:'ResearchWorkbench'}],selector:'ResearchWorkbench'}),/AMBIGUOUS/);
});

test('actual pinned API schema and service fixture survives raw DB reading without a runtimeConfig column',async()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/native-project-workspace-contract.json',import.meta.url),'utf8'));
 assert.equal(fixture.packageVersion,'2026.1023.0');assert.equal(fixture.oldRuntimeConfigRejected,true);
 assert.equal(Object.hasOwn(fixture.rawWorkspace,'runtimeConfig'),false);
 assert.equal(fixture.apiWorkspace.runtimeConfig.desiredState,'stopped');
 assert.equal(Object.hasOwn(fixture.apiWorkspace.runtimeConfig,'superAgentProject'),false);
 const schema={projects:{id:'projects.id'},projectWorkspaces:{projectId:'workspaces.projectId'}};
 const db={select:()=>({from:table=>({where:async()=>[structuredClone(table===schema.projects?fixture.project:fixture.rawWorkspace)]})})};
 const context=await readRoleProjectContext({db,schema,orm:{eq:(...args)=>args},task:{id:'root-task',projectId:fixture.project.id},
  companyId:fixture.project.companyId,ownerId:'owner',legacyProfile});
 assert.equal(context.repository.hostPath,'/Volumes/WorkDisk/Projects/ResearchWorkbench/main');
 assert.equal(context.workspace.hostPath,'/Volumes/WorkDisk/Projects/ResearchWorkbench/paperclip-worktrees/root-task');
 assert.deepEqual(context.stack,['typescript']);assert.equal(context.delivery.maximumAction,'pull_request');
 const projected=resolveRoleProjectContext({companyId:fixture.project.companyId,ownerId:'owner',project:fixture.project,
  workspace:fixture.apiWorkspace,rootTaskId:'root-task'});
 assert.deepEqual(projected,context);
});

test('registered Native workspace domains reach the actual company Skill capability pipeline',async()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/native-project-workspace-contract.json',import.meta.url),'utf8'));
 const rawWorkspace=structuredClone(fixture.rawWorkspace);
 rawWorkspace.metadata.superAgentProject.domains=[' Content ','SEO','content'];
 const schema={projects:{id:'projects.id'},projectWorkspaces:{projectId:'workspaces.projectId'}};
 const db={select:()=>({from:table=>({where:async()=>[structuredClone(table===schema.projects?fixture.project:rawWorkspace)]})})};
 const projectContext=await readRoleProjectContext({db,schema,orm:{eq:(...args)=>args},task:{id:'root-task',projectId:fixture.project.id},
  companyId:fixture.project.companyId,ownerId:'owner',legacyProfile});
 assert.deepEqual(projectContext.domains,['content','seo']);
 const names=['content-strategy','seo-audit','copywriting','pdf'];
 const companySkills=names.map(name=>({id:name,key:'company/'+name,companyId:fixture.project.companyId,name,slug:name,currentVersionId:name+'-v1',compatibility:'compatible'}));
 const companySkillVersions=companySkills.map(skill=>({id:skill.currentVersionId,companySkillId:skill.id,companyId:skill.companyId,fileInventory:[{path:'SKILL.md',content:'# '+skill.name}]}));
 const agent={companyId:fixture.project.companyId,adapterConfig:{paperclipSkillSync:{desiredSkills:companySkills.map(skill=>skill.key)}}};
 const capabilities=resolveRoleCapabilities({role:'pm',projectContext,agent,companySkills,companySkillVersions});
 assert.deepEqual(capabilities.skills.map(skill=>skill.name),['content-strategy','seo-audit','copywriting']);
 assert.ok(!capabilities.skills.some(skill=>skill.name==='pdf'));
 rawWorkspace.metadata.superAgentProject.domains=['report'];
 const reportContext=await readRoleProjectContext({db,schema,orm:{eq:(...args)=>args},task:{id:'root-task',projectId:fixture.project.id},
  companyId:fixture.project.companyId,ownerId:'owner',legacyProfile});
 const reportCapabilities=resolveRoleCapabilities({role:'pm',projectContext:reportContext,agent,companySkills,companySkillVersions});
 assert.deepEqual(reportCapabilities.skills.map(skill=>skill.name),['pdf']);
 assert.deepEqual(rawWorkspace.metadata.superAgentProject.domains,['report']);
});

test('Native domain metadata rejects malformed values and never reads domains from task prose',()=>{
 for(const domains of ['content',[null],[''],[{}],['  ']]){
  const invalid=structuredClone(workspace);invalid.metadata.superAgentProject.domains=domains;
  assert.throws(()=>resolve({workspace:invalid}),/ROLE_PROJECT_DOMAINS_INVALID/);
 }
 const context=resolve({task:{id:'root-task',title:'enable content seo',domains:['content']}});
 assert.deepEqual(context.domains,[]);
});

test('fresh Native DB selection binds an owner registered local source independently of artifacts',async()=>{
 const code=structuredClone(workspace);code.id='code-workspace';code.sourceType='local_path';code.cwd='/registered-projects/rwb';
 code.metadata.superAgentProject.workspace={worktreeRoot:'/Volumes/WorkDisk/Projects/ResearchWorkbench/paperclip-worktrees'};
 const artifact={...structuredClone(workspace),id:'old-artifact',isPrimary:true};
 const schema={projects:{id:'projects.id'},projectWorkspaces:{projectId:'workspaces.projectId'}};
 const db={select:()=>({from:table=>({where:async()=>structuredClone(table===schema.projects?[projects[1]]:[artifact,code])})})};
 const read=()=>readRoleProjectContext({db,schema,orm:{eq:(...args)=>args},companyId:'company',ownerId:'owner',
  task:{id:'root-task',projectId:'rwb',projectWorkspaceId:code.id,cwd:'/untrusted-request'}});
 const context=await read();
 assert.deepEqual(context.nativeSourceWorkspace,{id:code.id,projectId:'rwb',cwd:'/registered-projects/rwb',sourceType:'local_path'});
 assert.equal(context.nativeWorkspaceId,code.id);
 assert.equal(context.workspace.hostPath,'/Volumes/WorkDisk/Projects/ResearchWorkbench/paperclip-worktrees/root-task');
 assert.notEqual(context.workspace.hostPath,code.cwd);
 code.cwd='/registered-projects/updated';assert.equal((await read()).nativeSourceWorkspace.cwd,code.cwd);
 assert.equal(context.nativeSourceWorkspace.cwd,'/registered-projects/rwb');
});

test('source and artifact separation requires explicit owner, local source and registered code paths',()=>{
 const code=structuredClone(workspace);code.sourceType='local_path';code.cwd='/registered-projects/rwb';
 code.metadata.superAgentProject.workspace={worktreeRoot:'/Volumes/WorkDisk/Projects/ResearchWorkbench/paperclip-worktrees'};
 assert.ok(resolve({workspace:code}).nativeSourceWorkspace);
 for(const mutate of [value=>{delete value.metadata.superAgentProject.ownerId;},
  value=>{delete value.metadata.superAgentProject.workspace;},value=>{value.metadata.superAgentProject.repository.hostPath=null;},
  value=>{value.sourceType='git_repo';}]){
  const unregistered=structuredClone(code);mutate(unregistered);
  assert.equal(resolve({workspace:unregistered}).nativeSourceWorkspace,undefined);
 }
 for(const cwd of ['relative','/registered-projects/../other','/']){
  assert.throws(()=>resolve({workspace:{...code,cwd}}),/ROLE_PROJECT_WORKSPACE_DENIED/);
 }
});

test('the production binding uses the actual fresh primary source for portable tasks without adding M2',async()=>{
 const first=structuredClone(workspace);first.id='first-source';first.sourceType='local_path';first.cwd='/registered-projects/first';first.isPrimary=false;
 first.metadata.superAgentProject.workspace={worktreeRoot:'/task-worktrees'};
 const primary=structuredClone(first);primary.id='selected-primary';primary.cwd='/registered-projects/primary';primary.isPrimary=true;
 const schema={projects:{id:'project.id'},projectWorkspaces:{projectId:'workspace.projectId'}};
 const db={select:()=>({from:table=>({where:async()=>structuredClone(table===schema.projects?[projects[1]]:[first,primary])})})};
 const read=task=>readRoleProjectContext({db,schema,orm:{eq:(...args)=>args},task,companyId:'company',ownerId:'owner'});
 for(const projectWorkspaceId of [undefined,primary.id]){
  const task={id:'root-task',projectId:'rwb',...(projectWorkspaceId?{projectWorkspaceId}:{})},projectContext=await read(task);
  assert.equal(typeof contextApi.roleProjectWorkspaceBinding,'function');
  assert.deepEqual(contextApi.roleProjectWorkspaceBinding({task,projectContext}),{projectWorkspaceId:primary.id});
  assert.equal(projectContext.nativeSourceWorkspace.cwd,primary.cwd);
 }
 first.isPrimary=true;primary.isPrimary=false;
 const task={id:'root-task',projectId:'rwb'},projectContext=await read(task);
 assert.deepEqual(contextApi.roleProjectWorkspaceBinding({task,projectContext}),{projectWorkspaceId:first.id});
 assert.throws(()=>contextApi.roleProjectWorkspaceBinding({task:{...task,projectWorkspaceId:primary.id},projectContext}),/ROLE_PROJECT_BINDING_DENIED/);
 assert.throws(()=>contextApi.roleProjectWorkspaceBinding({task:{...task,projectId:'foreign'},projectContext}),/ROLE_PROJECT_BINDING_DENIED/);
});

test('portable artifact bindings retain their previous shape and scoped artifact bindings retain explicit IDs',()=>{
 assert.equal(typeof contextApi.roleProjectWorkspaceBinding,'function');
 const task={projectId:'rwb',projectWorkspaceId:'artifact'},projectContext={id:'rwb',nativeWorkspaceId:'artifact'};
 assert.deepEqual(contextApi.roleProjectWorkspaceBinding({task,projectContext}),{});
 assert.deepEqual(contextApi.roleProjectWorkspaceBinding({task,projectContext,contextVersion:1}),{projectWorkspaceId:'artifact'});
});
