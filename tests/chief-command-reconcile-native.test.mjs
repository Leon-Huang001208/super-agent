import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createChiefContextApplication} from '../bridge/chief-context-service.mjs';
import {observeContextCallEvidence,readManagedChiefContext} from '../bridge/chief-context-paperclip.mjs';
import {chiefFeishuOperation} from '../bridge/chief-feishu-native.mjs';
import {createChiefFeishuIntake} from '../bridge/chief-feishu-intake.mjs';
import {parseChiefContextCommand} from '../bridge/chief-context-commands.mjs';
import {createTeamContextCoordinator} from '../bridge/team-context.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
const P='/opt/paperclip/node_modules',sha=value=>createHash('sha256').update(value).digest('hex');

for(const wrongOrder of [true,false])test('real Native PG persisted continue: '+(wrongOrder?'pending input consumed first remains denied':'source reconciliation precedes input and resume claim'),{
 skip:!fs.existsSync(P+'/@paperclipai/db/dist/index.js'),timeout:90000,
},async t=>{
 assert.equal(process.env.SUPER_AGENT_OFFLINE_NATIVE_CONTRACT,'1');assert.ok(process.env.PAPERCLIP_HOME.startsWith('/tmp/'));
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'sa-continue-native-')),identity=fs.lstatSync(root),marker=root+'/.owner',token=randomUUID();fs.writeFileSync(marker,token,{flag:'wx',mode:0o600});
 const markerIdentity=fs.lstatSync(marker);
 const s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js');execFileSync('id',['-u','postgres']);
 const {default:EmbeddedPostgres}=await import(P+'/embedded-postgres/dist/index.js');await(await import(P+'/@paperclipai/db/dist/embedded-postgres-native.js')).prepareEmbeddedPostgresNativeRuntime();
 (await import(P+'/@paperclipai/db/dist/test-embedded-postgres.js')).__setEmbeddedPostgresCtorProviderForTests(async()=>class extends EmbeddedPostgres{constructor(options){super({...options,createPostgresUser:true});}});
 const pg=await s.startEmbeddedPostgresTestDatabase('sa-owner-continue-'),db=s.createDb(pg.connectionString);
 t.after(async()=>{await pg.cleanup();const current=fs.lstatSync(root),stored=fs.lstatSync(marker);for(const key of ['dev','ino','uid']){assert.equal(current[key],identity[key]);assert.equal(stored[key],markerIdentity[key]);}
  assert.ok(current.isDirectory()&&!current.isSymbolicLink());assert.equal(fs.realpathSync(root),root);assert.equal(current.mode&0o777,identity.mode&0o777);assert.ok(stored.isFile()&&!stored.isSymbolicLink()&&stored.nlink===1);assert.equal(stored.mode&0o777,0o600);assert.equal(fs.readFileSync(marker,'utf8'),token);fs.rmSync(root,{recursive:true});});
 const companyId=randomUUID(),projectId=randomUUID(),taskId=randomUUID(),chief=randomUUID(),opId=randomUUID(),workspaceId=randomUUID();
 const binding={appId:'cli_fixture',tenantKey:'tenant_fixture',ownerOpenId:'ou_owner',nativeOwnerId:'fixture_owner',companyId,projectId,chiefAgentId:chief};
 const task={id:taskId,identifier:'LEO-51',companyId,projectId,projectWorkspaceId:workspaceId,parentId:null,title:'Original goal',description:'Original goal',status:'blocked',responsibleUserId:binding.nativeOwnerId,createdByUserId:binding.nativeOwnerId,assigneeUserId:binding.nativeOwnerId,assigneeAgentId:null};
 const input=taskInputRevision(task),project={key:'rwb',aliases:[],companyId,ownerId:binding.nativeOwnerId,projectId,projectWorkspaceId:workspaceId,adapterKey:'rwb-docs',allowedRoles:['chief'],maximumAction:'pull_request',workspaceCwd:`/paperclip/instances/default/projects/${companyId}/${projectId}/_default`};
 const op={id:opId,kind:'run',role:'chief',phase:'plan',taskId,rootTaskId:taskId,projectId,projectWorkspaceId:workspaceId,agentId:chief,contextVersion:1,inputRevision:input,artifactGeneration:opId};
 const registry={enabled:true,companyId,ownerId:binding.nativeOwnerId,team:{enabled:true,ids:{chief}},policy:{maxRootRoleCalls:20},agents:[{profile:{role:'chief',agentId:chief}}],operations:[op],tasks:[taskId],taskRoots:{[taskId]:taskId},context:{schemaVersion:1,enabled:true,catalog:{schemaVersion:1,defaultProjectKey:'rwb',projects:[project]}}};
 const write=(name,value)=>{const file=root+'/'+name;fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});};
 const contextSnapshot={roleOperationId:opId,inputRevision:input,projectId};
 const initial={id:randomUUID(),companyId,issueId:taskId,agentId:chief,responsibleUserId:binding.nativeOwnerId,status:'failed',exitCode:1,signal:null,retryOfRunId:null,scheduledRetryAttempt:0,
  startedAt:new Date('2026-11-20T00:00:00Z'),finishedAt:new Date('2026-11-20T00:01:00Z'),errorCode:'NATIVE_ROLE_WORKSPACE_SCOPE_DENIED',error:'NATIVE_ROLE_WORKSPACE_SCOPE_DENIED',stdoutExcerpt:'',stderrExcerpt:'',logBytes:0,logSha256:sha(''),lastOutputSeq:0,lastOutputAt:null,lastOutputStream:null,lastOutputBytes:null,nativeSessionId:null,sessionIdBefore:null,sessionIdAfter:null,processPid:null,processGroupId:null,processStartedAt:null,contextSnapshot,
  resultJson:{stopReason:'adapter_failed',timeoutFired:false,configFreshness:{session:{taskSessionAvailable:false,taskSessionReused:false}},executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};
 const refusal={...structuredClone(initial),id:randomUUID(),retryOfRunId:initial.id,scheduledRetryAttempt:1,errorCode:'TEAM_NATIVE_RETRY_BOOTSTRAP_CHIEF_WORKSPACE_SUCCESSOR_NOT_PRISTINE',error:'The controlled Native intake or retry did not admit this execution.',resultJson:{...structuredClone(initial.resultJson),executionRecovery:{kind:'reconciliation',providerWorkStarted:null}}};
 const success={...structuredClone(refusal),id:randomUUID(),status:'succeeded',exitCode:0,errorCode:null,error:null,retryOfRunId:refusal.id,scheduledRetryAttempt:2,resultJson:{},stdoutExcerpt:'Successful plan',logBytes:100,logSha256:sha('Successful plan')};
 const history=[initial,refusal,success];write('registry.json',registry);write('budget/'+taskId+'/'+opId+'.json',op);write('operations/'+opId+'.json',{operationId:opId,taskId,agentId:chief,runId:success.id});
 for(let n=0;n<7;n++){const call={...op,id:randomUUID(),contextVersion:undefined,artifactGeneration:undefined},run={...structuredClone(success),id:randomUUID(),retryOfRunId:null,scheduledRetryAttempt:0,contextSnapshot:{roleOperationId:call.id,inputRevision:input,projectId}};history.push(run);write('budget/'+taskId+'/'+call.id+'.json',call);write('operations/'+call.id+'.json',{operationId:call.id,taskId,agentId:chief,runId:run.id});}
 await db.insert(s.authUsers).values({id:binding.nativeOwnerId,name:'Fixture owner',email:'owner@fixture.invalid',createdAt:new Date(),updatedAt:new Date()});
 await db.insert(s.companies).values({id:companyId,name:'Continue contract',issuePrefix:'REC'});await db.insert(s.companyMemberships).values({companyId,principalType:'user',principalId:binding.nativeOwnerId,status:'active',membershipRole:'owner'});
 await db.insert(s.agents).values({id:chief,companyId,name:'Chief'});await db.insert(s.projects).values({id:projectId,companyId,name:'RWB contract'});
 await db.insert(s.projectWorkspaces).values({id:workspaceId,companyId,projectId,name:'Source',cwd:root,sourceType:'local_path',isPrimary:true});await db.insert(s.issues).values(task);
 for(const run of history)await db.insert(s.heartbeatRuns).values(run);
 const control={schemaVersion:1,managed:true,companyId,ownerId:binding.nativeOwnerId,projectId,projectWorkspaceId:workspaceId,taskId,inputRevision:input,revision:4,inputSequence:0,pendingInputs:[],reviewBeforeDispatch:false,approvedPlanSha256:null,plan:null,pauseRequested:false,resumeOperationId:null,resumeClaim:{operationId:opId,inputRevision:input,runId:success.id,status:'completed'},checkpoints:[]};
 await db.insert(s.activityLog).values({companyId,actorType:'user',actorId:binding.nativeOwnerId,action:'team.context.control',entityType:'issue',entityId:taskId,details:{_eventSequence:1,value:control}});
 const database=async()=>({db,schema:s,orm:o}),messages=[];let oldProjection=true,canonical;
 const observer=args=>{const value=observeContextCallEvidence({...args,root});return oldProjection?{...value,settledFailedRunIds:[]}:value;};
 const app=await createChiefContextApplication({database,binding,registry,client:{im:{message:{reply:async()=>assert.fail('no new goal'),create:async()=>{messages.push(1);return{code:0,data:{message_id:'om_reply'+messages.length}};}}}},knowledgeRoot:root+'/knowledge',log:()=>{},currentScope:()=>{},observeLocalExecution:observer,observeLocalOperation:()=>null});
 const receive=createChiefFeishuIntake({binding,parseCommand:parseChiefContextCommand,log:()=>{},registerTrustedMessage:async snapshot=>{canonical=snapshot;return app.receiveTrusted(snapshot);}});
 const event=text=>({header:{event_type:'im.message.receive_v1',app_id:binding.appId,tenant_key:binding.tenantKey,event_id:randomUUID()},event:{sender:{sender_type:'user',sender_id:{open_id:binding.ownerOpenId},tenant_key:binding.tenantKey},message:{message_id:'om_'+randomUUID().replaceAll('-',''),chat_id:'oc_fixture',chat_type:'p2p',message_type:'text',content:JSON.stringify({text}),create_time:'1795136400000'}}});
 await receive(event('/chief add LEO-51 The authorized pending change'));await receive(event('/chief continue LEO-51'));assert.equal(messages.length,2);
 const source=canonical,key=chiefFeishuOperation(source),[stored]=await db.select().from(s.activityLog).where(o.and(o.eq(s.activityLog.action,'team.context.intent'),o.sql`${s.activityLog.details}->>'sourceKey' = ${key}`)),intent=stored.details;
 const request={schemaVersion:1,taskId,companyId,projectId,sourceKey:key,operationId:intent.operationId,expectedInputRevision:input,expectedControlRevision:5,expectedFingerprint:intent.fingerprint,expectedBodySha256:intent.bodySha256};
 const rows=()=>db.select().from(s.activityLog).where(o.sql`${s.activityLog.details}->>'sourceKey' = ${key}`),budget=()=>fs.readdirSync(root+'/budget/'+taskId).sort().map(name=>[name,sha(fs.readFileSync(root+'/budget/'+taskId+'/'+name))]);
 const beforeBudget=budget(),prior=await rows();assert.equal(prior.filter(row=>row.action==='team.context.result').length,0);const oldAck=prior.filter(row=>row.action.includes('ack_'));
 oldProjection=false;registry.team.enabled=false;
 const issue=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db);
 if(wrongOrder){
  const changed=await app.controller.syncTask({registry,task:await issue.getById(taskId)});assert.notEqual(changed.control.inputRevision,input);
  await assert.rejects(app.controller.reconcileOwnerContinue({registry,request,apply:true}),/CHIEF_CONTEXT_RECONCILE_INPUT_CHANGED/);
  assert.deepEqual(await rows(),prior);assert.deepEqual(budget(),beforeBudget);assert.equal(messages.length,2);
  t.diagnostic('Original intent remains blocked after premature pending-input consumption; no replacement authorization or result.');return;
 }
 const preview=await app.controller.reconcileOwnerContinue({registry,request});assert.equal(preview.canApply,true);assert.deepEqual(await rows(),prior);
 const applied=await app.controller.reconcileOwnerContinue({registry,request,apply:true});assert.equal(applied.result.resumeOperationId,intent.operationId);
 const taskAfter=await issue.getById(taskId);
 const readControl=async()=>readManagedChiefContext({db,schema:s,orm:o,task:await issue.getById(taskId),companyId,ownerId:binding.nativeOwnerId});
 assert.equal(taskAfter.description,'Original goal');assert.equal((await readControl()).pendingInputs.length,1);
 registry.team.enabled=true;let wakeBoundary=0;
 const coordinator=createTeamContextCoordinator({syncTask:app.controller.syncTask,checkpoint:app.controller.checkpoint,archiveFlow:async()=>{},log:()=>{}});
 const flow={rootTaskId:taskId,projectId,projectKey:'rwb',projectWorkspaceId:workspaceId,workspaceCwd:project.workspaceCwd,inputRevision:input,children:[]};
 const result=await coordinator.resumePlan({registry,task:taskAfter,flow,used:8,lookupRun:async()=>null,wake:async value=>{wakeBoundary++;assert.equal(value.operationId,intent.operationId);return null;}});
 assert.equal(wakeBoundary,1);assert.equal(result.control.resumeOperationId,intent.operationId);const next=await readControl();assert.equal(next.pendingInputs.length,0);assert.notEqual(next.inputRevision,input);assert.equal(next.resumeClaim.operationId,intent.operationId);assert.equal(next.resumeClaim.inputRevision,next.inputRevision);
 const local=observeContextCallEvidence({task:await issue.getById(taskId),ids:[taskId],runs:await db.select().from(s.heartbeatRuns),root});assert.equal(local.unknown,false);assert.deepEqual(local.settledFailedRunIds,[refusal.id]);
 registry.team.enabled=false;assert.equal((await app.controller.reconcileOwnerContinue({registry,request,apply:true})).status,'reused');const beforeReplay=await rows();await app.receiveTrusted(source);assert.deepEqual(await rows(),beforeReplay);assert.equal(messages.length,2);
 assert.deepEqual((await rows()).filter(row=>row.action.includes('ack_')),oldAck);assert.deepEqual(budget(),beforeBudget);assert.equal((await db.select().from(s.heartbeatRuns)).length,history.length);
 const[preserved]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,refusal.id));assert.equal(preserved.resultJson.executionRecovery.providerWorkStarted,null);
 t.diagnostic(JSON.stringify({storedOwnerContinue:true,jsonbFingerprintVerified:true,oldAckPreserved:true,originalOperationReused:true,pendingAppliedOnce:true,historicalRefusalStillNull:true,newInputStillSettled:true,resumeClaimBound:true,wakeBoundary,providerCalls:0,budgetFiles:8}));
});
