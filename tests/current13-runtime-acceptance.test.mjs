import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {TEAM_ROLES} from '../bridge/team-roles.mjs';
import {reserveAcceptanceTask} from '../scripts/multi-runtime-acceptance.mjs';
import {FEATURE_STUB,FEATURE_TESTS,HTTP_STUB,HTTP_TESTS,PREFERENCES_STUB,PREFERENCES_TESTS,
 createCurrent13Acceptance,validateCurrent13RunEvidence,snapshotCurrent13Handoff,verifyCurrent13Handoff,validateCurrent13CrossCheck,validateCurrent13ActorClosure,prepareCurrent13Wake,
 CURRENT13_FIXED_INPUTS,current13FixedInputHashes,validateCurrent13FrozenInputs,validateCurrent13ResumePlan,finalizeCurrent13StepBoundary,revalidateCurrent13PassedStep,parseCurrent13AcceptanceArgs} from '../scripts/current13-runtime-acceptance.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function history(){
 const agentIds=Object.fromEntries(Object.keys(TEAM_ROLES).filter(role=>role!=='full-stack-engineer').map(role=>[role,randomUUID()]));
 const plan={schemaVersion:1,kind:'isolated-native-multi-runtime',status:'PASS',companyId:randomUUID(),projectId:randomUUID(),workspaceId:randomUUID(),rootTaskId:randomUUID(),rootInputRevision:'a'.repeat(64),agentIds,maximumCalls:20,maximumResponsesPerRun:64,callsSpent:6,
  steps:['backend-engineer','backend-engineer','research','pm','qa'].map(role=>({role,taskId:randomUUID(),agentId:agentIds[role],operationId:randomUUID(),runId:randomUUID(),status:'PASS',artifacts:[{file:'old.md',sha256:'b'.repeat(64)}]}))};
 plan.steps[1].taskId=plan.steps[0].taskId;return plan;
}
test('current13 planning preserves historical company/root/old identities and allocates only concrete new child requirements',()=>{
 const historical=history(),before=structuredClone(historical),agentIds={...historical.agentIds,'full-stack-engineer':randomUUID()};
 const plan=createCurrent13Acceptance({historical,historicalReportSha256:'c'.repeat(64),agentIds});
 assert.deepEqual(historical,before);for(const field of ['companyId','projectId','workspaceId','rootTaskId','rootInputRevision'])assert.equal(plan[field],historical[field]);
 assert.deepEqual(plan.agentIds,agentIds);assert.equal(plan.steps.length,6);assert.equal(plan.callsSpentBefore,6);assert.equal(plan.maximumCalls,20);
 assert.deepEqual(plan.steps.map(step=>step.runtimeProfileId),['minimax_opencode','codex_subscription','minimax_claude','deepseek_claude','deepseek_opencode','codex_subscription']);
 const[from,to]=plan.steps;assert.equal(from.role,'full-stack-engineer');assert.equal(to.role,'backend-engineer');assert.equal(from.taskId,to.taskId);assert.notEqual(from.agentId,to.agentId);
 assert.equal(to.handoffFromOperationId,from.operationId);assert.equal(plan.steps[5].taskId,historical.steps[4].taskId);
 assert.ok(plan.steps.every(step=>step.status==='NOT_RUN'&&step.goal&&!step.runId));assert.equal(plan.historicalMatrix.reportSha256,'c'.repeat(64));
 assert.ok(plan.steps.slice(0,5).every(step=>!historical.steps.some(old=>old.taskId===step.taskId)));
 assert.equal(plan.productionDeployment,'NOT_RUN');assert.equal(plan.automaticDispatch,'NOT_RUN');
 assert.throws(()=>createCurrent13Acceptance({historical:{...historical,status:'FAILED'},historicalReportSha256:'c'.repeat(64),agentIds}),/CURRENT13_HISTORY_DENIED/);
 assert.throws(()=>createCurrent13Acceptance({historical,historicalReportSha256:'c'.repeat(64),agentIds:{...agentIds,research:randomUUID()}}),/CURRENT13_HISTORY_DENIED/);
});

