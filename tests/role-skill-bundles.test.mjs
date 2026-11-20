import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,lstatSync,readdirSync,rmSync,cpSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROLE_SKILL_BUNDLES,validateRoleSkillBundles,materializeRoleSkills,DEFAULT_ROLE_SKILL_ASSET_ROOT} from '../bridge/role-skill-bundles.mjs';

test('selected Skills ship complete hashed source assets including references and scripts',()=>{
  const result=validateRoleSkillBundles();
  assert.equal(result.schemaVersion,1);
  assert.ok(result.skills>=20);
  assert.ok(result.files>result.skills);
  assert.equal(result.sha256.length,64);
  assert.ok(ROLE_SKILL_BUNDLES['figma-use'].files.some(x=>x.path==='references/fig-builder.md'));
  assert.ok(ROLE_SKILL_BUNDLES['storage-analyzer'].files.some(x=>x.path==='scripts/build_report.py'));
  for(const skill of Object.values(ROLE_SKILL_BUNDLES)){
    assert.ok(skill.files.some(x=>x.path==='SKILL.md'));
    assert.ok(skill.files.every(x=>!/(^|\/)(?:\.git|node_modules|\.env(?:\.|$)|auth\.json|credentials)(\/|$)/i.test(x.path)));
    assert.ok(skill.files.every(x=>x.sha256.length===64));
  }
});

test('materialization uses CODEX_HOME Skills links into the same readonly package with dependencies',()=>{
  const root=mkdtempSync(join(tmpdir(),'role-skills-'));
  try{
    const result=materializeRoleSkills({codexHome:root,skillNames:['figma-generate-design','storage-analyzer']});
    assert.ok(result.skills.some(x=>x.name==='figma-use'));
    const target=join(root,'skills','figma-use','SKILL.md');
    assert.equal(readFileSync(target,'utf8'),readFileSync(join(DEFAULT_ROLE_SKILL_ASSET_ROOT,ROLE_SKILL_BUNDLES['figma-use'].directory,'SKILL.md'),'utf8'));
    assert.equal(lstatSync(join(root,'skills','figma-use')).isSymbolicLink(),true);
    assert.equal(result.readOnlyMountRequired,true);
    assert.ok(readdirSync(join(root,'skills','storage-analyzer','scripts')).includes('build_report.py'));
    assert.equal(materializeRoleSkills({codexHome:root,skillNames:['figma-generate-design','storage-analyzer']}).sha256,result.sha256);
    assert.throws(()=>materializeRoleSkills({codexHome:root,skillNames:['unknown']}),/ROLE_SKILL_UNKNOWN/);
    assert.throws(()=>materializeRoleSkills({codexHome:root,skillNames:['__proto__']}),/ROLE_SKILL_UNKNOWN/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('packaged method links preserve required cross-Skill and shared references',()=>{
  for(const [name,link]of [
    ['figma-generate-design','../figma-use/SKILL.md'],
    ['audit','../user-context/SKILL.md'],
    ['audit','../index/SKILL.md'],
    ['audit','../../references/critical-overrides.md'],
    ['design-kpis','../../shared/source-selection.md'],
  ]){
    const base=join(DEFAULT_ROLE_SKILL_ASSET_ROOT,ROLE_SKILL_BUNDLES[name].directory);
    assert.ok(readFileSync(join(base,link),'utf8').length>0,`${name}: ${link}`);
  }
});

test('tampered assets are rejected before any Skill links are created',()=>{
  const root=mkdtempSync(join(tmpdir(),'role-skills-tamper-'));
  try{
    const copy=join(root,'assets');cpSync(DEFAULT_ROLE_SKILL_ASSET_ROOT,copy,{recursive:true});
    const path=join(copy,ROLE_SKILL_BUNDLES['firecrawl-deep-research'].directory,'SKILL.md');
    chmodSync(path,0o644);writeFileSync(path,'changed source');
    assert.throws(()=>materializeRoleSkills({codexHome:join(root,'home'),skillNames:['firecrawl-deep-research'],assetRoot:copy}),/ROLE_SKILL_ASSET_MISMATCH/);
    assert.throws(()=>lstatSync(join(root,'home','skills')),/ENOENT/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
