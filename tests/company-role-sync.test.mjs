import test from 'node:test';
import assert from 'node:assert/strict';
import {syncCompanyRoleSkills,NATIVE_ROLE_EXECUTION_POLICY,validateReviewedSourceDirectory,validateReviewedImportedVersion} from '../scripts/sync-company-role-skills.mjs';
import {TEAM_ROLES} from '../bridge/team-roles.mjs';
import {ROLE_SKILL_BUNDLES,DEFAULT_ROLE_SKILL_ASSET_ROOT} from '../bridge/role-skill-bundles.mjs';
import {roleSkillNames,resolveRoleSkillAssignments} from '../bridge/company-role-skills.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as skillSync from '../scripts/sync-company-role-skills.mjs';

function fixture(){
 const registry={companyId:'company',ownerId:'owner',team:{enabled:false},agents:Object.keys(TEAM_ROLES).map(role=>({profile:{agentId:role,role,oldPolicyField:'preserved'},manifest:{sentinel:'preserved'}}))};
 const names=new Set(Object.keys(TEAM_ROLES).flatMap(role=>roleSkillNames({role,includeConditional:true})));
 const library=[...Object.values(ROLE_SKILL_BUNDLES).map(bundle=>({id:'bundle-'+bundle.name,key:'bundle/'+bundle.name,slug:bundle.name,name:bundle.name,sourceLocator:path.join(DEFAULT_ROLE_SKILL_ASSET_ROOT,bundle.directory)})),
 ...[...names].filter(name=>!ROLE_SKILL_BUNDLES[name]).map(name=>({id:name,key:name,slug:name,name,sourceLocator:'https://github.com/example/skills'}))];
 const agents=registry.agents.map(entry=>({id:entry.profile.agentId,companyId:'company',adapterConfig:{model:'gpt-6.1-sol',env:{keep:'value'}},permissions:{},capabilities:'old'}));
 const calls=[];
 const versions=new Map(Object.values(ROLE_SKILL_BUNDLES).map(bundle=>['bundle-'+bundle.name,{id:bundle.name+'-v1',fileInventory:bundle.files.map(file=>({path:file.path,content:fs.readFileSync(path.join(DEFAULT_ROLE_SKILL_ASSET_ROOT,bundle.directory,file.path)).toString('base64'),encoding:'base64',executable:file.executable}))}]));
 const ports={registry,readLibrary:async()=>library,readAgent:async id=>structuredClone(agents.find(agent=>agent.id===id)),saveBefore:async()=>calls.push('before'),
 readImportedVersion:async id=>versions.get(id)??null,
 createImportedVersion:async id=>{calls.push('version:'+id);const name=id.slice('bundle-'.length),bundle=ROLE_SKILL_BUNDLES[name];versions.set(id,{id:name+'-created',fileInventory:bundle.files.map(file=>({path:file.path,content:fs.readFileSync(path.join(DEFAULT_ROLE_SKILL_ASSET_ROOT,bundle.directory,file.path)).toString('base64'),encoding:'base64',executable:file.executable}))});},
 importSource:async()=>calls.push('import'),syncSkills:async(id,body)=>{calls.push('skills');const agent=agents.find(agent=>agent.id===id);agent.adapterConfig.paperclipSkillSync={desiredSkills:body.desiredSkills};},
 updateAgent:async(id,body)=>{calls.push('agent');Object.assign(agents.find(agent=>agent.id===id),body);},
 updatePermissions:async(id,body)=>{calls.push('permissions');agents.find(agent=>agent.id===id).permissions=body;},updateRegistry:async edit=>{calls.push('registry');edit(registry);}};
 return{...ports,agents,library,calls,versions};
}
test('preview performs no import, configuration, permission or registry writes',async()=>{
 const f=fixture();const result=await syncCompanyRoleSkills(f);
 assert.equal(result.agentCount,11);assert.equal(result.mode,'preview');assert.deepEqual(result.missing,[]);assert.deepEqual(f.calls,[]);
});
test('apply preserves identities and unrelated config, synchronizes UI and trusted native policy, then is idempotent',async()=>{
 const f=fixture();const first=await syncCompanyRoleSkills({...f,apply:true});assert.equal(first.updatedAgents,11);assert.equal(f.calls[0],'before');
 assert.equal(f.registry.agents[0].manifest.sentinel,'preserved');
 assert.equal(f.registry.agents[0].profile.oldPolicyField,'preserved');assert.deepEqual(f.registry.agents[0].profile.executionPolicy,NATIVE_ROLE_EXECUTION_POLICY);
 assert.equal(f.agents[0].adapterConfig.env.keep,'value');assert.equal(f.agents.find(agent=>agent.id==='chief').permissions.canCreateAgents,true);
 f.calls.length=0;const repeated=await syncCompanyRoleSkills({...f,apply:true});assert.equal(repeated.updatedAgents,0);assert.deepEqual(f.calls,[]);
});
test('busy or incomplete library cannot apply a partial role configuration',async()=>{
 const f=fixture();f.registry.team.enabled=true;await assert.rejects(syncCompanyRoleSkills({...f,apply:true}),/DISPATCH_BUSY/);assert.deepEqual(f.calls,[]);
 const g=fixture();g.readLibrary=async()=>g.library.filter(skill=>skill.name!=='paperclip');await assert.rejects(syncCompanyRoleSkills({...g,apply:true}),/REQUIRED_SKILL_MISSING/);assert.ok(!g.calls.includes('agent'));
});
test('reviewed GitHub snapshots win over old bundled versions and keep debugging dependencies',()=>{
 const f=fixture();const audit={id:'new',key:'new-debug',name:'systematic-debugging',slug:'systematic-debugging',sourceLocator:'/staging/packages/systematic-debugging',metadata:{reviewedSource:{sourceRepo:'obra/superpowers'}}};
 const result=resolveRoleSkillAssignments({role:'network-engineer',companySkills:[...f.library,audit],bundledSkills:ROLE_SKILL_BUNDLES});
 assert.ok(result.desiredSkills.includes('new-debug'));assert.ok(!result.desiredSkills.includes('bundle/systematic-debugging'));
 assert.ok(result.selected.some(skill=>skill.name==='test-driven-development'));assert.ok(result.selected.some(skill=>skill.name==='verification-before-completion'));
});

