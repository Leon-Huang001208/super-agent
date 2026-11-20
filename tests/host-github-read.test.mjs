import test from 'node:test';
import assert from 'node:assert/strict';
import {readHostGithub,hasHostGithubRepository} from '../bridge/host-github-read.mjs';
import {createHostCapabilityExecutor} from '../bridge/role-host-capabilities.mjs';
import {resolveRoleCapabilities} from '../bridge/role-capabilities.mjs';

const head='a'.repeat(40),repository='owner/project';
function fixture(){
 const calls=[],events=[],permit={runId:'run',taskId:'task',rootTaskId:'root',projectId:'project',role:'qa',
  projectContext:{id:'project',key:'sample',repository:{fullName:repository,url:'https://github.com/'+repository,hostPath:null},workspace:{hostPath:null},checks:[],delivery:{maximumAction:'artifact'}},
  effectiveCapabilities:{hostAllowedTools:['host.github_read'],capabilityIds:['qa']}};
 let result={number:43,state:'open',headSha:head,draft:false,updatedAt:'2026-11-21T00:00:00Z'};
 const runner=(binary,args,options)=>{calls.push({binary,args,options});return {status:0,stdout:JSON.stringify(result),stderr:''};};
 const options={permit,runner,log:event=>events.push(event),exists:binary=>binary==='/opt/homebrew/bin/gh'};
 return{permit,calls,events,options,setResult:value=>result=value};
}
test('registered repository GET works without a code workspace and keeps host authentication outside result',async()=>{
 const f=fixture(),executor=createHostCapabilityExecutor(f.options);
 assert.deepEqual(executor.listTools().map(tool=>tool.name),['host.github_read']);
 const result=await executor.execute('host.github_read',{operation:'pull_request',number:43});
 assert.equal(result.repository,repository);assert.equal(result.operation,'pull_request');assert.equal(result.data.headSha,head);
 assert.equal(result.data.url,'https://github.com/owner/project/pull/43');assert.match(result.observedAt,/^\d{4}-/);
 assert.equal(result.source,'host gh GET');assert.equal(f.calls.length,1);
 const call=f.calls[0];assert.equal(call.binary,'/opt/homebrew/bin/gh');assert.deepEqual(call.args.slice(0,6),['api','--method','GET','--hostname','github.com','repos/owner/project/pulls/43']);
 assert.ok(call.args.includes('--jq'));assert.equal(call.options.shell,false);assert.equal(call.options.timeout,20000);
 assert.ok(!JSON.stringify(result).includes('env'));assert.ok(!JSON.stringify(result).includes('token'));
});
test('list endpoints are fixed, issue lists exclude pull requests, and a full page stays explicitly truncated',async()=>{
 const f=fixture(),executor=createHostCapabilityExecutor(f.options);
 f.setResult({items:Array.from({length:100},(_,i)=>({number:i+1,state:'open',headSha:head,draft:false,updatedAt:null})),received:100});
 const pulls=await executor.execute('host.github_read',{operation:'pull_requests'});assert.equal(pulls.truncated,true);assert.equal(pulls.data.length,100);
 assert.equal(f.calls.at(-1).args[5],'repos/owner/project/pulls?state=open&per_page=100');
 f.setResult({items:[{number:262,state:'open',updatedAt:null}],received:22});
 const issues=await executor.execute('host.github_read',{operation:'issues'});assert.equal(issues.truncated,false);assert.equal(issues.data[0].url,'https://github.com/owner/project/issues/262');
 assert.match(f.calls.at(-1).args.at(-1),/has\("pull_request"\)/);
 f.setResult({items:[{number:262,state:'open',updatedAt:null}],received:100});
 assert.equal((await executor.execute('host.github_read',{operation:'issues'})).truncated,true,'filtering PRs cannot hide a full API page');
});
test('branch refs are encoded and returned SHA and object identity are validated',async()=>{
 const f=fixture(),executor=createHostCapabilityExecutor(f.options);
 f.setResult({name:'codex/branch',sha:head,protected:false});
 const result=await executor.execute('host.github_read',{operation:'branch',ref:'codex/branch'});
 assert.equal(result.data.sha,head);assert.equal(f.calls.at(-1).args[5],'repos/owner/project/branches/codex%2Fbranch');
 f.setResult({name:'foreign',sha:head});await assert.rejects(executor.execute('host.github_read',{operation:'branch',ref:'master'}),/ROLE_HOST_GITHUB_RESPONSE_INVALID/);
 f.setResult({number:44,state:'open',headSha:head});await assert.rejects(executor.execute('host.github_read',{operation:'pull_request',number:43}),/ROLE_HOST_GITHUB_RESPONSE_INVALID/);
 f.setResult({number:43,state:'open',isPullRequest:true});await assert.rejects(executor.execute('host.github_read',{operation:'issue',number:43}),/ROLE_HOST_GITHUB_RESPONSE_INVALID/);
});
test('caller cannot select another repository, command, URL, write method, endpoint or unsafe ref',async()=>{
 const f=fixture(),executor=createHostCapabilityExecutor(f.options);
 for(const args of [{operation:'pull_request',number:43,repository:'foreign/repo'},{operation:'issues',method:'POST'},
  {operation:'issues',url:'https://example.invalid'},{operation:'issues',argv:['gh','auth','token']},{operation:'merge',number:43},
  {operation:'issue',number:-1},{operation:'issue',number:1.5},{operation:'branch',ref:'../master'},
  {operation:'branch',ref:'master?write=yes'},{operation:'branch',ref:'--help'},{operation:'branch',ref:'master\nsecret'},
  {operation:'issues',ref:'master'},{operation:'pull_request',number:43,ref:'master'}]){
  await assert.rejects(executor.execute('host.github_read',args),/ROLE_HOST_GITHUB_ARGUMENTS_DENIED/);
 }
 assert.equal(f.calls.length,0);
});
test('unregistered or mismatched repository metadata cannot expose the tool or redirect credentials',async()=>{
 const f=fixture();delete f.permit.projectContext.repository.fullName;
 assert.equal(hasHostGithubRepository(f.permit.projectContext),false);assert.deepEqual(createHostCapabilityExecutor(f.options).listTools(),[]);
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.github_read',{operation:'issues'}),/ROLE_HOST_GITHUB_REPOSITORY_REQUIRED/);
 f.permit.projectContext.repository={fullName:repository,url:'https://github.com/foreign/repo',hostPath:null};
 assert.equal(hasHostGithubRepository(f.permit.projectContext),false);
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.github_read',{operation:'issues'}),/ROLE_HOST_GITHUB_REPOSITORY_REQUIRED/);
 assert.equal(f.calls.length,0);
});
test('missing CLI and connection failures have explicit safe errors and no anonymous fallback',async()=>{
 const f=fixture();
 await assert.rejects(createHostCapabilityExecutor({...f.options,exists:()=>false}).execute('host.github_read',{operation:'issues'}),/ROLE_HOST_GITHUB_CLI_UNAVAILABLE/);
 assert.equal(f.calls.length,0);
 const failed=createHostCapabilityExecutor({...f.options,runner:()=>({status:4,stdout:'',stderr:'authentication unavailable; fixture-secret'})});
 await assert.rejects(failed.execute('host.github_read',{operation:'issues'}),error=>error.code==='ROLE_HOST_GITHUB_CONNECTION_UNAVAILABLE'&&!JSON.stringify(error).includes('fixture-secret'));
 let attempts=0;
 await assert.rejects(readHostGithub({permit:f.permit,args:{operation:'issues'},exists:f.options.exists,run:async()=>{attempts++;throw Object.assign(Error('fixture-secret'),{code:'ROLE_HOST_COMMAND_TIMEOUT'});}}),/ROLE_HOST_GITHUB_CONNECTION_UNAVAILABLE/);
 assert.equal(attempts,1);
});
test('candidate assignment and directory discovery do not certify a GitHub connection or business acceptance',()=>{
 const capability=resolveRoleCapabilities({role:'research',toolCatalog:[{name:'host.github_read',connected:true}]});
 assert.ok(capability.hostAllowedTools.includes('host.github_read'));
 const stages=capability.evidence.tools.find(tool=>tool.name==='host.github_read').stages;
 assert.equal(stages.discovered,'PASS');for(const stage of ['connected','action-tested','business-accepted'])assert.equal(stages[stage],'NOT_RUN');
});
test('only the GitHub read command asks for the existing host proxy policy',async()=>{
 const f=fixture();let proxyCalls=0;
 f.permit.effectiveCapabilities.hostAllowedTools.push('host.network_observe');
 const normalRunner=f.options.runner;
 const executor=createHostCapabilityExecutor({...f.options,platform:'darwin',
  proxyEnvironment:()=>{proxyCalls++;return{HTTP_PROXY:'http://127.0.0.1:29758',HTTPS_PROXY:'http://127.0.0.1:29758',NO_PROXY:'127.0.0.1,localhost',NODE_USE_ENV_PROXY:'1'};},
  runner:(binary,args,options)=>binary.endsWith('/gh')?normalRunner(binary,args,options):{status:0,stdout:'',stderr:''}});
 await executor.execute('host.network_observe');assert.equal(proxyCalls,0,'ordinary host tools keep their previous command environment');
 await executor.execute('host.github_read',{operation:'pull_request',number:43});assert.equal(proxyCalls,1);
 const command=f.calls.at(-1);assert.equal(command.options.env.HTTPS_PROXY,'http://127.0.0.1:29758');assert.equal(command.options.env.NODE_USE_ENV_PROXY,'1');
 assert.ok(!command.args.some(arg=>/proxy|HOME|token/.test(arg)),'model parameters cannot supply proxy or credential configuration');
});
