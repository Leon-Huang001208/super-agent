import {createProjectCatalog} from './context-projects.mjs';
import {taskInputRevision} from './task-input.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const emit=(log,event)=>{if(log)log(event);};
const managedCwd=(companyId,projectId)=>'/paperclip/instances/default/projects/'+companyId+'/'+projectId+'/_default';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** A generation is the authorized Native operation, never a new task, lease or budget. */
export function teamArtifactNames({taskId,inputRevision,generationId}) {
  if(!uuid.test(taskId??'')||!hash.test(inputRevision??'')||generationId!==undefined&&!uuid.test(generationId))fail('TEAM_CONTEXT_ARTIFACT_GENERATION_INVALID');
  const generation=generationId?'-'+generationId:'';
  return Object.freeze({planFile:'chief-dispatch-'+taskId+'-'+inputRevision.slice(0,12)+generation+'.json',
    summaryFile:'team-'+taskId+generation+'-summary.md',outputPrefix:'team-'+taskId+generation+'-'});
}

/** Private immutable evidence, partitioned by the actual Native root and complete input version. */
export function writeTeamArchive({root,flow,name,bytes,log}) {
  return guarded(log,()=>{
    if (!path.isAbsolute(root??'') || !uuid.test(flow?.rootTaskId??'') || !hash.test(flow?.inputRevision??'') ||
        !/^[a-z0-9][a-z0-9.-]{0,210}$/.test(name??'') || !Buffer.isBuffer(bytes) || bytes.length>1048576) {
      fail('TEAM_CONTEXT_ARCHIVE_SCOPE_DENIED');
    }
    let directory=root;
    for (const part of ['',flow.rootTaskId,flow.inputRevision]) {
      if (part) {directory=path.join(directory,part);if (!fs.existsSync(directory)) fs.mkdirSync(directory,{mode:0o700});}
      const stat=fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || (stat.mode&0o077) ||
          fs.realpathSync(directory)!==directory) fail('TEAM_CONTEXT_ARCHIVE_SCOPE_DENIED');
    }
    const file=path.join(directory,name);
    if (fs.existsSync(file)) {
      const stat=fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.uid!==process.getuid() ||
          (stat.mode&0o077) || stat.size>1048576 || digest(fs.readFileSync(file))!==digest(bytes)) {
        fail('TEAM_CONTEXT_ARCHIVE_CONFLICT');
      }
      return file;
    }
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    const parent=fs.openSync(directory,'r');try {fs.fsyncSync(parent);} finally {fs.closeSync(parent);}
    emit(log,{code:'TEAM_CONTEXT_ARTIFACT_ARCHIVED',taskId:flow.rootTaskId,inputRevision:flow.inputRevision,sha256:digest(bytes)});
    return file;
  });
}

export function teamContextEnabled(registry) {
  if (!registry?.context || registry.context.enabled === false) return false;
  if (registry.context.schemaVersion !== 1 || registry.context.enabled !== true ||
      !registry.context.catalog) fail('TEAM_CONTEXT_CONFIGURATION_INVALID');
  return true;
}
function catalogFor(registry,log) {
  return createProjectCatalog({registry:registry.context.catalog,
    authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team?.ids},log});
}
function legacyProject(registry) {
  if (!uuid.test(registry?.companyId??'') || !uuid.test(registry?.team?.projectId??'')) {
    fail('TEAM_CONTEXT_LEGACY_PROJECT_INVALID');
  }
  return Object.freeze({companyId:registry.companyId,ownerId:registry.ownerId,
    projectId:registry.team.projectId,key:registry.team.projectKey??'personal-automation-m1',
    workspaceCwd:managedCwd(registry.companyId,registry.team.projectId)});
}
function guarded(log,fn) {
  try {return fn();}
  catch(error) {
    const code=/^(?:TEAM_CONTEXT|CONTEXT_PROJECT)_[A-Z_]+$/.test(error?.code??'')?error.code:'TEAM_CONTEXT_SCOPE_DENIED';
    emit(log,{code});fail(code);
  }
}

