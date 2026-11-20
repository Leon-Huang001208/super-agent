import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRoleMcpCall,filterMcpTools,transformMcpCatalogBody} from '../bridge/role-mcp-policy.mjs';

const policy={allowedTools:['github.get_repo','plugin_management.search_plugins','figma.get_screenshot'],projectContext:{repository:{fullName:'owner/excel-relay'}}};
test('MCP permissions use the assigned project repository rather than a fixed application repository',()=>{
 assert.doesNotThrow(()=>assertRoleMcpCall({name:'github.get_repo',args:{repository_full_name:'owner/excel-relay'},...policy}));
 assert.throws(()=>assertRoleMcpCall({name:'github.get_repo',args:{repository_full_name:'Leon-Huang001208/super-agent'},...policy}),/REPOSITORY_DENIED/);
 assert.throws(()=>assertRoleMcpCall({name:'github.get_repo',args:{repository_full_name:'owner/excel-relay',repo_full_name:'other/private'},...policy}),/REPOSITORY_DENIED/);
 assert.throws(()=>assertRoleMcpCall({name:'gmail.send_email',args:{},...policy}),/MCP_ACTION_DENIED/);
  assert.throws(()=>assertRoleMcpCall({name:'mcp__codex_apps__github__get_repo',args:{repository_full_name:'other/private'},allowedTools:['mcp__codex_apps__github__get_repo'],projectContext:policy.projectContext}),/REPOSITORY_DENIED/);
});
test('tool discovery hides unavailable calls and preserves the actual allowed schema',()=>{
 const tools=[{name:'github.get_repo',inputSchema:{properties:{repository_full_name:{type:'string'}}}},{name:'gmail.send_email'},
  {name:'plugin_management.search_plugins'},{name:'github.search_global',inputSchema:{properties:{query:{type:'string'}}}}];
 const selected=filterMcpTools(tools,{...policy,allowedTools:[...policy.allowedTools,'github.search_global'],hostTools:[{name:'host.project_inspect'}]});
 assert.deepEqual(selected.map(x=>x.name),['github.get_repo','plugin_management.search_plugins','host.project_inspect']);
 assert.equal(selected[0],tools[0]);assert.equal(tools.length,4);
});
test('JSON and SSE tools/list responses carry the same filtered directory and RPC identity',()=>{
 const response={jsonrpc:'2.0',id:7,result:{tools:[{name:'plugin_management.search_plugins'},{name:'gmail.send_email'}]}};
 const transform=value=>({...value,result:{...value.result,tools:filterMcpTools(value.result.tools,policy)}});
 const plain=JSON.parse(transformMcpCatalogBody(JSON.stringify(response),'application/json',transform));
 assert.equal(plain.id,7);assert.deepEqual(plain.result.tools.map(x=>x.name),['plugin_management.search_plugins']);
 const sse=transformMcpCatalogBody('event: message\ndata: '+JSON.stringify(response)+'\n\n','text/event-stream',transform);
 assert.ok(sse.includes('event: message'));assert.ok(!sse.includes('gmail.send_email'));
 assert.ok(sse.includes('"id":7'));
});
