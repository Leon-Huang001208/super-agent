import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as runtime from '../bridge/native-role-runtime.mjs';
import {createProjectKnowledgeStore} from '../bridge/project-knowledge-store.mjs';
import {roleInstructions} from '../bridge/team-roles.mjs';
import {renderRoleCapabilitiesMarkdown} from '../bridge/role-capabilities.mjs';
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
test('enabling M2 does not capture a portable Native operation outside its dedicated catalog workspace',t=>{
 const f=fixture(t),third={...f.task,projectId:randomUUID(),projectWorkspaceId:randomUUID()};
 const legacy=api('resolveNativeRoleScope')({...f,task:third,operation:{taskId:third.id,projectId:third.projectId},log});
 assert.equal(legacy.contextVersion,undefined);assert.equal(legacy.registry.context.enabled,false);
 assert.equal(legacy.role.profile.agentId,f.agentId);
 assert.throws(()=>api('resolveNativeRoleScope')({...f,task:third,operation:{...f.operation,taskId:third.id},log}),/CONTEXT|NATIVE_ROLE/);
 assert.throws(()=>api('resolveNativeRoleScope')({...f,task:third,operation:{taskId:third.id,projectId:third.projectId,workspaceCwd:f.cwd(third.projectId)},log}),/CONTEXT|NATIVE_ROLE/);
});
test('a bundled generic overlay is verified against this source and never requires the old private primary or references',t=>{
 const f=fixture(t),primary=sha(roleInstructions('pm')),caps=sha(renderRoleCapabilitiesMarkdown('pm'));
 f.role.manifest.requiredReferences=['private-personal.md'];f.role.manifest.files.push({path:'private-personal.md',sha256:'f'.repeat(64)});
 const overlay=f.registry.context.materials[f.b].pm;
 overlay.scope='generic';overlay.files[0].sha256=primary;overlay.files.push({path:'beta/CAPABILITIES.md',sha256:caps});overlay.requiredReferences=['beta/CAPABILITIES.md'];
 overlay.publicSource={kind:'bundled-role-template',role:'pm',instructionsSha256:primary,capabilitiesSha256:caps};
 assert.equal(api('resolveNativeRoleScope')({...f,log}).role.manifest.files.some(file=>file.path==='private-personal.md'),false);
 overlay.publicSource.instructionsSha256='0'.repeat(64);
 assert.throws(()=>api('resolveNativeRoleScope')({...f,log}),/NATIVE_ROLE_GENERIC/);
});
test('a native-registered generic overlay retains its source proof after an owner edits the current global instructions',t=>{
 const f=fixture(t);f.role.manifest.scope='generic';f.role.manifest.files.push({path:'CAPABILITIES.md',sha256:'b'.repeat(64)});
 const original=structuredClone(f.role.manifest),overlay=f.registry.context.materials[f.b].pm;
 overlay.scope='generic';overlay.files.push({path:'beta/CAPABILITIES.md',sha256:'b'.repeat(64)},{path:'beta/PROJECT.md',sha256:'c'.repeat(64)});
 const assets=JSON.parse(fs.readFileSync(new URL('../assets/product-manager-coach.manifest.json',import.meta.url))).files;
 for(const asset of assets)overlay.files.push({path:'beta/pm-skill/'+asset.path,sha256:asset.sha256});
 overlay.publicSource={kind:'native-registered-generic',role:'pm',agentId:f.agentId,sourceManifestSha256:sha(JSON.stringify(original)),instructionsSha256:'a'.repeat(64)};
 f.registry.materialHistory=[{agentId:f.agentId,manifest:original}];f.role.manifest.files[0].sha256=sha('New owner instructions');
 assert.equal(api('resolveNativeRoleScope')({...f,log}).role.manifest.publicSource.sourceManifestSha256,sha(JSON.stringify(original)));
 overlay.publicSource.agentId=randomUUID();assert.throws(()=>api('resolveNativeRoleScope')({...f,log}),/NATIVE_ROLE_GENERIC_SOURCE_CHANGED/);
});
test('the M2 read-only catalog ceiling removes host write paths, actions and unproven write MCP despite Native delivery metadata',t=>{
 const f=fixture(t),original={schemaVersion:1,id:f.b,key:'beta',repository:{hostPath:'/source/private',url:'https://example.com/repo'},
  workspace:{hostPath:'/task/worktree'},checks:[{id:'write-test'}],delivery:{maximumAction:'deploy',commands:{deploy:{argv:['deploy']}}},
  hostActions:[{id:'mutate-host'}],hostMcpServers:[{id:'service',tools:['write']}],rules:[],services:{},stack:[]};
 const before=structuredClone(original),result=api('restrictNativeRoleAuthority')({registry:f.registry,task:f.task,projectContext:original,authorizedHostActions:['mutate-host'],
  effectiveCapabilities:{hostAllowedTools:['host.project_inspect','host.project_git','host.project_check','host.project_publish','host.network_observe','host.network_apply','host.mcp_call'],mcpAllowedTools:['read','write']},toolCatalog:[{name:'read',annotations:{readOnlyHint:true}},{name:'write'}],log});
 assert.equal(result.projectContext.delivery.maximumAction,'artifact');assert.equal(result.projectContext.repository.hostPath,null);
 assert.equal(result.projectContext.workspace.hostPath,null);assert.deepEqual(result.authorizedHostActions,[]);
 assert.deepEqual(result.projectContext.hostActions,[]);assert.deepEqual(result.projectContext.hostMcpServers,[]);
 assert.deepEqual(result.effectiveCapabilities.hostAllowedTools,['host.project_inspect','host.network_observe']);
 assert.deepEqual(result.effectiveCapabilities.mcpAllowedTools,['read']);assert.deepEqual(original,before);
});
test('M2 retains the latest Native prepared generic primary and keeps the project overlay separate',t=>{
 const f=fixture(t),runId=randomUUID(),prefix='/paperclip/instances/default/companies/'+f.companyId+'/agents/'+f.agentId;
 const root=prefix+'/instructions',live=prefix+'/file-sync/runs/'+runId+'/live',identity={companyId:f.companyId,ownerId:f.ownerId,agentId:f.agentId,runId};
 const nativeRole={...f.role,materialRoot:root,manifest:{schemaVersion:1,scope:'generic',project:'alpha',role:'pm',instructionsFilePath:'pm/AGENTS.md',
  requiredReferences:[],files:[{path:'pm/AGENTS.md',sha256:sha('Actual owner-edited instructions')} ]}};
 const workingCopy={...identity,responsibleUserId:f.ownerId,entryFile:'pm/AGENTS.md',state:'prepared',location:'local',localRoot:live,executionRoot:live};
 const baseline={entries:new Map([['pm/AGENTS.md',{kind:'file',hash:sha('Actual owner-edited instructions')} ]])};
 f.registry.context.materials[f.b].pm.files.push({path:'beta/PROJECT.md',sha256:sha('Project B facts')});f.registry.context.materials[f.b].pm.requiredReferences=['beta/PROJECT.md'];
 const result=api('resolveNativeRoleExecutionMaterials')({role:nativeRole,contextRole:{...f.role,profile:{...f.role.profile,projectId:f.b},manifest:f.registry.context.materials[f.b].pm},
  contextVersion:1,identity,workingCopy,baseline,executionPath:live+'/pm/AGENTS.md',history:[]});
 assert.equal(result.materialRoot,live);assert.equal(result.manifest.files[0].sha256,sha('Actual owner-edited instructions'));
 assert.equal(result.projectMaterials.manifest.project,'beta');assert.equal(result.sourceInstructionsFilePath,root+'/pm/AGENTS.md');
 assert.equal(result.projectMaterials.manifest.files.some(file=>file.path==='beta/instructions.md'),false);
 assert.equal(result.projectMaterials.manifest.instructionsFilePath,'beta/PROJECT.md');
 delete nativeRole.manifest.scope;
 assert.throws(()=>api('resolveNativeRoleExecutionMaterials')({role:nativeRole,contextRole:{...f.role,profile:{...f.role.profile,projectId:f.b}},contextVersion:1,identity,workingCopy,baseline,executionPath:live+'/pm/AGENTS.md'}),/NATIVE_ROLE_GENERIC/);
});
test('read-only Native projects retain only the registered GitHub reader without a code path or publication authority',t=>{
 const f=fixture(t),context={id:f.b,key:'beta',repository:{hostPath:'/source',fullName:'owner/repo',url:'https://github.com/owner/repo'},workspace:{hostPath:'/worktree'},delivery:{maximumAction:'pull_request'},rules:[],checks:[]};
 const result=api('restrictNativeRoleAuthority')({registry:f.registry,task:f.task,projectContext:context,
  effectiveCapabilities:{hostAllowedTools:['host.github_read','host.project_git','host.project_publish'],mcpAllowedTools:[]},log});
 assert.equal(result.projectContext.repository.fullName,'owner/repo');assert.equal(result.projectContext.repository.hostPath,null);
 assert.equal(result.projectContext.delivery.maximumAction,'artifact');assert.deepEqual(result.effectiveCapabilities.hostAllowedTools,['host.github_read']);
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