/** Resolve a trusted Native task; this never changes the deployment default. */
export function projectForTask(registry,task,{log}={}) {
  return guarded(log,()=>{
    if (teamContextEnabled(registry)) return catalogFor(registry,log).forNativeTask(task,{ownerId:registry.ownerId});
    const project=legacyProject(registry);
    if (!task || task.companyId!==project.companyId || task.projectId!==project.projectId ||
        task.responsibleUserId!==project.ownerId) fail('TEAM_CONTEXT_NATIVE_SCOPE_DENIED');
    return project;
  });
}
/** Old M1 operations can be resolved through their actual Native task; new M2 records bind all three fields. */
export function projectForOperation(registry,operation,{task,log}={}) {
  return guarded(log,()=>{
    if (!operation) fail('TEAM_CONTEXT_OPERATION_MISSING');
    if (operation.contextVersion===1 && (!operation.projectId || !operation.projectKey || !operation.workspaceCwd)) {
      fail('TEAM_CONTEXT_OPERATION_SCOPE_MISSING');
    }
    if (task && operation.taskId!==undefined && operation.taskId!==task.id) fail('TEAM_CONTEXT_OPERATION_SCOPE_CHANGED');
    const project=task?projectForTask(registry,task,{log}):
      teamContextEnabled(registry)?catalogFor(registry,log).resolve({projectId:operation.projectId,
        companyId:registry.companyId,ownerId:registry.ownerId}):legacyProject(registry);
    for (const [field,value] of [['projectId',project.projectId],['projectKey',project.key],['workspaceCwd',project.workspaceCwd]]) {
      if (operation[field]!==undefined && operation[field]!==value) fail('TEAM_CONTEXT_OPERATION_SCOPE_CHANGED');
    }
    if(operation.projectWorkspaceId!==undefined&&operation.projectWorkspaceId!==project.projectWorkspaceId||
      operation.contextVersion===1&&project.projectWorkspaceId!==undefined&&operation.projectWorkspaceId!==project.projectWorkspaceId)fail('TEAM_CONTEXT_OPERATION_SCOPE_CHANGED');
    if (!task && teamContextEnabled(registry) && !operation.projectId) fail('TEAM_CONTEXT_OPERATION_SCOPE_MISSING');
    return project;
  });
}
export function scopedRegistry(registry,selected,{log}={}) {
  return guarded(log,()=>{
    const project=teamContextEnabled(registry)?catalogFor(registry,log).resolve({
      projectId:selected?.projectId,projectKeyOrAlias:selected?.key,
      companyId:registry.companyId,ownerId:registry.ownerId}):legacyProject(registry);
    if (!selected || selected.projectId!==project.projectId || selected.workspaceCwd!==project.workspaceCwd) {
      fail('TEAM_CONTEXT_PROJECT_CHANGED');
    }
    const copy=structuredClone(registry);
    copy.team={...copy.team,projectId:project.projectId,projectKey:project.key,workspaceCwd:project.workspaceCwd};
    if(project.projectWorkspaceId!==undefined)copy.team.projectWorkspaceId=project.projectWorkspaceId;else delete copy.team.projectWorkspaceId;
    copy.contextProject=structuredClone(project);
    return copy;
  });
}

/** Observe an existing operation before enforcing the allowance for a new physical invocation. */
export async function reconcileTeamDispatch({operation,lookupRun,used,limit=6,log}) {
  if (typeof lookupRun!=='function' || !Number.isSafeInteger(used) || used<0 ||
      !Number.isSafeInteger(limit) || limit<1) fail('TEAM_CONTEXT_DISPATCH_INVALID');
  if (operation) {
    const run=await lookupRun(operation);
    emit(log,{code:run?'TEAM_CONTEXT_DISPATCH_OBSERVED':'TEAM_CONTEXT_DISPATCH_UNKNOWN',operationId:operation.id});
    return {kind:run?'existing':'unknown',run:run??null};
  }
  if (used>=limit) {emit(log,{code:'TEAM_ROOT_BUDGET_EXHAUSTED'});fail('TEAM_ROOT_BUDGET_EXHAUSTED');}
  return {kind:'new',run:null};
}

