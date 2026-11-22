import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {createNativeRoleTls} from '../scripts/role-proxy-tls.mjs';
import {createRoleClaudeLaunch} from '../scripts/role-claude-config.mjs';

const binary='/Users/leon/.local/bin/claude';
const skip=process.platform!=='darwin'||!fs.existsSync(binary)?'Requires the installed macOS Claude CLI':false;
const runId='76b07a34-dc94-4290-8c5a-b99fa0e6e055',key='synthetic-local-opaque-key';
const model='MiniMax-M3.1-Flash';
function events(content,stopReason='end_turn'){
 const rows=[['message_start',{type:'message_start',message:{id:'synthetic-message',type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:11,output_tokens:0}}}]];
 for(const[index,block]of content.entries()){
  rows.push(['content_block_start',{type:'content_block_start',index,content_block:block.type==='text'?{type:'text',text:''}:block}]);
  if(block.type==='text')rows.push(['content_block_delta',{type:'content_block_delta',index,delta:{type:'text_delta',text:block.text}}]);
  rows.push(['content_block_stop',{type:'content_block_stop',index}]);
 }
 rows.push(['message_delta',{type:'message_delta',delta:{stop_reason:stopReason,stop_sequence:null},usage:{output_tokens:3}}],['message_stop',{type:'message_stop'}]);
 return rows.map(([event,data])=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n').join('');
}
async function invoke({root,launch,tls,tokenOnly=false}){
 fs.mkdirSync(launch.env.HOME,{recursive:true,mode:0o700});fs.mkdirSync(launch.env.CLAUDE_CONFIG_DIR,{recursive:true,mode:0o700});
 fs.writeFileSync(launch.settingsPath,JSON.stringify(launch.settings),{mode:0o600});fs.writeFileSync(launch.mcpConfigPath,JSON.stringify(launch.mcpConfig),{mode:0o600});
 const env={PATH:process.env.PATH,LANG:'en_US.UTF-8',TERM:'dumb',...launch.env,NODE_EXTRA_CA_CERTS:tls.caFile,SSL_CERT_FILE:tls.trustFile,
  HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'};
 if(tokenOnly){delete env.ANTHROPIC_API_KEY;env.ANTHROPIC_AUTH_TOKEN=key;}
 const child=spawn(binary,launch.args,{cwd:root,env,stdio:['pipe','pipe','pipe'],detached:true});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 child.stdin.end('Synthetic local protocol test. Do not contact external services.');
 const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},20000);
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
 clearTimeout(timer);return result;
}

test('installed bare Claude uses the task CA, opaque SDK key, run header, pinned model and explicit host MCP only',
 {skip,timeout:30000},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'claude-local-protocol-'));let passed=false;
 t.after(()=>{if(passed)fs.rmSync(root,{recursive:true,force:true});});
 for(const name of ['proxy','client'])fs.mkdirSync(root+'/'+name,{mode:0o700});
 const tls=createNativeRoleTls({proxyRoot:root+'/proxy',clientRoot:root+'/client'}),requests=[];
 let modelRequests=0,mcpCalled=false,credentialMode='api-key';
 const server=https.createServer({key:fs.readFileSync(tls.keyFile),cert:fs.readFileSync(tls.certFile)},async(req,res)=>{
  let bytes='';for await(const chunk of req)bytes+=chunk;const body=JSON.parse(bytes);
  requests.push({path:req.url,model:body.model??null,runHeader:req.headers['x-paperclip-run-id']??null,apiKey:req.headers['x-api-key']??null,
   authorization:req.headers.authorization??null,method:body.method??null,toolNames:body.tools?.map(tool=>tool.name)??[]});
  if(req.url==='/backend-api/role-host-mcp'){
   assert.equal(req.headers.authorization,'Bearer '+key);
   const result=body.method==='tools/list'?{tools:[{name:'host.project_inspect',description:'Synthetic local inspection',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:'synthetic-local-inspection'}]};
   if(body.method==='tools/call')mcpCalled=true;
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));return;
  }
  assert.equal(req.url,'/backend-api/model/anthropic/v1/messages?beta=true');assert.equal(body.model,model);
  assert.equal(req.headers['x-paperclip-run-id'],runId);
  if(credentialMode==='api-key')assert.equal(req.headers['x-api-key'],key);
  else {assert.equal(req.headers['x-api-key'],undefined);assert.equal(req.headers.authorization,'Bearer '+key);}
  const tool=body.tools?.find(tool=>tool.name.includes('project_inspect'));
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end(++modelRequests===1&&tool?events([{type:'tool_use',id:'synthetic-tool-use',name:tool.name,input:{}}],'tool_use'):events([{type:'text',text:'SYNTHETIC_PROTOCOL_OK'}]));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const instructionPath=root+'/instructions.md';fs.writeFileSync(instructionPath,'Synthetic trusted run instructions.');
 const launch=createRoleClaudeLaunch({permit:{runId,runtimeProfileId:'minimax_claude',model,
  executionPolicy:{executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'}},client:root+'/client',cwd:root,instructionPath,
  endpoint:'https://127.0.0.1:'+server.address().port+'/backend-api',key,hostTools:[{name:'host.project_inspect'}]});
 fs.mkdirSync(root+'/.claude',{mode:0o700});
 const marker=root+'/untrusted-hook-ran';
 fs.writeFileSync(root+'/.claude/settings.json',JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'touch '+marker}]}]},env:{ANTHROPIC_MODEL:'foreign-model'}}));
 fs.writeFileSync(root+'/.mcp.json',JSON.stringify({mcpServers:{untrusted:{command:'/usr/bin/touch',args:[root+'/untrusted-mcp-ran']}}}));
 const result=await invoke({root,launch,tls});
 fs.writeFileSync(root+'/protocol-result.json',JSON.stringify({code:result.code,signal:result.signal,requests,stdout:result.stdout,stderr:result.stderr},null,2),{mode:0o600});
 assert.equal(result.code,0,'Synthetic local CLI failure retained at '+root);assert.equal(result.signal,null);
 const output=result.stdout.trim().split('\n').map(line=>JSON.parse(line)),terminal=output.find(row=>row.type==='result');
 assert.equal(terminal?.is_error,false);assert.match(terminal.result,/SYNTHETIC_PROTOCOL_OK/);
 assert.equal(modelRequests,2);assert.equal(mcpCalled,true);assert.equal(fs.existsSync(marker),false);assert.equal(fs.existsSync(root+'/untrusted-mcp-ran'),false);
 assert.ok(requests.filter(row=>row.model).every(row=>row.model===model));assert.equal(result.stderr.includes('certificate'),false);
 const beforeTokenOnly=modelRequests;credentialMode='bearer';
 const tokenOnly=await invoke({root,launch,tls,tokenOnly:true});
 assert.equal(tokenOnly.code,0,'This installed bare CLI also accepts an explicit synthetic gateway bearer token');
 assert.equal(modelRequests,beforeTokenOnly+1);assert.match(tokenOnly.stdout,/SYNTHETIC_PROTOCOL_OK/);
 passed=true;
});
