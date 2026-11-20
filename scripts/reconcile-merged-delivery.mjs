// Project-only reconciliation of an unpublished child already delivered by a merged parent PR.
// Never pushes, merges, removes resources or skips the pinned cleanup/enforce gates.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyProjectRuntime, resolveProjectPrStatus} from './project-runtime.mjs';

const repo='Leon-Huang001208/super-agent';
const required=['governance','offline-regression','independent-review'];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function requireThat(ok,code){if(!ok)throw Error('RECONCILE_'+code);}
const full=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const task=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(x);
export function planAdoption(f){
  const r=f.receipt,p=f.parent,pr=f.pr;
  requireThat(task(f.taskId)&&task(f.parentTaskId)&&f.taskId!==f.parentTaskId&&[f.feature,f.head,f.merge,f.tip].every(full),'INPUT_INVALID');
  requireThat(Number.isSafeInteger(f.prNumber)&&f.prNumber>0,'INPUT_INVALID');
  const url=`https://github.com/${repo}/pull/${f.prNumber}`;
  requireThat(r.schemaVersion===1&&r.taskId===f.taskId&&r.repositoryRoot===f.repositoryRoot,'RECEIPT_OWNER');
  requireThat(r.status==='started'&&r.integrationBranch===null&&r.integrationWorktree===null&&r.integrationCommit===null&&r.mode===null&&r.pullRequest===null&&r.remoteCommit===null,'NOT_UNPUBLISHED');
  requireThat(Array.isArray(r.integrationHistory)&&r.integrationHistory.length===0&&r.repairAttempts===0&&r.rollback?.status==='not_run'&&r.verification?.status==='not_run'&&r.ci?.status==='pending'&&!r.adoption&&!r.resourceCleanup,'UNKNOWN_DELIVERY_STATE');
  requireThat(r.cleanup&&['featureWorktreeRemoved','integrationWorktreeRemoved','localBranchDeleted','remoteBranchDeleted'].every(k=>r.cleanup[k]===false),'UNKNOWN_CLEANUP_STATE');
  requireThat(r.remote==='origin'&&r.remoteUrl===f.remoteUrl&&/^https:\/\/github\.com\/Leon-Huang001208\/super-agent(?:\.git)?$/.test(f.remoteUrl)&&r.defaultBranch===f.defaultBranch,'REMOTE_IDENTITY');
  requireThat(full(r.baseCommit)&&r.baseCommit!==f.feature&&path.isAbsolute(f.worktreeRoot)&&r.featureWorktree===path.join(f.worktreeRoot,f.taskId)&&typeof r.featureBranch==='string'&&r.featureBranch.startsWith('codex/'+f.taskId+'-'),'WORKTREE_OWNER');
  requireThat(p.taskId===f.parentTaskId&&p.repositoryRoot===r.repositoryRoot&&p.remote===r.remote&&p.remoteUrl===r.remoteUrl&&p.defaultBranch===r.defaultBranch&&['ci_passed','cleaned'].includes(p.status),'PARENT_OWNER');
  requireThat(p.mode==='pr'&&p.pullRequest?.number===f.prNumber&&p.pullRequest?.url===url&&p.integrationCommit===f.head&&p.remoteCommit===f.merge&&p.verification?.status==='passed'&&typeof p.verification.command==='string'&&p.verification.command.length>0&&Number.isInteger(p.verification.durationSeconds)&&p.verification.durationSeconds>=0&&p.ci?.status==='passed','PARENT_UNVERIFIED');
  requireThat(pr.number===f.prNumber&&pr.html_url===url&&pr.state==='closed'&&pr.merged===true&&pr.draft===false&&pr.head?.sha===f.head&&pr.head?.repo?.full_name===repo&&pr.base?.repo?.full_name===repo&&pr.base?.ref===f.defaultBranch&&pr.merge_commit_sha===f.merge,'PR_IDENTITY');
  requireThat([[r.baseCommit,f.feature],[f.feature,f.head],[f.head,f.merge],[f.merge,f.tip]].every(([a,b])=>f.ancestors.some(x=>x[0]===a&&x[1]===b)),'ANCESTRY');
  const protection=f.protection,contexts=protection.required_status_checks?.contexts;
  requireThat(protection.required_status_checks?.strict===true&&Array.isArray(contexts)&&required.every(x=>contexts.includes(x))&&protection.required_pull_request_reviews&&protection.enforce_admins?.enabled===true&&protection.allow_force_pushes?.enabled===false&&protection.allow_deletions?.enabled===false&&protection.required_conversation_resolution?.enabled===true,'PROTECTION');
  const runs=f.ci.runs;
  requireThat(f.ci.status==='passed'&&f.ci.mergeCommit===f.merge&&Array.isArray(runs)&&runs.every(x=>['SUCCESS','NEUTRAL','SKIPPED'].includes(x.conclusion??x.state))&&required.every(name=>runs.some(x=>(x.name??x.context)===name&&(x.conclusion??x.state)==='SUCCESS')),'CI_UNVERIFIED');
  const local=f.local;
  requireThat(local.head===f.feature&&local.branch===r.featureBranch&&local.commonMatches===true&&local.registered===true&&local.dirty===false&&Array.isArray(local.ignored)&&local.ignored.length===0&&local.aliasExists===false&&local.aliasPathExists===false,'LOCAL_STATE');
  requireThat(local.remoteAliasCommit===null&&(local.remoteFeatureCommit===null||local.remoteFeatureCommit===f.feature),'REMOTE_RESOURCE_UNKNOWN');
  requireThat(Array.isArray(local.openPids)&&local.openPids.every(x=>Number.isSafeInteger(x)&&x>0)&&Array.isArray(local.containerRefs??[]),'OCCUPANCY_UNKNOWN');
  const cachePids=f.allowReadOnlyVmCache===true?(local.readOnlyVmCachePids??[]):[];
  const activePids=local.openPids.filter(pid=>!cachePids.includes(pid));
  return {status:activePids.length||(local.containerRefs??[]).length?'waiting':'ready',nextStatus:'ci_passed',taskId:f.taskId,parentTaskId:f.parentTaskId,featureCommit:f.feature,integrationCommit:f.head,remoteCommit:f.merge,liveTip:f.tip,pullRequest:{url,number:f.prNumber},integrationBranch:`codex/integrate-${f.taskId}-adopted`,integrationWorktree:path.join(f.worktreeRoot,f.taskId+'-integration-adopted'),openPids:local.openPids,readOnlyVmCachePids:cachePids,activePids,containerRefs:local.containerRefs??[]};
}
function invoke(command,args,{allowFailure=false,cwd}={}){
  const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  if(!allowFailure)requireThat(!r.error&&r.status===0,'COMMAND_FAILED');
  return r;
}
function regularFile(file){const s=fs.lstatSync(file);requireThat(s.isFile()&&!s.isSymbolicLink(),'STATE_FILE_INVALID');return fs.readFileSync(file,'utf8');}
export function referencedContainers(containers,source,volumes={}){
  const canonical=p=>{
    requireThat(typeof p==='string'&&path.isAbsolute(p),'MOUNT_UNKNOWN');
    let current=path.resolve(p);const suffix=[];
    for(;;){try{return path.join(fs.realpathSync(current),...suffix);}catch(error){
      if(error.code!=='ENOENT')throw Error('RECONCILE_MOUNT_UNKNOWN');
      try{if(fs.lstatSync(current).isSymbolicLink())throw Error('RECONCILE_MOUNT_UNKNOWN');}catch(e){if(e.code!=='ENOENT')throw e;}
      const parent=path.dirname(current);requireThat(parent!==current,'MOUNT_UNKNOWN');suffix.unshift(path.basename(current));current=parent;
    }}
  };
  const target=canonical(source),inside=(a,b)=>a===b||a.startsWith(b.endsWith(path.sep)?b:b+path.sep);
  requireThat(Array.isArray(containers),'MOUNT_UNKNOWN');
  return containers.filter(c=>{
    requireThat(c&&typeof c.Id==='string'&&Array.isArray(c.Mounts),'MOUNT_UNKNOWN');let references=false;
    for(const m of c.Mounts){
      requireThat(m&&['bind','tmpfs','volume'].includes(m.Type),'MOUNT_UNKNOWN');
      if(m.Type==='tmpfs')continue;
      if(m.Type==='volume'){
        const v=volumes[m.Name];
        requireThat(v&&v.Name===m.Name&&v.Driver==='local'&&typeof m.Source==='string'&&m.Source===v.Mountpoint&&m.Source.startsWith('/var/lib/docker/volumes/')&&(v.Options===null||(v.Options&&typeof v.Options==='object'&&!Array.isArray(v.Options)&&Object.keys(v.Options).length===0)),'VOLUME_REFERENCE_UNKNOWN');
        continue;
      }
      const mount=canonical(m.Source);if(inside(mount,target)||inside(target,mount))references=true;
    }
    return references;
  }).map(c=>c.Id);
}
export function assertCanonicalTree(root,source,allowedRoot){
  requireThat(root===allowedRoot&&fs.realpathSync(root)===root&&fs.realpathSync(source)===source,'STORAGE_CANONICAL');
  let current=root;
  while(current!==path.dirname(current)){requireThat(!fs.lstatSync(current).isSymbolicLink(),'STORAGE_SYMLINK');current=path.dirname(current);}
  requireThat(!fs.lstatSync(source).isSymbolicLink(),'STORAGE_SYMLINK');
}
function verifyStorage(options,source){
  const allowed='/Volumes/WorkDisk/Projects/SuperAgent/delivery';
  assertCanonicalTree(options.worktreeRoot,source,allowed);
  const info=invoke('/usr/sbin/diskutil',['info','/Volumes/WorkDisk']).stdout;
  requireThat(/Mounted:\s+Yes/.test(info)&&/File System Personality:\s+APFS/.test(info)&&/Volume UUID:\s+2BC466D2-FD62-4395-86AC-45CFF653BC51/.test(info),'VOLUME_IDENTITY');
}
function inspect(options,run=invoke){
  verifyProjectRuntime();
  const git=(args,allowFailure=false,where=options.project)=>run('git',['-C',where,...args],{allowFailure});
  const output=r=>r.stdout.trim();
  const root=fs.realpathSync(output(git(['rev-parse','--show-toplevel'])));
  requireThat(fs.realpathSync(options.project)===root,'PROJECT_ROOT');
  const common=fs.realpathSync(path.resolve(root,output(git(['rev-parse','--git-common-dir']))));
  const state=path.join(common,'leon-engineering'),receiptFile=path.join(state,'deliveries',options.taskId+'.json'),parentFile=path.join(state,'deliveries',options.parentTaskId+'.json');
  for(const directory of [state,path.join(state,'deliveries'),path.join(state,'locks'),path.join(state,'logs')]){const s=fs.lstatSync(directory);requireThat(s.isDirectory()&&!s.isSymbolicLink(),'STATE_DIRECTORY_INVALID');}
  const receiptBytes=regularFile(receiptFile),parentBytes=regularFile(parentFile),receipt=JSON.parse(receiptBytes),parent=JSON.parse(parentBytes);
  const remoteUrl=output(git(['remote','get-url','origin']));
  requireThat(/^https:\/\/github\.com\/Leon-Huang001208\/super-agent(?:\.git)?$/.test(remoteUrl),'REMOTE_IDENTITY');
  const live=output(git(['ls-remote','--symref','origin','HEAD']));
  const branch=/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m.exec(live)?.[1],tip=/^([a-f0-9]{40})\s+HEAD$/m.exec(live)?.[1];
  requireThat(branch&&full(tip),'LIVE_DEFAULT_UNKNOWN');
  requireThat(git(['cat-file','-e',tip+'^{commit}'],true).status===0,'FETCH_REQUIRED');
  const gh=args=>run('gh',args,{cwd:root});
  const pr=JSON.parse(gh(['api',`repos/${repo}/pulls/${options.prNumber}`]).stdout);
  const protection=JSON.parse(gh(['api',`repos/${repo}/branches/${branch}/protection`]).stdout);
  const ci=resolveProjectPrStatus({repositoryRoot:root},{...parent,remoteUrl,pullRequest:{url:`https://github.com/${repo}/pull/${options.prNumber}`},integrationCommit:options.head,defaultBranch:branch},(command,args,opts)=>run(command,args,opts));
  const pairs=[[receipt.baseCommit,options.feature],[options.feature,options.head],[options.head,options.merge],[options.merge,tip]];
  const ancestors=pairs.filter(([a,b])=>full(a)&&full(b)&&git(['merge-base','--is-ancestor',a,b],true).status===0);
  requireThat(receipt.featureWorktree===path.join(options.worktreeRoot,options.taskId),'WORKTREE_OWNER');
  requireThat(!fs.lstatSync(receipt.featureWorktree).isSymbolicLink(),'WORKTREE_SYMLINK');
  const list=output(git(['worktree','list','--porcelain']));
  const alias=`codex/integrate-${options.taskId}-adopted`,aliasPath=path.join(options.worktreeRoot,options.taskId+'-integration-adopted');
  const lsof=run('lsof',['-nP','-Fpcfa','+D',receipt.featureWorktree],{allowFailure:true});
  requireThat(!lsof.error&&((lsof.status===0)||(lsof.status===1&&!lsof.stdout&&!lsof.stderr)),'OCCUPANCY_UNKNOWN');
  const pids=[...new Set(lsof.stdout.split('\n').filter(x=>/^p\d+$/.test(x)).map(x=>Number(x.slice(1))))];
  const commands=options.allowReadOnlyVmCache?Object.fromEntries(pids.map(pid=>[pid,output(run('ps',['-p',String(pid),'-o','comm='],{allowFailure:true}))])):{};
  const cachePids=options.allowReadOnlyVmCache?readOnlyVmCachePids(lsof.stdout,commands):[];
  const ids=output(run('docker',['--context','desktop-linux','ps','-aq']));
  const containers=ids?run('docker',['--context','desktop-linux','inspect','--format','{{json .Mounts}}',...ids.split(/\s+/)]).stdout.trim().split('\n').map((line,i)=>({Id:ids.split(/\s+/)[i],Mounts:JSON.parse(line)})):[];
  const names=[...new Set(containers.flatMap(c=>{requireThat(Array.isArray(c.Mounts),'MOUNT_UNKNOWN');return c.Mounts.filter(m=>m?.Type==='volume').map(m=>{requireThat(typeof m.Name==='string'&&m.Name.length>0,'MOUNT_UNKNOWN');return m.Name;});}))];
  const volumes=names.length?Object.fromEntries(JSON.parse(run('docker',['--context','desktop-linux','volume','inspect',...names]).stdout).map(v=>[v.Name,v])):{};
  const refs=referencedContainers(containers,receipt.featureWorktree,volumes);
  const remoteRefs=output(git(['ls-remote','origin','refs/heads/'+receipt.featureBranch,'refs/heads/'+alias])).split('\n').filter(Boolean).map(line=>line.split(/\s+/));
  const refCommit=branch=>remoteRefs.find(([,name])=>name==='refs/heads/'+branch)?.[0]??null;
  const facts={...options,repositoryRoot:root,remoteUrl,defaultBranch:branch,tip,receipt,parent,pr,protection,ci,ancestors,local:{head:output(git(['rev-parse','HEAD'],false,receipt.featureWorktree)),branch:output(git(['branch','--show-current'],false,receipt.featureWorktree)),commonMatches:fs.realpathSync(path.resolve(receipt.featureWorktree,output(git(['rev-parse','--git-common-dir'],false,receipt.featureWorktree))))===common,registered:list.split('\n\n').some(block=>block.includes('worktree '+receipt.featureWorktree+'\n')&&block.includes('branch refs/heads/'+receipt.featureBranch)),dirty:!!output(git(['status','--porcelain','--untracked-files=all'],false,receipt.featureWorktree)),ignored:output(git(['ls-files','--others','--ignored','--exclude-standard'],false,receipt.featureWorktree)).split('\n').filter(Boolean),aliasExists:git(['show-ref','--verify','refs/heads/'+alias],true).status===0,aliasPathExists:fs.existsSync(aliasPath),openPids:pids,readOnlyVmCachePids:cachePids,containerRefs:refs}};
  facts.local.remoteFeatureCommit=refCommit(receipt.featureBranch);facts.local.remoteAliasCommit=refCommit(alias);
  return {facts,plan:planAdoption(facts),state,common,receiptFile,parentFile,receiptBytes,parentBytes,receiptSha256:sha(receiptBytes),parentSha256:sha(parentBytes)};
}
export function withReconcileLocks(directory,taskId,perform){
  requireThat(task(taskId),'TASK_INVALID');
  const held=[];
  try{
    for(const name of ['integration',taskId]){
      const file=path.join(directory,name+'.lock'),nonce=crypto.randomUUID();
      let fd;try{fd=fs.openSync(file,'wx',0o600);}catch{throw Error('RECONCILE_LOCKED');}
      held.push({file,fd,nonce});fs.writeFileSync(fd,nonce+'\n');
    }
    return perform();
  }finally{
    for(const lock of held.reverse()){
      const same=fs.lstatSync(lock.file).ino===fs.fstatSync(lock.fd).ino&&fs.readFileSync(lock.file,'utf8')===lock.nonce+'\n';
      fs.closeSync(lock.fd);if(same)fs.unlinkSync(lock.file);
    }
  }
}
function atomic(file,value){const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
export function recordVerifiedAdoption(checked,options,git){
  const p=planAdoption(checked.facts);
  requireThat(JSON.stringify(p)===JSON.stringify(checked.plan),'PLAN_DRIFT');
  requireThat(p.status==='ready','SOURCE_IN_USE');
  requireThat(sha(regularFile(checked.receiptFile))===checked.receiptSha256&&sha(regularFile(checked.parentFile))===checked.parentSha256,'RECEIPT_DRIFT');
  const intent=path.join(checked.state,'deliveries',options.taskId+'.reconcile-intent.json');
  requireThat(!fs.existsSync(intent),'UNKNOWN_INSPECT_REQUIRED');
  const operationId=crypto.randomUUID(),now=new Date().toISOString();
  const evidence={schemaVersion:1,operationId,at:now,kind:'merged-parent-pr',parentTaskId:options.parentTaskId,featureCommit:options.feature,prHead:options.head,mergeCommit:options.merge,liveTip:p.liveTip,receiptBeforeSha256:checked.receiptSha256,parentReceiptSha256:checked.parentSha256,requiredChecks:required,ci:checked.facts.ci,protection:checked.facts.protection,plan:p};
  fs.writeFileSync(intent,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  // Only our newly named integration alias is created; never adopt the parent's worktree.
  git(['worktree','add','-b',p.integrationBranch,p.integrationWorktree,p.integrationCommit]);
  git(['branch','--set-upstream-to=origin/'+checked.facts.defaultBranch,p.integrationBranch]);
  requireThat(git(['rev-parse',p.integrationBranch]).stdout.trim()===p.integrationCommit,'ALIAS_IDENTITY');
  requireThat(sha(regularFile(checked.receiptFile))===checked.receiptSha256&&sha(regularFile(checked.parentFile))===checked.parentSha256,'RECEIPT_DRIFT');
  const r={...checked.facts.receipt,featureCommit:options.feature,integrationBranch:p.integrationBranch,integrationWorktree:p.integrationWorktree,integrationCommit:p.integrationCommit,mergeSourceCommit:options.feature,mode:'pr',pullRequest:p.pullRequest,remoteCommit:p.remoteCommit,status:'ci_passed',verification:{...checked.facts.parent.verification,source:'parent-delivery',parentTaskId:options.parentTaskId},ci:{...checked.facts.ci,checkedAt:now},adoption:{kind:'merged-parent-pr',operationId,parentTaskId:options.parentTaskId,evidenceFile:intent,evidenceSha256:sha(regularFile(intent)),originalReceiptSha256:checked.receiptSha256,sourceOccupancy:{openPids:p.openPids,readOnlyVmCachePids:p.readOnlyVmCachePids,activePids:p.activePids,containerRefs:p.containerRefs,allowReadOnlyVmCache:options.allowReadOnlyVmCache===true}},updatedAt:now};
  atomic(checked.receiptFile,r);
  fs.appendFileSync(path.join(checked.state,'logs','iteration-delivery.jsonl'),JSON.stringify({timestamp:now,taskId:options.taskId,event:'reconciled_merged_parent_pr',operationId,integrationCommit:p.integrationCommit,featureCommit:options.feature,parentTaskId:options.parentTaskId})+'\n',{mode:0o600});
  return {...p,dryRun:false,status:'ci_passed',operationId,cleanup:'NOT_RUN',enforce:'NOT_RUN'};
}
export function reconcileMergedDelivery(options){
  requireThat(task(options.taskId)&&task(options.parentTaskId)&&options.taskId!==options.parentTaskId&&[options.feature,options.head,options.merge].every(full),'INPUT_INVALID');
  const first=inspect(options);
  if(!options.apply)return {...first.plan,dryRun:true,receiptSha256:first.receiptSha256,parentSha256:first.parentSha256,protectionVerified:true,requiredChecks:required};
  requireThat(/^[a-f0-9]{64}$/.test(options.expectedReceiptSha256??'')&&first.receiptSha256===options.expectedReceiptSha256,'RECEIPT_DRIFT');
  requireThat(first.plan.status==='ready','SOURCE_IN_USE');
  verifyStorage(options,first.facts.receipt.featureWorktree);
  return withReconcileLocks(path.join(first.state,'locks'),options.taskId,()=>{
    const checked=inspect(options),p=checked.plan;
    requireThat(checked.receiptSha256===options.expectedReceiptSha256&&checked.parentSha256===first.parentSha256,'RECEIPT_DRIFT');
    requireThat(p.status==='ready','SOURCE_IN_USE');
    verifyStorage(options,checked.facts.receipt.featureWorktree);
    return recordVerifiedAdoption(checked,options,args=>invoke('git',['-C',checked.facts.repositoryRoot,...args]));
  });
}
function parse(args){
  const out={apply:false,allowReadOnlyVmCache:false};const keys={'--project':'project','--task-id':'taskId','--parent-task':'parentTaskId','--feature-commit':'feature','--pr-head':'head','--merge-commit':'merge','--pr-number':'prNumber','--worktree-root':'worktreeRoot','--expect-receipt-sha256':'expectedReceiptSha256'};
  for(let i=0;i<args.length;i++){if(args[i]==='--allow-readonly-vm-cache'){requireThat(!out.allowReadOnlyVmCache,'CLI_INVALID');out.allowReadOnlyVmCache=true;continue;}if(args[i]==='--apply'){requireThat(!out.apply,'CLI_INVALID');out.apply=true;continue;}const key=keys[args[i]];requireThat(key&&!Object.hasOwn(out,key)&&args[i+1]&&!args[i+1].startsWith('--'),'CLI_INVALID');out[key]=args[++i];}
  requireThat(typeof out.project==='string'&&typeof out.worktreeRoot==='string','CLI_INVALID');out.prNumber=Number(out.prNumber);return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(reconcileMergedDelivery(parse(process.argv.slice(2))),null,2));}
  catch(error){console.error(/^RECONCILE_[A-Z_]+$/.test(error.message)?error.message:'RECONCILE_FAILED');process.exitCode=1;}
}

export function readOnlyVmCachePids(output,commands){
  const vm='/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine';
  const access=new Map();let pid;
  for(const line of output.split('\n')){
    if(/^p[0-9]+$/.test(line)){pid=Number(line.slice(1));access.set(pid,[]);}
    else if(line.startsWith('f')&&access.has(pid))access.get(pid).push(null);
    else if(line.startsWith('a')&&access.get(pid)?.length){const modes=access.get(pid);modes[modes.length-1]=line.slice(1);}
  }
  return [...access].filter(([p,modes])=>commands[p]===vm&&modes.length>0&&modes.every(mode=>mode==='r')).map(([p])=>p);
}
