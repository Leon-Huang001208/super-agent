import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeRoleCliArgs,runNativeRoleProcess,hostRolePath,transportExecutor} from '../scripts/role-host-transport.mjs';
const policy={executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'};
test('native CLI has explicit bypass, host paths and isolated configuration without legacy sandbox',()=>{
 const args=nativeRoleCliArgs({permit:{executionPolicy:policy,model:'gpt-6.1-sol'},client:'/private/run/client',instructionPath:'/private/run/instructions/AGENTS.md',endpoint:'https://127.0.0.1:1234/backend-api',hostTools:[]});
 assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
 assert.ok(args.includes('--ignore-user-config'));
 assert.ok(!args.some(x=>x.includes('sandbox_workspace_write')||x==='--sandbox'||x==='workspace-write'));
 assert.ok(args.includes('model_instructions_file="/private/run/instructions/AGENTS.md"'));
 assert.equal(hostRolePath('/paperclip/control/file','/Volumes/Data'),'/Volumes/Data/state/control/file');
 assert.equal(transportExecutor({executionPolicy:policy},{executionPolicy:policy}),'macos_native');
 assert.throws(()=>transportExecutor({}, {executionPolicy:policy}),/POLICY_CHANGED/);
 for(const endpoint of ['http://127.0.0.1:1234/backend-api','https://user@127.0.0.1:1234/backend-api','https://127.0.0.1:1234/backend-api?other=1','https://127.0.0.1:1234/backend-api#other','https://example.com/backend-api'])assert.throws(()=>nativeRoleCliArgs({permit:{executionPolicy:policy,model:'gpt-6.1-sol'},client:'/private/run/client',instructionPath:'/private/run/instructions/AGENTS.md',endpoint}),/BROKER_ENDPOINT_DENIED/);
});

test('native SSE transport stays on the task broker and retains ChatGPT authentication',()=>{
 const endpoint='https://127.0.0.1:1234/backend-api';
 const args=nativeRoleCliArgs({permit:{executionPolicy:policy,model:'gpt-6.1-sol'},client:'/private/run/client',instructionPath:'/private/run/instructions/AGENTS.md',endpoint});
 for(const setting of ['model_provider="paperclip_broker"','model_providers.paperclip_broker.name="Paperclip task broker"','model_providers.paperclip_broker.base_url="'+endpoint+'/codex"','model_providers.paperclip_broker.wire_api="responses"','model_providers.paperclip_broker.requires_openai_auth=true','model_providers.paperclip_broker.supports_websockets=false','chatgpt_base_url="'+endpoint+'"'])assert.ok(args.includes(setting),setting);
 assert.ok(!args.some(value=>/env_key|OPENAI_API_KEY|CODEX_API_KEY|model_providers\.openai\./.test(value)),'no API-key fallback or reserved built-in override');
 assert.equal(args[args.indexOf('--model')+1],'gpt-6.1-sol');
 assert.ok(args.includes('model_reasoning_effort="low"'));
});

test('native process preserves JSON output, filters reasoning, and records process identity',{skip:process.platform!=='darwin'?'macOS process identity requires the target host':false},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-process-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(root+'/stdin','input');
 const result=await runNativeRoleProcess({command:process.execPath,args:['-e','process.stdin.resume();process.stdin.on("end",()=>{console.log(JSON.stringify({type:"reasoning",body:"private"}));console.log(JSON.stringify({type:"result",ok:true}));});'],directory:root,cwd:root,env:{PATH:process.env.PATH},timeoutMs:2000});
 assert.equal(result.exitCode,0);assert.equal(result.signal,null);
 assert.equal(fs.readFileSync(root+'/stdout','utf8').includes('private'),false);
 assert.ok(JSON.parse(fs.readFileSync(root+'/process.json')).pid>0);
 assert.equal(JSON.parse(fs.readFileSync(root+'/stdout')).ok,true);
});

test('native process cancellation terminates only its owned process group',{skip:process.platform!=='darwin'?'macOS process identity requires the target host':false},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-cancel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(root+'/stdin','');
 const timer=setTimeout(()=>fs.writeFileSync(root+'/cancel.json','{}'),80);t.after(()=>clearTimeout(timer));
 const result=await runNativeRoleProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],directory:root,cwd:root,env:{PATH:process.env.PATH},timeoutMs:2000});
 assert.equal(result.cancelled,true);assert.equal(result.signal,null);assert.notEqual(result.exitCode,0);
});

