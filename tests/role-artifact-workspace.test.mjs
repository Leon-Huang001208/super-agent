import test from 'node:test';
import assert from 'node:assert/strict';
import {isRoleArtifactWorkspace,allowRoleArtifactWorkspace} from '../bridge/role-artifact-workspace.mjs';
import {MACOS_NATIVE_EXECUTION_POLICY} from '../bridge/role-execution-policy.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';

function fixture(){
 const companyId='company',projectId='project',agentId='agent',workspaceId='workspace',cwd=`/paperclip/instances/default/projects/${companyId}/${projectId}/_default`;
 const task={id:'child',companyId,projectId,projectWorkspaceId:workspaceId,responsibleUserId:'owner',assigneeAgentId:agentId,assigneeUserId:null,
  status:'in_progress',title:'Review files',description:'Keep original sources',parentId:'root',executionRunId:'run',checkoutRunId:'run',executionWorkspaceId:'persisted'};
 const rootTask={id:'root',companyId,projectId,responsibleUserId:'owner',title:'Goal',description:'Original goal',status:'in_review',assigneeUserId:'owner',assigneeAgentId:null};
 const op={id:'op',kind:'run',taskId:task.id,rootTaskId:rootTask.id,agentId,role:'research',projectId,
  inputRevision:taskInputRevision(task),rootInputRevision:taskInputRevision(rootTask)};
 const registry={enabled:true,companyId,ownerId:'owner',team:{enabled:true,ids:{research:agentId}},agents:[{profile:{agentId,role:'research',executionPolicy:{...MACOS_NATIVE_EXECUTION_POLICY}}}],
  operations:[op],tasks:[task.id,rootTask.id],taskRoots:{child:rootTask.id}};
 const run={id:'run',companyId,agentId,issueId:task.id,responsibleUserId:'owner',status:'running',contextSnapshot:{issueId:task.id,taskId:task.id,projectId,roleOperationId:op.id,inputRevision:op.inputRevision}};
 const persistedWorkspace={id:'persisted',companyId,projectId,projectWorkspaceId:workspaceId,cwd,strategyType:'project_primary'};
 const input={adapterType:'codex_local',agentId,issue:{id:task.id,projectId,projectWorkspaceId:workspaceId},
  resolvedWorkspace:{projectId,workspaceId,cwd},executionWorkspace:{projectId,workspaceId,cwd,strategy:'project_primary'},persistedExecutionWorkspace:{...persistedWorkspace}};
 const agent={id:agentId,companyId,adapterType:'codex_local',adapterConfig:{env:{SUPER_AGENT_ROLE_ENABLED:'true'}}};
 const project={id:projectId,companyId},workspace={id:workspaceId,companyId,projectId,cwd,sourceType:'non_git_path',metadata:{superAgentProject:{ownerId:'owner',delivery:{maximumAction:'artifact'},repository:{hostPath:null,fullName:'owner/read-only-reference'}}}};
 return {input,registry,task,rootTask,run,agent,project,workspace,persistedWorkspace};
}

test('registered Native artifact workspaces retain their real workspace IDs without requiring Git',()=>{
 const f=fixture(),before=structuredClone(f);assert.equal(isRoleArtifactWorkspace(f),true);assert.deepEqual(f,before);
 f.task.executionRunId=null;assert.equal(isRoleArtifactWorkspace(f),true);
});

test('foreign identities, inactive runs, stale inputs and workspace substitutions cannot claim the artifact exception',()=>{
 const changes=[
  f=>f.registry.enabled=false,f=>f.registry.team.enabled=false,f=>f.registry.team.ids.research='other',
  f=>f.registry.agents[0].profile.executionPolicy.executor='docker',f=>delete f.registry.agents[0].profile.executionPolicy,
  f=>f.agent.companyId='foreign',f=>f.agent.adapterConfig.env.SUPER_AGENT_ROLE_ENABLED='false',f=>f.task.responsibleUserId='foreign',
  f=>f.task.assigneeAgentId='foreign',f=>f.task.status='done',f=>f.run.companyId='foreign',f=>f.run.status='queued',f=>f.run.finishedAt='now',
  f=>f.task.checkoutRunId='other',f=>{f.task.executionRunId=null;f.task.checkoutRunId=null;},f=>f.task.title+=' changed',
  f=>f.rootTask.description+=' changed',f=>f.rootTask.assigneeAgentId='other',f=>f.rootTask.status='done',f=>f.run.contextSnapshot.taskGoal='stale',
  f=>f.run.contextSnapshot.roleOperationId='unknown',f=>f.registry.operations.push({...f.registry.operations[0]}),
  f=>f.registry.taskRoots.child='foreign',f=>f.project.companyId='foreign',f=>f.project.personalOwnerUserId='foreign',
  f=>f.workspace.companyId='foreign',f=>f.workspace.metadata.superAgentProject.ownerId='foreign',f=>delete f.workspace.metadata.superAgentProject.delivery,
  f=>f.workspace.metadata.superAgentProject.delivery.maximumAction='pull_request',f=>f.workspace.metadata.superAgentProject.repository.hostPath='/source/repo',
  f=>f.workspace.metadata.superAgentProject.workspace={hostPath:'/source/repo'},f=>f.workspace.metadata.superAgentProject.hostActions=['write'],
  f=>f.workspace.sourceType='local_path',f=>f.workspace.sourceType='git',f=>f.workspace.cwd='/other',
  f=>f.input.executionWorkspace.cwd+='/../_default',f=>f.input.resolvedWorkspace.workspaceId='other',f=>f.input.issue.projectWorkspaceId='other',
  f=>f.persistedWorkspace.cwd='/other',f=>f.persistedWorkspace.projectWorkspaceId='other',f=>f.task.executionWorkspaceId='other',
  f=>f.input.persistedExecutionWorkspace.projectId='other',f=>f.input.executionWorkspace.strategy='git_worktree',
  f=>f.persistedWorkspace.strategyType='git_worktree',f=>f.input.environmentDriver='remote',
 ];
 for(const [i,change]of changes.entries()){const f=fixture();change(f);assert.equal(isRoleArtifactWorkspace(f),false,'negative case '+i);}
});

