import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {runHostTransport} from '../scripts/role-host-transport.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY as policy} from '../bridge/role-execution-policy.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function fixture(t,profileId){
 const data=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'api-host-state-'));
 const transportRoot=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'api-host-private-'));
 t.after(()=>{fs.rmSync(data,{recursive:true,force:true});fs.rmSync(transportRoot,{recursive:true,force:true});});
 const profile=RUNTIME_PROFILES[profileId],runId=randomUUID(),root=data+'/state/control/research-pm',dir=transportRoot+'/'+runId;
 const cwd='/paperclip/instances/default/projects/'+runId+'/'+runId+'/_default';
 for(const folder of [root+'/permits',root+'/claims',root+'/materials',data+'/state/instances/default/projects/'+runId+'/'+runId+'/_default',dir+'/provider'])fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const material='Synthetic API transport contract. No external model requests.',input='Inspect /workspace/project metadata without provider work.';
 write(root+'/materials/'+runId+'.md',material);
 const permit={schemaVersion:1,runtimeProfileId:profileId,runId,taskId:runId,rootTaskId:runId,agentId:runId,companyId:runId,projectId:runId,credentialGrantId:runId,
  role:'research',model:profile.model,reasoningEffort:null,apiFallback:false,expiresAt:Date.now()+120000,cwd,executionPolicy:policy,
  instructionsFilePath:'/paperclip/control/research-pm/materials/'+runId+'.md',materialSha256:hash(material),
  projectContext:{schemaVersion:1,id:runId,key:'api-transport-fixture',name:'API transport fixture',repository:{hostPath:null},workspace:{hostPath:null},delivery:{maximumAction:'artifact'},checks:[],rules:[],hostMcpServers:[],hostActions:[]},
  effectiveCapabilities:{role:'research',capabilityIds:['research'],hostAllowedTools:['host.project_inspect'],mcpAllowedTools:[],skills:[]}};
 const raw=JSON.stringify(permit);write(root+'/permits/'+runId+'.json',raw);write(root+'/claims/'+runId+'.json',{runId,permitSha256:hash(raw)});
 write(dir+'/stdin',input);write(dir+'/request.json',{runId,taskId:runId,runtimeProfileId:profileId,cwd,executionPolicy:policy,inputSha256:hash(input),
  args:['run','--format','json','--model',profile.model,'--dir',cwd]});
 const syntheticKey='synthetic-private-provider-key-'+runId;write(dir+'/provider/api-auth.json',{runId,runtimeProfileId:profileId,apiKey:syntheticKey});
 return{data,transportRoot,profile,permit,runId,root,dir,cwd,syntheticKey};
}

