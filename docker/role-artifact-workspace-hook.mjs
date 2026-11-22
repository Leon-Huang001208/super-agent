/** Fixed-release process-local correction for explicitly registered artifact directories. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';

export const ROLE_ARTIFACT_WORKSPACE_SOURCE_SHA256='0b8b0fce0efcc4c03cd5da138576ed12654611cc998595a3f968301f5fb0ede5';
const condition='!(await hasGitMetadata(effectiveCwd))) {';
const replacement='!(await hasGitMetadata(effectiveCwd)) &&\n        !(await allowRoleArtifactWorkspace(input))) {';
const prefix='import { allowRoleArtifactWorkspace } from '+JSON.stringify(new URL('../bridge/role-artifact-workspace.mjs',import.meta.url).href)+';\n';
const fail=code=>{throw Object.assign(Error(code),{code});};
const initializations=new Map();

// An offline fixture may supply its hash; production installation is always pinned.
export function patchRoleArtifactWorkspaceSource(source,{expectedSha256=ROLE_ARTIFACT_WORKSPACE_SOURCE_SHA256}={}){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==expectedSha256||
  source.split(condition).length!==2)fail('ROLE_ARTIFACT_WORKSPACE_BASE_DRIFT');
 return prefix+source.replace(condition,replacement);
}

export function installRoleArtifactWorkspaceHook({directory='/opt/paperclip',enabled=true}={}){
 if(!enabled)return {enabled:false,moduleUrls:[],verify(){},close(){}};
 const root=fs.realpathSync(path.join(directory,'node_modules','@paperclipai','server')),
  filename=path.join(root,'dist','services','heartbeat','workspaces.js');
 if(fs.realpathSync(filename)!==filename)fail('ROLE_ARTIFACT_WORKSPACE_PATH_DENIED');
 const moduleUrl=pathToFileURL(filename).href;let applied=false;
 const hook=registerHooks({load(url,context,nextLoad){
  const loaded=nextLoad(url,context);if(url!==moduleUrl)return loaded;
  if(loaded.format!=='module'||loaded.source==null)fail('ROLE_ARTIFACT_WORKSPACE_BASE_DRIFT');
  const source=patchRoleArtifactWorkspaceSource(Buffer.from(loaded.source).toString('utf8'));
  applied=true;return {...loaded,source};
 }});
 return {enabled:true,moduleUrls:[moduleUrl],verify(){if(!applied)fail('ROLE_ARTIFACT_WORKSPACE_HOOK_NOT_APPLIED');},close(){hook.deregister();}};
}

/** Warm before Native services can import heartbeat; reuse only this verified initialization. */
export async function ensureRoleArtifactWorkspaceHook({directory='/opt/paperclip',enabled=true,installHook=installRoleArtifactWorkspaceHook}={}){
 if(!enabled)return {enabled:false,moduleUrls:[],status:'disabled'};
 const root=fs.realpathSync(path.join(directory,'node_modules','@paperclipai','server'));
 if(initializations.has(root))return initializations.get(root);
 const initialization=(async()=>{
  const hook=installHook({directory});
  try{
   for(const url of hook.moduleUrls)await import(url);
   hook.verify();
   return Object.freeze({enabled:true,moduleUrls:Object.freeze([...hook.moduleUrls]),status:'verified'});
  }finally{hook.close();}
 })();
 initializations.set(root,initialization);
 return initialization;
}
