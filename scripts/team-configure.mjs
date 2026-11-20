/** Explicit owner-authorized metadata configuration; all new roles start paused. */
import {roleExecutionPolicy,roleAdapterArgs,isMacNative} from '../bridge/role-execution-policy.mjs';
import fs from'node:fs';import{randomUUID,createHash}from'node:crypto';
import{TEAM_ROLES,roleInstructions,validateTeamRoster}from'/opt/super-agent/role/bridge/team-roles.mjs';
const R='/paperclip/control/research-pm',P='/opt/paperclip/node_modules',sha=b=>createHash('sha256').update(b).digest('hex');
const write=(p,data)=>{const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(data)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
if(process.platform!=='linux'||process.getuid()!==0||!process.argv.includes('--apply'))throw Error('TEAM_CONFIG_EXPLICIT_DOCKER_APPLY_REQUIRED');
const url='postgres://paperclip:'+encodeURIComponent(fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim())+'@db:5432/paperclip';process.env.DATABASE_URL=url;
const s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js');const db=s.createDb(url,{maxConnections:2});
try{
const r=JSON.parse(fs.readFileSync(R+'/registry.json'));if(r.companyId!=='85f89b59-f73a-450d-8676-4afcab409fb0'||r.ownerId!=='n6MxHj1whoJQggkbVPBdXUpybvBaa7RI')throw Error('TEAM_CONFIG_OWNER_CHANGED');
if(fs.existsSync(R+'/team-configuration.receipt.json'))throw Error('TEAM_CONFIG_ALREADY_APPLIED_USE_READONLY_STATUS');
const active=await db.select().from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));if(active.length||fs.existsSync(R+'/call.lock'))throw Error('TEAM_CONFIG_ACTIVE_EXECUTION');
const before=await db.select().from(s.agents).where(o.eq(s.agents.companyId,r.companyId));const beforeRuns=(await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns)).length;
const intentFile=R+'/team-configuration.intent.json';let intent;
if(fs.existsSync(intentFile))intent=JSON.parse(fs.readFileSync(intentFile));else{
 const ids={chief:'f51255a4-edf9-4d7c-95f5-ab929233b148',research:r.researchId,pm:r.pmId};for(const key of Object.keys(TEAM_ROLES))ids[key]??=randomUUID();
 if(before.some(a=>!Object.values(ids).includes(a.id)))throw Error('TEAM_CONFIG_FOREIGN_AGENT');
 intent={schemaVersion:1,companyId:r.companyId,ownerId:r.ownerId,projectId:r.projectId,ids,materials:Object.fromEntries(Object.keys(TEAM_ROLES).map(k=>[k,randomUUID()+'.md'])),at:new Date().toISOString()};write(intentFile,intent);write(R+'/team-config-original.private.json',{registry:r,agents:before});
}
if(intent.companyId!==r.companyId||intent.ownerId!==r.ownerId||Object.keys(intent.ids).length!==11)throw Error('TEAM_CONFIG_INTENT_CHANGED');
const original=JSON.parse(fs.readFileSync(R+'/team-config-original.private.json'));
r.team={schemaVersion:1,ids:intent.ids,enabled:false,projectId:intent.projectId};r.materialHistory??=[];r.policy={newTasksPerShanghaiDay:null,concurrentExecutions:1,maxRootRoleCalls:6,maxResponsesPerRun:64,maxFixRounds:2};
for(const[key,role]of Object.entries(TEAM_ROLES)){
 const id=intent.ids[key],prior=original.registry.agents.find(x=>x.profile.agentId===id),filename=intent.materials[key];
 let text=roleInstructions(key);
 if(key==='pm'&&prior){const old=prior.manifest.instructionsFilePath;const bytes=fs.readFileSync(R+'/materials/'+old);if(sha(bytes)!==prior.manifest.files.find(x=>x.path===old)?.sha256)throw Error('TEAM_CONFIG_PRIOR_MATERIAL_CHANGED');text+='\n\nPreviously verified Product Manager coaching material (retained):\n'+bytes.toString();}
 const bytes=Buffer.from(text),p=R+'/materials/'+filename;
 if(fs.existsSync(p)){if(sha(fs.readFileSync(p))!==sha(bytes))throw Error('TEAM_CONFIG_MATERIAL_CHANGED');}else fs.writeFileSync(p,bytes,{flag:'wx',mode:0o600});
 if(prior&&!r.materialHistory.some(x=>x.agentId===id))r.materialHistory.push({agentId:id,manifest:prior.manifest});
 const profile={projectId:intent.projectId,projectKey:'personal-automation-m1',agentId:id,role:key,engine:'codex_local',model:'gpt-6.1-sol',reasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:false,sandbox:'workspace-write',tools:['read_materials','read_sources','shell','apply_patch','apps','plugins']};
 const entry={profile,manifest:{schemaVersion:1,project:profile.projectKey,role:key,instructionsFilePath:filename,requiredReferences:[],files:[{path:filename,sha256:sha(bytes)}]}};
 r.agents=r.agents.filter(x=>x.profile.agentId!==id);r.agents.push(entry);
 const work=R+'/workspaces/'+key;if(!fs.existsSync(work))fs.mkdirSync(work,{mode:0o700});
}
write(R+'/registry.team-config.tmp',r);fs.renameSync(R+'/registry.team-config.tmp',R+'/registry.json');
const lifecycle=(await import(P+'/@paperclipai/server/dist/services/agent-lifecycle.js')).createAgentLifecycle(db);
for(const[key,role]of Object.entries(TEAM_ROLES)){
 const id=intent.ids[key],material=R+'/materials/'+intent.materials[key],existing=before.find(x=>x.id===id);
 const configuredProfile=r.agents.find(value=>value.profile.agentId===id).profile,native=isMacNative(configuredProfile);
 const config={name:role.name,title:role.name,role:role.nativeRole,reportsTo:role.parent?intent.ids[role.parent]:null,capabilities:role.duty,adapterType:'codex_local',
  adapterConfig:{engine:'cli',command:'/opt/super-agent/bin/codex',cwd:R+'/workspaces/'+key,instructionsFilePath:material,model:'gpt-6.1-sol',modelReasoningEffort:'low',search:true,dangerouslyBypassApprovalsAndSandbox:native,dangerouslyBypassSandbox:native,extraArgs:roleAdapterArgs(configuredProfile),...(configuredProfile.executionPolicy?{executionPolicy:roleExecutionPolicy(configuredProfile)}:{}),env:{SUPER_AGENT_ROLE_ENABLED:'true',SUPER_AGENT_ROLE_AGENT_ID:id}},
  runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:true,maxConcurrentRuns:1,maxDailyRuns:60},aiConnection:{mode:'responsible_user',method:'subscription',provider:'openai'}}};
 if(existing)await lifecycle.updateConfiguration(id,config);
 else await lifecycle.requestHire(r.companyId,{id,...config,status:'paused',spentMonthlyCents:0,budgetMonthlyCents:0},{createdByUserId:r.ownerId,responsibleUserId:r.ownerId});
}
const after=await db.select().from(s.agents).where(o.eq(s.agents.companyId,r.companyId));const rows=after.map(a=>({key:Object.keys(intent.ids).find(k=>intent.ids[k]===a.id),id:a.id,name:a.name,reportsTo:a.reportsTo,adapterType:a.adapterType,model:a.adapterConfig.model,reasoningEffort:a.adapterConfig.modelReasoningEffort,heartbeatEnabled:a.runtimeConfig.heartbeat.enabled,status:a.status,lifecycle:a.lifecycleState,instructionsFilePath:a.adapterConfig.instructionsFilePath}));validateTeamRoster(rows);
const added=after.filter(a=>!original.agents.some(b=>b.id===a.id));if(added.some(a=>a.lifecycleState!=='paused'||a.status!=='paused'))throw Error('TEAM_CONFIG_UNEXPECTED_BOOTSTRAP');
const afterRuns=(await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns)).length;if(afterRuns!==beforeRuns||fs.existsSync(R+'/call.lock'))throw Error('TEAM_CONFIG_UNEXPECTED_EXECUTION');
write(R+'/team-configuration.receipt.json',{schemaVersion:1,at:new Date().toISOString(),roles:rows,added:added.map(a=>a.id),reused:[intent.ids.chief,intent.ids.research,intent.ids.pm],newModelCalls:0,newRuns:afterRuns-beforeRuns,chiefEnabled:false});
console.log(JSON.stringify({configuredRoles:rows.length,newPaused:added.length,reused:3,newRuns:afterRuns-beforeRuns,newModelCalls:0,chiefEnabled:false}));
}finally{await s.closeRegisteredClients(url)}
