/** Trusted CLI settings for the task-local host server. Tools come from the Native executor. */
export function roleHostMcpConfigArgs(tools,{scriptPath="/opt/role-host-mcp-server.mjs",nodePath="node",endpoint}={}){
 if(!scriptPath.startsWith("/")||scriptPath.includes("\0")||typeof nodePath!=="string"||!nodePath)throw Error("ROLE_HOST_MCP_CONFIG_INVALID");
 if(endpoint){const url=new URL(endpoint);if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||url.pathname!=="/backend-api/role-host-mcp")throw Error("ROLE_HOST_MCP_CONFIG_INVALID");}
 if(!Array.isArray(tools)||tools.some(tool=>!/^host\.[a-z_]+$/.test(tool?.name??'')))throw Object.assign(Error('ROLE_HOST_MCP_CONFIG_INVALID'),{code:'ROLE_HOST_MCP_CONFIG_INVALID'});
 if(!tools.length)return [];
 const approved=[...new Set(tools.map(tool=>tool.name))].map(name=>JSON.stringify(name)+'={approval_mode="approve"}').join(',');
 return ['-c','mcp_servers.role_host.command='+JSON.stringify(nodePath),
  '-c','mcp_servers.role_host.args='+JSON.stringify([scriptPath]),
  '-c','mcp_servers.role_host.env_vars='+JSON.stringify(endpoint?['CODEX_CONNECTORS_TOKEN','ROLE_HOST_MCP_ENDPOINT']:['CODEX_CONNECTORS_TOKEN']),
  '-c','mcp_servers.role_host.tool_timeout_sec=360',
  '-c','mcp_servers.role_host.default_tools_approval_mode="prompt"',
  '-c','mcp_servers.role_host.tools={'+approved+'}'];
}
