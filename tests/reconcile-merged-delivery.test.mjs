import test from 'node:test';
import assert from 'node:assert/strict';
import {planAdoption} from '../scripts/reconcile-merged-delivery.mjs';
const feature='1'.repeat(40),head='2'.repeat(40),merge='3'.repeat(40),tip='4'.repeat(40),base='5'.repeat(40);
function fixture(){return {
  taskId:'network',parentTaskId:'parent',feature,head,merge,prNumber:23,tip,
  repositoryRoot:'/repo',worktreeRoot:'/worktrees',remoteUrl:'https://github.com/Leon-Huang001208/super-agent.git',defaultBranch:'main',
  receipt:{schemaVersion:1,taskId:'network',repositoryRoot:'/repo',remote:'origin',remoteUrl:'https://github.com/Leon-Huang001208/super-agent.git',defaultBranch:'main',baseCommit:base,featureBranch:'codex/network-feature',featureWorktree:'/worktrees/network',status:'started',integrationHistory:[],rollback:{status:'not_run'},repairAttempts:0,verification:{status:'not_run'},ci:{status:'pending'},integrationBranch:null,integrationWorktree:null,integrationCommit:null,mode:null,pullRequest:null,remoteCommit:null,cleanup:{featureWorktreeRemoved:false,integrationWorktreeRemoved:false,localBranchDeleted:false,remoteBranchDeleted:false}},
  parent:{taskId:'parent',repositoryRoot:'/repo',remote:'origin',remoteUrl:'https://github.com/Leon-Huang001208/super-agent.git',defaultBranch:'main',status:'ci_passed',mode:'pr',integrationCommit:head,remoteCommit:merge,pullRequest:{number:23,url:'https://github.com/Leon-Huang001208/super-agent/pull/23'},verification:{status:'passed',command:'352 actual tests',durationSeconds:2},ci:{status:'passed'}},
  pr:{number:23,html_url:'https://github.com/Leon-Huang001208/super-agent/pull/23',state:'closed',merged:true,draft:false,head:{sha:head,repo:{full_name:'Leon-Huang001208/super-agent'}},base:{ref:'main',repo:{full_name:'Leon-Huang001208/super-agent'}},merge_commit_sha:merge},
  protection:{required_status_checks:{strict:true,contexts:['governance','offline-regression','independent-review']},required_pull_request_reviews:{required_approving_review_count:0},enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},required_conversation_resolution:{enabled:true}},
  ci:{status:'passed',mergeCommit:merge,runs:[{name:'governance',conclusion:'SUCCESS'},{name:'offline-regression',conclusion:'SUCCESS'},{context:'independent-review',state:'SUCCESS'}]},
  ancestors:[[base,feature],[feature,head],[head,merge],[merge,tip]],
  local:{remoteFeatureCommit:null,remoteAliasCommit:null,head:feature,branch:'codex/network-feature',commonMatches:true,registered:true,dirty:false,ignored:[],aliasExists:false,aliasPathExists:false,openPids:[]}
};}
test('already merged child is mapped to exact parent PR without pretending cleaned',()=>{const p=planAdoption(fixture());assert.equal(p.status,'ready');assert.equal(p.integrationBranch,'codex/integrate-network-adopted');assert.equal(p.integrationWorktree,'/worktrees/network-integration-adopted');assert.equal(p.integrationCommit,head);assert.equal(p.remoteCommit,merge);assert.equal(p.nextStatus,'ci_passed');});
test('any occupied source waits and cannot be treated as idle using TTL',()=>{const f=fixture();f.local.openPids=[55883];const p=planAdoption(f);assert.equal(p.status,'waiting');assert.deepEqual(p.openPids,[55883]);});
test('changed feature, dirty or unknown ignored files fail closed',()=>{for(const change of [f=>f.local.head=base,f=>f.local.dirty=true,f=>f.local.ignored=['unknown.private'],f=>f.local.commonMatches=false,f=>f.local.registered=false,f=>f.local.aliasExists=true,f=>f.local.aliasPathExists=true]){const f=fixture();change(f);assert.throws(()=>planAdoption(f),/RECONCILE_/);}});
test('wrong receipt owner or an already active delivery is never overwritten',()=>{for(const change of [f=>f.receipt.taskId='other',f=>f.receipt.repositoryRoot='/other',f=>f.receipt.status='prepared',f=>f.receipt.integrationCommit=head,f=>f.receipt.mode='pr',f=>f.parent.taskId='other',f=>f.parent.verification.status='failed',f=>f.parent.integrationCommit=base,f=>f.parent.remoteCommit=tip,f=>f.parent.pullRequest.number=24]){const f=fixture();change(f);assert.throws(()=>planAdoption(f),/RECONCILE_/);}});
test('PR identity, retained ancestry, passing exact-head CI and server protection are mandatory',()=>{for(const change of [f=>f.pr.head.sha=feature,f=>f.pr.merged=false,f=>f.pr.head.repo.full_name='attacker/fork',f=>f.pr.base.ref='other',f=>f.pr.merge_commit_sha=tip,f=>f.ancestors.pop(),f=>f.ancestors.shift(),f=>f.ci.status='pending',f=>f.ci.runs.pop(),f=>f.ci.runs[0].conclusion='FAILURE',f=>f.protection.required_status_checks.strict=false,f=>f.protection.required_status_checks.contexts.pop(),f=>f.protection.enforce_admins.enabled=false,f=>f.protection.allow_force_pushes.enabled=true,f=>f.protection.required_pull_request_reviews=null]){const f=fixture();change(f);assert.throws(()=>planAdoption(f),/RECONCILE_/);}});
export {fixture};

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {withReconcileLocks} from '../scripts/reconcile-merged-delivery.mjs';
test('locks serialize integration and target task and remove only their own lock files',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true}));let called=0;withReconcileLocks(dir,'network',()=>{called++;assert.equal(fs.existsSync(path.join(dir,'integration.lock')),true);assert.equal(fs.existsSync(path.join(dir,'network.lock')),true);});assert.equal(called,1);assert.deepEqual(fs.readdirSync(dir),[]);});
test('a preexisting unknown lock is preserved and prevents every mutation',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true}));fs.writeFileSync(path.join(dir,'network.lock'),'foreign-owner');assert.throws(()=>withReconcileLocks(dir,'network',()=>assert.fail('must not run')),/RECONCILE_LOCKED/);assert.equal(fs.readFileSync(path.join(dir,'network.lock'),'utf8'),'foreign-owner');assert.deepEqual(fs.readdirSync(dir),['network.lock']);});

