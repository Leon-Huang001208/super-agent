import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {callHostMcp,loadHostMcpServer,runHostCommand} from '../bridge/role-host-mcp.mjs';

const serverCode=String.raw`let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{pending+=chunk;let i;while((i=pending.indexOf('\n'))>=0){let m=JSON.parse(pending.slice(0,i));pending=pending.slice(i+1);if(!m.id)continue;let result;if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(m.method==='tools/list')result={tools:[{name:'read_cell',inputSchema:{type:'object'}},{name:'delete_workbook',inputSchema:{type:'object'}}]};else if(m.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({cell:m.params.arguments.cell,value:42})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');}});`;
const config={command:process.execPath,args:['-e',serverCode],env:{MCP_SECRET:'must-stay-private'}};
const permit={role:'backend-engineer',projectContext:{hostMcpServers:[{id:'excel_relay_dev',tools:['read_cell']}]}};

test('stdio MCP initializes, discovers and calls an allowed existing tool',async()=>{
 const events=[];const result=await callHostMcp({permit,serverId:'excel_relay_dev',toolName:'read_cell',arguments:{cell:'A1'},loadServer:async()=>config,log:event=>events.push(event),timeoutMs:2000});
 assert.deepEqual(JSON.parse(result.content[0].text),{cell:'A1',value:42});
 assert.ok(events.some(x=>x.code==='ROLE_HOST_MCP_COMPLETED'));assert.ok(!JSON.stringify(events).includes('must-stay-private'));
});

test('server and tool allowlists are enforced before starting a server',async()=>{
 const loadServer=async()=>assert.fail('not authorized to load host config');
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay',toolName:'read_cell',arguments:{},loadServer}),/ROLE_HOST_MCP_SERVER_DENIED/);
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay_dev',toolName:'delete_workbook',arguments:{},loadServer}),/ROLE_HOST_MCP_TOOL_DENIED/);
});

test('MCP selected tool must exist in tools/list and config filters cannot be expanded',async()=>{
 const filtered={...config,enabledTools:['other']};
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay_dev',toolName:'read_cell',arguments:{},loadServer:async()=>filtered}),/ROLE_HOST_MCP_TOOL_DENIED/);
 await assert.rejects(callHostMcp({permit:{...permit,projectContext:{hostMcpServers:[{id:'excel_relay_dev',tools:['missing']}]}},serverId:'excel_relay_dev',toolName:'missing',arguments:{},loadServer:async()=>config,timeoutMs:2000}),/ROLE_HOST_MCP_TOOL_UNAVAILABLE/);
});

test('missing dependency, tool error and timeout are explicit without raw server stderr',async()=>{
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay_dev',toolName:'read_cell',arguments:{},loadServer:async()=>({command:'/nonexistent/tool',args:[]}),timeoutMs:200}),error=>error.code==='ROLE_HOST_MCP_START_FAILED'&&!String(error).includes('MCP_SECRET'));
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay_dev',toolName:'read_cell',arguments:{},loadServer:async()=>({command:process.execPath,args:['-e',"process.stderr.write('secret=private');setTimeout(()=>{},5000)"]}),timeoutMs:50}),/ROLE_HOST_MCP_TIMEOUT/);
 const failed=serverCode.replace("result={content:[{type:'text',text:JSON.stringify({cell:m.params.arguments.cell,value:42})}]}","result={isError:true,content:[{type:'text',text:'provider failed'}]}");
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay_dev',toolName:'read_cell',arguments:{},loadServer:async()=>({...config,args:['-e',failed]}),timeoutMs:2000}),/ROLE_HOST_MCP_TOOL_FAILED/);
});

test('host TOML reader selects one server in memory and keeps release and development separate',async()=>{
 let invocation;
 const result=await loadHostMcpServer({serverId:'excel_relay_dev',configPath:'/private/codex/config.toml',runner:(binary,args,options)=>{
  invocation={binary,args,options};return {status:0,stdout:JSON.stringify({command:'/tools/excel-dev',args:['--stdio'],env:{SECRET:'private'},enabledTools:['read_cell'],disabledTools:[]}),stderr:''};
 }});
 assert.equal(invocation.binary,'/opt/homebrew/bin/python3.12');assert.ok(invocation.args.includes('excel_relay_dev'));assert.ok(invocation.args.includes('/private/codex/config.toml'));assert.equal(result.command,'/tools/excel-dev');assert.equal(result.env.SECRET,'private');
});

