/** Operator setup only: preview is read-only; apply never starts a model or listener. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {configurationHash,contextConfigurationRequest,planContextConfiguration,compatibleContextWorkspace} from '../bridge/context-configuration.mjs';
import {ROLE_ROOT,readControl,writeControl,editRoleRegistry} from '../bridge/role-control-store.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const copy=value=>structuredClone(value);
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

export function parseContextConfigureArgs(args){
 let requestPath,apply=false;
 for(let index=0;index<args.length;index++){
  if(args[index]==='--apply'&&!apply)apply=true;
  else if(args[index]==='--request'&&!requestPath&&args[index+1])requestPath=args[++index];
  else fail('CONTEXT_CONFIG_CLI_INVALID');
 }
 if(!requestPath||!path.isAbsolute(requestPath))fail('CONTEXT_CONFIG_CLI_INVALID');
 return {requestPath,apply};
}

function privateDirectory(directory){
 let cursor=path.parse(directory).root;
 for(const part of directory.slice(cursor.length).split(path.sep)){
  cursor=path.join(cursor,part);
  if(!exists(cursor))fs.mkdirSync(cursor,{mode:0o700});
  const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink()||!stat.isDirectory())fail('CONTEXT_CONFIG_PATH_DENIED');
 }
 const stat=fs.lstatSync(directory);if(stat.uid!==process.getuid()||(stat.mode&0o077))fail('CONTEXT_CONFIG_PATH_DENIED');
}

function immutable(file,bytes){
 privateDirectory(path.dirname(file));
 if(exists(file)){
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o077)||configurationHash(fs.readFileSync(file))!==configurationHash(bytes))fail('CONTEXT_CONFIG_FILE_CHANGED');
  return;
 }
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}

function summary(plan,{mode,status='preview',canApply,reused=false}={}){
 return {schemaVersion:1,mode,status,operationId:plan.operationId,configurationHash:plan.configurationHash,canApply,reused,
  projects:plan.projects.map(value=>({key:value.project.key,projectId:value.project.projectId,workspaceAction:value.workspace.kind,
   ...(value.workspace.id&&{projectWorkspaceId:value.workspace.id})})),materialFiles:plan.files.filter(value=>value.area==='materials').length,
  legacyProjections:plan.files.filter(value=>value.area==='legacy').length,genericRolesToMark:plan.roleUpdates.length,newModelCalls:0,agentConfigurationWrites:0};
}

function roleSourcesMatch(registry,plan){
 if(registry.companyId!==plan.companyId||registry.ownerId!==plan.ownerId)fail('CONTEXT_CONFIG_OWNER_CHANGED');
 for(const expected of plan.roleSources){const current=registry.agents.find(entry=>entry.profile?.agentId===expected.agentId);
  if(!current||registry.team.ids[expected.role]!==expected.agentId||current.profile.role!==expected.role||
   (current.materialRoot??ROLE_ROOT+'/materials')!==expected.materialRoot||current.instructionMutation||current.instructionMigration?.state==='pending'||
   !isDeepStrictEqual(current.manifest,expected.manifest)&&!isDeepStrictEqual(current.manifest,{...expected.manifest,scope:'generic'}))fail('CONTEXT_CONFIG_ROLE_SOURCE_CHANGED');
 }
}

/** Dependency ports are for the existing App management container, not an alternate task engine. */
export async function configureContext({root=ROLE_ROOT,request:raw,native,source,editRegistry=editRoleRegistry,apply=false,log,now=()=>new Date().toISOString()}={}){
 if(typeof log!=='function'||typeof editRegistry!=='function'||!native||!['readProjects','readAgents','executionState','createWorkspace'].every(key=>typeof native[key]==='function')||
  typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root)fail('CONTEXT_CONFIG_ADAPTER_INVALID');
 const request=contextConfigurationRequest(raw),registry=readControl(root+'/registry.json'),intentFile=root+'/context/setup/'+request.operationId+'.json';
 let intent=exists(intentFile)?readControl(intentFile):null;
 if(intent&&(intent.requestSha256!==configurationHash(request)||intent.companyId!==registry.companyId||intent.ownerId!==registry.ownerId))fail('CONTEXT_CONFIG_OPERATION_CHANGED');
 let plan=intent?.plan;
 if(!plan){const sources=typeof source==='function'?await source(registry):source;
  plan=planContextConfiguration({request,registry,projects:await native.readProjects(request.projects.map(p=>p.projectId)),agents:await native.readAgents(registry.companyId),...sources,root});
 }
 const state=await native.executionState();
 const busy=Boolean(state.active?.length||state.environmentLeases?.length||exists(root+'/call.lock'));
 const canApply=!busy&&registry.team?.enabled===false;
 if(!apply){await log({code:'CONTEXT_CONFIG_PREVIEW',operationId:plan.operationId,configurationHash:plan.configurationHash,canApply,files:plan.files.length});return summary(plan,{mode:'preview',status:intent?.status??'preview',canApply});}
 if(intent?.status==='complete'){
  if(configurationHash(registry.context??null)!==intent.appliedContextSha256)fail('CONTEXT_CONFIG_APPLIED_STATE_CHANGED');
  await log({code:'CONTEXT_CONFIG_REUSED',operationId:plan.operationId,configurationHash:plan.configurationHash});return summary(plan,{mode:'apply',status:'complete',canApply,reused:true});
 }
 if(!canApply)fail('CONTEXT_CONFIG_EXECUTION_BUSY');
 privateDirectory(root+'/context/setup');
 if(!intent){
  immutable(root+'/context/setup/'+request.operationId+'.backup.json',Buffer.from(JSON.stringify({schemaVersion:1,operationId:request.operationId,
   companyId:registry.companyId,ownerId:registry.ownerId,beforeContext:registry.context??null,roleSources:plan.roleSources})+'\n'));
  intent={schemaVersion:1,operationId:request.operationId,requestSha256:configurationHash(request),configurationHash:plan.configurationHash,
   companyId:registry.companyId,ownerId:registry.ownerId,status:'prepared',plan,workspaces:{},at:now()};writeControl(intentFile,intent);
 }
 roleSourcesMatch(readControl(root+'/registry.json'),plan);
 const context=copy(plan.context);
 for(const entry of plan.projects){
  const p=entry.project,previous=intent.workspaces[p.projectId],current=(await native.readProjects([p.projectId]))[0];
  if(!current||current.id!==p.projectId||current.companyId!==plan.companyId)fail('CONTEXT_CONFIG_PROJECT_SCOPE_DENIED');
  const workspaces=current.workspaces??[];
  if(entry.workspace.kind==='implicit'){
   if(workspaces.length)fail('CONTEXT_CONFIG_IMPLICIT_WORKSPACE_CHANGED');continue;
  }
  let workspace;
  if(previous?.id||entry.workspace.kind==='reuse'){
   workspace=workspaces.find(w=>w.id===(previous?.id??entry.workspace.id));
   if(!compatibleContextWorkspace(workspace,p,plan.ownerId))fail('CONTEXT_CONFIG_WORKSPACE_CHANGED');
  }else if(previous?.attempted){
   const found=workspaces.filter(w=>compatibleContextWorkspace(w,p,plan.ownerId)&&w.metadata.superAgentProject.contextSetupOperationId===plan.operationId);
   if(found.length!==1)fail('CONTEXT_CONFIG_WORKSPACE_RECONCILIATION_REQUIRED');workspace=found[0];
  }else{
   const found=workspaces.filter(w=>compatibleContextWorkspace(w,p,plan.ownerId));
   if(found.length>1)fail('CONTEXT_CONFIG_WORKSPACE_AMBIGUOUS');
   if(found.length)workspace=found[0];
   else{
    if(!workspaces.length)fail('CONTEXT_CONFIG_NONPRIMARY_UNAVAILABLE');
    const check=await native.executionState();if(check.active?.length||check.environmentLeases?.length||exists(root+'/call.lock'))fail('CONTEXT_CONFIG_EXECUTION_BUSY');
    intent.workspaces[p.projectId]={attempted:true};writeControl(intentFile,intent);
    try{workspace=await native.createWorkspace(p.projectId,{name:entry.workspace.name,cwd:p.workspaceCwd,sourceType:'non_git_path',isPrimary:false,
      metadata:{superAgentProject:{...entry.workspace.metadata.superAgentProject,contextSetupOperationId:plan.operationId}}});}
    catch{await log({code:'CONTEXT_CONFIG_WORKSPACE_UNKNOWN',operationId:plan.operationId,projectId:p.projectId});fail('CONTEXT_CONFIG_WORKSPACE_RECONCILIATION_REQUIRED');}
    if(!compatibleContextWorkspace(workspace,p,plan.ownerId))fail('CONTEXT_CONFIG_WORKSPACE_CHANGED');
   }
  }
  intent.workspaces[p.projectId]={attempted:true,id:workspace.id};writeControl(intentFile,intent);
  context.catalog.projects.find(value=>value.projectId===p.projectId).projectWorkspaceId=workspace.id;
 }
 for(const file of plan.files){const filename=file.area==='materials'?root+'/materials/'+file.path:root+'/context/legacy/'+file.path;
  const bytes=Buffer.from(file.contentBase64,'base64');if(configurationHash(bytes)!==file.sha256)fail('CONTEXT_CONFIG_PLAN_CHANGED');immutable(filename,bytes);}
 const before=configurationHash(plan.beforeContext),target=configurationHash(context);
 const finalState=await native.executionState();if(finalState.active?.length||finalState.environmentLeases?.length||exists(root+'/call.lock'))fail('CONTEXT_CONFIG_EXECUTION_BUSY');
 intent.status='publishing';intent.appliedContextSha256=target;writeControl(intentFile,intent);
 editRegistry(latest=>{
  roleSourcesMatch(latest,plan);if(latest.team?.enabled!==false)fail('CONTEXT_CONFIG_EXECUTION_BUSY');
  const current=configurationHash(latest.context??null);if(current!==before&&current!==target)fail('CONTEXT_CONFIG_CONTEXT_CHANGED');
  latest.context=context;
  for(const mark of plan.roleUpdates){const entry=latest.agents.find(value=>value.profile.agentId===mark.agentId);entry.manifest={...entry.manifest,scope:'generic'};}
  return latest;
 });
 if(configurationHash(readControl(root+'/registry.json').context)!==target)fail('CONTEXT_CONFIG_PUBLICATION_UNKNOWN');
 intent.status='complete';intent.completedAt=now();writeControl(intentFile,intent);
 await log({code:'CONTEXT_CONFIG_APPLIED',operationId:plan.operationId,configurationHash:plan.configurationHash,projects:plan.projects.length,newModelCalls:0});
 return summary(plan,{mode:'apply',status:'complete',canApply:true});
}