test('JSONB object key order does not create configuration or provenance changes',async()=>{
 const f=fixture();await syncCompanyRoleSkills({...f,apply:true});
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
 for(const agent of f.agents){agent.adapterConfig=reorder(agent.adapterConfig);agent.permissions=reorder(agent.permissions);}
 for(const entry of f.registry.agents)entry.profile.executionPolicy=reorder(entry.profile.executionPolicy);
 f.calls.length=0;const repeated=await syncCompanyRoleSkills({...f,apply:true});
 assert.equal(repeated.updatedAgents,0);assert.deepEqual(f.calls,[]);
});

test('reviewed import rejects extra hidden files, changed bytes, symlinks and special files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-import-set-')),source=root+'/package';fs.mkdirSync(source);
 const text='# Skill',files=[{path:'SKILL.md',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}];
 try{
  fs.writeFileSync(source+'/SKILL.md',text);assert.equal(validateReviewedSourceDirectory({source,files}).fileCount,1);
  fs.writeFileSync(source+'/.unreviewed','surprise');assert.throws(()=>validateReviewedSourceDirectory({source,files}),/FILE_SET_CHANGED/);fs.unlinkSync(source+'/.unreviewed');
  fs.symlinkSync(source+'/SKILL.md',source+'/linked.md');assert.throws(()=>validateReviewedSourceDirectory({source,files}),/SPECIAL_FILE/);fs.unlinkSync(source+'/linked.md');
  assert.equal(spawnSync('mkfifo',[source+'/pipe']).status,0);assert.throws(()=>validateReviewedSourceDirectory({source,files}),/SPECIAL_FILE/);fs.unlinkSync(source+'/pipe');
  fs.writeFileSync(source+'/SKILL.md','changed');assert.throws(()=>validateReviewedSourceDirectory({source,files}),/BYTES_CHANGED/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('successful import HTTP response must still match the complete Native version snapshot',()=>{
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const files=[{path:'SKILL.md',sha256:hash('reviewed'),bytes:8}];
 assert.equal(validateReviewedImportedVersion({files,version:{id:'version',fileInventory:[{path:'SKILL.md',content:'reviewed'}]}}).versionId,'version');
 assert.throws(()=>validateReviewedImportedVersion({files,version:{fileInventory:[{path:'SKILL.md',content:'different'}]}}),/IMPORTED_VERSION_CHANGED/);
 assert.throws(()=>validateReviewedImportedVersion({files,version:{fileInventory:[{path:'SKILL.md',content:'reviewed'},{path:'extra.sh',content:'extra'}]}}),/IMPORTED_VERSION_CHANGED/);
});

test('previously imported local sources without a current version recover once before assignments',async()=>{
 const f=fixture();f.versions.delete('bundle-leader');
 const result=await syncCompanyRoleSkills({...f,apply:true});
 assert.equal(result.updatedAgents,11);assert.equal(f.calls.filter(call=>call==='version:bundle-leader').length,1);
 assert.ok(f.calls.indexOf('version:bundle-leader')<f.calls.indexOf('agent'));
 f.calls.length=0;await syncCompanyRoleSkills({...f,apply:true});assert.deepEqual(f.calls,[]);
});

test('fresh local imports create and read back a current version without replacing existing versions',async()=>{
 const f=fixture(),leader=f.library.find(skill=>skill.id==='bundle-leader');
 f.library.splice(f.library.indexOf(leader),1);f.versions.delete(leader.id);
 f.importSource=async source=>{f.calls.push('import');assert.equal(source,leader.sourceLocator);f.library.push(leader);return{imported:[leader]};};
 await syncCompanyRoleSkills({...f,apply:true});
 assert.equal(f.calls.filter(call=>call.startsWith('version:')).length,1);
 assert.ok(f.calls.indexOf('import')<f.calls.indexOf('version:bundle-leader'));
 const bad=fixture();bad.versions.get('bundle-leader').fileInventory[0].content=Buffer.from('changed').toString('base64');
 await assert.rejects(syncCompanyRoleSkills({...bad,apply:true}),/IMPORTED_VERSION_CHANGED/);
 assert.ok(!bad.calls.some(call=>call.startsWith('version:')||call==='agent'));
});

test('lightweight Native list is enriched only for inventory-reviewed locators and preserves reviewed source priority',async()=>{
 const source='/native/staging/packages/copywriting',calls=[];
 const list=[{id:'reviewed',companyId:'company',key:'reviewed-copy',name:'copywriting',slug:'copywriting',sourceLocator:source},
  {id:'github',companyId:'company',key:'github-copy',name:'copywriting',slug:'copywriting',sourceLocator:'https://github.com/coreyhaines31/marketingskills'},
  {id:'other',companyId:'company',key:'other',name:'other',slug:'other',sourceLocator:'/other'}];
 assert.ok(list.every(skill=>!Object.hasOwn(skill,'metadata')));
 const request=async route=>{calls.push(route);if(route==='/companies/company/skills')return list;
  assert.equal(route,'/companies/company/skills/reviewed');return{...list[0],markdown:'large body not needed',metadata:{reviewedSource:{sourceRepo:'coreyhaines31/marketingskills',sourceRef:'a'.repeat(40),sourcePath:'skills/copywriting',sourceUrl:'https://github.com/coreyhaines31/marketingskills/tree/'+('a'.repeat(40))+'/skills/copywriting',review:{verdict:'PASS_STATIC_WITH_NOTES'}}}};};
 const library=await skillSync.readCompanyRoleLibrary({companyId:'company',request,importSources:[{source}]});
 assert.deepEqual(calls,['/companies/company/skills','/companies/company/skills/reviewed']);
 assert.equal(library[0].markdown,undefined);assert.equal(library[1],list[1]);assert.equal(library[2],list[2]);
 assert.deepEqual(resolveRoleSkillAssignments({role:'pm',onlyNames:['copywriting'],companySkills:library}).desiredSkills,['reviewed-copy']);
});

test('reviewed Native detail must keep list identity, company and source locator',async()=>{
 const skill={id:'reviewed',companyId:'company',key:'reviewed-copy',name:'copywriting',slug:'copywriting',sourceLocator:'/native/staging/packages/copywriting'};
 for(const change of [{id:'other'},{companyId:'foreign'},{sourceLocator:'/different'}]){
  const request=async route=>route==='/companies/company/skills'?[skill]:{...skill,...change,metadata:{}};
  await assert.rejects(skillSync.readCompanyRoleLibrary({companyId:'company',request,importSources:[{source:skill.sourceLocator}]}),/COMPANY_ROLE_SYNC_LIBRARY_DETAIL_CHANGED/);
 }
});

test('read-only library enrichment without reviewed imports keeps lightweight entries and repeat requests never mutate',async()=>{
 const list=[{id:'plain',companyId:'company',key:'plain',name:'plain',sourceLocator:'/plain'}],calls=[];
 const request=async(route,options)=>{assert.equal(options,undefined);calls.push(route);return{items:list};};
 const first=await skillSync.readCompanyRoleLibrary({companyId:'company',request,importSources:[]});
 const repeated=await skillSync.readCompanyRoleLibrary({companyId:'company',request,importSources:[]});
 assert.deepEqual(first,list);assert.deepEqual(repeated,list);assert.deepEqual(calls,['/companies/company/skills','/companies/company/skills']);
});
