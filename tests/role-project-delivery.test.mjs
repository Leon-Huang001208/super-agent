import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root='11111111-1111-4111-8111-111111111111',sha='a'.repeat(40),feature='b'.repeat(40);
const entry=new URL('../scripts/role-project-delivery.mjs',import.meta.url);
async function adapter(){assert.equal(fs.existsSync(entry),true,'generic managed project adapter must exist');return import(entry);}
function fixture(){
 const projectRoot='/fixture/repo',worktreeRoot='/fixture/worktrees',featureWorktree=worktreeRoot+'/'+root;
 let receipt=null;const calls=[],events=[];
 const inspect=target=>({repositoryRoot:target,commonRoot:projectRoot+'/.git',branch:target===featureWorktree?`codex/${root}-paperclip-work`:`codex/integrate-${root}`,head:target===featureWorktree?feature:sha,dirty:false});
 const manager={
  readDeliveryReceipt(){if(!receipt)throw Error('missing delivery receipt: '+root);return receipt;},
  startDelivery(options){calls.push(['start',options]);receipt={taskId:root,repositoryRoot:projectRoot,featureWorktree,featureBranch:`codex/${root}-paperclip-work`,featureCommit:feature,remote:'origin',defaultBranch:'main',status:'started'};return receipt;},
  prepareDelivery(options){calls.push(['prepare',options]);receipt={...receipt,status:'prepared',integrationCommit:sha,integrationBranch:`codex/integrate-${root}`,integrationWorktree:worktreeRoot+'/'+root+'-integration'};return receipt;},
  publishDelivery(options){calls.push(['publish',options]);assert.deepEqual(options.pushDefault(),{status:'protected'});receipt={...receipt,status:'awaiting_ci',mode:'pr',pullRequest:{url:'https://github.com/owner/repo/pull/7',number:7}};return receipt;}
 };
 const permit={projectId:'p',rootTaskId:root,taskId:'publish-task',runId:'publish-run',agentId:'publisher',projectContext:{id:'p',repository:{hostPath:projectRoot,fullName:'owner/repo'},workspace:{hostPath:featureWorktree},checks:[{id:'unit'}],delivery:{adapter:'managed-project',maximumAction:'pull_request'}},codeReview:{verdict:'PASS',candidateSha:sha,rootTaskId:root,projectId:'p',runId:'qa-run',agentId:'qa',checks:[{id:'unit',status:'passed',candidateSha:sha}],verification:{command:'Native QA qa-run: unit',status:'passed',durationSeconds:1}}};
 const pr={number:7,html_url:'https://github.com/owner/repo/pull/7',state:'open',draft:false,head:{sha,ref:`codex/integrate-${root}`,repo:{full_name:'owner/repo'}},base:{ref:'main',repo:{full_name:'owner/repo'}}};
 const options={projectRoot,rootTaskId:root,worktreeRoot,permit},ports={manager,inspect,harness:{startHarnessSession:options=>calls.push(['session',options])},githubRunner:()=>({status:0,stdout:JSON.stringify(pr),stderr:''}),log:event=>events.push(event)};
 return {options,ports,calls,events,setReceipt:value=>receipt=value,getReceipt:()=>receipt};
}

test('managed adapter starts and resumes the same feature receipt and Harness session',async()=>{
 const {runRoleProjectDelivery}=await adapter(),f=fixture();
 const first=await runRoleProjectDelivery({...f.options,action:'workspace'},f.ports);
 assert.equal(first.codeHostPath,f.options.worktreeRoot+'/'+root);assert.equal(first.branch,`codex/${root}-paperclip-work`);
 await runRoleProjectDelivery({...f.options,action:'workspace'},f.ports);
 assert.equal(f.calls.filter(x=>x[0]==='start').length,1);assert.equal(f.calls[0][0],'session');
 f.setReceipt({...f.getReceipt(),featureWorktree:'/foreign'});
 await assert.rejects(runRoleProjectDelivery({...f.options,action:'workspace'},f.ports),/DELIVERY_RECEIPT_BINDING/);
});

test('prepare returns the manager integration candidate and does not substitute the feature SHA',async()=>{
 const {runRoleProjectDelivery}=await adapter(),f=fixture();await runRoleProjectDelivery({...f.options,action:'workspace'},f.ports);
 const candidate=await runRoleProjectDelivery({...f.options,action:'candidate'},f.ports);
 assert.equal(candidate.candidateSha,sha);assert.equal(candidate.codeHostPath,f.options.worktreeRoot+'/'+root+'-integration');assert.equal(candidate.branch,`codex/integrate-${root}`);
 assert.equal(f.calls.find(x=>x[0]==='prepare')[1].integrationWorktreeRoot,f.options.worktreeRoot);
});

test('publishing uses only trusted current QA checks and protected PR fallback',async()=>{
 const {runRoleProjectDelivery}=await adapter(),f=fixture();await runRoleProjectDelivery({...f.options,action:'workspace'},f.ports);await runRoleProjectDelivery({...f.options,action:'candidate'},f.ports);
 const missing=structuredClone(f.options);delete missing.permit.codeReview;
 await assert.rejects(runRoleProjectDelivery({...missing,action:'pull_request',verification:{status:'passed'}},f.ports),/DELIVERY_REVIEW_REQUIRED/);
 const result=await runRoleProjectDelivery({...f.options,action:'pull_request'},f.ports);assert.equal(result.pullRequest.number,7);
 const publish=f.calls.find(x=>x[0]==='publish')[1];assert.equal(publish.verification.command,'Native QA qa-run: unit');assert.equal(publish.githubRepositoryName,'owner/repo');
 await runRoleProjectDelivery({...f.options,action:'pull_request'},f.ports);assert.equal(f.calls.filter(x=>x[0]==='publish').length,1);
 const changed=structuredClone(f.options);changed.permit.codeReview.candidateSha=feature;
 await assert.rejects(runRoleProjectDelivery({...changed,action:'pull_request'},f.ports),/DELIVERY_REVIEW_REQUIRED/);
});

test('PR runner reuses exact repository/head PR and suppresses auto merge',async()=>{
 const {createRoleProjectPrRunner}=await adapter(),calls=[];
 const pr={number:7,html_url:'https://github.com/owner/repo/pull/7',state:'open',draft:false,head:{sha,ref:'codex/integration',repo:{full_name:'owner/repo'}},base:{ref:'main',repo:{full_name:'owner/repo'}}};
 const invoke=(binary,args)=>{calls.push(args);if(args[0]==='api')return {status:0,stdout:JSON.stringify(args[1].includes('?')?[pr]:pr),stderr:''};throw Error('unexpected');};
 const runner=createRoleProjectPrRunner({repository:'owner/repo',integrationBranch:'codex/integration',expectedCommit:sha,defaultBranch:'main',invoke});
 const result=runner('gh',['pr','create','--repo','owner/repo','--head','codex/integration','--base','main']);assert.match(result.stdout,/pull\/7/);
 runner('gh',['pr','merge','--repo','owner/repo','--auto','--merge','https://github.com/owner/repo/pull/7']);
 assert.equal(calls.filter(args=>args[0]==='pr'&&['create','merge'].includes(args[1])).length,0);
});
test('artifact-only metadata cannot create a full delivery receipt',async()=>{
 const {runRoleProjectDelivery}=await adapter(),f=fixture();f.options.permit.projectContext.delivery.maximumAction='artifact';
 await assert.rejects(runRoleProjectDelivery({...f.options,action:'workspace'},f.ports),/DELIVERY_ACTION_DENIED/);assert.equal(f.calls.length,0);
});
