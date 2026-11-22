import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {HOST_TOOL_DEFINITIONS,prepareRoleProjectWorkspace,createHostCapabilityExecutor} from '../bridge/role-host-capabilities.mjs';
import {runHostCommand} from '../bridge/role-host-mcp.mjs';

const sha='a'.repeat(40), rootId='11111111-1111-4111-8111-111111111111';
const pathspecSelectors=['GIT_LITERAL_PATHSPECS','GIT_GLOB_PATHSPECS','GIT_NOGLOB_PATHSPECS','GIT_ICASE_PATHSPECS'];
const reviewProof=(candidateSha=sha)=>({verdict:'PASS',candidateSha,rootTaskId:rootId,projectId:'project',runId:'qa-run',agentId:'quality',checks:[{id:'unit',status:'passed',candidateSha}],verification:{command:'Native QA qa-run: unit',status:'passed',durationSeconds:1}});
function fixture(t,role='backend-engineer'){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-host-')),identity=fs.lstatSync(dir),marker=path.join(dir,'.fixture-owner'),owner=randomUUID();
 fs.writeFileSync(marker,owner,{flag:'wx',mode:0o600});const markerIdentity=fs.lstatSync(marker);
 t.after(()=>{const current=fs.lstatSync(dir),stored=fs.lstatSync(marker);assert.ok(current.isDirectory()&&!current.isSymbolicLink());assert.equal(fs.realpathSync(dir),dir);
  for(const key of ['dev','ino','uid']){assert.equal(current[key],identity[key]);assert.equal(stored[key],markerIdentity[key]);}
  assert.equal(current.mode&0o777,identity.mode&0o777);assert.equal(stored.mode&0o777,0o600);
  assert.ok(stored.isFile()&&!stored.isSymbolicLink()&&stored.nlink===1);assert.equal(fs.readFileSync(marker,'utf8'),owner);fs.rmSync(dir,{recursive:true});});
 const repository=path.join(dir,'repo'),target=path.join(dir,'paperclip-worktrees',rootId);fs.mkdirSync(repository);
 const projectContext={id:'project',key:'sample',name:'Sample',repository:{hostPath:repository},workspace:{hostPath:target,containerPath:'/workspace/project'},checks:[{id:'unit',label:'Unit',platform:'macos',argv:['/tools/node','--test','tests/unit.mjs']}],delivery:{maximumAction:'pull_request',commands:{pull_request:{argv:['/tools/delivery','--candidate','{candidateSha}','--worktree','{worktree}']}}},hostMcpServers:[],hostActions:[]};
 const permit={runId:'run',taskId:rootId,rootTaskId:rootId,projectId:'project',role,projectContext,effectiveCapabilities:{hostAllowedTools:HOST_TOOL_DEFINITIONS.map(x=>x.name),capabilityIds:[role]},authorizedHostActions:[]};
 const calls=[],events=[];let exists=false,dirty='',head=sha;
 const runner=(binary,args,options)=>{
  calls.push({binary,args,options});let stdout='';
  if(binary==='/usr/bin/git'){
   if(args[0]==='worktree'&&args[1]==='list')stdout=exists?`worktree ${target}\nHEAD ${head}\nbranch refs/heads/codex/${rootId}-paperclip-work\n\n`:'';
   else if(args[0]==='worktree'&&args[1]==='add'){fs.mkdirSync(target,{recursive:true});exists=true;}
   else if(args[0]==='rev-parse'&&args.includes('--git-common-dir'))stdout=repository+'/.git';
   else if(args[0]==='symbolic-ref')stdout=`codex/${rootId}-paperclip-work`;
   else if(args[0]==='rev-parse')stdout=head;
   else if(args[0]==='status')stdout=dirty;
   else if(args[0]==='show-ref')return {status:1,stdout:'',stderr:''};
   else if(args[0]==='diff')stdout='diff --git a/a b/a\n+changed\n';
   else if(args[0]==='commit'){head='b'.repeat(40);stdout='committed';}
  }else stdout='ok';
  return {status:0,stdout,stderr:''};
 };
 const options={permit,runner,log:event=>events.push(event),verifyVolume:async()=>true,platform:'darwin',controlRoot:path.join(dir,'control')};
 return {dir,repository,target,permit,calls,events,options,setDirty:value=>dirty=value,setExists:()=>{exists=true;fs.mkdirSync(target,{recursive:true});},setHead:value=>head=value};
}

