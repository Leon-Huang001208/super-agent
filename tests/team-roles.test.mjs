import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{TEAM_ROLES,roleInstructions,validateTeamRoster}from'../bridge/team-roles.mjs';
import{readFileSync}from'node:fs';
import{renderRoleCapabilitiesMarkdown}from'../bridge/role-capabilities.mjs';
import{getRoleRuntimeProfile,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS}from'../bridge/role-runtime-profiles.mjs';

// A mechanical current-binding snapshot; new tasks choose through task-runtime-policy.
const currentBindings=()=>({...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,research:'deepseek_opencode','backend-engineer':'minimax_opencode'});

function runtimeRoster(runtimeAssignments){
 const rows=Object.values(TEAM_ROLES).map(role=>{
  const selected=getRoleRuntimeProfile(role.key,runtimeAssignments);
  return{key:role.key,id:randomUUID(),name:role.name,adapterType:selected.adapterType,model:selected.model,
   reasoningEffort:selected.reasoningEffort,heartbeatEnabled:false,lifecycle:'ready',status:'idle'};
 });
 const ids=Object.fromEntries(rows.map(row=>[row.key,row.id]));
 for(const row of rows)row.reportsTo=TEAM_ROLES[row.key].parent?ids[TEAM_ROLES[row.key].parent]:null;
 return rows;
}

test('explicit runtime instructions change only the model binding sentence, not role responsibilities or authority',()=>{
 const prefix='Paperclip是唯一任务、运行和会话控制面；',suffix='项目需要时按登记使用Docker构建、测试或运行服务。';
 const withoutBinding=text=>{
  const start=text.indexOf(prefix)+prefix.length,end=text.indexOf(suffix,start);
  assert.ok(start>=prefix.length&&end>start);return text.slice(0,start)+text.slice(end);
 };
 for(const key of Object.keys(TEAM_ROLES)){
  const runtimeAssignments=currentBindings(),legacy=roleInstructions(key),selected=getRoleRuntimeProfile(key,runtimeAssignments);
  assert.equal(roleInstructions(key,{runtimeAssignments:undefined}),legacy);
  const candidate=roleInstructions(key,{runtimeAssignments});
  assert.equal(withoutBinding(candidate),withoutBinding(legacy));
  for(const field of ['runtime','adapterType','provider','model','providerModel','credentialKind'])assert.ok(candidate.includes(field+'='+selected[field]));
  assert.match(candidate,/只使用绑定档位/);assert.match(candidate,/不自动fallback/);assert.match(candidate,/不切换provider或model/);
  assert.doesNotMatch(candidate,/沿用原个人订阅gpt-6\.1-sol\/low，不转API或换模型/);
  if(selected.runtime==='opencode')assert.match(candidate,/API为该岗位显式主选/);
  else assert.match(candidate,/继续使用原Codex会员/);
 }
 assert.throws(()=>roleInstructions('research',{runtimeAssignments:{}}),/ROLE_RUNTIME_ASSIGNMENTS_INVALID/);
 assert.throws(()=>roleInstructions('__proto__',{runtimeAssignments:currentBindings()}),/TEAM_ROLE_UNKNOWN/);
});

test('task routing instructions bind the task and handoff without permanently naming a model',()=>{
 const prefix='Paperclip是唯一任务、运行和会话控制面；',suffix='项目需要时按登记使用Docker构建、测试或运行服务。';
 const withoutBinding=text=>{const start=text.indexOf(prefix)+prefix.length,end=text.indexOf(suffix,start);return text.slice(0,start)+text.slice(end);};
 for(const key of Object.keys(TEAM_ROLES)){
  const legacy=roleInstructions(key),text=roleInstructions(key,{taskRuntimeRouting:true});
  assert.equal(roleInstructions(key,{taskRuntimeRouting:false}),legacy);
  assert.equal(text,roleInstructions(key,{taskRuntimeRouting:true,runtimeAssignments:currentBindings()}));
  assert.equal(withoutBinding(text),withoutBinding(legacy));
  assert.doesNotMatch(text,/gpt-6\.1-sol|deepseek-flash|MiniMax-M3\.1-Flash/);
  assert.match(text,/可信Controller/);assert.match(text,/不永久绑定/);
  assert.match(text,/任务开始/);assert.match(text,/明确handoff/);
  assert.match(text,/同一任务身份/);assert.match(text,/产物/);assert.match(text,/累计预算/);assert.match(text,/checks/);
  assert.match(text,/不自动fallback/);assert.match(text,/不从prompt自行授权/);
 }
});

