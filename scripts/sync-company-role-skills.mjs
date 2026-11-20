import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ROLE_SKILL_BUNDLES,DEFAULT_ROLE_SKILL_ASSET_ROOT} from '../bridge/role-skill-bundles.mjs';
import {resolveRoleSkillAssignments,rolePermissions} from '../bridge/company-role-skills.mjs';
import {TEAM_ROLES} from '../bridge/team-roles.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';
import {editRoleRegistry} from '../bridge/role-control-store.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=value=>createHash('sha256').update(value).digest('hex');
export const NATIVE_ROLE_EXECUTION_POLICY=MACOS_NATIVE_EXECUTION_POLICY;

/** Import recursively reads a directory, so verify the exact regular-file set, including hidden files. */
export function validateReviewedSourceDirectory({source,files}){
 if(!path.isAbsolute(source??'')||!Array.isArray(files)||!files.length)fail('COMPANY_ROLE_SYNC_INVENTORY_INVALID');
 const expected=new Map();
 for(const file of files){
  if(typeof file.path!=='string'||!file.path||path.posix.isAbsolute(file.path)||file.path.includes('\\')||file.path.split('/').some(part=>!part||part==='.'||part==='..')||expected.has(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256??''))fail('COMPANY_ROLE_SYNC_INVENTORY_INVALID');
  expected.set(file.path,file);
 }
 const actual=new Set();
 const walk=(directory,relative='')=>{
  const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('COMPANY_ROLE_SYNC_INVENTORY_SPECIAL_FILE');
  for(const name of fs.readdirSync(directory)){
   const target=path.join(directory,name),filePath=relative?relative+'/'+name:name,stat=fs.lstatSync(target);
   if(stat.isSymbolicLink())fail('COMPANY_ROLE_SYNC_INVENTORY_SPECIAL_FILE');
   if(stat.isDirectory()){walk(target,filePath);continue;}
   if(!stat.isFile())fail('COMPANY_ROLE_SYNC_INVENTORY_SPECIAL_FILE');
   const known=expected.get(filePath);
   if(!known)fail('COMPANY_ROLE_SYNC_INVENTORY_FILE_SET_CHANGED');
   if(sha(fs.readFileSync(target))!==known.sha256||(known.bytes!==undefined&&stat.size!==known.bytes))fail('COMPANY_ROLE_SYNC_INVENTORY_BYTES_CHANGED');
   actual.add(filePath);
  }
 };
 walk(source);
 if(actual.size!==expected.size)fail('COMPANY_ROLE_SYNC_INVENTORY_FILE_SET_CHANGED');
 return{fileCount:actual.size};
}

/** Compare the bytes Native actually snapshotted, rather than trusting an import HTTP success. */
export function validateReviewedImportedVersion({files,version}){
 if(!Array.isArray(version?.fileInventory)||version.fileInventory.length!==files.length)fail('COMPANY_ROLE_SYNC_IMPORTED_VERSION_CHANGED');
 const expected=new Map(files.map(file=>[file.path,file])),seen=new Set();
 for(const file of version.fileInventory){
  const known=expected.get(file.path);if(!known||seen.has(file.path)||typeof file.content!=='string'||!['utf8','base64',undefined,null].includes(file.encoding))fail('COMPANY_ROLE_SYNC_IMPORTED_VERSION_CHANGED');
  const bytes=Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8');
  if(sha(bytes)!==known.sha256||(known.bytes!==undefined&&bytes.length!==known.bytes)||(typeof known.executable==='boolean'&&(file.executable===true)!==known.executable))fail('COMPANY_ROLE_SYNC_IMPORTED_VERSION_CHANGED');
  seen.add(file.path);
 }
 return{versionId:version.id??null,fileCount:seen.size};
}

