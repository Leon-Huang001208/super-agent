import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const project=fileURLToPath(new URL('../',import.meta.url));
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-preload-order-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,text)=>{fs.mkdirSync(path.dirname(root+'/'+name),{recursive:true});fs.writeFileSync(root+'/'+name,text);};
 for(const name of ['role-preload.mjs','server-entry.mjs'])put('docker/'+name,fs.readFileSync(project+'docker/'+name));
 const server=root+'/node_modules/@paperclipai/server',workspaces=server+'/dist/services/heartbeat/workspaces.js',moduleUrl=pathToFileURL(workspaces).href;
 put('node_modules/@paperclipai/server/package.json',JSON.stringify({type:'module',exports:{'.':{import:'./dist/index.js'}}}));
 const source='async function hasGitMetadata(){return true;}\nexport async function validate(input){const effectiveCwd=input.cwd;if (!(await hasGitMetadata(effectiveCwd))) {throw Error("missing_git_metadata");}return input;}';
 put('node_modules/@paperclipai/server/dist/services/heartbeat/workspaces.js',source);
 put('node_modules/@paperclipai/server/dist/services/heartbeat.js','export * from "./heartbeat/workspaces.js";');
 put('node_modules/@paperclipai/server/dist/index.js','import {validate} from "./services/heartbeat.js";export function startServer(){return {patched:validate.toString().includes("allowRoleArtifactWorkspace")};}');
 const hookModule=pathToFileURL(project+'docker/role-artifact-workspace-hook.mjs').href;
 put('docker/role-artifact-workspace-hook.mjs',`
import * as actual from ${JSON.stringify(hookModule)};
import {registerHooks} from 'node:module';import {createHash} from 'node:crypto';
const moduleUrl=${JSON.stringify(moduleUrl)},source=${JSON.stringify(source)};
export function installRoleArtifactWorkspaceHook(){
 globalThis.events.push('artifact.install');let applied=false;
 const hook=registerHooks({load(url,context,next){const loaded=next(url,context);if(url!==moduleUrl)return loaded;
  applied=true;globalThis.events.push('artifact.load');return {...loaded,source:actual.patchRoleArtifactWorkspaceSource(Buffer.from(loaded.source).toString(),{expectedSha256:createHash('sha256').update(source).digest('hex')})};}});
 return {enabled:true,moduleUrls:[moduleUrl],verify(){if(!applied)throw Object.assign(Error('ROLE_ARTIFACT_WORKSPACE_HOOK_NOT_APPLIED'),{code:'ROLE_ARTIFACT_WORKSPACE_HOOK_NOT_APPLIED'});globalThis.events.push('artifact.verify');},close(){hook.deregister();globalThis.events.push('artifact.close');}};
}
export function ensureRoleArtifactWorkspaceHook(options){return actual.ensureRoleArtifactWorkspaceHook({...options,directory:${JSON.stringify(root)},installHook:installRoleArtifactWorkspaceHook});}
`);
 put('docker/role-instruction-hook.mjs',"export function installRoleInstructionHook(){globalThis.events.push('instruction.install');return {moduleUrls:[],verify(){globalThis.events.push('instruction.verify');},close(){globalThis.events.push('instruction.close');}};}");
 put('docker/chief-web-app-hook.mjs','export function installChiefWebAppHook(){throw Error("unexpected ChiefWeb hook");}');
 put('docker/role-ai-binding-hook.mjs',"export function installRoleAiBindingHook(){return{verify(){globalThis.events.push('ai.verify');},close(){globalThis.events.push('ai.close');}};}");
 put('bridge/native-role-runtime.mjs',"export const database=()=>({});export async function installNativeRoles(){globalThis.events.push('roles.install');}");
 put('bridge/role-control-store.mjs',"export const ROLE_ROOT='/missing-fixture-registry';export function readControl(){throw Error('unexpected registry read');}");
 put('bridge/role-instruction-store.mjs','export function reconcileRoleInstructionMutation(){throw Error("unexpected mutation");}');
 put('bridge/team-native-runtime.mjs',"export function startTeamCoordinator(){globalThis.events.push('coordinator.start');}");
 put('bridge/chief-feishu-service.mjs',`export async function startChiefFeishuService(){globalThis.events.push('feishu.start');await import(${JSON.stringify(pathToFileURL(server+'/dist/services/heartbeat.js').href)});globalThis.events.push('feishu.heartbeat.loaded');}`);
 put('setup.mjs',`globalThis.events=[];process.argv[1]='/opt/super-agent/serve.mjs';if(process.env.FIXTURE_PRELOAD_UNKNOWN==='true')await import(${JSON.stringify(moduleUrl)});await import('./docker/role-preload.mjs');`);
 put('entry.mjs',`import {loadServer} from './docker/server-entry.mjs';const server=await loadServer(${JSON.stringify(root)});console.log(JSON.stringify({...server.startServer(),events:globalThis.events}));`);
 return root;
}
function launch(root,{feishu,unknown=false}){
 return spawnSync(process.execPath,['--import',root+'/setup.mjs',root+'/entry.mjs'],{encoding:'utf8',timeout:10000,env:{...process.env,NODE_OPTIONS:'',SUPER_AGENT_ROLE_RUNTIME_ENABLED:'true',SUPER_AGENT_TEAM_COORDINATOR_ENABLED:'true',SUPER_AGENT_CHIEF_FEISHU_ENABLED:String(feishu),FIXTURE_PRELOAD_UNKNOWN:String(unknown)}});
}

test('fresh preload patches workspaces before Feishu imports heartbeat and server reuses verified initialization',t=>{
 const root=fixture(t),result=launch(root,{feishu:true});
 assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout.trim());assert.equal(output.patched,true);
 assert.equal(output.events.filter(event=>event==='artifact.install').length,1);
 assert.ok(output.events.indexOf('artifact.verify')<output.events.indexOf('roles.install'));
 assert.ok(output.events.indexOf('artifact.verify')<output.events.indexOf('feishu.heartbeat.loaded'));
 assert.ok(output.events.indexOf('instruction.install')<output.events.indexOf('artifact.load'));
 assert.ok(output.events.includes('instruction.verify'));
});

test('fresh maintenance startup verifies the same preload before coordinator without Feishu',t=>{
 const root=fixture(t),result=launch(root,{feishu:false});
 assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout.trim());assert.equal(output.patched,true);
 assert.equal(output.events.filter(event=>event==='artifact.install').length,1);
 assert.ok(output.events.indexOf('artifact.verify')<output.events.indexOf('coordinator.start'));
 assert.equal(output.events.includes('feishu.start'),false);
});

test('an unknown cached Native workspace module fails closed before starting coordinator or server',t=>{
 const root=fixture(t),result=launch(root,{feishu:true,unknown:true});
 assert.notEqual(result.status,0);assert.match(result.stderr,/ROLE_ARTIFACT_WORKSPACE_HOOK_NOT_APPLIED/);assert.equal(result.stdout.trim(),'');
});
