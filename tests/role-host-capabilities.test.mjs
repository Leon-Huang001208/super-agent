import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HOST_TOOL_DEFINITIONS,prepareRoleProjectWorkspace,createHostCapabilityExecutor} from '../bridge/role-host-capabilities.mjs';

const sha='a'.repeat(40), rootId='11111111-1111-4111-8111-111111111111';
const reviewProof=(candidateSha=sha)=>({verdict:'PASS',candidateSha,rootTaskId:rootId,projectId:'project',runId:'qa-run',agentId:'quality',checks:[{id:'unit',status:'passed',candidateSha}],verification:{command:'Native QA qa-run: unit',status:'passed',durationSeconds:1}});
function fixture(t,role='backend-engineer'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'role-host-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
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

test('RWB delivery never merges even when project metadata asks for a broader ceiling',async t=>{
 const f=fixture(t,'devops'),workspace=await prepareRoleProjectWorkspace(f.options);f.permit.projectContext.key='research-workbench';f.permit.projectContext.repository.fullName='Leon/ResearchWorkbench';f.permit.projectContext.delivery.maximumAction='deploy';
 const executor=createHostCapabilityExecutor({...f.options,workspace});await assert.rejects(executor.execute('host.project_publish',{action:'merge',preview:true}),/ROLE_HOST_DELIVERY_ACTION_DENIED/);
});

test('missing registered publish entrypoint stays explicitly unavailable',async t=>{
 const f=fixture(t,'devops'),workspace=await prepareRoleProjectWorkspace(f.options);delete f.permit.projectContext.delivery.commands;
 await assert.rejects(createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_publish',{action:'pull_request',preview:true}),/ROLE_HOST_DELIVERY_UNAVAILABLE/);
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
