import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const ROLE_SKILL_ASSIGNMENTS=Object.freeze(JSON.parse(fs.readFileSync(new URL('../assets/role-skill-assignments.json',import.meta.url),'utf8')));
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalized=value=>String(value??'').toLowerCase().replace(/\/$/,'');
const safeName=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,159}$/.test(value)&&value!=='.'&&value!=='..';
function safeFile(value){return typeof value==='string'&&value.length>0&&!path.isAbsolute(value)&&!value.includes('\\')&&!value.includes('\0')&&!value.split('/').some(part=>!part||part==='.'||part==='..'||['.git','node_modules'].includes(part)||/^\.env(?:\.|$)/.test(part));}
function bytes(file){
 if(file.encoding==='base64'){
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))fail('COMPANY_ROLE_SKILL_FILE_INVALID');
  return Buffer.from(file.content,'base64');
 }
 if(file.encoding&&file.encoding!=='utf8')fail('COMPANY_ROLE_SKILL_FILE_INVALID');
 return Buffer.from(file.content,'utf8');
}
function normalizeFiles(files){
 if(!Array.isArray(files)||!files.length||files.length>2000)fail('COMPANY_ROLE_SKILL_FILE_INVALID');
 const seen=new Set();let total=0;
 const result=files.map(file=>{
  if(!safeFile(file.path)||seen.has(file.path)||typeof file.content!=='string')fail('COMPANY_ROLE_SKILL_FILE_INVALID');
  seen.add(file.path);const data=bytes(file);total+=data.length;
  if(total>32*1024*1024)fail('COMPANY_ROLE_SKILL_FILE_INVALID');
  return{path:file.path,encoding:file.encoding??'utf8',content:file.content,executable:file.executable===true,bytes:data.length,sha256:hash(data)};
 }).sort((a,b)=>a.path.localeCompare(b.path));
 if(!seen.has('SKILL.md'))fail('COMPANY_ROLE_SKILL_FILE_INVALID');
 return result;
}
function conditionMatches(condition,context){
 const values=key=>(Array.isArray(context[key])?context[key]:[]).map(normalized);
 const services=Array.isArray(context.services)?context.services:Object.entries(context.services??{}).filter(([,v])=>v!==false&&v?.enabled!==false).map(([key])=>key);
 return condition.stack?.some(value=>values('stack').includes(normalized(value)))||condition.domains?.some(value=>values('domains').includes(normalized(value)))||condition.services?.some(value=>services.map(normalized).includes(normalized(value)));
}
export function rolePermissions(role){
 if(!Object.hasOwn(ROLE_SKILL_ASSIGNMENTS.roles,role))fail('TEAM_ROLE_UNKNOWN');
 return{canCreateAgents:role==='chief',canAssignTasks:['chief','architect'].includes(role),canCreateSkills:true};
}
export function roleSkillNames({role,projectContext={},includeConditional=false}){
 const entry=ROLE_SKILL_ASSIGNMENTS.roles[role];if(!entry)fail('TEAM_ROLE_UNKNOWN');
 return [...new Set([...ROLE_SKILL_ASSIGNMENTS.common,...entry.skills,...(entry.conditional??[]).filter(condition=>includeConditional||conditionMatches(condition,projectContext)).flatMap(condition=>condition.skills)])];
}
export function resolveRoleSkillAssignments({role,companySkills=[],projectContext={},onlyNames,includeConditional=false,bundledSkills={}}){
 const roots=onlyNames??roleSkillNames({role,projectContext,includeConditional}),names=[],seen=new Set(),missing=[],selected=[];
 const add=name=>{if(seen.has(name))return;seen.add(name);names.push(name);for(const dependency of bundledSkills[name]?.dependencies??[])add(dependency);};for(const name of roots)add(name);
 for(const name of names){
  const bundle=bundledSkills[name],bundleMatches=bundle?companySkills.filter(skill=>String(skill.sourceLocator??'').replaceAll('\\','/').endsWith('/assets/role-skills/'+bundle.directory)):[];
  let candidates=companySkills.filter(skill=>skill.name===name||skill.slug===name||bundleMatches.includes(skill));
  const preferred=ROLE_SKILL_ASSIGNMENTS.preferredSources[name];
  let preferredSelected=false;
  if(preferred){const matches=candidates.filter(skill=>normalized(skill.sourceLocator)===normalized(preferred)||normalized('https://github.com/'+skill.metadata?.reviewedSource?.sourceRepo)===normalized(preferred));if(matches.length){candidates=matches;preferredSelected=true;}}
  if(!preferredSelected&&bundleMatches.length)candidates=bundleMatches;
  if(!candidates.length){missing.push(name);continue;}
  if(candidates.length!==1)fail('COMPANY_ROLE_SKILL_ASSIGNMENT_AMBIGUOUS');
  const selectedSkill=candidates[0];selected.push({name,key:selectedSkill.key});
 }
 return{role,desiredSkills:[...new Set(selected.map(value=>value.key))],selected,missing};
}

