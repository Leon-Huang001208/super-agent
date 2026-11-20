import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as managed from './vendor/leon-engineering/iteration-delivery.mjs';
import {startHarnessSession} from './vendor/leon-engineering/harness-project.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value;
const sha=value=>/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value??'');
function invoke(binary,args,options={}){
 const env={...process.env,GIT_TERMINAL_PROMPT:'0'};
 for(const key of Object.keys(env))if(/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|REPLACE_REF_BASE|SSH_COMMAND|SSH|NO_VERIFY)/.test(key)||key==='NODE_OPTIONS')delete env[key];
 const result=spawnSync(binary,args,{...options,encoding:'utf8',env,shell:false,timeout:120000,maxBuffer:512*1024});
 if(result.error||result.signal||result.status!==0)fail('ROLE_PROJECT_DELIVERY_COMMAND_FAILED');return result;
}
function inspect(root){
 const git=args=>invoke('/usr/bin/git',args,{cwd:root}).stdout.trim();
 return {repositoryRoot:git(['rev-parse','--show-toplevel']),commonRoot:git(['rev-parse','--path-format=absolute','--git-common-dir']),
  branch:git(['symbolic-ref','--quiet','--short','HEAD']),head:git(['rev-parse','--verify','HEAD']),dirty:Boolean(git(['status','--porcelain=v1','-z','--untracked-files=all']))};
}
function logger(projectRoot,port){
 if(port)return port;
 return event=>{const folder=process.env.SUPER_AGENT_LOG_ROOT??path.join(projectRoot,'logs');fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.appendFileSync(path.join(folder,'role-project-delivery.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});};
}
function scope(options){
 const {projectRoot,rootTaskId,worktreeRoot,permit}=options;
 if(!absolute(projectRoot)||!absolute(worktreeRoot)||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(rootTaskId??'')||
  permit?.projectContext?.id!==permit?.projectId||permit.projectContext.repository?.hostPath!==projectRoot||
  (permit.rootTaskId??permit.taskId)!==rootTaskId||permit.projectContext.workspace?.hostPath!==path.join(worktreeRoot,rootTaskId))fail('ROLE_PROJECT_DELIVERY_SCOPE_DENIED');
 return {projectRoot,rootTaskId,worktreeRoot,permit,featureWorktree:path.join(worktreeRoot,rootTaskId),featureBranch:`codex/${rootTaskId}-paperclip-work`};
}
function binding(receipt,s){
 if(receipt?.taskId!==s.rootTaskId||receipt.repositoryRoot!==s.projectRoot||receipt.featureWorktree!==s.featureWorktree||receipt.featureBranch!==s.featureBranch)fail('ROLE_PROJECT_DELIVERY_RECEIPT_BINDING_DENIED');
 return receipt;
}
function candidate(receipt,s,inspectPort){
 const suffix=receipt.integrationBranch?.slice(`codex/integrate-${s.rootTaskId}`.length);
 if(!['',...(typeof suffix==='string'&&/^-r[1-9][0-9]*$/.test(suffix)?[suffix]:[])].includes(suffix)||
  receipt.integrationBranch!==`codex/integrate-${s.rootTaskId}${suffix}`||receipt.integrationWorktree!==path.join(s.worktreeRoot,s.rootTaskId+'-integration'+suffix)||!sha(receipt.integrationCommit))fail('ROLE_PROJECT_DELIVERY_CANDIDATE_DENIED');
 const original=inspectPort(s.projectRoot),actual=inspectPort(receipt.integrationWorktree);
 if(original.commonRoot!==actual.commonRoot||actual.branch!==receipt.integrationBranch||actual.head!==receipt.integrationCommit||actual.dirty)fail('ROLE_PROJECT_DELIVERY_CANDIDATE_CHANGED');
 return {codeHostPath:receipt.integrationWorktree,hostPath:receipt.integrationWorktree,branch:receipt.integrationBranch,candidateSha:receipt.integrationCommit};
}
function verification(s,head){
 const review=s.permit.codeReview,required=s.permit.projectContext.checks??[],checks=review?.checks;
 if(review?.verdict!=='PASS'||review.rootTaskId!==s.rootTaskId||review.projectId!==s.permit.projectId||review.candidateSha!==head||
  typeof review.runId!=='string'||!review.runId||review.agentId===s.permit.agentId||!Array.isArray(checks)||!checks.length||
  required.some(item=>!checks.some(check=>check.id===item.id&&check.status==='passed'&&check.candidateSha===head))||
  checks.some(check=>check.status!=='passed'||check.candidateSha!==head)||review.verification?.status!=='passed'||
  typeof review.verification.command!=='string'||!review.verification.command.trim()||!Number.isInteger(review.verification.durationSeconds)||review.verification.durationSeconds<0)fail('ROLE_PROJECT_DELIVERY_REVIEW_REQUIRED');
 return {...review.verification};
}

/** GitHub is used solely to create/reuse the same exact candidate PR; auto-merge is never enabled. */
export function createRoleProjectPrRunner({repository,integrationBranch,expectedCommit,defaultBranch,existingPullRequest,invoke:run=invoke}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??'')||!sha(expectedCommit)||!integrationBranch?.startsWith('codex/')||!defaultBranch)fail('ROLE_PROJECT_DELIVERY_GITHUB_SCOPE_DENIED');
 let selected=existingPullRequest;
 const url=number=>`https://github.com/${repository}/pull/${number}`;
 function validate(pr){
  if(!Number.isSafeInteger(pr?.number)||pr.number<1||pr.html_url!==url(pr.number)||pr.state!=='open'||pr.draft!==false||
   pr.head?.sha!==expectedCommit||pr.head?.ref!==integrationBranch||pr.head?.repo?.full_name!==repository||pr.base?.ref!==defaultBranch||pr.base?.repo?.full_name!==repository)fail('ROLE_PROJECT_DELIVERY_PR_IDENTITY_DENIED');
  selected={url:pr.html_url,number:pr.number};return selected;
 }
 function find(options){
  if(selected){if(selected.url!==url(selected.number))fail('ROLE_PROJECT_DELIVERY_PR_IDENTITY_DENIED');return validate(JSON.parse(run('gh',['api',`repos/${repository}/pulls/${selected.number}`],options).stdout));}
  const query=`repos/${repository}/pulls?state=open&head=${encodeURIComponent(repository.split('/')[0]+':'+integrationBranch)}&base=${encodeURIComponent(defaultBranch)}`;
  const matches=JSON.parse(run('gh',['api',query],options).stdout);if(!Array.isArray(matches)||matches.length>1)fail('ROLE_PROJECT_DELIVERY_PR_IDENTITY_DENIED');
  return matches.length?validate(matches[0]):null;
 }
 return (binary,args,options)=>{
  const value=key=>args[args.indexOf(key)+1];
  if(binary!=='gh'||!Array.isArray(args)||value('--repo')!==repository)fail('ROLE_PROJECT_DELIVERY_GITHUB_ACTION_DENIED');
  if(args[0]==='pr'&&args[1]==='create'){
   if(value('--head')!==integrationBranch||value('--base')!==defaultBranch)fail('ROLE_PROJECT_DELIVERY_GITHUB_ACTION_DENIED');
   const prior=find(options);if(prior)return {status:0,stdout:prior.url+'\n',stderr:''};
   const result=run(binary,args,options),created=result.stdout.trim(),number=Number(created.match(/\/([0-9]+)$/)?.[1]);
   selected={url:created,number};find(options);return {status:0,stdout:selected.url+'\n',stderr:''};
  }
  if(args[0]==='pr'&&args[1]==='merge'&&args.includes('--auto')&&args.includes('--merge')){
   const current=find(options);if(!current||!args.includes(current.url))fail('ROLE_PROJECT_DELIVERY_GITHUB_ACTION_DENIED');
   return {status:0,stdout:'PR-only policy: automatic merge disabled\n',stderr:''};
  }
  fail('ROLE_PROJECT_DELIVERY_GITHUB_ACTION_DENIED');
 };
}

/** The adapter adds no task lifecycle. All Git state and delivery receipts belong to the pinned manager. */
export async function runRoleProjectDelivery(options,ports={}){
 const s=scope(options),manager=ports.manager??managed,inspectPort=ports.inspect??inspect,audit=logger(s.projectRoot,ports.log);
 try{
  if(s.permit.projectContext.delivery?.maximumAction==='artifact')fail('ROLE_PROJECT_DELIVERY_ACTION_DENIED');
  const original=inspectPort(s.projectRoot);
  for(const id of [s.rootTaskId,'integration'])if(fs.existsSync(path.join(original.commonRoot,'leon-engineering','locks',id+'.lock')))fail('ROLE_PROJECT_DELIVERY_LOCKED');
  let receipt;try{receipt=binding(manager.readDeliveryReceipt({projectRoot:s.projectRoot,taskId:s.rootTaskId}),s);}catch(error){if(!String(error.message).startsWith('missing delivery receipt:'))throw error;}
  if(options.action==='workspace'){
   (ports.harness??{startHarnessSession}).startHarnessSession({projectRoot:s.projectRoot,host:'codex',sessionId:'paperclip-'+s.rootTaskId,newTask:true,
    task:{id:s.rootTaskId,goal:'Execute the registered Paperclip project task',acceptanceCriteria:['Current project checks and independent Native QA'],deliveryRequired:true}});
   const reused=Boolean(receipt);receipt??=binding(manager.startDelivery({projectRoot:s.projectRoot,taskId:s.rootTaskId,slug:'paperclip-work',worktreeRoot:s.worktreeRoot}),s);
   const actual=inspectPort(receipt.featureWorktree);if(actual.commonRoot!==original.commonRoot||actual.branch!==s.featureBranch||!sha(actual.head))fail('ROLE_PROJECT_DELIVERY_WORKSPACE_CHANGED');
   audit({code:'ROLE_PROJECT_DELIVERY_WORKSPACE',rootTaskId:s.rootTaskId,reused,candidateSha:actual.head});
   return {codeHostPath:receipt.featureWorktree,branch:receipt.featureBranch,candidateSha:actual.head,reused};
  }
  if(!receipt)fail('ROLE_PROJECT_DELIVERY_WORKSPACE_REQUIRED');
  if(options.action==='candidate'){
   if(receipt.status==='prepared'&&inspectPort(receipt.featureWorktree).head===receipt.featureCommit)return candidate(receipt,s,inspectPort);
   receipt=binding(manager.prepareDelivery({projectRoot:s.projectRoot,taskId:s.rootTaskId,integrationWorktreeRoot:s.worktreeRoot,replacePrepared:receipt.status==='prepared'}),s);
   const result=candidate(receipt,s,inspectPort);audit({code:'ROLE_PROJECT_DELIVERY_PREPARED',rootTaskId:s.rootTaskId,candidateSha:result.candidateSha});return result;
  }
  if(options.action!=='pull_request')fail('ROLE_PROJECT_DELIVERY_ACTION_DENIED');
  const current=candidate(receipt,s,inspectPort),proof=verification(s,current.candidateSha),repository=s.permit.projectContext.repository.fullName;
  const githubRunner=createRoleProjectPrRunner({repository,integrationBranch:receipt.integrationBranch,expectedCommit:current.candidateSha,defaultBranch:receipt.defaultBranch,existingPullRequest:receipt.pullRequest,invoke:ports.githubRunner??invoke});
  if(receipt.status==='awaiting_ci'&&receipt.mode==='pr'&&receipt.pullRequest){githubRunner('gh',['pr','create','--repo',repository,'--head',receipt.integrationBranch,'--base',receipt.defaultBranch],{cwd:s.projectRoot});return {...current,pullRequest:receipt.pullRequest,status:receipt.status,reused:true};}
  receipt=manager.publishDelivery({projectRoot:s.projectRoot,taskId:s.rootTaskId,verification:proof,pushDefault:()=>({status:'protected'}),githubRepositoryName:repository,githubRunner});
  if(receipt.mode!=='pr')fail('ROLE_PROJECT_DELIVERY_PR_REQUIRED');
  audit({code:'ROLE_PROJECT_DELIVERY_PR_PUBLISHED',rootTaskId:s.rootTaskId,candidateSha:current.candidateSha,pullRequestNumber:receipt.pullRequest?.number});
  return {...current,pullRequest:receipt.pullRequest,status:receipt.status};
 }catch(error){audit({code:'ROLE_PROJECT_DELIVERY_FAILED',rootTaskId:s.rootTaskId,errorCode:error.code??'ROLE_PROJECT_DELIVERY_MANAGER_FAILED'});throw error;}
}

// Production host transport runs this entry in its existing cancellable process group.
// The private permit is supplied on stdin; executable arguments contain no permit data.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||process.argv[2]!=='--request-stdin')fail('ROLE_PROJECT_DELIVERY_ARGUMENT_DENIED');
  let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>1048576)fail('ROLE_PROJECT_DELIVERY_INPUT_LIMIT');}
  const result=await runRoleProjectDelivery(JSON.parse(input));process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write(JSON.stringify({errorCode:error.code??'ROLE_PROJECT_DELIVERY_MANAGER_FAILED'})+'\n');process.exitCode=1;}
}
