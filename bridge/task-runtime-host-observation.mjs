/** The existing host resident publishes source/CLI identity and version metadata without provider calls. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {RUNTIME_PROFILES} from './role-runtime-profiles.mjs';
import {taskRuntimeImplementationFiles,computeTaskRuntimeImplementationBinding} from './task-runtime-router.mjs';
import {roleHostCliIdentity} from '../scripts/role-host-transport.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const CLI_PATHS={codex:'/Users/leon/.local/bin/codex',opencode:'/Users/leon/.npm-global/bin/opencode',claude:'/Users/leon/.local/bin/claude'};
/** Installed CLI --version metadata only; models are the same fixed public IDs consumed by the existing gates. */
export function createResidentRuntimeCatalog({cliPaths=CLI_PATHS,version=command=>{
 const result=spawnSync(command,['--version'],{encoding:'utf8',timeout:5000,maxBuffer:8192,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
 if(result.error||result.signal||result.status!==0)throw Error('HOST_CLI_VERSION_UNAVAILABLE');return result.stdout.trim();
},now=Date.now()}={}){
 const catalog={schemaVersion:1,hostPlatform:'darwin',capturedAt:new Date(now).toISOString(),expiresAt:now+1800000,
  models:Object.values(RUNTIME_PROFILES).filter(profile=>['codex','opencode'].includes(profile.runtime)).map(profile=>profile.model),unavailable:[]};
 for(const runtime of ['opencode','claude']){
  try{const raw=version(cliPaths[runtime]),match=runtime==='claude'?/^(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+_-]+)?)(?: \(Claude Code\))?$/.exec(raw):/^([A-Za-z0-9][A-Za-z0-9.+_-]{0,127})$/.exec(raw);
   if(!match||!path.isAbsolute(cliPaths[runtime])||path.normalize(cliPaths[runtime])!==cliPaths[runtime])throw Error();catalog[runtime]={path:cliPaths[runtime],version:match[1]};}
  catch{catalog.unavailable.push({runtimeId:runtime,code:'HOST_CLI_VERSION_UNAVAILABLE'});}
 }return catalog;
}
export function createResidentRuntimeObservation({sourceRoot=fileURLToPath(new URL('../',import.meta.url)),cliPaths=CLI_PATHS,
 readFile=fs.readFileSync,cliIdentity=roleHostCliIdentity,now=Date.now()}={}){
 const bindings={},unavailable=[];
 for(const profile of Object.values(RUNTIME_PROFILES)){
  try{const identity=cliIdentity(cliPaths[profile.runtime]);bindings[profile.id]=computeTaskRuntimeImplementationBinding({profileId:profile.id,...identity,
   files:taskRuntimeImplementationFiles(profile.id).map(file=>({file,sha256:hash(readFile(path.join(sourceRoot,file)))}))});}
  catch{unavailable.push({profileId:profile.id,code:'HOST_RUNTIME_IDENTITY_UNAVAILABLE'});}
 }
 return{schemaVersion:1,kind:'macos-runtime-implementations',hostPlatform:'darwin',capturedAt:new Date(now).toISOString(),bindings,unavailable};
}
