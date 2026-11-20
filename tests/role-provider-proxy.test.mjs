import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {serveHostCapabilityCalls} from '../bridge/role-host-call-queue.mjs';

test('provider broker rejects wrong token, other routes, other model/session and private TLS targets before upstream', async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-proxy-'));t.after(()=>fs.rmSync(root,{recursive:true}));
 const claims={ 'https://api.openai.com/auth':{chatgpt_account_id:'synthetic'} };
 const jwt='e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.eA';
 fs.writeFileSync(root+'/config.json',JSON.stringify({key:'synthetic-role-key',runId:'synthetic',taskId:'task',projectId:'project',expiresAt:Date.now()+60000,mcpAllowedTools:['github.get_repo'],hostTools:[{name:'host.project_check',inputSchema:{type:'object'}}]}));
 fs.writeFileSync(root+'/auth.json',JSON.stringify({tokens:{access_token:'synthetic-provider-token',id_token:jwt,account_id:'synthetic'}}));
 const child=spawn(process.execPath,['docker/role-provider-proxy.mjs'],{cwd:process.cwd(),env:{...process.env,
  SUPER_AGENT_ROLE_PROXY_ROOT:root,SUPER_AGENT_ROLE_PROXY_AUDIT:root},stdio:'ignore'});
 t.after(()=>child.kill('SIGTERM'));
 let ready=false;for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:8090/');ready=true;break;}catch{await new Promise(r=>setTimeout(r,10));}}
 assert.equal(ready,true);
 const hostPermit={runId:'synthetic',taskId:'task',projectId:'project',effectiveCapabilities:{hostAllowedTools:['host.project_check']}};
 const hostTimer=setInterval(()=>void serveHostCapabilityCalls({root:root+'/host-calls',permit:hostPermit,executor:{execute:async()=>{throw Object.assign(Error('check failed'),{code:'ROLE_HOST_COMMAND_FAILED',details:{exitCode:7,output:'FAIL actual-unit.mjs:8'}});}}}),5);t.after(()=>clearInterval(hostTimer));
 const hostResponse=await fetch('http://127.0.0.1:8090/backend-api/role-host-mcp',{method:'POST',headers:{authorization:'Bearer synthetic-role-key','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:90,method:'tools/call',params:{name:'host.project_check',arguments:{checkId:'fixture'}}})});
 const hostResult=await hostResponse.json();assert.equal(hostResult.result.isError,true);
 const hostError=JSON.parse(hostResult.result.content[0].text);assert.equal(hostError.code,'ROLE_HOST_COMMAND_FAILED');assert.equal(hostError.details.exitCode,7);assert.match(hostError.details.output,/actual-unit.mjs:8/);
 const request=(url,key='synthetic-role-key',session='one',model='wrong-model')=>fetch('http://127.0.0.1:8090'+url,{method:'POST',
  headers:{authorization:'Bearer '+key,session_id:session,'content-type':'application/json'},body:JSON.stringify({model,reasoning:{effort:'low'}})});
 assert.equal((await request('/backend-api/codex/responses','wrong')).status,403);
 assert.equal((await request('/api/companies')).status,403);
  assert.equal((await request('/backend-api/ps/mcp','wrong')).status,403);
  const mcp=await fetch('http://127.0.0.1:8090/backend-api/ps/mcp',{method:'POST',headers:{authorization:'Bearer synthetic-role-key','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sites.delete_site',arguments:{}}})});
  assert.equal(mcp.status,403);assert.match(await mcp.text(),/MCP_ACTION_DENIED/);
  const otherRepo=await fetch('http://127.0.0.1:8090/backend-api/ps/mcp',{method:'POST',headers:{authorization:'Bearer synthetic-role-key','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'github.get_repo',arguments:{repository_full_name:'foreign/private'}}})});
  assert.equal(otherRepo.status,403);assert.match(await otherRepo.text(),/MCP_REPOSITORY_DENIED/);
 assert.equal((await request('/backend-api/codex/responses')).status,403);
 assert.equal((await request('/backend-api/codex/responses','synthetic-role-key','two','gpt-6.1-sol')).status,403);
  assert.equal((await fetch('http://127.0.0.1:8090/backend-api/codex/responses',{method:'POST',headers:{authorization:'Bearer synthetic-role-key','session-id':'two','content-type':'application/json'},body:JSON.stringify({model:'gpt-6.1-sol',reasoning:{effort:'low'}})})).status,403);
 const denied=await new Promise(resolve=>{
  const socket=net.connect(8090,'127.0.0.1',()=>socket.write('CONNECT 127.0.0.1:5432 HTTP/1.1\r\nHost: 127.0.0.1:5432\r\n\r\n'));
  socket.once('data',data=>{socket.destroy();resolve(data.toString());});socket.setTimeout(2000,()=>{socket.destroy();resolve('timeout');});
 });
 assert.match(denied,/403/);
 const audit=fs.readFileSync(root+'/provider.jsonl','utf8');
 assert.equal(audit.includes('synthetic-provider-token'),false);
});
