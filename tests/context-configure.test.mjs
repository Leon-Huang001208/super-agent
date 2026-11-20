import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {configureContext,parseContextConfigureArgs} from '../scripts/context-configure.mjs';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const copy=x=>structuredClone(x);
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'context-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const companyId=randomUUID(),ownerId='owner',personal=randomUUID(),rwb=randomUUID(),ids=Object.fromEntries(ROLE_KEYS.map(role=>[role,randomUUID()]));
 const roleBundles={},publicRoles={},agents=[],entries=[];
 for(const role of ROLE_KEYS){const instructions='Public instructions for '+role,capabilities='Public capabilities for '+role;
  publicRoles[role]={instructions,capabilities};const files=[{path:role+'/AGENTS.md',contentBase64:Buffer.from(instructions).toString('base64'),sha256:sha(instructions)},
   {path:role+'/CAPABILITIES.md',contentBase64:Buffer.from(capabilities).toString('base64'),sha256:sha(capabilities)}];
  const manifest={schemaVersion:1,project:'personal-automation-m1',role,instructionsFilePath:role+'/AGENTS.md',requiredReferences:[],files:files.map(({path,sha256})=>({path,sha256}))};
  roleBundles[role]={files,manifest};entries.push({profile:{projectId:personal,projectKey:'personal-automation-m1',agentId:ids[role],role,model:'preserved-model'},materialRoot:root+'/native/'+ids[role],manifest});
  agents.push({id:ids[role],companyId,adapterConfig:{model:'native-current-model',custom:true}});
 }
 const registry={schemaVersion:1,companyId,ownerId,projectId:personal,team:{ids,enabled:false,projectId:personal},agents:entries,operations:[{id:randomUUID(),kept:true}]};
 fs.writeFileSync(root+'/registry.json',JSON.stringify(registry)+'\n',{mode:0o600});
 const records=[{project:'personal-automation-m1',id:'owner-choice',version:1,kind:'decision',visibility:'project',source:'historical:owner-chat',condition:'historical reference',text:'Personal project historical material'},
  {project:'personal-automation-m1',id:'pm-private',version:1,kind:'experience',visibility:'private',role:'pm',source:'historical:run',condition:'only PM',text:'Personal private PM text'}];
 const legacyBytes=JSON.stringify({schemaVersion:1,records})+'\n';fs.writeFileSync(root+'/knowledge.json',legacyBytes,{mode:0o600});
 const pmNames=['README.md','SKILL.md','agents/openai.yaml','references/finance.md','references/modes.md','references/templates.md'];
 const pmAssets={files:pmNames.map(name=>{const text='Public PM fixture '+name;return{path:name,sha256:sha(text),contentBase64:Buffer.from(text).toString('base64')};})};
 const source={roleBundles,publicRoles,pmAssets,legacyKnowledge:{records,sha256:sha(legacyBytes)}};
 const primary={id:randomUUID(),projectId:rwb,cwd:'/workspaces/rwb-pilot',name:'Old primary',isPrimary:true,sourceType:'local_path',metadata:{unchanged:true}};
 const projects=[{id:personal,companyId,name:'Personal Automation M1',workspaces:[]},{id:rwb,companyId,name:'ResearchWorkbench',description:'Existing real project',workspaces:[copy(primary)]}];
 let calls=0,committedError=false,busy=false,writes=0;const logs=[];
 const native={readProjects:async ids=>copy(projects.filter(project=>ids.includes(project.id))),readAgents:async()=>copy(agents),executionState:async()=>({active:busy?[{id:randomUUID()}]:[],environmentLeases:[]}),
  createWorkspace:async(projectId,input)=>{calls++;const p=projects.find(v=>v.id===projectId),row={...copy(input),id:randomUUID(),projectId,isPrimary:p.workspaces.length===0?true:input.isPrimary};p.workspaces.push(row);if(committedError)throw Error('lost create response');return copy(row);}};
 const request={schemaVersion:1,operationId:randomUUID(),defaultProjectKey:'personal-automation-m1',projects:[
  {key:'personal-automation-m1',projectId:personal,aliases:['个人','personal'],maximumAction:'read_only'},
  {key:'research-workbench',projectId:rwb,aliases:['rwb'],maximumAction:'read_only'}]};
 const editRegistry=fn=>{writes++;const value=JSON.parse(fs.readFileSync(root+'/registry.json','utf8')),next=fn(value);fs.writeFileSync(root+'/registry.json',JSON.stringify(next)+'\n',{mode:0o600});return next;};
 const run=(extra={})=>configureContext({root,request,source,native,editRegistry,log:e=>logs.push(e),...extra});
 return{root,registry,source,projects,primary,agents,request,logs,run,calls:()=>calls,writes:()=>writes,setBusy:v=>{busy=v;},setCommitError:v=>{committedError=v;}};
}
function tree(root){return fs.readdirSync(root,{recursive:true}).filter(name=>fs.lstatSync(path.join(root,name)).isFile()).sort().map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]);}

