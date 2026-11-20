import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolveCompanyRoleSkills,materializeCompanyRoleSkills,resolveRoleSkillAssignments,rolePermissions} from '../bridge/company-role-skills.mjs';
import {ROLE_SKILL_BUNDLES,DEFAULT_ROLE_SKILL_ASSET_ROOT} from '../bridge/role-skill-bundles.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const skill=(key,name='guide')=>({id:key,companyId:'company',key,slug:name,name,sourceType:'github',sourceLocator:'https://github.com/example/skills',sourceRef:'a'.repeat(40),compatibility:'compatible',currentVersionId:key+'-v1'});
const version=(key,content='---\nname: guide\n---\nRead the project.')=>({id:key+'-v1',companyId:'company',companySkillId:key,fileInventory:[{path:'SKILL.md',content},{path:'scripts/check.js',content:'process.stdout.write("ok");',executable:true}]});
const agent=keys=>({companyId:'company',adapterConfig:{paperclipSkillSync:{desiredSkills:keys}}});

test('explicit company keys select pinned full versions, never every same-slug skill',()=>{
 const result=resolveCompanyRoleSkills({agent:agent(['second']),companySkills:[skill('first'),skill('second')],companySkillVersions:[version('first','first'),version('second','second')]});
 assert.equal(result.source,'company');assert.equal(result.skills.length,1);assert.equal(result.skills[0].key,'second');
 assert.equal(result.companySkillSnapshot.skills[0].files.find(file=>file.path==='SKILL.md').content,'second');
 assert.equal(result.companySkillSnapshot.skills[0].versionId,'second-v1');
 assert.equal(result.skills[0].entrypointSha256,hash('second'));
 assert.ok(!JSON.stringify(result.skills).includes('process.stdout'));
});

test('unconfigured agents retain legacy fallback while explicit empty selection stays empty',()=>{
 assert.equal(resolveCompanyRoleSkills({agent:{adapterConfig:{}}}),null);
 const empty=resolveCompanyRoleSkills({agent:agent([]),companySkills:[]});
 assert.equal(empty.source,'company');assert.deepEqual(empty.skills,[]);
});

test('missing versions, cross-company records and conflicting runtime names fail visibly',()=>{
 assert.throws(()=>resolveCompanyRoleSkills({agent:agent(['absent']),companySkills:[]}),/COMPANY_ROLE_SKILL_MISSING/);
 assert.throws(()=>resolveCompanyRoleSkills({agent:agent(['first']),companySkills:[skill('first')],companySkillVersions:[]}),/COMPANY_ROLE_SKILL_VERSION_MISSING/);
 assert.throws(()=>resolveCompanyRoleSkills({agent:agent(['first']),companySkills:[{...skill('first'),companyId:'other'}],companySkillVersions:[version('first')]}),/COMPANY_ROLE_SKILL_MISSING/);
 assert.throws(()=>resolveCompanyRoleSkills({agent:agent(['first','second']),companySkills:[skill('first'),skill('second')],companySkillVersions:[version('first'),version('second')]}),/COMPANY_ROLE_SKILL_NAME_CONFLICT/);
});