function fakeCliCode(syntheticKey){
 // The local fake binary never sends an accepted model request. Both provider probes deliberately fail before upstream fetch.
 return'#!'+process.execPath+'\n'+String.raw`
const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
process.stdin.resume();process.stdin.on('end',async()=>{try{
 const config=JSON.parse(fs.readFileSync(process.env.OPENCODE_CONFIG,'utf8')),namespace=config.model.split('/')[0],provider=config.provider[namespace];
 const endpoint=new URL(process.env.ROLE_HOST_MCP_ENDPOINT),token=process.env.PAPERCLIP_ROLE_PROVIDER_TOKEN;
 const post=async(url,body,headers={})=>{const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return{status:response.status,body:await response.json()};};
 const list=await post(endpoint,{jsonrpc:'2.0',id:1,method:'tools/list'});
 const inspect=await post(endpoint,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'host.project_inspect',arguments:{}}});
 const forbidden=await post(endpoint.origin+'/backend-api/codex/responses',{model:'gpt-6.1-sol',input:[]});
 const mismatch=await post(provider.options.baseURL+(namespace==='deepseek'?'/chat/completions':'/messages'),{model:'forbidden-model',messages:[]},provider.options.headers);
 const npm=cp.spawnSync('npm',['config','get','cache'],{encoding:'utf8',cwd:process.env.HOME,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
 const secret=`+JSON.stringify(syntheticKey)+String.raw`;
 console.log(JSON.stringify({type:'result',args:process.argv.slice(2),config,tokenSha256:crypto.createHash('sha256').update(token).digest('hex'),tokenOpaque:/^[a-f0-9]{64}$/.test(token),sameMcpToken:token===process.env.CODEX_CONNECTORS_TOKEN,
  envContainsProviderKey:Object.values(process.env).some(value=>String(value).includes(secret)),configContainsProviderKey:JSON.stringify(config).includes(secret),
  hasAuthFile:fs.existsSync(process.env.CODEX_HOME+'/auth.json'),hasApiKeyEnv:['OPENAI_API_KEY','CODEX_API_KEY','DEEPSEEK_API_KEY','MINIMAX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','SUPER_AGENT_ROLE_PROVIDER_API_KEY'].some(name=>Boolean(process.env[name])),
  endpointProtocol:endpoint.protocol,list,inspect,forbidden,mismatch,npmCache:process.env.NPM_CONFIG_CACHE,npmChildCache:npm.stdout.trim(),npmChildStatus:npm.status,
  home:process.env.HOME,configPath:process.env.OPENCODE_CONFIG,xconfig:process.env.XDG_CONFIG_HOME,nodeCa:process.env.NODE_EXTRA_CA_CERTS}));
 }catch(error){console.log(JSON.stringify({type:'result',failure:error.code??error.message}));process.exitCode=1;}});
`;
}

