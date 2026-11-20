import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runRoleProjectDelivery} from '../../scripts/role-project-delivery.mjs';
import {prepareRoleProjectWorkspace,createHostCapabilityExecutor,HOST_TOOL_DEFINITIONS} from '../../bridge/role-host-capabilities.mjs';
import {validateTeamCheckEvidence} from '../../bridge/team-plan.mjs';
import {runHostCommand} from '../../bridge/role-host-mcp.mjs';
import {readDeliveryReceipt} from '../../scripts/vendor/leon-engineering/iteration-delivery.mjs';

const rootId='11111111-1111-4111-8111-111111111111';
function git(cwd,...args){const result=spawnSync('/usr/bin/git',args,{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
function fixture(t){
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'sa-role-project-git-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const repository=path.join(directory,'repo'),remote=path.join(directory,'remote.git'),worktreeRoot=path.join(directory,'worktrees'),controlRoot=path.join(directory,'control');
 fs.mkdirSync(repository);fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');git(repository,'init','--initial-branch=main');
 git(repository,'config','user.name','Role management fixture');git(repository,'config','user.email','role@example.invalid');
 fs.writeFileSync(path.join(repository,'README.md'),'baseline\n');fs.writeFileSync(path.join(repository,'.gitignore'),'logs/\n');git(repository,'add','.');git(repository,'commit','-m','baseline');
 git(repository,'remote','add','origin',remote);git(repository,'push','-u','origin','main');git(repository,'remote','set-head','origin','main');
 const projectContext={id:'p',key:'fixture',name:'Fixture',repository:{hostPath:repository,fullName:'owner/fixture'},workspace:{hostPath:path.join(worktreeRoot,rootId),containerPath:'/workspace/project'},checks:[{id:'fixture-readback',label:'Read fixture',platform:'macos',argv:[process.execPath,'-e',"const fs=require('fs');if(fs.readFileSync('feature.txt','utf8')!=='feature\\n')process.exit(1)"]}],delivery:{adapter:'managed-project',maximumAction:'pull_request'}};
 const permit={companyId:'c',projectId:'p',rootTaskId:rootId,taskId:'code-task',runId:'code-run',agentId:'code-agent',role:'backend-engineer',projectContext,effectiveCapabilities:{hostAllowedTools:HOST_TOOL_DEFINITIONS.map(tool=>tool.name)}};
 const events=[],githubCalls=[],tools=path.join(directory,'tools'),callsFile=path.join(directory,'github-calls.jsonl'),prFile=path.join(directory,'github-pr.json');let pr;fs.mkdirSync(tools);
 fs.writeFileSync(path.join(tools,'gh'),`#!${process.execPath}
const fs=require('node:fs'),{spawnSync}=require('node:child_process'),args=process.argv.slice(2),callsFile=${JSON.stringify(callsFile)},prFile=${JSON.stringify(prFile)},repository=${JSON.stringify(repository)};
fs.appendFileSync(callsFile,JSON.stringify(args)+'\\n');
if(args[0]==='api'){
 const pr=fs.existsSync(prFile)?JSON.parse(fs.readFileSync(prFile,'utf8')):null;
 console.log(JSON.stringify(args[1].includes('?')?(pr?[pr]:[]):pr));
}else if(args[0]==='pr'&&args[1]==='create'){
 const branch=args[args.indexOf('--head')+1],result=spawnSync('/usr/bin/git',['-C',repository,'rev-parse',branch],{encoding:'utf8'});if(result.status!==0)process.exit(1);
 const pr={number:9,html_url:'https://github.com/owner/fixture/pull/9',state:'open',draft:false,head:{ref:branch,sha:result.stdout.trim(),repo:{full_name:'owner/fixture'}},base:{ref:'main',repo:{full_name:'owner/fixture'}}};
 fs.writeFileSync(prFile,JSON.stringify(pr));console.log(pr.html_url);
}else{console.error('fake gh refused unregistered action');process.exit(1);}
`,{mode:0o700});
 const githubRunner=(binary,args)=>{
  assert.equal(binary,'gh');githubCalls.push(args);
  if(args[0]==='api')return {status:0,stdout:JSON.stringify(args[1].includes('?')?(pr?[pr]:[]):pr),stderr:''};
  if(args[0]==='pr'&&args[1]==='create'){
   const head=args[args.indexOf('--head')+1];pr={number:9,html_url:'https://github.com/owner/fixture/pull/9',state:'open',draft:false,head:{ref:head,sha:git(repository,'rev-parse',head),repo:{full_name:'owner/fixture'}},base:{ref:'main',repo:{full_name:'owner/fixture'}}};
   return {status:0,stdout:pr.html_url+'\n',stderr:''};
  }
  throw Error('unexpected GitHub action');
 };
 const options={permit,controlRoot,log:event=>events.push(event),verifyVolume:async()=>true,runner:(binary,args,options)=>runHostCommand(binary,args,{...options,env:{...options.env,PATH:tools+path.delimiter+options.env.PATH}})};
 const direct=action=>runRoleProjectDelivery({action,projectRoot:repository,rootTaskId:rootId,worktreeRoot,permit},{githubRunner,log:event=>events.push(event)});
 return {directory,repository,remote,worktreeRoot,controlRoot,permit,options,events,get githubCalls(){return [...githubCalls,...(fs.existsSync(callsFile)?fs.readFileSync(callsFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[])];},direct};
}
async function implement(f){
 const workspace=await prepareRoleProjectWorkspace(f.options),executor=createHostCapabilityExecutor({...f.options,workspace});
 fs.writeFileSync(path.join(workspace.codeHostPath,'feature.txt'),'feature\n');
 await executor.execute('host.project_git',{operation:'commit',paths:['feature.txt'],message:'Implement fixture'});
 const prepared=await executor.execute('host.project_git',{operation:'prepare'});
 await assert.rejects(executor.execute('host.project_git',{operation:'commit',paths:['feature.txt'],message:'too late'}),/REPORT_ONLY/);
 return prepared;
}
async function review(f){
 const candidate=JSON.parse(fs.readFileSync(path.join(f.controlRoot,'code-workspaces',rootId,'candidate.json'),'utf8'));
 Object.assign(f.permit,{role:'qa',runId:'qa-run',taskId:'qa-task',agentId:'qa-agent',codeCandidate:candidate});
 const workspace=await prepareRoleProjectWorkspace(f.options);assert.equal(workspace.codeHostPath,candidate.hostPath);
 await createHostCapabilityExecutor({...f.options,workspace}).execute('host.project_check',{checkId:'fixture-readback'});
 const proof=JSON.parse(fs.readFileSync(path.join(f.controlRoot,'code-workspaces',rootId,'checks','qa-run.json'),'utf8'));
 f.permit.codeReview={verdict:'PASS',rootTaskId:rootId,projectId:'p',candidateSha:candidate.candidateSha,runId:'qa-run',agentId:'qa-agent',...validateTeamCheckEvidence(proof,{permit:f.permit,candidateSha:candidate.candidateSha})};
 delete f.permit.codeCandidate;Object.assign(f.permit,{role:'devops',runId:'publish-run',taskId:'publish-task',agentId:'publish-agent'});
 return candidate;
}
test('real Git routes workspace, explicit commit, integration QA and one PR without changing default',async t=>{
 const f=fixture(t),before=git(f.remote,'rev-parse','main');fs.writeFileSync(path.join(f.repository,'owner-untracked'),'keep');
 const prepared=await implement(f);assert.equal(prepared.hostPath,path.join(f.worktreeRoot,rootId+'-integration'));
 assert.notEqual(prepared.candidateSha,git(path.join(f.worktreeRoot,rootId),'rev-parse','HEAD'));
 const candidate=await review(f),source=fs.readFileSync(path.join(f.controlRoot,'code-workspaces',rootId,'candidate.json'),'utf8');
 const workspace=await prepareRoleProjectWorkspace(f.options);assert.equal(workspace.codeHostPath,candidate.hostPath);
 const executor=createHostCapabilityExecutor({...f.options,workspace}),result=await executor.execute('host.project_publish',{action:'pull_request'});assert.equal(result.pullRequest.number,9);
 await executor.execute('host.project_publish',{action:'pull_request'});
 assert.equal(f.githubCalls.filter(args=>args[0]==='pr'&&args[1]==='create').length,1);assert.ok(!f.githubCalls.some(args=>args[0]==='pr'&&args[1]==='merge'));
 assert.equal(git(f.remote,'rev-parse','main'),before);assert.equal(git(f.remote,'rev-parse',candidate.branch),candidate.candidateSha);
 assert.equal(fs.readFileSync(path.join(f.repository,'owner-untracked'),'utf8'),'keep');assert.equal(fs.readFileSync(path.join(f.controlRoot,'code-workspaces',rootId,'candidate.json'),'utf8'),source);
 assert.equal(readDeliveryReceipt({projectRoot:f.repository,taskId:rootId}).status,'awaiting_ci');
});
test('real manager replaces changed feature candidates and preserves an existing operation lock',async t=>{
 const f=fixture(t);await implement(f);const feature=path.join(f.worktreeRoot,rootId);
 fs.writeFileSync(path.join(feature,'second.txt'),'second\n');git(feature,'add','second.txt');git(feature,'commit','-m','Second feature');
 const next=await f.direct('candidate');assert.equal(next.codeHostPath,path.join(f.worktreeRoot,rootId+'-integration-r1'));
 const lock=path.join(f.repository,'.git','leon-engineering','locks','integration.lock');fs.writeFileSync(lock,'fixture-owned\n');
 await assert.rejects(f.direct('workspace'),/DELIVERY_LOCKED/);assert.equal(fs.readFileSync(lock,'utf8'),'fixture-owned\n');fs.unlinkSync(lock);
});
test('remote movement is recorded by the manager and reprepare retains its integration history',async t=>{
 const f=fixture(t);await implement(f);await review(f);
 fs.writeFileSync(path.join(f.repository,'other.txt'),'other task\n');git(f.repository,'add','other.txt');git(f.repository,'commit','-m','Advance default');git(f.repository,'push','origin','main');
 await assert.rejects(f.direct('pull_request'),/remote default branch moved/);
 assert.equal(readDeliveryReceipt({projectRoot:f.repository,taskId:rootId}).status,'remote_moved');assert.equal(f.githubCalls.length,0);
 const next=await f.direct('candidate');assert.equal(next.codeHostPath,path.join(f.worktreeRoot,rootId+'-integration-r1'));
 assert.equal(fs.readFileSync(path.join(next.codeHostPath,'other.txt'),'utf8'),'other task\n');assert.equal(readDeliveryReceipt({projectRoot:f.repository,taskId:rootId}).integrationHistory.length,1);
});