test('materialization verifies snapshot hashes and preserves complete executable files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'company-skills-'));
 try{
  const result=resolveCompanyRoleSkills({agent:agent(['one']),companySkills:[skill('one')],companySkillVersions:[version('one')]});
  const built=materializeCompanyRoleSkills({codexHome:root+'/home',packageRoot:root+'/packages',snapshot:result.companySkillSnapshot});
  assert.equal(fs.readFileSync(root+'/home/skills/guide/scripts/check.js','utf8'),'process.stdout.write("ok");');
  assert.ok(fs.statSync(root+'/home/skills/guide/scripts/check.js').mode&0o100);
  assert.equal(built.sha256,result.companySkillSnapshot.sha256);
  assert.equal(materializeCompanyRoleSkills({codexHome:root+'/home',packageRoot:root+'/packages',snapshot:result.companySkillSnapshot}).sha256,built.sha256);
  const tampered=structuredClone(result.companySkillSnapshot);tampered.skills[0].files[0].content='tampered';
  assert.throws(()=>materializeCompanyRoleSkills({codexHome:root+'/bad',packageRoot:root+'/bad-packages',snapshot:tampered}),/COMPANY_ROLE_SKILL_SNAPSHOT_CHANGED/);
  assert.ok(!fs.existsSync(root+'/bad'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unsafe version paths fail before writing and library assignment chooses preferred sources',()=>{
 const v=version('one');v.fileInventory[0].path='../outside';
 assert.throws(()=>resolveCompanyRoleSkills({agent:agent(['one']),companySkills:[skill('one')],companySkillVersions:[v]}),/COMPANY_ROLE_SKILL_FILE_INVALID/);
 const selected=resolveRoleSkillAssignments({role:'research',companySkills:[{...skill('pdf1','pdf'),sourceLocator:'https://github.com/openai/skills'},{...skill('pdf2','pdf'),sourceLocator:'https://github.com/anthropics/skills'}],onlyNames:['pdf']});
 assert.deepEqual(selected.desiredSkills,['pdf2']);
});

test('eleven role assignments distinguish default, stack and content conditions',()=>{
 const catalog=['paperclip','handoff','verification-before-completion','react-best-practices','shadcn','supabase-postgres-best-practices','content-strategy','seo-audit','copywriting'].map(name=>skill(name,name));
 const plain=resolveRoleSkillAssignments({role:'frontend-engineer',companySkills:catalog});
 assert.ok(!plain.desiredSkills.includes('react-best-practices'));
 const react=resolveRoleSkillAssignments({role:'frontend-engineer',companySkills:catalog,projectContext:{stack:['React','shadcn/ui']}});
 assert.ok(react.desiredSkills.includes('react-best-practices'));assert.ok(react.desiredSkills.includes('shadcn'));
 const pg=resolveRoleSkillAssignments({role:'backend-engineer',companySkills:catalog,projectContext:{services:{postgres:{}}}});
 assert.ok(pg.desiredSkills.includes('supabase-postgres-best-practices'));
 assert.ok(resolveRoleSkillAssignments({role:'pm',companySkills:catalog,projectContext:{domains:['content']}}).desiredSkills.includes('copywriting'));
 assert.deepEqual(rolePermissions('chief'),{canCreateAgents:true,canAssignTasks:true,canCreateSkills:true});
 assert.deepEqual(rolePermissions('qa'),{canCreateAgents:false,canAssignTasks:false,canCreateSkills:true});
});

test('actual bundled index frontmatter aliases resolve by source directory and keep distinct runtime names',()=>{
 const imported=Object.values(ROLE_SKILL_BUNDLES).map(bundle=>{
  const source=path.join(DEFAULT_ROLE_SKILL_ASSET_ROOT,bundle.directory),markdown=fs.readFileSync(source+'/SKILL.md','utf8');
  const name=markdown.match(/^name:\s*(.+)$/m)?.[1]??bundle.name;
  return{bundle,skill:{id:bundle.name,companyId:'company',key:'local/'+bundle.name,name,slug:name,sourceLocator:source,currentVersionId:bundle.name+'-v1'},version:{id:bundle.name+'-v1',companyId:'company',companySkillId:bundle.name,fileInventory:bundle.files.map(file=>({path:file.path,content:fs.readFileSync(path.join(source,file.path)).toString('base64'),encoding:'base64',executable:file.executable}))}};
 });
 const aliases=imported.filter(entry=>entry.skill.name!==entry.bundle.name);
 assert.deepEqual(aliases.map(entry=>[entry.bundle.name,entry.skill.name]),[['data-analytics-index','index'],['product-design-index','index']]);
 const selected=resolveRoleSkillAssignments({role:'pm',onlyNames:aliases.map(entry=>entry.bundle.name),companySkills:imported.map(entry=>entry.skill),bundledSkills:ROLE_SKILL_BUNDLES});
 assert.deepEqual(selected.missing,[]);assert.equal(selected.desiredSkills.length,2);
 const resolved=resolveCompanyRoleSkills({agent:agent(selected.desiredSkills),companySkills:imported.map(entry=>entry.skill),companySkillVersions:imported.map(entry=>entry.version),bundledSkills:ROLE_SKILL_BUNDLES});
 assert.deepEqual(resolved.skills.map(skill=>skill.name),['data-analytics-index','product-design-index']);
 assert.ok(resolved.companySkillSnapshot.skills.every(skill=>skill.bundledName===skill.name));
});