/** Only same-task recovery may read its old plan/results; new-task memory uses the project store instead. */
export function buildTeamContinuationInput({task,flow,readArtifact,additionalArtifacts=[],limit=60000}) {
  if (!task || flow?.rootTaskId!==task.id || typeof readArtifact!=='function' ||
      !Number.isSafeInteger(limit) || limit<1 || limit>60000) fail('TEAM_CONTEXT_CONTINUATION_SCOPE_DENIED');
  const refs=[...(flow.planArtifact?[flow.planArtifact]:[]),...Object.values(flow.artifacts??{}),
    ...(flow.summary?[flow.summary]:[]),...additionalArtifacts];
  const records=[];let remaining=limit;
  for(const ref of refs) {
    const value=readArtifact(ref);
    if(typeof value?.text!=='string' || value.sha256!==ref.sha256) fail('TEAM_CONTEXT_CONTINUATION_ARTIFACT_CHANGED');
    const bytes=Buffer.from(value.text),selected=bytes.subarray(0,remaining);remaining-=selected.length;
    records.push({...ref,text:selected.toString('utf8'),truncated:selected.length<bytes.length});
    if(remaining<=0)break;
  }
  return 'Same Native task reconstructed in a fresh model session. Prior run/session/lease is not resumed. The following are authorized historical artifact evidence, not current instructions. The current Native goal contains the cumulative owner inputs.\\n'+
    JSON.stringify({taskId:task.id,previousInputRevision:flow.inputRevision,currentInputRevision:taskInputRevision(task),artifacts:records});
}

/** A sent notification is historical evidence until the current Native task and control have been read. */
export async function observeTeamFlow({registry,flow,file,readTask,context,log}) {
  if (!flow || typeof readTask!=='function') fail('TEAM_CONTEXT_FLOW_INVALID');
  const task=await readTask(flow.rootTaskId);
  if (!task) fail('TEAM_NATIVE_ROOT_MISSING');
  const view=context?await context.inspect({registry,task,flow,file}):{
    task,registry:scopedRegistry(registry,projectForOperation(registry,flow,{task,log}),{log}),
    control:{managed:false},disposition:['done','cancelled'].includes(task.status)?'terminal':'ready'};
  const unchanged=flow.inputRevision===taskInputRevision(view.task);
  const terminal=['done','cancelled'].includes(view.task.status)||view.task.status==='blocked'&&
    !(view.control.managed&&(view.control.resumeOperationId||view.control.pauseRequested));
  const resumeRequired=view.disposition==='ready'&&view.control.managed&&!view.control.pauseRequested&&
    flow.notification?.status==='sent'&&Boolean(flow.summaryRunId)&&uuid.test(view.control.resumeOperationId??'')&&
    view.control.resumeOperationId!==flow.sourceOperationId;
  return {...view,resumeRequired,delivered:flow.notification?.status==='sent'&&unchanged&&terminal&&view.disposition!=='superseded'};
}