test('M2 operation must agree with the deployment-owned project catalog',()=>{
 const f=fixture(),op=f.registry.operations[0];Object.assign(op,{contextVersion:1,projectKey:'rwb',workspaceCwd:f.workspace.cwd,projectWorkspaceId:f.workspace.id});
 const selected={companyId:f.registry.companyId,projectId:f.project.id,ownerId:f.registry.ownerId,maximumAction:'read_only',key:'rwb',workspaceCwd:f.workspace.cwd,projectWorkspaceId:f.workspace.id,allowedRoles:['research']};
 f.registry.context={enabled:true,catalog:{projects:[selected]}};assert.equal(isRoleArtifactWorkspace(f),true);
 for(const [key,value]of Object.entries({companyId:'foreign',ownerId:'foreign',maximumAction:'pull_request',projectWorkspaceId:'other',key:'other',workspaceCwd:'/other',allowedRoles:[]})){
  const copy=structuredClone(f);copy.registry.context.catalog.projects[0][key]=value;assert.equal(isRoleArtifactWorkspace(copy),false,key);
 }
});

test('initial unregistered Chief root requires its actual owner-created task and Native owner wake',()=>{
 const f=fixture();f.task.parentId=null;f.task.createdByUserId='owner';f.registry.agents[0].profile.role='chief';f.registry.team.ids={chief:f.agent.id};f.registry.operations=[];f.registry.tasks=[];
 delete f.run.contextSnapshot.roleOperationId;delete f.run.contextSnapshot.inputRevision;
 f.run.wakeupRequestId='wake';f.wakeup={id:'wake',runId:f.run.id,companyId:f.registry.companyId,agentId:f.agent.id,requestedByActorType:'user',requestedByActorId:'owner',payload:{issueId:f.task.id}};
 assert.equal(isRoleArtifactWorkspace(f),true);
 for(const change of [v=>v.task.createdByUserId='other',v=>v.task.parentId='root',v=>v.wakeup.requestedByActorType='agent',v=>v.wakeup.payload.issueId='other',v=>v.wakeup.runId='other',v=>v.registry.operations=[{kind:'run',taskId:v.task.id}]]){
  const copy=structuredClone(f);change(copy);assert.equal(isRoleArtifactWorkspace(copy),false);
 }
});

function databaseFor(f){
 const names=['issues','heartbeatRuns','agents','projects','projectWorkspaces','executionWorkspaces','agentWakeupRequests'],schema=Object.fromEntries(names.map(name=>[name,{name,id:name+'.id'}]));
 const rows={issues:[f.task,f.rootTask],heartbeatRuns:[f.run],agents:[f.agent],projects:[f.project],projectWorkspaces:[f.workspace],executionWorkspaces:[f.persistedWorkspace],agentWakeupRequests:[f.wakeup].filter(Boolean)};
 return {schema,orm:{eq:(field,value)=>({field,value})},db:{select:()=>({from:table=>({where:({value})=>Promise.resolve(rows[table.name].filter(row=>row.id===value))})})}};
}

test('runtime guard rereads Native rows and registry and exposes lookup errors without side effects',async()=>{
 const f=fixture(),logs=[],before=structuredClone(f),ports={readRegistry:()=>f.registry,database:async()=>databaseFor(f),log:event=>logs.push(event)};
 assert.equal(await allowRoleArtifactWorkspace(f.input,ports),true);assert.deepEqual(f,before);assert.equal(logs[0].code,'ROLE_ARTIFACT_WORKSPACE_BOUND');
 f.task.title+=' changed';assert.equal(await allowRoleArtifactWorkspace(f.input,ports),false);assert.equal(logs.at(-1).code,'ROLE_ARTIFACT_WORKSPACE_DENIED');
 await assert.rejects(allowRoleArtifactWorkspace(f.input,{...ports,database:async()=>{throw Error('credential must not leak');}}),{code:'ROLE_ARTIFACT_WORKSPACE_LOOKUP_FAILED'});
 assert.equal(JSON.stringify(logs).includes('credential'),false);
 assert.equal(await allowRoleArtifactWorkspace({...f.input,adapterType:'other'},{database:()=>assert.fail('must not connect')}),false);
});