async function realGitFixture(t){
 const f=fixture(t),env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
 for(const key of pathspecSelectors)delete env[key];
 const git=(args,cwd=f.repository)=>{const result=spawnSync('/usr/bin/git',args,{cwd,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;};
 git(['init']);git(['config','user.name','Isolated fixture']);git(['config','user.email','fixture@example.invalid']);
 fs.mkdirSync(path.join(f.repository,'docs'));fs.writeFileSync(path.join(f.repository,'README.md'),'root doc\n');fs.writeFileSync(path.join(f.repository,'docs','guide.md'),'nested doc\n');
 fs.writeFileSync(path.join(f.repository,'.gitignore'),'ignored.tmp\n');
 for(const name of ['selected[1].txt','selected1.txt'])fs.writeFileSync(path.join(f.repository,name),'original\n');
 git(['add','--all']);git(['commit','-m','Initial fixture']);f.options.runner=runHostCommand;
 const workspace=await prepareRoleProjectWorkspace(f.options);return {...f,workspace,git};
}

test('registered Node checks keep nested Git glob and check-ignore semantics', {skip:!fs.existsSync('/usr/bin/git')},async t=>{
 const f=await realGitFixture(t),script=`import {spawnSync} from 'node:child_process';
 const files=spawnSync('/usr/bin/git',['ls-files','-z','--','*.md'],{encoding:'utf8'}),ignore=spawnSync('/usr/bin/git',['check-ignore','--','ignored.tmp'],{encoding:'utf8'});
 console.log(JSON.stringify({selectors:Object.fromEntries(${JSON.stringify(pathspecSelectors)}.filter(key=>Object.hasOwn(process.env,key)).map(key=>[key,process.env[key]])),files:files.stdout.split('\\0').filter(Boolean),filesStatus:files.status,ignoreStatus:ignore.status,ignoreOutput:ignore.stdout.trim(),ignoreError:ignore.stderr.trim()}));`;
 f.permit.projectContext.checks=[{id:'nested-git',label:'Real nested Git semantics',platform:'macos',argv:[process.execPath,'--input-type=module','-e',script]}];
 const result=await createHostCapabilityExecutor({...f.options,workspace:f.workspace}).execute('host.project_check',{checkId:'nested-git'}),observed=JSON.parse(result.output);t.diagnostic(JSON.stringify(observed));
 assert.equal(observed.filesStatus,0);assert.deepEqual(observed.files,['README.md','docs/guide.md']);
 assert.equal(observed.ignoreStatus,0);assert.equal(observed.ignoreOutput,'ignored.tmp');assert.equal(observed.ignoreError,'');assert.deepEqual(observed.selectors,{});
});

test('registered Node scripts strip every inherited global Git pathspec selector without changing the parent',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),original=Object.fromEntries(pathspecSelectors.map(key=>[key,process.env[key]]));
 t.after(()=>{for(const key of pathspecSelectors)if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];});
 for(const key of pathspecSelectors)process.env[key]='1';
 const script='console.log(JSON.stringify(Object.fromEntries('+JSON.stringify(pathspecSelectors)+'.filter(key=>Object.hasOwn(process.env,key)).map(key=>[key,process.env[key]]))))';
 f.permit.projectContext.checks=[{id:'environment',label:'Inherited selectors',platform:'macos',argv:[process.execPath,'-e',script]}];
 const fake=f.options.runner,runner=(binary,args,options)=>binary==='/usr/bin/git'?fake(binary,args,options):runHostCommand(binary,args,options);
 const result=await createHostCapabilityExecutor({...f.options,workspace,runner}).execute('host.project_check',{checkId:'environment'});
 assert.deepEqual(JSON.parse(result.output),{});for(const key of pathspecSelectors)assert.equal(process.env[key],'1');
});

test('registered direct Git checks retain project glob semantics rather than Host literal mode', {skip:!fs.existsSync('/usr/bin/git')},async t=>{
 const f=await realGitFixture(t);f.permit.projectContext.checks=[{id:'direct-git',label:'Registered Git glob',platform:'macos',argv:['/usr/bin/git','ls-files','--','*.md']}];
 const result=await createHostCapabilityExecutor({...f.options,workspace:f.workspace}).execute('host.project_check',{checkId:'direct-git'});
 assert.deepEqual(result.output.trim().split('\n'),['README.md','docs/guide.md']);
});

test('explicit Git file operations remain literal for wildcard-shaped user filenames', {skip:!fs.existsSync('/usr/bin/git')},async t=>{
 const f=await realGitFixture(t);fs.writeFileSync(path.join(f.target,'selected[1].txt'),'literal changed\n');fs.writeFileSync(path.join(f.target,'selected1.txt'),'peer changed\n');
 const executor=createHostCapabilityExecutor({...f.options,workspace:f.workspace}),diff=await executor.execute('host.project_git',{operation:'diff',paths:['selected[1].txt']});
 assert.match(diff.output,/literal changed/);assert.doesNotMatch(diff.output,/peer changed/);
 await executor.execute('host.project_git',{operation:'commit',message:'Commit one literal filename',paths:['selected[1].txt']});
 assert.deepEqual(f.git(['diff-tree','--no-commit-id','--name-only','-r','HEAD'],f.target).trim().split('\n'),['selected[1].txt']);
 assert.match(f.git(['diff','--','selected1.txt'],f.target),/peer changed/);
});

test('inspect distinguishes current bootstrap and candidate evidence from historical prepare configuration',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),preparedHead=workspace.candidateSha,currentHead='b'.repeat(40);
 f.setHead(currentHead);f.permit.projectContext.workspace.prepare={argv:['/tools/project-prepare','--task','{rootTaskId}','--worktree','{worktree}','token=fixture-inspect-secret','--api-key','fixture-separated-secret']};
 const folder=path.join(f.repository,'.git','leon-engineering','deliveries'),receiptFile=path.join(folder,rootId+'.json');fs.mkdirSync(folder,{recursive:true});
 const receipt={taskId:rootId,status:'started',createdAt:'2026-11-22T00:00:00.000Z',repositoryRoot:f.repository,featureWorktree:f.target,featureBranch:workspace.branch,baseCommit:sha,featureCommit:null,
  privateToken:'fixture-receipt-secret',arbitraryNativeContext:{taskGoal:'must not expose full permit or context'}};
 const bytes=Buffer.from(JSON.stringify(receipt)+'\n');fs.writeFileSync(receiptFile,bytes);
 const foreign=path.join(folder,'other-root.json');fs.writeFileSync(foreign,'unrelated private state, deliberately not JSON');
 const read=fs.readFileSync,readdir=fs.readdirSync;t.mock.method(fs,'readFileSync',(file,...args)=>{assert.notEqual(file,foreign,'must not read another root receipt');return read(file,...args);});
 t.mock.method(fs,'readdirSync',(file,...args)=>{assert.notEqual(file,folder,'must not enumerate other root receipts');return readdir(file,...args);});
 const result=await createHostCapabilityExecutor({...f.options,workspace:{...workspace,transportExitCode:0}}).execute('host.project_inspect',{}),stat=fs.lstatSync(f.target);
 assert.equal(result.workspace.candidateSha,currentHead);assert.equal(result.workspace.currentCandidateSha,currentHead);
 assert.deepEqual(result.workspace.bootstrap,{kind:'bootstrap-before-model',currentRunId:'run',currentTaskId:rootId,rootTaskId:rootId,projectId:'project',reused:false,verifiedCandidateSha:preparedHead,
  stageMeaning:'Task worktree verification only. Delivery status started is the normal bootstrap stage; integration candidate preparation follows implementation. Later master movement belongs to the project delivery flow. This does not grant write authority or certify checks or business acceptance.'});
 assert.deepEqual(result.workspace.identity,{realpath:fs.realpathSync(f.target),dev:stat.dev,ino:stat.ino,uid:stat.uid});
 const registeredArgv=['/tools/project-prepare','--task',rootId,'--worktree',f.target,'token=fixture-inspect-secret','--api-key','fixture-separated-secret'];
 assert.deepEqual(result.registeredPrepare,{configured:true,executable:'/tools/project-prepare',argvSha256:createHash('sha256').update(JSON.stringify(registeredArgv)).digest('hex'),evidenceType:'CONFIGURATION_ONLY',callableTool:false});
 assert.equal(Object.hasOwn(result.registeredPrepare,'argv'),false);
 const allowed=['taskId','status','createdAt','repositoryRoot','featureWorktree','featureBranch','baseCommit','featureCommit'];
 assert.deepEqual(result.deliveryReceipt,{state:'FOUND',sourcePath:receiptFile,sha256:createHash('sha256').update(bytes).digest('hex'),...Object.fromEntries(allowed.map(key=>[key,receipt[key]]))});
 assert.deepEqual(result.historicalRawPrepareExit,{status:'NOT_RECORDED',exitCode:null});assert.deepEqual(fs.readFileSync(receiptFile),bytes);
 assert.ok(!JSON.stringify(result).includes('fixture-inspect-secret'));assert.ok(!JSON.stringify(result).includes('fixture-separated-secret'));assert.ok(!JSON.stringify(result).includes('fixture-receipt-secret'));assert.ok(!JSON.stringify(result).includes('must not expose'));
 assert.equal(f.calls.some(call=>call.binary==='/tools/project-prepare'),false);
});