async function bundledSources(registry){
 const {roleInstructions}=await import('../bridge/team-roles.mjs'),{renderRoleCapabilitiesMarkdown}=await import('../bridge/role-capabilities.mjs'),
  {readRoleInstructionBundle}=await import('../bridge/role-instruction-store.mjs');
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),roleBundles={},publicRoles={};
 for(const [role,id]of Object.entries(registry.team.ids)){const entry=registry.agents.find(value=>value.profile.agentId===id);
  roleBundles[role]=readRoleInstructionBundle(entry);publicRoles[role]={instructions:roleInstructions(role),capabilities:renderRoleCapabilitiesMarkdown(role)};}
 const manifestBytes=fs.readFileSync(base+'/assets/product-manager-coach.manifest.json'),manifest=JSON.parse(manifestBytes),files=[];
 for(const file of manifest.files){if(typeof file.path!=='string'||path.posix.normalize(file.path)!==file.path||file.path.includes('..')||path.isAbsolute(file.path))fail('CONTEXT_CONFIG_PM_ASSETS_INVALID');
  const filename=base+'/assets/product-manager-coach/'+file.path,stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('CONTEXT_CONFIG_PM_ASSETS_INVALID');
  const bytes=fs.readFileSync(filename);if(configurationHash(bytes)!==file.sha256)fail('CONTEXT_CONFIG_PM_ASSETS_INVALID');files.push({...file,contentBase64:bytes.toString('base64')});}
 const legacyBytes=fs.readFileSync(ROLE_ROOT+'/knowledge.json'),legacy=JSON.parse(legacyBytes);
 return {roleBundles,publicRoles,pmAssets:{manifestSha256:configurationHash(manifestBytes),files},legacyKnowledge:{records:legacy.records,sha256:configurationHash(legacyBytes)}};
}