test('native timeout is a terminal failure and invalid JSON is never forwarded as success',{skip:process.platform!=='darwin'?'macOS process identity requires the target host':false},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['timeout','invalid']){fs.mkdirSync(root+'/'+name);fs.writeFileSync(root+'/'+name+'/stdin','');}
 const timeout=await runNativeRoleProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],directory:root+'/timeout',cwd:root,env:{PATH:process.env.PATH},timeoutMs:60});
 assert.equal(timeout.timedOut,true);assert.equal(timeout.exitCode,124);
 const invalid=await runNativeRoleProcess({command:process.execPath,args:['-e','console.log("invalid output");'],directory:root+'/invalid',cwd:root,env:{PATH:process.env.PATH},timeoutMs:2000});
 assert.equal(invalid.outputUnknown,true);assert.notEqual(invalid.exitCode,0);assert.equal(fs.readFileSync(root+'/invalid/stdout','utf8'),'');
});

test('complete host transport consumes the original Native claim and selected subscription without a model call',{skip:process.platform!=='darwin'?'macOS executable and process identity require the target host':false},async t=>{
 const {createHash}=await import('node:crypto');const {runHostTransport}=await import('../scripts/role-host-transport.mjs');
 const data=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-transport-'));t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const runId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',root=data+'/state/control/research-pm',dir=root+'/transport/'+runId,cwd='/paperclip/control/research-pm/workspaces/demo';
 for(const folder of [root+'/permits',root+'/claims',root+'/materials',root+'/workspaces/demo',dir+'/provider'])fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const write=(filename,value)=>fs.writeFileSync(filename,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const material='Fixture role instructions';write(root+'/materials/'+runId+'.md',material);
 const permit={schemaVersion:1,runId,taskId:runId,agentId:runId,companyId:runId,projectId:runId,credentialGrantId:runId,role:'research',model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:Date.now()+120000,cwd,executionPolicy:policy,instructionsFilePath:'/paperclip/control/research-pm/materials/'+runId+'.md',materialSha256:hash(material)};
 const raw=JSON.stringify(permit);write(root+'/permits/'+runId+'.json',raw);write(root+'/claims/'+runId+'.json',{runId,permitSha256:hash(raw)});
 write(dir+'/stdin','Read /workspace/project');write(root+'/models-current.json',{models:[{slug:'gpt-6.1-sol'}]});
 const jwt='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture'}})).toString('base64url')+'.eA';write(dir+'/provider/auth.json',{tokens:{id_token:jwt,access_token:'synthetic'}});
 write(dir+'/request.json',{runId,taskId:runId,cwd,home:'/tmp/paperclip-ai-'+runId+'-'+runId+'-fixture/provider',executionPolicy:policy,inputSha256:hash('Read /workspace/project'),args:['--search','exec','--json','--model','gpt-6.1-sol','-c','model_reasoning_effort="low"','--dangerously-bypass-approvals-and-sandbox','-']});
 const npmCacheRoot=path.join(data,'caches','npm');
 const fake=data+'/codex';fs.writeFileSync(fake,'#!'+process.execPath+'\nprocess.stdin.resume();process.stdin.on("end",async()=>{const args=process.argv.slice(2),endpoint=JSON.parse(args.find(x=>x.startsWith("chatgpt_base_url=")).slice("chatgpt_base_url=".length));const response=await fetch(endpoint+"/role-host-mcp",{method:"POST",headers:{authorization:"Bearer "+process.env.CODEX_CONNECTORS_TOKEN,"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});const body=await response.json();const npm=require("node:child_process").spawnSync("npm",["config","get","cache"],{encoding:"utf8",cwd:process.env.HOME,env:{PATH:process.env.PATH,HOME:process.env.HOME}});console.log(JSON.stringify({type:"result",native:true,args,home:process.env.CODEX_HOME,npmCache:process.env.NPM_CONFIG_CACHE,npmChildCache:npm.stdout.trim(),npmChildStatus:npm.status,endpointProtocol:new URL(endpoint).protocol,tlsStatus:response.status,hostToolCount:body.result.tools.length,trustFile:process.env.SSL_CERT_FILE,codexCa:process.env.CODEX_CA_CERTIFICATE,nodeCa:process.env.NODE_EXTRA_CA_CERTS}));});',{mode:0o700});
 const result=await runHostTransport(runId,{dataRoot:data,codexPath:fake,platform:'darwin',npmCacheOptions:{cacheRoot:npmCacheRoot,verifyVolume:async()=>true}});
 assert.equal(result.exitCode,0);assert.equal(JSON.parse(fs.readFileSync(dir+'/native-proof.json')).executor,'macos_native');
 const response=JSON.parse(fs.readFileSync(dir+'/stdout'));assert.ok(response.args.includes('--dangerously-bypass-approvals-and-sandbox'));assert.equal(response.home,dir+'/client');
 assert.equal(response.npmCache,npmCacheRoot);assert.equal(response.npmChildCache,npmCacheRoot);assert.equal(response.npmChildStatus,0);
 assert.equal(fs.readFileSync(dir+'/client/home/.npmrc','utf8'),'cache='+npmCacheRoot+'\n');assert.equal(fs.existsSync(dir+'/client/home/.npm'),false);
 assert.deepEqual(JSON.parse(fs.readFileSync(dir+'/native-proof.json')).npmCache,{status:'configured',cacheRoot:npmCacheRoot,userConfigPath:dir+'/client/home/.npmrc',volumeVerified:true});
 assert.equal(response.endpointProtocol,'https:');assert.equal(response.tlsStatus,200);assert.equal(response.hostToolCount,0);
 assert.equal(response.trustFile,dir+'/client/trust.pem');assert.equal(response.codexCa,response.trustFile);assert.equal(response.nodeCa,dir+'/proxy/ca.crt');
 assert.equal(fs.existsSync(dir+'/client/auth.json'),false);assert.equal(fs.existsSync(dir+'/proxy/config.json'),false);
 assert.equal(fs.existsSync(dir+'/proxy/ca.key'),false);assert.equal(fs.existsSync(dir+'/proxy/tls.key'),false);
 assert.equal(JSON.parse(fs.readFileSync(dir+'/proxy/ready.json')).protocol,'https:');
 assert.equal(JSON.parse(fs.readFileSync(dir+'/result.json')).stdoutSha256,hash(fs.readFileSync(dir+'/stdout')));
});

