import test from 'node:test';
import assert from 'node:assert/strict';
import {publishRoleProfiles,verifiedGenericRoleManifest} from '../scripts/publish-role-profiles.mjs';
import {roleInstructions} from '../bridge/team-roles.mjs';
import {renderRoleCapabilitiesMarkdown} from '../bridge/role-capabilities.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRoleInstructionStore} from '../bridge/role-instruction-store.mjs';
test('role publication uses Managed compare-and-save, adds capability notes and preserves replayed content',async()=>{
 const files=new Map([['backend-engineer/AGENTS.md',{content:'old role',revision:{id:'old-revision'}}]]),writes=[];
 const role={profile:{role:'backend-engineer',agentId:'agent'},manifest:{instructionsFilePath:'backend-engineer/AGENTS.md'}};
 const ports={readFile:async(_id,path)=>files.get(path)??null,writeFile:async input=>{writes.push(input);files.set(input.path,{content:input.content,revision:{id:'new-'+writes.length},contentHash:'hash-'+writes.length});}};
 const result=await publishRoleProfiles({roles:[role],...ports,baselineFiles:{'backend-engineer/AGENTS.md':'old role'},log(){}});
 assert.equal(result.roles,1);assert.equal(result.changedFiles,2);
 assert.equal(writes[0].path,'backend-engineer/CAPABILITIES.md');assert.equal(writes[0].baseHash,null);
 assert.equal(writes[1].baseRevisionId,'old-revision');
 assert.match(writes[1].content,/Backend Engineer/);assert.ok(!writes[1].content.includes('不合并或部署RWB'));
 assert.equal((await publishRoleProfiles({roles:[role],...ports,log(){}})).changedFiles,0);
});
test('owner edits are preserved before either role file is changed and are not marked generic',async()=>{
 const role={profile:{role:'qa',agentId:'agent'},manifest:{instructionsFilePath:'qa/AGENTS.md'}};const calls=[];
 const result=await publishRoleProfiles({roles:[role],baselineFiles:{'qa/AGENTS.md':'previous generated role'},
  readFile:async(_id,file)=>file.endsWith('/AGENTS.md')?{content:'Owner customized QA instructions',revision:{id:'current'}}:null,
  writeFile:async value=>calls.push(value),markGeneric:async()=>calls.push('generic'),log(){}});
 assert.equal(result.status,'custom_content_preserved');assert.deepEqual(result.preservedRoles,['qa']);assert.equal(result.changedFiles,0);assert.deepEqual(calls,[]);
});
test('a real save conflict stops publication without claiming remaining roles were updated',async()=>{
 const role={profile:{role:'qa',agentId:'agent'},manifest:{instructionsFilePath:'qa/AGENTS.md'}};
 await assert.rejects(publishRoleProfiles({roles:[role],readFile:async()=>null,writeFile:async()=>{throw Object.assign(Error('conflict'),{code:'ROLE_PROFILE_HTTP_409'});},log(){}}),error=>error.code==='ROLE_PROFILE_HTTP_409');
});
test('only a verified published bundle receives generic scope, which subsequent authenticated Native saves retain',async t=>{
 const sha=value=>createHash('sha256').update(value).digest('hex'),role='research';
 const manifest={schemaVersion:1,project:'personal',role,instructionsFilePath:role+'/AGENTS.md',requiredReferences:[],files:[
  {path:role+'/AGENTS.md',sha256:sha(roleInstructions(role))},{path:role+'/CAPABILITIES.md',sha256:sha(renderRoleCapabilitiesMarkdown(role))}]};
 const generic=verifiedGenericRoleManifest({manifest,role});assert.equal(generic.scope,'generic');assert.equal(manifest.scope,undefined);
 assert.throws(()=>verifiedGenericRoleManifest({manifest:{...manifest,files:[...manifest.files,{path:'private.md',sha256:'f'.repeat(64)}]},role}),/ROLE_PROFILE_GENERIC/);
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'published-generic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const materialRoot=root+'/instructions';fs.mkdirSync(materialRoot+'/'+role,{recursive:true,mode:0o700});
 fs.writeFileSync(materialRoot+'/'+role+'/AGENTS.md',roleInstructions(role),{mode:0o600});fs.writeFileSync(materialRoot+'/'+role+'/CAPABILITIES.md',renderRoleCapabilitiesMarkdown(role),{mode:0o600});
 const identity={companyId:'company',agentId:'agent'};let registry={companyId:identity.companyId,agents:[{profile:{agentId:identity.agentId,role},materialRoot,manifest:generic}],operations:[]};
 const store=createRoleInstructionStore({root,readRegistry:()=>structuredClone(registry),editRegistry:edit=>registry=edit(structuredClone(registry))});
 await store.withMutation(identity,async()=>fs.writeFileSync(materialRoot+'/'+role+'/AGENTS.md','Owner revised global role instructions'));
 assert.equal(registry.agents[0].manifest.scope,'generic');assert.equal(registry.agents[0].manifest.files.find(file=>file.path===role+'/AGENTS.md').sha256,sha('Owner revised global role instructions'));
 assert.equal(registry.materialHistory[0].manifest.scope,'generic');
});