import crypto from 'node:crypto';
import {recordVerifiedAdoption} from '../scripts/reconcile-merged-delivery.mjs';
function applyFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-apply-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  const f=fixture();f.repositoryRoot=root;f.worktreeRoot=path.join(root,'worktrees');f.receipt.repositoryRoot=root;f.parent.repositoryRoot=root;f.receipt.featureWorktree=path.join(f.worktreeRoot,'network');
  const state=path.join(root,'state');for(const d of ['deliveries','logs','locks'])fs.mkdirSync(path.join(state,d),{recursive:true});fs.mkdirSync(f.receipt.featureWorktree,{recursive:true});
  const receiptFile=path.join(state,'deliveries/network.json'),parentFile=path.join(state,'deliveries/parent.json');fs.writeFileSync(receiptFile,JSON.stringify(f.receipt));fs.writeFileSync(parentFile,JSON.stringify(f.parent));
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const checked={state,facts:f,plan:planAdoption(f),receiptFile,parentFile,receiptSha256:hash(receiptFile),parentSha256:hash(parentFile)};
  const calls=[];
  const git=args=>{calls.push(args);if(args[0]==='worktree'){assert.deepEqual(args,['worktree','add','-b','codex/integrate-network-adopted',path.join(f.worktreeRoot,'network-integration-adopted'),head]);fs.mkdirSync(checked.plan.integrationWorktree);return{stdout:''};}if(args[0]==='branch'){assert.deepEqual(args,['branch','--set-upstream-to=origin/main','codex/integrate-network-adopted']);return{stdout:''};}assert.deepEqual(args,['rev-parse','codex/integrate-network-adopted']);return{stdout:head+'\n'};};
  return{root,f,state,checked,calls,git,options:{taskId:'network',parentTaskId:'parent',feature,head,merge},hash};
}
test('apply updates only the bound child to ci_passed with immutable parent proof; cleanup remains false',t=>{const f=applyFixture(t),parentBefore=fs.readFileSync(f.checked.parentFile);const r=withReconcileLocks(path.join(f.state,'locks'),'network',()=>recordVerifiedAdoption(f.checked,f.options,f.git));assert.equal(r.status,'ci_passed');assert.equal(r.cleanup,'NOT_RUN');const receipt=JSON.parse(fs.readFileSync(f.checked.receiptFile));assert.equal(receipt.featureCommit,feature);assert.equal(receipt.integrationCommit,head);assert.equal(receipt.remoteCommit,merge);assert.equal(receipt.pullRequest.number,23);assert.equal(receipt.cleanup.featureWorktreeRemoved,false);assert.equal(receipt.cleanup.localBranchDeleted,false);assert.equal(receipt.adoption.parentTaskId,'parent');assert.equal(receipt.adoption.evidenceSha256,f.hash(receipt.adoption.evidenceFile));assert.deepEqual(fs.readFileSync(f.checked.parentFile),parentBefore);assert.equal(f.calls.length,3);assert.equal(fs.existsSync(f.f.receipt.featureWorktree),true);});
test('occupied source or receipt drift never creates a Git object or intent',t=>{for(const change of [f=>f.checked.plan.status='waiting',f=>fs.appendFileSync(f.checked.receiptFile,' ')]){const f=applyFixture(t);change(f);assert.throws(()=>recordVerifiedAdoption(f.checked,f.options,()=>assert.fail('mutation after failed proof')),/RECONCILE_/);assert.equal(fs.existsSync(path.join(f.state,'deliveries/network.reconcile-intent.json')),false);}});
test('failed Git mutation leaves original receipt and intent for inspection, never a cleaned claim or retry',t=>{const f=applyFixture(t),before=fs.readFileSync(f.checked.receiptFile);assert.throws(()=>recordVerifiedAdoption(f.checked,f.options,()=>{throw Error('injected transport failure');}),/injected/);assert.deepEqual(fs.readFileSync(f.checked.receiptFile),before);assert.equal(fs.existsSync(path.join(f.state,'deliveries/network.reconcile-intent.json')),true);assert.throws(()=>recordVerifiedAdoption(f.checked,f.options,()=>assert.fail('must not retry unknown mutation')),/RECONCILE_UNKNOWN_INSPECT_REQUIRED/);});

