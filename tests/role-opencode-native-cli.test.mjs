import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {createNativeRoleTls} from '../scripts/role-proxy-tls.mjs';
import {createRoleOpenCodeLaunch} from '../scripts/role-opencode-config.mjs';

const binary='/Users/leon/.npm-global/bin/opencode';
const skip=process.platform!=='darwin'||!fs.existsSync(binary)?'Requires the installed macOS OpenCode CLI':false;
test('installed OpenCode MiniMax SDK uses the exact no-query route and task-local TLS without provider calls',
 {skip,timeout:30000},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'opencode-local-protocol-'));let passed=false;
 t.after(()=>{if(passed)fs.rmSync(root,{recursive:true,force:true});});
 for(const dir of ['proxy','client','workspace'])fs.mkdirSync(root+'/'+dir,{mode:0o700});
 const tls=createNativeRoleTls({proxyRoot:root+'/proxy',clientRoot:root+'/client'});
 const runId='76b07a34-dc94-4290-8c5a-b99fa0e6e055',key='synthetic-local-opencode-token',requests=[];
 const server=https.createServer({key:fs.readFileSync(tls.keyFile),cert:fs.readFileSync(tls.certFile)},async(req,res)=>{
  let bytes='';for await(const chunk of req)bytes+=chunk;const body=JSON.parse(bytes);
  requests.push({path:req.url,model:body.model,run:req.headers['x-paperclip-run-id'],token:req.headers['x-api-key']});
  const message={id:'synthetic-opencode',type:'message',role:'assistant',model:'MiniMax-M3.1-Flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:11,output_tokens:0}};
  const events=[['message_start',{type:'message_start',message}],
   ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
   ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'SYNTHETIC_OPENCODE_OK'}}],
   ['content_block_stop',{type:'content_block_stop',index:0}],
   ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
   ['message_stop',{type:'message_stop'}]];
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(([event,data])=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n').join(''));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const launch=createRoleOpenCodeLaunch({permit:{runId,runtimeProfileId:'minimax_opencode',model:'minimax-cn-coding-plan/MiniMax-M3.1-Flash',
  executionPolicy:{executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'}},client:root+'/client',cwd:root+'/workspace',
  endpoint:'https://127.0.0.1:'+server.address().port+'/backend-api',key});
 for(const dir of [launch.env.HOME,launch.env.OPENCODE_CONFIG_DIR,path.join(launch.env.OPENCODE_CONFIG_DIR,'node_modules')])fs.mkdirSync(dir,{recursive:true,mode:0o700});
 fs.writeFileSync(launch.env.OPENCODE_CONFIG,JSON.stringify(launch.config),{mode:0o600});
 fs.writeFileSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'package.json'),'{}');
 fs.writeFileSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{dependencies:{'@opencode-ai/plugin':'1.19.6'}}}}));
 const child=spawn(binary,launch.args,{cwd:root+'/workspace',env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',...launch.env,
  NODE_EXTRA_CA_CERTS:tls.caFile,SSL_CERT_FILE:tls.trustFile,OPENCODE_DISABLE_MODELS_FETCH:'1',
  HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost',
  npm_config_registry:'http://127.0.0.1:9',npm_config_offline:'true',npm_config_fetch_retries:'0',npm_config_fetch_timeout:'500'},
  stdio:['pipe','pipe','pipe'],detached:true});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 child.stdin.end('Synthetic local transport protocol test.');
 const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},20000);
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
 fs.writeFileSync(root+'/protocol-result.json',JSON.stringify({result,requests,stdout,stderr},null,2),{mode:0o600});
 assert.equal(result.code,0,'Synthetic local CLI failure retained at '+root);assert.equal(result.signal,null);
 assert.ok(requests.length>0);for(const request of requests)assert.deepEqual(request,{path:'/backend-api/model/anthropic/v1/messages',model:'MiniMax-M3.1-Flash',run:runId,token:key});
 assert.match(stdout,/SYNTHETIC_OPENCODE_OK/);assert.equal(stderr.includes('certificate'),false);
 assert.deepEqual(fs.readdirSync(path.join(launch.env.OPENCODE_CONFIG_DIR,'node_modules')),[],'no dependency is installed');
 passed=true;
});
