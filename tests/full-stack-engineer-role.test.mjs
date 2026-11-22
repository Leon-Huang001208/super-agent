import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ROLE_KEYS,ROLE_DISPLAY_NAMES} from '../bridge/role-labels.mjs';
import {TEAM_ROLES,roleInstructions,validateTeamRoster} from '../bridge/team-roles.mjs';
import {resolveRoleCapabilities,renderRoleCapabilitiesMarkdown} from '../bridge/role-capabilities.mjs';
import {rolePermissions,roleSkillNames} from '../bridge/company-role-skills.mjs';
import {DEFAULT_ROLE_RUNTIME_ASSIGNMENTS} from '../bridge/role-runtime-profiles.mjs';
import {validateTeamPlan,CHIEF_DISPATCH_PROTOCOL} from '../bridge/team-plan.mjs';
import {validateTeamBootstrapIntent} from '../scripts/team-bootstrap.mjs';

const role='full-stack-engineer';
const previous={chief:['Chief Coordinator',null,'general'],research:['Research Analyst','chief','researcher'],pm:['Product Manager','chief','pm'],
 designer:['Product Designer','chief','designer'],architect:['Software Architect','chief','engineer'],
 'frontend-engineer':['Frontend Engineer','architect','engineer'],'backend-engineer':['Backend Engineer','architect','engineer'],
 qa:['Quality Assurance Engineer','chief','qa'],devops:['Platform Operations Engineer','chief','devops'],
 'network-engineer':['Network Engineer','chief','engineer'],'system-resource-engineer':['System Resource Engineer','chief','engineer'],
 'document-specialist':['Document Specialist','chief','general']};