test("foreign integration history or executed cleanup markers are rejected before apply",t=>{for(const change of [f=>f.f.receipt.integrationHistory=[{branch:"codex/other-task",worktree:"/other"}],f=>f.f.receipt.integrationHistory=null,f=>f.f.receipt.cleanup.localBranchDeleted=true]){const x=applyFixture(t);change(x);assert.throws(()=>planAdoption(x.f),/RECONCILE_/);}});
import {referencedContainers,assertCanonicalTree} from '../scripts/reconcile-merged-delivery.mjs';
test('mount references include ancestors, exact source, descendants and symlink aliases',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-mount-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  const source=path.join(root,'delivery/network');fs.mkdirSync(source,{recursive:true});fs.symlinkSync(path.join(root,'delivery'),path.join(root,'alias'));
  const mounts=[{Id:'parent',Mounts:[{Type:'bind',Source:root}]},{Id:'exact',Mounts:[{Type:'bind',Source:source}]},{Id:'child',Mounts:[{Type:'bind',Source:path.join(source,'file')}]},{Id:'alias',Mounts:[{Type:'bind',Source:path.join(root,'alias')}]},{Id:'sibling',Mounts:[{Type:'bind',Source:path.join(root,'delivery/network-other')}]},{Id:'root',Mounts:[{Type:'bind',Source:'/'}]}];
  assert.deepEqual(referencedContainers(mounts,source),['parent','exact','child','alias','root']);
  const f=fixture();f.local.containerRefs=referencedContainers(mounts,source);assert.equal(planAdoption(f).status,'waiting');
});
test('canonical storage refuses symlinked middle directories',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-storage-'));t.after(()=>fs.rmSync(root,{recursive:true}));const real=path.join(root,'actual');fs.mkdirSync(path.join(real,'network'),{recursive:true});fs.symlinkSync(real,path.join(root,'linked'));
  assert.doesNotThrow(()=>assertCanonicalTree(real,path.join(real,'network'),real));
  assert.throws(()=>assertCanonicalTree(path.join(root,'linked'),path.join(root,'linked/network'),path.join(root,'linked')),/RECONCILE_STORAGE_/);
});
test('apply rechecks the full deletion closure and cannot copy another task history',t=>{
  const f=applyFixture(t);f.f.receipt.integrationHistory=[{branch:'codex/another-task',worktree:'/protected'}];
  assert.throws(()=>recordVerifiedAdoption(f.checked,f.options,()=>assert.fail('foreign history must not mutate')),/RECONCILE_UNKNOWN_DELIVERY_STATE/);
  assert.equal(fs.existsSync(path.join(f.state,'deliveries/network.reconcile-intent.json')),false);
});
test('unknown mount structures and bind Sources cannot become an empty reference set',()=>{for(const mounts of [undefined,null,[{}],[{Type:'bind'}],[{Type:'bind',Source:''}],[{Type:'unknown',Source:'/tmp'}]])assert.throws(()=>referencedContainers([{Id:'x',Mounts:mounts}],'/tmp'),/RECONCILE_/);});
test('a bind path with a missing final component still resolves its existing symlink ancestor',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-missing-'));t.after(()=>fs.rmSync(root,{recursive:true}));const source=path.join(root,'source');fs.mkdirSync(source);fs.symlinkSync(source,path.join(root,'alias'));assert.deepEqual(referencedContainers([{Id:'alias-child',Mounts:[{Type:'bind',Source:path.join(root,'alias/not-created-yet')}]}],source),['alias-child']);});

test("tmpfs and verified default VM volumes do not pretend to be host bind paths",()=>{const c=[{Id:"tmp",Mounts:[{Type:"tmpfs"}]},{Id:"vol",Mounts:[{Type:"volume",Name:"cache",Source:"/var/lib/docker/volumes/cache/_data"}]}],v={cache:{Name:"cache",Driver:"local",Mountpoint:"/var/lib/docker/volumes/cache/_data",Options:null}};assert.deepEqual(referencedContainers(c,"/tmp",v),[]);assert.throws(()=>referencedContainers(c,"/tmp"),/RECONCILE_VOLUME_REFERENCE_UNKNOWN/);v.cache.Options={o:"bind",device:"/tmp"};assert.throws(()=>referencedContainers(c,"/tmp",v),/RECONCILE_VOLUME_REFERENCE_UNKNOWN/);});

test("unknown remote alias or changed remote feature cannot be cleaned by inherited branch names",()=>{for(const change of [f=>f.local.remoteAliasCommit=head,f=>f.local.remoteFeatureCommit=head]){const f=fixture();change(f);assert.throws(()=>planAdoption(f),/RECONCILE_REMOTE_RESOURCE_UNKNOWN/);}});

import {readOnlyVmCachePids} from '../scripts/reconcile-merged-delivery.mjs';
const vmCommand='/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine';
test('only the actual VM process with read-only access to every source FD is a cache candidate',()=>{
  const output='p55883\ncvm\nf*482\nar\nf*255\nar\np99\ncother\nf3\nar\n';
  assert.deepEqual(readOnlyVmCachePids(output,{55883:vmCommand,99:'/other'}),[55883]);
  assert.deepEqual(readOnlyVmCachePids(output.replace('f*255\nar','f*255\nau'),{55883:vmCommand}),[]);
  assert.deepEqual(readOnlyVmCachePids('p55883\nf3\n',{55883:vmCommand}),[]);
});
test('explicit user cache option retains observed handles while allowing ordinary adoption',()=>{
  const f=fixture();f.local.openPids=[55883];f.local.readOnlyVmCachePids=[55883];
  assert.equal(planAdoption(f).status,'waiting');f.allowReadOnlyVmCache=true;const p=planAdoption(f);
  assert.equal(p.status,'ready');assert.deepEqual(p.openPids,[55883]);assert.deepEqual(p.readOnlyVmCachePids,[55883]);assert.deepEqual(p.activePids,[]);
});
test('cache option never excuses another process, unknown access or container references',()=>{
  const f=fixture();f.allowReadOnlyVmCache=true;f.local.openPids=[55883,99];f.local.readOnlyVmCachePids=[55883];assert.equal(planAdoption(f).status,'waiting');
  f.local.openPids=[55883];f.local.readOnlyVmCachePids=[];assert.equal(planAdoption(f).status,'waiting');
  f.local.readOnlyVmCachePids=[55883];f.local.containerRefs=['real-container'];assert.equal(planAdoption(f).status,'waiting');
});
