import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredCases=['same-candidate','host-runtime','read-only-task','worktree-code-task','skills-loaded','private-read-denied','network-denied','daily-task-limit','duplicate-event','followup-same-task','writer-exclusion','restart-reconciliation','ci-wait-releases-worker','decision-version-and-replay','lost-external-result','required-ci-checks','feishu-loop','rwb-documentation-pr'];
export function atLeast(actual, minimum) {
  const a=actual.replace(/^v/,'').split('.').map(Number), b=minimum.split('.').map(Number);
  if(a.length<3 || a.some(x=>!Number.isInteger(x))) return false;
  for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}return true;
}
export function checkCandidate(candidate) {
  if(candidate.package!=='paperclipai'||candidate.acceptance!=='NOT_RUN'||!/^[a-f0-9]{40}$/.test(candidate.releaseGitSha)||!/^sha512-[A-Za-z0-9+/]+=*$/.test(candidate.npmIntegrity))throw new Error('INVALID_CANDIDATE');
  const a=candidate.adapterRequirements,l=candidate.limits;
  if(a.dangerouslyBypassApprovalsAndSandbox!==false||a.apiFallback!==false||a.fastMode!==false||a.maximumAction!=='pull_request'||l.concurrentWriters!==1||l.newTasksPerShanghaiDay!==10||l.maxFixRounds!==2||!Number.isSafeInteger(l.minFreeBytes)||l.minFreeBytes<5*1024**3||!Number.isSafeInteger(l.installReserveBytes)||l.installReserveBytes<1024**3)throw new Error('UNSAFE_EVALUATION_PROFILE');
  if(candidate.deploymentMode!=='authenticated'||candidate.exposure!=='private'||candidate.bind!=='127.0.0.1'||candidate.port!==8097||candidate.tailscaleHttpsPort!==8443)throw new Error('UNSAFE_DEPLOYMENT_PROFILE');
  if(candidate.distribution!=='docker-only'||!/^node@sha256:[a-f0-9]{64}$/.test(candidate.nodeImage)||!/^postgres@sha256:[a-f0-9]{64}$/.test(candidate.postgresImage)||candidate.dockerProject!=='super-agent-paperclip-eval')throw new Error('INVALID_RUNTIME_PROFILE');
  if(a.provider!=='codex'||a.model!=='gpt-6.1-sol'||a.reasoningEffort!=='xhigh'||candidate.codexCliVersion!=='0.159.0')throw new Error('INVALID_EXECUTOR_PROFILE');
  if(!Array.isArray(candidate.requiredCases)||candidate.requiredCases.length!==requiredCases.length||new Set(candidate.requiredCases).size!==requiredCases.length||requiredCases.some(x=>!candidate.requiredCases.includes(x)))throw new Error('INCOMPLETE_ACCEPTANCE_CASES');
  if(!/^[a-f0-9]{40}$/.test(candidate.sourceAuditGitSha)||candidate.database!=='isolated-postgresql-container'||candidate.dataRoot!=='/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0')throw new Error('INVALID_EVIDENCE_OR_STORAGE_PROFILE');
  return candidate;
}
export function evaluateHost(candidate, facts) {
  const problems=[];
  if(facts.platform!=='linux'||facts.architecture!=='arm64')problems.push('ARM64_LINUX_CONTAINER_REQUIRED');
  if(!atLeast(facts.node,candidate.nodeMinimum))problems.push('NODE_VERSION_UNSUPPORTED');
  if(facts.node!=='v24.22.1')problems.push('PINNED_RUNTIME_REQUIRED');
  if(!Number.isFinite(facts.freeBytes))problems.push('DISK_STATUS_UNKNOWN');
  else if(facts.freeBytes<candidate.limits.minFreeBytes+candidate.limits.installReserveBytes)problems.push('INSUFFICIENT_INSTALL_HEADROOM');
  return {readyForDependencyReview:problems.length===0,problems};
}
function safeCli(name,args){const r=spawnSync(name,args,{encoding:'utf8',timeout:8000,maxBuffer:64*1024});return{exitCode:r.status,errorCode:r.error?.code,stdout:r.stdout??'',stderr:r.stderr??''};}
export function writeReceipt(receipt,tag='paperclip-preflight',directory=path.join(root,'logs')){
  if(!/^paperclip-[a-z-]+$/.test(tag))throw new Error('INVALID_RECEIPT_TAG');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});if(fs.lstatSync(directory).isSymbolicLink())throw new Error('UNSAFE_RECEIPT_DIRECTORY');
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID();
  const file=path.join(directory,tag+'-'+id+'.json'),body=JSON.stringify(receipt,null,2)+'\n';
  fs.writeFileSync(file,body,{mode:0o600,flag:'wx'});
  const sha256=crypto.createHash('sha256').update(body).digest('hex');
  const pointer=path.join(directory,tag+'-latest.json'),temp=pointer+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({receiptFile:path.basename(file),sha256,kind:receipt.kind??receipt.status??'unknown'})+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,pointer);
  return{file,sha256};
}
export function main(args=process.argv.slice(2)) {
  const candidate=checkCandidate(JSON.parse(fs.readFileSync(path.join(root,'evaluation/candidate.json'),'utf8')));
  let freeBytes;try{const x=fs.statfsSync(root);freeBytes=x.bavail*x.bsize;}catch{freeBytes=undefined;}
  const facts={platform:process.platform,architecture:process.arch,node:process.version,freeBytes};
  const readiness=evaluateHost(candidate,facts);
  const cli=safeCli('codex',['--version']);
  const packagePath='/opt/paperclip/node_modules/paperclipai/package.json';let installedVersion=null;
  if(fs.existsSync(packagePath))installedVersion=JSON.parse(fs.readFileSync(packagePath,'utf8')).version;
  const receipt={kind:'container-preflight-only',at:new Date().toISOString(),candidate:{package:candidate.package,version:candidate.version,releaseGitSha:candidate.releaseGitSha,npmIntegrity:candidate.npmIntegrity,distribution:candidate.distribution},runtime:facts,...readiness,codex:{version:cli.exitCode===0?cli.stdout.trim():null,authentication:'NOT_RUN'},dependencies:{installedVersion,location:'docker-external-volume'},modelCalls:0,acceptance:'NOT_RUN',cases:Object.fromEntries(candidate.requiredCases.map(x=>[x,'NOT_RUN']))};
  if(args.includes('--install-preview'))receipt.installPreview={command:['docker','compose','up','-d','paperclip'],dockerProject:candidate.dockerProject,dataRoot:candidate.dataRoot,purpose:'所有产品依赖在专用Docker容器/外置APFS卷中安装和运行',hostPackageInstallation:false,credentialCopy:false,modelCalls:false};
  const saved=writeReceipt(receipt,args.includes('--install-preview')?'paperclip-install-preview':'paperclip-preflight');
  console.log(JSON.stringify({...receipt,receiptSha256:saved.sha256,log:saved.file}));
  if(!readiness.readyForDependencyReview)process.exitCode=1;
  return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main();}catch(error){const r={kind:'preflight-error',at:new Date().toISOString(),errorCode:/^[A-Z_]+$/.test(error?.message??'')?error.message:'PREFLIGHT_FAILED',errorType:error?.name??'unknown',modelCalls:0};try{const s=writeReceipt(r);console.error(JSON.stringify({...r,log:s.file}));}catch{console.error(JSON.stringify({...r,archiveError:'RECEIPT_ARCHIVE_FAILED'}));}process.exitCode=1;}}