test('inspect marks a missing own receipt and unavailable historical raw exit without invoking prepare',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),executor=createHostCapabilityExecutor({...f.options,workspace});
 const result=await executor.execute('host.project_inspect',{});assert.equal(result.deliveryReceipt.state,'NOT_FOUND');
 assert.equal(result.registeredPrepare.configured,false);assert.equal(result.registeredPrepare.evidenceType,'CONFIGURATION_ONLY');assert.equal(result.registeredPrepare.callableTool,false);
 assert.deepEqual(result.historicalRawPrepareExit,{status:'NOT_RECORDED',exitCode:null});
 assert.equal(f.calls.some(call=>call.binary!=='/usr/bin/git'),false);
});

test('prepares one task worktree, preserves a dirty original repository and reuses edited task code',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.repository,'original.txt'),'keep');
 const first=await prepareRoleProjectWorkspace(f.options);assert.equal(first.codeHostPath,f.target);assert.equal(first.branch,`codex/${rootId}-paperclip-work`);
 f.setDirty(' M code.mjs\n');const reused=await prepareRoleProjectWorkspace(f.options);assert.equal(reused.reused,true);
 assert.equal(f.calls.filter(x=>x.args[0]==='worktree'&&x.args[1]==='add').length,1);
 assert.equal(fs.readFileSync(path.join(f.repository,'original.txt'),'utf8'),'keep');
 assert.ok(!f.calls.some(x=>x.args.some(a=>['reset','clean','--force'].includes(a))));
 assert.equal(fs.existsSync(path.join(f.dir,'control','code-workspaces',rootId,'candidate.json')),false);
});

test('workspace preparation refuses an unregistered existing directory or a mismatched volume',async t=>{
 const f=fixture(t);fs.mkdirSync(f.target,{recursive:true});fs.writeFileSync(path.join(f.target,'foreign'),'preserve');
 await assert.rejects(prepareRoleProjectWorkspace(f.options),/ROLE_HOST_WORKSPACE_COLLISION/);
 assert.equal(fs.readFileSync(path.join(f.target,'foreign'),'utf8'),'preserve');
 const g=fixture(t);await assert.rejects(prepareRoleProjectWorkspace({...g.options,verifyVolume:async()=>false}),/ROLE_HOST_VOLUME_IDENTITY_MISMATCH/);
 assert.equal(g.calls.length,0);
});

test('registered managed workspace preparation is used before generic git worktree add',async t=>{
 const f=fixture(t);f.permit.projectContext.workspace.prepare={argv:['/tools/managed','--task','{rootTaskId}','--worktree','{worktree}']};
 const base=f.options.runner;f.options.runner=(binary,args,options)=>{if(binary==='/tools/managed'){f.setExists();f.calls.push({binary,args,options});return {status:0,stdout:'managed',stderr:''};}return base(binary,args,options);};
 await prepareRoleProjectWorkspace(f.options);
 assert.ok(f.calls.some(x=>x.binary==='/tools/managed'&&x.args.includes(rootId)));
 assert.ok(!f.calls.some(x=>x.args[0]==='worktree'&&x.args[1]==='add'));
});

test('registered workspace preparation receives the existing host proxy without proxying local checks or Git probes',async t=>{
 const f=fixture(t),base=f.options.runner,proxy={HTTPS_PROXY:'http://127.0.0.1:19091',NO_PROXY:'localhost,127.0.0.1',NODE_USE_ENV_PROXY:'1'};
 let selections=0;f.options.proxyEnvironment=()=>{selections++;return proxy;};
 f.permit.projectContext.workspace.prepare={argv:['/tools/project-prepare','--task','{rootTaskId}']};
 f.options.runner=(binary,args,options)=>{
  if(binary==='/tools/project-prepare'){f.calls.push({binary,args,options});f.setExists();return {status:0,stdout:'prepared',stderr:''};}
  return base(binary,args,options);
 };
 const originalEnvironment={...process.env},workspace=await prepareRoleProjectWorkspace(f.options);
 const command=f.calls.find(call=>call.binary==='/tools/project-prepare');
 assert.deepEqual(command.args,['--task',rootId]);assert.equal(command.options.env.HTTPS_PROXY,proxy.HTTPS_PROXY);
 assert.equal(command.options.env.NO_PROXY,proxy.NO_PROXY);assert.equal(command.options.env.NODE_USE_ENV_PROXY,'1');assert.equal(selections,1);
 const executor=createHostCapabilityExecutor({...f.options,workspace});
 await executor.execute('host.project_git',{operation:'status'});await executor.execute('host.project_check',{checkId:'unit'});
 assert.equal(selections,1);assert.deepEqual({...process.env},originalEnvironment);
});