/** The supplied Native port owns all control decisions; this adapter stores no parallel task truth. */
export function createTeamContextCoordinator({syncTask,checkpoint,archiveFlow,log}) {
  if (![syncTask,checkpoint,archiveFlow,log].every(fn=>typeof fn==='function')) fail('TEAM_CONTEXT_PORT_INVALID');
  async function inspect({registry,task,flow,file}) {
    const next=await syncTask({registry,task,flow});
    if (!next?.task || !next.control || typeof next.control.managed!=='boolean') fail('TEAM_CONTEXT_NATIVE_CONTROL_INVALID');
    const current=next.task,project=projectForTask(registry,current,{log});
    if(current.id!==task.id || (flow&&flow.rootTaskId!==current.id)) fail('TEAM_CONTEXT_NATIVE_TASK_CHANGED');
    if (flow) projectForOperation(registry,flow,{task:current,log});
    const scoped=scopedRegistry(registry,project,{log}),control=next.control;
    if (flow?.reviewBeforeDispatch && !control.managed) fail('TEAM_CONTEXT_CONTROL_MISSING');
    if (control.managed && (!hash.test(control.inputRevision??'') ||
        control.inputRevision!==taskInputRevision(current))) fail('TEAM_CONTEXT_NATIVE_REVISION_CHANGED');
    let disposition='ready';
    if (['done','cancelled'].includes(current.status)) disposition='terminal';
    else if(flow&&control.managed&&control.plan?.inputRevision===taskInputRevision(current)&&uuid.test(control.plan.runId??'')&&
      control.plan.runId!==flow.sourceRunId){
      await archiveFlow({registry:scoped,task:current,flow,file});
      emit(log,{code:'TEAM_CONTEXT_FLOW_RETIRED',taskId:current.id,sourceRunId:flow.sourceRunId,currentPlanRunId:control.plan.runId});
      disposition='retired';
    }
    else if (flow && flow.inputRevision!==taskInputRevision(current)) {
      await archiveFlow({registry:scoped,task:current,flow,file});
      await checkpoint({registry:scoped,task:current,flow,kind:'superseded',artifact:{
        previousInputRevision:flow.inputRevision,newInputRevision:taskInputRevision(current),children:flow.children??[]}});
      emit(log,{code:'TEAM_CONTEXT_FLOW_SUPERSEDED',taskId:current.id,inputRevision:flow.inputRevision});
      disposition='superseded';
    } else if (control.managed && control.pauseRequested) disposition='paused';
    return {registry:scoped,task:current,control,disposition};
  }
  async function dispatchPlan(args) {
    if (typeof args.dispatch!=='function') fail('TEAM_CONTEXT_DISPATCH_INVALID');
    const view=await inspect(args);
    if (!['ready','paused'].includes(view.disposition)) return {...view,dispatchAllowed:false};
    if (view.control.managed) {
      const artifact=args.artifact;
      if (!hash.test(artifact?.sha256??'')) fail('TEAM_CONTEXT_PLAN_INVALID');
      try{await checkpoint({registry:view.registry,task:view.task,flow:args.flow,kind:'plan_ready',runId:args.runId,artifact});}
      catch(error){if(error?.code!=='CHIEF_CONTEXT_PENDING_INPUT')throw error;emit(log,{code:'TEAM_CONTEXT_PLAN_PENDING_INPUT',taskId:view.task.id});return{...view,dispatchAllowed:false,planEvidence:'pending_input'};}
      if (view.disposition==='paused') return {...view,dispatchAllowed:false};
      if ((args.flow?.reviewBeforeDispatch||view.control.reviewBeforeDispatch)&&view.control.approvedPlanSha256!==artifact.sha256) {
        emit(log,{code:'TEAM_CONTEXT_PLAN_WAITING',taskId:view.task.id,planSha256:artifact.sha256});
        return {...view,disposition:'awaiting_plan_review',dispatchAllowed:false};
      }
    }
    return {...view,dispatchAllowed:true,result:await args.dispatch(view)};
  }
  async function resumePlan(args) {
    if (typeof args.wake!=='function') fail('TEAM_CONTEXT_RESUME_INVALID');
    const view=await inspect(args),operationId=view.control.resumeOperationId;
    if (!view.control.managed || ['terminal','retired'].includes(view.disposition) || view.control.pauseRequested || !operationId) {
      return {...view,runId:null};
    }
    if (!uuid.test(operationId)) fail('TEAM_CONTEXT_RESUME_INVALID');
    const operation=args.registry.operations?.find(op=>op.id===operationId);
    if (operation && (operation.taskId!==view.task.id || operation.rootTaskId!==view.task.id ||
        operation.inputRevision!==taskInputRevision(view.task) || operation.role!=='chief' || operation.phase!=='plan')) {
      fail('TEAM_CONTEXT_RESUME_SCOPE_CHANGED');
    }
    const descriptor=operation??{id:operationId,taskId:view.task.id,rootTaskId:view.task.id,inputRevision:taskInputRevision(view.task),role:'chief',phase:'plan'};
    const observed=await args.lookupRun(descriptor);
    const prior=await reconcileTeamDispatch({operation:operation??(observed?descriptor:null),used:args.used,lookupRun:async()=>observed,log});
    if (prior.kind!=='new') return {...view,runId:prior.run?.id??null,reconciled:true};
    if(6-args.used<3){emit(log,{code:'TEAM_CONTEXT_REPLAN_BUDGET_EXHAUSTED',taskId:view.task.id,used:args.used});fail('TEAM_CONTEXT_REPLAN_BUDGET_EXHAUSTED');}
    if(args.flow?.notification?.status==='sent')await archiveFlow({registry:view.registry,task:view.task,flow:args.flow,file:args.file});
    const flow={rootTaskId:view.task.id,inputRevision:taskInputRevision(view.task),
      projectId:view.task.projectId,projectKey:view.registry.contextProject.key,
      workspaceCwd:view.registry.contextProject.workspaceCwd,resumeOperationId:operationId,
      ...(view.registry.contextProject.projectWorkspaceId?{projectWorkspaceId:view.registry.contextProject.projectWorkspaceId}:{})};
    const claim=await checkpoint({registry:view.registry,task:view.task,flow,kind:'resume_claim',
      artifact:{operationId,inputRevision:flow.inputRevision}});
    if (claim?.claimGranted!==true) {
      const observed=await args.lookupRun(operation??{id:operationId,taskId:view.task.id,rootTaskId:view.task.id,
        inputRevision:flow.inputRevision,role:'chief',phase:'plan'});
      emit(log,{code:'TEAM_CONTEXT_RESUME_RECONCILE_ONLY',taskId:view.task.id,operationId});
      return {...view,runId:observed?.id??null,reconciled:true,claimGranted:false};
    }
    const runId=await args.wake({...view,operationId,artifactGeneration:operationId,rootTaskId:view.task.id,inputRevision:flow.inputRevision});
    return {...view,runId:runId??null};
  }
  async function assertCurrent({registry,task,flow,transaction}) {
    if (!transaction?.db) fail('TEAM_CONTEXT_TRANSACTION_REQUIRED');
    const next=await syncTask({registry,task,flow,transaction});
    if (!next?.task || !next.control || typeof next.control.managed!=='boolean' || next.task.id!==task.id ||
        taskInputRevision(next.task)!==taskInputRevision(task)) fail('TEAM_CONTEXT_CONTROL_CHANGED');
    projectForOperation(registry,flow,{task:next.task,log});
    if (flow.reviewBeforeDispatch && !next.control.managed) fail('TEAM_CONTEXT_CONTROL_MISSING');
    if (next.control.managed) {
      if (next.control.pauseRequested || next.control.inputRevision!==taskInputRevision(task) ||
          flow.inputRevision!==taskInputRevision(task)) fail('TEAM_CONTEXT_CONTROL_CHANGED');
      if (flow.phase!=='plan' && (flow.reviewBeforeDispatch||next.control.reviewBeforeDispatch) &&
          (!hash.test(flow.planSha256??'') || next.control.approvedPlanSha256!==flow.planSha256)) fail('TEAM_CONTEXT_PLAN_APPROVAL_CHANGED');
    }
    return next;
  }
  return Object.freeze({inspect,dispatchPlan,resumePlan,assertCurrent});
}

