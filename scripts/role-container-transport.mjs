/** Transport one authorized Native invocation. Native owns tasks, runs and sessions. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {NATIVE_ROLE_EXTRA_ARGS} from '../bridge/native-role-adapter.mjs';
import {validateRoleCall,normalizeNativeRoleArgs} from '../docker/role-codex-gate.mjs';
import {loadRoleMaterials} from '../bridge/role-materials.mjs';
import {validateRoleMaterialSnapshot,ROLE_MATERIAL_ROOT} from '../bridge/role-material-snapshot.mjs';
import {hostRoleInstructionPath} from '../bridge/role-instruction-paths.mjs';
import {materializeRoleSkillBundle,ROLE_SKILL_BUNDLE_SHA256} from '../bridge/role-skill-bundles.mjs';
import {prepareRoleProjectWorkspace,createHostCapabilityExecutor} from '../bridge/role-host-capabilities.mjs';
import {serveHostCapabilityCalls} from '../bridge/role-host-call-queue.mjs';
const DATA='/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0',ROOT=DATA+'/state/control/research-pm';
const IMAGE='sha256:ce66c5354e5efdd7279953134cba2a43c16b54e618a9e15ca6eb83e6bcae0c6c';
const runId=process.argv[2],resumeSetup=process.argv[3]==='--resume-setup',sha=x=>createHash('sha256').update(x).digest('hex'),docker='/usr/local/bin/docker';
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
/** Project only the approved files, outside every writable HOME alias. No Docker operation is performed here. */
export function createRoleMaterialProjection({permit,materialRoot,snapshotRoot,clientRoot,resumeSetup=false,kind='project',log}) {
 try{
  if(typeof log!=='function')fail('ROLE_CONTAINER_MATERIAL_CONFIG_DENIED');
  const snapshot=validateRoleMaterialSnapshot(permit);if(!snapshot)fail('ROLE_CONTAINER_MATERIAL_SNAPSHOT_REQUIRED');
  if(!['project','native-instructions'].includes(kind)||kind==='native-instructions'&&!snapshot.nativeInstructions)fail('ROLE_CONTAINER_MATERIAL_CONFIG_DENIED');
  const native=kind==='native-instructions'?snapshot.nativeInstructions:null;
  const manifest=native?{schemaVersion:1,project:snapshot.projectKey,role:snapshot.role,
   instructionsFilePath:path.posix.relative(native.materialRoot,native.instructionsFilePath),requiredReferences:[],files:native.materialFiles}:snapshot.manifest;
  for(const root of [materialRoot,snapshotRoot,clientRoot])if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root)fail('ROLE_CONTAINER_MATERIAL_ROOT_DENIED');
  const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
  if(overlaps(snapshotRoot,clientRoot)||overlaps(snapshotRoot,materialRoot)||
    fs.realpathSync(path.dirname(snapshotRoot))!==path.dirname(snapshotRoot)||fs.realpathSync(clientRoot)!==clientRoot)fail('ROLE_CONTAINER_MATERIAL_ALIAS_DENIED');
  const loaded=loadRoleMaterials({root:materialRoot,project:snapshot.projectKey,role:snapshot.role,manifest,log});
  if(fs.existsSync(snapshotRoot)){if(!resumeSetup)fail('ROLE_CONTAINER_MATERIAL_EXISTS');}else fs.mkdirSync(snapshotRoot,{mode:0o700});
  const expected=new Map(loaded.files.map(file=>[file.path,file.sha256]));let total=0;
  const directory=name=>{const s=fs.lstatSync(name);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o022)||fs.realpathSync(name)!==name)fail('ROLE_CONTAINER_MATERIAL_PATH_DENIED');};
  directory(snapshotRoot);
  for(const file of loaded.files){
   const bytes=read(path.join(materialRoot,file.path));total+=bytes.length;if(total>1048576||sha(bytes)!==file.sha256)fail('ROLE_CONTAINER_MATERIAL_CHANGED');
   let target=snapshotRoot;const parts=file.path.split('/');for(const part of parts.slice(0,-1)){target=path.join(target,part);if(!fs.existsSync(target)){if(resumeSetup)fail('ROLE_CONTAINER_MATERIAL_INCOMPLETE');fs.mkdirSync(target,{mode:0o700});}directory(target);}target=path.join(target,parts.at(-1));
   if(fs.existsSync(target)){const s=fs.lstatSync(target);if(!resumeSetup||!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||s.size>262144||sha(fs.readFileSync(target))!==file.sha256)fail('ROLE_CONTAINER_MATERIAL_CHANGED');}
   else{if(resumeSetup)fail('ROLE_CONTAINER_MATERIAL_INCOMPLETE');const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  }
  const seen=new Set();const finalize=(name,relative='')=>{directory(name);for(const entry of fs.readdirSync(name,{withFileTypes:true})){const nested=relative?relative+'/'+entry.name:entry.name,full=path.join(name,entry.name);if(entry.isSymbolicLink())fail('ROLE_CONTAINER_MATERIAL_PATH_DENIED');if(entry.isDirectory()){if(![...expected.keys()].some(file=>file.startsWith(nested+'/')))fail('ROLE_CONTAINER_MATERIAL_EXTRA');finalize(full,nested);}else{if(!entry.isFile()||!expected.has(nested)||sha(fs.readFileSync(full))!==expected.get(nested))fail('ROLE_CONTAINER_MATERIAL_EXTRA');seen.add(nested);fs.chmodSync(full,0o444);}}const fd=fs.openSync(name,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.chmodSync(name,0o555);};
  finalize(snapshotRoot);if(seen.size!==expected.size)fail('ROLE_CONTAINER_MATERIAL_INCOMPLETE');
  const result={source:snapshotRoot,target:native?.materialRoot??ROLE_MATERIAL_ROOT,readOnly:true,manifestSha256:sha(Buffer.from(JSON.stringify(manifest))),
    files:loaded.files.map(file=>({path:file.path,sha256:file.sha256}))};
  log({code:'ROLE_CONTAINER_MATERIALS_PROJECTED',runId:permit.runId,projectId:permit.projectId,role:permit.role,manifestSha256:result.manifestSha256,files:result.files});
  return result;
 }catch(error){const code=/^(?:ROLE_CONTAINER_MATERIAL|ROLE_MATERIAL)_[A-Z_]+$/.test(error.code??'')?error.code:'ROLE_CONTAINER_MATERIAL_FAILED';if(typeof log==='function')log({code,runId:permit?.runId});fail(code);}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
let stream,err,input,network,broker,terminal=false,hostCallsTimer,hostController;
const log=event=>fs.appendFileSync(ROOT+'/host-transport.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
try{
 if(process.platform!=='darwin'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(runId??''))fail('ROLE_CONTAINER_ARGUMENT_DENIED');
 const dir=ROOT+'/transport/'+runId,request=JSON.parse(read(dir+'/request.json')),permitBytes=read(ROOT+'/permits/'+runId+'.json'),permit=JSON.parse(permitBytes);
 const selectedSnapshot=validateRoleMaterialSnapshot(permit);
 validateRoleCall({permit,args:request.args,env:{PAPERCLIP_RUN_ID:permit.runId,PAPERCLIP_AGENT_ID:permit.agentId,
  PAPERCLIP_COMPANY_ID:permit.companyId,PAPERCLIP_TASK_ID:permit.taskId,CODEX_HOME:request.home},cwd:request.cwd,now:Date.now()});
 const gate=JSON.parse(read(ROOT+'/claims/'+runId+'.json')),material=hostRoleInstructionPath(permit.instructionsFilePath,DATA),materialBytes=read(material);
 if(request.runId!==runId||request.taskId!==permit.taskId||gate.runId!==runId||gate.permitSha256!==sha(permitBytes)||
    request.inputSha256!==sha(read(dir+'/stdin'))||sha(materialBytes)!==permit.materialSha256)fail('ROLE_CONTAINER_BINDING_DENIED');
 const cwd=DATA+'/state/'+request.cwd.slice('/paperclip/'.length),name='sa-role-'+runId;
 const managed=DATA+'/state/instances/default/projects/'+permit.companyId+'/'+permit.projectId+'/_default';
 if((selectedSnapshot?cwd!==managed:!(cwd.startsWith(ROOT+'/workspaces/')||cwd===managed))||fs.realpathSync(cwd)!==cwd||!fs.lstatSync(cwd).isDirectory())fail('ROLE_CONTAINER_WORKSPACE_DENIED');
 if(exec(['ps','-a','--filter','name=^/'+name+'$','--format','{{.ID}}']).trim()||fs.existsSync(dir+'/cancel.json')||fs.existsSync(dir+'/host.claim.json')&&!resumeSetup)fail('ROLE_CONTAINER_REPLAY_OR_CANCEL_DENIED');
 const app=JSON.parse(exec(['inspect','super-agent-paperclip-eval-paperclip-1']))[0];
 if(app.Image!==IMAGE)fail('ROLE_CONTAINER_SOURCE_CHANGED');
 const capacity=spawnSync('/Users/leon/.local/bin/docker-capacity-check',['desktop-linux','256','/Volumes/WorkDisk/Data/DockerDesktop/Docker.raw',ROOT],{stdio:'ignore',timeout:15000});
 if(capacity.status!==0)fail('ROLE_CONTAINER_CAPACITY_DENIED');
 if(resumeSetup){
  const prior=JSON.parse(read(dir+'/host.claim.json'));
  if(prior.runId!==runId||prior.image!==IMAGE||prior.name!==name||fs.existsSync(dir+'/stdout')||
     exec(['ps','-a','--filter','name=^/sa-role-provider-'+runId+'$','--format','{{.ID}}']).trim())fail('ROLE_CONTAINER_SETUP_RESUME_DENIED');
  durable(dir+'/setup-resume-'+randomBytes(8).toString('hex')+'.json',{runId,code:'PROVIDER_CONTAINER_NOT_CREATED',at:new Date().toISOString()});
 }else durable(dir+'/host.claim.json',{runId,name,image:IMAGE,at:new Date().toISOString(),network:'isolated-with-scoped-provider'});
 const client=dir+'/client',proxy=dir+'/proxy',audit=dir+'/proxy-audit';
 for(const p of [client,proxy,audit])if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});
 const materialProjection=selectedSnapshot?createRoleMaterialProjection({permit,materialRoot:ROOT+'/materials',snapshotRoot:dir+'/material-snapshot',clientRoot:client,resumeSetup,
  log:event=>fs.appendFileSync(dir+'/material-events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600})}):null;
 if(materialProjection){const receipt={schemaVersion:1,runId,companyId:permit.companyId,ownerId:permit.ownerId,projectId:permit.projectId,role:permit.role,...(permit.projectWorkspaceId?{projectWorkspaceId:permit.projectWorkspaceId}:{}),...materialProjection};
  if(resumeSetup){if(sha(read(dir+'/materials-receipt.json'))!==sha(Buffer.from(JSON.stringify(receipt)+'\n')))fail('ROLE_CONTAINER_MATERIAL_RECEIPT_CHANGED');}else durable(dir+'/materials-receipt.json',receipt);}
 const nativeProjection=selectedSnapshot?.nativeInstructions?createRoleMaterialProjection({permit,kind:'native-instructions',materialRoot:hostRoleInstructionPath(permit.materialRoot,DATA),
  snapshotRoot:dir+'/native-instructions',clientRoot:client,resumeSetup,log}):null;
 const key=resumeSetup?JSON.parse(read(proxy+'/config.json')).key:randomBytes(32).toString('hex');
 const advanced=Boolean(permit.projectContext&&permit.effectiveCapabilities);
 const workspace=advanced?await prepareRoleProjectWorkspace({permit,controlRoot:ROOT,log}):{available:false};
 hostController=new AbortController();
 const hostExecutor=advanced?createHostCapabilityExecutor({permit,workspace,controlRoot:ROOT,dockerContainerName:name,signal:hostController.signal,log}):null;
 const hostTools=hostExecutor?hostExecutor.listTools():[];
 if(!resumeSetup)durable(proxy+'/config.json',{runId,key,expiresAt:Date.now()+660000,
  role:advanced?permit.role:undefined,taskId:permit.taskId,projectId:permit.projectId,projectContext:permit.projectContext,
  readOnlyToolsOnly:Boolean(selectedSnapshot&&permit.projectContext?.delivery?.maximumAction==='artifact'),
  additionalCapabilities:permit.additionalCapabilities??[],effectiveCapabilities:permit.effectiveCapabilities,hostTools,
  mcpAllowedTools:permit.effectiveCapabilities?.mcpAllowedTools??[]});
 const selectedAuth=JSON.parse(read(dir+'/provider/auth.json'));
 const selectedClaims=JSON.parse(Buffer.from(selectedAuth.tokens.id_token.split('.')[1],'base64url').toString());
 const accountId=selectedAuth.tokens.account_id??selectedClaims['https://api.openai.com/auth']?.chatgpt_account_id;
 if(typeof accountId!=='string'||!accountId)fail('ROLE_CONTAINER_PROVIDER_ACCOUNT_DENIED');
 const payload={iss:'https://auth.openai.com',sub:'role-'+runId,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),
  email:'role@local.invalid','https://api.openai.com/auth':{chatgpt_account_id:accountId,chatgpt_user_id:'role-'+runId,chatgpt_plan_type:'plus'}};
 const jwt=Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.eA';
 if(!resumeSetup)durable(client+'/auth.json',{auth_mode:'chatgpt',tokens:{access_token:key,refresh_token:'role-no-refresh',id_token:jwt,account_id:accountId},last_refresh:new Date().toISOString()});
 // Owner-side read-only subscription metadata; never synthesize a model profile.
 const catalog=JSON.parse(read(ROOT+'/models-current.json'));
 if(!Array.isArray(catalog.models)||!catalog.models.some(m=>m.slug==='gpt-6.1-sol'))fail('ROLE_CONTAINER_CATALOG_DENIED');
 if(!resumeSetup)durable(client+'/models.json',catalog);
 else if(sha(read(client+'/models.json'))!==sha(Buffer.from(JSON.stringify(catalog)+'\n')))fail('ROLE_CONTAINER_CATALOG_CHANGED');
 const containerProxy='/paperclip/control/research-pm/transport/'+runId+'/proxy';
 if(!resumeSetup){
  exec(['exec','super-agent-paperclip-eval-paperclip-1','openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
   '-keyout',containerProxy+'/ca.key','-out',containerProxy+'/ca.crt','-subj','/CN=Task-local role CA']);
  exec(['exec','super-agent-paperclip-eval-paperclip-1','openssl','req','-newkey','rsa:2048','-nodes',
   '-keyout',containerProxy+'/tls.key','-out',containerProxy+'/tls.csr','-subj','/CN=provider']);
  fs.writeFileSync(proxy+'/leaf.ext','subjectAltName=DNS:provider\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{mode:0o600,flag:'wx'});
  exec(['exec','super-agent-paperclip-eval-paperclip-1','openssl','x509','-req','-in',containerProxy+'/tls.csr',
   '-CA',containerProxy+'/ca.crt','-CAkey',containerProxy+'/ca.key','-CAcreateserial','-out',containerProxy+'/tls.crt','-days','1','-extfile',containerProxy+'/leaf.ext']);
  fs.chmodSync(proxy+'/ca.key',0o600);fs.chmodSync(proxy+'/ca.crt',0o600);
 }
 fs.chmodSync(proxy+'/tls.key',0o600);fs.chmodSync(proxy+'/tls.crt',0o600);
 if(!resumeSetup)fs.writeFileSync(client+'/trust.pem',exec(['exec','super-agent-paperclip-eval-paperclip-1','cat','/etc/ssl/certs/ca-certificates.crt'])+read(proxy+'/ca.crt'),{mode:0o600,flag:'wx'});
 network='sa-role-net-'+runId;broker='sa-role-provider-'+runId;
 if(resumeSetup){
  const found=JSON.parse(exec(['network','ls','--filter','name=^'+network+'$','--format','json']).trim()||'null');
  if(found){const n=JSON.parse(exec(['network','inspect',network]))[0];if(n.Name!==network||!n.Internal||Object.keys(n.Containers??{}).length||n.Labels?.['io.super-agent.task']!=='sa-research-pm-m1-20261119'||n.IPAM.Config?.[0]?.Subnet!=='10.203.240.0/28')fail('ROLE_CONTAINER_NETWORK_CHANGED');}
  else exec(['network','create','--internal','--subnet','10.203.240.0/28','--label','io.super-agent.task=sa-research-pm-m1-20261119',network]);
 }else exec(['network','create','--internal','--subnet','10.203.240.0/28','--label','io.super-agent.task=sa-research-pm-m1-20261119',network]);
 const base=['--pull','never','--platform','linux/arm64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
  '--log-driver','json-file','--log-opt','max-size=2m','--log-opt','max-file=1','--label','io.super-agent.task=sa-research-pm-m1-20261119'];
 const runtimeSource=fileURLToPath(new URL('../',import.meta.url));
 const provider=['run','-d','--rm','--name',broker,...base,'--network','bridge','--pids-limit','64','--memory','256m','--tmpfs','/tmp:size=16m',
  '--mount','type=bind,source='+proxy+',target=/proxy,readonly',
  '--mount','type=bind,source='+dir+'/provider/auth.json,target=/provider-auth.json,readonly','--env','SUPER_AGENT_ROLE_PROXY_AUTH_FILE=/provider-auth.json',
  '--mount','type=bind,source='+audit+',target=/audit','--mount','type=bind,source='+runtimeSource+',target=/opt/role-runtime,readonly',
  '--env','NODE_USE_ENV_PROXY=1'];
 for(const e of app.Config.Env??[])if(/^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY)=/.test(e)){
  const v=e.slice(e.indexOf('=')+1);if(/^https?:/.test(v)){const u=new URL(v);if(u.username||u.password)fail('ROLE_CONTAINER_PROXY_DENIED');}
  provider.push('--env',e);
 }
 provider.push('--entrypoint','node',IMAGE,'/opt/role-runtime/docker/role-provider-proxy.mjs');exec(provider);exec(['network','connect','--alias','provider',network,broker]);
 let instructionMount;
 if(!materialProjection&&permit.materialFiles){
  const bundle=client+'/instructions';fs.mkdirSync(bundle,{recursive:true,mode:0o700});
  for(const file of permit.materialFiles){
   const bytes=read(hostRoleInstructionPath(path.posix.join(permit.materialRoot,file.path),DATA));
   if(sha(bytes)!==file.sha256)fail('ROLE_CONTAINER_MATERIAL_CHANGED');
   const target=path.join(bundle,file.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
   if(fs.existsSync(target)){if(!resumeSetup||sha(read(target))!==file.sha256)fail('ROLE_CONTAINER_MATERIAL_CHANGED');}
   else fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});
  }
  instructionMount='type=bind,source='+bundle+',target='+permit.materialRoot+',readonly';
 }else if(!materialProjection){
  if(fs.existsSync(client+'/instructions.md')){if(!resumeSetup||sha(read(client+'/instructions.md'))!==permit.materialSha256)fail('ROLE_CONTAINER_MATERIAL_CHANGED');}
  else fs.writeFileSync(client+'/instructions.md',materialBytes,{mode:0o600,flag:'wx'});
  instructionMount='type=bind,source='+client+'/instructions.md,target='+permit.instructionsFilePath+',readonly';
 }
 exec(['exec','super-agent-paperclip-eval-paperclip-1','chown','-R','1000:1000',
  '/paperclip/control/research-pm/transport/'+runId+'/client',request.cwd]);
 const skillAssetRoot=fileURLToPath(new URL('../assets/role-skills/',import.meta.url));
 let roleSkills;
 if(permit.effectiveCapabilities){
  if(permit.effectiveCapabilities.skillBundleSha256!==ROLE_SKILL_BUNDLE_SHA256)fail('ROLE_CONTAINER_SKILL_BUNDLE_CHANGED');
  roleSkills=materializeRoleSkillBundle({codexHome:client,skillNames:permit.effectiveCapabilities.skills.map(skill=>skill.name),assetRoot:skillAssetRoot,packageRoot:'/opt/role-skill-packages'});
  if(!fs.existsSync(dir+'/role-skills.json'))durable(dir+'/role-skills.json',{...roleSkills,runId});
  else if(JSON.parse(read(dir+'/role-skills.json')).sha256!==roleSkills.sha256)fail('ROLE_CONTAINER_SKILL_BUNDLE_CHANGED');
 }
 const seccomp=app.HostConfig.SecurityOpt.find(x=>x.startsWith('seccomp='));
 let evidence;
 if(permit.evidencePacket){
  const source=ROOT+'/team/qa-evidence-v2',manifestBytes=read(source+'/manifest.json');
  if(sha(manifestBytes)!==permit.evidencePacket.manifestSha256)fail('ROLE_CONTAINER_EVIDENCE_CHANGED');
  const manifest=JSON.parse(manifestBytes);if(manifest.rootTaskId!=='7956bcfe-85cd-424a-ac8f-c57752f36dfc'||!Array.isArray(manifest.files)||manifest.files.length>64)fail('ROLE_CONTAINER_EVIDENCE_DENIED');
  evidence=dir+'/evidence';if(!fs.existsSync(evidence))fs.mkdirSync(evidence,{mode:0o700});else if(!resumeSetup)fail('ROLE_CONTAINER_EVIDENCE_EXISTS');let total=0;
  for(const entry of [...manifest.files,{path:'manifest.json',sha256:sha(manifestBytes)}]){
   if(!/^(?:materials\/[a-z-]+\.md|audit\.json|manifest\.json)$/.test(entry.path))fail('ROLE_CONTAINER_EVIDENCE_DENIED');
   const bytes=read(source+'/'+entry.path);total+=bytes.length;if(total>2097152||sha(bytes)!==entry.sha256)fail('ROLE_CONTAINER_EVIDENCE_CHANGED');
   const target=path.join(evidence,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
   if(fs.existsSync(target)){if(!resumeSetup||sha(read(target))!==entry.sha256)fail('ROLE_CONTAINER_EVIDENCE_CHANGED');fs.chmodSync(target,0o600);}
   else fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});
  }
  exec(['exec','super-agent-paperclip-eval-paperclip-1','chown','-R','1000:1000','/paperclip/control/research-pm/transport/'+runId+'/evidence']);
 }
 const args=['run','-i','--rm','--name',name,...base,'--user','1000:1000','--network',network,'--pids-limit','256','--memory','1536m','--cpus','2',
  '--tmpfs','/tmp:size=128m,mode=1777','--workdir',request.cwd,
  '--mount','type=bind,source='+cwd+',target='+request.cwd,
  '--mount','type=bind,source='+client+',target='+request.home,
  '--mount','type=bind,source='+DATA+'/dependencies-paperclip-taskguard4,target=/opt/paperclip,readonly',
  '--env','HOME=/tmp/role-home','--env','CODEX_HOME='+request.home,'--env','LANG=C.UTF-8','--env','SSL_CERT_FILE='+request.home+'/trust.pem','--env','CODEX_CA_CERTIFICATE='+request.home+'/trust.pem',
  '--env','HTTP_PROXY=http://provider:8090','--env','HTTPS_PROXY=http://provider:8090','--env','NO_PROXY=provider','--env','CODEX_CONNECTORS_TOKEN'];
 if(materialProjection)args.push('--mount','type=bind,source='+materialProjection.source+',target='+materialProjection.target+',readonly');
 if(nativeProjection)args.push('--mount','type=bind,source='+nativeProjection.source+',target='+nativeProjection.target+',readonly');
 else if(!materialProjection)args.push('--mount',instructionMount);
 if(seccomp){const file=dir+'/seccomp.json';fs.writeFileSync(file,seccomp.slice(8),{mode:0o600,flag:'wx'});args.push('--security-opt','seccomp='+file);}
 if(workspace.available)args.push('--mount','type=bind,source='+workspace.codeHostPath+',target=/workspace/project'+(permit.role==='qa'?',readonly':''));
 if(roleSkills)args.push('--mount','type=bind,source='+skillAssetRoot+',target=/opt/role-skill-packages,readonly','--mount','type=bind,source='+client+'/skills,target='+request.home+'/skills,readonly');
 if(hostTools.length)args.push('--mount','type=bind,source='+path.join(runtimeSource,'docker/role-host-mcp-server.mjs')+',target=/opt/role-host-mcp-server.mjs,readonly');
 if(evidence)args.push('--mount','type=bind,source='+evidence+',target=/qa-evidence,readonly');
 args.push('--entrypoint','/usr/bin/timeout',IMAGE,'--signal=TERM','--kill-after=4s','600','/opt/paperclip/node_modules/.bin/codex',
  ...normalizeNativeRoleArgs(request.args).slice(0,-1),'--skip-git-repo-check',...NATIVE_ROLE_EXTRA_ARGS.slice(2),'-c','model_catalog_json='+JSON.stringify(request.home+'/models.json'),'-c','chatgpt_base_url="https://provider:8091/backend-api"','-');
 if(workspace.available&&permit.role!=='qa')args.splice(args.length-1,0,'-c','sandbox_workspace_write.writable_roots=["/workspace/project"]');
 if(hostTools.length)args.splice(args.length-1,0,'-c','mcp_servers.role_host.command="node"','-c','mcp_servers.role_host.args=["/opt/role-host-mcp-server.mjs"]','-c','mcp_servers.role_host.env_vars=["CODEX_CONNECTORS_TOKEN"]','-c','mcp_servers.role_host.tool_timeout_sec=360');
 if(fs.existsSync(dir+'/cancel.json'))fail('ROLE_CONTAINER_CANCELLED_BEFORE_START');
 input=fs.openSync(dir+'/stdin','r');stream=fs.openSync(dir+'/stdout','wx',0o600);err=fs.openSync(dir+'/stderr','wx',0o600);
 let cancelled=false,stopping=false;
 const cancel=()=>{cancelled=true;};
 process.on('SIGTERM',cancel);process.on('SIGINT',cancel);
 const child=spawn(docker,[...common,...args],{shell:false,env:{...process.env,CODEX_CONNECTORS_TOKEN:key},stdio:[input,'pipe',err]});
 const hostCallsRoot=audit+'/host-calls';
 if(hostExecutor)hostCallsTimer=setInterval(()=>void serveHostCapabilityCalls({root:hostCallsRoot,permit,executor:hostExecutor,log}).catch(error=>{
  log({code:'HOST_CALL_QUEUE_FAILED',runId,errorCode:error.code??'HOST_CALL_QUEUE_FAILED'});
 }),50);
 // Deterministic management probe in this disposable task container. It does
 // not ask the model to violate its own tool policy or touch the host filesystem.
 let osProbe;
 if(permit.role==='qa'&&!permit.evidencePacket)osProbe=setTimeout(()=>{
  const code=`const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const proof={schemaVersion:1,runId:${JSON.stringify(runId)},uid:process.getuid(),at:new Date().toISOString(),source:'same task container, management Docker exec; outside Codex inner sandbox'};const target=${JSON.stringify('/etc/super-agent-isolation-'+runId+'.tmp')};try{fs.writeFileSync(target,'x',{flag:'wx'});fs.unlinkSync(target);proof.outsideWrite={denied:false};}catch(e){proof.outsideWrite={denied:true,code:e.code};}try{const b=fs.readFileSync('/paperclip/control/research-pm/fixtures/other-project/private-memory.txt');proof.privateRead={readable:true,sha256:crypto.createHash('sha256').update(b).digest('hex')};}catch(e){proof.privateRead={readable:false,code:e.code};}fs.writeFileSync(path.join(process.cwd(),'container-proof-'+proof.runId+'.json'),JSON.stringify(proof),{mode:292,flag:'wx'});console.log(JSON.stringify(proof));`;
  const probe=spawnSync(docker,[...common,'exec',name,'node','-e',code],{encoding:'utf8',timeout:5000,maxBuffer:4096});
  if(probe.status===0){try{const value=JSON.parse(probe.stdout);if(value.runId===runId&&value.uid===1000)durable(dir+'/container-proof.json',value);}catch{}}
 },1000);
 let pending='',outputBytes=0,outputError=false;
 const consume=line=>{
  if(!line.trim())return;
  try{const value=JSON.parse(line);if(value.type?.includes('reasoning')||value.item?.type==='reasoning')return;fs.writeSync(stream,line+'\n');}
  catch{outputError=true;}
 };
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
  outputBytes+=Buffer.byteLength(chunk);if(outputBytes>8*1024*1024){outputError=true;return;}
  pending+=chunk;let cut;while((cut=pending.indexOf('\n'))>=0){consume(pending.slice(0,cut));pending=pending.slice(cut+1);}
 });
 const timer=setInterval(()=>{
  if(fs.existsSync(dir+'/cancel.json')||outputError)cancelled=true;
  if(cancelled&&!hostController.signal.aborted)hostController.abort();
  if(cancelled&&!stopping){stopping=true;const stop=spawn(docker,[...common,'stop','--time','3',name],{stdio:'ignore'});stop.once('close',()=>stopping=false);stop.once('error',()=>stopping=false);}
 },250);
 let result;
 try{result=await new Promise((resolve,reject)=>{child.once('error',()=>reject(Object.assign(Error(),{code:'ROLE_CONTAINER_LAUNCH_UNKNOWN'})));child.once('close',(code,signal)=>resolve({code,signal}));});}
 finally{clearInterval(timer);if(hostCallsTimer)clearInterval(hostCallsTimer);hostController.abort();if(osProbe)clearTimeout(osProbe);process.off('SIGTERM',cancel);process.off('SIGINT',cancel);}
 if(pending)consume(pending);
 if(outputError)fs.writeSync(err,JSON.stringify({code:'ROLE_CONTAINER_OUTPUT_UNKNOWN'})+'\n');
 fs.fsyncSync(stream);fs.fsyncSync(err);
 if(result.signal||!Number.isInteger(result.code))fail('ROLE_CONTAINER_RESULT_UNKNOWN');
 terminal=true;
 durable(dir+'/result.json',{runId,exitCode:outputError?1:result.code,signal:null,cancelled,outputUnknown:outputError,timedOut:result.code===124,image:IMAGE,
   stdoutSha256:sha(fs.readFileSync(dir+'/stdout')),stderrSha256:sha(fs.readFileSync(dir+'/stderr')),at:new Date().toISOString(),
   ...(materialProjection?{materialManifestSha256:materialProjection.manifestSha256,projectId:permit.projectId}:{} )});
 console.log(JSON.stringify({runId,exitCode:outputError?1:result.code,outputUnknown:outputError,image:IMAGE,network:'isolated-with-scoped-provider'}));
}catch(e){console.error(JSON.stringify({code:/^ROLE_[A-Z_]+$/.test(e.code??e.message)?(e.code??e.message):'ROLE_CONTAINER_UNKNOWN',runId}));process.exitCode=1;}
finally{
 if(hostCallsTimer)clearInterval(hostCallsTimer);hostController?.abort();
 for(const fd of [input,stream,err])if(fd!==undefined)fs.closeSync(fd);
 if(terminal){if(broker)exec(['stop','--time','3',broker]);if(network)exec(['network','rm',network]);}
}
}
