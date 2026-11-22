import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {ROLE_ARTIFACT_WORKSPACE_SOURCE_SHA256,patchRoleArtifactWorkspaceSource,installRoleArtifactWorkspaceHook} from '../docker/role-artifact-workspace-hook.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const condition='!(await hasGitMetadata(effectiveCwd))) {';
const replacement='!(await hasGitMetadata(effectiveCwd)) &&\n        !(await allowRoleArtifactWorkspace(input))) {';
const fixture='async function hasGitMetadata(){return true;}\nexport async function check(input){const effectiveCwd=input.cwd;if ('+condition+'throw Error("missing_git_metadata");}return input;}';

test('source drift and duplicate conditions fail closed, with no package lookup when disabled',()=>{
 assert.throws(()=>patchRoleArtifactWorkspaceSource(fixture),{code:'ROLE_ARTIFACT_WORKSPACE_BASE_DRIFT'});
 const twice=fixture+'\n// '+condition;
 assert.throws(()=>patchRoleArtifactWorkspaceSource(twice,{expectedSha256:sha(twice)}),{code:'ROLE_ARTIFACT_WORKSPACE_BASE_DRIFT'});
 const hook=installRoleArtifactWorkspaceHook({directory:'/missing',enabled:false});assert.equal(hook.enabled,false);hook.verify();hook.close();
});

test('process-local load preserves source bytes and ordinary Git launch behavior',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'artifact-hook-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const filename=root+'/fixture.mjs';fs.writeFileSync(filename,fixture);const url=pathToFileURL(filename).href;let applied=false;
 const hook=registerHooks({load(specifier,context,next){const loaded=next(specifier,context);if(specifier!==url)return loaded;applied=true;return {...loaded,source:patchRoleArtifactWorkspaceSource(Buffer.from(loaded.source).toString(),{expectedSha256:sha(fixture)})};}});
 try{const module=await import(url),input={cwd:'/existing-git'};assert.equal(await module.check(input),input);assert.equal(applied,true);}finally{hook.deregister();}
 assert.equal(fs.readFileSync(filename,'utf8'),fixture);
});

test('production installation ignores fixture hash overrides and rejects cached or changed sources',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'artifact-install-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const server=root+'/node_modules/@paperclipai/server';fs.mkdirSync(server+'/dist/services/heartbeat',{recursive:true});fs.writeFileSync(server+'/package.json','{"type":"module"}');
 const filename=server+'/dist/services/heartbeat/workspaces.js';fs.writeFileSync(filename,fixture);
 const hook=installRoleArtifactWorkspaceHook({directory:root,expectedSha256:sha(fixture)});
 try{assert.throws(()=>hook.verify(),{code:'ROLE_ARTIFACT_WORKSPACE_HOOK_NOT_APPLIED'});await assert.rejects(import(pathToFileURL(filename).href),{code:'ROLE_ARTIFACT_WORKSPACE_BASE_DRIFT'});}finally{hook.close();}
 assert.equal(fs.readFileSync(filename,'utf8'),fixture);
});

test('pinned Native source changes only missing Git condition and retains its real other validations',{
 skip:!process.env.PAPERCLIP_TEST_SERVER_ROOT,
},async()=>{
 const filename=path.join(process.env.PAPERCLIP_TEST_SERVER_ROOT,'dist/services/heartbeat/workspaces.js'),source=fs.readFileSync(filename,'utf8');
 assert.equal(sha(source),ROLE_ARTIFACT_WORKSPACE_SOURCE_SHA256);
 const patched=patchRoleArtifactWorkspaceSource(source),prefix=patched.slice(0,patched.indexOf('\n')+1);
 assert.equal(patched.slice(prefix.length).replace(replacement,condition),source);
 const start=patched.indexOf('export async function assertGitSensitiveAdapterWorkspaceValid(input) {'),end=patched.indexOf('\n}\n/**',start)+2;
 assert.ok(start>0&&end>start);
 const build=new Function('allowRoleArtifactWorkspace','GIT_SENSITIVE_LOCAL_ADAPTER_TYPES','readNonEmptyString','parseObject','resolveDefaultAgentWorkspaceDir',
  'sameResolvedPath','WorkspaceValidationFailure','hasGitMetadata','inspectManagedGitWorktreeBranch','formatManagedGitWorktreeBranchInspection',
  'return '+patched.slice(start,end).replace('export ',''));
 let eligible=false,git=false,decisions=0;
 class Failure extends Error{constructor(message,details){super(message);this.reason=details.workspaceValidation.reason;}}
 const validate=build(async()=>{decisions++;return eligible;},new Set(['codex_local']),value=>typeof value==='string'&&value.trim()?value:null,value=>value??{},()=>'/agent-home',
  (left,right)=>left===right,Failure,async()=>git,async()=>({valid:false,reason:'wrong branch'}),value=>value);
 const input={adapterType:'codex_local',agentId:'agent',issue:{id:'task',projectId:'project',projectWorkspaceId:'workspace'},
  resolvedWorkspace:{projectId:'project',workspaceId:'workspace',cwd:'/artifact'},executionWorkspace:{cwd:'/artifact',projectId:'project',workspaceId:'workspace',strategy:'project_primary'},
  persistedExecutionWorkspace:{id:'persisted',projectId:'project',projectWorkspaceId:'workspace',cwd:'/artifact',strategyType:'project_primary'}};
 await assert.rejects(validate(input),error=>error.reason==='missing_git_metadata');eligible=true;await validate(input);
 const checks=[
  ['missing_project_id',copy=>copy.issue.projectId=null],['missing_persisted_execution_workspace',copy=>copy.persistedExecutionWorkspace=null],
  ['persisted_cwd_mismatch',copy=>copy.persistedExecutionWorkspace.cwd='/other'],
  ['project_workspace_mismatch',copy=>copy.persistedExecutionWorkspace.projectWorkspaceId='other'],
  ['fallback_agent_home_cwd',copy=>{copy.executionWorkspace.cwd='/agent-home';copy.persistedExecutionWorkspace.cwd='/agent-home';}],
  ['git_worktree_provider_ref_mismatch',copy=>{copy.persistedExecutionWorkspace.strategyType='git_worktree';copy.persistedExecutionWorkspace.providerRef='/other';}],
  ['git_worktree_branch_mismatch',copy=>{copy.persistedExecutionWorkspace.strategyType='git_worktree';copy.persistedExecutionWorkspace.branchName='expected';}],
 ];
 for(const [reason,change]of checks){const copy=structuredClone(input);change(copy);await assert.rejects(validate(copy),error=>error.reason===reason,reason);}
 const before=decisions;git=true;eligible=false;await validate(input);assert.equal(decisions,before,'Git workspaces never need the exception');
 assert.equal(fs.readFileSync(filename,'utf8'),source);
});