test('the thirteen-role roster validates current bindings without fixing a role model policy',()=>{
 const runtimeAssignments=currentBindings(),rows=runtimeRoster(runtimeAssignments),before=structuredClone(rows);
 assert.equal(validateTeamRoster(rows,{requireReady:true,runtimeAssignments}),rows);
 assert.deepEqual(rows,before);
 assert.equal(rows.find(row=>row.key==='research').model,'deepseek/deepseek-flash');
 assert.equal(rows.find(row=>row.key==='backend-engineer').model,'minimax-cn-coding-plan/MiniMax-M3.1-Flash');
 assert.equal(validateTeamRoster(runtimeRoster(DEFAULT_ROLE_RUNTIME_ASSIGNMENTS),{requireReady:true}).length,13);
 // The public Native role enum does not replace the internal registered key.
 assert.equal(validateTeamRoster(rows.map(row=>({...row,role:'general'})),{runtimeAssignments}).length,13);
 assert.throws(()=>validateTeamRoster(rows,{requireReady:true}),/TEAM_ROSTER_EXECUTOR_INVALID/);
 assert.throws(()=>validateTeamRoster(rows.slice(1),{runtimeAssignments}),/TEAM_ROSTER_INCOMPLETE/);
 assert.throws(()=>validateTeamRoster(rows.map(row=>row.key==='qa'?{...row,reportsTo:rows.find(value=>value.key==='architect').id}:row),{runtimeAssignments}),/TEAM_ROSTER_HIERARCHY_INVALID/);
 assert.throws(()=>validateTeamRoster(rows.map(row=>row.key==='research'?{...row,status:'paused'}:row),{requireReady:true,runtimeAssignments}),/TEAM_ROSTER_NOT_READY/);
});

test('runtime roster mismatch keeps the existing executor error and never selects another profile',()=>{
 const runtimeAssignments=currentBindings();
 for(const change of [
  {key:'research',model:'deepseek-flash'},
  {key:'backend-engineer',model:'deepseek/deepseek-flash'},
  {key:'backend-engineer',adapterType:'codex_local'},
  {key:'research',reasoningEffort:'low'},
  {key:'qa',reasoningEffort:null},
  {key:'devops',heartbeatEnabled:true},
 ]){
  const rows=runtimeRoster(runtimeAssignments).map(row=>row.key===change.key?{...row,...change}:row);
  assert.throws(()=>validateTeamRoster(rows,{runtimeAssignments}),{message:'TEAM_ROSTER_EXECUTOR_INVALID'});
 }
 const rows=runtimeRoster(runtimeAssignments);
 assert.throws(()=>validateTeamRoster(rows,{runtimeAssignments:{...runtimeAssignments,pm:'untrusted-profile'}}),{message:'TEAM_ROSTER_EXECUTOR_INVALID'});
});

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
test('default and task-mode instructions persist through readable truncation to scoped done or a real blocker',()=>{
 for(const role of Object.keys(TEAM_ROLES))for(const options of [{},{taskRuntimeRouting:true}]){
  const text=roleInstructions(role,options);
  assert.match(text,/长资料.*分段读取.*所需范围完整/);
  assert.match(text,/输出截断本身不是可用资料的真实阻塞/);
  assert.match(text,/持续推进到本岗位明确的done条件或可定位的真实blocker/);
  assert.match(text,/不以“本轮未完成”作为自然退出/);
  assert.match(text,/实际完成、待做和具体阻塞/);
  assert.match(text,/有限PoC或合成测试.*全局完成/);
  assert.match(text,/不越权、不自行扩大预算、不对结果未知的操作隐式重试/);
 }
});
test('reviewable role templates match the runtime profession and capability renderers',()=>{
 for(const key of Object.keys(TEAM_ROLES)){
  assert.equal(readFileSync(new URL(`../assets/role-profiles/${key}/AGENTS.md`,import.meta.url),'utf8'),roleInstructions(key));
  assert.equal(readFileSync(new URL(`../assets/role-profiles/${key}/CAPABILITIES.md`,import.meta.url),'utf8'),renderRoleCapabilitiesMarkdown(key));
 }
});