test('registered candidate preparation receives the host proxy and preserves the actual RWB result keys',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),integration=f.target+'-integration',base=f.options.runner;
 let selections=0;const proxy={HTTPS_PROXY:'http://127.0.0.1:19092',NO_PROXY:'localhost,127.0.0.1'};
 f.permit.projectContext.delivery.prepareCandidate={argv:['/tools/project-candidate','--task','{rootTaskId}','--candidate','{candidateSha}']};
 const runner=(binary,args,options)=>{
  if(binary==='/tools/project-candidate'){
   f.calls.push({binary,args,options});fs.mkdirSync(integration);
   return {status:0,stdout:JSON.stringify({integrationWorktree:integration,integrationBranch:`codex/integrate-${rootId}`,integrationCommit:sha}),stderr:''};
  }
  if(binary==='/usr/bin/git'&&options.cwd===integration&&args[0]==='symbolic-ref')return {status:0,stdout:`codex/integrate-${rootId}`,stderr:''};
  return base(binary,args,options);
 };
 const result=await createHostCapabilityExecutor({...f.options,workspace,runner,proxyEnvironment:()=>{selections++;return proxy;},projectDelivery:()=>{throw Error('registered candidate must not use the generic manager');}}).execute('host.project_git',{operation:'prepare'});
 const command=f.calls.find(call=>call.binary==='/tools/project-candidate');
 assert.deepEqual(command.args,['--task',rootId,'--candidate',sha]);assert.equal(command.options.env.HTTPS_PROXY,proxy.HTTPS_PROXY);
 assert.equal(command.options.env.NO_PROXY,proxy.NO_PROXY);assert.equal(selections,1);
 assert.equal(result.hostPath,integration);assert.equal(result.candidateSha,sha);
});

test('registered publish and merge use the host proxy only after preview and Native QA gates',async t=>{
 const f=fixture(t,'devops'),workspace=await prepareRoleProjectWorkspace(f.options),proxy={HTTPS_PROXY:'http://127.0.0.1:19093',NO_PROXY:'localhost,127.0.0.1'};
 f.permit.projectContext.delivery.maximumAction='merge';f.permit.projectContext.delivery.commands.merge={argv:['/tools/project-merge','--reviewed-commit','{candidateSha}']};
 let selections=0;const options={...f.options,workspace,proxyEnvironment:()=>{selections++;return proxy;}};
 let executor=createHostCapabilityExecutor(options);
 assert.equal((await executor.execute('host.project_publish',{action:'pull_request',preview:true})).status,'preview');
 await assert.rejects(executor.execute('host.project_publish',{action:'pull_request'}),/ROLE_HOST_REVIEW_REQUIRED/);
 assert.equal(selections,0);assert.ok(!f.calls.some(call=>call.binary==='/tools/delivery'||call.binary==='/tools/project-merge'));
 f.permit.codeReview=reviewProof();executor=createHostCapabilityExecutor(options);
 for(const action of ['pull_request','merge'])assert.equal((await executor.execute('host.project_publish',{action})).exitCode,0);
 const commands=f.calls.filter(call=>call.binary==='/tools/delivery'||call.binary==='/tools/project-merge');
 assert.equal(commands.length,2);assert.equal(selections,2);
 for(const command of commands){assert.equal(command.options.env.HTTPS_PROXY,proxy.HTTPS_PROXY);assert.equal(command.options.env.NO_PROXY,proxy.NO_PROXY);}
});

test('check executes only registered argv in the code workspace and reports failed output safely',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options);let failed=false;
 const base=f.options.runner;const executor=createHostCapabilityExecutor({...f.options,workspace,runner:(...args)=>failed?{status:7,stdout:'Bearer abcdefghijklmnop',stderr:'token=top-secret'}:base(...args)});
 assert.ok(executor.listTools().some(x=>x.name==='host.project_check'));
 const result=await executor.execute('host.project_check',{checkId:'unit'});assert.equal(result.exitCode,0);
 const call=f.calls.find(value=>value.binary==='/tools/node');assert.equal(call.binary,'/tools/node');assert.deepEqual(call.args,['--test','tests/unit.mjs']);assert.equal(call.options.cwd,f.target);assert.equal(call.options.shell,false);
 await assert.rejects(executor.execute('host.project_check',{checkId:'unregistered',argv:['rm']}),/ROLE_HOST_CHECK_NOT_REGISTERED/);
 failed=true;await assert.rejects(executor.execute('host.project_check',{checkId:'unit'}),error=>error.code==='ROLE_HOST_COMMAND_FAILED'&&error.details.exitCode===7&&!JSON.stringify(error.details).includes('top-secret'));
 assert.ok(f.events.some(x=>x.code==='ROLE_HOST_CALL_FAILED'));assert.ok(!JSON.stringify(f.events).includes('top-secret'));
});

test('QA git is readonly and an authorized developer commits only explicit relative paths',async t=>{
 const f=fixture(t,'qa'),workspace=await prepareRoleProjectWorkspace(f.options),qa=createHostCapabilityExecutor({...f.options,workspace});
 const diff=await qa.execute('host.project_git',{operation:'diff'});assert.match(diff.output,/changed/);
 await assert.rejects(qa.execute('host.project_git',{operation:'commit',message:'review rewrite',paths:['a']}),/ROLE_HOST_GIT_WRITE_DENIED/);
 f.permit.role='backend-engineer';const dev=createHostCapabilityExecutor({...f.options,workspace});
 await assert.rejects(dev.execute('host.project_git',{operation:'commit',message:'change',paths:['../outside']}),/ROLE_HOST_GIT_PATH_DENIED/);
 const committed=await dev.execute('host.project_git',{operation:'commit',message:'change',paths:['a']});assert.equal(committed.candidateSha,'b'.repeat(40));
 assert.ok(f.calls.some(x=>x.args[0]==='add'&&x.args[1]==='--'&&x.args[2]==='a'));
 assert.ok(!f.calls.some(x=>x.args.includes('-a')||x.args.includes('--amend')||x.args.includes('--no-verify')));
});

