import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,mkdirSync,symlinkSync,readlinkSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {materializeCompanyRoleSkills} from './company-role-skills.mjs';

export const DEFAULT_ROLE_SKILL_ASSET_ROOT=fileURLToPath(new URL('../assets/role-skills/',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};
const index=JSON.parse(readFileSync(join(DEFAULT_ROLE_SKILL_ASSET_ROOT,'index.json'),'utf8'));
export const ROLE_SKILL_BUNDLES=freeze(index.skills);
export const ROLE_SKILL_BUNDLE_SHA256=index.sha256;

function assetPath(root,path){
 if(typeof path!=='string'||!path||isAbsolute(path)||path.split(/[\\/]/).some(x=>x==='..'||['.git','node_modules'].includes(x)||/^\.env(?:\.|$)/.test(x)))throw Error('ROLE_SKILL_PATH_INVALID');
 const full=resolve(root,path);if(relative(resolve(root),full).startsWith('..'))throw Error('ROLE_SKILL_PATH_INVALID');
 return full;
}
function validateFile(root,file){
 const path=assetPath(root,file.path),stat=lstatSync(path);
 if(!stat.isFile()||stat.size!==file.bytes||hash(readFileSync(path))!==file.sha256)throw Error(`ROLE_SKILL_ASSET_MISMATCH:${file.path}`);
}
export function validateRoleSkillBundles({assetRoot=DEFAULT_ROLE_SKILL_ASSET_ROOT}={}){
 const data=JSON.parse(readFileSync(join(assetRoot,'index.json'),'utf8'));
 if(data.schemaVersion!==1||data.sha256!==ROLE_SKILL_BUNDLE_SHA256||hash(JSON.stringify({skills:data.skills,supportFiles:data.supportFiles}))!==data.sha256)throw Error('ROLE_SKILL_INDEX_MISMATCH');
 let files=0;
 for(const skill of Object.values(data.skills)){
  if(hash(JSON.stringify(skill.files))!==skill.source.sha256)throw Error(`ROLE_SKILL_MANIFEST_MISMATCH:${skill.name}`);
  for(const file of skill.files){validateFile(assetPath(assetRoot,skill.directory),file);files++;}
 }
 for(const file of data.supportFiles){validateFile(assetRoot,file);files++;}
 return {schemaVersion:1,skills:Object.keys(data.skills).length,files,sha256:data.sha256};
}

export function resolveRoleSkillBundles(skillNames){
 if(!Array.isArray(skillNames))throw Error('ROLE_SKILL_NAMES_INVALID');
 const selected=new Map();
 function add(name){
  if(!Object.hasOwn(ROLE_SKILL_BUNDLES,name))throw Error(`ROLE_SKILL_UNKNOWN:${name}`);
  const skill=ROLE_SKILL_BUNDLES[name];
  if(selected.has(name))return;
  selected.set(name,skill);for(const dependency of skill.dependencies)add(dependency);
 }
 for(const name of skillNames)add(name);
 return [...selected.values()];
}

// The caller mounts this task's verified packageRoot read-only. No host/global Skills are edited.
export function materializeRoleSkillBundle({codexHome,skillNames,assetRoot=DEFAULT_ROLE_SKILL_ASSET_ROOT,packageRoot=assetRoot}){
 if(typeof codexHome!=='string'||!isAbsolute(codexHome)||typeof packageRoot!=='string'||!isAbsolute(packageRoot))throw Error('ROLE_SKILL_TARGET_INVALID');
 const skills=resolveRoleSkillBundles(skillNames);validateRoleSkillBundles({assetRoot});
 const targetRoot=join(codexHome,'skills');
 const links=skills.map(skill=>({skill,path:join(targetRoot,skill.name),target:assetPath(packageRoot,skill.directory)}));
 // Inspect the entire requested set before creating links so a conflict does not replace another Skill.
 for(const link of links){
  let stat;try{stat=lstatSync(link.path);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(stat&&(!stat.isSymbolicLink()||resolve(dirname(link.path),readlinkSync(link.path))!==link.target))throw Error(`ROLE_SKILL_TARGET_CONFLICT:${link.skill.name}`);
  link.exists=Boolean(stat);
 }
 mkdirSync(targetRoot,{recursive:true});
 for(const link of links)if(!link.exists)symlinkSync(link.target,link.path,'dir');
 return {schemaVersion:1,sha256:ROLE_SKILL_BUNDLE_SHA256,packageRoot,readOnlyMountRequired:true,skills:links.map(({skill,path,target})=>({name:skill.name,path,sourcePath:join(target,'SKILL.md'),source:skill.source}))};
}
export const materializeRoleSkills=materializeRoleSkillBundle;

/** Company desiredSkills select packages; legacy runs retain their verified bundled set. */
export function materializeEffectiveRoleSkills({codexHome,effectiveCapabilities,assetRoot=DEFAULT_ROLE_SKILL_ASSET_ROOT,packageRoot=assetRoot}){
 const snapshot=effectiveCapabilities?.companySkillSnapshot;
 if(!snapshot)return materializeRoleSkillBundle({codexHome,skillNames:effectiveCapabilities?.skills?.map(skill=>skill.name)??[],assetRoot,packageRoot});
 const company=materializeCompanyRoleSkills({codexHome,packageRoot,snapshot});
 const bundledNames=snapshot.skills.filter(skill=>skill.bundledName).map(skill=>skill.bundledName);
 const bundled=bundledNames.length?materializeRoleSkillBundle({codexHome,skillNames:bundledNames,assetRoot,packageRoot:assetRoot}):{skills:[]};
 return{...company,skills:[...bundled.skills,...company.skills],selectionSource:'company'};
}
