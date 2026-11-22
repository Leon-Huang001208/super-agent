import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {runHostTransport} from '../scripts/role-host-transport.mjs';
import {nativeRoleSafeMeta} from '../bridge/native-role-runtime.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY as policy} from '../bridge/role-execution-policy.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const nativeOnly={skip:process.platform!=='darwin'?'macOS process identity requires the target host':false};

function fixture(t,expiresAt){
 const data=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-delegation-'));
 t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const runId=randomUUID(),root=data+'/state/control/research-pm',dir=root+'/transport/'+runId,cwd='/paperclip/control/research-pm/workspaces/delegated';
 for(const folder of [root+'/permits',root+'/claims',root+'/materials',root+'/workspaces/delegated',dir+'/provider'])fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const material='Synthetic delegated Native contract.',input='Read only local fixture metadata.';
 write(root+'/materials/'+runId+'.md',material);
 const permit={schemaVersion:1,runId,taskId:runId,agentId:runId,companyId:runId,projectId:runId,credentialGrantId:runId,
  role:'research',model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:Date.now()+120000,cwd,executionPolicy:policy,
  instructionsFilePath:'/paperclip/control/research-pm/materials/'+runId+'.md',materialSha256:hash(material)};
 const raw=JSON.stringify(permit);write(root+'/permits/'+runId+'.json',raw);write(root+'/claims/'+runId+'.json',{runId,permitSha256:hash(raw)});
 write(dir+'/stdin',input);write(root+'/models-current.json',{models:[{slug:'gpt-6.1-sol'}]});
 const jwt='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic'}})).toString('base64url')+'.eA';
 write(dir+'/provider/auth.json',{delegatedExpiresAt:expiresAt,tokens:{id_token:jwt,access_token:'synthetic-never-forwarded',account_id:'synthetic'}});
 write(dir+'/request.json',{runId,taskId:runId,cwd,home:'/tmp/paperclip-ai-'+runId+'-'+runId+'-fixture/provider',executionPolicy:policy,inputSha256:hash(input),
  args:['--search','exec','--json','--model','gpt-6.1-sol','-c','model_reasoning_effort="low"','--dangerously-bypass-approvals-and-sandbox','-']});
 const fake=data+'/codex',options={dataRoot:data,codexPath:fake,platform:'darwin',
  npmCacheOptions:{cacheRoot:data+'/caches/npm',verifyVolume:async()=>true},pluginCacheOptions:{cacheRoot:data+'/caches/native-plugin-code',verifyVolume:async()=>true}};
 return{data,root,dir,runId,fake,options};
}

test('expired delegated auth rejects before a broker or model process can start',nativeOnly,async t=>{
 const f=fixture(t,Date.now()-1),marker=f.data+'/cli-started';
 fs.writeFileSync(f.fake,'#!'+process.execPath+'\nrequire("node:fs").writeFileSync('+JSON.stringify(marker)+',"started");',{mode:0o700});
 await assert.rejects(runHostTransport(f.runId,f.options),error=>error.code==='ROLE_HOST_DELEGATED_AUTH_EXPIRED');
 assert.equal(fs.existsSync(marker),false);
 for(const name of ['broker-process.json','process.json','result.json','proxy/config.json','proxy/ready.json'])assert.equal(fs.existsSync(f.dir+'/'+name),false,name);
});

test('live delegated auth limits the actual TLS broker and rejects requests after that deadline',
 {...nativeOnly,timeout:12000},async t=>{
 const expiresAt=Date.now()+4000,f=fixture(t,expiresAt);
 // Both requests are local. Even a broken expiry check cannot call an upstream:
 // tools/list is served here, and the later model name is deliberately invalid.
 fs.writeFileSync(f.fake,'#!'+process.execPath+'\n'+String.raw`
const fs=require('node:fs'),path=require('node:path');
process.stdin.resume();process.stdin.on('end',async()=>{try{
 const directory=path.dirname(process.env.CODEX_HOME),config=JSON.parse(fs.readFileSync(directory+'/proxy/config.json','utf8'));
 const endpoint=new URL(process.env.ROLE_HOST_MCP_ENDPOINT),token=process.env.CODEX_CONNECTORS_TOKEN;
 const post=async(url,message)=>{const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'session-id':'fixture','content-type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(3000)});return{status:response.status,body:await response.json()};};
 const before=await post(endpoint,{jsonrpc:'2.0',id:1,method:'tools/list'});
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,`+expiresAt+String.raw`-Date.now()+75)));
 const after=await post(endpoint.origin+'/backend-api/codex/responses',{model:'deliberately-unapproved-model',reasoning:{effort:'low'}});
 console.log(JSON.stringify({type:'result',brokerExpiresAt:config.expiresAt,before,after}));
}catch(error){console.log(JSON.stringify({type:'result',errorCode:error.code??error.name}));process.exitCode=1;}});
`,{mode:0o700});
 const result=await runHostTransport(f.runId,f.options);assert.equal(result.exitCode,0);assert.equal(result.outputUnknown,false);
 const output=read(f.dir+'/stdout');assert.equal(output.errorCode,undefined);
 assert.equal(output.brokerExpiresAt,expiresAt);assert.equal(output.before.status,200);
 assert.equal(output.after.status,403);assert.equal(output.after.body.error.message,'ROLE_PROXY_EXPIRED');
 const audit=fs.readFileSync(f.dir+'/proxy-audit/provider.jsonl','utf8');
 assert.equal(audit.includes('ROLE_PROXY_COMPLETED'),false);assert.equal(audit.includes('synthetic-never-forwarded'),false);
 for(const name of ['process-cleanup.json','broker-process-cleanup.json'])assert.equal(read(f.dir+'/'+name).status,'terminated');
});

test('Native metadata preserves run identifiers and prompt digest without the prompt or task contents',()=>{
 const meta={adapterType:'opencode_local',command:'/opt/super-agent/bin/opencode',prompt:'private task prompt',
  context:{issueId:randomUUID(),taskId:randomUUID(),projectId:randomUUID(),responsibleUserId:'owner',roleOperationId:randomUUID(),
   taskGoal:'private goal',description:'private description',handoff:{body:'private material'},arbitrary:'private arbitrary field'}};
 const original=structuredClone(meta),safe=nativeRoleSafeMeta(meta),encoded=JSON.stringify(safe);
 assert.deepEqual(meta,original);assert.equal(safe.promptSha256,hash(meta.prompt));assert.equal(Object.hasOwn(safe,'prompt'),false);
 assert.deepEqual(safe.context,Object.fromEntries(['issueId','taskId','projectId','responsibleUserId','roleOperationId'].map(key=>[key,meta.context[key]])));
 for(const value of ['private task prompt','private goal','private description','private material','private arbitrary field'])assert.equal(encoded.includes(value),false);
 assert.equal(safe.adapterType,'opencode_local');assert.equal(safe.command,meta.command);
});
