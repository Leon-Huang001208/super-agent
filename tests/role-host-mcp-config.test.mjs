import test from 'node:test';
import assert from 'node:assert/strict';
import {roleHostMcpConfigArgs} from '../scripts/role-host-mcp-config.mjs';

test('task MCP config approves only actual executor tools while keeping other tools on prompt',()=>{
 const args=roleHostMcpConfigArgs([{name:'host.project_inspect'},{name:'host.mcp_call'}]);
 const entries=args.filter((_,index)=>index%2===1);
 assert.ok(entries.includes('mcp_servers.role_host.default_tools_approval_mode="prompt"'));
 const policy=entries.find(value=>value.startsWith('mcp_servers.role_host.tools='));
 assert.equal(policy,'mcp_servers.role_host.tools={"host.project_inspect"={approval_mode="approve"},"host.mcp_call"={approval_mode="approve"}}');
 assert.ok(!args.some(value=>value.startsWith('approval_policy=')||value.includes('codex_apps')));
 assert.ok(!policy.includes('host.project_publish'));
 assert.ok(entries.includes('mcp_servers.role_host.env_vars=["CODEX_CONNECTORS_TOKEN"]'));
});

test('task MCP settings are absent without tools and reject invalid tool config input',()=>{
 assert.deepEqual(roleHostMcpConfigArgs([]),[]);
 assert.throws(()=>roleHostMcpConfigArgs([{name:'host.project_inspect"=x'}]),/ROLE_HOST_MCP_CONFIG_INVALID/);
 assert.throws(()=>roleHostMcpConfigArgs(null),/ROLE_HOST_MCP_CONFIG_INVALID/);
});