test('actor cancellation terminates its current local MCP call',async()=>{
 const controller=new AbortController();const pending=callHostMcp({permit,serverId:'excel_relay_dev',toolName:'read_cell',arguments:{},signal:controller.signal,loadServer:async()=>({command:process.execPath,args:['-e','setTimeout(()=>{},5000)']}),timeoutMs:4000});
 setTimeout(()=>controller.abort(),30);await assert.rejects(pending,/ROLE_HOST_MCP_CANCELLED/);
});

test('local MCP tools/list returns only selected real names and input schemas',async()=>{
 const result=await callHostMcp({permit,serverId:'excel_relay_dev',operation:'tools/list',loadServer:async()=>config,timeoutMs:2000});
 assert.deepEqual(result.tools,[{name:'read_cell',inputSchema:{type:'object'}}]);assert.equal(result.serverId,'excel_relay_dev');
 assert.ok(!JSON.stringify(result).includes('must-stay-private'));assert.ok(!JSON.stringify(result).includes('delete_workbook'));
 const filtered=await callHostMcp({permit,serverId:'excel_relay_dev',operation:'tools/list',loadServer:async()=>({...config,disabledTools:['read_cell']}),timeoutMs:2000});assert.deepEqual(filtered.tools,[]);
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay',operation:'tools/list',loadServer:async()=>assert.fail('not authorized')}),/ROLE_HOST_MCP_SERVER_DENIED/);
 await assert.rejects(callHostMcp({permit,serverId:'excel_relay_dev',operation:'server/reconfigure',loadServer:async()=>assert.fail('not authorized')}),/ROLE_HOST_MCP_OPERATION_DENIED/);
});

function descendantFixture(t,{exitWrapper=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'role-host-descendant-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const started=path.join(root,'started'),completed=path.join(root,'completed');
 const descendant=`const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(started)},String(process.pid));setTimeout(()=>{fs.writeFileSync(${JSON.stringify(completed)},'finished');console.log('descendant_finished');process.exit(0)},1800);`;
 const wrapper=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});${exitWrapper?'setTimeout(()=>process.exit(0),20);':''}`;
 const ready=async()=>{for(let i=0;i<100&&!fs.existsSync(started);i++)await delay(10);assert.ok(fs.existsSync(started),'descendant started');return Number(fs.readFileSync(started,'utf8'));};
 const alive=pid=>{try{if(process.platform==='linux')return !/^\d+ \(.+\) Z /.test(fs.readFileSync('/proc/'+pid+'/stat','utf8'));process.kill(pid,0);return true;}catch(error){if(['ENOENT','ESRCH'].includes(error.code))return false;throw error;}};
 return {wrapper,ready,alive,completed};
}

test('cancelling a wrapper kills its SIGTERM-resistant descendants and closes inherited stdio',async t=>{
 const f=descendantFixture(t,{exitWrapper:true}),controller=new AbortController();
 const pending=runHostCommand(process.execPath,['-e',f.wrapper],{signal:controller.signal,timeout:3000});const pid=await f.ready();await delay(50);
 const cancelledAt=Date.now();controller.abort();const result=await pending;
 assert.equal(result.error.code,'ABORT_ERR');assert.ok(Date.now()-cancelledAt<1000,'cancellation must not wait for the descendant task');
 assert.ok(!result.stdout.includes('descendant_finished'));assert.equal(f.alive(pid),false);assert.equal(fs.existsSync(f.completed),false);
});

test('a command timeout kills the whole owned wrapper group',async t=>{
 const f=descendantFixture(t);const startedAt=Date.now(),pending=runHostCommand(process.execPath,['-e',f.wrapper],{timeout:250});const pid=await f.ready();const result=await pending;
 assert.equal(result.error.code,'ETIMEDOUT');assert.ok(Date.now()-startedAt<1200);assert.equal(f.alive(pid),false);assert.ok(!result.stdout.includes('descendant_finished'));
});

test('MCP cancellation cleans descendants even after its launcher has exited',async t=>{
 const f=descendantFixture(t,{exitWrapper:true}),controller=new AbortController();
 const pending=callHostMcp({permit,serverId:'excel_relay_dev',toolName:'read_cell',signal:controller.signal,loadServer:async()=>({command:process.execPath,args:['-e',f.wrapper]}),timeoutMs:3000});const pid=await f.ready();await delay(50);controller.abort();
 await assert.rejects(pending,/ROLE_HOST_MCP_CANCELLED/);assert.equal(f.alive(pid),false);assert.equal(fs.existsSync(f.completed),false);
});