test('configuration preview performs no writes or Native mutations and produces stable desired configuration identity',async t=>{
 const f=fixture(t),before=tree(f.root),first=await f.run(),again=await f.run();
 assert.equal(first.mode,'preview');assert.equal(first.configurationHash,again.configurationHash);assert.deepEqual(tree(f.root),before);
 assert.equal(f.calls(),0);assert.equal(f.writes(),0);assert.equal(first.projects.find(p=>p.projectId===f.registry.projectId).workspaceAction,'implicit');
 assert.equal(first.projects.find(p=>p.key==='research-workbench').workspaceAction,'create');assert.equal(JSON.stringify(f.logs).includes('Personal private PM text'),false);
});

test('configuration apply creates only a nonprimary workspace and preserves existing Native agents and old primary',async t=>{
 const f=fixture(t),beforeAgents=copy(f.agents),result=await f.run({apply:true}),r=JSON.parse(fs.readFileSync(f.root+'/registry.json'));
 assert.equal(result.status,'complete');assert.equal(f.calls(),1);assert.equal(f.projects[0].workspaces.length,0);
 const rwb=f.projects[1],created=rwb.workspaces.find(w=>w.id!==f.primary.id);assert.deepEqual(rwb.workspaces[0],f.primary);assert.equal(created.isPrimary,false);
 assert.equal(created.metadata.superAgentProject.delivery.maximumAction,'artifact');assert.equal(created.metadata.superAgentProject.key,'research-workbench');
 assert.equal(r.context.catalog.projects.find(p=>p.key==='research-workbench').projectWorkspaceId,created.id);
 assert.deepEqual(f.agents,beforeAgents);assert.deepEqual(r.agents.map(e=>e.profile),f.registry.agents.map(e=>e.profile));
 assert.ok(r.agents.every(e=>e.manifest.scope==='generic'));assert.deepEqual(r.operations,f.registry.operations);
 assert.equal((await f.run({apply:true})).reused,true);assert.equal(f.calls(),1);assert.equal(f.writes(),1);
});

test('materials include PM six public files and never carry personal private content into the second project',async t=>{
 const f=fixture(t);await f.run({apply:true});const r=JSON.parse(fs.readFileSync(f.root+'/registry.json'));
 const projectId=f.projects[1].id,manifest=r.context.materials[projectId].pm;
 assert.equal(manifest.scope,'generic');assert.equal(manifest.requiredReferences.filter(name=>name.includes('/product-manager-coach/')).length,6);
 const texts=manifest.files.map(file=>fs.readFileSync(f.root+'/materials/'+file.path,'utf8')).join('\n');
 assert.ok(texts.includes('ResearchWorkbench'));assert.equal(texts.includes('Personal private PM text'),false);
 assert.equal(fs.readFileSync(f.root+'/knowledge.json','utf8').includes('Personal private PM text'),true);
 const legacy=JSON.parse(fs.readFileSync(r.context.legacyKnowledge[projectId].pm.path));assert.deepEqual(legacy.records,[]);assert.equal(legacy.provenance.ownerConfirmed,false);
 const personal=r.context.legacyKnowledge[f.registry.projectId];assert.equal(JSON.parse(fs.readFileSync(personal.research.path)).records.some(v=>v.id==='pm-private'),false);
 assert.equal(JSON.parse(fs.readFileSync(personal.pm.path)).records.some(v=>v.id==='pm-private'),true);
 assert.equal(fs.existsSync(f.root+'/context/knowledge'),false);
});

