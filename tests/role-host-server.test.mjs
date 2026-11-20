import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('the task stdio MCP exposes the real broker host directory and call result without provider credentials',{timeout:5000},async t=>{
 const seen=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const m=JSON.parse(raw);seen.push(m.method);assert.equal(req.headers.authorization,'Bearer opaque-task-key');
  const result=m.method==='tools/list'?{tools:[{name:'host.project_inspect',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'actual host result'}]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const child=spawn(process.execPath,['docker/role-host-mcp-server.mjs'],{env:{...process.env,CODEX_CONNECTORS_TOKEN:'opaque-task-key',ROLE_HOST_MCP_ENDPOINT:'http://127.0.0.1:'+server.address().port},stdio:['pipe','pipe','pipe']});t.after(()=>child.kill('SIGTERM'));
 let buffer='',stderr='';const waiting=new Map();child.stderr.on('data',b=>stderr+=b);child.stdout.on('data',b=>{buffer+=b;let n;while((n=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);waiting.get(row.id)?.resolve(row);waiting.delete(row.id);}});
 child.once('exit',code=>{for(const entry of waiting.values())entry.reject(Error('MCP_CHILD_EXIT:'+code));waiting.clear();});
 const rpc=(id,method,params={})=>new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 assert.equal((await rpc(1,'initialize',{protocolVersion:'2024-11-05'})).result.protocolVersion,'2024-11-05');
 assert.equal((await rpc(2,'tools/list')).result.tools[0].name,'host.project_inspect');
 assert.equal((await rpc(3,'tools/call',{name:'host.project_inspect',arguments:{}})).result.content[0].text,'actual host result');
 assert.deepEqual(seen,['tools/list','tools/call']);assert.equal(stderr.includes('opaque-task-key'),false);
});
test('the legacy container stdio script runs when mounted alone without bridge modules',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standalone-host-mcp-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const copied=path.join(root,'role-host-mcp-server.mjs');fs.copyFileSync('docker/role-host-mcp-server.mjs',copied);
 const result=spawnSync(process.execPath,[copied],{encoding:'utf8',timeout:3000,env:{PATH:process.env.PATH,CODEX_CONNECTORS_TOKEN:'opaque-task-token'},input:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}})+'\n'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).result.serverInfo.name,'paperclip-role-host');assert.equal(result.stderr.includes('opaque-task-token'),false);
});
