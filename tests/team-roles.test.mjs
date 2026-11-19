import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{TEAM_ROLES,roleInstructions,validateTeamRoster}from'../bridge/team-roles.mjs';
test('eleven complete English roles have the confirmed hierarchy and distinct executors',()=>{
 const rows=Object.values(TEAM_ROLES).map(r=>({key:r.key,id:randomUUID(),name:r.name,adapterType:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',heartbeatEnabled:false,lifecycle:'ready',status:'idle'}));const ids=Object.fromEntries(rows.map(r=>[r.key,r.id]));for(const row of rows)row.reportsTo=TEAM_ROLES[row.key].parent?ids[TEAM_ROLES[row.key].parent]:null;
 assert.equal(validateTeamRoster(rows,{requireReady:true}).length,11);assert.equal(rows.find(x=>x.key==='qa').reportsTo,ids.chief);assert.equal(rows.find(x=>x.key==='pm').reportsTo,ids.chief);assert.equal(rows.find(x=>x.key==='frontend-engineer').reportsTo,ids.architect);
 assert.throws(()=>validateTeamRoster(rows.map(x=>x.key==='qa'?{...x,reportsTo:ids.architect}:x)),/HIERARCHY_INVALID/);
 assert.throws(()=>validateTeamRoster(rows.map(x=>x.key==='pm'?{...x,name:'PM'}:x)),/HIERARCHY_INVALID/);
 assert.throws(()=>validateTeamRoster(rows.map(x=>x.key==='qa'?{...x,id:ids['frontend-engineer']}:x)),/DUPLICATE/);
 assert.match(roleInstructions('backend-engineer'),/SQL/);assert.match(roleInstructions('system-resource-engineer'),/两个外盘/);assert.equal(Object.keys(TEAM_ROLES).some(x=>['cto','cmo','coo','dba'].includes(x)),false);
});
