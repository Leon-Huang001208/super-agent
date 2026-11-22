/** New, concrete current-source requirements under the completed isolated root. Operator execution only. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {TEAM_ROLES} from '../bridge/team-roles.mjs';
import {RUNTIME_PROFILES} from '../bridge/role-runtime-profiles.mjs';
import {AdmissionMeter} from '../bridge/admission.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {createTaskRuntimeRoute,projectTaskRuntimeRoute} from '../bridge/task-runtime-routing.mjs';
import {assertDelegatedAuth,publicRunEvidence,readAcceptanceArtifactJson,reserveAcceptanceTask,rehydrateAcceptancePlan} from './multi-runtime-acceptance.mjs';
import {ACCEPTANCE_ROOT as ROOT,privateJson,writePrivate,archivePrivateSnapshot,createMultiRuntimeNativeFixture} from '../tests/helpers/multi-runtime-native-fixture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code});};
const relative=value=>typeof value==='string'&&value.length<=512&&value.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..');
const reportFile=ROOT+'/multi-runtime-current13-acceptance.json';
export const FEATURE_STUB='export function normalizeItem(value){return value;}\nexport function renderItem(value){return value.label;}\nexport function toggleItem(value){value.done=!value.done;return value;}\n';
export const HTTP_STUB="export function createItemServer(){throw new Error('not implemented');}\n";
export const PREFERENCES_STUB='export function normalizePreferences(value){return value;}\nexport function mergePreferences(current,patch){return patch;}\n';
export const FEATURE_TESTS=`import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeItem,renderItem,toggleItem} from './item-feature.mjs';
test('normalization trims id/label and supplies boolean default',()=>assert.deepEqual(normalizeItem({id:' a ',label:' item '}),{id:'a',label:'item',done:false}));
test('Unicode labels and ids remain intact',()=>assert.deepEqual(normalizeItem({id:' 项-一 ',label:' 你好 👋 ',done:true}),{id:'项-一',label:'你好 👋',done:true}));
test('empty and invalid item fields are rejected',()=>{for(const value of [null,[],{}, {id:'',label:'x'},{id:'x',label:'  '},{id:'x',label:3}])assert.throws(()=>normalizeItem(value),TypeError);});
test('done accepts booleans only',()=>{for(const done of ['false',0,null])assert.throws(()=>normalizeItem({id:'x',label:'x',done}),TypeError);});
test('normalization is fresh, immutable and drops unrelated fields',()=>{const input={id:'x',label:' x ',done:false,extra:'ignored'},before=structuredClone(input),out=normalizeItem(input);assert.notEqual(out,input);assert.deepEqual(input,before);assert.deepEqual(Object.keys(out).sort(),['done','id','label']);});
test('render escapes HTML text and attribute delimiters',()=>{const value={id:'x"&',label:'<script>&'+String.fromCharCode(34,39)+'</script>',done:false};assert.equal(renderItem(value),'<li data-id="x&quot;&amp;"><span>&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;</span><input type="checkbox" disabled></li>');});
test('render reflects normalized checked state',()=>{assert.equal(renderItem({id:' x ',label:' label ',done:true}),'<li data-id="x"><span>label</span><input type="checkbox" disabled checked></li>');assert.doesNotMatch(renderItem({id:'x',label:'x'}),/ checked/);});
test('toggle returns a normalized immutable item and inverts once',()=>{const input={id:'x',label:'x',done:false},out=toggleItem(input);assert.notEqual(out,input);assert.deepEqual(input,{id:'x',label:'x',done:false});assert.deepEqual(out,{id:'x',label:'x',done:true});assert.deepEqual(toggleItem(out),input);});
`;
export const HTTP_TESTS=`import test from 'node:test';
import assert from 'node:assert/strict';
import {createItemServer} from './item-http.mjs';
async function fixture(t){const server=createItemServer();assert.equal(server.listening,false);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);}));const url='http://127.0.0.1:'+server.address().port+'/items';return{url,post:body=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)})};}
test('POST normalizes Unicode and assigns unique server ids',async t=>{const f=await fixture(t),a=await f.post({label:' 你好 ',id:'untrusted'}),b=await f.post({label:'second',id:'untrusted'});assert.equal(a.status,201);assert.equal(b.status,201);const x=await a.json(),y=await b.json();assert.equal(x.label,'你好');assert.equal(x.done,false);assert.match(x.id,/^[a-f0-9-]{36}$/);assert.notEqual(x.id,y.id);assert.notEqual(x.id,'untrusted');});
test('malformed JSON and invalid bodies return 400',async t=>{const f=await fixture(t);for(const value of ['{','[]','null',{label:'  '},{label:7},{label:'ok',done:'false'}]){const response=await f.post(value);assert.equal(response.status,400);await response.text();}});
test('POST enforces 8192 raw bytes including Unicode',async t=>{const f=await fixture(t),head='{"label":"',tail='"}',body=head+'x'.repeat(8192-Buffer.byteLength(head+tail))+tail;assert.equal(Buffer.byteLength(body),8192);const ok=await f.post(body);assert.equal(ok.status,201);await ok.text();const large=await f.post({label:'界'.repeat(3000)});assert.equal(large.status,413);await large.text();});
test('GET renders stored items with escaped HTML',async t=>{const f=await fixture(t),created=await f.post({label:'<img src=x>&"'});assert.equal(created.status,201);await created.text();const response=await fetch(f.url),html=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\\/html/);assert.match(html,/&lt;img src=x&gt;&amp;&quot;/);assert.doesNotMatch(html,/<img/);});
`;
export const PREFERENCES_TESTS=`import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences,mergePreferences} from './item-preferences.mjs';
test('preferences supply documented defaults',()=>assert.deepEqual(normalizePreferences(),{theme:'light',compact:false,locale:'en'}));
test('valid preferences retain exact values',()=>assert.deepEqual(normalizePreferences({theme:'dark',compact:true,locale:'zh-CN'}),{theme:'dark',compact:true,locale:'zh-CN'}));
test('invalid shapes and enum/boolean fields throw',()=>{for(const value of [null,[],{theme:'blue'},{compact:0},{locale:'zh'}])assert.throws(()=>normalizePreferences(value),TypeError);});
test('normalization is immutable and drops extra fields',()=>{const input={theme:'dark',ignored:1},before=structuredClone(input),out=normalizePreferences(input);assert.deepEqual(input,before);assert.notEqual(out,input);assert.deepEqual(Object.keys(out).sort(),['compact','locale','theme']);});
test('merge preserves unpatched fields and validates without mutation',()=>{const input={theme:'dark',compact:false,locale:'en'},patch={compact:true};assert.deepEqual(mergePreferences(input,patch),{theme:'dark',compact:true,locale:'en'});assert.deepEqual(input,{theme:'dark',compact:false,locale:'en'});assert.deepEqual(patch,{compact:true});assert.throws(()=>mergePreferences(input,{theme:'bad'}),TypeError);assert.throws(()=>mergePreferences(input,null),TypeError);});
`;
const REQUIREMENTS=`# Current13 synthetic requirements\n\nThis is a new item-list mini-feature, not the previous CSV task.\nitem-feature.mjs exports normalizeItem({id,label,done?}), renderItem(item), toggleItem(item). Trim required nonempty string id/label, preserve Unicode, done defaults false and otherwise must be boolean. Return only id/label/done without mutation. renderItem emits the exact li/span/disabled-checkbox HTML contract in the immutable tests; escape &, <, >, double/single quotes in text and attributes. toggleItem returns a new normalized value with done inverted.\nitem-http.mjs exports createItemServer(), an unstarted Node HTTP server. POST /items accepts JSON with label/done, assigns a new randomUUID id (ignore client id), returns normalized JSON with 201, rejects malformed/invalid JSON with 400 and raw bodies over 8192 bytes with 413. GET /items renders stored items as HTML using renderItem. No listener at module import. Only fixed tests listen temporarily at 127.0.0.1 and close the server.\nitem-preferences.mjs exports normalizePreferences(input={}) and mergePreferences(current,patch). Defaults: theme light, compact false, locale en. Allowed theme light/dark, boolean compact, locale en/zh-CN. Reject invalid objects/values, drop extra keys, preserve inputs.\nNo dependency installation, external services, production, daemon/gateway, UI screenshot or customer interview. Node tests and source/report hashes are the actual scope; UI/business/deployment claims remain NOT_RUN.\n`;
export const CURRENT13_FIXED_INPUTS=Object.freeze({'item-feature.test.mjs':FEATURE_TESTS,'item-http.test.mjs':HTTP_TESTS,'item-preferences.test.mjs':PREFERENCES_TESTS,'current13-requirements.md':REQUIREMENTS});
const FIXED=CURRENT13_FIXED_INPUTS;
export const current13FixedInputHashes=()=>Object.entries(FIXED).map(([file,text])=>({file,sha256:sha(text)}));
const SUITES={feature:['item-feature.test.mjs',8],http:['item-http.test.mjs',4],preferences:['item-preferences.test.mjs',5]};
const stepSpecs=[
 ['fullstack-feature','full-stack-engineer','minimax_opencode','fullstack13.json','常规小功能：读取current13-requirements.md和固定item-feature.test.mjs，仅实现item-feature.mjs三导出；覆盖trim、Unicode、拒空、HTML转义和不可变toggle。实际运行 node --test item-feature.test.mjs，8测试通过后写fullstack13.json记录候选SHA、真实命令/退出码与NOT_RUN。不要改测试或旧CSV产物，不安装依赖，不操作外部服务。'],
 ['backend-transfer','backend-engineer','codex_subscription','backend13.json','这是同一全栈task的明确跨角色升级：你接替Full Stack Engineer成为该范围唯一Owner，不另建任务。先核验versionedhandoff13中的旧产物/预算和摘要，读取原item-feature.mjs及固定测试，保留原8测试与实现不变。仅实现item-http.mjs的createItemServer：JSON输入验证、8192原始字节上限、400/413、服务器分配唯一ID及安全GET HTML。只允许固定测试临时监听127.0.0.1并close，模块导入不得启动listener。实际运行 node --test item-feature.test.mjs item-http.test.mjs（8+4），写backend13.json记录命令/退出码、安全边界、handoff和NOT_RUN。不要修改原测试、旧CSV或系统。'],
 ['minimax-claude-preferences','full-stack-engineer','minimax_claude','preferences13.json','新具体小需求：读取current13-requirements.md和固定item-preferences.test.mjs，仅实现item-preferences.mjs两个导出（枚举、boolean、默认值、不可变merge与拒非法值）。实际运行 node --test item-preferences.test.mjs，5个固定测试通过后写preferences13.json，列真实命令/退出码、改动和NOT_RUN。不要修改测试、前面产物或旧CSV，不安装依赖。'],
 ['deepseek-claude-crosscheck','research','deepseek_claude','ds-claude13.json','交叉核对新item微功能与Backend HTTP边界：只读current13-requirements.md、固定测试及可信sources给出的实际产物，重点核对8192字节、JSON错误、唯一ID与HTML注入。实际调用本run的host.project_inspect MCP（可能有命名空间，参数{}，workspace NOT_CONFIGURED是合法观察），不得以文字假称调用。仅写ds-claude13.json，JSON结构为sources（精确复制可信file/sha256数组）、facts、assumptions、unknowns三个数组、hostInspection:{tool:"host.project_inspect",...}。区分事实/假设和NOT_RUN，不改任何实现/测试或其他报告，不联网、不安装。'],
 ['deepseek-opencode-crosscheck','research','deepseek_opencode','ds-opencode13.json','对新item微功能做另一组只读交叉核对：读取current13-requirements.md、FullStack/Backend的可信sources及固定测试，重点核对Unicode/trim、不可变toggle、转义及开发自测与业务验收边界。实际调用本run的host.project_inspect MCP（参数{}，workspace NOT_CONFIGURED是合法观察）。仅写ds-opencode13.json，结构sources（精确复制可信file/sha256数组）、facts、assumptions、unknowns数组、hostInspection:{tool:"host.project_inspect",...}；不重放旧CSV、不改其他产物，不联网或安装。'],
 ['qa13','qa','codex_subscription','qa13.json','独立核验本次新13岗可信reviewedArtifacts：逐文件SHA、FullStack原8项、Backend HTTP新增4项和preferences5项固定测试，核对两个DeepSeek报告的来源/事实/假设及真实host MCP回执。实际运行 node --test item-feature.test.mjs item-http.test.mjs item-preferences.test.mjs（17测试）。不得修改被审实现/固定测试，不审自身旧qa.json。仅写qa13.json，verdict严格PASS或NEEDS_WORK，findings/notRun数组，reviewedArtifacts精确复制可信绑定；UI、生产、Cloud Apps、自动调度和其他未执行能力保持NOT_RUN。'],
];

export function createCurrent13Acceptance({historical,historicalReportSha256,agentIds}={}){
 const previousRoles=Object.keys(TEAM_ROLES).filter(role=>role!=='full-stack-engineer');
 if(historical?.status!=='PASS'||historical.steps?.length!==5||historical.steps.some(step=>step.status!=='PASS'||!uuid(step.runId))||historical.callsSpent!==6||
  historical.maximumCalls!==20||historical.maximumResponsesPerRun!==64||!digest(historicalReportSha256)||!agentIds||
  Object.keys(agentIds).length!==13||Object.keys(TEAM_ROLES).some(role=>!uuid(agentIds[role]))||new Set(Object.values(agentIds)).size!==13||
  ![12,13].includes(Object.keys(historical.agentIds??{}).length)||previousRoles.some(role=>!uuid(historical.agentIds?.[role])||agentIds[role]!==historical.agentIds[role])||
  Object.entries(historical.agentIds??{}).some(([role,id])=>agentIds[role]!==id)||historical.steps.some((step,index)=>step.role!==['backend-engineer','backend-engineer','research','pm','qa'][index]||step.agentId!==historical.agentIds[step.role]||!uuid(step.taskId)||!uuid(step.operationId))||
  historical.steps[0].taskId!==historical.steps[1].taskId||!['companyId','projectId','workspaceId','rootTaskId'].every(field=>uuid(historical[field]))||!digest(historical.rootInputRevision))fail('CURRENT13_HISTORY_DENIED');
 const featureTaskId=randomUUID(),firstOperationId=randomUUID(),qaTaskId=historical.steps.find(step=>step.role==='qa')?.taskId;
 if(!uuid(qaTaskId))fail('CURRENT13_HISTORY_DENIED');
 return{schemaVersion:1,kind:'isolated-native-current13',companyId:historical.companyId,projectId:historical.projectId,workspaceId:historical.workspaceId,
  rootTaskId:historical.rootTaskId,rootInputRevision:historical.rootInputRevision,sourceRoleCount:13,sourceRoles:Object.keys(TEAM_ROLES),agentIds:structuredClone(agentIds),
  historicalMatrix:{reportFile:'multi-runtime-acceptance.json',reportSha256:historicalReportSha256,callsSpent:historical.callsSpent,
   sourceRoleCount:historical.postExecutionFinalization?.sourceRoleCount??Object.keys(historical.agentIds).length,evidenceScope:'historical-source-only',
   steps:historical.steps.map(({taskId,agentId,operationId,runId,runtimeProfileId})=>({taskId,agentId,operationId,runId,runtimeProfileId}))},
  maximumCalls:20,maximumResponsesPerRun:64,callsSpentBefore:historical.callsSpent,callsSpent:historical.callsSpent,
  automaticDispatch:'NOT_RUN',outbox:'NOT_RUN',cloudApps:'NOT_RUN',userInterface:'NOT_RUN',productionDeployment:'NOT_RUN',status:'NOT_RUN',
  steps:stepSpecs.map(([key,role,runtimeProfileId,outputFile,goal],index)=>({key,role,runtimeProfileId,outputFile,goal,title:'Current13 '+key,
   agentId:agentIds[role],taskId:index<2?featureTaskId:role==='qa'?qaTaskId:randomUUID(),operationId:index===0?firstOperationId:randomUUID(),
   selection:{complexity:index===1?'complex':'routine',risk:index===1?'high':'low',purpose:role==='research'?'cross-check':'execution',profileId:runtimeProfileId},
   ...(index===1?{handoffFromOperationId:firstOperationId}:{}),status:'NOT_RUN'}))};
}

export function validateCurrent13RunEvidence({step,run,transport,processCleanup,brokerCleanup,implementation,providerEvents}){
 const profile=RUNTIME_PROFILES[step?.runtimeProfileId];
 if(!profile||run?.id!==step.runId||run.issueId!==step.taskId||run.agentId!==step.agentId||run.status!=='succeeded'||run.exitCode!==0||!run.finishedAt||
  transport?.runId!==run.id||transport.exitCode!==0||transport.signal!==null||transport.timedOut!==false||transport.cancelled!==false||transport.outputUnknown!==false||
  processCleanup?.status!=='terminated'||brokerCleanup?.status!=='terminated')fail('CURRENT13_EXECUTION_NOT_CLOSED');
 if(implementation?.runId!==run.id||implementation.profileId!==profile.id||implementation.modelId!==profile.providerModel||implementation.runtimeId!==profile.runtime||
  !digest(implementation.sourceSha256)||!digest(implementation.cliSha256)||implementation.freshSession!==true)fail('CURRENT13_IMPLEMENTATION_DENIED');
 const optional=event=>profile.runtime==='codex'&&event.code==='ROLE_PROXY_PATH_DENIED'&&event.path==='/backend-api/ps/plugins/tooling-state/turtle';
 if(!Array.isArray(providerEvents)||providerEvents.some(event=>!optional(event)&&/DENIED|UPSTREAM_HTTP_ERROR|UPSTREAM_UNKNOWN|UPSTREAM_ABORTED/.test(event.code??'')))fail('CURRENT13_BROKER_EVIDENCE_DENIED');
 let successful;
 if(profile.runtime==='codex')successful=providerEvents.filter(event=>event.code==='ROLE_PROXY_COMPLETED'&&event.path==='/backend-api/codex/responses'&&event.status===200);
 else{
  const authorized=providerEvents.filter(event=>event.code==='ROLE_API_REQUEST_AUTHORIZED');
  if(!authorized.length||authorized.some(event=>event.runId!==run.id||event.profileId!==profile.id||event.model!==profile.providerModel||!Number.isSafeInteger(event.requestCount)||event.requestCount>64))fail('CURRENT13_BROKER_MODEL_DENIED');
  successful=providerEvents.filter(event=>event.code==='ROLE_API_COMPLETED'&&event.runId===run.id&&event.profileId===profile.id&&event.model===profile.providerModel&&event.status===200);
 }
 if(!successful.length||successful.length>64)fail('CURRENT13_BROKER_MODEL_DENIED');
 const optionalPluginDenials=providerEvents.filter(optional).length;
 return{runId:run.id,observed:true,profileId:profile.id,modelId:profile.providerModel,runtimeId:profile.runtime,requestCount:successful.length,
  ...(optionalPluginDenials?{optionalPluginState:'DENIED_AS_DESIGNED/NOT_RUN',optionalPluginDenials}:{}),
  observationSource:profile.runtime==='codex'?'fixed-broker-model-guard-and-success':'broker-model-authorization-and-completion'};
}
function artifact(cwd,file,step){
 if(!relative(file))fail('CURRENT13_ARTIFACT_DENIED');let cursor=cwd;
 for(const part of file.split('/')){cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink()||cursor!==path.join(cwd,file)&&!stat.isDirectory())fail('CURRENT13_ARTIFACT_DENIED');}
 const stat=fs.lstatSync(cursor);if(!stat.isFile()||stat.nlink!==1||stat.size>131072||(stat.mode&0o022))fail('CURRENT13_ARTIFACT_DENIED');
 return{taskId:step.taskId,runId:step.runId,file,sha256:sha(fs.readFileSync(cursor))};
}
export function snapshotCurrent13Handoff({cwd,rootTaskId,from,to,artifacts,budget}){
 if(![rootTaskId,from?.taskId,from?.operationId,from?.runId,from?.agentId,to?.agentId,to?.operationId].every(uuid)||from.taskId!==to.taskId||from.agentId===to.agentId||
  from.role!=='full-stack-engineer'||to.role!=='backend-engineer'||from.status!=='PASS'||to.handoffFromOperationId!==from.operationId||
  !Array.isArray(artifacts)||!artifacts.length||artifacts.length>32||!Array.isArray(budget)||!budget.length||budget.length>=20||budget.some(record=>!uuid(record.operationId)||!digest(record.sha256)))fail('CURRENT13_HANDOFF_DENIED');
 const prefix='versionedhandoff13/'+from.taskId+'/'+from.operationId+'-'+to.operationId;
 for(const ref of artifacts)if(ref.taskId!==from.taskId||ref.runId!==from.runId||!digest(ref.sha256)||artifact(cwd,ref.file,from).sha256!==ref.sha256)fail('CURRENT13_HANDOFF_DENIED');
 fs.mkdirSync(path.join(cwd,prefix),{recursive:true,mode:0o700});
 const copies=artifacts.map(ref=>{const file=prefix+'/'+path.basename(ref.file);fs.writeFileSync(path.join(cwd,file),fs.readFileSync(path.join(cwd,ref.file)),{flag:'wx',mode:0o400});return{sourceFile:ref.file,file,sha256:ref.sha256,runId:from.runId};});
 const receipt={schemaVersion:1,kind:'explicit-role-transfer',handoffKind:'role-transfer',rootTaskId,taskId:from.taskId,fromAgentId:from.agentId,toAgentId:to.agentId,
  fromRole:from.role,toRole:to.role,fromOperationId:from.operationId,toOperationId:to.operationId,fromRunId:from.runId,
  artifacts:copies,budget:{callsSpent:budget.length,records:structuredClone(budget)},receiptFile:prefix+'/handoff.json'};
 fs.writeFileSync(path.join(cwd,receipt.receiptFile),JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o400});return receipt;
}
export function verifyCurrent13Handoff({cwd,receipt}){
 if(receipt?.kind!=='explicit-role-transfer'||!relative(receipt.receiptFile))fail('CURRENT13_HANDOFF_CHANGED');
 const expected={file:receipt.receiptFile,sha256:sha(JSON.stringify(receipt)+'\n')};
 if(!equal(readAcceptanceArtifactJson({cwd,reference:expected}),receipt))fail('CURRENT13_HANDOFF_CHANGED');
 for(const ref of receipt.artifacts)if(artifact(cwd,ref.file,{taskId:receipt.taskId,runId:receipt.fromRunId}).sha256!==ref.sha256)fail('CURRENT13_HANDOFF_CHANGED');
 return true;
}
export function validateCurrent13CrossCheck(report,sources){
 if(!report||!equal(report.sources,sources)||!Array.isArray(report.facts)||!report.facts.length||!Array.isArray(report.assumptions)||!Array.isArray(report.unknowns)||
  [report.facts,report.assumptions,report.unknowns].some(items=>items.some(value=>typeof value!=='string'))||report.hostInspection?.tool!=='host.project_inspect')fail('CURRENT13_CROSSCHECK_DENIED');
 return report;
}
export function validateCurrent13ActorClosure(proof,{taskId,agentId}){
 if(proof?.closed!==true||proof.taskId!==taskId||proof.agentId!==agentId||proof.nativeExecutionStopVerified!==true||
  !Array.isArray(proof.activeRunIds)||proof.activeRunIds.length||!Array.isArray(proof.proofs))fail('CURRENT13_PREVIOUS_OWNER_OPEN');
 return proof;
}
/** Called only after this operation owns the shared lease and its Native task assignment. */
export async function prepareCurrent13Wake({fixture,step,route,onSessionReset=()=>{}}){
 const profile=RUNTIME_PROFILES[step?.runtimeProfileId];if(!profile)fail('CURRENT13_ROUTE_PROFILE_CHANGED');
 if(profile.runtime==='codex'){
  if(typeof fixture.ensureAcceptanceDelegation!=='function')fail('CURRENT13_DELEGATION_PORT_REQUIRED');
  await fixture.ensureAcceptanceDelegation(step,{minimumRemainingMs:210000,timeoutMs:120000});
 }
 await fixture.heartbeat.resetRuntimeSession(step.agentId,{taskKey:step.taskId});
 await onSessionReset();return fixture.managedWake(step,route);
}

