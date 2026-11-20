import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as runtime from '../bridge/native-role-runtime.mjs';
import {createProjectKnowledgeStore} from '../bridge/project-knowledge-store.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),log=()=>{};
const api=name=>{assert.equal(typeof runtime[name],'function',name+' is required');return runtime[name];};
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-role-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const companyId=randomUUID(),ownerId='owner-1',a=randomUUID(),b=randomUUID(),agentId=randomUUID();
 const cwd=id=>'/paperclip/instances/default/projects/'+companyId+'/'+id+'/_default';
 const manifest=(project,instructions='generic.md')=>({schemaVersion:1,project,role:'pm',instructionsFilePath:instructions,requiredReferences:[],files:[{path:instructions,sha256:'a'.repeat(64)}]});
 const role={profile:{projectId:a,projectKey:'alpha',agentId,role:'pm',engine:'codex_local',model:'gpt-6.1-sol'},manifest:manifest('alpha')};
 const registry={companyId,ownerId,team:{projectId:a,ids:{pm:agentId}},agents:[role],context:{schemaVersion:1,enabled:true,
  catalog:{schemaVersion:1,defaultProjectKey:'alpha',projects:[{key:'alpha',aliases:[],companyId,projectId:a,ownerId,adapterKey:'native-docs',allowedRoles:['pm'],maximumAction:'read_only',workspaceCwd:cwd(a)},
    {key:'beta',aliases:[],companyId,projectId:b,ownerId,adapterKey:'native-docs',allowedRoles:['pm'],maximumAction:'read_only',workspaceCwd:cwd(b)}]},
  materials:{[b]:{pm:manifest('beta','beta/instructions.md')}},legacyKnowledge:{}}};
 const task={id:randomUUID(),companyId,projectId:b,responsibleUserId:ownerId,title:'Report policy',description:'Find the confirmed report policy.'};
 const operation={taskId:task.id,projectId:b,projectKey:'beta',workspaceCwd:cwd(b),contextVersion:1};
 return{root,companyId,ownerId,a,b,agentId,cwd,role,registry,task,operation,manifest};
}
test('Native task project derives a per-run role and complete material manifest without mutating global Agent IDs',t=>{
 const f=fixture(t),before=structuredClone(f.registry);
 const result=api('resolveNativeRoleScope')({registry:f.registry,role:f.role,task:f.task,operation:f.operation,log});
 assert.equal(result.role.profile.agentId,f.agentId);assert.equal(result.role.profile.projectId,f.b);
 assert.equal(result.role.manifest.project,'beta');assert.equal(result.role.manifest.instructionsFilePath,'beta/instructions.md');
 assert.equal(result.workspaceCwd,f.cwd(f.b));assert.deepEqual(f.registry,before);
 assert.throws(()=>api('resolveNativeRoleScope')({...f,operation:{...f.operation,projectId:f.a},log}),/CONTEXT|NATIVE_ROLE/);
});
test('another project cannot implicitly inherit an old project-private manifest',t=>{
 const f=fixture(t);delete f.registry.context.materials[f.b];
 assert.throws(()=>api('resolveNativeRoleScope')({...f,log}),/NATIVE_ROLE_PROJECT_MATERIALS_REQUIRED/);
});
test('runtime knowledge reads only the Native-authorized partitions and marks legacy as historical',async t=>{
 const f=fixture(t);fs.mkdirSync(f.root+'/context',{mode:0o700});
 const scope={companyId:f.companyId,ownerId:f.ownerId,projectId:f.b,projectKey:'beta'};
 const writer=createProjectKnowledgeStore({root:f.root+'/context/knowledge',log,authorizeOwner:async()=>true,now:()=> '2026-11-20T01:00:00.000Z'});
 await writer.remember({scope,id:'report-policy',kind:'decision',visibility:'project',text:'Confirmed current policy',
  condition:'Until corrected',source:{messageId:'om_realfixture',chatId:'oc_fixture',bodySha256:'a'.repeat(64),createdAt:'2026-11-20T00:00:00.000Z'},operationId:randomUUID()});
 const sourceRoot=f.root+'/context/legacy';fs.mkdirSync(sourceRoot,{mode:0o700});
 const legacy={schemaVersion:1,records:[{id:'old-reference',project:'beta',visibility:'project',version:1,kind:'source',
  source:'historical:fixture',condition:'Reference only',text:'Legacy source without fresh owner confirmation'},
  {id:'report-policy',project:'beta',visibility:'project',version:99,kind:'decision',source:'historical:oldpolicy',condition:'Reference only',text:'Stale legacy policy'}]};
 fs.writeFileSync(sourceRoot+'/beta-pm.json',JSON.stringify(legacy),{mode:0o600});
 f.registry.context.legacyKnowledge[f.b]={pm:{path:sourceRoot+'/beta-pm.json',sha256:sha(fs.readFileSync(sourceRoot+'/beta-pm.json'))}};
 fs.writeFileSync(f.root+'/knowledge.json','MUST NOT PARSE GLOBAL KNOWLEDGE');
 const events=[],records=api('readNativeRoleKnowledge')({root:f.root,registry:f.registry,task:f.task,profile:{...f.role.profile,projectId:f.b,projectKey:'beta'},log:e=>events.push(e)});
 assert.equal(records.find(x=>x.id==='report-policy').confirmation.status,'owner-confirmed');
 assert.equal(records.find(x=>x.id==='report-policy').text,'Confirmed current policy');assert.equal(records.find(x=>x.id==='report-policy').version,1);
 assert.equal(records.find(x=>x.id==='old-reference').confirmation.status,'historical-reference');
 assert.equal(records.some(x=>x.project!=='beta'),false);
 assert.equal(JSON.stringify(events).includes('Confirmed current policy'),false);
 assert.ok(events.some(x=>x.code==='NATIVE_ROLE_KNOWLEDGE_LOADED'&&x.loaded.some(v=>v.id==='report-policy'&&/^[a-f0-9]{64}$/.test(v.sourceSha256))));
 f.registry.context.legacyKnowledge[f.b].pm.sha256='0'.repeat(64);
 assert.throws(()=>api('readNativeRoleKnowledge')({root:f.root,registry:f.registry,task:f.task,profile:{...f.role.profile,projectId:f.b,projectKey:'beta'},log}),/NATIVE_ROLE_LEGACY/);
});
test('only an explicitly generic old manifest may be reused across projects',t=>{
 const f=fixture(t);delete f.registry.context.materials[f.b];f.role.manifest.scope='generic';
 const result=api('resolveNativeRoleScope')({...f,log});assert.equal(result.role.manifest.project,'beta');
 assert.equal(result.role.manifest.files[0].sha256,f.role.manifest.files[0].sha256);
});
test('the provider start guard uses the same Native transaction and rejects pending input before a slot',async t=>{
 const f=fixture(t),binding={companyId:f.companyId,ownerId:f.ownerId,projectId:f.b,taskId:f.task.id,runId:randomUUID(),agentId:f.agentId,inputRevision:runtimeTaskRevision(f.task)};
 const operation={...f.operation,rootTaskId:f.task.id,phase:'plan',inputRevision:binding.inputRevision};
 const rootTask={...f.task,status:'in_progress',assigneeAgentId:f.agentId},run={id:binding.runId,companyId:f.companyId,issueId:f.task.id,agentId:f.agentId,responsibleUserId:f.ownerId,status:'running'};
 const tx={marker:'same-locked-root'},observed=[];let slots=0,provider=0;
 const contextRuntime={syncTask:async input=>{observed.push(input.transaction.db);return{task:rootTask,control:{managed:true,pauseRequested:true,inputRevision:binding.inputRevision}};}};
 const enter=async()=>{await api('assertNativeRoleStart')({registry:f.registry,binding,operation,task:rootTask,rootTask,run,transaction:{db:tx},contextRuntime,log});slots++;provider++;};
 await assert.rejects(enter(),/NATIVE_ROLE_START_CONTROL_DENIED/);assert.deepEqual(observed,[tx]);assert.equal(slots,0);assert.equal(provider,0);
 const safe={syncTask:async input=>({task:rootTask,control:{managed:true,pauseRequested:false,inputRevision:binding.inputRevision}})};
 await api('assertNativeRoleStart')({registry:f.registry,binding,operation,task:rootTask,rootTask,run,transaction:{db:tx},contextRuntime:safe,log});
 await assert.rejects(api('assertNativeRoleStart')({registry:f.registry,binding,operation,task:{...rootTask,description:'new input'},rootTask,run,transaction:{db:tx},contextRuntime:safe,log}),/NATIVE_ROLE_START/);
 await assert.rejects(api('assertNativeRoleStart')({registry:f.registry,binding:{...binding,projectWorkspaceId:randomUUID()},operation,task:rootTask,rootTask,run,transaction:{db:tx},contextRuntime:safe,log}),/NATIVE_ROLE_START_BINDING_DENIED/);
 const reparented={...rootTask,parentId:randomUUID()};
 await assert.rejects(api('assertNativeRoleStart')({registry:f.registry,binding,operation,task:reparented,rootTask:reparented,run,transaction:{db:tx},contextRuntime:safe,log}),/NATIVE_ROLE_START_BINDING_DENIED/);
});
function runtimeTaskRevision(task){return createHash('sha256').update(JSON.stringify({title:task.title??'',description:task.description??''})).digest('hex');}
test('a confirmed current identity excluded by the top-32 query never falls back to its stale legacy value',async t=>{
 const f=fixture(t);fs.mkdirSync(f.root+'/context',{mode:0o700});
 const scope={companyId:f.companyId,ownerId:f.ownerId,projectId:f.b,projectKey:'beta'};
 const store=createProjectKnowledgeStore({root:f.root+'/context/knowledge',log,authorizeOwner:async()=>true,now:()=> '2026-11-20T01:00:00.000Z'});
 const source=n=>({messageId:'om_fixture'+n,chatId:'oc_fixture',bodySha256:'a'.repeat(64),createdAt:'2026-11-20T00:00:00.000Z'});
 const entry={scope,id:'report-policy',kind:'decision',visibility:'project',text:'Old confirmed policy',condition:'Until corrected',source:source('target'),operationId:randomUUID()};
 await store.remember(entry);await store.correct({scope,id:entry.id,visibility:'project',text:'Current confirmed version two',condition:entry.condition,expectedVersion:1,source:source('corrected'),operationId:randomUUID()});
 for(let n=0;n<32;n++)await store.remember({...entry,id:'match-'+String(n).padStart(2,'0'),text:'rankingterm',source:source(n),operationId:randomUUID()});
 f.task.title='rankingterm';f.task.description='rankingterm';
 assert.equal(store.query({scope,role:'pm',query:'rankingterm',limit:32}).some(record=>record.id===entry.id),false);
 fs.mkdirSync(f.root+'/context/legacy',{mode:0o700});
 const legacy={schemaVersion:1,records:[{id:entry.id,project:'beta',visibility:'project',version:99,kind:'decision',source:'historical:obsolete',condition:'Reference',text:'Stale rankingterm legacy'}]};
 const filename=f.root+'/context/legacy/beta-pm.json';fs.writeFileSync(filename,JSON.stringify(legacy),{mode:0o600});
 f.registry.context.legacyKnowledge[f.b]={pm:{path:filename,sha256:sha(fs.readFileSync(filename))}};
 const records=api('readNativeRoleKnowledge')({root:f.root,registry:f.registry,task:f.task,profile:{...f.role.profile,projectId:f.b,projectKey:'beta'},log});
 assert.equal(records.some(record=>record.id===entry.id),false);assert.equal(records.length,32);
});