for(const profileId of ['deepseek_opencode','minimax_opencode'])test('complete '+profileId+' host transport uses private TLS/MCP with no model call',
 {skip:process.platform!=='darwin'?'macOS executable and process identity require the target host':false},async t=>{
 const f=fixture(t,profileId),fake=f.data+'/opencode',npmCacheRoot=f.data+'/caches/npm';
 fs.writeFileSync(fake,fakeCliCode(f.syntheticKey),{mode:0o700});
 const result=await runHostTransport(f.runId,{dataRoot:f.data,transportRoot:f.transportRoot,opencodePath:fake,platform:'darwin',npmCacheOptions:{cacheRoot:npmCacheRoot,verifyVolume:async()=>true}});
 assert.equal(result.exitCode,0);assert.equal(result.signal,null);assert.equal(result.outputUnknown,false);
 const response=read(f.dir+'/stdout'),proof=read(f.dir+'/native-proof.json'),terminal=read(f.dir+'/result.json');
 assert.equal(response.failure,undefined);
 const hostCwd=f.data+'/state/instances/default/projects/'+f.runId+'/'+f.runId+'/_default';
 assert.deepEqual(response.args,['run','--pure','--format','json','--model',f.profile.model,'--dir',hostCwd,'--agent','paperclip']);
 assert.ok(!response.args.some(arg=>/codex|responses|reasoning_effort|--sandbox|bypass/.test(arg)));
 assert.equal(response.tokenOpaque,true);assert.equal(response.sameMcpToken,true);assert.notEqual(response.tokenSha256,hash(f.syntheticKey));
 assert.equal(response.envContainsProviderKey,false);assert.equal(response.configContainsProviderKey,false);assert.equal(response.hasApiKeyEnv,false);assert.equal(response.hasAuthFile,false);
 const namespace=f.profile.model.split('/')[0];assert.deepEqual(response.config.enabled_providers,[namespace]);assert.equal(response.config.provider[namespace].options.apiKey,'{env:PAPERCLIP_ROLE_PROVIDER_TOKEN}');
 assert.equal(response.config.agent.paperclip.model,f.profile.model);assert.deepEqual(response.config.instructions,[]);assert.deepEqual(response.config.plugin,[]);
 assert.equal(response.endpointProtocol,'https:');assert.equal(response.list.status,200);assert.deepEqual(response.list.body.result.tools.map(tool=>tool.name),['host.project_inspect']);
 assert.equal(response.inspect.status,200);assert.notEqual(response.inspect.body.result.isError,true);
 const inspection=JSON.parse(response.inspect.body.result.content[0].text);assert.equal(inspection.project.id,f.runId);assert.equal(inspection.workspace.status,'NOT_CONFIGURED');
 assert.equal(response.forbidden.status,403);assert.equal(response.forbidden.body.error.message,'ROLE_API_PATH_DENIED');
 assert.equal(response.mismatch.status,403);assert.equal(response.mismatch.body.error.message,'ROLE_API_MODEL_DENIED');
 assert.equal(response.npmCache,npmCacheRoot);assert.equal(response.npmChildCache,npmCacheRoot);assert.equal(response.npmChildStatus,0);
 assert.equal(response.home,f.dir+'/client/home');assert.equal(response.configPath,f.dir+'/client/opencode.json');assert.equal(response.xconfig,f.dir+'/client/config');
 assert.equal(response.nodeCa,f.dir+'/proxy/ca.crt');assert.equal(read(f.dir+'/proxy/ready.json').protocol,'https:');
 assert.equal(proof.executor,'macos_native');assert.equal(proof.platform,'darwin');assert.equal(proof.runtimeProfileId,profileId);assert.equal(proof.runtime,'opencode');assert.equal(proof.opencodePath,fake);assert.equal(proof.codexPath,undefined);
 assert.deepEqual(proof.pluginCache,{status:'not_applicable',runtime:'opencode'});assert.equal(proof.npmCache.cacheRoot,npmCacheRoot);assert.equal(proof.npmCache.volumeVerified,true);
 assert.equal(terminal.stdoutSha256,hash(fs.readFileSync(f.dir+'/stdout')));assert.equal(terminal.stderrSha256,hash(fs.readFileSync(f.dir+'/stderr')));
 assert.equal(fs.existsSync(f.root+'/transport'),false,'explicit inner transportRoot must not create a data-root credential copy');
 for(const name of ['process-cleanup.json','broker-process-cleanup.json'])assert.equal(read(f.dir+'/'+name).status,'terminated');
 const broker=read(f.dir+'/broker-process.json');assert.throws(()=>process.kill(broker.pid,0),{code:'ESRCH'});
 for(const file of [f.dir+'/stdout',f.dir+'/stderr',f.root+'/host-transport.jsonl',f.dir+'/client/opencode.json',f.dir+'/proxy-audit/provider.jsonl'])assert.ok(!fs.readFileSync(file,'utf8').includes(f.syntheticKey),file);
 const providerAudit=fs.readFileSync(f.dir+'/proxy-audit/provider.jsonl','utf8');assert.ok(!providerAudit.includes('ROLE_API_REQUEST_AUTHORIZED'));assert.ok(providerAudit.includes('ROLE_API_MODEL_DENIED'));
 for(const file of [f.dir+'/client/auth.json',f.dir+'/proxy/config.json',f.dir+'/proxy/ca.key',f.dir+'/proxy/tls.key'])assert.equal(fs.existsSync(file),false);
});

test('host API binding rejects a different Native request profile before claim or process launch',
 {skip:process.platform!=='darwin'?'host path checks require the target host':false},async t=>{
 const f=fixture(t,'deepseek_opencode'),request=read(f.dir+'/request.json');request.runtimeProfileId='minimax_opencode';write(f.dir+'/request.json',request);
 await assert.rejects(runHostTransport(f.runId,{dataRoot:f.data,transportRoot:f.transportRoot,platform:'darwin'}),{code:'ROLE_HOST_RUNTIME_PROFILE_DENIED'});
 assert.equal(fs.existsSync(f.dir+'/host.claim.json'),false);assert.equal(fs.existsSync(f.dir+'/process.json'),false);
});
