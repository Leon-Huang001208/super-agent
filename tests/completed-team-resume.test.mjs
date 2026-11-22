import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {createTeamContextCoordinator,observeTeamFlow} from '../bridge/team-context.mjs';
import {createChiefContextController} from '../bridge/chief-context-native.mjs';
import {createProjectCatalog} from '../bridge/context-projects.mjs';
import {completedResumeRequest,completedResumeWorkspaceSha256,planCompletedResume,completedResumeTransaction,completedResumeExecution,validateCompletedResumeArtifacts} from '../bridge/completed-team-resume.mjs';
import {completedResumeArgs} from '../scripts/resume-completed-team.mjs';

const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function fixture(){
 const companyId=randomUUID(),ownerId='owner-real',projectId=randomUUID(),workspaceId=randomUUID(),rootTaskId=randomUUID(),chief=randomUUID(),qa=randomUUID(),resumeId=randomUUID();
 const workspace={id:workspaceId,projectId,companyId,cwd:'/registered-projects/rwb',sourceType:'local_path',metadata:{superAgentProject:{ownerId,key:'rwb',repository:{fullName:'owner/rwb',url:'https://github.com/owner/rwb',hostPath:'/Volumes/WorkDisk/Projects/RWB/main'},checks:[],delivery:{maximumAction:'pull_request'}}}};
 const project={key:'rwb',aliases:[],companyId,projectId,ownerId,adapterKey:'rwb-docs',allowedRoles:['chief','qa'],maximumAction:'pull_request',projectWorkspaceId:workspaceId,workspaceCwd:`/paperclip/instances/default/projects/${companyId}/${projectId}/_default`};
 const task={id:rootTaskId,companyId,projectId,projectWorkspaceId:randomUUID(),parentId:null,createdByUserId:ownerId,responsibleUserId:ownerId,assigneeUserId:ownerId,assigneeAgentId:null,status:'done',title:'Keep original goal',description:'Original goal is not fully delivered.'};
 const registry={companyId,ownerId,team:{enabled:false,ids:{chief,qa}},tasks:[rootTaskId],taskRoots:{[rootTaskId]:rootTaskId},operations:[{id:randomUUID(),taskId:rootTaskId}],context:{schemaVersion:1,enabled:true,catalog:{schemaVersion:1,defaultProjectKey:'rwb',projects:[project]}}};
 const plan={runId:randomUUID(),file:'plan.json',sha256:sha('plan')},summary={runId:randomUUID(),file:'summary.md',sha256:sha('incomplete')},review={taskId:randomUUID(),runId:randomUUID(),file:'qa.json',sha256:sha('qa'),verdict:'PASS'};
 const flow={rootTaskId,projectId,sourceRunId:plan.runId,sourceOperationId:randomUUID(),inputRevision:taskInputRevision(task),dispatched:true,taskEntries:[{key:'qa',id:review.taskId,role:'qa'}],children:[{id:review.taskId,key:'qa'}],artifacts:{qa:review},planArtifact:plan,summaryRunId:summary.runId,summary,notification:{status:'sent',messageId:'prior-notification'}};
 const request={schemaVersion:1,taskId:rootTaskId,resumeId,expectedFlowSha256:sha(flow),expectedInputRevision:taskInputRevision(task),projectWorkspaceId:workspaceId,expectedWorkspaceSha256:completedResumeWorkspaceSha256(workspace),expectedUsedCalls:4,continuation:'Continue remaining PoC only; keep completed evidence.',approvalSource:'owner explicitly approved same-root continuation',goalIncomplete:true};
 const archivedArtifacts=Object.fromEntries([plan,summary,review].map(ref=>[ref.runId+':'+ref.file,{...ref,archiveFile:`/archive/${ref.runId}-${ref.file}`} ]));
 return {registry,task,originalTask:structuredClone(task),project,workspace,flow,flowSha256:sha(flow),request,used:4,activeRuns:[],leases:[],admissionLeases:[],callLock:false,execution:{active:false,unknown:false,budgetUsed:4},archivedFlow:'/archive/original-flow.json',archivedArtifacts,at:'2026-11-22T03:00:00.000Z'};
}
test('owner adopts a completed original root into a new managed generation without changing spent history',()=>{
 const f=fixture(),before=structuredClone(f),result=planCompletedResume(f);
 assert.equal(result.kind,'resume');assert.deepEqual(f,before);
 assert.equal(result.event.rootTaskId,f.task.id);assert.equal(result.event.usedCalls,4);assert.equal(result.event.maximum,20);
 assert.equal(result.taskPatch.status,'in_review');assert.equal(result.taskPatch.projectWorkspaceId,f.workspace.id);
 assert.equal(result.control.managed,true);assert.equal(result.control.resumeOperationId,f.request.resumeId);
 assert.equal(result.flow.kind,'completed-root-resume');assert.equal(result.flow.predecessor.flowSha256,f.flowSha256);
 assert.equal(result.flow.inputRevision,f.flow.inputRevision);assert.notEqual(result.control.inputRevision,f.flow.inputRevision);
 assert.deepEqual(result.flow.notification,f.flow.notification);assert.equal(result.flow.summary.sha256,f.flow.summary.sha256);
 assert.equal(result.flow.artifacts.qa.archiveFile,f.archivedArtifacts[f.flow.artifacts.qa.runId+':qa.json'].archiveFile);
 assert.deepEqual(result.control.supersessions[0].children,f.flow.children);
});
test('committed resume reconciles projection without a second Native transition or changed operation',()=>{
 const f=fixture(),first=planCompletedResume(f);
 const task={...f.task,...first.taskPatch};
 const again=planCompletedResume({...f,task,nativeEvent:first.event});
 assert.equal(again.kind,'reconcile_projection');assert.deepEqual(again.flow,first.flow);assert.deepEqual(again.event,first.event);
 assert.throws(()=>planCompletedResume({...f,task,nativeEvent:{...first.event,resumeId:randomUUID()}}),/EVENT_CHANGED/);
});
test('foreign scope, drift, cancelled roots, unknown work and active writers refuse adoption',()=>{
 const mutations=[f=>f.registry.team.enabled=true,f=>f.activeRuns.push({id:'active'}),f=>f.leases.push({releasedAt:null}),f=>f.admissionLeases.push({id:'writer'}),f=>f.callLock=true,
  f=>f.execution.unknown=true,f=>f.execution.active=true,f=>f.used=5,f=>f.task.status='cancelled',f=>f.task.parentId=randomUUID(),f=>f.task.responsibleUserId='other',
  f=>f.request.expectedFlowSha256='a'.repeat(64),f=>f.request.expectedInputRevision='b'.repeat(64),f=>f.workspace.projectId=randomUUID(),f=>f.project.projectWorkspaceId=randomUUID(),
  f=>f.workspace.metadata.superAgentProject.ownerId='other',f=>f.flow.notification.status='unknown',f=>f.request.goalIncomplete=false,f=>f.flow.summary.sha256='c'.repeat(64)];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>planCompletedResume(f),/(?:COMPLETED_TEAM_RESUME|CONTEXT_PROJECT)_/);}
});
test('ordinary unmanaged add remains unrelated; strict request does not accept permission or budget overrides',()=>{
 const f=fixture();assert.deepEqual(completedResumeRequest(f.request),f.request);
 for(const patch of [{maximum:99},{force:true},{continuation:''},{approvalSource:''},{goalIncomplete:false}])assert.throws(()=>completedResumeRequest({...f.request,...patch}),/REQUEST/);
});
test('operator CLI preview is default and paths/duplicate switches cannot retarget private state',()=>{
 const file='/paperclip/control/research-pm/owner-resume.json';
 assert.deepEqual(completedResumeArgs(['--request',file]),{requestFile:file,apply:false});
 assert.equal(completedResumeArgs(['--request',file,'--apply']).apply,true);
 for(const args of [[],['--request','/tmp/request.json'],['--request',file,'--force'],['--request',file,'--request',file],['--request',file,'--apply','--apply']])
  assert.throws(()=>completedResumeArgs(args),/ARGUMENTS_INVALID/);
});
test('unmapped failed or unknown Native runs still prevent same-root replay',()=>{
 const local={budgetUsed:4,unknown:false,settledFailedRunIds:['settled']};
 assert.equal(completedResumeExecution({local,runs:[{id:'bad',status:'failed'}]}).unknown,true);
 assert.equal(completedResumeExecution({local,runs:[{id:'settled',status:'failed'}]}).unknown,false);
 assert.equal(completedResumeExecution({local,runs:[{id:'no-provider',status:'failed',resultJson:{executionRecovery:{providerWorkStarted:false}}}]}).unknown,false);
 assert.equal(completedResumeExecution({local,runs:[{id:'active',status:'running'}]}).active,true);
});
test('artifact hashes cannot stand in for a different run, owner or child identity',()=>{
 const f=fixture(),children=f.flow.children.map(ref=>({id:ref.id,parentId:f.task.id,projectId:f.task.projectId,companyId:f.task.companyId,responsibleUserId:f.registry.ownerId,createdByAgentId:f.registry.team.ids.chief}));
 const refs=[f.flow.planArtifact,f.flow.summary,...Object.values(f.flow.artifacts)],permits=Object.fromEntries(refs.map(ref=>[ref.runId,{runId:ref.runId,taskId:ref.taskId??f.task.id,agentId:f.registry.team.ids.chief,companyId:f.task.companyId,projectId:f.task.projectId,ownerId:f.registry.ownerId}]));
 const runs=refs.map(ref=>({id:ref.runId,issueId:ref.taskId??f.task.id,companyId:f.task.companyId,responsibleUserId:f.registry.ownerId,agentId:f.registry.team.ids.chief,status:'succeeded',finishedAt:f.at}));
 const input={registry:f.registry,task:f.task,flow:f.flow,runs,children,permits};
 assert.equal(validateCompletedResumeArtifacts(input),true);
 for(const change of [value=>value.runs[0].status='running',value=>value.runs[0].agentId=randomUUID(),value=>value.children[0].parentId=randomUUID(),value=>value.permits[refs[0].runId].ownerId='foreign']){
  const value=structuredClone(input);change(value);assert.throws(()=>validateCompletedResumeArtifacts(value),/NATIVE_ARTIFACT_CHANGED/);
 }
});
test('real context coordinator treats old sent summary as history and wakes exactly one new plan',async()=>{
 const f=fixture(),result=planCompletedResume(f),task={...f.task,...result.taskPatch},registry=structuredClone(f.registry);registry.team.enabled=true;
 const control=result.control,effects=[],archives=[],runs=new Map();
 const context=createTeamContextCoordinator({syncTask:async()=>({task,control}),checkpoint:async event=>{effects.push(event.kind);return{claimGranted:true};},archiveFlow:async value=>archives.push(value),log:()=>{}});
 const view=await observeTeamFlow({registry,flow:result.flow,file:'/workflows/original.json',readTask:async()=>task,context,log:()=>{}});
 assert.equal(view.delivered,false);assert.equal(view.disposition,'superseded');
 const args={registry,task,flow:result.flow,file:'/workflows/original.json',used:4,lookupRun:async operation=>runs.get(operation.id)??null,wake:async value=>{effects.push('wake');const run={id:randomUUID()};runs.set(value.operationId,run);assert.equal(value.artifactGeneration,f.request.resumeId);return run.id;}};
 await context.resumePlan(args);await context.resumePlan(args);
 assert.equal(effects.filter(x=>x==='wake').length,1);assert.ok(archives.length>=1);assert.equal(f.used,4);
});
test('adopted control passes the real Native sync/checkpoint policy and retires the previous generation',async()=>{
 const f=fixture(),plan=planCompletedResume(f),task={...f.task,...plan.taskPatch},registry=structuredClone(f.registry);registry.team.enabled=true;
 let control=structuredClone(plan.control);const runs=new Map(),effects=[];
 const catalog=createProjectCatalog({registry:registry.context.catalog,authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log:()=>{}});
 const native=createChiefContextController({binding:{appId:'cli_fixture',tenantKey:'tenant',ownerOpenId:'ou_owner',nativeOwnerId:registry.ownerId,
  companyId:registry.companyId,projectId:task.projectId,chiefAgentId:registry.team.ids.chief},catalog,
  repository:{transaction:async(key,fn)=>fn({readTask:async()=>structuredClone(task),readControl:async()=>structuredClone(control),
   writeControl:async(id,value)=>{assert.equal(id,task.id);control=structuredClone(value);},readExecution:async()=>({active:false,unknown:false,budgetUsed:4,budgetMaximum:20}),readRun:async id=>runs.get(id)??null})},
  knowledgeStore:Object.fromEntries(['remember','correct','query','history'].map(key=>[key,async()=>[]])),registerNewGoal:async()=>assert.fail('must not create a goal'),acknowledge:async()=>{},log:()=>{}});
 const coordinator=createTeamContextCoordinator({syncTask:native.syncTask,checkpoint:native.checkpoint,archiveFlow:async()=>{},log:()=>{}});
 const result=await coordinator.resumePlan({registry,task,flow:plan.flow,file:'/workflows/original.json',used:4,
  lookupRun:async op=>[...runs.values()].find(run=>run.operationId===op.id)??null,wake:async value=>{
   const run={id:randomUUID(),issueId:task.id,companyId:task.companyId,agentId:registry.team.ids.chief,operationId:value.operationId,status:'succeeded'};
   runs.set(run.id,run);effects.push('wake');return run.id;
  }});
 assert.equal(effects.length,1);assert.equal(control.resumeClaim.operationId,f.request.resumeId);
 await native.checkpoint({registry,task,flow:{...plan.flow,inputRevision:taskInputRevision(task),sourceOperationId:f.request.resumeId},kind:'plan_ready',runId:result.runId,
  artifact:{file:'new-plan.json',sha256:sha('{}'),bytes:2,text:'{}'}});
 assert.equal(control.resumeOperationId,null);assert.equal(control.plan.runId,result.runId);
 const observed=await observeTeamFlow({registry,flow:plan.flow,file:'/workflows/original.json',readTask:async()=>task,context:coordinator,log:()=>{}});
 assert.equal(observed.disposition,'retired');assert.equal(observed.delivered,false);
});
test('Native events and effects cannot escape a failed commit',async()=>{
 const effects=[];let committed=false;
 const ports={transaction:async mutate=>{const value=await mutate({native:true});if(!committed)throw Error('commit failed');effects.push('commit');return value;},mutate:async(tx,publications,actions)=>{assert.equal(tx.native,true);publications.push('owner-event');actions.push('post-commit');return'ok';},publishActivity:value=>effects.push(value),runPostCommitActions:async actions=>effects.push(...actions)};
 await assert.rejects(completedResumeTransaction(ports),/commit failed/);assert.deepEqual(effects,[]);
 committed=true;assert.equal(await completedResumeTransaction(ports),'ok');assert.deepEqual(effects,['commit','owner-event','post-commit']);
});
