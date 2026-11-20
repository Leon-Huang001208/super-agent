import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {resolveRwbReleaseMetadata,rwbReleaseTimeoutPolicy,rwbReleaseBrokerLifetimeMs,RWB_RELEASE_TIMEOUTS,postRwbReleaseRequest} from '../bridge/rwb-release.mjs';
import {resolveRoleProjectContext} from '../bridge/role-project-context.mjs';
import {createHostCapabilityExecutor} from '../bridge/role-host-capabilities.mjs';
import {hostCapabilityTimeoutMs} from '../bridge/role-host-call-queue.mjs';
import {nativeRoleCliArgs} from '../scripts/role-host-transport.mjs';
import {createNativeRoleAdapter} from '../bridge/native-role-adapter.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';

const repository='Leon-Huang001208/ResearchWorkbench',candidateSha='a'.repeat(40),targetSha='b'.repeat(40),priorSha='c'.repeat(40);
const seal=argv=>createHash('sha256').update(JSON.stringify(argv)).digest('hex');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rwb-release-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const repositoryRoot=path.join(dir,'repo'),common=path.join(repositoryRoot,'.git'),sourceHostPath=path.join(dir,'source'),residentHome=path.join(dir,'resident'),controlRoot=path.join(dir,'control');
 const write=(filename,value)=>{fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,JSON.stringify(value),{mode:0o600});};
 const entry={schemaVersion:1,companyId:'company',projectId:'project',rootTaskId:'root-task',repository,repositoryRoot,managedTaskId:'original-rwb-task',pullRequest:318,candidateSha,targetSha,priorSha,sourceHostPath,residentHome,operations:[]};
 for(const action of ['inspect','merge','deploy','rollback']){
  const argv=action==='inspect'?[]:action==='merge'?['/tools/node',path.join(repositoryRoot,'scripts/git_safety.mjs'),'delivery','--project',repositoryRoot,'--task-id',entry.managedTaskId,'--status']:
   ['/tools/python3.12','-B','-m','research_workbench_entrypoint.resident.model_provider_upgrade',action==='deploy'?'apply-local-knowledge':'rollback-local-knowledge','--home',residentHome,
    ...(action==='deploy'?['--source',sourceHostPath]:['--rollback-target',targetSha])];
  entry.operations.push({id:'release-'+action,nativeOperationId:'native-operation',action,cwd:['deploy','rollback'].includes(action)?sourceHostPath:repositoryRoot,argv,argvSha256:seal(argv)});
 }
 const receipt={taskId:entry.managedTaskId,repositoryRoot,mode:'pr',pullRequest:{number:318,url:'https://github.com/'+repository+'/pull/318'},integrationCommit:candidateSha,status:'awaiting_ci',remoteCommit:'d'.repeat(40)};
 const receiptPath=path.join(common,'leon-engineering/deliveries',entry.managedTaskId+'.json');
 const managedReviewPath=path.join(common,'leon-engineering/git-safety/reviews',entry.managedTaskId+'.json');
 const nativePath=path.join(controlRoot,'operations/native-operation.json'),residentPath=path.join(residentHome,'resident/accepted.json');
 write(receiptPath,receipt);write(managedReviewPath,{status:'PASS',reviewedCommit:candidateSha});
 write(nativePath,{operationId:'native-operation',runId:'run',taskId:'devops-child',agentId:'operator'});write(residentPath,{target:priorSha});
 fs.mkdirSync(sourceHostPath);
 const permit={companyId:'company',projectId:'project',rootTaskId:'root-task',taskId:'devops-child',runId:'run',agentId:'operator',role:'devops',
  authorizedHostActions:entry.operations.map(value=>value.id),effectiveCapabilities:{capabilityIds:['devops'],hostAllowedTools:['host.rwb_release']},
  projectContext:{id:'project',key:'research-workbench',repository:{fullName:repository,hostPath:repositoryRoot},delivery:{maximumAction:'pull_request'},checks:[{id:'unit'}],rwbRelease:entry},
  codeReview:{verdict:'PASS',rootTaskId:'root-task',projectId:'project',candidateSha,runId:'qa-run',agentId:'quality',checks:[{id:'unit',status:'passed',candidateSha}],verification:{status:'passed'}}};
 const calls=[];let sourceDirty=false,sourceTree='tree',actualSource=targetSha;
 const runner=(binary,args,options)=>{
  calls.push({binary,args,options});let stdout='managed result';
  if(binary==='/usr/bin/git'){
   const argv=args.slice(1);
   if(argv.includes('--git-common-dir'))stdout=common;
   else if(argv[0]==='remote')stdout='git@github.com:'+repository+'.git';
   else if(argv[0]==='status')stdout=sourceDirty?' M unexpected.py':'';
   else if(argv.at(-1)?.endsWith('^{tree}'))stdout=options.cwd===sourceHostPath?sourceTree:'tree';
   else stdout=actualSource;
  }
  return {status:0,stdout,stderr:''};
 };
 const options={permit,runner,controlRoot,platform:'darwin',verifyVolume:async()=>true,log:()=>{}};
 const merged=()=>{Object.assign(receipt,{status:'ci_passed',remoteCommit:targetSha,ci:{status:'passed'},verification:{status:'passed'}});write(receiptPath,receipt);};
 return {dir,entry,permit,options,calls,receipt,receiptPath,managedReviewPath,nativePath,residentPath,write,merged,
  setDirty:value=>sourceDirty=value,setTree:value=>sourceTree=value,setSource:value=>actualSource=value};
}

