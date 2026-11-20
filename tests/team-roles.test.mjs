import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{TEAM_ROLES,roleInstructions,validateTeamRoster}from'../bridge/team-roles.mjs';
import{readFileSync}from'node:fs';
import{renderRoleCapabilitiesMarkdown}from'../bridge/role-capabilities.mjs';
test('complete English roles have the confirmed hierarchy and distinct executors',()=>{
 const rows=Object.values(TEAM_ROLES).map(r=>({key:r.key,id:randomUUID(),name:r.name,adapterType:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',heartbeatEnabled:false,lifecycle:'ready',status:'idle'}));const ids=Object.fromEntries(rows.map(r=>[r.key,r.id]));for(const row of rows)row.reportsTo=TEAM_ROLES[row.key].parent?ids[TEAM_ROLES[row.key].parent]:null;
 assert.equal(validateTeamRoster(rows,{requireReady:true}).length,Object.keys(TEAM_ROLES).length);assert.equal(rows.find(x=>x.key==='qa').reportsTo,ids.chief);assert.equal(rows.find(x=>x.key==='pm').reportsTo,ids.chief);assert.equal(rows.find(x=>x.key==='frontend-engineer').reportsTo,ids.architect);
 assert.throws(()=>validateTeamRoster(rows.map(x=>x.key==='qa'?{...x,reportsTo:ids.architect}:x)),/HIERARCHY_INVALID/);
 assert.throws(()=>validateTeamRoster(rows.map(x=>x.key==='pm'?{...x,name:'PM'}:x)),/HIERARCHY_INVALID/);
 assert.throws(()=>validateTeamRoster(rows.map(x=>x.key==='qa'?{...x,id:ids['frontend-engineer']}:x)),/DUPLICATE/);
 assert.match(roleInstructions('backend-engineer'),/SQL/);assert.match(roleInstructions('system-resource-engineer'),/卷身份/);assert.equal(Object.keys(TEAM_ROLES).some(x=>['cto','cmo','coo','dba'].includes(x)),false);
});
test('every role has a complete portable profession description and task-bound execution policy',()=>{
 for(const role of Object.keys(TEAM_ROLES)){
  const text=roleInstructions(role);
  for(const section of ['目标','输入','负责事项','协作边界','工作步骤','默认专业能力','工具触发和使用','交付物','完成与失败处理'])assert.ok(text.includes(`## ${section}`),`${role}: ${section}`);
  assert.match(text,/projectContext/);assert.match(text,/授权内自主执行/);assert.match(text,/gpt-6\.1-sol\/low/);
  assert.match(text,/未提供AGENTS\.md.*不阻断只读验证/);assert.match(text,/项目明示必需的规则仍须遵循/);
  assert.doesNotMatch(text,/不合并或部署RWB|两个外盘|\/Volumes\/WorkDisk|2BC466D2|只能提出具体可审查变更/);
 }
 assert.match(roleInstructions('network-engineer'),/host\.network_apply/);
 assert.match(roleInstructions('system-resource-engineer'),/host\.resources_apply/);
 assert.match(roleInstructions('qa'),/独立会话/);
 assert.throws(()=>roleInstructions('__proto__'),/TEAM_ROLE_UNKNOWN/);
});
test('reviewable role templates match the runtime profession and capability renderers',()=>{
 for(const key of Object.keys(TEAM_ROLES)){
  assert.equal(readFileSync(new URL(`../assets/role-profiles/${key}/AGENTS.md`,import.meta.url),'utf8'),roleInstructions(key));
  assert.equal(readFileSync(new URL(`../assets/role-profiles/${key}/CAPABILITIES.md`,import.meta.url),'utf8'),renderRoleCapabilitiesMarkdown(key));
 }
});