const FEATURE_REFERENCE=`const valid=o=>o&&typeof o==='object'&&!Array.isArray(o);export function normalizeItem(o){if(!valid(o)||typeof o.id!=='string'||!o.id.trim()||typeof o.label!=='string'||!o.label.trim()||o.done!==undefined&&typeof o.done!=='boolean')throw new TypeError('invalid');return{id:o.id.trim(),label:o.label.trim(),done:o.done??false};}const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));export function renderItem(o){const x=normalizeItem(o);return '<li data-id="'+escape(x.id)+'"><span>'+escape(x.label)+'</span><input type="checkbox" disabled'+(x.done?' checked':'')+'></li>';}export function toggleItem(o){const x=normalizeItem(o);return{...x,done:!x.done};}`;
const HTTP_REFERENCE=`import http from 'node:http';import{randomUUID}from'node:crypto';import{normalizeItem,renderItem}from'./item-feature.mjs';export function createItemServer(){const items=[];return http.createServer(async(req,res)=>{const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};if(req.url!=='/items')return json(404,{error:'not found'});if(req.method==='GET'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><ul>'+items.map(renderItem).join('')+'</ul>');return;}if(req.method!=='POST')return json(405,{error:'method'});let body=Buffer.alloc(0);for await(const part of req){body=Buffer.concat([body,part]);if(body.length>8192){json(413,{error:'large'});return;}}try{const parsed=JSON.parse(body.toString());if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('bad');const item=normalizeItem({...parsed,id:randomUUID()});items.push(item);json(201,item);}catch{json(400,{error:'invalid'});}});}`;
const PREFERENCE_REFERENCE=`export function normalizePreferences(o={}){if(!o||typeof o!=='object'||Array.isArray(o))throw new TypeError('invalid');const value={theme:o.theme??'light',compact:o.compact??false,locale:o.locale??'en'};if(!['light','dark'].includes(value.theme)||typeof value.compact!=='boolean'||!['en','zh-CN'].includes(value.locale))throw new TypeError('invalid');return value;}export function mergePreferences(a,b){if(!b||typeof b!=='object'||Array.isArray(b))throw new TypeError('invalid');return normalizePreferences({...normalizePreferences(a),...b});}`;
test('fixed 8 feature, 4 HTTP and 5 preferences checks reject stubs and pass deterministic local reference behavior',()=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'current13-fixed-contract-'));
 try{
  const write=(name,text)=>fs.writeFileSync(path.join(root,name),text);
  for(const[file,text]of Object.entries({'item-feature.test.mjs':FEATURE_TESTS,'item-http.test.mjs':HTTP_TESTS,'item-preferences.test.mjs':PREFERENCES_TESTS}))write(file,text);
  const run=(suite,count)=>{const env={PATH:process.env.PATH,LANG:'en_US.UTF-8'};const result=spawnSync(process.execPath,['--test','--test-reporter=tap',suite],{cwd:root,encoding:'utf8',env,timeout:15000,maxBuffer:1048576});return{...result,count};};
  write('item-feature.mjs',FEATURE_STUB);assert.notEqual(run('item-feature.test.mjs',8).status,0);
  write('item-feature.mjs',FEATURE_REFERENCE);const feature=run('item-feature.test.mjs',8);assert.equal(feature.status,0,feature.stdout);assert.match(feature.stdout,/# pass 8\b/);
  write('item-http.mjs',HTTP_STUB);assert.notEqual(run('item-http.test.mjs',4).status,0);
  write('item-http.mjs',HTTP_REFERENCE);const http=run('item-http.test.mjs',4);assert.equal(http.status,0,http.stdout);assert.match(http.stdout,/# pass 4\b/);
  write('item-preferences.mjs',PREFERENCES_STUB);assert.notEqual(run('item-preferences.test.mjs',5).status,0);
  write('item-preferences.mjs',PREFERENCE_REFERENCE);const preferences=run('item-preferences.test.mjs',5);assert.equal(preferences.status,0,preferences.stdout);assert.match(preferences.stdout,/# pass 5\b/);
  assert.equal(fs.readFileSync(root+'/item-feature.test.mjs','utf8'),FEATURE_TESTS);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

function proofFixture(profileId='minimax_claude'){
 const agentId=randomUUID(),taskId=randomUUID(),runId=randomUUID();
 const step={runtimeProfileId:profileId,agentId,taskId,runId};
 const profile={minimax_claude:['MiniMax-M3.1-Flash','claude'],deepseek_opencode:['deepseek-flash','opencode'],codex_subscription:['gpt-6.1-sol','codex']}[profileId];
 return{step,run:{id:runId,issueId:taskId,agentId,status:'succeeded',exitCode:0,finishedAt:new Date()},
  transport:{runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false},processCleanup:{status:'terminated'},brokerCleanup:{status:'terminated'},
  implementation:{runId,profileId,modelId:profile[0],runtimeId:profile[1],sourceSha256:'a'.repeat(64),cliSha256:'b'.repeat(64),freshSession:true},
  providerEvents:profileId==='codex_subscription'?[{code:'ROLE_PROXY_COMPLETED',path:'/backend-api/codex/responses',status:200}]:[{code:'ROLE_API_REQUEST_AUTHORIZED',runId,profileId,model:profile[0],requestCount:1},{code:'ROLE_API_COMPLETED',runId,profileId,model:profile[0],requestCount:1,status:200}]};
}
test('run evidence requires a real terminal identity, closed transport, fresh implementation and successful fixed-model broker events',()=>{
 for(const profileId of ['minimax_claude','deepseek_opencode','codex_subscription']){
  const input=proofFixture(profileId);assert.equal(validateCurrent13RunEvidence(input).observed,true);
  for(const changes of [{run:{...input.run,status:'running'}},{run:{...input.run,agentId:randomUUID()}},{transport:{...input.transport,outputUnknown:true}},
   {processCleanup:{status:'unknown'}},{brokerCleanup:{status:'unknown'}},{implementation:{...input.implementation,freshSession:false}},
   {implementation:{...input.implementation,modelId:'other'}},{providerEvents:[]}])assert.throws(()=>validateCurrent13RunEvidence({...input,...changes}),/CURRENT13_/);
 }
});
test('only the exact Codex optional tooling-state denial is classified without granting the path',()=>{
 const input=proofFixture('codex_subscription'),optional={code:'ROLE_PROXY_PATH_DENIED',path:'/backend-api/ps/plugins/tooling-state/turtle'};
 input.providerEvents=[...Array.from({length:6},()=>input.providerEvents[0]),...Array.from({length:7},()=>({...optional}))];
 const observed=validateCurrent13RunEvidence(input);
 assert.equal(observed.requestCount,6);assert.equal(observed.optionalPluginState,'DENIED_AS_DESIGNED/NOT_RUN');assert.equal(observed.optionalPluginDenials,7);
 for(const event of [{...optional,path:optional.path+'?x=1'},{...optional,path:optional.path+'/other'},{...optional,code:'ROLE_PROXY_TOKEN_DENIED'},
  {code:'ROLE_API_MODEL_DENIED'},{code:'ROLE_API_UPSTREAM_HTTP_ERROR',status:401}])assert.throws(()=>validateCurrent13RunEvidence({...input,providerEvents:[input.providerEvents[0],event]}),/CURRENT13_BROKER_EVIDENCE_DENIED/);
 const api=proofFixture('minimax_claude');assert.throws(()=>validateCurrent13RunEvidence({...api,providerEvents:[...api.providerEvents,optional]}),/CURRENT13_BROKER_EVIDENCE_DENIED/);
});
test('role-transfer snapshot keeps the same task/root, old owner artifacts and cumulative budget hashes without reusing sessions',()=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'current13-transfer-'));
 try{
  const historical=history(),agentIds={...historical.agentIds,'full-stack-engineer':randomUUID()},plan=createCurrent13Acceptance({historical,historicalReportSha256:'c'.repeat(64),agentIds});
  const[from,to]=plan.steps;from.runId=randomUUID();from.status='PASS';fs.writeFileSync(root+'/item-feature.mjs','old original bytes');
  const artifacts=[{file:'item-feature.mjs',sha256:sha('old original bytes'),taskId:from.taskId,runId:from.runId}],budget=[{operationId:from.operationId,sha256:'a'.repeat(64)}];
  const receipt=snapshotCurrent13Handoff({cwd:root,rootTaskId:plan.rootTaskId,from,to,artifacts,budget});
  assert.equal(receipt.handoffKind,'role-transfer');assert.equal(receipt.fromAgentId,from.agentId);assert.equal(receipt.toAgentId,to.agentId);assert.equal(receipt.taskId,to.taskId);
  assert.deepEqual(receipt.budget.records,budget);fs.writeFileSync(root+'/item-feature.mjs','new bytes');assert.equal(verifyCurrent13Handoff({cwd:root,receipt}),true);
  assert.equal(fs.readFileSync(path.join(root,receipt.artifacts[0].file),'utf8'),'old original bytes');
  assert.throws(()=>snapshotCurrent13Handoff({cwd:root,rootTaskId:plan.rootTaskId,from,to:{...to,taskId:randomUUID()},artifacts,budget}),/CURRENT13_HANDOFF_DENIED/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('cross-check reports bind fixed input source hashes and distinguish actual facts from assumptions and unknowns',()=>{
 const sources=[{file:'item-feature.mjs',sha256:'a'.repeat(64)}],report={sources,facts:['fixture fact'],assumptions:[],unknowns:['UI NOT_RUN'],hostInspection:{tool:'host.project_inspect'}};
 assert.equal(validateCurrent13CrossCheck(report,sources),report);
 for(const change of [{sources:[]},{sources:[{...sources[0],sha256:'b'.repeat(64)}]},{facts:undefined},{unknowns:undefined},{hostInspection:{tool:'unverified'}}])assert.throws(()=>validateCurrent13CrossCheck({...report,...change},sources),/CURRENT13_CROSSCHECK_DENIED/);
});
test('Native owner closure is its verified object contract, never a caller boolean or an open actor',()=>{
 const scope={taskId:randomUUID(),agentId:randomUUID()},proof={...scope,closed:true,nativeExecutionStopVerified:true,activeRunIds:[],proofs:[]};
 assert.equal(validateCurrent13ActorClosure(proof,scope),proof);
 for(const bad of [true,{...proof,closed:false},{...proof,agentId:randomUUID()},{...proof,nativeExecutionStopVerified:false},{...proof,activeRunIds:[randomUUID()]}])assert.throws(()=>validateCurrent13ActorClosure(bad,scope),/CURRENT13_PREVIOUS_OWNER_OPEN/);
});
test('shared admission permits an explicit fifteen-minute busy wait without extending the default or touching another owner',async()=>{
 let now=0,reserves=0,storage=0;const taskId=randomUUID(),projectId=randomUUID();
 const input={taskId,projectId,readStorage:()=>({version:++storage}),meter:{reserveTask(request){
  reserves++;assert.equal(request.taskId,taskId);assert.equal(request.projectId,projectId);assert.equal(request.storageReceipt.version,reserves);
  if(reserves===1)throw Object.assign(Error('busy'),{code:'ADMISSION_BUSY'});return{allowed:true,nonce:'synthetic-own-lease'};
 }}};
 const lease=await reserveAcceptanceTask(input,{timeoutMs:900000,clock:()=>now,wait:async()=>{now=899999;}});
 assert.equal(lease.nonce,'synthetic-own-lease');assert.equal(reserves,2);assert.equal(storage,2);
 await assert.rejects(reserveAcceptanceTask(input,{timeoutMs:900001}),{code:'MULTI_RUNTIME_ADMISSION_WAIT_DENIED'});
 for(const timeoutMs of [undefined,900000]){
  now=0;let attempts=0;
  await assert.rejects(reserveAcceptanceTask({taskId,projectId,readStorage:()=>({}),meter:{reserveTask(){attempts++;throw Object.assign(Error('busy'),{code:'ADMISSION_BUSY'});}}},
   {clock:()=>now,wait:async()=>{now=timeoutMs??180000;},...(timeoutMs===undefined?{}:{timeoutMs})}),{code:'MULTI_RUNTIME_ADMISSION_BUSY_TIMEOUT'});
  assert.equal(attempts,1);
 }
});
test('Codex wake preparation awaits the lease-scoped delegation port before resetting, managing or waking a session',async()=>{
 const events=[],step={runtimeProfileId:'codex_subscription',agentId:randomUUID(),taskId:randomUUID()},route={id:randomUUID()};
 let permitRenewal;const renewal=new Promise(resolve=>{permitRenewal=resolve;});
 const fixture={ensureAcceptanceDelegation:async(value,options)=>{assert.equal(value,step);assert.deepEqual(options,{minimumRemainingMs:210000,timeoutMs:120000});events.push('renew');await renewal;events.push('renewed');},
  heartbeat:{resetRuntimeSession:async(agentId,options)=>{assert.equal(agentId,step.agentId);assert.deepEqual(options,{taskKey:step.taskId});events.push('reset');},wakeup:async()=>events.push('wake')},
  managedWake:async(value,selection)=>{assert.equal(value,step);assert.equal(selection,route);events.push('managed');return'managed-marker';}};
 const pending=prepareCurrent13Wake({fixture,step,route,onSessionReset:()=>events.push('ready')});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['renew']);permitRenewal();
 assert.equal(await pending,'managed-marker');await fixture.heartbeat.wakeup();assert.deepEqual(events,['renew','renewed','reset','ready','managed','wake']);
 const absent={heartbeat:fixture.heartbeat,managedWake:fixture.managedWake};
 await assert.rejects(prepareCurrent13Wake({fixture:absent,step,route}),{code:'CURRENT13_DELEGATION_PORT_REQUIRED'});
});
test('API runtimes prepare fresh sessions without requesting subscription delegation',async()=>{
 for(const runtimeProfileId of ['minimax_opencode','deepseek_opencode','minimax_claude','deepseek_claude']){
  const events=[],step={runtimeProfileId,agentId:randomUUID(),taskId:randomUUID()},fixture={
   ensureAcceptanceDelegation:async()=>assert.fail('API execution must not issue a member delegation RPC'),
   heartbeat:{resetRuntimeSession:async()=>events.push('reset')},managedWake:async()=>{events.push('managed');return'marker';}};
  assert.equal(await prepareCurrent13Wake({fixture,step,route:{}}),'marker');assert.deepEqual(events,['reset','managed']);
 }
});
test('closed Backend success is finalized with actual fixed 8+4 checks and immutable source proofs, without a model or wake port',()=>{
 const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'current13-boundary-'));
 try{
  const root=temporary+'/control',cwd=temporary+'/workspace';fs.mkdirSync(root);fs.mkdirSync(cwd);
  const historical=history(),plan=createCurrent13Acceptance({historical,historicalReportSha256:'c'.repeat(64),agentIds:{...historical.agentIds,'full-stack-engineer':randomUUID()}}),step=plan.steps[1];
  step.runId=randomUUID();step.status='RUNNING';
  for(const[file,text]of Object.entries({...CURRENT13_FIXED_INPUTS,'item-feature.mjs':FEATURE_REFERENCE,'item-http.mjs':HTTP_REFERENCE,'item-preferences.mjs':PREFERENCES_STUB,'backend13.json':'{}'}))fs.writeFileSync(path.join(cwd,file),text,{mode:0o600});
  plan.fixedInputs=current13FixedInputHashes();plan.featureSha256=sha(FEATURE_REFERENCE);assert.equal(validateCurrent13FrozenInputs({cwd,references:plan.fixedInputs}),true);
  const directory=root+'/transport/'+step.runId;fs.mkdirSync(directory+'/proxy-audit',{recursive:true});
  const write=(name,value)=>fs.writeFileSync(directory+'/'+name,JSON.stringify(value)+'\n',{mode:0o600});
  fs.writeFileSync(directory+'/stdout','synthetic transport metadata\n');fs.writeFileSync(directory+'/stderr','');
  const current={id:step.runId,companyId:plan.companyId,responsibleUserId:'owner',issueId:step.taskId,agentId:step.agentId,status:'succeeded',exitCode:0,startedAt:new Date(1000),finishedAt:new Date(2000),resultJson:{}};
  write('result.json',{runId:step.runId,exitCode:0,signal:null,timedOut:false,cancelled:false,outputUnknown:false,stdoutSha256:sha(fs.readFileSync(directory+'/stdout')),stderrSha256:sha('')});
  write('implementation-proof.json',{runId:step.runId,profileId:'codex_subscription',modelId:'gpt-6.1-sol',runtimeId:'codex',sourceSha256:'a'.repeat(64),cliSha256:'b'.repeat(64),freshSession:true});
  write('native-proof.json',{runId:step.runId,executor:'macos_native',platform:'darwin',executionPolicy:{executor:'macos_native'}});
  write('process-cleanup.json',{status:'terminated'});write('broker-process-cleanup.json',{status:'terminated'});
  fs.writeFileSync(directory+'/proxy-audit/provider.jsonl',[{code:'ROLE_PROXY_COMPLETED',path:'/backend-api/codex/responses',status:200},
   {code:'ROLE_PROXY_PATH_DENIED',path:'/backend-api/ps/plugins/tooling-state/turtle'}].map(value=>JSON.stringify(value)).join('\n')+'\n');
  const budgetDirectory=root+'/budget/'+plan.rootTaskId;fs.mkdirSync(budgetDirectory,{recursive:true});
  const values=Array.from({length:7},()=>({id:randomUUID(),taskId:randomUUID(),agentId:randomUUID(),role:'research'}));
  const beforeBudget=values.map(value=>{const bytes=JSON.stringify(value)+'\n';fs.writeFileSync(budgetDirectory+'/'+value.id+'.json',bytes,{mode:0o600});return{operationId:value.id,taskId:value.taskId,agentId:value.agentId,role:value.role,sha256:sha(bytes)};});
  const own={id:step.operationId,taskId:step.taskId,agentId:step.agentId,role:step.role};fs.writeFileSync(budgetDirectory+'/'+own.id+'.json',JSON.stringify(own)+'\n',{mode:0o600});
  const after=finalizeCurrent13StepBoundary({plan,step,current,ownerId:'owner',cwd,root,beforeBudget});
  assert.equal(after.length,8);assert.deepEqual(step.testing.map(value=>[value.exitCode,value.count]),[[0,8],[0,4]]);
  assert.equal(step.optionalPluginState,'DENIED_AS_DESIGNED/NOT_RUN');assert.equal(step.status,'RUNNING','the caller, not this boundary, commits phase state');
  step.status='PASS';assert.equal(revalidateCurrent13PassedStep({plan,step,current,ownerId:'owner',cwd,root}),true);
  const before=fs.readdirSync(root+'/current13-evidence/'+step.operationId).sort();
  assert.equal(revalidateCurrent13PassedStep({plan,step,current,ownerId:'owner',cwd,root}),true);assert.deepEqual(fs.readdirSync(root+'/current13-evidence/'+step.operationId).sort(),before);
  fs.writeFileSync(cwd+'/item-http.mjs','changed');assert.throws(()=>revalidateCurrent13PassedStep({plan,step,current,ownerId:'owner',cwd,root}),/ARTIFACT_CHANGED/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
test('partial resume validates a contiguous successful prefix and never accepts future started, failed or identity-replaced work',()=>{
 const historical=history(),plan=createCurrent13Acceptance({historical,historicalReportSha256:'c'.repeat(64),agentIds:{...historical.agentIds,'full-stack-engineer':randomUUID()}});
 plan.status='PARTIAL_VALIDATED';plan.callsSpent=8;plan.rootCallsSpent=8;plan.budgetRecords=Array.from({length:8},()=>({operationId:randomUUID(),sha256:'a'.repeat(64)}));
 for(const step of plan.steps.slice(0,2))Object.assign(step,{status:'PASS',runId:randomUUID(),nativeEvidence:{status:'succeeded'},artifacts:[{file:'fixture.md',sha256:'a'.repeat(64)}],modelEvidence:{observed:true},implementationProof:{file:'fixture.json'},testing:[]});
 assert.equal(validateCurrent13ResumePlan(plan),2);
 for(const mutate of [value=>{value.steps[2].runId=randomUUID();},value=>{value.steps[1].status='failed';},value=>{value.steps[2].status='RUNNING';},
  value=>{value.callsSpent=9;},value=>{value.steps[2].agentId=randomUUID();},value=>{value.rootTaskId='wrong';}]){
  const changed=structuredClone(plan);mutate(changed);assert.throws(()=>validateCurrent13ResumePlan(changed),/CURRENT13_RESUME_/);
 }
});
test('historical source transition is an explicit resume-only CLI option and never changes the pure finalizer mode',()=>{
 assert.deepEqual(parseCurrent13AcceptanceArgs(['--resume-current13','--allow-historical-source-transition','--input','private.json']),{mode:'resume',inputFile:'private.json',allowHistoricalSourceTransition:true});
 assert.deepEqual(parseCurrent13AcceptanceArgs(['--resume-current13','--input','private.json']),{mode:'resume',inputFile:'private.json',allowHistoricalSourceTransition:false});
 assert.deepEqual(parseCurrent13AcceptanceArgs(['--finalize-current13-prefix','--input','private.json']),{mode:'finalize'});
 assert.deepEqual(parseCurrent13AcceptanceArgs(['--repair-current13-preclaim','--input','private.json']),{mode:'repair-preclaim'});
 assert.deepEqual(parseCurrent13AcceptanceArgs(['--repair-current13-preclaim']),{mode:'repair-preclaim'});
 for(const args of [['--allow-historical-source-transition','--input','private.json'],['--input','private.json','--allow-historical-source-transition'],['--finalize-current13-prefix','--allow-historical-source-transition']])assert.throws(()=>parseCurrent13AcceptanceArgs(args),/CURRENT13_ARGUMENT_DENIED/);
});
test('Native failure is preserved before reading nonexistent Host result evidence',()=>{
 const historical=history(),plan=createCurrent13Acceptance({historical,historicalReportSha256:'c'.repeat(64),agentIds:{...historical.agentIds,'full-stack-engineer':randomUUID()}}),step=plan.steps[2];
 step.runId=randomUUID();const current={id:step.runId,companyId:plan.companyId,responsibleUserId:'owner',issueId:step.taskId,agentId:step.agentId,
  status:'failed',exitCode:1,startedAt:new Date(1000),finishedAt:new Date(2000),errorCode:'adapter_failed',resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};
 assert.throws(()=>finalizeCurrent13StepBoundary({plan,step,current,ownerId:'owner',cwd:'/does-not-exist',root:'/does-not-exist',beforeBudget:[]}),/CURRENT13_NATIVE_EXECUTION_FAILED/);
 assert.equal(step.nativeStatus,'failed');assert.equal(step.nativeEvidence.status,'failed');
 assert.throws(()=>finalizeCurrent13StepBoundary({plan,step,current:{...current,status:'running',exitCode:null,finishedAt:null},ownerId:'owner',cwd:'/does-not-exist',root:'/does-not-exist',beforeBudget:[]}),/CURRENT13_NATIVE_RESULT_UNKNOWN/);
 assert.equal(step.nativeStatus,'running');
});
