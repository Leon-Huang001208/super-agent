import path from 'node:path';
import { createHash } from 'node:crypto';
import {resolveRwbReleaseMetadata} from './rwb-release.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// project_workspaces stores metadata JSONB; Native's runtimeConfig is a filtered API projection.
const metadata=workspace=>workspace?.metadata?.superAgentProject??{};
const sourcePath=workspace=>metadata(workspace).repository?.hostPath??null;

/** Keep Native local environment identity, while binding its higher-priority cwd to artifacts. */
export function nativeRoleArtifactTarget(registration,context,target){
 if(target===undefined||target===null)return target;
 const binding=registration.binding,project=registration.projectContext,source=project?.nativeSourceWorkspace;
 const artifactCwd='/paperclip/instances/default/projects/'+binding?.companyId+'/'+binding?.projectId+'/_default';
 const input=context?.paperclipWorkspace,realization=target.workspaceRealization,present=realization!==undefined&&realization!==null;
 const sourceSelected=Boolean(source&&source.id===binding?.projectWorkspaceId&&source.id===project.nativeWorkspaceId&&
  source.projectId===binding?.projectId&&source.sourceType==='local_path'&&project.id===binding.projectId&&
  project.repository?.hostPath&&project.workspace?.hostPath&&project.repository.hostPath!==project.workspace.hostPath&&
  registration.profile?.executionPolicy?.executor==='macos_native'&&input?.workspaceId===source.id&&input?.projectId===source.projectId&&
  input?.source==='project_primary'&&input?.mode==='shared_workspace'&&[source.cwd,artifactCwd].includes(input.cwd));
 const checks={local:target.kind==='local',artifactCwd:registration.contextVersion!==1||registration.workspaceCwd===artifactCwd,
  realization:!present||object(realization)&&['copy','in_place'].includes(realization.mode),
  authoritativeRoot:!present||realization.authoritativeRoot===artifactCwd||sourceSelected&&realization.authoritativeRoot===source.cwd,
  aliases:!present||Array.isArray(realization.pathAliases)&&realization.pathAliases.length===0,
  restorePaths:!present||Array.isArray(realization.outboundRestorePaths)&&realization.outboundRestorePaths.length===0};
 if(!Object.values(checks).every(Boolean))throw Object.assign(new Error('NATIVE_ROLE_WORKSPACE_TARGET_DENIED'),{code:'NATIVE_ROLE_WORKSPACE_TARGET_DENIED',checks});
 return {...target,...(present?{workspaceRealization:{...realization,authoritativeRoot:artifactCwd}}:{})};
}

/** Select only registered Native projects/workspaces. Goal text never becomes configuration. */
export function selectNativeProject({projects,workspaces=[],companyId,selector,currentProjectId,parentProjectId,defaultProjectId}){
 const available=projects.filter(project=>project.companyId===companyId);
 let matches;
 if(selector){
  const value=selector.trim();
  matches=available.filter(project=>[project.id,project.name,...workspaces.filter(w=>w.projectId===project.id&&(w.companyId===undefined||w.companyId===companyId))
   .flatMap(w=>[metadata(w).key,w.repoUrl,metadata(w).repository?.url,metadata(w).repository?.fullName,sourcePath(w)])]
   .some(candidate=>typeof candidate==='string'&&candidate.toLowerCase()===value.toLowerCase()));
 }else{
  const id=currentProjectId??parentProjectId??defaultProjectId;
  matches=available.filter(project=>project.id===id);
 }
 if(!matches.length)fail('ROLE_PROJECT_NOT_FOUND');
 if(matches.length!==1)fail('ROLE_PROJECT_AMBIGUOUS');
 return structuredClone(matches[0]);
}

