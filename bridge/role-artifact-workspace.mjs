import fs from 'node:fs';
import {readControl,ROLE_ROOT} from './role-control-store.mjs';
import {isMacNative} from './role-execution-policy.mjs';
import {taskInputRevision} from './task-input.mjs';

const audit=event=>fs.appendFileSync(ROLE_ROOT+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
const currentRunIds=task=>[...new Set([task?.executionRunId,task?.checkoutRunId].filter(Boolean))];

/** Only the missing-.git condition uses this exception; Native retains every other check. */
export function isRoleArtifactWorkspace({input,registry:r,task,run,agent,project,workspace,persistedWorkspace,rootTask,wakeup}={}){
 if(!input||!r||r.enabled!==true||r.team?.enabled!==true||input.adapterType!=='codex_local'||
  (input.executionTarget?.kind??'local')!=='local'||(input.environmentDriver??'local')!=='local'||
  !agent||agent.id!==input.agentId||agent.companyId!==r.companyId||agent.adapterType!=='codex_local'||
  agent.adapterConfig?.env?.SUPER_AGENT_ROLE_ENABLED!=='true')return false;
 const roles=(r.agents??[]).filter(entry=>entry.profile?.agentId===agent.id),role=roles[0]?.profile;
 if(roles.length!==1||r.team.ids?.[role?.role]!==agent.id)return false;
 try{if(!isMacNative(role))return false;}catch{return false;}
 if(!task||task.id!==input.issue?.id||task.companyId!==r.companyId||task.projectId!==input.issue.projectId||
  task.responsibleUserId!==r.ownerId||task.assigneeAgentId!==agent.id||task.assigneeUserId||
  !['todo','in_progress'].includes(task.status)||!run||run.status!=='running'||run.finishedAt||
  run.agentId!==agent.id||run.companyId!==r.companyId||run.responsibleUserId!==r.ownerId||run.issueId!==task.id||
  currentRunIds(task).length!==1||currentRunIds(task)[0]!==run.id)return false;
 const context=run.contextSnapshot??{},revision=taskInputRevision(task);
 if(context.issueId!==task.id||context.taskId!==undefined&&context.taskId!==task.id||
  context.projectId!==undefined&&context.projectId!==task.projectId||
  context.inputRevision!==undefined&&context.inputRevision!==revision||
  context.taskGoal!==undefined&&context.taskGoal!==(task.description??''))return false;
 if(!project||project.id!==task.projectId||project.companyId!==r.companyId||
  [project.personalOwnerUserId,project.privacyOwnerUserId].some(owner=>owner!=null&&owner!==r.ownerId))return false;
 const workspaceId=task.projectWorkspaceId??input.resolvedWorkspace?.workspaceId,
  cwd=`/paperclip/instances/default/projects/${r.companyId}/${task.projectId}/_default`,meta=workspace?.metadata?.superAgentProject;
 if(!workspaceId||input.issue.projectWorkspaceId!==(task.projectWorkspaceId??null)||
  !workspace||workspace.id!==workspaceId||workspace.companyId!==r.companyId||workspace.projectId!==task.projectId||
  workspace.sourceType!=='non_git_path'||workspace.cwd!==cwd||meta?.ownerId!==r.ownerId||
  meta.delivery?.maximumAction!=='artifact'||meta.repository?.hostPath!=null||meta.workspace?.hostPath!=null||
  meta.hostActions?.length||meta.hostMcpServers?.length||
  input.resolvedWorkspace?.workspaceId!==workspaceId||input.resolvedWorkspace.projectId!==task.projectId||input.resolvedWorkspace.cwd!==cwd||
  input.executionWorkspace?.cwd!==cwd||input.executionWorkspace.projectId!==task.projectId||input.executionWorkspace.workspaceId!==workspaceId||
  input.executionWorkspace.strategy==='git_worktree'||!persistedWorkspace||persistedWorkspace.id!==input.persistedExecutionWorkspace?.id||
  task.executionWorkspaceId!==persistedWorkspace.id||persistedWorkspace.companyId!==r.companyId||persistedWorkspace.projectId!==task.projectId||
  persistedWorkspace.projectWorkspaceId!==workspaceId||persistedWorkspace.cwd!==cwd||persistedWorkspace.strategyType==='git_worktree'||
  input.persistedExecutionWorkspace.cwd!==cwd||input.persistedExecutionWorkspace.projectId!==task.projectId||
  input.persistedExecutionWorkspace.projectWorkspaceId!==workspaceId)return false;
 const opId=context.roleOperationId;
 if(opId!==undefined){
  const operations=(r.operations??[]).filter(op=>op.id===opId),op=operations[0];
  if(operations.length!==1||op.kind!=='run'||op.taskId!==task.id||op.agentId!==agent.id||op.role!==role.role||
   op.projectId!==task.projectId||op.inputRevision!==revision||!(r.tasks??[]).includes(task.id)||
   !rootTask||rootTask.id!==(op.rootTaskId??task.id)||rootTask.companyId!==r.companyId||rootTask.projectId!==task.projectId||
   rootTask.responsibleUserId!==r.ownerId||op.rootInputRevision!==undefined&&op.rootInputRevision!==taskInputRevision(rootTask)||
   rootTask.id!==task.id&&(task.parentId!==rootTask.id||r.taskRoots?.[task.id]!==rootTask.id||
    rootTask.status!=='in_review'||rootTask.assigneeUserId!==r.ownerId||rootTask.assigneeAgentId)||
   op.workspaceCwd!==undefined&&op.workspaceCwd!==cwd||op.projectWorkspaceId!==undefined&&op.projectWorkspaceId!==workspaceId)return false;
  if(op.contextVersion===1){
   const selected=r.context?.enabled===true&&r.context.catalog?.projects?.find(p=>p.projectId===task.projectId);
   if(!selected||selected.companyId!==r.companyId||selected.ownerId!==r.ownerId||selected.maximumAction!=='read_only'||
    selected.projectWorkspaceId!==workspaceId||selected.workspaceCwd!==cwd||selected.key!==op.projectKey||
    !selected.allowedRoles?.includes(role.role))return false;
  }
  return true;
 }
 // Initial Chief admission happens after this Native guard. Only its actual owner wake
 // may reach that admission; prose or an unregistered child cannot supply authority.
 return role.role==='chief'&&!task.parentId&&task.createdByUserId===r.ownerId&&
  !(r.operations??[]).some(op=>op.kind==='run'&&op.taskId===task.id)&&
  wakeup?.id===run.wakeupRequestId&&wakeup.runId===run.id&&wakeup.companyId===r.companyId&&wakeup.agentId===agent.id&&
  wakeup.requestedByActorType==='user'&&wakeup.requestedByActorId===r.ownerId&&wakeup.payload?.issueId===task.id;
}

/** Fresh, read-only Native rows and deployment registry; no task/run/queue changes. */
export async function allowRoleArtifactWorkspace(input,{readRegistry=()=>readControl(ROLE_ROOT+'/registry.json'),
 database=async()=> (await import('./native-role-runtime.mjs')).database(),log=audit}={}){
 if(input?.adapterType!=='codex_local'||!input.issue?.id)return false;
 try{
  const registry=readRegistry();
  if(registry.enabled!==true||!registry.agents?.some(entry=>entry.profile?.agentId===input.agentId))return false;
  const {db,schema:s,orm:o}=await database();
  const [task]=await db.select().from(s.issues).where(o.eq(s.issues.id,input.issue.id));
  const ids=currentRunIds(task);if(ids.length!==1)return false;
  const [[run],[agent],[project],[workspace],[persistedWorkspace]]=await Promise.all([
   db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ids[0])),
   db.select().from(s.agents).where(o.eq(s.agents.id,input.agentId)),
   db.select().from(s.projects).where(o.eq(s.projects.id,task.projectId)),
   db.select().from(s.projectWorkspaces).where(o.eq(s.projectWorkspaces.id,task.projectWorkspaceId??input.resolvedWorkspace?.workspaceId)),
   db.select().from(s.executionWorkspaces).where(o.eq(s.executionWorkspaces.id,task.executionWorkspaceId)),
  ]);
  const op=registry.operations?.find(value=>value.id===run?.contextSnapshot?.roleOperationId),rootId=op?.rootTaskId??task.id;
  const rootTask=rootId===task.id?task:(await db.select().from(s.issues).where(o.eq(s.issues.id,rootId)))[0];
  const wakeup=run?.contextSnapshot?.roleOperationId===undefined&&run?.wakeupRequestId?
   (await db.select().from(s.agentWakeupRequests).where(o.eq(s.agentWakeupRequests.id,run.wakeupRequestId)))[0]:undefined;
  const allowed=isRoleArtifactWorkspace({input,registry,task,run,agent,project,workspace,persistedWorkspace,rootTask,wakeup});
  log({code:allowed?'ROLE_ARTIFACT_WORKSPACE_BOUND':'ROLE_ARTIFACT_WORKSPACE_DENIED',taskId:task.id,runId:run?.id});
  return allowed;
 }catch{
  log({code:'ROLE_ARTIFACT_WORKSPACE_LOOKUP_FAILED',taskId:input.issue.id});
  throw Object.assign(Error('ROLE_ARTIFACT_WORKSPACE_LOOKUP_FAILED'),{code:'ROLE_ARTIFACT_WORKSPACE_LOOKUP_FAILED'});
 }
}