test('unclassified private role additions are rejected before any apply mutation',async t=>{
 const f=fixture(t),text='Unknown private role facts';const extra={path:'pm/PRIVATE.md',sha256:sha(text),contentBase64:Buffer.from(text).toString('base64')};
 f.source.roleBundles.pm.files.push(extra);f.registry.agents.find(e=>e.profile.role==='pm').manifest.files.push({path:extra.path,sha256:extra.sha256});
 fs.writeFileSync(f.root+'/registry.json',JSON.stringify(f.registry));
 await assert.rejects(f.run({apply:true}),{code:'CONTEXT_CONFIG_ROLE_NOT_PUBLIC'});assert.equal(f.calls(),0);assert.equal(f.writes(),0);
});

test('a committed workspace with a lost response is reconciled on the same operation, never created twice',async t=>{
 const f=fixture(t);f.setCommitError(true);
 await assert.rejects(f.run({apply:true}),{code:'CONTEXT_CONFIG_WORKSPACE_RECONCILIATION_REQUIRED'});assert.equal(f.calls(),1);assert.equal(f.writes(),0);
 f.setCommitError(false);const result=await f.run({apply:true});assert.equal(result.status,'complete');assert.equal(f.calls(),1);
});

test('active executions block apply without changing the registry or creating a workspace',async t=>{
 const f=fixture(t),before=tree(f.root);f.setBusy(true);const preview=await f.run();assert.equal(preview.canApply,false);assert.deepEqual(tree(f.root),before);
 await assert.rejects(f.run({apply:true}),{code:'CONTEXT_CONFIG_EXECUTION_BUSY'});assert.equal(f.calls(),0);assert.equal(f.writes(),0);
});

test('a nonpersonal project without a primary cannot silently turn the M2 workspace into its first primary',async t=>{
 const f=fixture(t);f.projects[1].workspaces=[];
 await assert.rejects(f.run({apply:true}),{code:'CONTEXT_CONFIG_NONPRIMARY_UNAVAILABLE'});assert.equal(f.calls(),0);
});

test('configuration rejects project/company overrides, missing PM assets and operation drift',async t=>{
 const f=fixture(t);await assert.rejects(f.run({request:{...f.request,ownerId:'other'}}),{code:'CONTEXT_CONFIG_REQUEST_INVALID'});
 const original=f.projects[1].companyId;f.projects[1].companyId=randomUUID();await assert.rejects(f.run(),{code:'CONTEXT_CONFIG_PROJECT_SCOPE_DENIED'});f.projects[1].companyId=original;
 f.source.pmAssets.files.pop();await assert.rejects(f.run(),{code:'CONTEXT_CONFIG_PM_ASSETS_INVALID'});
 assert.equal(parseContextConfigureArgs(['--request','/paperclip/control/research-pm/request.json']).apply,false);
 assert.equal(parseContextConfigureArgs(['--apply','--request','/paperclip/control/research-pm/request.json']).apply,true);
 assert.throws(()=>parseContextConfigureArgs(['--apply']),{code:'CONTEXT_CONFIG_CLI_INVALID'});
});

test('invalid normalized aliases and a personal key incompatible with the existing role profiles fail before apply',async t=>{
 const f=fixture(t),request=copy(f.request);request.projects[1].aliases=['PERSONAL'];
 await assert.rejects(f.run({request,apply:true}),{code:'CONTEXT_CONFIG_CATALOG_INVALID'});
 const renamed=copy(f.request);renamed.defaultProjectKey='renamed';renamed.projects[0].key='renamed';
 await assert.rejects(f.run({request:renamed,apply:true}),{code:'CONTEXT_CONFIG_PERSONAL_KEY_CHANGED'});
 assert.equal(f.calls(),0);assert.equal(f.writes(),0);
});
