import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {planRwbDevelopmentRegistration,developmentProjectFingerprint,registrationHash,registeredDevelopmentWorkspace} from '../bridge/rwb-development-registration.mjs';
import {registerRwbDevelopment,rwbDevelopmentArgs} from '../scripts/register-rwb-development.mjs';
import {readControl,writeControl} from '../bridge/role-control-store.mjs';

const projectId='22222222-2222-4222-8222-222222222222',operationId='33333333-3333-4333-8333-333333333333',workspaceId='44444444-4444-4444-8444-444444444444';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rwb-registration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project={id:projectId,companyId:'company',name:'ResearchWorkbench',executionWorkspacePolicy:null,workspaces:[{id:'legacy',projectId,isPrimary:true,name:'Legacy',cwd:'/workspaces/rwb-pilot',sourceType:'local_path',repoUrl:null,metadata:{keep:'old'}}]};
 const registry={ownerId:'owner',companyId:'company',team:{enabled:false},operations:[{id:'spent'}],context:{enabled:true,catalog:{schemaVersion:1,defaultProjectKey:'rwb',projects:[{key:'rwb',projectId,companyId:'company',ownerId:'owner',maximumAction:'read_only',projectWorkspaceId:'legacy',workspaceCwd:'/native/artifacts',aliases:['投研'],allowedRoles:['chief','qa']}]}}};
 const rule='Use the existing RWB GitSafety and candidate checks.';
 const request={schemaVersion:1,operationId,projectId,approvalSource:'owner 2026-11-22 persistent RWB development',repositoryHostPath:'/Users/leon/Developer/ResearchWorkbench-main',
  worktreeRoot:'/Volumes/WorkDisk/Projects/ResearchWorkbench/paperclip-worktrees',nodeBinary:'/usr/local/bin/node',
  rules:[{path:'AGENTS.md',text:rule,sha256:createHash('sha256').update(rule).digest('hex')}],checks:[{id:'project',label:'Existing project check',platform:'macos',argv:['/usr/local/bin/node','scripts/check.mjs']}],
  expectedContextSha256:registrationHash(registry.context),expectedProjectSha256:developmentProjectFingerprint(project)};
 writeControl(root+'/registry.json',registry);
 const calls=[],events=[];let active=[];
 const native={readProject:async()=>structuredClone(project),executionState:async()=>({activeRuns:active,leases:[]}),
  createWorkspace:async(id,payload)=>{calls.push('create-workspace');project.workspaces.forEach(w=>w.isPrimary=false);const result={...structuredClone(payload),id:workspaceId,projectId:id};project.workspaces.push(result);return result;},
  updateProject:async(id,payload)=>{calls.push('update-project');Object.assign(project,structuredClone(payload));return structuredClone(project);}};
 const editRegistry=edit=>{const current=readControl(root+'/registry.json'),next=edit(current);writeControl(root+'/registry.json',next);return next;};
 return {root,project,registry,request,native,calls,events,editRegistry,setActive:value=>{active=value;},options:{root,request,native,editRegistry,log:event=>events.push(event)}};
}

test('preview builds exact RWB GitSafety metadata without Native or registry writes',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.root+'/registry.json');
 const result=await registerRwbDevelopment(f.options);
 assert.equal(result.status,'preview');assert.equal(result.newModelCalls,0);assert.equal(result.newTasks,0);assert.deepEqual(f.calls,[]);
 assert.deepEqual(fs.readFileSync(f.root+'/registry.json'),before);
 const meta=result.workspace.metadata.superAgentProject;
 assert.equal(meta.delivery.maximumAction,'merge');assert.ok(!meta.delivery.commands.deploy);
 assert.deepEqual(meta.workspace.prepare.argv.slice(-5),['--start','--slug','paperclip-work','--worktree-root',f.request.worktreeRoot]);
 assert.ok(meta.delivery.commands.pull_request.argv.includes('{verificationCommand}'));
 assert.ok(meta.delivery.commands.merge.argv.includes('--reviewed-commit'));
 assert.ok(meta.delivery.commands.merge.argv.includes('{candidateSha}'));
});

