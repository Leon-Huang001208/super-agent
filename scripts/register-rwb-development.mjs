/** Owner setup only: Native workspace registration and catalog CAS; no task or model creation. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {ROLE_ROOT as R,readControl,writeControl,editRoleRegistry} from '../bridge/role-control-store.mjs';
import {planRwbDevelopmentRegistration,registeredDevelopmentWorkspace,registeredDevelopmentPolicy,registeredDevelopmentContext,registrationHash} from '../bridge/rwb-development-registration.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';
import {database} from '../bridge/native-role-runtime.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const exists=file=>fs.existsSync(file);
export function rwbDevelopmentArgs(args){
 const result={apply:false};
 for(let index=0;index<args.length;index++){
  if(args[index]==='--apply'&&!result.apply)result.apply=true;
  else if(args[index]==='--request'&&!result.requestPath&&args[index+1])result.requestPath=args[++index];
  else fail('RWB_DEVELOPMENT_ARGUMENTS_INVALID');
 }
 if(!path.isAbsolute(result.requestPath??''))fail('RWB_DEVELOPMENT_ARGUMENTS_INVALID');return result;
}

export async function registerRwbDevelopment({root=R,request,apply=false,native,editRegistry=editRoleRegistry,log=()=>{}}){
 const registry=readControl(root+'/registry.json'),intentFile=root+'/team/project-registration/'+request.operationId+'.json';
 let intent=exists(intentFile)?readControl(intentFile):null;
 if(intent&&(intent.requestSha256!==registrationHash(request)||intent.plan.ownerId!==registry.ownerId||intent.plan.companyId!==registry.companyId))fail('RWB_DEVELOPMENT_OPERATION_CHANGED');
 const project=await native.readProject(request.projectId);
 const plan=intent?.plan??planRwbDevelopmentRegistration({request,registry,project});
 const state=await native.executionState(),busy=state.activeRuns.length||state.leases.some(value=>!value.releasedAt||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed')||exists(root+'/call.lock');
 const canApply=registry.team?.enabled===false&&!busy;
 if(!apply)return {status:intent?.status??'preview',canApply,operationId:plan.operationId,projectId:plan.projectId,projectSha256:plan.projectSha256,contextSha256:plan.contextSha256,
  workspace:plan.workspace,executionWorkspacePolicy:plan.executionWorkspacePolicy,newModelCalls:0,newTasks:0};
 if(!canApply)fail('RWB_DEVELOPMENT_EXECUTION_BUSY');
 if(!intent){
  if(!request.expectedContextSha256||!request.expectedProjectSha256)fail('RWB_DEVELOPMENT_EXPECTED_STATE_REQUIRED');
  const directory=path.dirname(intentFile);fs.mkdirSync(directory,{recursive:true,mode:0o700});const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))fail('RWB_DEVELOPMENT_PATH_DENIED');
  intent={schemaVersion:1,status:'prepared',requestSha256:registrationHash(request),plan,beforeContext:structuredClone(registry.context),beforeProject:structuredClone(project)};writeControl(intentFile,intent);
 }
 if(intent.status==='complete'){
  if(!isDeepStrictEqual(registry.context,intent.afterContext)||!registeredDevelopmentWorkspace(project?.workspaces?.find(value=>value.id===intent.workspaceId),plan)||!registeredDevelopmentPolicy(project.executionWorkspacePolicy,plan))fail('RWB_DEVELOPMENT_APPLIED_STATE_CHANGED');
  return {status:'reused',operationId:plan.operationId,projectId:plan.projectId,projectWorkspaceId:intent.workspaceId,newModelCalls:0,newTasks:0};
 }
 const policyStage=current=>{
  if(registeredDevelopmentPolicy(current.executionWorkspacePolicy,plan))return 'target';
  if(isDeepStrictEqual(current.executionWorkspacePolicy??null,intent.beforeProject.executionWorkspacePolicy??null))return 'before';
  fail('RWB_DEVELOPMENT_STATE_CHANGED');
 };
 // Interrupted setup owns only its original value and its own target, never a later owner policy.
 policyStage(project);
 const matches=(project.workspaces??[]).filter(value=>value.metadata?.superAgentProject?.developmentRegistrationOperationId===plan.operationId);
 if(matches.length>1||matches.some(value=>!registeredDevelopmentWorkspace(value,plan)))fail('RWB_DEVELOPMENT_WORKSPACE_CHANGED');
 let workspace=matches[0];
 if(!workspace){
  if(intent.workspaceAttempted)fail('RWB_DEVELOPMENT_WORKSPACE_UNKNOWN');
  intent.workspaceAttempted=true;writeControl(intentFile,intent);
  try{workspace=await native.createWorkspace(plan.projectId,plan.workspace);}catch{await log({code:'RWB_DEVELOPMENT_WORKSPACE_UNKNOWN',operationId:plan.operationId});fail('RWB_DEVELOPMENT_WORKSPACE_UNKNOWN');}
  if(!registeredDevelopmentWorkspace(workspace,plan))fail('RWB_DEVELOPMENT_WORKSPACE_CHANGED');
 }
 intent.workspaceId=workspace.id;writeControl(intentFile,intent);
 let updated=await native.readProject(plan.projectId);
 if(policyStage(updated)==='before'){
  try{await native.updateProject(plan.projectId,{executionWorkspacePolicy:plan.executionWorkspacePolicy});}catch{fail('RWB_DEVELOPMENT_POLICY_UNKNOWN');}
  updated=await native.readProject(plan.projectId);
 }
 if(!registeredDevelopmentWorkspace(updated?.workspaces?.find(value=>value.id===workspace.id),plan)||!registeredDevelopmentPolicy(updated.executionWorkspacePolicy,plan))fail('RWB_DEVELOPMENT_NATIVE_RESULT_CHANGED');
 const afterContext=registeredDevelopmentContext(intent.beforeContext,plan,workspace.id),fresh=await native.executionState();
 if(fresh.activeRuns.length||fresh.leases.some(value=>!value.releasedAt||['active','pending_cleanup'].includes(value.status)||value.cleanupStatus==='failed')||exists(root+'/call.lock'))fail('RWB_DEVELOPMENT_EXECUTION_BUSY');
 editRegistry(current=>{
  if(current.ownerId!==plan.ownerId||current.companyId!==plan.companyId||current.team?.enabled!==false)fail('RWB_DEVELOPMENT_STATE_CHANGED');
  if(!isDeepStrictEqual(current.context,intent.beforeContext)&&!isDeepStrictEqual(current.context,afterContext))fail('RWB_DEVELOPMENT_CONTEXT_CHANGED');
  return {...current,context:afterContext};
 });
 intent.status='complete';intent.afterContext=afterContext;writeControl(intentFile,intent);
 await log({code:'RWB_DEVELOPMENT_REGISTERED',operationId:plan.operationId,projectId:plan.projectId,projectWorkspaceId:workspace.id,newModelCalls:0,newTasks:0});
 return {status:'applied',operationId:plan.operationId,projectId:plan.projectId,projectWorkspaceId:workspace.id,newModelCalls:0,newTasks:0};
}

async function main(){
 const args=rwbDevelopmentArgs(process.argv.slice(2)),request=readControl(args.requestPath),registry=readControl(R+'/registry.json'),api=await createRoleOwnerApi({registry,requirePaused:args.apply});
 try{
  const {db,schema:s,orm:o}=await database();
  const result=await registerRwbDevelopment({request,apply:args.apply,native:{
   readProject:id=>api.request('/projects/'+id),
   createWorkspace:(id,payload)=>api.request('/projects/'+id+'/workspaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),
   updateProject:(id,payload)=>api.request('/projects/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),
   executionState:async()=>({activeRuns:await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry'])),leases:await db.select().from(s.environmentLeases)})},
   log:event=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600})});
  console.log(JSON.stringify(result));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
 console.error(JSON.stringify({code:/^(?:RWB_DEVELOPMENT|ROLE)_[A-Z_]+$/.test(error?.code??error?.message)?error.code??error.message:'RWB_DEVELOPMENT_FAILED'}));process.exitCode=1;
});
