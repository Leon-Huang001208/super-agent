import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resolveRoleProjectContext} from './role-project-context.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const uuid=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value??'');
const hash=value=>/^[a-f0-9]{64}$/.test(value??'');
const absolute=value=>typeof value==='string'&&path.posix.isAbsolute(value)&&path.posix.normalize(value)===value;
export const registrationHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const RWB_REPOSITORY='Leon-Huang001208/ResearchWorkbench';
export const RWB_EXECUTION_POLICY=Object.freeze({enabled:true,defaultMode:'shared_workspace',sharedWorkspaceConcurrency:'serialize',allowIssueOverride:false,workspaceStrategy:{type:'project_primary'}});

export function developmentProjectFingerprint(project){
 return registrationHash({id:project?.id,companyId:project?.companyId,executionWorkspacePolicy:project?.executionWorkspacePolicy??null,
  workspaces:(project?.workspaces??[]).map(({id,name,cwd,sourceType,isPrimary,repoUrl,metadata})=>({id,name,cwd,sourceType,isPrimary,repoUrl,metadata})).sort((a,b)=>a.id.localeCompare(b.id))});
}

/** Build only the existing RWB GitSafety entrypoints. No generic Git delivery fallback. */
export function rwbDevelopmentMetadata(request,{ownerId}){
 if(!absolute(request.repositoryHostPath)||!absolute(request.worktreeRoot)||!request.worktreeRoot.startsWith('/Volumes/WorkDisk/Projects/ResearchWorkbench/')||
  !absolute(request.nodeBinary)||!Array.isArray(request.rules)||!request.rules.some(rule=>rule.path==='AGENTS.md')||!Array.isArray(request.checks)||!request.checks.length||
  !['pull_request','merge'].includes(request.maximumAction??'merge'))fail('RWB_DEVELOPMENT_REQUEST_INVALID');
 const maximumAction=request.maximumAction??'merge',entry=request.repositoryHostPath+'/scripts/git_safety.mjs';
 const command=action=>[request.nodeBinary,entry,'delivery','--project',request.repositoryHostPath,'--task-id','{rootTaskId}',action];
 const meta={key:'rwb',ownerId,repository:{url:'https://github.com/'+RWB_REPOSITORY,fullName:RWB_REPOSITORY,hostPath:request.repositoryHostPath},
  workspace:{worktreeRoot:request.worktreeRoot,prepare:{argv:[...command('--start'),'--slug','paperclip-work','--worktree-root',request.worktreeRoot]}},
  rules:structuredClone(request.rules),checks:structuredClone(request.checks),
  delivery:{maximumAction,prepareCandidate:{argv:[...command('--prepare'),'--worktree-root',request.worktreeRoot]},commands:{
   pull_request:{argv:[...command('--publish'),'--verification-command','{verificationCommand}','--verification-status','passed','--verification-duration-seconds','{verificationDurationSeconds}']},
   ...(maximumAction==='merge'?{merge:{argv:[...command('--status'),'--reviewed-commit','{candidateSha}']}}:{})}},
  hostMcpServers:structuredClone(request.hostMcpServers??[]),hostActions:[],stack:structuredClone(request.stack??['python','javascript']),domains:structuredClone(request.domains??[])};
 return meta;
}

export function planRwbDevelopmentRegistration({request,registry,project}){
 if(request?.schemaVersion!==1||!uuid(request.operationId)||!uuid(request.projectId)||typeof request.approvalSource!=='string'||!request.approvalSource.trim()||
  project?.id!==request.projectId||project.companyId!==registry?.companyId||!registry.ownerId||!Array.isArray(project.workspaces)||
  request.expectedContextSha256!==undefined&&!hash(request.expectedContextSha256)||request.expectedProjectSha256!==undefined&&!hash(request.expectedProjectSha256))fail('RWB_DEVELOPMENT_REQUEST_INVALID');
 const catalog=registry.context?.catalog,entry=catalog?.projects?.find(value=>value.projectId===project.id);
 if(registry.context?.enabled!==true||!entry||entry.key!=='rwb'||entry.ownerId!==registry.ownerId||entry.companyId!==registry.companyId)fail('RWB_DEVELOPMENT_PROJECT_DENIED');
 const contextSha256=registrationHash(registry.context),projectSha256=developmentProjectFingerprint(project);
 if(request.expectedContextSha256!==undefined&&request.expectedContextSha256!==contextSha256||request.expectedProjectSha256!==undefined&&request.expectedProjectSha256!==projectSha256)fail('RWB_DEVELOPMENT_STATE_CHANGED');
 const metadata=rwbDevelopmentMetadata(request,{ownerId:registry.ownerId});
 metadata.developmentRegistrationOperationId=request.operationId;
 const workspace={name:'RWB managed development',cwd:'/registered-projects/rwb',sourceType:'local_path',repoUrl:metadata.repository.url,isPrimary:true,metadata:{superAgentProject:metadata}};
 // Reuse the same context validator as actual role preflight, including rule hashes and check schemas.
 resolveRoleProjectContext({companyId:registry.companyId,ownerId:registry.ownerId,project,workspace:{...workspace,id:request.operationId,projectId:project.id},rootTaskId:request.operationId});
 return {schemaVersion:1,operationId:request.operationId,projectId:project.id,companyId:registry.companyId,ownerId:registry.ownerId,
  approvalSource:request.approvalSource,contextSha256,projectSha256,workspace,executionWorkspacePolicy:structuredClone(RWB_EXECUTION_POLICY)};
}

export function registeredDevelopmentWorkspace(workspace,plan){
 return Boolean(workspace?.id&&workspace.projectId===plan.projectId&&workspace.name===plan.workspace.name&&workspace.cwd===plan.workspace.cwd&&
  workspace.sourceType===plan.workspace.sourceType&&workspace.repoUrl===plan.workspace.repoUrl&&workspace.isPrimary===true&&isDeepStrictEqual(workspace.metadata?.superAgentProject,plan.workspace.metadata.superAgentProject));
}

export function registeredDevelopmentPolicy(value,plan){
 const selected={enabled:value?.enabled,defaultMode:value?.defaultMode,sharedWorkspaceConcurrency:value?.sharedWorkspaceConcurrency,
  allowIssueOverride:value?.allowIssueOverride,workspaceStrategy:{type:value?.workspaceStrategy?.type}};
 return isDeepStrictEqual(selected,plan.executionWorkspacePolicy);
}

export function registeredDevelopmentContext(context,plan,workspaceId){
 if(!uuid(workspaceId)||registrationHash(context)!==plan.contextSha256)fail('RWB_DEVELOPMENT_CONTEXT_CHANGED');
 const next=structuredClone(context),entry=next.catalog.projects.find(value=>value.projectId===plan.projectId);
 if(!entry||entry.key!=='rwb'||entry.ownerId!==plan.ownerId||entry.companyId!==plan.companyId)fail('RWB_DEVELOPMENT_PROJECT_DENIED');
 entry.maximumAction=plan.workspace.metadata.superAgentProject.delivery.maximumAction;
 entry.projectWorkspaceId=workspaceId;
 return next;
}
