/** Fixed-release, process-local correction of the Native AI binding equality check. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';

export const ROLE_AI_BINDING_SOURCE_SHA256='de0dd43e534e06f59c2d865c8e2458950ac03d2f8015dbf7e654ed77c2abef64';
const comparison='JSON.stringify(nextAiBinding) !== JSON.stringify(existing.runtimeConfig.aiConnection)';
const fail=code=>{throw Object.assign(Error(code),{code});};

// The fixture hash is injectable for offline source-contract tests only. Production installation
// below always uses the fixed release hash; no environment or installation option can replace it.
export function patchRoleAiBindingSource(source,{expectedSha256=ROLE_AI_BINDING_SOURCE_SHA256}={}){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==expectedSha256||source.split(comparison).length!==2)fail('ROLE_AI_BINDING_BASE_DRIFT');
 return 'import { isDeepStrictEqual as roleAiBindingDeepEqual } from "node:util";\n'+
  source.replace(comparison,'!roleAiBindingDeepEqual(nextAiBinding, existing.runtimeConfig.aiConnection)');
}

export function installRoleAiBindingHook({directory='/opt/paperclip',enabled=true}={}){
 if(!enabled)return {enabled:false,moduleUrls:[],verify(){},close(){}};
 const root=fs.realpathSync(path.join(directory,'node_modules','@paperclipai','server'));
 const filename=path.join(root,'dist','routes','agents.js');
 if(fs.realpathSync(filename)!==filename)fail('ROLE_AI_BINDING_ROUTE_PATH_DENIED');
 const moduleUrl=pathToFileURL(filename).href;let applied=false;
 const hook=registerHooks({load(url,context,nextLoad){
  const loaded=nextLoad(url,context);if(url!==moduleUrl)return loaded;
  if(loaded.format!=='module'||loaded.source==null)fail('ROLE_AI_BINDING_BASE_DRIFT');
  const source=patchRoleAiBindingSource(Buffer.from(loaded.source).toString('utf8'));
  applied=true;return {...loaded,source};
 }});
 return {enabled:true,moduleUrls:[moduleUrl],verify(){if(!applied)fail('ROLE_AI_BINDING_HOOK_NOT_APPLIED');},close(){hook.deregister();}};
}
