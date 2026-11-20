import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {roleHostMcpConfigArgs} from '../../scripts/role-host-mcp-config.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'role-native-mcp-'));
const cli='/opt/paperclip/node_modules/.bin/codex';
const configArgs=['-c','approval_policy="never"',...roleHostMcpConfigArgs([{name:'host.project_inspect'},{name:'host.project_check'}])];
const env={PATH:process.env.PATH,HOME:home,CODEX_HOME:home};
async function readEffectiveConfig(){
 const child=spawn(cli,[...configArgs,'app-server','--strict-config','--stdio'],{env,stdio:['pipe','pipe','pipe']});
 let pending='',stderr='',config,problem;
 const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
 const timer=setTimeout(()=>{problem??=Error('NATIVE_CONFIG_READ_TIMEOUT');child.kill('SIGTERM');},10000);
 child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>65536){problem??=Error('NATIVE_CONFIG_STDERR_LIMIT');child.kill('SIGTERM');}});
 child.stdout.on('data',chunk=>{pending+=chunk;let newline;while((newline=pending.indexOf('\n'))>=0){
  const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(!line.trim())continue;
  try{const message=JSON.parse(line);if(message.error)throw Error('NATIVE_CONFIG_RPC_ERROR');
   if(message.id===1){send({method:'initialized'});send({id:2,method:'config/read',params:{includeLayers:true}});}
   if(message.id===2){config=message.result.config;child.kill('SIGTERM');}
  }catch(error){problem??=error;child.kill('SIGTERM');}
 }});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 send({id:1,method:'initialize',params:{clientInfo:{name:'role-approval-contract',version:'1'},capabilities:{experimentalApi:true}}});
 try{const exit=await closed;if(problem)throw problem;assert.equal(exit.code,0,stderr);assert.ok(config);return config;}
 finally{clearTimeout(timer);if(child.exitCode===null&&!child.killed)child.kill('SIGTERM');}
}
try{
 const version=spawnSync(cli,['--version'],{env,encoding:'utf8',timeout:10000});assert.equal(version.status,0);assert.equal(version.stdout.trim(),'codex-cli 0.159.0');
 const result=spawnSync(cli,[...configArgs,'mcp','get','role_host','--json'],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,0);const config=JSON.parse(result.stdout);
 assert.equal(config.enabled,true);assert.equal(config.transport.command,'node');
 assert.deepEqual(config.transport.args,['/opt/role-host-mcp-server.mjs']);assert.deepEqual(config.transport.env_vars,['CODEX_CONNECTORS_TOKEN']);
 assert.equal(config.tool_timeout_sec,360);
 const effective=await readEffectiveConfig();assert.equal(effective.approval_policy,'never');
 const host=effective.mcp_servers.role_host;assert.equal(host.default_tools_approval_mode,'prompt');
 assert.deepEqual(host.tools,{'host.project_inspect':{approval_mode:'approve'},'host.project_check':{approval_mode:'approve'}});
 assert.equal(host.tools['host.project_publish'],undefined);
 const invalid=spawnSync(cli,[...configArgs.map(arg=>arg.replaceAll('approval_mode="approve"','approval_mode="invalid-approval-mode"')),'app-server','--strict-config','--stdio'],{env,encoding:'utf8',timeout:10000});
 assert.equal(invalid.status,1);assert.match(invalid.stderr,/unknown variant.*invalid-approval-mode/s);
 console.log(JSON.stringify({status:'PASS',nativeCli:'0.159.0',roleHostConfigAccepted:true,approvalPolicy:effective.approval_policy,defaultToolsApprovalMode:host.default_tools_approval_mode,approvedTools:Object.keys(host.tools),invalidApprovalRejected:true,modelCalls:0}));
}finally{fs.rmSync(home,{recursive:true,force:true});}
