import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../bridge/role-control-store.mjs';
import {resolveCompanyRoleSkills} from '../bridge/company-role-skills.mjs';
import {ROLE_PERMIT_MAX_BYTES,ROLE_COMPANY_SKILL_SNAPSHOT_MAX_BYTES,assertRolePermitSize} from '../bridge/role-permit-contract.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-permit-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function legalLargePermit(){
 const skill={id:'document-skill',key:'document-skill',companyId:'company',name:'large-document-guide',slug:'large-document-guide',sourceType:'github',sourceLocator:'https://github.com/example/document-skills',currentVersionId:'version'};
 const version={id:'version',companyId:'company',companySkillId:skill.id,fileInventory:[{path:'SKILL.md',content:'# Document guide\n'+'x'.repeat(4371200)}]};
 const result=resolveCompanyRoleSkills({agent:{companyId:'company',adapterConfig:{paperclipSkillSync:{desiredSkills:[skill.key]}}},companySkills:[skill],companySkillVersions:[version]});
 return {schemaVersion:1,role:'document-specialist',runId:'run',taskId:'task',cwd:'/task-workspace',effectiveCapabilities:{companySkillSnapshot:result.companySkillSnapshot}};
}

test('a legal pinned company skill snapshot above 4 MiB remains readable as the original role permit',{skip:process.getuid()!==0},t=>{
 const root=fixture(t),permit=legalLargePermit(),file=root+'/permit.json',bytes=JSON.stringify(permit)+'\n';
 assert.ok(Buffer.byteLength(bytes)>4*1024*1024);fs.writeFileSync(file,bytes,{mode:0o600});
 assert.throws(()=>store.readControl(file),/TEAM_CONTROL_FILE_DENIED/);
 assert.equal(assertRolePermitSize(permit),permit);assert.deepEqual(store.readRolePermit(file),permit);
});

test('the permit producer and reader share the exact serialized UTF-8 boundary while ordinary controls stay bounded',{skip:process.getuid()!==0},t=>{
 const root=fixture(t),file=root+'/permit.json',overhead=Buffer.byteLength(JSON.stringify({schemaVersion:1,padding:''})+'\n');
 const permit={schemaVersion:1,padding:'x'.repeat(ROLE_PERMIT_MAX_BYTES-overhead)};
 assert.equal(Buffer.byteLength(JSON.stringify(permit)+'\n'),ROLE_PERMIT_MAX_BYTES);assert.equal(assertRolePermitSize(permit),permit);
 fs.writeFileSync(file,JSON.stringify(permit)+'\n',{mode:0o600});assert.equal(store.readRolePermitBytes(file).length,ROLE_PERMIT_MAX_BYTES);
 assert.throws(()=>store.readControl(file),/TEAM_CONTROL_FILE_DENIED/);
 permit.padding+='文';assert.throws(()=>assertRolePermitSize(permit),{code:'NATIVE_ROLE_PERMIT_TOO_LARGE'});
 fs.writeFileSync(file,JSON.stringify(permit)+'\n');assert.throws(()=>store.readRolePermit(file),/TEAM_CONTROL_FILE_DENIED/);
});

test('typed permits retain owner, private mode, regular file, symlink and hardlink restrictions',{skip:process.getuid()!==0},t=>{
 const root=fixture(t),file=root+'/permit.json';fs.writeFileSync(file,'{"schemaVersion":1}',{mode:0o600});
 assert.equal(store.readRolePermit(file).schemaVersion,1);
 fs.chmodSync(file,0o644);assert.throws(()=>store.readRolePermit(file),/TEAM_CONTROL_FILE_DENIED/);fs.chmodSync(file,0o600);
 fs.symlinkSync(file,root+'/symlink');assert.throws(()=>store.readRolePermit(root+'/symlink'),/TEAM_CONTROL_FILE_DENIED/);
 fs.linkSync(file,root+'/hardlink');assert.throws(()=>store.readRolePermit(file),/TEAM_CONTROL_FILE_DENIED/);fs.unlinkSync(root+'/hardlink');
 assert.throws(()=>store.readRolePermit(root),/TEAM_CONTROL_FILE_DENIED/);
 fs.chownSync(file,1,1);assert.throws(()=>store.readRolePermit(file),/TEAM_CONTROL_FILE_DENIED/);fs.chownSync(file,0,0);
});

test('company skill producers still reject snapshots above their original 8 MiB limit',()=>{
 assert.equal(ROLE_COMPANY_SKILL_SNAPSHOT_MAX_BYTES,8*1024*1024);
 const skill={id:'large',key:'large',companyId:'company',name:'oversize-guide',slug:'oversize-guide',currentVersionId:'version'};
 assert.throws(()=>resolveCompanyRoleSkills({agent:{companyId:'company',adapterConfig:{paperclipSkillSync:{desiredSkills:['large']}}},companySkills:[skill],
  companySkillVersions:[{id:'version',companyId:'company',companySkillId:skill.id,fileInventory:[{path:'SKILL.md',content:'x'.repeat(ROLE_COMPANY_SKILL_SNAPSHOT_MAX_BYTES)}]}]}),{code:'COMPANY_ROLE_SKILL_SNAPSHOT_TOO_LARGE'});
});