function roster(){
 const rows=Object.values(TEAM_ROLES).map(value=>({key:value.key,id:randomUUID(),name:value.name,adapterType:'codex_local',model:'gpt-6.1-sol',
  reasoningEffort:'low',heartbeatEnabled:false,lifecycle:'ready',status:'idle'})),ids=Object.fromEntries(rows.map(value=>[value.key,value.id]));
 for(const row of rows)row.reportsTo=TEAM_ROLES[row.key].parent?ids[TEAM_ROLES[row.key].parent]:null;
 return{rows,ids};
}
test('the thirteen-role candidate adds a real Architect subordinate while preserving all twelve existing professions',()=>{
 assert.deepEqual(ROLE_KEYS,[...Object.keys(previous),role]);assert.equal(ROLE_DISPLAY_NAMES[role],'Full Stack Engineer');
 assert.deepEqual([TEAM_ROLES[role].parent,TEAM_ROLES[role].nativeRole,TEAM_ROLES[role].artifactKind],['architect','engineer','implementation']);
 for(const[key,expected]of Object.entries(previous))assert.deepEqual([TEAM_ROLES[key].name,TEAM_ROLES[key].parent,TEAM_ROLES[key].nativeRole],expected);
 const{rows,ids}=roster();assert.equal(validateTeamRoster(rows,{requireReady:true}).length,13);
 assert.equal(rows.find(value=>value.key===role).reportsTo,ids.architect);
 const before=JSON.stringify(rows);assert.throws(()=>validateTeamRoster(rows.filter(value=>value.key!==role)),/ROSTER_INCOMPLETE/);assert.equal(JSON.stringify(rows),before);
 assert.equal(Object.keys(DEFAULT_ROLE_RUNTIME_ASSIGNMENTS).length,13);assert.equal(DEFAULT_ROLE_RUNTIME_ASSIGNMENTS[role],'codex_subscription');
 const intent={schemaVersion:1,roles:Object.fromEntries(Object.entries(ids).map(([key,agentId])=>[key,{agentId}]))};
 assert.equal(validateTeamBootstrapIntent(intent,ids),intent);const old=structuredClone(intent);delete old.roles[role];
 assert.throws(()=>validateTeamBootstrapIntent(old,ids),/INTENT_CHANGED/);
});
test('full-stack responsibilities cover bounded end-to-end work, evidence and same-task escalation without overlapping owners',()=>{
 const text=roleInstructions(role,{taskRuntimeRouting:true});
 for(const phrase of ['前后端','小功能','简单','Bug','测试','接口','唯一执行负责人','复杂','Codex','同一task/root','累计预算','独立QA','原产物'])assert.ok(text.includes(phrase),phrase);
 assert.doesNotMatch(text,/placeholder|TODO|待补充/);
 assert.match(roleInstructions('chief'),/先.*全栈.*专业.*再.*模型.*Runtime/);
 assert.match(roleInstructions('architect'),/Full Stack Engineer/);
 assert.match(CHIEF_DISPATCH_PROTOCOL,/full-stack-engineer/);
});
test('full-stack skills and tools stay within existing frontend/backend development and testing capabilities',()=>{
 const selected=resolveRoleCapabilities({role}),allowed=new Set(['frontend-engineer','backend-engineer'].flatMap(role=>resolveRoleCapabilities({role}).hostAllowedTools));
 assert.ok(selected.hostAllowedTools.every(tool=>allowed.has(tool)));
 for(const name of ['host.project_publish','host.rwb_release','host.network_observe','host.network_apply','host.resources_observe','host.resources_apply'])assert.ok(!selected.hostAllowedTools.includes(name));
 assert.deepEqual(rolePermissions(role),{canCreateAgents:false,canAssignTasks:false,canCreateSkills:true});
 const names=roleSkillNames({role});for(const name of ['systematic-debugging','test-driven-development','frontend-testing-debugging','webapp-testing','property-based-testing'])assert.ok(names.includes(name));
 assert.ok(!names.includes('storage-analyzer'));assert.ok(!names.includes('gh-fix-ci'));
 const conditioned=roleSkillNames({role,projectContext:{stack:['React','shadcn/ui','PostgreSQL']}});
 for(const name of ['react-best-practices','shadcn','supabase-postgres-best-practices'])assert.ok(conditioned.includes(name));
 assert.ok(!selected.hostAllowedTools.includes('host.mcp_call'));
 for(const additionalCapabilities of [['devops'],['network-engineer'],['system-resource-engineer']])assert.throws(()=>resolveRoleCapabilities({role,additionalCapabilities}),/ROLE_CAPABILITY_SCOPE_DENIED/);
});
test('full-stack implementation requires independent QA and cannot request privileged capability combinations',()=>{
 const implementation={key:'implement',role,title:'Small end-to-end change',goal:'Implement and test a bounded UI/API flow',outputFile:'implementation.md',dependsOn:[]};
 const plan={schemaVersion:1,tasks:[implementation]};assert.throws(()=>validateTeamPlan(plan,{remainingCalls:5}),/INDEPENDENT_REVIEW_REQUIRED/);
 plan.tasks.push({key:'quality',role:'qa',title:'Independent review',goal:'Verify candidate and evidence',outputFile:'quality.json',dependsOn:['implement']});
 assert.equal(validateTeamPlan(plan,{remainingCalls:5}).tasks.length,2);
 implementation.capabilities=['backend-engineer'];assert.equal(validateTeamPlan(plan,{remainingCalls:5}).tasks[0].capabilities[0],'backend-engineer');
 implementation.capabilities=['devops'];assert.throws(()=>validateTeamPlan(plan,{remainingCalls:5}),/CAPABILITIES_DENIED/);
});
test('full-stack material is complete, renderable and checked into the same generated asset contract',()=>{
 for(const[file,expected]of [['AGENTS.md',roleInstructions(role)],['CAPABILITIES.md',renderRoleCapabilitiesMarkdown(role)]]){
  const text=fs.readFileSync(new URL('../assets/role-profiles/'+role+'/'+file,import.meta.url),'utf8');
  assert.equal(text,expected);assert.ok(text.length>3000);
 }
});
