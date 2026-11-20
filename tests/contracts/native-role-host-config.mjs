import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'role-native-mcp-'));
try{
 const result=spawnSync('/opt/paperclip/node_modules/.bin/codex',['-c','mcp_servers.role_host.command="node"','-c','mcp_servers.role_host.args=["/opt/role-host-mcp-server.mjs"]','-c','mcp_servers.role_host.env_vars=["CODEX_CONNECTORS_TOKEN"]','-c','mcp_servers.role_host.tool_timeout_sec=360','mcp','get','role_host','--json'],{env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home},encoding:'utf8',timeout:10000});
 assert.equal(result.status,0);const config=JSON.parse(result.stdout);
 assert.equal(config.enabled,true);assert.equal(config.transport.command,'node');
 assert.deepEqual(config.transport.args,['/opt/role-host-mcp-server.mjs']);assert.deepEqual(config.transport.env_vars,['CODEX_CONNECTORS_TOKEN']);
 assert.equal(config.tool_timeout_sec,360);
 console.log(JSON.stringify({status:'PASS',nativeCli:'0.159.0',roleHostConfigAccepted:true,modelCalls:0}));
}finally{fs.rmSync(home,{recursive:true,force:true});}