function budgetRecords(rootTaskId,root=ROOT){
 const directory=root+'/budget/'+rootTaskId;
 return fs.readdirSync(directory).sort().map(name=>{if(!/^[a-f0-9-]{36}\.json$/.test(name))fail('CURRENT13_BUDGET_DENIED');const value=privateJson(directory+'/'+name);
  if(value.id!==name.slice(0,-5))fail('CURRENT13_BUDGET_DENIED');return{operationId:value.id,taskId:value.taskId,agentId:value.agentId,role:value.role,sha256:sha(fs.readFileSync(directory+'/'+name))};});
}
function preserveBudget(before,after){if(before.some(record=>!after.some(current=>equal(current,record))))fail('CURRENT13_BUDGET_CHANGED');}
function controlRef(file,root=ROOT){if(!relative(file))fail('CURRENT13_PROOF_PATH_DENIED');return{file,sha256:sha(fs.readFileSync(root+'/'+file))};}
function readRunProof(step,root=ROOT){
 const prefix='transport/'+step.runId,transport=privateJson(root+'/'+prefix+'/result.json'),implementation=privateJson(root+'/'+prefix+'/implementation-proof.json');
 const processCleanup=privateJson(root+'/'+prefix+'/process-cleanup.json'),brokerCleanup=privateJson(root+'/'+prefix+'/broker-process-cleanup.json'),native=privateJson(root+'/'+prefix+'/native-proof.json');
 if(native.runId!==step.runId||native.executor!=='macos_native'||native.platform!=='darwin'||native.executionPolicy?.executor!=='macos_native')fail('CURRENT13_NATIVE_PROOF_DENIED');
 for(const stream of ['stdout','stderr'])if(sha(fs.readFileSync(root+'/'+prefix+'/'+stream))!==transport[stream+'Sha256'])fail('CURRENT13_TRANSPORT_DIGEST_CHANGED');
 const auditFile=prefix+'/proxy-audit/provider.jsonl',bytes=fs.readFileSync(root+'/'+auditFile);if(bytes.length>1048576)fail('CURRENT13_PROVIDER_AUDIT_DENIED');
 let providerEvents;try{providerEvents=bytes.toString('utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{fail('CURRENT13_PROVIDER_AUDIT_DENIED');}
 return{transport,processCleanup,brokerCleanup,implementation,providerEvents,
  references:Object.fromEntries(Object.entries({transport:prefix+'/result.json',stdout:prefix+'/stdout',stderr:prefix+'/stderr',processCleanup:prefix+'/process-cleanup.json',
   brokerCleanup:prefix+'/broker-process-cleanup.json',native:prefix+'/native-proof.json',implementation:prefix+'/implementation-proof.json',providerAudit:auditFile}).map(([key,file])=>[key,controlRef(file,root)]))};
}
function hostInspection(runId,root=ROOT){
 const directory=root+'/transport/'+runId+'/proxy-audit/host-calls';if(!fs.existsSync(directory))fail('CURRENT13_HOST_TOOL_MISSING');
 for(const name of fs.readdirSync(directory).filter(name=>digest(name))){const prefix='transport/'+runId+'/proxy-audit/host-calls/'+name,request=privateJson(root+'/'+prefix+'/request.json');
  if(request.runId!==runId||request.tool!=='host.project_inspect')continue;const result=privateJson(root+'/'+prefix+'/result.json');
  if(result.runId===runId&&result.requestHash===sha(JSON.stringify(request))&&!result.error&&result.result?.project)return[{tool:request.tool,request:controlRef(prefix+'/request.json',root),result:controlRef(prefix+'/result.json',root)}];
 }
 fail('CURRENT13_HOST_TOOL_MISSING');
}
function fixedChecks(cwd,step,suites,root=ROOT){
 const checks=[];for(const name of suites){const[file,count]=SUITES[name],args=['--test','--test-reporter=tap',file],result=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:15000,maxBuffer:1048576,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8'}});
  const evidence=root+'/current13-evidence/'+step.operationId;fs.mkdirSync(evidence,{recursive:true,mode:0o700});
  const streams={};for(const stream of ['stdout','stderr']){
   const bytes=result[stream]??'',file='current13-evidence/'+step.operationId+'/'+name+'-'+sha(bytes)+'.'+stream,target=root+'/'+file;
   if(fs.existsSync(target)){if(sha(fs.readFileSync(target))!==sha(bytes))fail('CURRENT13_TEST_EVIDENCE_CHANGED');}
   else fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});streams[stream]=controlRef(file,root);
  }
  const check={command:'node --test --test-reporter=tap '+file,exitCode:result.status,signal:result.signal??null,count,
   stdout:streams.stdout,stderr:streams.stderr};
  checks.push(check);
  if(result.error||result.signal||result.status!==0||!new RegExp('# pass '+count+'\\b').test(result.stdout??'')||!/# fail 0\b/.test(result.stdout??''))throw Object.assign(Error('CURRENT13_FIXED_TESTS_FAILED'),{code:'CURRENT13_FIXED_TESTS_FAILED',checks});
 }return checks;
}
function verifyReferences(cwd,refs){for(const ref of refs)if(artifact(cwd,ref.file,ref).sha256!==ref.sha256)fail('CURRENT13_RETAINED_ARTIFACT_CHANGED');}
export function validateCurrent13FrozenInputs({cwd,references}){
 if(!equal(references,current13FixedInputHashes()))fail('CURRENT13_FIXED_INPUT_CHANGED');verifyReferences(cwd,references);return true;
}
function hydrateCurrent13Plan(saved){
 if(saved?.schemaVersion!==1||saved.kind!=='isolated-native-current13'||saved.sourceRoleCount!==13||saved.maximumCalls!==20||saved.maximumResponsesPerRun!==64||saved.callsSpentBefore!==6||
  saved.steps?.length!==6||!['companyId','projectId','workspaceId','rootTaskId'].every(key=>uuid(saved[key]))||!digest(saved.rootInputRevision)||
  Object.keys(saved.agentIds??{}).length!==13||Object.keys(TEAM_ROLES).some(role=>!uuid(saved.agentIds[role]))||new Set(Object.values(saved.agentIds)).size!==13)fail('CURRENT13_RESUME_PLAN_CHANGED');
 const plan=structuredClone(saved);for(const[ index,spec]of stepSpecs.entries()){
  const [key,role,runtimeProfileId,outputFile,goal]=spec,step=plan.steps[index];
  if([key,role,runtimeProfileId,outputFile].some((value,column)=>value!==[step.key,step.role,step.runtimeProfileId,step.outputFile][column])||
   step.agentId!==plan.agentIds[role]||!uuid(step.operationId)||!uuid(step.taskId)||
   !equal(step.selection,{complexity:index===1?'complex':'routine',risk:index===1?'high':'low',purpose:role==='research'?'cross-check':'execution',profileId:runtimeProfileId}))fail('CURRENT13_RESUME_PLAN_CHANGED');
  step.goal=goal;
 }
 if(plan.steps[0].taskId!==plan.steps[1].taskId||plan.steps[1].handoffFromOperationId!==plan.steps[0].operationId||new Set(plan.steps.map(step=>step.operationId)).size!==6||
  plan.steps[5].taskId!==plan.historicalMatrix?.steps?.find(step=>step.agentId===plan.agentIds.qa)?.taskId)fail('CURRENT13_RESUME_PLAN_CHANGED');
 return plan;
}
export function validateCurrent13ResumePlan(saved){
 const plan=hydrateCurrent13Plan(saved);if(!['PARTIAL_VALIDATED','PASS'].includes(plan.status))fail('CURRENT13_RESUME_NOT_VALIDATED');
 let prefix=0;while(plan.steps[prefix]?.status==='PASS')prefix++;
 if(!prefix||plan.steps.slice(prefix).some(step=>step.status!=='NOT_RUN'||step.runId||step.nativeEvidence||step.nativeStatus||step.wakeAttemptedAt||step.startedAt)||
  plan.callsSpent!==6+prefix||plan.rootCallsSpent!==plan.callsSpent||plan.budgetRecords?.length!==plan.callsSpent||
  plan.steps.slice(0,prefix).some(step=>!uuid(step.runId)||!step.artifacts?.length||step.nativeEvidence?.status!=='succeeded'||!step.modelEvidence?.observed||!step.implementationProof||!Array.isArray(step.testing)))fail('CURRENT13_RESUME_PREFIX_DENIED');
 return prefix;
}
const suitesFor=step=>step.key==='fullstack-feature'?['feature']:step.key==='backend-transfer'?['feature','http']:step.key==='minimax-claude-preferences'?['preferences']:step.role==='qa'?['feature','http','preferences']:[];
function checkRecordedTesting(step,root){
 const suites=suitesFor(step);if(step.testing?.length!==suites.length)fail('CURRENT13_TEST_EVIDENCE_CHANGED');
 for(const[index,name]of suites.entries()){
  const[file,count]=SUITES[name],record=step.testing[index];
  if(record.command!=='node --test --test-reporter=tap '+file||record.exitCode!==0||record.signal!==null||record.count!==count)fail('CURRENT13_TEST_EVIDENCE_CHANGED');
  for(const stream of ['stdout','stderr'])if(!equal(controlRef(record[stream]?.file,root),record[stream]))fail('CURRENT13_TEST_EVIDENCE_CHANGED');
  const text=fs.readFileSync(root+'/'+record.stdout.file,'utf8');if(!new RegExp('# pass '+count+'\\b').test(text)||!/# fail 0\b/.test(text))fail('CURRENT13_TEST_EVIDENCE_CHANGED');
 }
}
export function revalidateCurrent13PassedStep({plan,step,current,ownerId,cwd,root=ROOT}){
 if(step.status!=='PASS'||current?.companyId!==plan.companyId||current?.responsibleUserId!==ownerId)fail('CURRENT13_NATIVE_OWNER_DENIED');
 const proof=readRunProof(step,root),observed=validateCurrent13RunEvidence({step,run:current,...proof});
 if(step.nativeEvidence?.resultSha256!==publicRunEvidence(current,RUNTIME_PROFILES[step.runtimeProfileId]).resultSha256||!equal(step.proofs,proof.references)||!equal(step.modelEvidence,{...observed,providerAudit:proof.references.providerAudit})||
  step.implementationProof?.sourceSha256!==proof.implementation.sourceSha256||step.implementationProof?.cliSha256!==proof.implementation.cliSha256)fail('CURRENT13_RESUME_PROOF_CHANGED');
 verifyReferences(cwd,step.artifacts);checkRecordedTesting(step,root);
 if(step.role==='research'){
  if(!equal(step.hostToolEvidence,hostInspection(step.runId,root)))fail('CURRENT13_HOST_TOOL_MISSING');
  validateCurrent13CrossCheck(readAcceptanceArtifactJson({cwd,reference:step.artifacts.find(ref=>ref.file===step.outputFile)}),step.sources);
 }
 if(step.handoff)verifyCurrent13Handoff({cwd,receipt:step.handoff});return true;
}
/** Common no-model boundary for a newly successful run and an explicitly resumed closed run. */
export function finalizeCurrent13StepBoundary({plan,step,current,ownerId,cwd,beforeBudget,oldArtifacts=[],priorArtifacts=[],reviewedArtifacts,root=ROOT,started}){
 const profile=RUNTIME_PROFILES[step.runtimeProfileId];step.nativeEvidence=publicRunEvidence(current,profile);step.nativeStatus=current?.status??'UNKNOWN';
 if(current?.companyId!==plan.companyId||current?.responsibleUserId!==ownerId)fail('CURRENT13_NATIVE_OWNER_DENIED');
 const proof=readRunProof(step,root),modelEvidence=validateCurrent13RunEvidence({step,run:current,...proof});
 step.modelEvidence={...modelEvidence,providerAudit:proof.references.providerAudit};step.proofs=proof.references;
 if(modelEvidence.optionalPluginState)step.optionalPluginState=modelEvidence.optionalPluginState;
 step.actualProvider=profile.provider;step.actualModel=modelEvidence.modelId;step.actualRuntime=modelEvidence.runtimeId;
 step.implementationProof={...proof.references.implementation,profileId:proof.implementation.profileId,modelId:proof.implementation.modelId,runtimeId:proof.implementation.runtimeId,
  sourceSha256:proof.implementation.sourceSha256,cliSha256:proof.implementation.cliSha256};
 step.usage=step.nativeEvidence.usage;const duration=Date.parse(step.nativeEvidence.finishedAt)-Date.parse(step.nativeEvidence.startedAt);
 step.durationMs=Number.isFinite(duration)&&duration>=0?duration:Number.isFinite(started)?Date.now()-started:null;step.unknownCost=true;
 if(fs.existsSync(root+'/call.lock'))fail('CURRENT13_CALL_SETTLEMENT_PENDING');
 const files=step.key==='fullstack-feature'?['item-feature.mjs',step.outputFile,...Object.keys(FIXED)]:step.key==='backend-transfer'?['item-http.mjs',step.outputFile]:step.key==='minimax-claude-preferences'?['item-preferences.mjs',step.outputFile]:[step.outputFile];
 if(step.artifacts?.length)verifyReferences(cwd,step.artifacts);step.artifacts=files.map(file=>artifact(cwd,file,step));
 verifyReferences(cwd,oldArtifacts);validateCurrent13FrozenInputs({cwd,references:plan.fixedInputs});verifyReferences(cwd,priorArtifacts);
 if(step.key==='fullstack-feature'&&(fs.readFileSync(cwd+'/item-http.mjs','utf8')!==HTTP_STUB||fs.readFileSync(cwd+'/item-preferences.mjs','utf8')!==PREFERENCES_STUB))fail('CURRENT13_FUTURE_SCOPE_CHANGED');
 if(step.key==='backend-transfer'&&fs.readFileSync(cwd+'/item-preferences.mjs','utf8')!==PREFERENCES_STUB)fail('CURRENT13_FUTURE_SCOPE_CHANGED');
 if(step.key==='fullstack-feature')plan.featureSha256=step.artifacts.find(ref=>ref.file==='item-feature.mjs').sha256;
 else if(sha(fs.readFileSync(cwd+'/item-feature.mjs'))!==plan.featureSha256)fail('CURRENT13_FULLSTACK_ARTIFACT_CHANGED');
 if(step.role==='research'){step.hostToolEvidence=hostInspection(step.runId,root);validateCurrent13CrossCheck(readAcceptanceArtifactJson({cwd,reference:step.artifacts[0]}),step.sources);}
 try{step.testing=fixedChecks(cwd,step,suitesFor(step),root);}catch(error){if(error.checks)step.testing=error.checks;throw error;}
 for(const prior of plan.steps)if(prior.handoff){verifyCurrent13Handoff({cwd,receipt:prior.handoff});preserveBudget(prior.handoff.budget.records,budgetRecords(plan.rootTaskId,root));}
 if(step.role==='qa'){
  const qa=readAcceptanceArtifactJson({cwd,reference:step.artifacts[0]});
  if(qa.verdict!=='PASS'||!Array.isArray(qa.findings)||qa.findings.length||!Array.isArray(qa.notRun)||!equal(qa.reviewedArtifacts,reviewedArtifacts))fail('CURRENT13_QA_DENIED');
  verifyReferences(cwd,reviewedArtifacts);step.verdict='PASS';
 }
 const file=step.key+'-evidence13.json',bytes=JSON.stringify({schemaVersion:1,origin:'trusted-current13-collector',taskId:step.taskId,runId:step.runId,
  profileId:step.runtimeProfileId,nativeEvidence:step.nativeEvidence,modelEvidence:step.modelEvidence,implementationProof:step.implementationProof,
  testing:step.testing,hostToolEvidence:step.hostToolEvidence??[],unknownCost:true})+'\n';
 if(fs.existsSync(path.join(cwd,file))){if(fs.readFileSync(path.join(cwd,file),'utf8')!==bytes)fail('CURRENT13_COLLECTOR_EVIDENCE_CHANGED');}
 else fs.writeFileSync(path.join(cwd,file),bytes,{flag:'wx',mode:0o600});step.artifacts.push(artifact(cwd,file,step));step.collectorEvidenceFile=file;
 const after=budgetRecords(plan.rootTaskId,root);preserveBudget(beforeBudget,after);
 if(after.length!==beforeBudget.length+1||!after.some(record=>record.operationId===step.operationId&&record.taskId===step.taskId&&record.agentId===step.agentId&&record.role===step.role))fail('CURRENT13_CALL_BUDGET_UNPROVEN');return after;
}
/** Explicit operator recovery of known successful model work. SELECT ports only; never wakes or replays a model. */
export async function finalizeCurrent13SucceededPrefix({getRun,getRuns,getRootTask,root=ROOT,cwd}={}){
 if(process.platform!=='linux'||process.getuid()!==0||process.env.SUPER_AGENT_ISOLATED_MULTI_RUNTIME!=='1'||
  process.env.SUPER_AGENT_ISOLATED_DATABASE_URL!=='postgres://postgres@127.0.0.1:5432/sa_multi_runtime_acceptance'||
  ![getRun,getRuns,getRootTask].every(port=>typeof port==='function'))fail('CURRENT13_PREFIX_FINALIZATION_SCOPE_DENIED');
 const file=root+'/multi-runtime-current13-acceptance.json',plan=hydrateCurrent13Plan(privateJson(file)),bytes=fs.readFileSync(file);
 const registry=privateJson(root+'/registry.json'),registryBytes=fs.readFileSync(root+'/registry.json'),ownerId=registry.ownerId;
 cwd??='/paperclip/instances/default/projects/'+plan.companyId+'/'+plan.projectId+'/_default';
 const rootTask=await getRootTask(plan.rootTaskId);
 if(registry.companyId!==plan.companyId||registry.projectId!==plan.projectId||registry.taskId!==plan.rootTaskId||registry.lease||fs.existsSync(root+'/call.lock')||
  !equal(registry.team?.ids,plan.agentIds)||fs.readFileSync(root+'/.multi-runtime-owner','utf8')!==plan.companyId||rootTask?.id!==plan.rootTaskId||
  rootTask.companyId!==plan.companyId||rootTask.projectId!==plan.projectId||rootTask.responsibleUserId!==ownerId||taskInputRevision(rootTask)!==plan.rootInputRevision)fail('CURRENT13_PREFIX_FINALIZATION_SCOPE_DENIED');
 validateCurrent13FrozenInputs({cwd,references:plan.fixedInputs});
 const archive=plan.historicalMatrix.archive;if(!relative(archive?.file)||archive.sha256!==plan.historicalMatrix.reportSha256||controlRef(archive.file,root).sha256!==archive.sha256)fail('CURRENT13_HISTORY_CHANGED');
 const historical=privateJson(root+'/'+archive.file),oldArtifacts=historical.steps.flatMap(step=>step.artifacts);verifyReferences(cwd,oldArtifacts);
 let started=0;while(plan.steps[started]?.runId)started++;
 if(!started||plan.steps.slice(started).some(step=>step.runId||step.status!=='NOT_RUN'||step.nativeEvidence||step.nativeStatus||step.wakeAttemptedAt||step.startedAt)||
  plan.steps.slice(0,started).some(step=>step.status!=='PASS'&&!(step.status==='RUNNING'&&step.nativeStatus==='succeeded')))fail('CURRENT13_PREFIX_HAS_UNKNOWN_WORK');
 const records=budgetRecords(plan.rootTaskId,root),base=plan.historicalMatrix.budgetRecords;
 if(base?.length!==6||records.length!==6+started||records.length!==plan.callsSpent)fail('CURRENT13_PREFIX_BUDGET_CHANGED');
 preserveBudget(base,records);preserveBudget(plan.budgetRecords,records);
 const operations=new Set([...base.map(record=>record.operationId),...plan.steps.slice(0,started).map(step=>step.operationId)]);
 if(records.some(record=>!operations.has(record.operationId)))fail('CURRENT13_PREFIX_BUDGET_CHANGED');
 const allRuns=await getRuns(plan.companyId),knownRuns=new Set([...historical.steps.flatMap(step=>[step.runId,...(step.priorAttempts??[]).map(prior=>prior.runId)]),...plan.steps.slice(0,started).map(step=>step.runId)]);
 if(fs.existsSync(root+'/bootstrap-closure.json'))for(const run of privateJson(root+'/bootstrap-closure.json').runs??[])knownRuns.add(run.id);
 const taskIds=new Set(plan.steps.map(step=>step.taskId));
 if(!Array.isArray(allRuns)||allRuns.some(run=>run.companyId===plan.companyId&&(['running','queued','scheduled_retry'].includes(run.status)||taskIds.has(run.issueId)&&!knownRuns.has(run.id))))fail('CURRENT13_PREFIX_HAS_UNKNOWN_WORK');
 if(plan.status==='PARTIAL_VALIDATED'||plan.status==='PASS'){
  validateCurrent13ResumePlan(plan);for(const step of plan.steps.slice(0,started))revalidateCurrent13PassedStep({plan,step,current:await getRun(step.runId),ownerId,cwd,root});
  return{status:plan.status,changed:false,successfulPrefix:started,budgetSpent:records.length,modelCallsAdded:0};
 }
 if(plan.status!=='FAILED'||plan.errorCode!=='CURRENT13_BROKER_EVIDENCE_DENIED'||plan.steps.slice(0,started-1).some(step=>step.status!=='PASS'))fail('CURRENT13_PREFIX_FINALIZATION_NOT_AUTHORIZED');
 const step=plan.steps[started-1],current=await getRun(step.runId),proof=readRunProof(step,root),observed=validateCurrent13RunEvidence({step,run:current,...proof});
 if(observed.optionalPluginState!=='DENIED_AS_DESIGNED/NOT_RUN')fail('CURRENT13_PREFIX_FINALIZATION_NOT_AUTHORIZED');
 const releaseFile='closed-phase-releases/'+step.operationId+'.json',release=privateJson(root+'/'+releaseFile),sourceReportSha256=sha(bytes),sourceRegistrySha256=sha(registryBytes);
 if(release.schemaVersion!==1||release.kind!=='known-closed-current13-phase'||release.sourceReportSha256!==sourceReportSha256||release.runId!==step.runId||release.taskId!==step.taskId||
  release.operationId!==step.operationId||release.modelCallsAdded!==0||release.budgetSpent!==records.length||release.transportSha256!==proof.references.transport.sha256||
  release.providerAuditSha256!==proof.references.providerAudit.sha256||release.lease?.taskId!==step.taskId||release.lease?.projectId!==plan.projectId||release.lease?.operationId!==step.operationId)fail('CURRENT13_RELEASE_RECEIPT_CHANGED');
 const reportArchive=archivePrivateSnapshot(root+'/current13-history','prefix-before',bytes),registryArchive=archivePrivateSnapshot(root+'/current13-history','registry-before-prefix',registryBytes);
 for(const prior of plan.steps.slice(0,started-1))revalidateCurrent13PassedStep({plan,step:prior,current:await getRun(prior.runId),ownerId,cwd,root});
 const beforeBudget=records.filter(record=>record.operationId!==step.operationId),priorArtifacts=plan.steps.slice(0,started-1).flatMap(prior=>prior.artifacts);
 if(beforeBudget.length!==records.length-1)fail('CURRENT13_PREFIX_BUDGET_CHANGED');
 const after=finalizeCurrent13StepBoundary({plan,step,current,ownerId,cwd,root,beforeBudget,oldArtifacts,priorArtifacts,
  reviewedArtifacts:step.role==='qa'?priorArtifacts:undefined});
 if(!equal(after,records)||sha(fs.readFileSync(root+'/registry.json'))!==sourceRegistrySha256||sha(fs.readFileSync(file))!==sourceReportSha256)fail('CURRENT13_PREFIX_CONCURRENT_CHANGE');
 step.status='PASS';step.leaseReleased=true;plan.callsSpent=records.length;plan.rootCallsSpent=records.length;plan.budgetRecords=records;plan.status='PARTIAL_VALIDATED';delete plan.errorCode;
 plan.postExecutionPrefixFinalization={schemaVersion:1,kind:'closed-success-prefix',sourceScope:'original-step-implementations',sourceReportSha256,sourceRegistrySha256,
  previousReport:{file:path.relative(root,reportArchive.file),sha256:reportArchive.sha256},previousRegistry:{file:path.relative(root,registryArchive.file),sha256:registryArchive.sha256},
  releaseReceipt:controlRef(releaseFile,root),successfulPrefix:started,budgetUsedBefore:records.length,budgetUsedAfter:records.length,modelCallsAdded:0,at:new Date().toISOString()};
 validateCurrent13ResumePlan(plan);writePrivate(file,{...plan,steps:plan.steps.map(({goal,...entry})=>entry)});
 return{status:plan.status,changed:true,successfulPrefix:started,budgetSpent:records.length,modelCallsAdded:0,
  testing:step.testing.map(({command,exitCode,count})=>({command,exitCode,count})),optionalPluginState:step.optionalPluginState};
}
async function finalizePrefixFromNative(){
 const url=process.env.SUPER_AGENT_ISOLATED_DATABASE_URL;
 if(url!=='postgres://postgres@127.0.0.1:5432/sa_multi_runtime_acceptance'||process.env.SUPER_AGENT_ISOLATED_MULTI_RUNTIME!=='1')fail('CURRENT13_PREFIX_FINALIZATION_SCOPE_DENIED');
 const schema=await import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),orm=await import('/opt/paperclip/node_modules/drizzle-orm/index.js'),db=schema.createDb(url);
 try{return await finalizeCurrent13SucceededPrefix({getRun:async id=>(await db.select().from(schema.heartbeatRuns).where(orm.eq(schema.heartbeatRuns.id,id)))[0],
  getRuns:companyId=>db.select().from(schema.heartbeatRuns).where(orm.eq(schema.heartbeatRuns.companyId,companyId)),
  getRootTask:async id=>(await db.select().from(schema.issues).where(orm.eq(schema.issues.id,id)))[0]});}
 finally{await schema.closeRegisteredClients(url);}
}

export async function runCurrent13RuntimeAcceptance(inputFile,{afterAcceptance,resumeCurrent13=false,allowHistoricalSourceTransition=false}={}){
 if(process.platform!=='linux'||process.getuid()!==0||process.env.SUPER_AGENT_ISOLATED_MULTI_RUNTIME!=='1')fail('CURRENT13_ISOLATED_OPERATOR_REQUIRED');
 if(allowHistoricalSourceTransition&&!resumeCurrent13)fail('CURRENT13_SOURCE_TRANSITION_REQUIRES_RESUME');
 if(resumeCurrent13?!fs.existsSync(reportFile):fs.existsSync(reportFile))fail('CURRENT13_ALREADY_STARTED_RECONCILE_OR_READ');
 const input=privateJson(inputFile);assertDelegatedAuth(input.codexAuth);
 const saved=resumeCurrent13?privateJson(reportFile):null;if(saved)validateCurrent13ResumePlan(saved);
 const baseBytes=fs.readFileSync(ROOT+'/multi-runtime-acceptance.json'),fixturePlan=rehydrateAcceptancePlan(JSON.parse(baseBytes));
 const historicalBytes=resumeCurrent13?fs.readFileSync(ROOT+'/'+saved.historicalMatrix.archive.file):baseBytes,historical=JSON.parse(historicalBytes);
 if(saved&&sha(historicalBytes)!==saved.historicalMatrix.reportSha256)fail('CURRENT13_HISTORY_CHANGED');
 const fixture=await createMultiRuntimeNativeFixture(fixturePlan,input,{resumeCompleted:true,migrateRoster:!resumeCurrent13,
  ...(resumeCurrent13?{resumeCurrent13:true,allowHistoricalSourceTransition:allowHistoricalSourceTransition===true,current13:{validateRunEvidence:validateCurrent13RunEvidence,fixedInputs:current13FixedInputHashes()}}:{})});
 let plan=saved?hydrateCurrent13Plan(saved):undefined,meter,safeToClose=true;
 const save=()=>writePrivate(reportFile,{...plan,steps:plan.steps.map(({goal,...step})=>step)});
 try{
  if(!['ensureAcceptanceTask','assignAcceptanceTask','verifyActorScopeClosed'].every(name=>typeof fixture[name]==='function'))fail('CURRENT13_NATIVE_OWNER_PORTS_REQUIRED');
  if(!resumeCurrent13){
   const historicalArchive=archivePrivateSnapshot(ROOT+'/current13-history','historical-matrix',historicalBytes);
   plan=createCurrent13Acceptance({historical,historicalReportSha256:sha(historicalBytes),agentIds:fixture.registry.team.ids});
   plan.historicalMatrix.archive={file:path.relative(ROOT,historicalArchive.file),sha256:historicalArchive.sha256};plan.rosterMigration=fixture.registry.rosterMigration;
   const originalBudget=budgetRecords(plan.rootTaskId);if(originalBudget.length!==plan.callsSpentBefore)fail('CURRENT13_HISTORY_BUDGET_CHANGED');
   plan.budgetRecords=originalBudget;plan.historicalMatrix.budgetRecords=structuredClone(originalBudget);save();
  }else if(!equal(plan.agentIds,fixture.registry.team.ids)||!equal(plan.budgetRecords,budgetRecords(plan.rootTaskId)))fail('CURRENT13_RESUME_STATE_CHANGED');
  const oldArtifacts=historical.steps.flatMap(step=>step.artifacts),cwd=fixture.cwd;verifyReferences(cwd,oldArtifacts);
  if(!resumeCurrent13){
   for(const[file,text]of Object.entries({...FIXED,'item-feature.mjs':FEATURE_STUB,'item-http.mjs':HTTP_STUB,'item-preferences.mjs':PREFERENCES_STUB}))fs.writeFileSync(path.join(cwd,file),text,{flag:'wx',mode:0o600});
   plan.fixedInputs=current13FixedInputHashes();
  }else validateCurrent13FrozenInputs({cwd,references:plan.fixedInputs});
  const seen=new Set();for(const step of plan.steps)if(!seen.has(step.taskId)){
   seen.add(step.taskId);if(!await fixture.issue(step.taskId)){if(resumeCurrent13)fail('CURRENT13_RESUME_TASK_MISSING');await fixture.ensureAcceptanceTask(step);}
  }
  const projectRegistry=change=>{const before=fixture.readRegistryBytes(),next=change(fixture.getRegistry());return fixture.setRegistryCAS(next,{expectedSha256:sha(before)});};
  if(!resumeCurrent13)projectRegistry(registry=>({...registry,tasks:[...new Set([...registry.tasks,...plan.steps.map(step=>step.taskId)])],taskRoots:{...registry.taskRoots,...Object.fromEntries(plan.steps.map(step=>[step.taskId,plan.rootTaskId]))}}));
  meter=new AdmissionMeter({filename:fixture.admissionFile,allowedProjectIds:[plan.projectId],log:event=>fs.appendFileSync(ROOT+'/operator13.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600})});
  for(const step of plan.steps){
   if(step.status==='PASS'){revalidateCurrent13PassedStep({plan,step,current:await fixture.getRun(step.runId),ownerId:fixture.ownerId,cwd});continue;}
   if(fs.existsSync(ROOT+'/call.lock'))fail('CURRENT13_PREVIOUS_CALL_UNKNOWN');
   verifyReferences(cwd,oldArtifacts);verifyReferences(cwd,plan.fixedInputs);
   const priorArtifacts=plan.steps.filter(prior=>prior.status==='PASS').flatMap(prior=>prior.artifacts??[]);verifyReferences(cwd,priorArtifacts);
   const beforeBudget=budgetRecords(plan.rootTaskId);preserveBudget(plan.budgetRecords,beforeBudget);
   if(beforeBudget.length!==plan.callsSpent||beforeBudget.length>=20)fail('CURRENT13_BUDGET_CHANGED');
   const task=await fixture.issue(step.taskId);if(!task||task.companyId!==plan.companyId||task.projectId!==plan.projectId)fail('CURRENT13_TASK_SCOPE_DENIED');
   const profile=RUNTIME_PROFILES[step.runtimeProfileId];
   let handoff;
   if(step.handoffFromOperationId){
    const from=plan.steps.find(prior=>prior.operationId===step.handoffFromOperationId),previousRun=await fixture.getRun(from.runId),proof=readRunProof(from);
    validateCurrent13RunEvidence({step:from,run:previousRun,...proof});
    step.actorScopeClosure=validateCurrent13ActorClosure(await fixture.verifyActorScopeClosed(step.taskId,from.agentId),{taskId:step.taskId,agentId:from.agentId});
    if(taskInputRevision(task)!==from.taskRuntimeRoute.inputRevision)fail('CURRENT13_TASK_DESCRIPTION_CHANGED');
    if(step.handoff)verifyCurrent13Handoff({cwd,receipt:step.handoff});
    else{step.handoff=snapshotCurrent13Handoff({cwd,rootTaskId:plan.rootTaskId,from,to:step,artifacts:from.artifacts,budget:beforeBudget});
     from.artifacts=step.handoff.artifacts.map(ref=>({taskId:from.taskId,runId:from.runId,file:ref.file,sha256:ref.sha256}));}
    handoff={previousRoute:from.taskRuntimeRoute,previousRun,transport:proof.transport,executionClosed:true,actorScopeClosed:step.actorScopeClosure.closed,handoffKind:'role-transfer',
     budgetUsedBefore:beforeBudget.length,artifacts:step.handoff.artifacts.map(({file,sha256,runId})=>({file,sha256,runId})),material:{file:step.handoff.receiptFile,sha256:sha(fs.readFileSync(path.join(cwd,step.handoff.receiptFile)))}};
    save();
   }
   const sourceNames=new Set(['item-feature.mjs','item-http.mjs','item-feature.test.mjs','item-http.test.mjs','current13-requirements.md','fullstack13.json','backend13.json']);
   const sources=plan.steps.slice(0,2).flatMap(prior=>prior.artifacts??[]).filter(ref=>sourceNames.has(path.basename(ref.file))).map(({file,sha256})=>({file,sha256}));
   if(step.role==='research')step.sources=sources;
   const reviewedArtifacts=step.role==='qa'?plan.steps.filter(prior=>prior!==step).flatMap(prior=>prior.artifacts??[]):undefined;
   const existingOperation=fixture.getRegistry().operations.find(operation=>operation.id===step.operationId);
   const route=existingOperation?step.taskRuntimeRoute:createTaskRuntimeRoute({taskId:step.taskId,rootTaskId:plan.rootTaskId,agentId:step.agentId,role:step.role,operationId:step.operationId,inputRevision:taskInputRevision(task),selection:step.selection,...(handoff?{handoff}:{})});
   if(existingOperation&&(!resumeCurrent13||!route||route.inputRevision!==taskInputRevision(task)||!equal(existingOperation.taskRuntimeRoute,route)))fail('CURRENT13_PREPARED_ROUTE_CHANGED');
   if(route.profileId!==step.runtimeProfileId)fail('CURRENT13_ROUTE_PROFILE_CHANGED');step.taskRuntimeRoute=route;
   const operation={id:step.operationId,kind:'run',taskId:step.taskId,agentId:step.agentId,role:step.role,projectId:plan.projectId,rootTaskId:plan.rootTaskId,rootInputRevision:plan.rootInputRevision,
    inputRevision:route.inputRevision,phase:'work',outputFile:step.outputFile,additionalInput:step.goal+(step.handoff?'\n可信同任务交接：'+JSON.stringify(step.handoff):'')+(step.sources?'\n可信sources精确列表：'+JSON.stringify(step.sources):''),
    taskRuntimeRoute:route,...(reviewedArtifacts?{reviewedArtifacts,reviewedTaskKeys:plan.steps.filter(prior=>prior!==step).map(prior=>prior.key)}:{})};
   if(existingOperation){
    if(Object.entries(operation).some(([key,value])=>!equal(value,existingOperation[key]))||['runId','startedAt','wakeAttemptedAt','finishedAt'].some(key=>existingOperation[key]!=null)||beforeBudget.some(record=>record.operationId===step.operationId))fail('CURRENT13_PREPARED_ROUTE_CHANGED');
   }else projectRegistry(registry=>projectTaskRuntimeRoute({...registry,operations:[...registry.operations,operation]},route));
   await fixture.configureRuntime(step,route,{reusePrepared:Boolean(existingOperation)});
   const lease=await reserveAcceptanceTask({meter,taskId:step.taskId,projectId:plan.projectId,readStorage:()=>privateJson('/host-evidence/host-storage.json')},{timeoutMs:900000});
   safeToClose=false;step.status='RESERVED';save();projectRegistry(registry=>({...registry,lease:{taskId:step.taskId,projectId:plan.projectId,operationId:step.operationId,nonce:lease.nonce}}));
   await fixture.assignAcceptanceTask(step,{expectedAgentId:task.assigneeAgentId??null,expectedAssigneeUserId:task.assigneeUserId??null,expectedCurrentStatus:task.status,inputRevision:route.inputRevision,
    ...(route.handoff?.handoffKind==='role-transfer'?{fromActor:{agentId:route.handoff.fromAgentId,role:route.handoff.fromRole,runId:route.handoff.fromRunId,operationId:step.handoffFromOperationId}}:{})});
   const controlledExecution=await prepareCurrent13Wake({fixture,step,route,onSessionReset:()=>{step.status='WAKE_PENDING';save();}});
   const started=Date.now(),run=await fixture.heartbeat.wakeup(step.agentId,{manualUserWake:true,source:'on_demand',triggerDetail:'manual',requestedByActorType:'user',requestedByActorId:fixture.ownerId,
    reason:'issue_commented',idempotencyKey:'current13:'+step.operationId,payload:{issueId:step.taskId},contextSnapshot:{issueId:step.taskId,taskId:step.taskId,projectId:plan.projectId,responsibleUserId:fixture.ownerId,
     inputRevision:route.inputRevision,roleOperationId:step.operationId,taskGoal:step.goal,forceFreshSession:true,conversationMode:false,superAgentControlledExecution:controlledExecution}});
   if(!run?.id)fail('CURRENT13_WAKE_RESULT_UNKNOWN');step.runId=run.id;step.status='RUNNING';save();
   let current;const deadline=Date.now()+195000;
   while(Date.now()<deadline){current=await fixture.getRun(run.id);if(!['queued','running'].includes(current?.status))break;await new Promise(resolve=>setTimeout(resolve,500));}
   step.nativeEvidence=publicRunEvidence(current??run,profile);step.nativeStatus=current?.status??'UNKNOWN';save();
   const afterBudget=finalizeCurrent13StepBoundary({plan,step,current,ownerId:fixture.ownerId,cwd,beforeBudget,oldArtifacts,priorArtifacts,reviewedArtifacts,started});
   meter.release({taskId:step.taskId,nonce:lease.nonce,terminalEvidence:true});projectRegistry(registry=>{const next={...registry};delete next.lease;return next;});
   safeToClose=true;step.leaseReleased=true;step.status='PASS';plan.callsSpent=afterBudget.length;plan.rootCallsSpent=afterBudget.length;plan.budgetRecords=afterBudget;save();
  }
  plan.status='PASS';save();if(afterAcceptance)await afterAcceptance({plan,fixture,meter,reportFile});return{...plan,steps:plan.steps.map(({goal,...step})=>step)};
 }catch(error){
  if(plan){plan.status='FAILED';plan.errorCode=/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CURRENT13_ACCEPTANCE_FAILED';try{plan.callsSpent=budgetRecords(plan.rootTaskId).length;}catch{}save();}
  throw Object.assign(Error(/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CURRENT13_ACCEPTANCE_FAILED'),{code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CURRENT13_ACCEPTANCE_FAILED'});
 }finally{meter?.close();if(safeToClose)await fixture.close();}
}
export function parseCurrent13AcceptanceArgs(args){
 if(args[0]==='--finalize-current13-prefix'&&(args.length===1||args.length===3&&args[1]==='--input'))return{mode:'finalize'};
 if(args.length===3&&args[0]==='--resume-current13'&&args[1]==='--input')return{mode:'resume',inputFile:args[2],allowHistoricalSourceTransition:false};
 if(args.length===4&&args[0]==='--resume-current13'&&args[1]==='--allow-historical-source-transition'&&args[2]==='--input')return{mode:'resume',inputFile:args[3],allowHistoricalSourceTransition:true};
 if(args.length===2&&args[0]==='--input')return{mode:'run',inputFile:args[1]};
 fail('CURRENT13_ARGUMENT_DENIED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=parseCurrent13AcceptanceArgs(process.argv.slice(2));let result;
  // The metadata-only branch intentionally does not read the credential input.
  if(args.mode==='finalize')result=await finalizePrefixFromNative();
  else if(args.mode==='resume')result=await runCurrent13RuntimeAcceptance(args.inputFile,{resumeCurrent13:true,allowHistoricalSourceTransition:args.allowHistoricalSourceTransition});
  else result=await runCurrent13RuntimeAcceptance(args.inputFile);
  console.log(JSON.stringify(result));}
 catch(error){console.error(JSON.stringify({status:'FAILED',errorCode:error.code??'CURRENT13_ACCEPTANCE_FAILED'}));process.exitCode=1;}
}
