import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createTaskRuntimeAcceptanceEvidence} from '../bridge/task-runtime-acceptance-evidence.mjs';
import {loadTaskRuntimePool} from '../bridge/task-runtime-router.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),copy=structuredClone,secret='PRIVATE_PROMPT_OR_KEY_MUST_NOT_ESCAPE';
const hasCode=code=>error=>error.code===code&&error.message===code;
function fixture(profileId='minimax_opencode'){
 const profile=RUNTIME_PROFILES[profileId],runId=randomUUID(),taskId=randomUUID(),agentId=randomUUID(),projectId=randomUUID(),files=new Map();let reads=0;
 const json=(name,value)=>files.set(name,Buffer.from(JSON.stringify(value)+'\n'));
 const events=profile.runtime==='codex'?[
  {type:'item.completed',item:{id:'shell-1',type:'command_execution',command:secret,status:'completed',exit_code:0,aggregated_output:secret}},
  {type:'item.completed',item:{id:'write-1',type:'file_change',status:'completed',changes:[{path:'csv.mjs',kind:'update'}]}},
  {type:'turn.completed',usage:{input_tokens:12,output_tokens:8,cached_input_tokens:0}},
 ]:profile.runtime==='claude'?[
  {type:'assistant',message:{content:[{type:'tool_use',id:'tool-1',name:'Bash',input:{command:secret}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:secret}]},tool_use_result:{stdout:secret,stderr:'',interrupted:false}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'tool-2',name:'Write',input:{file_path:'csv.mjs',content:secret}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-2',content:secret}]},tool_use_result:{type:'create',filePath:'csv.mjs'}},
  {type:'result',subtype:'success',is_error:false,total_cost_usd:0,usage:{input_tokens:12,output_tokens:8}},
 ]:[
  {type:'tool_use',part:{callID:'shell-1',tool:'bash',state:{status:'completed',input:{command:secret},output:secret,metadata:{exit:0}}}},
  {type:'tool_use',part:{callID:'write-1',tool:'write',state:{status:'completed',input:{content:secret},output:secret}}},
  {type:'step_finish',part:{reason:'stop',tokens:{input:12,output:8,cache:{read:0,write:0}},cost:0}},
 ];
 const updateStdout=()=>{files.set('stdout',Buffer.from(events.map(event=>JSON.stringify(event)).join('\n')+'\n'));const result=JSON.parse(files.get('result.json')??'{}');result.stdoutSha256=sha(files.get('stdout'));json('result.json',result);};
 files.set('stderr',Buffer.from(''));
 json('result.json',{runId,executor:'macos_native',exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stderrSha256:sha(files.get('stderr'))});updateStdout();
 json('implementation-proof.json',{runId,profileId,modelId:profile.providerModel,runtimeId:profile.runtime,sourceSha256:sha('source'),cliSha256:sha('cli'),argsSha256:sha('args'),configSha256:sha('config'),npmCacheVerified:true,freshSession:true});
 json('native-proof.json',{runId,executor:'macos_native',platform:'darwin',runtimeProfileId:profileId,runtime:profile.runtime,executionPolicy:MACOS_NATIVE_EXECUTION_POLICY,
  process:{pid:123,pgid:123},npmCache:{volumeVerified:true},[profile.runtime+'Path']:'/private/verified-cli'});
 json('process-cleanup.json',{schemaVersion:1,pgid:123,status:'terminated',members:[]});
 json('broker-process.json',{schemaVersion:1,pid:456,pgid:456});json('broker-process-cleanup.json',{schemaVersion:1,pgid:456,status:'terminated',members:[]});
 const audit=[{code:'ROLE_PROXY_READY',runId},profile.runtime==='codex'?{code:'ROLE_PROXY_COMPLETED',path:'/backend-api/codex/responses',status:200,requestCount:1}:
  {code:'ROLE_API_COMPLETED',runId,profileId,provider:profile.provider,model:profile.providerModel,status:200,requestCount:1}];
 const updateAudit=()=>files.set('proxy-audit/provider.jsonl',Buffer.from(audit.map(value=>JSON.stringify(value)).join('\n')+'\n'));updateAudit();
 const run={id:runId,issueId:taskId,agentId,status:'succeeded',exitCode:0,finishedAt:new Date().toISOString(),contextSnapshot:{projectId,forceFreshSession:true},
  usageJson:{inputTokens:12,outputTokens:8,costUsd:0},resultJson:{private:secret}};
 const host=[];
 const ports={readRun:async id=>{assert.equal(id,runId);reads++;return copy(run);},readRunFile:async(id,name)=>{assert.equal(id,runId);if(!files.has(name))throw Error(secret);return files.get(name);},listHostCalls:async id=>{assert.equal(id,runId);return [...host];}};
 const addHost=()=>{const request={runId,taskId,projectId,requestId:'actual-jsonrpc-id',tool:'host.project_inspect',args:{}},requestHash=sha(JSON.stringify(request));host.push(requestHash);
  json('proxy-audit/host-calls/'+requestHash+'/request.json',request);json('proxy-audit/host-calls/'+requestHash+'/result.json',{runId,requestHash,result:{project:{id:projectId}}});return requestHash;};
 return{run,files,ports,events,audit,profileId,runId,taskId,agentId,projectId,json,updateStdout,updateAudit,addHost,get reads(){return reads;},input:{runId,profileId,taskTypes:['execution'],operatorId:'fixture-owner'}};
}

test('real-shaped runtime records derive tool aliases and produce a loadable operator pool without prompt or cost leakage',async()=>{
 for(const profileId of ['codex_subscription','minimax_opencode','deepseek_opencode','minimax_claude']){
  const f=fixture(profileId),built=await createTaskRuntimeAcceptanceEvidence(f.ports)(f.input),map=new Map(built.files.map(item=>[item.file,item.bytes]));
  assert.equal(f.reads,2);assert.deepEqual(built.receipt.tools,['file_write','shell']);assert.deepEqual(built.receipt.taskTypes,['execution']);
  assert.equal(built.registration.id,f.runId);assert.equal(built.registration.implementationSha256,built.receipt.evidence.implementation.sha256);
  assert.ok(!JSON.stringify([...map.values()].map(bytes=>bytes.toString())).includes(secret));assert.ok(!JSON.stringify([...map.values()].map(bytes=>bytes.toString())).includes('costUsd'));
  const pool=await loadTaskRuntimePool({readOperatorRegistrations:async()=>built.index,readAcceptanceEvidence:async ref=>map.get(ref.file)});
  assert.equal(pool.available.length,1);assert.equal(pool.blocked.length,0);assert.equal(pool.available[0].usage.unknownCost,true);
  const request=JSON.parse(map.get(built.receipt.evidence.tools.find(tool=>tool.name==='shell').request.file));
  assert.equal(request.sourceEventSha256,sha(Buffer.from(JSON.stringify(f.events[0]))));
 }
});

test('Host MCP aliases require a real task/project-bound successful request/result receipt',async()=>{
 const f=fixture('deepseek_opencode'),requestHash=f.addHost(),built=await createTaskRuntimeAcceptanceEvidence(f.ports)({...f.input,taskTypes:['research']});
 assert.deepEqual(built.receipt.tools,['file_write','host.project_inspect','shell']);
 const ref=built.receipt.evidence.tools.find(tool=>tool.name==='host.project_inspect'),dto=JSON.parse(built.files.find(item=>item.file===ref.request.file).bytes);
 assert.equal(dto.sourceRequestHash,requestHash);assert.equal(dto.sourceRequestSha256,sha(f.files.get('proxy-audit/host-calls/'+requestHash+'/request.json')));
 for(const change of ['error','run','hash','project']){
  const value=fixture('deepseek_opencode'),id=value.addHost(),name='proxy-audit/host-calls/'+id+'/result.json',result=JSON.parse(value.files.get(name));
  if(change==='error')result.error={code:'HOST_CALL_FAILED'};if(change==='run')result.runId=randomUUID();if(change==='hash')result.requestHash=sha('wrong');
  if(change==='project'){const requestName='proxy-audit/host-calls/'+id+'/request.json',request=JSON.parse(value.files.get(requestName));request.projectId=randomUUID();value.json(requestName,request);}
  value.json(name,result);await assert.rejects(createTaskRuntimeAcceptanceEvidence(value.ports)(value.input));
 }
});

test('success text and arbitrary tool names cannot supply PASS or tools',async()=>{
 const f=fixture();f.events.splice(0,f.events.length,{type:'text',part:{text:JSON.stringify({status:'PASS',tool:'shell',exitCode:0})}},{type:'step_finish',part:{tokens:{input:12,output:8}}});f.updateStdout();
 await assert.rejects(createTaskRuntimeAcceptanceEvidence(f.ports)(f.input),hasCode('TASK_RUNTIME_ACCEPTANCE_TOOLS_NOT_PROVEN'));
 await assert.rejects(createTaskRuntimeAcceptanceEvidence(f.ports)({...f.input,tools:['shell']}),hasCode('TASK_RUNTIME_ACCEPTANCE_INPUT_INVALID'));
});

test('known nonzero, incomplete or unknown shell event formats never become successful tool evidence',async()=>{
 for(const mode of ['nonzero','unknown']){
  const f=fixture();f.events.splice(1,1);if(mode==='nonzero')f.events[0].part.state.metadata.exit=1;else delete f.events[0].part.state.metadata.exit;f.updateStdout();
  await assert.rejects(createTaskRuntimeAcceptanceEvidence(f.ports)(f.input));
 }
 const f=fixture('minimax_claude');f.events[1].message.content[0].is_error=true;f.events.splice(2,2);f.updateStdout();
 await assert.rejects(createTaskRuntimeAcceptanceEvidence(f.ports)(f.input));
});

test('ordinary in-progress OpenCode events are not counted as completion or mistaken for an unknown format',async()=>{
 const f=fixture(),pending=copy(f.events[0]);pending.part.state.status='running';delete pending.part.state.metadata;
 f.events.unshift(pending);f.updateStdout();
 const built=await createTaskRuntimeAcceptanceEvidence(f.ports)(f.input);assert.deepEqual(built.receipt.tools,['file_write','shell']);
 const ref=built.receipt.evidence.tools.find(tool=>tool.name==='shell').request,dto=JSON.parse(built.files.find(file=>file.file===ref.file).bytes);
 assert.equal(dto.sourceLine,2);assert.notEqual(dto.sourceEventSha256,sha(Buffer.from(JSON.stringify(pending))));
});

test('run, stream, implementation, cleanup and broker model proofs must match the actual invocation',async()=>{
 for(const mutate of [f=>{f.run.status='failed';},f=>{f.run.errorCode='NATIVE_FAILURE';},f=>{f.run.usageJson.outputTokens=0;},f=>{f.files.set('stdout',Buffer.from('changed'));},
  f=>{const value=JSON.parse(f.files.get('result.json'));value.outputUnknown=true;f.json('result.json',value);},
  f=>{const value=JSON.parse(f.files.get('implementation-proof.json'));value.freshSession=false;f.json('implementation-proof.json',value);},
  f=>{const value=JSON.parse(f.files.get('native-proof.json'));value.npmCache.volumeVerified=false;f.json('native-proof.json',value);},
  f=>{f.json('process-cleanup.json',{status:'terminated',pgid:999});},f=>{f.json('broker-process-cleanup.json',{status:'unknown',pgid:456});},
  f=>{f.audit[1].model='wrong-model';f.updateAudit();},f=>{f.audit[1].status=401;f.updateAudit();},f=>{f.audit[1].runId=randomUUID();f.updateAudit();}]){
  const f=fixture();mutate(f);await assert.rejects(createTaskRuntimeAcceptanceEvidence(f.ports)(f.input),error=>!error.message.includes(secret));
 }
});

test('live management state is queried again and a changed run cannot be published',async()=>{
 const f=fixture(),read=f.ports.readRun;let calls=0;f.ports.readRun=async id=>{const value=await read(id);if(++calls===2)value.status='running';return value;};
 await assert.rejects(createTaskRuntimeAcceptanceEvidence(f.ports)(f.input),hasCode('TASK_RUNTIME_ACCEPTANCE_RUN_CHANGED'));
});

test('the exact denied optional Codex tooling-state request is recorded as NOT_RUN without granting plugin capability',async()=>{
 const f=fixture('codex_subscription'),path='/backend-api/ps/plugins/tooling-state/turtle';
 f.audit.splice(1,1,...Array.from({length:6},(_,index)=>({code:'ROLE_PROXY_COMPLETED',path:'/backend-api/codex/responses',status:200,requestCount:index+1})),
  ...Array.from({length:7},()=>({code:'ROLE_PROXY_PATH_DENIED',path})));f.updateAudit();
 const built=await createTaskRuntimeAcceptanceEvidence(f.ports)(f.input),model=JSON.parse(built.files.find(file=>file.file===built.receipt.evidence.model.file).bytes);
 assert.equal(model.observed,true);assert.equal(model.sourceEventSha256.length,6);assert.deepEqual(built.receipt.tools,['file_write','shell']);
 assert.equal(model.optionalMetadata.length,1);assert.equal(model.optionalMetadata[0].status,'NOT_RUN');assert.equal(model.optionalMetadata[0].disposition,'denied-as-designed');
 assert.equal(model.optionalMetadata[0].code,'ROLE_PROXY_PATH_DENIED');assert.equal(model.optionalMetadata[0].path,path);assert.equal(model.optionalMetadata[0].count,7);
 assert.equal(model.optionalMetadata[0].sourceEventSha256.length,7);assert.ok(model.optionalMetadata[0].sourceEventSha256.every(value=>/^[a-f0-9]{64}$/.test(value)));
 const files=new Map(built.files.map(item=>[item.file,item.bytes])),pool=await loadTaskRuntimePool({readOperatorRegistrations:async()=>built.index,readAcceptanceEvidence:async ref=>files.get(ref.file)});
 assert.equal(pool.available.length,1);assert.ok(!pool.available[0].tools.some(tool=>tool.includes('plugin')));
});

test('other auth/model/path denials or a different runtime never inherit the optional metadata exception',async()=>{
 const path='/backend-api/ps/plugins/tooling-state/turtle';
 for(const event of [{code:'ROLE_PROXY_TOKEN_DENIED',path},{code:'ROLE_API_MODEL_DENIED',path},
  {code:'ROLE_PROXY_PATH_DENIED',path:path+'2'},{code:'ROLE_PROXY_PATH_DENIED',path:path+'/'},
  {code:'ROLE_PROXY_PATH_DENIED',path:'/backend-api/codex/responses'},
  {code:'ROLE_PROXY_PATH_DENIED',path,runId:randomUUID()},{code:'ROLE_PROXY_PATH_DENIED',path,profileId:'minimax_opencode'}]){
  const f=fixture('codex_subscription');f.audit.push(event);f.updateAudit();
  await assert.rejects(createTaskRuntimeAcceptanceEvidence(f.ports)(f.input),hasCode('TASK_RUNTIME_ACCEPTANCE_AUDIT_DENIAL'));
 }
 const api=fixture();api.audit.push({code:'ROLE_PROXY_PATH_DENIED',path});api.updateAudit();
 await assert.rejects(createTaskRuntimeAcceptanceEvidence(api.ports)(api.input),hasCode('TASK_RUNTIME_ACCEPTANCE_AUDIT_DENIAL'));
});
