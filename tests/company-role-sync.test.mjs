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

function fixture(){
 const registry={companyId:'company',ownerId:'owner',team:{enabled:false},agents:Object.keys(TEAM_ROLES).map(role=>({profile:{agentId:role,role,oldPolicyField:'preserved'},manifest:{sentinel:'preserved'}}))};
 const names=new Set(Object.keys(TEAM_ROLES).flatMap(role=>roleSkillNames({role,includeConditional:true})));
 const library=[...Object.values(ROLE_SKILL_BUNDLES).map(bundle=>({id:'bundle-'+bundle.name,key:'bundle/'+bundle.name,slug:bundle.name,name:bundle.name,sourceLocator:path.join(DEFAULT_ROLE_SKILL_ASSET_ROOT,bundle.directory)})),
 ...[...names].filter(name=>!ROLE_SKILL_BUNDLES[name]).map(name=>({id:name,key:name,slug:name,name,sourceLocator:'https://github.com/example/skills'}))];
 const agents=registry.agents.map(entry=>({id:entry.profile.agentId,companyId:'company',adapterConfig:{model:'gpt-6.1-sol',env:{keep:'value'}},permissions:{},capabilities:'old'}));
 const calls=[];
 const ports={registry,readLibrary:async()=>library,readAgent:async id=>structuredClone(agents.find(agent=>agent.id===id)),saveBefore:async()=>calls.push('before'),
 importSource:async()=>calls.push('import'),syncSkills:async(id,body)=>{calls.push('skills');const agent=agents.find(agent=>agent.id===id);agent.adapterConfig.paperclipSkillSync={desiredSkills:body.desiredSkills};},
 updateAgent:async(id,body)=>{calls.push('agent');Object.assign(agents.find(agent=>agent.id===id),body);},
 updatePermissions:async(id,body)=>{calls.push('permissions');agents.find(agent=>agent.id===id).permissions=body;},updateRegistry:async edit=>{calls.push('registry');edit(registry);}};
 return{...ports,agents,library,calls};
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
