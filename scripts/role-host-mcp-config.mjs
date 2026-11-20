/** Trusted CLI settings for the task-local host server. Tools come from the Native executor. */
export function roleHostMcpConfigArgs(tools){
 if(!Array.isArray(tools)||tools.some(tool=>!/^host\.[a-z_]+$/.test(tool?.name??'')))throw Object.assign(Error('ROLE_HOST_MCP_CONFIG_INVALID'),{code:'ROLE_HOST_MCP_CONFIG_INVALID'});
 if(!tools.length)return [];
 const approved=[...new Set(tools.map(tool=>tool.name))].map(name=>JSON.stringify(name)+'={approval_mode="approve"}').join(',');
 return ['-c','mcp_servers.role_host.command="node"',
  '-c','mcp_servers.role_host.args=["/opt/role-host-mcp-server.mjs"]',
  '-c','mcp_servers.role_host.env_vars=["CODEX_CONNECTORS_TOKEN"]',
  '-c','mcp_servers.role_host.tool_timeout_sec=360',
  '-c','mcp_servers.role_host.default_tools_approval_mode="prompt"',
  '-c','mcp_servers.role_host.tools={'+approved+'}'];
}