/** A preview performs only reads. Apply uses existing authenticated Native endpoints. */
export async function syncCompanyRoleSkills({registry,readLibrary,readAgent,readImportedVersion,importSource,syncSkills,updateAgent,updatePermissions,updateRegistry,saveBefore,recordReview,importSources=[],assetRoot=DEFAULT_ROLE_SKILL_ASSET_ROOT,apply=false,log=()=>{}}){
 if(!registry?.companyId||!registry.ownerId||!Array.isArray(registry.agents)||registry.agents.length!==11)fail('COMPANY_ROLE_SYNC_REGISTRY_INVALID');
 if(apply&&registry.team?.enabled!==false)fail('COMPANY_ROLE_SYNC_DISPATCH_BUSY');
 let library=await readLibrary();if(!Array.isArray(library))fail('COMPANY_ROLE_SYNC_LIBRARY_INVALID');
 const agents=await Promise.all(registry.agents.map(entry=>readAgent(entry.profile.agentId)));
 if(agents.some((agent,index)=>!agent||agent.id!==registry.agents[index].profile.agentId||agent.companyId!==registry.companyId))fail('COMPANY_ROLE_SYNC_AGENT_CHANGED');
 const bundledSources=Object.values(ROLE_SKILL_BUNDLES).map(skill=>({name:skill.name,source:path.join(assetRoot,skill.directory),bundled:true,files:skill.files}));
 const imports=[...bundledSources,...importSources].filter(source=>!library.some(skill=>skill.sourceLocator===source.source));
 let beforeSaved=false;
 if(apply){
  // A durable before snapshot is needed only if this invocation will change imports,
  // assignments or settings. Configuration changes are captured below before writes.
  if(imports.length){await saveBefore?.({registry,agents,skills:library,imports});beforeSaved=true;}
  if(imports.length&&!readImportedVersion)fail('COMPANY_ROLE_SYNC_VERSION_READER_MISSING');
  for(const source of imports){
   validateReviewedSourceDirectory(source);
   const imported=await importSource(source.source),row=imported?.imported?.find(skill=>skill.sourceLocator===source.source);
   const skill=row??(await readLibrary()).find(skill=>skill.sourceLocator===source.source);
   if(!skill)fail('COMPANY_ROLE_SYNC_IMPORTED_SOURCE_MISSING');
   validateReviewedImportedVersion({files:source.files,version:await readImportedVersion(skill.id)});
   log({code:'COMPANY_ROLE_SKILL_IMPORTED',name:source.name});
  }
  if(imports.length)library=await readLibrary();
  for(const source of importSources.filter(source=>source.reviewedSource)){
   const skill=library.find(skill=>skill.sourceLocator===source.source);if(!skill)fail('COMPANY_ROLE_SYNC_IMPORTED_SOURCE_MISSING');
   if(!readImportedVersion)fail('COMPANY_ROLE_SYNC_VERSION_READER_MISSING');
   validateReviewedSourceDirectory(source);
   validateReviewedImportedVersion({files:source.files,version:await readImportedVersion(skill.id)});
   if(!isDeepStrictEqual(skill.metadata?.reviewedSource,source.reviewedSource)&&!beforeSaved){await saveBefore?.({registry,agents,skills:library,imports});beforeSaved=true;}
   if(!recordReview)fail('COMPANY_ROLE_SYNC_REVIEW_WRITER_MISSING');await recordReview(skill.id,source.reviewedSource);
  }
  if(importSources.length)library=await readLibrary();
 }
 const assignments=registry.agents.map(entry=>resolveRoleSkillAssignments({role:entry.profile.role,companySkills:library,includeConditional:true,bundledSkills:ROLE_SKILL_BUNDLES}));
 const missing=assignments.flatMap(assignment=>assignment.missing.map(name=>({role:assignment.role,name})));
 if(apply&&missing.length)fail('COMPANY_ROLE_SYNC_REQUIRED_SKILL_MISSING');
 let updated=0;
 for(let index=0;index<registry.agents.length;index++){
  const entry=registry.agents[index],agent=agents[index],assignment=assignments[index],role=entry.profile.role,permissions=rolePermissions(role);
  const adapterConfig={...agent.adapterConfig,dangerouslyBypassApprovalsAndSandbox:true,dangerouslyBypassSandbox:true,extraArgs:[],executionPolicy:{...NATIVE_ROLE_EXECUTION_POLICY}};
  const desired=agent.adapterConfig?.paperclipSkillSync?.desiredSkills??[];
  const skillsChanged=JSON.stringify(desired)!==JSON.stringify(assignment.desiredSkills);
  const configChanged=!isDeepStrictEqual(agent.adapterConfig,adapterConfig)||agent.capabilities!==TEAM_ROLES[role].duty;
  const permissionsChanged=Object.entries(permissions).some(([key,value])=>agent.permissions?.[key]!==value);
  if(skillsChanged||configChanged||permissionsChanged)updated++;
  if(!apply)continue;
  if((skillsChanged||configChanged||permissionsChanged)&&!beforeSaved){await saveBefore?.({registry,agents,skills:library,imports});beforeSaved=true;}
  // Update config first; skill sync then merges its selection into that same config.
  if(configChanged)await updateAgent(agent.id,{capabilities:TEAM_ROLES[role].duty,adapterConfig});
  if(skillsChanged)await syncSkills(agent.id,{mode:'replace',desiredSkills:assignment.desiredSkills});
  if(permissionsChanged)await updatePermissions(agent.id,permissions);
  log({code:'COMPANY_ROLE_AGENT_SYNCHRONIZED',role,agentId:agent.id,skillCount:assignment.desiredSkills.length});
 }
 const registryChanged=registry.agents.some(entry=>!isDeepStrictEqual(entry.profile.executionPolicy,NATIVE_ROLE_EXECUTION_POLICY)||entry.profile.dangerouslyBypassApprovalsAndSandbox!==true||entry.profile.sandbox!=='none');
 if(apply&&registryChanged){
  if(!beforeSaved)await saveBefore?.({registry,agents,skills:library,imports});
  await updateRegistry(current=>{
  if(current.companyId!==registry.companyId||current.ownerId!==registry.ownerId||current.team?.enabled!==false)fail('COMPANY_ROLE_SYNC_REGISTRY_CHANGED');
  for(const entry of current.agents){if(!registry.agents.some(prior=>prior.profile.agentId===entry.profile.agentId&&prior.profile.role===entry.profile.role))fail('COMPANY_ROLE_SYNC_REGISTRY_CHANGED');
   entry.profile={...entry.profile,executionPolicy:{...NATIVE_ROLE_EXECUTION_POLICY},dangerouslyBypassApprovalsAndSandbox:true,sandbox:'none'};
  }
  return current;
  });
 }
 return{schemaVersion:1,mode:apply?'applied':'preview',agentCount:agents.length,updatedAgents:updated,imports:imports.map(({name,source,bundled})=>({name,source,bundled:bundled===true})),assignments,missing};
}

