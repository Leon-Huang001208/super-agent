/** Serial Native lifecycle verification, never direct status-row edits. */
import fs from'node:fs';import{randomUUID}from'node:crypto';import{AdmissionMeter}from'/opt/super-agent/role/bridge/admission.mjs';
const R='/paperclip/control/research-pm',P='/opt/paperclip/node_modules';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const write=(p,v)=>{const t=p+'.'+randomUUID()+'.tmp';fs.writeFileSync(t,JSON.stringify(v)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(t,p);};
if(process.platform!=='linux'||process.getuid()!==0||!process.argv.includes('--apply'))throw Error('TEAM_BOOTSTRAP_EXPLICIT_APPLY_REQUIRED');
const url='postgres://paperclip:'+encodeURIComponent(fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim())+'@db:5432/paperclip';process.env.DATABASE_URL=url;
const s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js');const db=s.createDb(url,{maxConnections:2});let meter;
try{
let r=read(R+'/registry.json');const ids=r.team?.ids;if(!ids||Object.keys(ids).length!==11||r.team.enabled!==false||fs.existsSync(R+'/call.lock'))throw Error('TEAM_BOOTSTRAP_SCOPE_CHANGED');
const active=await db.select().from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));if(active.length)throw Error('TEAM_BOOTSTRAP_NATIVE_BUSY');
meter=new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[r.projectId],log:e=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...e})+'\n',{mode:0o600})});
const intentFile=R+'/team-bootstrap.intent.json';let intent;if(fs.existsSync(intentFile))intent=read(intentFile);else{intent={schemaVersion:1,at:new Date().toISOString(),roles:Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,{agentId:id,taskId:randomUUID(),operationId:randomUUID()}]))};write(intentFile,intent);}
const issue=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db),lifecycle=(await import(P+'/@paperclipai/server/dist/services/agent-lifecycle.js')).createAgentLifecycle(db);
const results=fs.existsSync(R+'/team-bootstrap.receipts.json')?read(R+'/team-bootstrap.receipts.json'):{};
if(meter.verifyLease(r.lease).allowed){
 const task=await issue.getById(r.lease.taskId);const chief=intent.roles.chief;
 if(task.id===chief.taskId&&fs.readdirSync(R+'/budget/'+task.id).length===0){
  const[a]=await db.select().from(s.agents).where(o.eq(s.agents.id,chief.agentId));if(a.lifecycleState!=='ready'||a.status!=='idle')throw Error('TEAM_BOOTSTRAP_CHIEF_STATE_UNKNOWN');
  await issue.addComment(task.id,'Native resumed its previous ready state without a new provider probe. This setup check is cancelled rather than claiming a new hello test. The first real Chief execution remains required.',{userId:r.ownerId});await issue.update(task.id,{status:'cancelled'});
  results.chief={agentId:a.id,name:a.name,status:'REUSED_NATIVE_READY',environmentProbe:'NOT_RUN',newModelCalls:0};write(R+'/team-bootstrap.receipts.json',results);
 }else if(task.status!=='in_review'||task.assigneeUserId!==r.ownerId)throw Error('TEAM_BOOTSTRAP_PRIOR_TASK_NOT_WAITING');
 write(R+'/pre-team-phase-release.json',{taskId:task.id,status:task.status,at:new Date().toISOString(),reason:'No active role process or unknown call; known phase authority released.'});meter.release({...r.lease,terminalEvidence:true});
}
for(const[key,setup]of Object.entries(intent.roles)){
 const[a]=await db.select().from(s.agents).where(o.eq(s.agents.id,setup.agentId));if(!a||a.companyId!==r.companyId||setup.agentId!==ids[key])throw Error('TEAM_BOOTSTRAP_ID_CHANGED');
 if(results[key]){if(a.lifecycleState!=='ready')throw Error('TEAM_BOOTSTRAP_READY_CHANGED');continue;}
 if(['research','pm'].includes(key)&&a.lifecycleState==='ready'){results[key]={agentId:a.id,name:a.name,status:'REUSED_READY',newModelCalls:0};write(R+'/team-bootstrap.receipts.json',results);console.log(JSON.stringify({role:key,status:'REUSED_READY'}));continue;}
 if(a.lifecycleState!=='paused')throw Error('TEAM_BOOTSTRAP_RECONCILE_REQUIRED');
 const lease=meter.reserveTask({taskId:setup.taskId,projectId:r.projectId,storageReceipt:read('/host-evidence/host-storage.json')});if(!lease.allowed)throw Error('TEAM_BOOTSTRAP_ADMISSION_DENIED');
 const task=await issue.getById(setup.taskId)??await issue.create(r.companyId,{id:setup.taskId,projectId:r.projectId,title:'Environment verification: '+a.name,description:'Verify the fixed Docker Codex subscription environment for '+a.name+'. This is onboarding only; no domain work, RWB change or deployment.',status:'todo',responsibleUserId:r.ownerId,createdByUserId:r.ownerId,assigneeUserId:r.ownerId,actorResponsibleUserId:r.ownerId,trustExplicitResponsibleUserId:true,idempotencyKey:'role-bootstrap:'+setup.operationId,allowDuplicate:false});
 r=read(R+'/registry.json');r.taskId=task.id;if(!r.tasks.includes(task.id))r.tasks.push(task.id);r.lease={taskId:task.id,projectId:r.projectId,nonce:lease.nonce};if(!r.operations.some(x=>x.id===setup.operationId))r.operations.push({id:setup.operationId,kind:'probe',taskId:task.id,agentId:a.id,role:key});if(!fs.existsSync(R+'/budget/'+task.id))fs.mkdirSync(R+'/budget/'+task.id,{mode:0o700});write(R+'/registry.json',r);
 const startedAt=Date.now();console.log(JSON.stringify({role:key,taskId:task.id,status:'VERIFYING'}));await lifecycle.resumeAgent(a.id);
 let current;for(;;){[current]=await db.select().from(s.agents).where(o.eq(s.agents.id,a.id));if(current.lifecycleState==='ready')break;if(current.lifecycleError||Date.now()-startedAt>180000)throw Error('TEAM_BOOTSTRAP_PROVIDER_OR_LIFECYCLE_BLOCKED');await new Promise(resolve=>setTimeout(resolve,1000));}
 if(fs.existsSync(R+'/call.lock'))throw Error('TEAM_BOOTSTRAP_CALL_RESULT_UNKNOWN');
 const events=fs.readFileSync(R+'/events.jsonl','utf8').trim().split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});const event=events.findLast(e=>e.code==='NATIVE_ROLE_PROBE_FINISHED'&&e.agentId===a.id&&Date.parse(e.at)>=startedAt);if(event?.status!=='pass')throw Error('TEAM_BOOTSTRAP_PROBE_PROOF_MISSING');
 const proof=read(R+'/probes/'+event.probeId+'/result.json');if(proof.exitCode!==0||proof.timedOut||proof.interrupted||proof.spawnFailed)throw Error('TEAM_BOOTSTRAP_PROBE_NOT_SUCCESS');
 await issue.update(task.id,{status:'done'});meter.release({...r.lease,terminalEvidence:true});results[key]={agentId:a.id,name:current.name,status:'READY',taskId:task.id,probeId:event.probeId,model:'gpt-6.1-sol',reasoningEffort:'low',at:new Date().toISOString(),calls:fs.readdirSync(R+'/budget/'+task.id).length};write(R+'/team-bootstrap.receipts.json',results);console.log(JSON.stringify({role:key,status:'READY',probeId:event.probeId}));
}
console.log(JSON.stringify({readyRoles:Object.keys(results).length,status:'NATIVE_READINESS_CHECKED',businessAcceptance:'NOT_RUN'}));
}finally{meter?.close();await s.closeRegisteredClients(url)}