/** Pure version snapshot: the Agent's explicit company keys are the selection authority. */
export function resolveCompanyRoleSkills({agent,role,projectContext={},companySkills=[],companySkillVersions=[],bundledSkills={}}={}){
 const desired=agent?.adapterConfig?.paperclipSkillSync?.desiredSkills;
 if(desired===undefined)return null;
 if(!Array.isArray(desired)||desired.some(key=>typeof key!=='string'||!key))fail('COMPANY_ROLE_SKILL_SELECTION_INVALID');
 const inactiveConditionalNames=role?new Set((ROLE_SKILL_ASSIGNMENTS.roles[role]?.conditional??[]).filter(condition=>!conditionMatches(condition,projectContext)).flatMap(condition=>condition.skills)):new Set();
 const activeConditionalNames=new Set((ROLE_SKILL_ASSIGNMENTS.roles[role]?.conditional??[]).filter(condition=>conditionMatches(condition,projectContext)).flatMap(condition=>condition.skills));
 for(const name of activeConditionalNames)inactiveConditionalNames.delete(name);
 const keys=[...new Set(desired)],names=new Set(),snapshots=[];
 for(const key of keys){
  const skill=companySkills.find(value=>value.key===key&&(!agent.companyId||value.companyId===agent.companyId));
  if(!skill||skill.compatibility==='invalid')fail('COMPANY_ROLE_SKILL_MISSING');
  const bundle=Object.values(bundledSkills).find(value=>String(skill.sourceLocator??'').replaceAll('\\','/').endsWith('/assets/role-skills/'+value.directory));
  const name=bundle?.name??skill.slug??skill.name;
  if(inactiveConditionalNames.has(name))continue;
  if(!safeName(name))fail('COMPANY_ROLE_SKILL_NAME_INVALID');
  if(names.has(name))fail('COMPANY_ROLE_SKILL_NAME_CONFLICT');names.add(name);
  let version=companySkillVersions.find(value=>value.id===skill.currentVersionId&&value.companySkillId===skill.id&&value.companyId===skill.companyId);
  if(!version&&skill.currentVersionId)fail('COMPANY_ROLE_SKILL_VERSION_MISSING');
  if(!version){
   if(typeof skill.markdown!=='string'||skill.fileInventory?.some(file=>file.path!=='SKILL.md'))fail('COMPANY_ROLE_SKILL_VERSION_MISSING');
   version={id:'markdown:'+hash(skill.markdown),fileInventory:[{path:'SKILL.md',content:skill.markdown}]};
  }
  const files=normalizeFiles(version.fileInventory),manifest=files.map(({path,bytes,sha256,executable})=>({path,bytes,sha256,executable}));
  if(bundle&&(bundle.files.length!==files.length||bundle.files.some(file=>!files.some(value=>value.path===file.path&&value.sha256===file.sha256&&value.executable===file.executable))))fail('COMPANY_ROLE_SKILL_BUNDLE_CHANGED');
  const dependencies=bundle?.dependencies??bundledSkills[name]?.dependencies??[];
  for(const dependency of dependencies){
   const selected=resolveRoleSkillAssignments({role,companySkills,onlyNames:[dependency],bundledSkills});
   if(selected.missing.length)fail('COMPANY_ROLE_SKILL_DEPENDENCY_MISSING');
   for(const dependencyKey of selected.desiredSkills)if(!keys.includes(dependencyKey))keys.push(dependencyKey);
  }
  snapshots.push({key,name,versionId:version.id,source:{kind:'company-skill',origin:skill.metadata?.reviewedSource?.sourceUrl??skill.sourceLocator??skill.key,version:skill.metadata?.reviewedSource?.sourceRef??skill.sourceRef??version.id,sha256:hash(JSON.stringify(manifest))},
   ...(bundle?{bundledName:bundle.name,directory:bundle.directory,dependencies,runtimeDependencies:bundle.runtimeDependencies}:{directory:name,dependencies,runtimeDependencies:bundledSkills[name]?.runtimeDependencies??[]}),
   files:bundle?manifest:files});
 }
 const companySkillSnapshot={schemaVersion:1,skills:snapshots};
 if(Buffer.byteLength(JSON.stringify(companySkillSnapshot))>8*1024*1024)fail('COMPANY_ROLE_SKILL_SNAPSHOT_TOO_LARGE');
 companySkillSnapshot.sha256=hash(JSON.stringify({schemaVersion:1,skills:snapshots}));
 return{source:'company',companySkillSnapshot,sha256:companySkillSnapshot.sha256,skills:snapshots.map(skill=>({key:skill.key,name:skill.name,versionId:skill.versionId,
  path:skill.directory+'/SKILL.md',directory:skill.directory,entrypointSha256:skill.files.find(file=>file.path==='SKILL.md').sha256,fileSetSha256:skill.source.sha256,source:skill.source,dependencies:skill.dependencies,
  ...(skill.bundledName?{bundledName:skill.bundledName}:{}),runtimeDependencies:skill.runtimeDependencies}))};
}

