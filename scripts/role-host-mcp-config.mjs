/** Trusted CLI settings for the task-local host server. Tools come from the Native executor. */
import {RWB_RELEASE_TIMEOUTS} from '../bridge/rwb-release.mjs';
export function roleHostMcpConfigArgs(tools,{scriptPath="/opt/role-host-mcp-server.mjs",nodePath="node",endpoint,releaseTimeouts}={}){
 if(!scriptPath.startsWith("/")||scriptPath.includes("\0")||typeof nodePath!=="string"||!nodePath)throw Error("ROLE_HOST_MCP_CONFIG_INVALID");
 if(endpoint){const url=new URL(endpoint);if(url.protocol!=="https:"||url.hostname!=="127.0.0.1"||url.pathname!=="/backend-api/role-host-mcp"||url.username||url.password||url.search||url.hash)throw Error("ROLE_HOST_MCP_CONFIG_INVALID");}
 if(!Array.isArray(tools)||tools.some(tool=>!/^host\.[a-z_]+$/.test(tool?.name??'')))throw Object.assign(Error('ROLE_HOST_MCP_CONFIG_INVALID'),{code:'ROLE_HOST_MCP_CONFIG_INVALID'});
 if(!tools.length)return [];
 const release=releaseTimeouts===RWB_RELEASE_TIMEOUTS&&tools.some(tool=>tool.name==='host.rwb_release');
 const approved=[...new Set(tools.map(tool=>tool.name))].map(name=>JSON.stringify(name)+'={approval_mode="approve"}').join(',');
 return ['-c','mcp_servers.role_host.command='+JSON.stringify(nodePath),
  '-c','mcp_servers.role_host.args='+JSON.stringify([scriptPath]),
  '-c','mcp_servers.role_host.env_vars='+JSON.stringify(endpoint?['CODEX_CONNECTORS_TOKEN','ROLE_HOST_MCP_ENDPOINT','NODE_EXTRA_CA_CERTS',...(release?['ROLE_HOST_RWB_RELEASE']:[])]:['CODEX_CONNECTORS_TOKEN']),
  '-c','mcp_servers.role_host.tool_timeout_sec='+(release?RWB_RELEASE_TIMEOUTS.mcpSeconds:360),
  '-c','mcp_servers.role_host.default_tools_approval_mode="prompt"',
  '-c','mcp_servers.role_host.tools={'+approved+'}'];
}