test('host calls expose only effective capability tools and never accept arbitrary command names',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options);f.permit.effectiveCapabilities.hostAllowedTools=['host.project_inspect'];
 const executor=createHostCapabilityExecutor({...f.options,workspace});assert.deepEqual(executor.listTools().map(x=>x.name),['host.project_inspect']);
 await assert.rejects(executor.execute('host.resources_apply',{actionId:'anything'}),/ROLE_HOST_CAPABILITY_DENIED/);
 await assert.rejects(executor.execute('host.shell',{argv:['whoami']}),/ROLE_HOST_TOOL_UNKNOWN/);
});

test('registered host action needs the current root authorization, role and professional capability',async t=>{
 const f=fixture(t,'network-engineer');f.permit.projectContext.hostActions=[{id:'proxy-switch',argv:['/tools/network','apply'],capability:'network-engineer',allowedRoles:['network-engineer']}];
 const executor=createHostCapabilityExecutor(f.options);
 await assert.rejects(executor.execute('host.network_apply',{actionId:'proxy-switch'}),/ROLE_HOST_ACTION_DENIED/);
 f.permit.authorizedHostActions=['proxy-switch'];const allowed=createHostCapabilityExecutor(f.options);
 const result=await allowed.execute('host.network_apply',{actionId:'proxy-switch'});assert.equal(result.exitCode,0);
 f.permit.effectiveCapabilities.capabilityIds=[];await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.network_apply',{actionId:'proxy-switch'}),/ROLE_HOST_ACTION_DENIED/);
 f.permit.effectiveCapabilities.capabilityIds=['network-engineer'];f.permit.projectContext.hostActions[0].argv=['/usr/sbin/diskutil','eraseDisk','APFS','x','disk3'];
 await assert.rejects(createHostCapabilityExecutor(f.options).execute('host.network_apply',{actionId:'proxy-switch'}),/ROLE_HOST_ACTION_PROHIBITED/);
});

test('publish previews registered delivery but requires the Native QA candidate before mutation',async t=>{
 const f=fixture(t,'devops'),workspace=await prepareRoleProjectWorkspace(f.options);let executor=createHostCapabilityExecutor({...f.options,workspace});
 const preview=await executor.execute('host.project_publish',{action:'pull_request',preview:true});assert.equal(preview.status,'preview');assert.equal(preview.candidateSha,sha);
 await assert.rejects(executor.execute('host.project_publish',{action:'pull_request',codeReview:{verdict:'PASS'}}),/ROLE_HOST_REVIEW_REQUIRED/);
 f.permit.codeReview=reviewProof();executor=createHostCapabilityExecutor({...f.options,workspace});
 assert.equal((await executor.execute('host.project_publish',{action:'pull_request'})).exitCode,0);
 await assert.rejects(executor.execute('host.project_publish',{action:'merge'}),/ROLE_HOST_DELIVERY_ACTION_DENIED/);
 f.setHead('c'.repeat(40));await assert.rejects(executor.execute('host.project_publish',{action:'pull_request'}),/ROLE_HOST_REVIEW_REQUIRED/);
});