function ensurePath(root,relative){
 if(!safeFile(relative))fail('COMPANY_ROLE_SKILL_FILE_INVALID');
 const target=path.join(root,relative);let current=root;
 for(const part of relative.split('/').slice(0,-1)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('COMPANY_ROLE_SKILL_TARGET_CONFLICT');}
 return target;
}
/** Writes only this run's pinned packages, never global Skills or a mutable library path. */
export function materializeCompanyRoleSkills({codexHome,packageRoot,snapshot}){
 if(!path.isAbsolute(codexHome??'')||!path.isAbsolute(packageRoot??''))fail('COMPANY_ROLE_SKILL_TARGET_INVALID');
 if(snapshot?.schemaVersion!==1||hash(JSON.stringify({schemaVersion:1,skills:snapshot.skills}))!==snapshot.sha256)fail('COMPANY_ROLE_SKILL_SNAPSHOT_CHANGED');
 const selected=snapshot.skills.filter(skill=>!skill.bundledName),writes=[],links=[];
 for(const skill of selected){
  if(!safeName(skill.name))fail('COMPANY_ROLE_SKILL_NAME_INVALID');
  const files=normalizeFiles(skill.files),target=path.join(packageRoot,hash(skill.key+'\n'+skill.versionId).slice(0,24),skill.name);
  for(const file of files){
   const destination=ensurePath(target,file.path),data=bytes(file);
   if(file.sha256!==skill.files.find(value=>value.path===file.path)?.sha256)fail('COMPANY_ROLE_SKILL_SNAPSHOT_CHANGED');
   if(fs.existsSync(destination)&&(fs.lstatSync(destination).isSymbolicLink()||!fs.lstatSync(destination).isFile()||hash(fs.readFileSync(destination))!==file.sha256))fail('COMPANY_ROLE_SKILL_TARGET_CONFLICT');
   writes.push({destination,data,executable:file.executable});
  }
  const link=path.join(codexHome,'skills',skill.name);
  if(fs.existsSync(link)||(()=>{try{return fs.lstatSync(link).isSymbolicLink();}catch{return false;}})()){
   if(!fs.lstatSync(link).isSymbolicLink()||path.resolve(path.dirname(link),fs.readlinkSync(link))!==target)fail('COMPANY_ROLE_SKILL_TARGET_CONFLICT');
  }
  links.push({name:skill.name,path:link,target,sourcePath:path.join(target,'SKILL.md'),source:skill.source,key:skill.key,versionId:skill.versionId});
 }
 for(const write of writes){fs.mkdirSync(path.dirname(write.destination),{recursive:true,mode:0o700});if(!fs.existsSync(write.destination))fs.writeFileSync(write.destination,write.data,{flag:'wx',mode:write.executable?0o500:0o400});}
 fs.mkdirSync(path.join(codexHome,'skills'),{recursive:true,mode:0o700});
 for(const link of links){try{fs.lstatSync(link.path);}catch(error){if(error.code!=='ENOENT')throw error;fs.symlinkSync(link.target,link.path,'dir');}}
 return{schemaVersion:1,sha256:snapshot.sha256,packageRoot,readOnlyMountRequired:false,skills:links};
}
