/** Transport one authorized Native invocation. Native owns tasks, runs and sessions. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {NATIVE_ROLE_EXTRA_ARGS} from '../bridge/native-role-adapter.mjs';
import {validateRoleCall} from '../docker/role-codex-gate.mjs';
const DATA='/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0',ROOT=DATA+'/state/control/research-pm';
const IMAGE='sha256:ce66c5354e5efdd7279953134cba2a43c16b54e618a9e15ca6eb83e6bcae0c6c';
const runId=process.argv[2],sha=x=>createHash('sha256').update(x).digest('hex'),docker='/usr/local/bin/docker';
const common=['--context','desktop-linux'],fail=code=>{throw Object.assign(new Error(code),{code});};
function read(file){
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.nlink!==1||(s.mode&0o077)||s.size>1048576)fail('ROLE_CONTAINER_FILE_DENIED');
 return fs.readFileSync(file);
}
function exec(args){const r=spawnSync(docker,[...common,...args],{encoding:'utf8',timeout:15000,maxBuffer:1048576});if(r.status!==0||r.error||r.signal)fail('ROLE_CONTAINER_DOCKER_UNKNOWN');return r.stdout;}
function durable(file,value){
 const tmp=file+'.tmp',fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(fs.existsSync(file))fail('ROLE_CONTAINER_RESULT_EXISTS');fs.renameSync(tmp,file);
 const p=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(p);}finally{fs.closeSync(p);}
}
let stream,err,input,network,broker,terminal=false;
try{
 if(process.platform!=='darwin'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(runId??''))fail('ROLE_CONTAINER_ARGUMENT_DENIED');
 const dir=ROOT+'/transport/'+runId,request=JSON.parse(read(dir+'/request.json')),permitBytes=read(ROOT+'/permits/'+runId+'.json'),permit=JSON.parse(permitBytes);
 const gate=JSON.parse(read(ROOT+'/claims/'+runId+'.json')),material=ROOT+'/materials/'+path.basename(permit.instructionsFilePath);
 if(request.runId!==runId||request.taskId!==permit.taskId||gate.runId!==runId||gate.permitSha256!==sha(permitBytes)||
    request.inputSha256!==sha(read(dir+'/stdin'))||sha(read(material))!==permit.materialSha256)fail('ROLE_CONTAINER_BINDING_DENIED');
 validateRoleCall({permit,args:request.args,env:{PAPERCLIP_RUN_ID:permit.runId,PAPERCLIP_AGENT_ID:permit.agentId,
  PAPERCLIP_COMPANY_ID:permit.companyId,PAPERCLIP_TASK_ID:permit.taskId,CODEX_HOME:request.home},cwd:request.cwd,now:Date.now()});
 const cwd=DATA+'/state/'+request.cwd.slice('/paperclip/'.length),name='sa-role-'+runId;
 const managed=DATA+'/state/instances/default/projects/'+permit.companyId+'/'+permit.projectId+'/_default';
 if(!(cwd.startsWith(ROOT+'/workspaces/')||cwd===managed)||fs.realpathSync(cwd)!==cwd||!fs.lstatSync(cwd).isDirectory())fail('ROLE_CONTAINER_WORKSPACE_DENIED');
 if(exec(['ps','-a','--filter','name=^/'+name+'$','--format','{{.ID}}']).trim()||fs.existsSync(dir+'/host.claim.json')||fs.existsSync(dir+'/cancel.json'))fail('ROLE_CONTAINER_REPLAY_OR_CANCEL_DENIED');
 const app=JSON.parse(exec(['inspect','super-agent-paperclip-eval-paperclip-1']))[0];
 if(app.Image!==IMAGE)fail('ROLE_CONTAINER_SOURCE_CHANGED');
 const capacity=spawnSync('/Users/leon/.local/bin/docker-capacity-check',['desktop-linux','256','/Volumes/WorkDisk/Data/DockerDesktop/Docker.raw',ROOT],{stdio:'ignore',timeout:15000});
 if(capacity.status!==0)fail('ROLE_CONTAINER_CAPACITY_DENIED');
 durable(dir+'/host.claim.json',{runId,name,image:IMAGE,at:new Date().toISOString(),network:'isolated-with-scoped-provider'});
 const key=randomBytes(32).toString('hex'),client=dir+'/client',proxy=dir+'/proxy',audit=dir+'/proxy-audit';
 for(const p of [client,proxy,audit])fs.mkdirSync(p,{mode:0o700});
 durable(proxy+'/config.json',{runId,key,expiresAt:Date.now()+660000});
 const payload={iss:'https://auth.openai.com',sub:'role-'+runId,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),
  email:'role@local.invalid','https://api.openai.com/auth':{chatgpt_account_id:'role-'+runId,chatgpt_user_id:'role-'+runId,chatgpt_plan_type:'plus'}};
 const jwt=Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.eA';
 durable(client+'/auth.json',{auth_mode:'chatgpt',tokens:{access_token:key,refresh_token:'role-no-refresh',id_token:jwt,account_id:'role-'+runId},last_refresh:new Date().toISOString()});
 network='sa-role-net-'+runId;broker='sa-role-provider-'+runId;
 exec(['network','create','--internal','--label','io.super-agent.task=sa-research-pm-m1-20261119',network]);
 const base=['--pull','never','--platform','linux/arm64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
  '--log-driver','json-file','--log-opt','max-size=2m','--log-opt','max-file=1','--label','io.super-agent.task=sa-research-pm-m1-20261119'];
 const source=fileURLToPath(new URL('../docker/role-provider-proxy.mjs',import.meta.url));
 const provider=['run','-d','--rm','--name',broker,...base,'--network','bridge','--pids-limit','64','--memory','256m','--tmpfs','/tmp:size=16m',
  '--mount','type=bind,source='+proxy+'/config.json,target=/proxy/config.json,readonly',
  '--mount','type=bind,source='+dir+'/provider/auth.json,target=/proxy/auth.json,readonly',
  '--mount','type=bind,source='+audit+',target=/audit','--mount','type=bind,source='+source+',target=/proxy.mjs,readonly',
  '--env','NODE_USE_ENV_PROXY=1'];
 for(const e of app.Config.Env??[])if(/^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY)=/.test(e)){
  const v=e.slice(e.indexOf('=')+1);if(/^https?:/.test(v)){const u=new URL(v);if(u.username||u.password)fail('ROLE_CONTAINER_PROXY_DENIED');}
  provider.push('--env',e);
 }
 provider.push('--entrypoint','node',IMAGE,'/proxy.mjs');exec(provider);exec(['network','connect','--alias','provider',network,broker]);
 const seccomp=app.HostConfig.SecurityOpt.find(x=>x.startsWith('seccomp='));
 const args=['run','--rm','--name',name,...base,'--network',network,'--pids-limit','256','--memory','1536m','--cpus','2',
  '--tmpfs','/tmp:size=128m,mode=1777','--workdir',request.cwd,
  '--mount','type=bind,source='+cwd+',target='+request.cwd,
  '--mount','type=bind,source='+client+',target='+request.home,
  '--mount','type=bind,source='+material+',target='+permit.instructionsFilePath+',readonly',
  '--mount','type=bind,source='+DATA+'/dependencies-paperclip-taskguard4,target=/opt/paperclip,readonly',
  '--env','HOME=/tmp/role-home','--env','CODEX_HOME='+request.home,'--env','LANG=C.UTF-8',
  '--env','HTTP_PROXY=http://provider:8090','--env','HTTPS_PROXY=http://provider:8090','--env','NO_PROXY=provider'];
 if(seccomp){const file=dir+'/seccomp.json';fs.writeFileSync(file,seccomp.slice(8),{mode:0o600,flag:'wx'});args.push('--security-opt','seccomp='+file);}
 args.push('--entrypoint','/usr/bin/timeout',IMAGE,'--signal=TERM','--kill-after=4s','600','/opt/paperclip/node_modules/.bin/codex',
  ...request.args.slice(0,-1),'--skip-git-repo-check',...NATIVE_ROLE_EXTRA_ARGS.slice(2),'-c','chatgpt_base_url="http://provider:8090/backend-api"','-');
 if(fs.existsSync(dir+'/cancel.json'))fail('ROLE_CONTAINER_CANCELLED_BEFORE_START');
 input=fs.openSync(dir+'/stdin','r');stream=fs.openSync(dir+'/stdout','wx',0o600);err=fs.openSync(dir+'/stderr','wx',0o600);
 let cancelled=false,stopping=false;
 const cancel=()=>{cancelled=true;};
 process.on('SIGTERM',cancel);process.on('SIGINT',cancel);
 const child=spawn(docker,[...common,...args],{shell:false,stdio:[input,stream,err]});
 const timer=setInterval(()=>{
  if(fs.existsSync(dir+'/cancel.json'))cancelled=true;
  if(cancelled&&!stopping){stopping=true;const stop=spawn(docker,[...common,'stop','--time','3',name],{stdio:'ignore'});stop.once('close',()=>stopping=false);stop.once('error',()=>stopping=false);}
 },250);
 let result;
 try{result=await new Promise((resolve,reject)=>{child.once('error',()=>reject(Object.assign(Error(),{code:'ROLE_CONTAINER_LAUNCH_UNKNOWN'})));child.once('close',(code,signal)=>resolve({code,signal}));});}
 finally{clearInterval(timer);process.off('SIGTERM',cancel);process.off('SIGINT',cancel);}
 fs.fsyncSync(stream);fs.fsyncSync(err);
 if(result.signal||!Number.isInteger(result.code))fail('ROLE_CONTAINER_RESULT_UNKNOWN');
 terminal=true;
 durable(dir+'/result.json',{runId,exitCode:result.code,signal:null,cancelled,timedOut:result.code===124,image:IMAGE,
  stdoutSha256:sha(fs.readFileSync(dir+'/stdout')),stderrSha256:sha(fs.readFileSync(dir+'/stderr')),at:new Date().toISOString()});
 console.log(JSON.stringify({runId,exitCode:result.code,image:IMAGE,network:'isolated-with-scoped-provider'}));
}catch(e){console.error(JSON.stringify({code:/^ROLE_[A-Z_]+$/.test(e.code??e.message)?(e.code??e.message):'ROLE_CONTAINER_UNKNOWN',runId}));process.exitCode=1;}
finally{
 for(const fd of [input,stream,err])if(fd!==undefined)fs.closeSync(fd);
 if(terminal){if(broker)exec(['stop','--time','3',broker]);if(network)exec(['network','rm',network]);}
}