test('RWB uses the registered project merge entrypoint with the same exact Native QA requirements',async t=>{
 const f=fixture(t,'devops'),workspace=await prepareRoleProjectWorkspace(f.options);
 f.permit.projectContext.key='research-workbench';f.permit.projectContext.repository.fullName='Leon/ResearchWorkbench';
 f.permit.projectContext.delivery.maximumAction='merge';
 f.permit.projectContext.delivery.commands.merge={argv:['/tools/rwb-git-safety','--reviewed-commit','{candidateSha}']};
 let executor=createHostCapabilityExecutor({...f.options,workspace});
 assert.equal((await executor.execute('host.project_publish',{action:'merge',preview:true})).status,'preview');
 await assert.rejects(executor.execute('host.project_publish',{action:'merge'}),/ROLE_HOST_REVIEW_REQUIRED/);
 f.permit.codeReview=reviewProof();executor=createHostCapabilityExecutor({...f.options,workspace});
 assert.equal((await executor.execute('host.project_publish',{action:'merge'})).exitCode,0);
 assert.ok(f.calls.some(call=>call.binary==='/tools/rwb-git-safety'&&call.args.includes(sha)));
 await assert.rejects(executor.execute('host.project_publish',{action:'deploy',preview:true}),/ROLE_HOST_DELIVERY_ACTION_DENIED/);
 f.permit.role='qa';await assert.rejects(createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_publish',{action:'merge'}),/ROLE_HOST_DELIVERY_ACTION_DENIED/);
 f.permit.role='devops';f.permit.projectContext.delivery.maximumAction='pull_request';
 await assert.rejects(createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_publish',{action:'merge',preview:true}),/ROLE_HOST_DELIVERY_ACTION_DENIED/);
 f.permit.projectContext.delivery.maximumAction='merge';delete f.permit.projectContext.delivery.commands.merge;
 await assert.rejects(createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_publish',{action:'merge',preview:true}),/ROLE_HOST_DELIVERY_UNAVAILABLE/);
});

test('missing registered publish entrypoint stays explicitly unavailable',async t=>{
 const f=fixture(t,'devops'),workspace=await prepareRoleProjectWorkspace(f.options);delete f.permit.projectContext.delivery.commands;
 await assert.rejects(createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_publish',{action:'pull_request',preview:true}),/ROLE_HOST_DELIVERY_UNAVAILABLE/);
});

test('registered delivery argv receives the actual Native QA verification and no model-supplied proof',async t=>{
 const f=fixture(t,'devops'),workspace=await prepareRoleProjectWorkspace(f.options);
 f.permit.projectContext.delivery.commands.pull_request={argv:['/tools/rwb-git-safety','--verification-command','{verificationCommand}','--verification-duration-seconds','{verificationDurationSeconds}']};
 let executor=createHostCapabilityExecutor({...f.options,workspace});
 const preview=await executor.execute('host.project_publish',{action:'pull_request',preview:true});
 assert.equal(preview.status,'preview');assert.match(preview.argv,/verificationCommand/);
 assert.ok(!f.calls.some(call=>call.binary==='/tools/rwb-git-safety'));
 await assert.rejects(executor.execute('host.project_publish',{action:'pull_request',verificationCommand:'fabricated'}),/ROLE_HOST_REVIEW_REQUIRED/);
 f.permit.codeReview=reviewProof();executor=createHostCapabilityExecutor({...f.options,workspace});
 assert.equal((await executor.execute('host.project_publish',{action:'pull_request'})).exitCode,0);
 const call=f.calls.find(value=>value.binary==='/tools/rwb-git-safety');
 assert.deepEqual(call.args,['--verification-command','Native QA qa-run: unit','--verification-duration-seconds','1']);
});

test('macOS observation uses host probes and returns unavailable components explicitly',async t=>{
 const f=fixture(t,'network-engineer');f.options.runner=(binary,args)=>{
  if(binary==='/usr/sbin/scutil'&&args[0]==='--dns')return {status:0,stdout:'nameserver[0] : 1.1.1.1',stderr:''};
  if(binary==='/usr/sbin/scutil')return {status:0,stdout:'HTTPEnable : 1\nHTTPPort : 8080\nHTTPProxy : password=private',stderr:''};
  return {status:127,stdout:'',stderr:'not available'};
 };
 const executor=createHostCapabilityExecutor({...f.options,exists:()=>false});const result=await executor.execute('host.network_observe',{});
 assert.equal(result.hostPlatform,'darwin');assert.equal(result.dns.status,'observed');assert.equal(result.tailscale.status,'NOT_RUN');assert.ok(!JSON.stringify(result).includes('private'));
 f.permit.effectiveCapabilities.hostAllowedTools=['host.resources_observe'];const resources=await createHostCapabilityExecutor({...f.options,volumePaths:[f.dir]}).execute('host.resources_observe',{});
 assert.ok(resources.memory.totalBytes>0);assert.ok(resources.cpu.count>0);assert.ok(resources.volumes[0].freeBytes>0);
});

test('Docker checks use the already running actor container with explicit context',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options);f.permit.projectContext.checks=[{id:'container',label:'Tests',platform:'docker',argv:['node','--test']}];
 const executor=createHostCapabilityExecutor({...f.options,workspace,dockerContainerName:'sa-role-run'});await executor.execute('host.project_check',{checkId:'container'});
 assert.deepEqual(f.calls.find(call=>call.binary==='/usr/local/bin/docker').args,['--context','desktop-linux','exec','-w','/workspace/project','sa-role-run','node','--test']);
});

test('a cancelled actor stops an asynchronous registered check without blocking host timers',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),controller=new AbortController();
 f.permit.projectContext.checks=[{id:'slow',label:'Long check',platform:'macos',argv:[process.execPath,'-e','setTimeout(()=>{},5000)']}];
 // Workspace probes are the injected Git port; the actual slow check uses the default async subprocess port.
 const {runHostCommand}=await import('../bridge/role-host-mcp.mjs');const fake=f.options.runner;
 const executor=createHostCapabilityExecutor({...f.options,workspace,signal:controller.signal,runner:(binary,args,options)=>binary==='/usr/bin/git'?fake(binary,args,options):runHostCommand(binary,args,options)});
 const pending=executor.execute('host.project_check',{checkId:'slow'});setTimeout(()=>controller.abort(),40);
 await assert.rejects(pending,/ROLE_HOST_CANCELLED/);
});

test('missing host dependencies and timed out checks keep distinct errors',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options);let mode='missing';
 const base=f.options.runner;const executor=createHostCapabilityExecutor({...f.options,workspace,runner:(binary,args,options)=>binary==='/usr/bin/git'?base(binary,args,options):{status:null,error:{code:mode==='missing'?'ENOENT':'ETIMEDOUT'},stdout:'',stderr:''}});
 await assert.rejects(executor.execute('host.project_check',{checkId:'unit'}),/ROLE_HOST_COMMAND_UNAVAILABLE/);
 mode='timeout';await assert.rejects(executor.execute('host.project_check',{checkId:'unit'}),/ROLE_HOST_COMMAND_TIMEOUT/);
});

test('a registered worktree with a foreign Git branch is preserved and refused',async t=>{
 const f=fixture(t);f.setExists();const base=f.options.runner;
 await assert.rejects(prepareRoleProjectWorkspace({...f.options,runner:(binary,args,options)=>args[0]==='worktree'&&args[1]==='list'?{status:0,stdout:`worktree ${f.target}\nHEAD ${sha}\nbranch refs/heads/foreign\n\n`,stderr:''}:base(binary,args,options)}),/ROLE_HOST_WORKSPACE_COLLISION/);
 assert.ok(fs.existsSync(f.target));
});

test('QA preparation keeps the developer candidate source and refuses uncommitted reviewed code',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options);await createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_git',{operation:'commit',paths:['a'],message:'Implement'});
 const filename=path.join(f.dir,'control','code-workspaces',rootId,'candidate.json'),before=fs.readFileSync(filename,'utf8');
 f.permit.role='qa';f.permit.runId='qa-run';await prepareRoleProjectWorkspace(f.options);assert.equal(fs.readFileSync(filename,'utf8'),before);
 f.permit.codeCandidate={candidateSha:'c'.repeat(40)};await assert.rejects(prepareRoleProjectWorkspace(f.options),/ROLE_HOST_REVIEW_CANDIDATE_CHANGED/);delete f.permit.codeCandidate;
 f.setDirty(' M code.mjs\n');await assert.rejects(prepareRoleProjectWorkspace(f.options),/ROLE_HOST_REVIEW_WORKTREE_DIRTY/);
});