test('apply preserves legacy workspace and operations while registering permanent development and is idempotent',async t=>{
 const f=fixture(t),legacy=structuredClone(f.project.workspaces[0]);
 const first=await registerRwbDevelopment({...f.options,apply:true});
 assert.equal(first.status,'applied');assert.equal(first.projectWorkspaceId,workspaceId);
 const registry=readControl(f.root+'/registry.json');assert.deepEqual(registry.operations,f.registry.operations);
 assert.equal(registry.context.catalog.projects[0].maximumAction,'merge');assert.equal(registry.context.catalog.projects[0].projectWorkspaceId,workspaceId);
 assert.equal(registry.context.catalog.projects[0].workspaceCwd,'/native/artifacts');
 assert.deepEqual({...f.project.workspaces[0],isPrimary:true},legacy);
 assert.equal(f.project.executionWorkspacePolicy.sharedWorkspaceConcurrency,'serialize');
 f.project.executionWorkspacePolicy.nativeDefault='kept';
 assert.equal((await registerRwbDevelopment({...f.options,apply:true})).status,'reused');
 assert.deepEqual(f.calls,['create-workspace','update-project']);
 assert.ok(f.events.every(event=>event.newModelCalls===0&&event.newTasks===0));
});

test('an unknown workspace response reconciles the same Native operation without creating a duplicate',async t=>{
 const f=fixture(t),create=f.native.createWorkspace;
 f.native.createWorkspace=async(...args)=>{await create(...args);throw Error('response lost');};
 await assert.rejects(registerRwbDevelopment({...f.options,apply:true}),/WORKSPACE_UNKNOWN/);
 assert.equal(f.project.workspaces.length,2);
 assert.equal((await registerRwbDevelopment({...f.options,apply:true})).status,'applied');
 assert.equal(f.calls.filter(value=>value==='create-workspace').length,1);
});

test('active execution, changed input or foreign project/owner rejects without changing source registration',async t=>{
 for(const mutation of [f=>f.setActive([{id:'active'}]),f=>{f.request.expectedContextSha256='a'.repeat(64);},
  f=>{f.request.expectedProjectSha256='b'.repeat(64);},f=>{f.project.companyId='other';},f=>{f.registry.context.catalog.projects[0].ownerId='other';writeControl(f.root+'/registry.json',f.registry);},
  f=>{f.request.maximumAction='deploy';},f=>{f.request.repositoryHostPath='/Users/leon/repo/../other';},f=>{f.request.rules[0].sha256='f'.repeat(64);}]){
  const f=fixture(t);mutation(f);const before=fs.readFileSync(f.root+'/registry.json');
  await assert.rejects(registerRwbDevelopment({...f.options,apply:true}),/RWB_DEVELOPMENT_|ROLE_PROJECT_/);
  assert.deepEqual(f.calls,[]);assert.deepEqual(fs.readFileSync(f.root+'/registry.json'),before);
 }
});

test('readiness and hash preconditions cannot be supplied by task prose or a model-provided command',t=>{
 const f=fixture(t),plan=planRwbDevelopmentRegistration(f);
 const result=registeredDevelopmentWorkspace({...plan.workspace,id:workspaceId,projectId,metadata:{...plan.workspace.metadata,runtimeConfig:{desiredState:'manual'}}},plan);
 assert.equal(result,true);
 assert.throws(()=>planRwbDevelopmentRegistration({...f,request:{...f.request,checks:[]}}),/REQUEST_INVALID/);
 assert.throws(()=>rwbDevelopmentArgs(['--request','relative.json']),/ARGUMENTS_INVALID/);
 assert.equal(rwbDevelopmentArgs(['--request','/private/request.json','--apply']).apply,true);
});
