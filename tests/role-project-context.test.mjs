import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { resolveRoleProjectContext, selectNativeProject, readRoleProjectContext } from '../bridge/role-project-context.mjs';

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
