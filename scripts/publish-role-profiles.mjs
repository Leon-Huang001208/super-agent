/** Update existing Managed role documents through Native HTTP authorization and CAS. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {TEAM_ROLES,roleInstructions} from '../bridge/team-roles.mjs';
import {renderRoleCapabilitiesMarkdown} from '../bridge/role-capabilities.mjs';
import {editRoleRegistry,readControl} from '../bridge/role-control-store.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';

/** Scope metadata is granted only after the complete initial bundle matches public sources. */
export function verifiedGenericRoleManifest({manifest,role}){
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const entry=role+'/AGENTS.md',caps=role+'/CAPABILITIES.md';
 const allowed=new Map([[entry,sha(roleInstructions(role))],[caps,sha(renderRoleCapabilitiesMarkdown(role))]]);
 if(role==='pm')for(const asset of JSON.parse(fs.readFileSync(new URL('../assets/product-manager-coach.manifest.json',import.meta.url))).files)allowed.set(asset.path,asset.sha256);
 if(manifest?.instructionsFilePath!==entry||!Array.isArray(manifest.files)||!manifest.files.some(file=>file.path===caps)||
  manifest.files.some(file=>allowed.get(file.path)!==file.sha256))throw Object.assign(Error('ROLE_PROFILE_GENERIC_SOURCE_CHANGED'),{code:'ROLE_PROFILE_GENERIC_SOURCE_CHANGED'});
 return{...structuredClone(manifest),scope:'generic'};
}

export async function publishRoleProfiles({roles,readFile,writeFile,markGeneric,baselineFiles={},log}){
 let changedFiles=0;const preservedRoles=[];
 for(const entry of roles){
  const role=entry.profile.role,agentId=entry.profile.agentId;
  if(!TEAM_ROLES[role]||entry.manifest.instructionsFilePath!==role+'/AGENTS.md')throw Object.assign(Error('ROLE_PROFILE_ENTRY_CHANGED'),{code:'ROLE_PROFILE_ENTRY_CHANGED'});
  const targets=[[role+'/CAPABILITIES.md',renderRoleCapabilitiesMarkdown(role),false],[role+'/AGENTS.md',roleInstructions(role),true]];
  const currentFiles=new Map(await Promise.all(targets.map(async([file])=>[file,await readFile(agentId,file)])));
  if(targets.some(([file,content])=>currentFiles.get(file)?.content!==undefined&&currentFiles.get(file).content!==content&&currentFiles.get(file).content!==baselineFiles[file])){
   preservedRoles.push(role);log({code:'ROLE_PROFILE_CUSTOM_CONTENT_PRESERVED',role});continue;
  }
  for(const [file,content,isEntry]of targets){
   const current=currentFiles.get(file);
   if(current?.content===content)continue;
   log({code:'ROLE_PROFILE_SAVE_STARTED',role,file});
   await writeFile({agentId,path:file,content,...(isEntry?{baseRevisionId:current?.revision?.id??null}:{baseHash:current?.contentHash??null})});
   changedFiles++;log({code:'ROLE_PROFILE_SAVED',role,file});
  }
  if(markGeneric)await markGeneric({agentId,role});
 }
 return {status:preservedRoles.length?'custom_content_preserved':'complete',roles:roles.length,changedFiles,preservedRoles};
}

async function main(){
 if(process.platform!=='linux'||process.getuid()!==0)throw Object.assign(Error('ROLE_PROFILE_EXPLICIT_APPLY_REQUIRED'),{code:'ROLE_PROFILE_EXPLICIT_APPLY_REQUIRED'});
 const apply=process.argv.includes('--apply'),baselineIndex=process.argv.indexOf('--baseline-profiles'),
  baselineFiles=baselineIndex>=0?readControl(process.argv[baselineIndex+1]):{},R='/paperclip/control/research-pm',r=JSON.parse(fs.readFileSync(R+'/registry.json'));
 const api=await createRoleOwnerApi({registry:r,controlRoot:R,requirePaused:apply}),request=api.request;
 try{
  const log=event=>{if(apply)fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});};
  const result=await publishRoleProfiles({roles:r.agents,log,baselineFiles,
   readFile:(agentId,file)=>request('/agents/'+agentId+'/instructions-bundle/file?path='+encodeURIComponent(file)),
   writeFile:async({agentId,...body})=>apply?request('/agents/'+agentId+'/instructions-bundle/file',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}):undefined,
   ...(apply?{markGeneric:({agentId,role})=>{editRoleRegistry(current=>{const entry=current.agents.find(item=>item.profile.agentId===agentId&&item.profile.role===role);
    if(!entry)throw Object.assign(Error('ROLE_PROFILE_GENERIC_SOURCE_CHANGED'),{code:'ROLE_PROFILE_GENERIC_SOURCE_CHANGED'});
    entry.manifest=verifiedGenericRoleManifest({manifest:entry.manifest,role});return current;});log({code:'ROLE_PROFILE_GENERIC_REGISTERED',agentId,role});}}:{}),
  });
  console.log(JSON.stringify({...result,mode:apply?'applied':'preview'}));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({code:/^ROLE_[A-Z0-9_]+$/.test(error.code??'')?error.code:'ROLE_PROFILE_PUBLICATION_FAILED'}));process.exitCode=1;});