test('tool directory hides missing code, delivery and selected MCP contexts',async t=>{
 const f=fixture(t);let executor=createHostCapabilityExecutor(f.options),names=executor.listTools().map(value=>value.name);
 assert.ok(names.includes('host.project_inspect'));assert.ok(!names.includes('host.project_git'));assert.ok(!names.includes('host.project_check'));assert.ok(!names.includes('host.project_publish'));assert.ok(!names.includes('host.mcp_call'));
 const inspected=await executor.execute('host.project_inspect',{});assert.equal(inspected.workspace.status,'NOT_CONFIGURED');
 const workspace=await prepareRoleProjectWorkspace(f.options);delete f.permit.projectContext.delivery.commands;
 f.permit.projectContext.hostMcpServers=[{id:'excel_relay_dev',tools:['read_cell']}];executor=createHostCapabilityExecutor({...f.options,workspace});names=executor.listTools().map(value=>value.name);
 assert.ok(names.includes('host.project_git'));assert.ok(names.includes('host.project_check'));assert.ok(!names.includes('host.project_publish'));assert.ok(names.includes('host.mcp_call'));
});

test('explicit host action authority cannot override a current readonly network or resource scope',async t=>{
 for(const [role,tool,scopeKey] of [['network-engineer','host.network_apply','networkScope'],['system-resource-engineer','host.resources_apply','resourceScope']]){
  const f=fixture(t,role);f.permit.projectContext.hostActions=[{id:'apply-action',argv:['/tools/registered','apply'],capability:role,allowedRoles:[role]}];f.permit.authorizedHostActions=['apply-action'];
  f.permit[scopeKey]={topics:['host'],actions:['observe','diagnose','report']};
  await assert.rejects(createHostCapabilityExecutor(f.options).execute(tool,{actionId:'apply-action'}),/ROLE_HOST_ACTION_SCOPE_DENIED/);assert.equal(f.calls.length,0);
  f.permit[scopeKey].actions=['apply'];assert.equal((await createHostCapabilityExecutor(f.options).execute(tool,{actionId:'apply-action'})).exitCode,0);
  delete f.permit[scopeKey];assert.equal((await createHostCapabilityExecutor(f.options).execute(tool,{actionId:'apply-action'})).exitCode,0);
 }
});
test('developer prepare records the integration path and QA and publisher preserve the source binding',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),integration=f.target+'-integration',candidate='d'.repeat(40);
 f.permit.agentId='developer';
 const base=f.options.runner,runner=(binary,args,options)=>{
  if(binary==='/usr/bin/git'&&args[0]==='worktree'&&args[1]==='list'&&fs.existsSync(integration))return {status:0,stdout:`worktree ${f.target}\nHEAD ${sha}\nbranch refs/heads/codex/${rootId}-paperclip-work\n\nworktree ${integration}\nHEAD ${candidate}\nbranch refs/heads/codex/integrate-${rootId}\n\n`,stderr:''};
  if(binary==='/usr/bin/git'&&options.cwd===integration){
   if(args[0]==='symbolic-ref')return {status:0,stdout:`codex/integrate-${rootId}`,stderr:''};
   if(args[0]==='rev-parse'&&!args.includes('--git-common-dir'))return {status:0,stdout:candidate,stderr:''};
  }
  return base(binary,args,options);
 };
 const projectDelivery=async({action})=>{assert.equal(action,'candidate');fs.mkdirSync(integration);return {codeHostPath:integration,branch:`codex/integrate-${rootId}`,candidateSha:candidate};};
 const prepared=await createHostCapabilityExecutor({...f.options,runner,workspace,projectDelivery}).execute('host.project_git',{operation:'prepare'});
 assert.equal(prepared.hostPath,integration);
 const filename=path.join(f.dir,'control','code-workspaces',rootId,'candidate.json'),source=fs.readFileSync(filename,'utf8');
 f.permit.role='qa';f.permit.runId='qa-run';f.permit.codeCandidate=JSON.parse(source);
 const qa=await prepareRoleProjectWorkspace({...f.options,runner});assert.equal(qa.codeHostPath,integration);assert.equal(fs.readFileSync(filename,'utf8'),source);
 f.permit.role='devops';f.permit.runId='publish-run';f.permit.codeReview={verdict:'PASS',candidateSha:candidate,rootTaskId:rootId,projectId:'project'};
 const publisher=await prepareRoleProjectWorkspace({...f.options,runner});assert.equal(publisher.codeHostPath,integration);assert.equal(fs.readFileSync(filename,'utf8'),source);
});
test('actual registered checks record compact proof bound to the current Native run',async t=>{
 const f=fixture(t,'qa');f.permit.agentId='quality';const workspace=await prepareRoleProjectWorkspace(f.options),executor=createHostCapabilityExecutor({...f.options,workspace});
 await executor.execute('host.project_check',{checkId:'unit'});
 const record=JSON.parse(fs.readFileSync(path.join(f.dir,'control','code-workspaces',rootId,'checks','run.json'),'utf8'));
 assert.equal(record.candidateSha,sha);assert.equal(record.agentId,'quality');assert.deepEqual(record.checks.map(check=>[check.checkId,check.status]),[['unit','passed']]);
 assert.ok(!JSON.stringify(record).includes('stdout'));assert.ok(!JSON.stringify(record).includes('output'));
});
test('artifact-only project does not start managed delivery or expose publishing',async t=>{
 const f=fixture(t);f.permit.projectContext.delivery={adapter:'managed-project',maximumAction:'artifact'};let started=false;
 const workspace=await prepareRoleProjectWorkspace({...f.options,projectDelivery:async()=>{started=true;throw Error('must not start delivery');}});
 assert.equal(started,false);assert.ok(!createHostCapabilityExecutor({...f.options,workspace}).listTools().some(tool=>tool.name==='host.project_publish'));
});
test('opening a workspace preserves the developer candidate source and publishing requires real check proof',async t=>{
 const f=fixture(t);f.permit.agentId='developer';const workspace=await prepareRoleProjectWorkspace(f.options);await createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_git',{operation:'commit',paths:['a'],message:'Implement'});const filename=path.join(f.dir,'control','code-workspaces',rootId,'candidate.json'),before=fs.readFileSync(filename,'utf8');
 f.permit.role='pm';f.permit.runId='pm-run';f.permit.agentId='pm';await prepareRoleProjectWorkspace(f.options);assert.equal(fs.readFileSync(filename,'utf8'),before);
 f.permit.role='devops';f.permit.codeReview={...reviewProof(),checks:[]};
 await assert.rejects(createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_publish',{action:'pull_request'}),/REVIEW_REQUIRED/);
});
test('a PR engineering QA run cannot review the unprepared feature worktree',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options);await createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_git',{operation:'commit',paths:['a'],message:'Implement'});f.permit.role='qa';f.permit.codeCandidate=JSON.parse(fs.readFileSync(path.join(f.dir,'control','code-workspaces',rootId,'candidate.json'),'utf8'));
 await assert.rejects(prepareRoleProjectWorkspace(f.options),/REVIEW_INTEGRATION_REQUIRED/);
 f.permit.projectContext.delivery.maximumAction='artifact';assert.equal((await prepareRoleProjectWorkspace(f.options)).codeHostPath,f.target);
});
test('an existing project runtime prepares through its own supported worktree-root CLI option',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),integration=f.target+'-integration';fs.mkdirSync(path.join(f.repository,'scripts'));fs.writeFileSync(path.join(f.repository,'scripts','project-runtime.mjs'),'// fixture');
 const base=f.options.runner;let prepared=false;
 const runner=(binary,args,options)=>{
  if(binary===process.execPath&&args[0].endsWith('/scripts/project-runtime.mjs')){assert.ok(args.includes('--worktree-root'));assert.ok(!args.includes('--integration-worktree-root'));prepared=true;fs.mkdirSync(integration);return {status:0,stdout:JSON.stringify({integrationWorktree:integration,integrationBranch:`codex/integrate-${rootId}`,integrationCommit:sha}),stderr:''};}
  if(binary==='/usr/bin/git'&&options.cwd===integration&&args[0]==='symbolic-ref')return {status:0,stdout:`codex/integrate-${rootId}`,stderr:''};
  return base(binary,args,options);
 };
 await createHostCapabilityExecutor({...f.options,workspace,runner,projectDelivery:()=>{throw Error('must use project runtime');}}).execute('host.project_git',{operation:'prepare'});assert.equal(prepared,true);
});
test('opening a read-only task workspace creates no developer candidate',async t=>{
 const f=fixture(t,'chief');f.permit.projectContext.delivery.maximumAction='artifact';await prepareRoleProjectWorkspace(f.options);
 assert.equal(fs.existsSync(path.join(f.dir,'control','code-workspaces',rootId,'candidate.json')),false);
});
test('generic managed preparation uses a cancellable subprocess rather than blocking host timers',async t=>{
 const f=fixture(t),controller=new AbortController();f.permit.projectContext.delivery={adapter:'managed-project',maximumAction:'pull_request'};
 const {runHostCommand}=await import('../bridge/role-host-mcp.mjs'),base=f.options.runner;let managementInput;
 const pending=prepareRoleProjectWorkspace({...f.options,signal:controller.signal,runner:(binary,args,options)=>{
  if(binary===process.execPath){managementInput=JSON.parse(options.input);return runHostCommand(process.execPath,['-e','setTimeout(()=>{},5000)'],options);}return base(binary,args,options);
 }});setTimeout(()=>controller.abort(),40);
 await assert.rejects(pending,/ROLE_HOST_CANCELLED/);assert.equal(managementInput.action,'workspace');assert.equal(managementInput.rootTaskId,rootId);
});
test('project runtime replacement follows its prepared receipt contract after a new feature commit',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options),integration=f.target+'-integration-r1';f.setHead('b'.repeat(40));
 fs.mkdirSync(path.join(f.repository,'scripts'));fs.writeFileSync(path.join(f.repository,'scripts','project-runtime.mjs'),'// fixture');
 const receiptFolder=path.join(f.repository,'.git','leon-engineering','deliveries');fs.mkdirSync(receiptFolder,{recursive:true});fs.writeFileSync(path.join(receiptFolder,rootId+'.json'),JSON.stringify({taskId:rootId,repositoryRoot:f.repository,status:'prepared',featureWorktree:f.target,featureBranch:`codex/${rootId}-paperclip-work`,featureCommit:sha}));
 const base=f.options.runner;let replaced=false;
 const runner=(binary,args,options)=>{
  if(binary===process.execPath){assert.ok(args.includes('--replace-prepared'));replaced=true;fs.mkdirSync(integration);return {status:0,stdout:JSON.stringify({integrationWorktree:integration,integrationBranch:`codex/integrate-${rootId}-r1`,integrationCommit:'b'.repeat(40)}),stderr:''};}
  if(binary==='/usr/bin/git'&&options.cwd===integration&&args[0]==='symbolic-ref')return {status:0,stdout:`codex/integrate-${rootId}-r1`,stderr:''};return base(binary,args,options);
 };
 await createHostCapabilityExecutor({...f.options,workspace,runner}).execute('host.project_git',{operation:'prepare'});assert.equal(replaced,true);
});

test('native actor runs Docker checks on demand only with a pinned project image',async t=>{
 const f=fixture(t),workspace=await prepareRoleProjectWorkspace(f.options);f.permit.projectContext.checks=[{id:'container',label:'Tests',platform:'docker',image:'sha256:'+'a'.repeat(64),argv:['node','--test']}];
 f.permit.executionPolicy={executor:'macos_native',sandbox:'none',approvalPolicy:'never',docker:'on_demand'};
 const executor=createHostCapabilityExecutor({...f.options,workspace});
 await executor.execute('host.project_check',{checkId:'container'});
 const command=f.calls.find(call=>call.args.includes('run'));
 assert.ok(command.args.includes('--pull'));assert.ok(command.args.includes('never'));assert.ok(command.args.includes('sha256:'+'a'.repeat(64)));
 delete f.permit.projectContext.checks[0].image;
 await assert.rejects(createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_check',{checkId:'container'}),/DOCKER_IMAGE_REQUIRED/);
});
