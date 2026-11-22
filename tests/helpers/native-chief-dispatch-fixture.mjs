import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const P='/opt/paperclip/node_modules';

/** Isolated installed Native service, real migrated PG, adapter stops before any provider. */
export async function captureNativeChiefDispatch(onDispatch,{fixture:f,consume}={}){
 const s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js');
 const {heartbeatService}=await import(P+'/@paperclipai/server/dist/services/heartbeat.js');
 const {getServerAdapter,registerServerAdapter,unregisterServerAdapter}=await import(P+'/@paperclipai/server/dist/adapters/registry.js');
 // The production private-file contract requires root. The disposable container supplies an existing postgres UID alias;
 // this option only chowns the newly created tmpfs PG directory and never creates a host/container account.
 if(process.getuid()===0){
  execFileSync('id',['-u','postgres']);
  const {default:EmbeddedPostgres}=await import(P+'/embedded-postgres/dist/index.js');
  await(await import(P+'/@paperclipai/db/dist/embedded-postgres-native.js')).prepareEmbeddedPostgresNativeRuntime();
  (await import(P+'/@paperclipai/db/dist/test-embedded-postgres.js')).__setEmbeddedPostgresCtorProviderForTests(async()=>class extends EmbeddedPostgres{constructor(options){super({...options,createPostgresUser:true});}});
 }
 const pg=await s.startEmbeddedPostgresTestDatabase('sa-chief-ledger-'),db=s.createDb(pg.connectionString);
 const companyId=f?.task.companyId??randomUUID(),agentId=f?.operation.agentId??randomUUID(),taskId=f?.task.id??randomUUID(),projectId=f?.task.projectId??randomUUID(),workspaceId=f?.nativeWorkspace.id??randomUUID(),runId=f?.run.id??randomUUID();
 const cwd='/tmp/sa-native-source';await fs.mkdir(cwd,{recursive:true});execFileSync('git',['init',cwd],{stdio:'ignore'});
 let entered=0,captured,rejectDispatch,resolveDispatch;
 const dispatched=new Promise((resolve,reject)=>{resolveDispatch=resolve;rejectDispatch=reject;});
 const original=getServerAdapter('codex_local');
 registerServerAdapter({...original,execute:async ctx=>{
  try{
   entered++;const [run]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ctx.runId));
   const [task]=await db.select().from(s.issues).where(o.eq(s.issues.id,taskId));
   const reservations=await db.select().from(s.budgetReservations).where(o.eq(s.budgetReservations.runId,runId));
   captured={run,task,reservations,context:ctx.context,db,schema:s,orm:o,verifyPhaseLease:f?.verifyPhaseLease};await onDispatch?.(captured);resolveDispatch(captured);
  }catch(error){rejectDispatch(error);}
  return {exitCode:1,signal:null,errorMessage:'Isolated no-provider contract boundary',errorCode:'NO_PROVIDER_CONTRACT_STOP',resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};
 }});
 const heartbeat=heartbeatService(db);
 try{
  await db.insert(s.companies).values({id:companyId,name:'Isolated contract',issuePrefix:'ISO'});
  // A noncredential satisfies Native's configuration check; the registered adapter is a no-model stub and the container has no network.
  await db.insert(s.agents).values({id:agentId,companyId,name:'Chief contract',role:'ceo',adapterType:'codex_local',adapterConfig:{cwd,model:'gpt-6.1-sol',modelReasoningEffort:'low',env:{OPENAI_API_KEY:'fixture-noncredential'}},runtimeConfig:{heartbeat:{enabled:false}}});
  await db.insert(s.projects).values({id:projectId,companyId,name:'Isolated source'});
  await db.insert(s.projectWorkspaces).values({id:workspaceId,companyId,projectId,name:'Source',cwd,sourceType:'local_path',isPrimary:true,metadata:f?.nativeWorkspace.metadata});
  const task=f?{...f.task,billingCode:null}:{id:taskId,companyId,projectId,projectWorkspaceId:workspaceId,title:'No-model dispatch contract',description:'Stop at registered adapter boundary.',status:'in_progress',assigneeAgentId:agentId,responsibleUserId:'fixture-owner',billingCode:'contract'};
  await db.insert(s.issues).values(task);
  if(f){
   const dates=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value&&key.endsWith('At')?new Date(value):value]));
   await db.insert(s.agentWakeupRequests).values({...f.wakeup,status:'consumed'});
   for(const value of f.taskRuns.filter(value=>value.id!==runId))await db.insert(s.heartbeatRuns).values(dates(value));
   for(const value of f.leases)await db.insert(s.environmentLeases).values(dates({...value,companyId,issueId:taskId,provider:'local'}));
   await db.insert(s.activityLog).values({companyId,actorType:'user',actorId:f.registry.ownerId,action:'team.context.control',entityType:'issue',entityId:taskId,details:{_eventSequence:3,value:{schemaVersion:1,...f.control}}});
  }
  await db.insert(s.heartbeatRuns).values(f?{...f.run,status:'queued'}:{id:runId,companyId,agentId,issueId:taskId,responsibleUserId:'fixture-owner',status:'queued',contextSnapshot:{issueId:taskId,taskId,projectId,forceFreshSession:true},resultJson:{conversationContinuation:'continue_conversation_v1'}});
  const ports={db,schema:s,orm:o,heartbeat,verifyPhaseLease:f?.verifyPhaseLease,issue:{getById:async id=>(await db.select().from(s.issues).where(o.eq(s.issues.id,id)))[0]}};
  const claimed=consume?await consume(ports):await heartbeat.resumeQueuedRunsForAgent(companyId,agentId);
  let timer;try{await Promise.race([dispatched,new Promise((_,reject)=>{timer=setTimeout(async()=>{try{const [run]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,runId));reject(Error('NATIVE_DISPATCH_NOT_REACHED:'+JSON.stringify({claimed:claimed?.map?.(x=>x.id),status:run.status,error:run.error,errorCode:run.errorCode})));}catch(error){reject(error);}},15000);})]);}finally{clearTimeout(timer);}
  return {...captured,entered};
 }finally{
  await heartbeat.drainActiveRunExecutions();unregisterServerAdapter('codex_local');await pg.cleanup();
 }
}