async function main(){
 if(process.platform!=='linux'||process.getuid()!==0)fail('CONTEXT_CONFIG_DOCKER_REQUIRED');
 const args=parseContextConfigureArgs(process.argv.slice(2)),request=readControl(args.requestPath),registry=readControl(ROLE_ROOT+'/registry.json'),P='/opt/paperclip/node_modules';
 const password=fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim(),url='postgres://paperclip:'+encodeURIComponent(password)+'@db:5432/paperclip';
 const s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js'),db=s.createDb(url,{maxConnections:2}),
  {projectService}=await import(P+'/@paperclipai/server/dist/services/projects.js'),projects=projectService(db);
 try{
  const native={readProjects:ids=>Promise.all(ids.map(id=>projects.getById(id))),readAgents:companyId=>db.select().from(s.agents).where(o.eq(s.agents.companyId,companyId)),
   executionState:async()=>({active:await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry'])),
    environmentLeases:(await db.select().from(s.environmentLeases)).filter(lease=>!lease.releasedAt||lease.status==='pending_cleanup'||lease.cleanupStatus==='failed')}),
   createWorkspace:(id,input)=>projects.createWorkspace(id,input)};
  const result=await configureContext({request,native,source:bundledSources,apply:args.apply,log:event=>console.log(JSON.stringify({component:'context-configure',...event}))});
  console.log(JSON.stringify(result));
 }finally{await s.closeRegisteredClients(url);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
 console.error(JSON.stringify({component:'context-configure',code:/^CONTEXT_CONFIG_[A-Z_]+$/.test(error.code??'')?error.code:'CONTEXT_CONFIG_FAILED'}));process.exitCode=1;
});