test('cancel waits for an owned descendant that ignores TERM after its leader exits',{skip:process.platform!=='darwin'?'macOS process-group identity requires the target host':false},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-descendant-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(root+'/stdin','');
 let descendant; t.after(()=>{if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}});
 const code='const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","process.on(\\\"SIGTERM\\\",()=>{});setInterval(()=>{},1000);"],{stdio:"ignore"});process.on("SIGTERM",()=>process.exit(0));setTimeout(()=>console.log(JSON.stringify({type:"child",pid:c.pid})),150);setInterval(()=>{},1000);';
 const work=runNativeRoleProcess({command:process.execPath,args:['-e',code],directory:root,cwd:root,env:{PATH:process.env.PATH},timeoutMs:4000});
 for(let n=0;n<100&&!descendant;n++){try{const row=fs.readFileSync(root+'/stdout','utf8').trim();if(row)descendant=JSON.parse(row).pid;}catch{}if(!descendant)await new Promise(resolve=>setTimeout(resolve,20));}
 assert.ok(descendant);fs.writeFileSync(root+'/cancel.json','{}');
 const result=await work;assert.equal(result.cancelled,true);
 const {spawnSync}=await import('node:child_process');const probe=spawnSync('/bin/ps',['-p',String(descendant),'-o','stat='],{encoding:'utf8'});
 assert.ok(probe.status!==0||probe.stdout.trim().startsWith('Z'),'owned descendant must stop before returning a terminal result');
 const cleanup=JSON.parse(fs.readFileSync(root+'/process-cleanup.json'));assert.equal(cleanup.status,'terminated');assert.ok(cleanup.members.some(member=>member.pid===descendant));
});

test('a failed process inspector stops its still-owned child and preserves an unknown recovery record',{skip:process.platform!=='darwin'?'macOS process identity requires the target host':false},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-inspection-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(root+'/stdin','');
 await assert.rejects(runNativeRoleProcess({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],directory:root,cwd:root,env:{PATH:process.env.PATH},processInspector:()=>{throw Object.assign(Error('ROLE_HOST_PROCESS_INSPECTION_UNKNOWN'),{code:'ROLE_HOST_PROCESS_INSPECTION_UNKNOWN'});}}),/PROCESS_INSPECTION_UNKNOWN/);
 const recovery=JSON.parse(fs.readFileSync(root+'/process-cleanup.json'));assert.equal(recovery.status,'unknown');assert.equal(recovery.leaderExited,true);
 assert.throws(()=>process.kill(recovery.pid,0),{code:'ESRCH'});assert.equal(fs.existsSync(root+'/result.json'),false);
});
