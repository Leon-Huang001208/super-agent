import fs from 'node:fs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=value=>Number.isSafeInteger(value)&&value>0&&value<=1000000000;
const fullSha=value=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const fail=code=>{throw Object.assign(Error('ROLE_HOST_GITHUB_'+code),{code:'ROLE_HOST_GITHUB_'+code});};
const binaries=['/opt/homebrew/bin/gh','/usr/local/bin/gh'];
const projections={
 pull_requests:'{items:map({number,state,headSha:.head.sha,draft,updatedAt:.updated_at}),received:length}',
 issues:'{items:map(select(has("pull_request")|not)|{number,state,updatedAt:.updated_at}),received:length}',
 pull_request:'{number,state,title,draft,headSha:.head.sha,headRef:.head.ref,baseRef:.base.ref,updatedAt:.updated_at,merged,mergeCommitSha:.merge_commit_sha}',
 issue:'{number,state,title,updatedAt:.updated_at,closedAt:.closed_at,isPullRequest:has("pull_request")}',
 branch:'{name,sha:.commit.sha,protected}',
};

function registeredRepository(context){
 const fullName=context?.repository?.fullName;
 if(typeof fullName!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)||
  ['.','..'].includes(fullName.split('/')[1]))fail('REPOSITORY_REQUIRED');
 const url=context.repository.url;
 if(url!==undefined&&url!==null){
  const match=/^(?:https:\/\/github\.com\/|git@github\.com:)([^\s/?#]+\/[^\s/?#]+?)(?:\.git)?\/?$/.exec(url);
  if(!match||match[1].toLowerCase()!==fullName.toLowerCase())fail('REPOSITORY_REQUIRED');
 }
 return fullName;
}

export function hasHostGithubRepository(context){
 try{registeredRepository(context);return true;}catch{return false;}
}

function selectedRequest(args,repository){
 if(!object(args)||!Object.hasOwn(projections,args.operation))fail('ARGUMENTS_DENIED');
 const operation=args.operation,allowed=operation==='branch'?['operation','ref']:
  ['pull_request','issue'].includes(operation)?['operation','number']:['operation'];
 if(Object.keys(args).some(key=>!allowed.includes(key)))fail('ARGUMENTS_DENIED');
 let suffix;
 if(operation==='pull_requests')suffix='pulls?state=open&per_page=100';
 else if(operation==='issues')suffix='issues?state=open&per_page=100';
 else if(operation==='branch'){
  if(typeof args.ref!=='string'||args.ref.length>256||! /^[A-Za-z0-9_./-]+$/.test(args.ref)||
   args.ref.startsWith('-')||args.ref.startsWith('/')||args.ref.endsWith('/')||args.ref.includes('..')||args.ref.includes('//'))fail('ARGUMENTS_DENIED');
  suffix='branches/'+encodeURIComponent(args.ref);
 }else{
  if(!number(args.number))fail('ARGUMENTS_DENIED');
  suffix=(operation==='pull_request'?'pulls/':'issues/')+args.number;
 }
 return{operation,endpoint:'repos/'+repository+'/'+suffix,projection:projections[operation]};
}

function baseRecord(value,args,repository,kind){
 if(!object(value)||!number(value.number)||args.number!==undefined&&value.number!==args.number||
  !['open','closed'].includes(value.state))fail('RESPONSE_INVALID');
 return{number:value.number,state:value.state,url:'https://github.com/'+repository+'/'+(kind==='pull'?'pull/':'issues/')+value.number,
  ...(value.updatedAt===null||typeof value.updatedAt==='string'?{updatedAt:value.updatedAt}:{})};
}
function pullRecord(value,args,repository){
 if(!fullSha(value?.headSha))fail('RESPONSE_INVALID');
 return{...baseRecord(value,args,repository,'pull'),headSha:value.headSha,
  ...(typeof value.draft==='boolean'?{draft:value.draft}:{}),
  ...(typeof value.title==='string'?{title:value.title}:{}),
  ...(typeof value.headRef==='string'?{headRef:value.headRef}:{}),
  ...(typeof value.baseRef==='string'?{baseRef:value.baseRef}:{}),
  ...(typeof value.merged==='boolean'?{merged:value.merged}:{}),
  ...(value.mergeCommitSha===null||fullSha(value.mergeCommitSha)?{mergeCommitSha:value.mergeCommitSha}:{})};
}
function issueRecord(value,args,repository){
 if(value?.isPullRequest===true)fail('RESPONSE_INVALID');
 return{...baseRecord(value,args,repository,'issue'),...(typeof value.title==='string'?{title:value.title}:{}),
  ...(value.closedAt===null||typeof value.closedAt==='string'?{closedAt:value.closedAt}:{})};
}

/** Fixed GET routes use the existing host CLI account; no token or config is sent to the task. */
export async function readHostGithub({permit,args,run,exists=fs.existsSync,now=()=>new Date().toISOString(),log=()=>{}}){
 const context=permit?.projectContext;
 if(!context||context.id!==permit.projectId||!permit.effectiveCapabilities?.hostAllowedTools?.includes('host.github_read'))fail('REPOSITORY_REQUIRED');
 const repository=registeredRepository(context),request=selectedRequest(args,repository),binary=binaries.find(value=>exists(value));
 if(!binary)fail('CLI_UNAVAILABLE');
 if(typeof run!=='function')fail('CONNECTION_UNAVAILABLE');
 let response;
 try{response=await run([binary,'api','--method','GET','--hostname','github.com',request.endpoint,'--jq',request.projection],{timeout:20000,useHostProxy:true});}
 catch(error){
  if(error?.code==='ROLE_HOST_CANCELLED')throw error;
  log({code:'ROLE_HOST_GITHUB_READ_FAILED',repository,operation:request.operation,
   causeCode:/^ROLE_HOST_[A-Z_]+$/.test(error?.code??'')?error.code:'CLI_READ_FAILED'});
  fail('CONNECTION_UNAVAILABLE');
 }
 let value;try{value=JSON.parse(response.output);}catch{fail('RESPONSE_INVALID');}
 const list=['pull_requests','issues'].includes(request.operation);
 let data;
 if(list){
  if(!object(value)||!Array.isArray(value.items)||!Number.isSafeInteger(value.received)||value.received<0||value.received>100||value.items.length>value.received||
   request.operation==='pull_requests'&&value.items.length!==value.received)fail('RESPONSE_INVALID');
  data=value.items.map(item=>request.operation==='pull_requests'?pullRecord(item,args,repository):issueRecord(item,args,repository));
 }else if(request.operation==='branch'){
  if(!object(value)||value.name!==args.ref||!fullSha(value.sha))fail('RESPONSE_INVALID');
  data={name:value.name,sha:value.sha,...(typeof value.protected==='boolean'?{protected:value.protected}:{}),
   url:'https://github.com/'+repository+'/tree/'+encodeURIComponent(value.name)};
 }else data=request.operation==='pull_request'?pullRecord(value,args,repository):issueRecord(value,args,repository);
 const observedAt=now();if(!Number.isFinite(Date.parse(observedAt)))fail('RESPONSE_INVALID');
 log({code:'ROLE_HOST_GITHUB_READ_COMPLETED',repository,operation:request.operation,observedAt,
  ...(list?{records:data.length,truncated:value.received===100}:{})});
 return{source:'host gh GET',repository,operation:request.operation,observedAt,
  sourceUrl:'https://api.github.com/'+request.endpoint,data,...(list?{truncated:value.received===100}:{})};
}
