import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fixture,controlledPreflight} from './completed-resume-chief-fixture.mjs';
import {AdmissionMeter} from '../../bridge/admission.mjs';
import {createHostStorageReceipt} from '../../scripts/host-storage.mjs';
import {createProjectCatalog} from '../../bridge/context-projects.mjs';
import {createChiefContextPaperclipRepository,readManagedChiefContext} from '../../bridge/chief-context-paperclip.mjs';
import {createChiefContextController} from '../../bridge/chief-context-native.mjs';
import {TEAM_ROLES} from '../../bridge/team-roles.mjs';
import {startTeamCoordinator} from '../../bridge/team-native-runtime.mjs';

const P='/opt/paperclip/node_modules',R='/paperclip/control/research-pm',ledger='/paperclip/control/admission.sqlite';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(file,value)=>{fs.mkdirSync(file.slice(0,file.lastIndexOf('/')),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});};
const controlRoot='/paperclip/control',ownerFile=controlRoot+'/.native-plan-collection-owner.json',ownedControls=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code});};
const identity=stat=>({dev:stat.dev,ino:stat.ino,uid:stat.uid,mode:stat.mode&0o777});

/** Claim only an absent root, before imports/PG initialization or fixture writes. Never adopt existing state. */
export function claimNativePlanControl(){
 assert.equal(process.env.SUPER_AGENT_OFFLINE_NATIVE_CONTRACT,'1');assert.ok(process.env.PAPERCLIP_HOME.startsWith('/tmp/'));
 try{fs.lstatSync(controlRoot);fail('NATIVE_PLAN_FIXTURE_CONTROL_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
 try{fs.mkdirSync(controlRoot,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('NATIVE_PLAN_FIXTURE_CONTROL_EXISTS');throw error;}
 const directory=fs.lstatSync(controlRoot),bytes=Buffer.from(JSON.stringify({ownerToken:randomUUID(),directory:identity(directory)})+'\n');
 fs.writeFileSync(ownerFile,bytes,{flag:'wx',mode:0o600});
 const owner=Object.freeze({});ownedControls.set(owner,{directory:identity(directory),marker:identity(fs.lstatSync(ownerFile)),bytes});return owner;
}

function verifyNativePlanControl(owner){
 const expected=ownedControls.get(owner);if(!expected)fail('NATIVE_PLAN_FIXTURE_CONTROL_CHANGED');
 let directory,marker;try{directory=fs.lstatSync(controlRoot);marker=fs.lstatSync(ownerFile);}catch{fail('NATIVE_PLAN_FIXTURE_CONTROL_CHANGED');}
 if(!directory.isDirectory()||directory.isSymbolicLink()||fs.realpathSync(controlRoot)!==controlRoot||!marker.isFile()||marker.isSymbolicLink()||marker.nlink!==1||
  JSON.stringify(identity(directory))!==JSON.stringify(expected.directory)||JSON.stringify(identity(marker))!==JSON.stringify(expected.marker)||!fs.readFileSync(ownerFile).equals(expected.bytes))fail('NATIVE_PLAN_FIXTURE_CONTROL_CHANGED');
}

/** Only the same in-process claim, directory identity and private marker authorize recursive retirement. */
export function retireNativePlanControl(owner){verifyNativePlanControl(owner);fs.rmSync(controlRoot,{recursive:true});ownedControls.delete(owner);}

/** Real Native repository/controller and AdmissionMeter; all state belongs to a networkless disposable container. */
export async function nativePlanCollectionFixture(t,{foreignGeneration=false}={}){
 assert.equal(process.env.SUPER_AGENT_OFFLINE_NATIVE_CONTRACT,'1');assert.ok(process.env.PAPERCLIP_HOME.startsWith('/tmp/'));
 const controlOwner=claimNativePlanControl();
 const f=controlledPreflight(fixture(t)),s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js');
 const {heartbeatService}=await import(P+'/@paperclipai/server/dist/services/heartbeat.js');
 const {issueService}=await import(P+'/@paperclipai/server/dist/services/issues.js');
 const registry=await import(P+'/@paperclipai/server/dist/adapters/registry.js');
 execFileSync('id',['-u','postgres']);const {default:EmbeddedPostgres}=await import(P+'/embedded-postgres/dist/index.js');
 await(await import(P+'/@paperclipai/db/dist/embedded-postgres-native.js')).prepareEmbeddedPostgresNativeRuntime();
 (await import(P+'/@paperclipai/db/dist/test-embedded-postgres.js')).__setEmbeddedPostgresCtorProviderForTests(async()=>class extends EmbeddedPostgres{constructor(options){super({...options,createPostgresUser:true});}});
 const pg=await s.startEmbeddedPostgresTestDatabase('sa-plan-collection-'),db=s.createDb(pg.connectionString),issue=issueService(db),heartbeat=heartbeatService(db);
 const events=[],log=e=>events.push(e),cwd='/tmp/sa-plan-source';fs.mkdirSync(cwd,{recursive:true});execFileSync('git',['init',cwd],{stdio:'ignore'});
 fs.mkdirSync(R,{mode:0o700});
 const now=Date.now(),storage=createHostStorageReceipt({hostPlatform:'darwin',capturedAt:new Date(now).toISOString(),externalFilesystem:'apfs',dfPk:'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 50000000 1000000 49000000 2% /\n/dev/data 50000000 1000000 49000000 2% /Volumes/SuperAgentDockerData\n'},{now});
 assert.equal(storage.allowed,true);write('/host-evidence/host-storage.json',storage);
 const meter=new AdmissionMeter({filename:ledger,allowedProjectIds:[f.task.projectId],log});
 const old=meter.reserveTask({taskId:f.task.id,projectId:f.task.projectId,storageReceipt:storage});assert.equal(old.allowed,true);
 meter.release({...old,terminalEvidence:true});f.registry.lease.nonce=old.nonce;
 const phase=()=>{const sqlite=new DatabaseSync(ledger,{readOnly:true});try{return sqlite.prepare('SELECT a.task_id AS taskId,m.project_id AS projectId,a.nonce FROM admission_lease a JOIN admission_meter m ON a.task_id=m.task_id').all();}finally{sqlite.close();}};
 Object.assign(f.task,{status:'in_review',assigneeAgentId:null,assigneeUserId:f.registry.ownerId});
 Object.assign(f.run,{status:'succeeded',startedAt:new Date(now-20000),finishedAt:new Date(now-10000),exitCode:0});
 f.control={...f.control,revision:0,reviewBeforeDispatch:false,approvedPlanSha256:null,checkpoints:[],inputSequence:0};
 for(const role of Object.keys(TEAM_ROLES))f.registry.team.ids[role]??=randomUUID();
 f.registry.agents=Object.entries(f.registry.team.ids).map(([role,agentId])=>({profile:{role,agentId}}));
 f.registry.context.catalog.projects[0].allowedRoles=Object.keys(TEAM_ROLES);
 write(R+'/registry.json',f.registry);write(R+'/team/workflows/old.json',f.flow);
 write(R+'/team/host-observations.json',{kind:'macos-host-observation',hostPlatform:'darwin',capturedAt:new Date().toISOString(),source:'synthetic offline contract; no real host observation claim'});
 for(let index=0;index<5;index++)write(R+'/budget/'+f.task.id+'/'+randomUUID()+'.json',{rootTaskId:f.task.id,existing:true});
 write(R+'/operations/'+f.operation.id+'.json',{operationId:f.operation.id,runId:f.run.id,taskId:f.task.id,rootTaskId:f.task.id});
 write(R+'/permits/'+f.run.id+'.json',{cwd:f.workspaceCwd,projectId:f.task.projectId});
 const prefix=foreignGeneration?f.operation.outputPrefix.replace(f.operation.artifactGeneration,randomUUID()):f.operation.outputPrefix;
 const plan={schemaVersion:1,tasks:[['research','research',[]],['architect','architect',['research']],['document','document-specialist',['architect']],['qa','qa',['document']]].map(([key,role,dependsOn])=>({key,role,dependsOn,title:'Contract '+key,goal:'Offline collection contract only.',outputFile:prefix+key+(role==='qa'?'.json':'.md')}))};
 const planFile=f.workspaceCwd+'/'+f.operation.planFile;write(planFile,plan);const planBytes=fs.readFileSync(planFile);
 await db.insert(s.authUsers).values({id:f.registry.ownerId,name:'Isolated owner',email:'owner@fixture.invalid',createdAt:new Date(),updatedAt:new Date()});
 await db.insert(s.companies).values({id:f.task.companyId,name:'Plan collection contract',issuePrefix:'COL'});
 for(const [key,role]of Object.entries(TEAM_ROLES))await db.insert(s.agents).values({id:f.registry.team.ids[key],companyId:f.task.companyId,name:role.name,role:role.nativeRole,reportsTo:role.parent?f.registry.team.ids[role.parent]:null,adapterType:'codex_local',adapterConfig:{cwd,model:'gpt-6.1-sol',modelReasoningEffort:'low',env:{OPENAI_API_KEY:'fixture-noncredential'}},runtimeConfig:{heartbeat:{enabled:false}}});
 await db.insert(s.projects).values({id:f.task.projectId,companyId:f.task.companyId,name:'Isolated RWB'});
 await db.insert(s.projectWorkspaces).values({...f.nativeWorkspace,companyId:f.task.companyId,name:'Source',cwd,isPrimary:true});
 await db.insert(s.issues).values(f.task);
 const historicalChildren=[];
 for(const [index,role]of ['architect','qa'].entries()){
  const [child]=await db.insert(s.issues).values({id:randomUUID(),companyId:f.task.companyId,projectId:f.task.projectId,projectWorkspaceId:f.task.projectWorkspaceId,parentId:f.task.id,
   title:'Historical static report '+index,description:'Retained historical evidence.',status:'done',assigneeAgentId:f.registry.team.ids[role],responsibleUserId:f.registry.ownerId,createdByAgentId:f.operation.agentId}).returning();
  historicalChildren.push(child);
 }
 const dates=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value&&key.endsWith('At')?new Date(value):value]));
 await db.insert(s.agentWakeupRequests).values({...f.wakeup,status:'consumed'});
 for(const row of f.taskRuns)await db.insert(s.heartbeatRuns).values(dates(row));
 for(const row of f.leases)await db.insert(s.environmentLeases).values(dates({...row,companyId:f.task.companyId,issueId:f.task.id,provider:'local'}));
 await db.insert(s.activityLog).values({companyId:f.task.companyId,actorType:'user',actorId:f.registry.ownerId,action:'team.context.control',entityType:'issue',entityId:f.task.id,details:{_eventSequence:3,value:{schemaVersion:1,...f.control}}});
 const ports={db,schema:s,orm:o,issue,heartbeat},database=async()=>ports;
 const binding={appId:'cli_fixture',tenantKey:'tenant_fixture',ownerOpenId:'ou_owner',nativeOwnerId:f.registry.ownerId,companyId:f.task.companyId,projectId:f.task.projectId,chiefAgentId:f.operation.agentId};
 const catalog=createProjectCatalog({registry:f.registry.context.catalog,authority:{companyId:f.task.companyId,ownerId:f.registry.ownerId,agentIds:f.registry.team.ids},log});
 const repository=await createChiefContextPaperclipRepository({database,binding,catalog,log});
 const controller=createChiefContextController({binding,catalog,repository,knowledgeStore:Object.fromEntries(['remember','correct','query','history'].map(key=>[key,async()=>assert.fail('knowledge must not be consulted')])),acknowledge:async()=>assert.fail('no owner notification is required'),registerNewGoal:async()=>assert.fail('never replan success'),log});
 let captured,resolveCapture,finishAdapter;const reached=new Promise(resolve=>{resolveCapture=resolve;}),hold=new Promise(resolve=>{finishAdapter=resolve;});
 const original=registry.getServerAdapter('codex_local'),executions=[];
 registry.registerServerAdapter({...original,execute:async ctx=>{executions.push({runId:ctx.runId,agentId:ctx.agent.id});captured={runId:ctx.runId,agentId:ctx.agent.id,phase:phase(),registry:JSON.parse(fs.readFileSync(R+'/registry.json'))};resolveCapture(captured);await hold;return{exitCode:1,signal:null,errorCode:'OFFLINE_COLLECTION_STOP',errorMessage:'No-provider contract stop',resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};}});
 const coordinator=startTeamCoordinator({database,nativePorts:async()=>ports,contextRuntime:{syncTask:controller.syncTask,checkpoint:controller.checkpoint}});
 coordinator.stop(); // Drive the original public tick deterministically instead of a second concurrent interval.
 t.after(async()=>{verifyNativePlanControl(controlOwner);coordinator.stop();finishAdapter();await heartbeat.drainActiveRunExecutions();registry.unregisterServerAdapter('codex_local');const lease=phase()[0];if(lease)meter.release({...lease,terminalEvidence:true});meter.close();await pg.cleanup();retireNativePlanControl(controlOwner);fs.rmSync(f.workspaceCwd,{recursive:true});});
 return{f,db,s,o,coordinator,events,phase,oldNonce:old.nonce,plan,planFile,planBytes,executions,reached,historicalChildren,control:async()=>readManagedChiefContext({db,schema:s,orm:o,task:await issue.getById(f.task.id),companyId:f.task.companyId,ownerId:f.registry.ownerId}),
  children:()=>db.select().from(s.issues).where(o.eq(s.issues.parentId,f.task.id)),rootRuns:()=>db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.issueId,f.task.id)),budget:()=>fs.readdirSync(R+'/budget/'+f.task.id).sort().map(name=>[name,sha(fs.readFileSync(R+'/budget/'+f.task.id+'/'+name))]),
  workflowFile:R+'/team/workflows/'+f.run.id+'.json',runtimeEvents:()=>fs.readFileSync(R+'/events.jsonl','utf8').trim().split('\n').map(JSON.parse)};
}
