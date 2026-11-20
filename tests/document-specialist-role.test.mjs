import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ROLE_KEYS,ROLE_DISPLAY_NAMES} from '../bridge/role-labels.mjs';
import {TEAM_ROLES,roleInstructions,validateTeamRoster} from '../bridge/team-roles.mjs';
import {resolveRoleCapabilities} from '../bridge/role-capabilities.mjs';
import {roleSkillNames,resolveRoleSkillAssignments,rolePermissions} from '../bridge/company-role-skills.mjs';
import {validateTeamPlan} from '../bridge/team-plan.mjs';
import {createRolePreparation} from '../bridge/role-preparation.mjs';
import {selectRoleKnowledge} from '../bridge/role-materials.mjs';
import {validateRoleCall} from '../docker/role-codex-gate.mjs';

const role='document-specialist';
const legacyRoles=['chief','research','pm','designer','architect','frontend-engineer','backend-engineer','qa','devops','network-engineer','system-resource-engineer'];

test('the document profession adds one Chief subordinate and keeps the established hierarchy',()=>{
 assert.deepEqual(ROLE_KEYS,[...legacyRoles,role]);
 assert.equal(ROLE_DISPLAY_NAMES[role],'Document Specialist');
 assert.equal(TEAM_ROLES[role].parent,'chief');
 assert.equal(TEAM_ROLES[role].nativeRole,'general');
 const rows=Object.values(TEAM_ROLES).map(r=>({key:r.key,id:randomUUID(),name:r.name,adapterType:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',heartbeatEnabled:false,lifecycle:'ready',status:'idle'}));
 const ids=Object.fromEntries(rows.map(row=>[row.key,row.id]));
 for(const row of rows)row.reportsTo=TEAM_ROLES[row.key].parent?ids[TEAM_ROLES[row.key].parent]:null;
 assert.equal(validateTeamRoster(rows,{requireReady:true}).length,12);
 assert.equal(rows.find(row=>row.key==='qa').reportsTo,ids.chief);
 assert.equal(rows.find(row=>row.key==='frontend-engineer').reportsTo,ids.architect);
 assert.throws(()=>validateTeamRoster(rows.filter(row=>row.key!==role)),/ROSTER_INCOMPLETE/);
 assert.throws(()=>validateTeamRoster(rows.map(row=>row.key===role?{...row,lifecycle:'paused'}:row),{requireReady:true}),/ROSTER_NOT_READY/);
});

test('document instructions bind file delivery to the task and distinguish tools from successful output',()=>{
 const text=roleInstructions(role);
 for(const phrase of ['Excel','Word','PPT','Markdown','PDF','原件','公式','新版本','QA','PAPERCLIP_DOCUMENT_PYTHON','PAPERCLIP_DOCUMENT_SOFFICE','NOT_RUN'])assert.ok(text.includes(phrase),phrase);
 assert.match(text,/文件内容.*数据/);
 assert.match(text,/宏.*脚本/);
 assert.match(text,/Research.*PM/);
 assert.match(text,/Mac原生Agent/);
 assert.doesNotMatch(text,/\/Users\//);
 assert.deepEqual(rolePermissions(role),{canCreateAgents:false,canAssignTasks:false,canCreateSkills:true});
});

test('document company assignment selects nine existing methods and the preferred PDF implementation',()=>{
 const names=roleSkillNames({role});
 assert.deepEqual(names,['paperclip','handoff','verification-before-completion','xlsx','docx','pptx','pdf','doc-coauthoring','theme-factory']);
 const library=names.map(name=>({key:name,name,slug:name,sourceLocator:name==='pdf'?'https://github.com/anthropics/skills':'https://github.com/example/skills'}));
 library.push({key:'alternative-pdf',name:'pdf',slug:'pdf',sourceLocator:'https://github.com/openai/skills'});
 const selected=resolveRoleSkillAssignments({role,companySkills:library});
 assert.deepEqual(selected.missing,[]);
 assert.deepEqual(selected.desiredSkills,names);
 const skills=library.map(skill=>({...skill,id:skill.key,companyId:'company',currentVersionId:skill.key+'-v1'}));
 const versions=skills.map(skill=>({id:skill.currentVersionId,companyId:'company',companySkillId:skill.id,fileInventory:[{path:'SKILL.md',content:'Instructions for '+skill.name,encoding:'utf8'}]}));
 const agent={companyId:'company',adapterConfig:{paperclipSkillSync:{desiredSkills:selected.desiredSkills}}};
 const capabilities=resolveRoleCapabilities({role,agent,companySkills:skills,companySkillVersions:versions});
 assert.equal(capabilities.skillSelectionSource,'company');
 assert.deepEqual(capabilities.skills.map(skill=>skill.name),names);
 assert.equal(capabilities.companySkillSnapshot.skills.length,9);
 assert.deepEqual(resolveRoleCapabilities({role,agent:{...agent,adapterConfig:{paperclipSkillSync:{desiredSkills:[]}}},companySkills:skills,companySkillVersions:versions}).skills,[]);
});

test('document connections remain role scoped and a declared Excel server is not assumed connected',()=>{
 const tools=[{name:'codex_document_control.list_sessions',annotations:{readOnlyHint:true}},{name:'codex_document_control.execute',annotations:{readOnlyHint:false}},{name:'gmail.send_email',annotations:{readOnlyHint:false}}];
 const plain=resolveRoleCapabilities({role,toolCatalog:tools});
 assert.deepEqual(plain.mcpAllowedTools,tools.slice(0,2).map(x=>x.name));
 assert.ok(!plain.hostAllowedTools.includes('host.mcp_call'));
 assert.ok(!plain.hostAllowedTools.some(x=>/publish|network_apply|resources_apply/.test(x)));
 const context={hostMcpServers:[{id:'excel-relay',tools:['get_version'],allowedRoles:[role]}]};
 const registered=resolveRoleCapabilities({role,toolCatalog:tools,projectContext:context});
 assert.ok(registered.hostAllowedTools.includes('host.mcp_call'));
 assert.equal(registered.availability.hostTools.find(x=>x.name==='host.mcp_call').status,'requires-host-transport');
});

test('document Native preparation and final gate preserve the same task, materials and unsandboxed policy',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'document-preparation-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const text=roleInstructions(role),sha256=createHash('sha256').update(text).digest('hex');
 fs.writeFileSync(root+'/AGENTS.md',text,{mode:0o600});
 const ids=Object.fromEntries(['companyId','projectId','taskId','agentId','runId'].map(key=>[key,randomUUID()]));
 const binding={...ids,ownerId:'owner',inputRevision:'a'.repeat(64)};
 const context={...binding,projectKey:'documents',role,revision:'b'.repeat(64),runState:'authorized',sessionId:null,dispatchMode:'controlled',model:'gpt-6.1-sol',reasoningEffort:'low'};
 const executionPolicy={executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'};
 const profile={projectId:ids.projectId,projectKey:'documents',agentId:ids.agentId,role,engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:true,sandbox:'none',executionPolicy,tools:['read_materials','shell','apply_patch']};
 const shared={project:'documents',id:'source',version:1,kind:'decision',visibility:'project',source:'owner',condition:'current',text:'Use the given files.'};
 const own={...shared,id:'private-doc',visibility:'private',role,text:'Document-specific experience.'};
 const foreign={...shared,id:'private-research',visibility:'private',role:'research',text:'Research private record.'};
 assert.deepEqual(selectRoleKnowledge({project:'documents',role,records:[shared,own,foreign]}).map(x=>x.id).sort(),['private-doc','source']);
 const prepare=createRolePreparation({readContext:async()=>context,readKnowledge:async()=>[shared,own,foreign],log(){}});
 const result=await prepare({binding,profile,materialRoot:root,manifest:{schemaVersion:1,project:'documents',role,instructionsFilePath:'AGENTS.md',requiredReferences:[],files:[{path:'AGENTS.md',sha256}]}});
 assert.equal(result.artifactKind,'document-delivery');assert.equal(result.config.sandbox,'none');
 assert.deepEqual(result.knowledge.map(x=>x.id).sort(),['private-doc','source']);
 const permit={schemaVersion:1,...ids,credentialGrantId:randomUUID(),role,model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:200000,cwd:'/paperclip/control/research-pm/workspaces/document-specialist',instructionsFilePath:'/paperclip/control/research-pm/materials/'+randomUUID()+'.md',materialSha256:sha256,executionPolicy};
 const args=['--search','exec','--json','--model',permit.model,'-c','model_reasoning_effort="low"','--dangerously-bypass-approvals-and-sandbox','-'];
 const env={PAPERCLIP_RUN_ID:ids.runId,PAPERCLIP_AGENT_ID:ids.agentId,PAPERCLIP_COMPANY_ID:ids.companyId,PAPERCLIP_TASK_ID:ids.taskId,CODEX_HOME:'/tmp/paperclip-ai-'+ids.companyId+'-'+permit.credentialGrantId+'-abcdef/provider'};
 assert.equal(validateRoleCall({permit,args,env,cwd:permit.cwd,now:100000}),permit);
 assert.throws(()=>validateRoleCall({permit,args,env:{...env,PAPERCLIP_TASK_ID:randomUUID()},cwd:permit.cwd,now:100000}),/SCOPE_DENIED/);
});

test('document files hand off through a bounded manifest and independent QA without widening the plan protocol',()=>{
 const work={key:'files',role,title:'Prepare the requested files',goal:'Create XLSX/DOCX/PPTX/Markdown/PDF in the assigned directory and a JSON manifest with hashes.',outputFile:'files-manifest.json',dependsOn:[]};
 const qa={key:'quality',role:'qa',title:'Verify the files',goal:'Independently read the manifest and verify the actual files.',outputFile:'quality.json',dependsOn:['files']};
 const plan={schemaVersion:1,tasks:[work,qa]};
 assert.equal(validateTeamPlan(plan,{remainingCalls:3}).tasks.length,2);
 assert.throws(()=>validateTeamPlan({schemaVersion:1,tasks:[work]},{remainingCalls:3}),/INDEPENDENT_REVIEW/);
 assert.throws(()=>validateTeamPlan({...plan,tasks:[{...work,outputFile:'files.xlsx'},qa]},{remainingCalls:3}),/SCOPE/);
 assert.throws(()=>validateTeamPlan(plan,{remainingCalls:2}),/BUDGET/);
 assert.throws(()=>validateTeamPlan({schemaVersion:1,tasks:Array.from({length:5},(_,i)=>({...work,key:'file-'+i,outputFile:'file-'+i+'.json'}))},{remainingCalls:6}),/BUDGET_OR_SHAPE/);
});