async function main(){
 const args=process.argv.slice(2),apply=args.includes('--apply'),controlRoot='/paperclip/control/research-pm';
 const registry=JSON.parse(fs.readFileSync(controlRoot+'/registry.json','utf8'));
 const value=flag=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
 let sources=[];
 const inventoryFile=value('--inventory');
 if(inventoryFile){const inventory=JSON.parse(fs.readFileSync(inventoryFile,'utf8'));const packages=Array.isArray(inventory)?inventory:(inventory.packages??inventory.skills);
  if(!Array.isArray(packages))fail('COMPANY_ROLE_SYNC_INVENTORY_INVALID');
  sources=packages.map(item=>{const review=item.review?.verdict??item.reviewResult??item.verdict??item.review;
   if(!['PASS','PASS_STATIC_WITH_NOTES','REVIEW_ADAPT_BEFORE_ENABLE'].includes(review))fail('COMPANY_ROLE_SYNC_INVENTORY_UNREVIEWED');
   if(review==='REVIEW_ADAPT_BEFORE_ENABLE'&&!['verification-before-completion','writing-plans','test-driven-development','differential-review','security-threat-model'].includes(item.name))fail('COMPANY_ROLE_SYNC_INVENTORY_UNREVIEWED');
   const source=value('--package-root')?path.join(value('--package-root'),item.name):item.packageDirectory??item.localPath??item.packagePath??item.directory;
   validateReviewedSourceDirectory({source,files:item.files});
   return{name:item.name??item.skill,source,files:item.files,reviewedSource:{sourceRepo:item.sourceRepo,sourceRef:item.sourceRef,sourcePath:item.sourcePath,sourceUrl:item.sourceUrl,license:item.license,stars:item.stars,review:item.review,actualDependencies:item.actualDependencies,bundleSha256:item.bundleSha256,importMethod:'reviewed_local_snapshot',adaptationPolicy:'role-instructions-20261120'}};});
 }
 const api=await createRoleOwnerApi({registry,controlRoot,requirePaused:apply});
 const request=(route,method,body)=>api.request(route,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const log=event=>fs.appendFileSync(controlRoot+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
 try{
  const result=await syncCompanyRoleSkills({registry,apply,importSources:sources,log,recordReview:api.recordSkillReview,
   readLibrary:async()=>{const result=await api.request('/companies/'+registry.companyId+'/skills');return Array.isArray(result)?result:result.skills??result.items;},
   readAgent:id=>api.request('/agents/'+id),
   readImportedVersion:async id=>(await api.request('/companies/'+registry.companyId+'/skills/'+id))?.currentVersion,
   importSource:source=>request('/companies/'+registry.companyId+'/skills/import','POST',{source}),
   syncSkills:(id,body)=>request('/agents/'+id+'/skills/sync','POST',body),
   updateAgent:(id,body)=>request('/agents/'+id,'PATCH',body),
   updatePermissions:(id,body)=>request('/agents/'+id+'/permissions','PATCH',body),
   updateRegistry:edit=>editRoleRegistry(edit),
   saveBefore:before=>{const folder=controlRoot+'/native-skill-rollout';fs.mkdirSync(folder,{recursive:true,mode:0o700});const data=JSON.stringify(before)+'\n',file=folder+'/before-'+sha(data)+'.private.json';if(!fs.existsSync(file))fs.writeFileSync(file,data,{flag:'wx',mode:0o600});},
  });
  console.log(JSON.stringify(result));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({code:/^(?:COMPANY_ROLE|ROLE_OWNER_API)_[A-Z0-9_]+$/.test(error.code??error.message)?(error.code??error.message):'COMPANY_ROLE_SYNC_FAILED'}));process.exitCode=1;});
