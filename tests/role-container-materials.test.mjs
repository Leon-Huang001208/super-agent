import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as transport from '../scripts/role-container-transport.mjs';
import {createRoleMaterialSnapshot} from '../bridge/role-material-snapshot.mjs';

test('host transport import never starts a host execution or changes the importing process result',()=>{
 const target=new URL('../scripts/role-container-transport.mjs',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(target)+'); console.log("import-safe");'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'import-safe');
});
test('the Native prepared instruction copy and project overlay are independent read-only snapshots outside HOME',t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-native-projection-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const client=root+'/client',nativeRoot=root+'/native',materials=root+'/materials';for(const directory of[client,nativeRoot,materials])fs.mkdirSync(directory,{mode:0o700});
 fs.mkdirSync(nativeRoot+'/pm',{mode:0o700});fs.writeFileSync(nativeRoot+'/pm/AGENTS.md','Owner edited generic instructions',{mode:0o600});
 fs.writeFileSync(nativeRoot+'/other-project.md','PRIVATE',{mode:0o600});fs.writeFileSync(materials+'/project.md','Registered project reference',{mode:0o600});
 const sha=text=>createHash('sha256').update(text).digest('hex'),binding={companyId:randomUUID(),ownerId:'owner',projectId:randomUUID(),runId:randomUUID(),agentId:randomUUID()};
 const nativePrefix='/paperclip/instances/default/companies/'+binding.companyId+'/agents/'+binding.agentId;
 const nativeInstructions={materialRoot:nativePrefix+'/file-sync/runs/'+binding.runId+'/live',materialSourcePath:nativePrefix+'/instructions/pm/AGENTS.md',
  instructionsFilePath:nativePrefix+'/file-sync/runs/'+binding.runId+'/live/pm/AGENTS.md',materialSha256:sha('Owner edited generic instructions'),
  materialFiles:[{path:'pm/AGENTS.md',sha256:sha('Owner edited generic instructions')}]};
 const manifest={schemaVersion:1,project:'beta',role:'pm',instructionsFilePath:'project.md',requiredReferences:[],files:[{path:'project.md',sha256:sha('Registered project reference')}]};
 const permit={...binding,role:'pm',cwd:'/paperclip/instances/default/projects/'+binding.companyId+'/'+binding.projectId+'/_default',...nativeInstructions,
  materialSnapshot:createRoleMaterialSnapshot({binding,profile:{role:'pm',projectKey:'beta'},manifest,nativeInstructions})};
 const input={permit,clientRoot:client,log(){}};
 const overlay=transport.createRoleMaterialProjection({...input,materialRoot:materials,snapshotRoot:root+'/project-snapshot'});
 const instructions=transport.createRoleMaterialProjection({...input,kind:'native-instructions',materialRoot:nativeRoot,snapshotRoot:root+'/native-snapshot'});
 assert.equal(instructions.target,nativeInstructions.materialRoot);assert.equal(overlay.target,'/paperclip/control/research-pm/materials');
 assert.equal(fs.readFileSync(instructions.source+'/pm/AGENTS.md','utf8'),'Owner edited generic instructions');
 assert.equal(fs.existsSync(instructions.source+'/other-project.md'),false);assert.equal(fs.statSync(instructions.source).mode&0o222,0);
 assert.throws(()=>transport.createRoleMaterialProjection({...input,kind:'native-instructions',materialRoot:nativeRoot,snapshotRoot:client+'/native'}),/ALIAS/);
});
test('a per-run material projection contains only selected bytes and has no writable HOME alias',t=>{
 assert.equal(typeof transport.createRoleMaterialProjection,'function');
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-projection-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const materials=root+'/source',client=root+'/client';fs.mkdirSync(materials,{mode:0o700});fs.mkdirSync(client,{mode:0o700});
 fs.mkdirSync(materials+'/beta',{mode:0o700});fs.writeFileSync(materials+'/beta/instructions.md','Generic role',{mode:0o600});
 fs.writeFileSync(materials+'/beta/shared.md','Authorized project B',{mode:0o600});fs.writeFileSync(materials+'/other-project-private.md','DO NOT PROJECT',{mode:0o600});
 const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const binding={companyId:randomUUID(),ownerId:'owner',projectId:randomUUID(),runId:randomUUID()},profile={role:'pm',projectKey:'beta'};
 const manifest={schemaVersion:1,project:'beta',role:'pm',instructionsFilePath:'beta/instructions.md',requiredReferences:['beta/shared.md'],
  files:['beta/instructions.md','beta/shared.md'].map(file=>({path:file,sha256:hash(materials+'/'+file)}))};
 const permit={...binding,role:'pm',cwd:'/paperclip/instances/default/projects/'+binding.companyId+'/'+binding.projectId+'/_default',
  instructionsFilePath:'/paperclip/control/research-pm/materials/beta/instructions.md',materialSha256:manifest.files[0].sha256,
  materialSnapshot:createRoleMaterialSnapshot({binding,profile,manifest})};
 const input={permit,materialRoot:materials,snapshotRoot:root+'/material-snapshot',clientRoot:client,log(){}};
 const selected=transport.createRoleMaterialProjection(input);
 assert.equal(selected.target,'/paperclip/control/research-pm/materials');assert.equal(selected.readOnly,true);
 assert.equal(fs.readFileSync(selected.source+'/beta/shared.md','utf8'),'Authorized project B');
 assert.equal(fs.existsSync(selected.source+'/other-project-private.md'),false);
 assert.equal(fs.statSync(selected.source+'/beta/shared.md').mode&0o222,0);assert.equal(fs.statSync(selected.source).mode&0o222,0);
 assert.throws(()=>transport.createRoleMaterialProjection({...input,snapshotRoot:client+'/materials'}),/ROLE_CONTAINER_MATERIAL/);
 fs.writeFileSync(materials+'/beta/shared.md','changed',{mode:0o600});
 assert.throws(()=>transport.createRoleMaterialProjection({...input,resumeSetup:true}),/ROLE_MATERIAL|ROLE_CONTAINER_MATERIAL/);
 assert.equal(fs.readFileSync(selected.source+'/beta/shared.md','utf8'),'Authorized project B');
});