test('Native release registration is root-scoped and preserves the ordinary RWB PR ceiling',t=>{
 const f=fixture(t),project={id:'project',companyId:'company',name:'ResearchWorkbench'},workspace={id:'workspace',projectId:'project',metadata:{superAgentProject:{
  key:'research-workbench',repository:f.permit.projectContext.repository,delivery:{maximumAction:'pull_request'},rwbRelease:f.entry}}};
 const resolve=rootTaskId=>resolveRoleProjectContext({companyId:'company',ownerId:'owner',project,workspace,rootTaskId});
 assert.deepEqual(resolve('root-task').rwbRelease,f.entry);assert.equal(resolve('root-task').delivery.maximumAction,'pull_request');
 assert.equal(Object.hasOwn(resolve('other-task'),'rwbRelease'),false);
 f.entry.companyId='other';assert.throws(()=>resolve('root-task'),/RWB_REGISTRATION_DENIED/);
});
test('registered command seals cannot introduce shell, arbitrary modules, flags or different task targets',t=>{
 const f=fixture(t),scope={companyId:'company',projectId:'project',rootTaskId:'root-task',repository:f.permit.projectContext.repository};
 for(const modify of [
  value=>value.operations[1].argv.push('--force'),
  value=>{value.operations[1].argv=['/bin/sh','-c','echo arbitrary'];value.operations[1].argvSha256=seal(value.operations[1].argv);},
  value=>{value.operations[2].argv[3]='other.module';value.operations[2].argvSha256=seal(value.operations[2].argv);},
  value=>{value.operations[1].argv[6]='different-task';value.operations[1].argvSha256=seal(value.operations[1].argv);},
  value=>value.operations.push(value.operations[0])
 ]){const value=structuredClone(f.entry);modify(value);assert.throws(()=>resolveRwbReleaseMetadata(value,scope),/ROLE_HOST_RWB_/);}
});
test('inspect reads the original local receipt without running status, publishing, transfer or resident commands',async t=>{
 const f=fixture(t),executor=createHostCapabilityExecutor(f.options);
 assert.ok(executor.listTools().some(value=>value.name==='host.rwb_release'));
 const result=await executor.execute('host.rwb_release',{operationId:'release-inspect'});
 assert.equal(result.deliveryStatus,'awaiting_ci');assert.equal(result.acceptedSha,priorSha);
 assert.ok(f.calls.every(value=>value.binary==='/usr/bin/git'));
 assert.ok(f.calls.every(value=>!value.args.includes('--status')));
});
test('only the registered DevOps run, original operation and authorized action can execute',async t=>{
 for(const mutate of [f=>f.permit.role='chief',f=>f.permit.companyId='other',f=>f.permit.rootTaskId='other-root',f=>f.permit.runId='different-run',
  f=>f.permit.authorizedHostActions=[],f=>f.permit.effectiveCapabilities.capabilityIds=[]]){
  const f=fixture(t);mutate(f);await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-merge'}),/ROLE_HOST_RWB_/);
  assert.ok(!f.calls.some(value=>value.binary==='/tools/node'));
 }
 const f=fixture(t);delete f.permit.projectContext.rwbRelease;
 assert.ok(!createHostCapabilityExecutor(f.options).listTools().some(value=>value.name==='host.rwb_release'));
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-merge',argv:['bad']}),/ROLE_HOST_ARGUMENTS_INVALID/);
});
test('merge reuses the original managed task only after independent Native and RWB reviews match',async t=>{
 const f=fixture(t),executor=createHostCapabilityExecutor(f.options);
 const result=await executor.execute('host.rwb_release',{operationId:'release-merge'});assert.equal(result.exitCode,0);
 const call=f.calls.find(value=>value.binary==='/tools/node');assert.deepEqual([call.binary,...call.args],f.entry.operations[1].argv);assert.equal(call.options.shell,false);
 assert.equal(call.options.timeout,RWB_RELEASE_TIMEOUTS.commandMs);
 const before=f.calls.length;f.permit.codeReview.candidateSha='e'.repeat(40);
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-merge'}),/RWB_REVIEW_REQUIRED/);
 assert.equal(f.calls.slice(before).filter(value=>value.binary==='/tools/node').length,0);
 f.permit.codeReview.candidateSha=candidateSha;f.write(f.managedReviewPath,{status:'PASS',reviewedCommit:targetSha});
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-merge'}),/RWB_MANAGED_REVIEW_REQUIRED/);
});
test('deploy requires the actual managed merged target, exact clean product tree and original accepted prior',async t=>{
 const f=fixture(t);
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-deploy'}),/RWB_MERGED_TARGET_REQUIRED/);
 f.merged();f.setDirty(true);await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-deploy'}),/RWB_SOURCE_CHANGED/);
 f.setDirty(false);f.setTree('different');await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-deploy'}),/RWB_SOURCE_CHANGED/);
 f.setTree('tree');f.write(f.residentPath,{target:'e'.repeat(40)});await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-deploy'}),/RWB_PRIOR_CHANGED/);
 f.write(f.residentPath,{target:priorSha});const result=await createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-deploy'});
 assert.equal(result.action,'deploy');assert.equal(f.calls.filter(value=>value.binary==='/tools/python3.12').length,1);
});
test('rollback is the registered current candidate to its fixed prior, not a model-selected SHA',async t=>{
 const f=fixture(t);f.merged();f.write(f.residentPath,{target:targetSha,previous:priorSha});
 const result=await createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-rollback'});assert.equal(result.action,'rollback');
 const call=f.calls.find(value=>value.binary==='/tools/python3.12');assert.deepEqual(call.args.slice(-2),['--rollback-target',targetSha]);
 f.entry.priorSha='e'.repeat(40);await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-rollback'}),/RWB_PRIOR_CHANGED/);
});
test('release never runs on the wrong volume or with a changed original PR receipt',async t=>{
 const f=fixture(t);
 await assert.rejects(createHostCapabilityExecutor({...f.options,verifyVolume:async()=>false}).execute('host.rwb_release',{operationId:'release-merge'}),/RWB_VOLUME_IDENTITY_MISMATCH/);
 assert.equal(f.calls.length,0);f.receipt.pullRequest.number=314;f.write(f.receiptPath,f.receipt);
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.rwb_release',{operationId:'release-merge'}),/RWB_DELIVERY_CHANGED/);
});
test('one bounded release policy reaches command, actual broker client, MCP, Native process and adapter without widening normal runs',async t=>{
 const f=fixture(t);f.permit.executionPolicy=MACOS_NATIVE_EXECUTION_POLICY;f.permit.model='gpt-6.1-sol';
 assert.equal(rwbReleaseTimeoutPolicy(f.permit),RWB_RELEASE_TIMEOUTS);
 const bounds=RWB_RELEASE_TIMEOUTS;
 assert.ok(bounds.commandMs>450000+180000);assert.ok(bounds.rpcMs>bounds.commandMs);assert.ok(bounds.mcpSeconds*1000>bounds.rpcMs);
 assert.ok(bounds.processMs>bounds.mcpSeconds*1000);assert.ok(bounds.brokerMs>bounds.processMs);assert.ok(bounds.transportMs>bounds.brokerMs);assert.ok(bounds.nativeSeconds*1000>bounds.transportMs);
 assert.ok(rwbReleaseBrokerLifetimeMs(f.permit)>bounds.brokerMs);assert.ok(rwbReleaseBrokerLifetimeMs(f.permit)<=bounds.transportMs);
 const now=Date.now(),config={...f.permit,expiresAt:now+bounds.brokerMs};
 assert.equal(hostCapabilityTimeoutMs({config,tool:'host.rwb_release',args:{operationId:'release-deploy'},now}),bounds.rpcMs);
 for(const tool of ['host.project_check','host.network_apply'])assert.equal(hostCapabilityTimeoutMs({config,tool,now}),300000);
 assert.equal(hostCapabilityTimeoutMs({config,tool:'host.rwb_release',args:{operationId:'release-inspect'},now}),300000);
 assert.equal(hostCapabilityTimeoutMs({config:{...config,expiresAt:now+2500},tool:'host.rwb_release',args:{operationId:'release-deploy'},now}),2500);
 const cli=()=>nativeRoleCliArgs({permit:f.permit,client:'/client',instructionPath:'/instructions',endpoint:'https://127.0.0.1:1234/backend-api',hostTools:[{name:'host.rwb_release'}]});
 assert.ok(cli().includes('mcp_servers.role_host.tool_timeout_sec='+bounds.mcpSeconds));assert.ok(cli().some(arg=>arg.includes('env_vars=')&&arg.includes('ROLE_HOST_RWB_RELEASE')));
 const binding={runId:'run',agentId:'operator',companyId:'company',projectId:'project',taskId:'devops-child',ownerId:'owner',inputRevision:'revision'};
 const registration={...f.permit,binding,profile:{engine:'codex_local',role:'devops',executionPolicy:MACOS_NATIVE_EXECUTION_POLICY}};
 const ctx={runId:binding.runId,agent:{id:binding.agentId,companyId:binding.companyId},runtime:{sessionId:null},context:{issueId:binding.taskId,projectId:binding.projectId,responsibleUserId:binding.ownerId,inputRevision:binding.inputRevision},
  config:{engine:'cli',command:'/opt/super-agent/bin/codex',model:'gpt-6.1-sol',modelReasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:true,dangerouslyBypassSandbox:true,extraArgs:[],search:true,instructionsFilePath:'/materials/instructions.md',timeoutSec:600}};
 let dispatched;
 const adapter=createNativeRoleAdapter({basePromptTemplate:'Perform assigned release',log(){},readRegistration:async()=>registration,
  prepareRole:async()=>({binding,sessionMode:'new',knowledge:[],config:{instructionsFilePath:ctx.config.instructionsFilePath,dangerouslyBypassApprovalsAndSandbox:true}}),nativeExecute:async value=>{dispatched=value;return {exitCode:0};}});
 await adapter(ctx);assert.equal(dispatched.config.timeoutSec,bounds.nativeSeconds);assert.equal(ctx.config.timeoutSec,600);
 registration.authorizedHostActions=[];await adapter(ctx);assert.equal(dispatched.config.timeoutSec,600);
 f.permit.authorizedHostActions=['release-inspect'];assert.equal(rwbReleaseTimeoutPolicy(f.permit),null);assert.ok(cli().includes('mcp_servers.role_host.tool_timeout_sec=360'));
 f.permit.authorizedHostActions=['release-deploy'];f.permit.rootTaskId='unrelated';assert.equal(rwbReleaseTimeoutPolicy(f.permit),null);
});
test('the task-local release HTTP client survives delayed headers without fetch and has a finite unknown-result boundary',async t=>{
 const server=http.createServer((request,response)=>{let bytes='';request.on('data',chunk=>bytes+=chunk);request.on('end',()=>{
  const message=JSON.parse(bytes);setTimeout(()=>{if(response.destroyed)return;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{status:'consumed'}}));},80);
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const endpoint='http://127.0.0.1:'+server.address().port+'/backend-api/role-host-mcp';
 const message={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'host.rwb_release',arguments:{operationId:'release-deploy'}}};
 const response=await postRwbReleaseRequest(endpoint,'fixture-token',message,{timeoutMs:1000});assert.equal(response.ok,true);assert.equal(response.body.result.status,'consumed');
 await assert.rejects(postRwbReleaseRequest(endpoint,'fixture-token',message,{timeoutMs:10}),/HOST_CALL_RESULT_UNKNOWN/);
 await assert.rejects(postRwbReleaseRequest(endpoint,'fixture-token',message,{timeoutMs:RWB_RELEASE_TIMEOUTS.rpcMs+1}),/CLIENT_SCOPE_DENIED/);
});
test('the actual provider broker uses the bounded release hard lifetime and preserves the ordinary lifetime',async t=>{
 const f=fixture(t);
 for(const release of [false,true]){
  const folder=path.join(f.dir,release?'release-broker':'ordinary-broker');fs.mkdirSync(folder);
  const config={...f.permit,role:release?'devops':'research',key:'test-task-key',expiresAt:Date.now()+RWB_RELEASE_TIMEOUTS.brokerMs};
  fs.writeFileSync(path.join(folder,'config.json'),JSON.stringify(config));
  const jwt='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture'}})).toString('base64url')+'.eA';
  fs.writeFileSync(path.join(folder,'auth.json'),JSON.stringify({tokens:{access_token:'test-provider-key',id_token:jwt,account_id:'fixture'}}));
  const timerFile=path.join(folder,'timer.json'),ready=path.join(folder,'ready.json'),preload=path.join(folder,'timer-preload.mjs');
  fs.writeFileSync(preload,"import fs from 'node:fs'; const original=globalThis.setTimeout; globalThis.setTimeout=(callback,ms,...args)=>{if(ms>=600000)fs.writeFileSync("+JSON.stringify(timerFile)+",JSON.stringify({ms}));return original(callback,ms,...args);};");
  const child=spawn(process.execPath,['--import',preload,'docker/role-provider-proxy.mjs'],{cwd:process.cwd(),env:{...process.env,SUPER_AGENT_ROLE_PROXY_ROOT:folder,SUPER_AGENT_ROLE_PROXY_AUDIT:folder,SUPER_AGENT_ROLE_PROXY_LISTEN_HOST:'127.0.0.1',SUPER_AGENT_ROLE_PROXY_PORT:'0',SUPER_AGENT_ROLE_PROXY_READY_FILE:ready},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await ended;}});
  for(let tries=0;tries<100&&!fs.existsSync(ready)&&child.exitCode===null;tries++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(fs.existsSync(ready),'actual broker started');assert.equal(JSON.parse(fs.readFileSync(timerFile,'utf8')).ms,release?rwbReleaseBrokerLifetimeMs(f.permit):700000);
 }
});