/** Native workspace metadata is the authority ceiling; no repository discovery or DB writes. */
export function resolveRoleProjectContext({companyId,ownerId,project,workspace,legacyProfile={},task,rootTaskId=task?.id}){
 if(!project||project.companyId!==companyId||!project.id||
  (workspace&&((workspace.companyId!==undefined&&workspace.companyId!==companyId)||workspace.projectId!==project.id)))fail('ROLE_PROJECT_BINDING_DENIED');
 const entry=structuredClone(metadata(workspace));
 if(!object(entry)||(entry.ownerId!==undefined&&entry.ownerId!==ownerId))fail('ROLE_PROJECT_OWNER_DENIED');
 const nameKey=String(project.name??'project').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,38)||'project';
 const key=entry.key??(project.id===legacyProfile.projectId?legacyProfile.projectKey:null)??nameKey+'-'+project.id.slice(0,8);
 if(!/^[a-z][a-z0-9-]{0,47}$/.test(key))fail('ROLE_PROJECT_KEY_INVALID');
 const hostPath=sourcePath(workspace);
 if(hostPath!==null&&(typeof hostPath!=='string'||!path.posix.isAbsolute(hostPath)||path.posix.normalize(hostPath)!==hostPath))fail('ROLE_PROJECT_WORKSPACE_DENIED');
 const repository={url:entry.repository?.url??workspace?.repoUrl??null,fullName:entry.repository?.fullName??null,hostPath};
 const rules=entry.rules??[],checks=entry.checks??[];
 const registeredDomains=entry.domains??[];
 if(!Array.isArray(registeredDomains)||registeredDomains.some(domain=>typeof domain!=='string'||!domain.trim()))fail('ROLE_PROJECT_DOMAINS_INVALID');
 const domains=[...new Set(registeredDomains.map(domain=>domain.trim().toLowerCase()))];
 if(!Array.isArray(rules)||rules.some(rule=>typeof rule?.path!=='string'||typeof rule.text!=='string'||
  createHash('sha256').update(rule.text).digest('hex')!==rule.sha256))fail('ROLE_PROJECT_RULES_INVALID');
 if(!Array.isArray(checks)||checks.some(check=>typeof check?.id!=='string'||typeof check.label!=='string'||
  !['macos','docker'].includes(check.platform)||!Array.isArray(check.argv)||!check.argv.length||check.argv.some(arg=>typeof arg!=='string')))
  fail('ROLE_PROJECT_CHECKS_INVALID');
 const delivery=entry.delivery??{maximumAction:hostPath?'pull_request':'artifact'};
 if(!object(delivery)||!['artifact','pull_request','merge','deploy'].includes(delivery.maximumAction))fail('ROLE_PROJECT_DELIVERY_INVALID');
 const rwbRelease=resolveRwbReleaseMetadata(entry.rwbRelease,{companyId,projectId:project.id,rootTaskId,repository});
 let worktreePath=null,nativeSourceWorkspace;
 if(hostPath){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(rootTaskId??''))fail('ROLE_PROJECT_ROOT_TASK_INVALID');
  const worktreeRoot=entry.workspace?.worktreeRoot??'/Volumes/WorkDisk/Projects/'+key+'/paperclip-worktrees';
  if(typeof worktreeRoot!=='string'||!path.posix.isAbsolute(worktreeRoot)||path.posix.normalize(worktreeRoot)!==worktreeRoot)fail('ROLE_PROJECT_WORKSPACE_DENIED');
  worktreePath=path.posix.join(worktreeRoot,rootTaskId);
  // Only explicit Owner-registered local code may arrive from a Native source cwd.
  // This describes the input workspace; plans/reviews still use the fixed artifact cwd.
  if(entry.ownerId===ownerId&&workspace?.sourceType==='local_path'&&entry.workspace?.worktreeRoot){
   if(!workspace.id||typeof workspace.cwd!=='string'||!path.posix.isAbsolute(workspace.cwd)||
    path.posix.normalize(workspace.cwd)!==workspace.cwd||workspace.cwd==='/'||hostPath==='/'||
    worktreeRoot==='/'||worktreeRoot===hostPath||worktreePath===hostPath)fail('ROLE_PROJECT_WORKSPACE_DENIED');
   nativeSourceWorkspace={id:workspace.id,projectId:workspace.projectId,cwd:workspace.cwd,sourceType:workspace.sourceType};
  }
 }
 return {schemaVersion:1,id:project.id,key,name:project.name??project.id,repository,
  workspace:{hostPath:worktreePath,containerPath:'/workspace/project',...(entry.workspace?.prepare?{prepare:entry.workspace.prepare}:{})},rules,checks,delivery,
  hostMcpServers:entry.hostMcpServers??[],hostActions:entry.hostActions??[],services:entry.services??{},stack:entry.stack??[],domains,...(rwbRelease?{rwbRelease}:{}),
  nativeWorkspaceId:workspace?.id??null,...(nativeSourceWorkspace?{nativeSourceWorkspace}:{})};
}

/** Resolve the current task's Native project on every preflight and recheck. */
export async function readRoleProjectContext({db,schema:s,orm:o,task,companyId,ownerId,legacyProfile,rootTaskId}){
 if(!task?.projectId)fail('ROLE_PROJECT_NOT_FOUND');
 const [project]=await db.select().from(s.projects).where(o.eq(s.projects.id,task.projectId));
 const workspaces=await db.select().from(s.projectWorkspaces).where(o.eq(s.projectWorkspaces.projectId,task.projectId));
 const selected=task.projectWorkspaceId?workspaces.filter(w=>w.id===task.projectWorkspaceId):
  workspaces.filter(w=>w.isPrimary);
 if(selected.length>1||(task.projectWorkspaceId&&!selected.length))fail('ROLE_PROJECT_WORKSPACE_AMBIGUOUS');
 const workspace=selected[0]??(workspaces.length===1?workspaces[0]:null);
 if(workspaces.length>1&&!workspace)fail('ROLE_PROJECT_WORKSPACE_AMBIGUOUS');
 return resolveRoleProjectContext({companyId,ownerId,project,workspace,legacyProfile,task,rootTaskId});
}
