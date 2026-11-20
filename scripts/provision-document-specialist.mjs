/** Add one owner-authorized role. Preview never hires, probes or changes a listener. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';
import {TEAM_ROLES,roleInstructions} from '../bridge/team-roles.mjs';
import {renderRoleCapabilitiesMarkdown} from '../bridge/role-capabilities.mjs';
import {ROLE_SKILL_BUNDLES} from '../bridge/role-skill-bundles.mjs';
import {resolveRoleSkillAssignments,resolveCompanyRoleSkills,rolePermissions} from '../bridge/company-role-skills.mjs';
import {planContextConfiguration} from '../bridge/context-configuration.mjs';
import {readRoleInstructionBundle} from '../bridge/role-instruction-store.mjs';
import {ROLE_ROOT,readControl,writeControl,editRoleRegistry} from '../bridge/role-control-store.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';
import {AdmissionMeter} from '../bridge/admission.mjs';

const ROLE='document-specialist',ACTIVE=['running','queued','scheduled_retry'];
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=value=>sha(canonical(value));
const fields=(value,names)=>Object.fromEntries(names.map(name=>[name,value[name]]));

export function provisionDocumentOptions(args){
 if(args.some(arg=>!['--apply','--verify','--preview'].includes(arg))||new Set(args).size!==args.length)fail('DOC_PROVISION_ARGUMENT_INVALID');
 return{apply:args.includes('--apply')&&!args.includes('--preview'),verify:args.includes('--verify')};
}
export function assertDocumentWindow(state,intent,{allowOwnLease=false}={}){
 if(state.registry?.team?.enabled!==false||state.feishuEnabled===true||state.callLock||state.activeRuns?.length)fail('DOC_PROVISION_OWNER_WINDOW_REQUIRED');
 if(state.flags?.SUPER_AGENT_ROLE_RUNTIME_ENABLED!=='true')fail('DOC_PROVISION_ROLE_RUNTIME_DISABLED');
 if(!isDeepStrictEqual([...(state.sourceRoles??[])].sort(),[...ROLE_KEYS].sort())||!ROLE_KEYS.includes(ROLE)||!TEAM_ROLES[ROLE])fail('DOC_PROVISION_RUNTIME_SOURCE_UNSUPPORTED');
 for(const lease of state.admissionLeases??[])if(!allowOwnLease||lease.taskId!==intent?.verification?.taskId||lease.nonce!==intent?.verification?.lease?.nonce)fail('DOC_PROVISION_FOREIGN_ADMISSION_LEASE');
 if(state.company?.requireBoardApprovalForNewAgents!==false)fail('DOC_PROVISION_NATIVE_HIRE_APPROVAL_REQUIRED');
 if(state.ownerCanCreateAgents!==true)fail('DOC_PROVISION_OWNER_PERMISSION_REQUIRED');
}
function oldContext(context){const result=structuredClone(context);if(!result)return result;for(const project of result.catalog?.projects??[])project.allowedRoles=project.allowedRoles.filter(role=>role!==ROLE);for(const key of ['materials','legacyKnowledge'])for(const roles of Object.values(result[key]??{}))delete roles[ROLE];return result;}
export function documentExistingSnapshot(state){
 const registry=state.registry,ids=Object.entries(registry.team.ids).filter(([role])=>role!==ROLE);
 return json({companyId:registry.companyId,ownerId:registry.ownerId,taskId:registry.taskId,policy:registry.policy,
  controls:{enabled:registry.enabled,teamEnabled:registry.team.enabled,contextEnabled:registry.context?.enabled,flags:state.flags},
  ids:Object.fromEntries(ids),entries:registry.agents.filter(entry=>entry.profile.role!==ROLE),context:oldContext(registry.context),
  agents:ids.map(([role,id])=>{const agent=state.agents.find(agent=>agent.id===id);if(!agent)fail('DOC_PROVISION_EXISTING_AGENT_MISSING');return{role,...fields(agent,['id','companyId','name','title','role','reportsTo','adapterType','adapterConfig','runtimeConfig','permissions','status','lifecycleState'])};})});
}
function assertBefore(state,intent){if(digest(documentExistingSnapshot(state))!==intent.beforeHash)fail('DOC_PROVISION_EXISTING_STATE_CHANGED');}
function validateNewAgent(agent,intent){
 if(!agent||agent.id!==intent.agentId||agent.companyId!==intent.companyId||agent.name!==TEAM_ROLES[ROLE].name||agent.role!==TEAM_ROLES[ROLE].nativeRole||agent.reportsTo!==intent.chiefId||agent.adapterType!=='codex_local'||agent.adapterConfig.model!=='gpt-6.1-sol'||agent.adapterConfig.modelReasoningEffort!=='low')fail('DOC_PROVISION_NEW_AGENT_CHANGED');
}
const documentConfigSnapshot=agent=>json(fields(agent,['id','companyId','name','title','role','reportsTo','adapterType','adapterConfig','runtimeConfig','permissions']));
function documentRegistrySnapshot(registry){return json({agentId:registry.team.ids[ROLE],entry:registry.agents.find(entry=>entry.profile.role===ROLE),projects:registry.context.catalog.projects.map(project=>({projectId:project.projectId,allowed:project.allowedRoles.includes(ROLE),materials:registry.context.materials[project.projectId]?.[ROLE],legacyKnowledge:registry.context.legacyKnowledge[project.projectId]?.[ROLE]}))});}
function plainValue(value){return typeof value==='string'?value:value?.type==='plain'?value.value:undefined;}
function assertDocumentPolicy(agent,intent){
 const config=agent.adapterConfig,spec=intent.spec;
 if(config.command!==spec.adapterConfig.command||config.engine!=='cli'||config.dangerouslyBypassApprovalsAndSandbox!==true||config.dangerouslyBypassSandbox!==true||!Array.isArray(config.extraArgs)||config.extraArgs.length||!isDeepStrictEqual(config.executionPolicy,intent.profile.executionPolicy)||plainValue(config.env?.SUPER_AGENT_ROLE_ENABLED)!=='true'||plainValue(config.env?.SUPER_AGENT_ROLE_AGENT_ID)!==intent.agentId||!isDeepStrictEqual(agent.runtimeConfig?.aiConnection,spec.runtimeConfig.aiConnection)||Object.entries(rolePermissions(ROLE)).some(([key,value])=>agent.permissions?.[key]!==value))fail('DOC_PROVISION_DOCUMENT_CONFIG_CHANGED');
}
export function assertDocCurrentState(intent,state,{requireReady=false}={}){
 const agent=state.agents.find(value=>value.id===intent.agentId);validateNewAgent(agent,intent);assertDocumentPolicy(agent,intent);
 if(!intent.documentSnapshot||!isDeepStrictEqual(documentConfigSnapshot(agent),intent.documentSnapshot)||!isDeepStrictEqual(agent.adapterConfig.paperclipSkillSync?.desiredSkills,intent.desiredSkills)||!isDeepStrictEqual(documentRegistrySnapshot(state.registry),intent.documentRegistrySnapshot))fail('DOC_PROVISION_DOCUMENT_RECONCILIATION_REQUIRED');
 if(requireReady&&(agent.lifecycleState!=='ready'||agent.status!=='idle'))fail('DOC_PROVISION_DOCUMENT_NOT_READY');
 return agent;
}
export function documentRegistration(registry,entry,projection){
 const result=structuredClone(registry),existing=result.agents.find(value=>value.profile.role===ROLE);
 if(existing&&!isDeepStrictEqual(existing,entry)||result.team.ids[ROLE]&&result.team.ids[ROLE]!==entry.profile.agentId)fail('DOC_PROVISION_REGISTRATION_CHANGED');
 if(!existing)result.agents.push(entry);result.team.ids[ROLE]=entry.profile.agentId;
 for(const project of result.context.catalog.projects){
  if(!projection.context.materials[project.projectId]?.[ROLE]||!projection.context.legacyKnowledge[project.projectId]?.[ROLE])fail('DOC_PROVISION_CONTEXT_PROJECTION_MISSING');
  if(!project.allowedRoles.includes(ROLE))project.allowedRoles.push(ROLE);
  result.context.materials[project.projectId]??={};result.context.materials[project.projectId][ROLE]=projection.context.materials[project.projectId][ROLE];
  result.context.legacyKnowledge[project.projectId]??={};result.context.legacyKnowledge[project.projectId][ROLE]=projection.context.legacyKnowledge[project.projectId][ROLE];
 }
 return result;
}
export function documentProjection({registry,entry,projects,agents,roleBundles,publicRoles,pmAssets,legacyKnowledge,root}){
 const plannedRegistry=structuredClone(registry);plannedRegistry.team.ids[ROLE]=entry.profile.agentId;plannedRegistry.agents=[...plannedRegistry.agents.filter(value=>value.profile.role!==ROLE),entry];
 const request={schemaVersion:1,operationId:randomUUID(),defaultProjectKey:registry.context.catalog.defaultProjectKey,
  projects:registry.context.catalog.projects.map(project=>({...fields(project,['key','aliases','projectId','maximumAction']),...(project.projectWorkspaceId?{projectWorkspaceId:project.projectWorkspaceId}:{})}))};
 const planned=planContextConfiguration({request,registry:plannedRegistry,projects,agents,roleBundles,publicRoles,pmAssets,legacyKnowledge,root});
 return{context:planned.context,files:planned.files.filter(file=>file.area==='materials'?file.path.startsWith('context/')&&file.path.includes('/'+ROLE+'/'):file.area==='legacy'&&file.path.split('/')[1]?.startsWith(ROLE+'-'))};
}

export async function provisionDocumentSpecialist({ports,apply=false,verify=false,uuid=randomUUID,now=()=>new Date().toISOString()}){
 let state=await ports.readState(),intent=await ports.readIntent();
 if(!apply)return{mode:'preview',existingRoles:state.registry.agents.length,alreadyRegistered:Boolean(state.registry.team.ids[ROLE]),needsOwnerWindow:true,needsModelProbe:true,minimumModelCalls:1,
  readiness:'NOT_RUN',runtimeSupportsDocument:state.sourceRoles?.includes(ROLE)===true,researchError:state.agents.some(agent=>agent.id===state.registry.team.ids.research&&agent.status==='error'),stage:verify?'verify':'metadata',intentState:intent?.phase??'not_started'};
 assertDocumentWindow(state,intent);await ports.authorizeOwner(state);
 if(!intent){
  if(state.registry.team.ids[ROLE]||state.agents.some(agent=>agent.name===TEAM_ROLES[ROLE].name||agent.title===TEAM_ROLES[ROLE].name))fail('DOC_PROVISION_FOREIGN_DOCUMENT_AGENT');
  const before=documentExistingSnapshot(state);intent={schemaVersion:1,operationId:uuid(),agentId:uuid(),companyId:state.registry.companyId,ownerId:state.registry.ownerId,chiefId:state.registry.team.ids.chief,
   projectId:state.registry.team.projectId,phase:'planned',before,beforeHash:digest(before),createdAt:now(),verification:{taskId:uuid(),operationId:uuid(),state:'not_started'}};
  if(verify)fail('DOC_PROVISION_METADATA_REQUIRED');await ports.saveIntent(intent);
 }
 if(intent.companyId!==state.registry.companyId||intent.ownerId!==state.registry.ownerId||intent.chiefId!==state.registry.team.ids.chief)fail('DOC_PROVISION_IDENTITY_CHANGED');
 assertBefore(state,intent);
 if(verify){
  if(intent.phase!=='metadata_complete')fail('DOC_PROVISION_METADATA_REQUIRED');
  if(intent.verification.state==='verified'){assertDocCurrentState(intent,state,{requireReady:true});return{mode:'verify',status:'already_verified',agentId:intent.agentId,newModelCalls:0};}
  if(intent.verification.state!=='not_started')fail('DOC_PROVISION_VERIFICATION_RECONCILIATION_REQUIRED');
  const agent=assertDocCurrentState(intent,state);
  if(agent.lifecycleState!=='paused'||agent.status!=='paused')fail('DOC_PROVISION_UNEXPECTED_LIFECYCLE');
  intent.verification.state='reserving';await ports.saveIntent(intent);
  const setup=await ports.reserveVerification(intent,state);Object.assign(intent.verification,setup,{state:'started',startedAt:now()});await ports.saveIntent(intent);
  await ports.startVerification(intent);const proof=await ports.waitVerification(intent);
  state=await ports.readState();assertDocumentWindow(state,intent,{allowOwnLease:true});assertBefore(state,intent);
  if(proof.status!=='pass'||proof.calls!==1||!proof.probeId)fail('DOC_PROVISION_PROBE_NOT_VERIFIED');
  assertDocCurrentState(intent,state,{requireReady:true});
  await ports.releaseVerification(intent,proof);intent.verification={...intent.verification,state:'verified',probeId:proof.probeId,calls:proof.calls,completedAt:now()};await ports.saveIntent(intent);
  return{mode:'verify',status:'ready',agentId:intent.agentId,diagnostic:'existing Native lifecycle subscription hello',newModelCalls:1,businessFilesAcceptance:'NOT_RUN',researchError:intent.before.agents.some(agent=>agent.id===intent.before.ids.research&&agent.status==='error')};
 }
 if(intent.phase==='metadata_complete'){assertDocCurrentState(intent,state,{requireReady:intent.verification.state==='verified'});return{mode:'apply',status:'already_provisioned',agentId:intent.agentId,newModelCalls:0,needsModelProbe:intent.verification.state!=='verified'};}
 let agent=state.agents.find(agent=>agent.id===intent.agentId);
 if(!agent){
  if(intent.phase!=='planned')fail('DOC_PROVISION_HIRE_RESULT_UNKNOWN');
  const template=state.agents.find(agent=>agent.id===intent.chiefId),binding=template?.runtimeConfig?.aiConnection;
  if(binding?.mode!=='responsible_user'||binding.method!=='subscription'||binding.provider!=='openai')fail('DOC_PROVISION_SUBSCRIPTION_TEMPLATE_REQUIRED');
  const profile=state.registry.agents.find(entry=>entry.profile.agentId===intent.chiefId)?.profile;
  if(profile?.executionPolicy?.executor!=='macos_native'||profile.sandbox!=='none')fail('DOC_PROVISION_NATIVE_TEMPLATE_REQUIRED');
  intent.profile={...structuredClone(profile),role:ROLE,agentId:intent.agentId,projectId:intent.projectId,projectKey:profile.projectKey};
  intent.spec={id:intent.agentId,name:TEAM_ROLES[ROLE].name,title:TEAM_ROLES[ROLE].name,role:TEAM_ROLES[ROLE].nativeRole,reportsTo:intent.chiefId,status:'paused',capabilities:TEAM_ROLES[ROLE].duty,permissions:rolePermissions(ROLE),adapterType:'codex_local',budgetMonthlyCents:0,spentMonthlyCents:0,
   adapterConfig:{engine:'cli',command:'/opt/super-agent/bin/codex',cwd:ROLE_ROOT+'/workspaces/'+ROLE,model:'gpt-6.1-sol',modelReasoningEffort:'low',search:true,dangerouslyBypassApprovalsAndSandbox:true,dangerouslyBypassSandbox:true,extraArgs:[],executionPolicy:structuredClone(profile.executionPolicy),env:{SUPER_AGENT_ROLE_ENABLED:'true',SUPER_AGENT_ROLE_AGENT_ID:intent.agentId}},
   runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:true,maxConcurrentRuns:1,maxDailyRuns:template.runtimeConfig.heartbeat?.maxDailyRuns??60},aiConnection:structuredClone(binding)},metadata:{superAgentDocumentProvision:intent.operationId}};
  intent.connectionInstall=await ports.selectSubscription(intent);intent.phase='hire_requested';await ports.saveIntent(intent);
  agent=await ports.requestPausedHire(intent);intent.phase='hired';await ports.saveIntent(intent);
 }
 validateNewAgent(agent,intent);if(agent.lifecycleState!=='paused'||agent.status!=='paused')fail('DOC_PROVISION_UNEXPECTED_LIFECYCLE');
 await ports.prepareManagedInstructions(agent);agent=await ports.readAgent(agent.id);
 const selection=resolveRoleSkillAssignments({role:ROLE,companySkills:state.library,includeConditional:true,bundledSkills:ROLE_SKILL_BUNDLES});if(selection.missing.length)fail('DOC_PROVISION_SKILL_MISSING');
 resolveCompanyRoleSkills({agent:{...agent,adapterConfig:{...agent.adapterConfig,paperclipSkillSync:{desiredSkills:selection.desiredSkills}}},role:ROLE,companySkills:state.library,companySkillVersions:state.versions,bundledSkills:ROLE_SKILL_BUNDLES});
 await ports.syncSkills(agent.id,selection.desiredSkills);await ports.updatePermissions(agent.id,rolePermissions(ROLE));
 const entry=await ports.readManagedEntry(agent,intent.profile);intent.entry=entry;intent.desiredSkills=selection.desiredSkills;
 const projection=await ports.projectDocument(state,intent,entry);await ports.writeProjectionFiles(projection.files);
 state=await ports.readState();assertDocumentWindow(state,intent);assertBefore(state,intent);
 await ports.publishRegistration(current=>{const candidate={...state,registry:current};assertBefore(candidate,intent);return documentRegistration(current,entry,projection);});
 state=await ports.readState();assertBefore(state,intent);validateNewAgent(state.agents.find(agent=>agent.id===intent.agentId),intent);
 const configured=state.agents.find(agent=>agent.id===intent.agentId);assertDocumentPolicy(configured,intent);intent.documentSnapshot=documentConfigSnapshot(configured);intent.documentRegistrySnapshot=documentRegistrySnapshot(state.registry);intent.phase='metadata_complete';intent.completedAt=now();await ports.saveIntent(intent);
 return{mode:'apply',status:'metadata_complete',agentId:intent.agentId,skillCount:selection.desiredSkills.length,newModelCalls:0,needsModelProbe:true,receiverRestored:false};
}

function actualServerFlags(){
 const names=['SUPER_AGENT_ROLE_RUNTIME_ENABLED','SUPER_AGENT_TEAM_COORDINATOR_ENABLED','SUPER_AGENT_CHIEF_FEISHU_ENABLED'],matches=[];
 for(const pid of fs.readdirSync('/proc').filter(name=>/^\d+$/.test(name))){try{const args=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0');if(!args.includes('/opt/super-agent/serve.mjs'))continue;const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(value=>[value.slice(0,value.indexOf('=')),value.slice(value.indexOf('=')+1)]));matches.push(Object.fromEntries(names.map(name=>[name,env[name]??null])));}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))fail('DOC_PROVISION_SERVER_ENV_UNREADABLE');}}
 if(matches.length!==1)fail('DOC_PROVISION_SERVER_IDENTITY_UNCLEAR');return matches[0];
}
function immutableFile(filename,bytes){fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});if(fs.existsSync(filename)){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||!fs.readFileSync(filename).equals(bytes))fail('DOC_PROVISION_FILE_CONFLICT');return;}fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o600});}
async function main(args){
 const options=provisionDocumentOptions(args);if(process.platform!=='linux'||process.getuid()!==0)fail('DOC_PROVISION_APPLICATION_CONTAINER_REQUIRED');process.umask(0o077);
 const root=ROLE_ROOT,P='/opt/paperclip/node_modules',intentFile=root+'/document-specialist-provision/intent.private.json';
 const registry=()=>readControl(root+'/registry.json'),api=await createRoleOwnerApi({registry:registry(),requirePaused:options.apply});
 const schema=await import(P+'/@paperclipai/db/dist/index.js'),orm=await import(P+'/drizzle-orm/index.js');
 const url='postgres://paperclip:'+encodeURIComponent(fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim())+'@db:5432/paperclip',db=schema.createDb(url,{maxConnections:2});
 let meter;
 try{
  const access=(await import(P+'/@paperclipai/server/dist/services/access.js')).accessService(db),lifecycle=(await import(P+'/@paperclipai/server/dist/services/agent-lifecycle.js')).createAgentLifecycle(db);
  const instructions=(await import(P+'/@paperclipai/server/dist/services/agent-instructions.js')).agentInstructionsService(db),nativeInstructions=await import(P+'/@paperclipai/server/dist/services/agent-instructions.js');
  const request=(route,body,method='POST')=>api.request(route,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const query=async()=>{
   const r=registry(),[company]=await db.select().from(schema.companies).where(orm.eq(schema.companies.id,r.companyId));
   const flags=actualServerFlags();
   const {DatabaseSync}=await import('node:sqlite');const sqlite=new DatabaseSync('/paperclip/control/admission.sqlite',{readOnly:true});let admissionLeases;try{admissionLeases=sqlite.prepare('SELECT task_id AS taskId,nonce FROM admission_lease').all();}finally{sqlite.close();}
   const projects=(await import(P+'/@paperclipai/server/dist/services/projects.js')).projectService(db);
   const actualRoles=(await import('/opt/super-agent/role/bridge/role-labels.mjs')).ROLE_KEYS;
   return{registry:r,company,agents:await db.select().from(schema.agents).where(orm.eq(schema.agents.companyId,r.companyId)),library:await db.select().from(schema.companySkills).where(orm.eq(schema.companySkills.companyId,r.companyId)),versions:await db.select().from(schema.companySkillVersions).where(orm.eq(schema.companySkillVersions.companyId,r.companyId)),projects:await Promise.all(r.context.catalog.projects.map(project=>projects.getById(project.projectId))),activeRuns:await db.select({id:schema.heartbeatRuns.id}).from(schema.heartbeatRuns).where(orm.inArray(schema.heartbeatRuns.status,ACTIVE)),callLock:fs.existsSync(root+'/call.lock'),admissionLeases,flags,feishuEnabled:flags.SUPER_AGENT_CHIEF_FEISHU_ENABLED==='true',sourceRoles:actualRoles,ownerCanCreateAgents:await access.canUser(r.companyId,r.ownerId,'agents:create')};
  };
  const saveIntent=intent=>{fs.mkdirSync(path.dirname(intentFile),{recursive:true,mode:0o700});writeControl(intentFile,intent);};
  const log=event=>fs.appendFileSync(root+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
  const ports={readState:query,readIntent:async()=>fs.existsSync(intentFile)?readControl(intentFile):null,saveIntent,
   authorizeOwner:async state=>{if(!await access.canUser(state.registry.companyId,state.registry.ownerId,'agents:create'))fail('DOC_PROVISION_OWNER_PERMISSION_REQUIRED');},
   selectSubscription:async intent=>{const service=(await import(P+'/@paperclipai/server/dist/services/ai-connections.js')).aiConnectionService(db);const selected=await service.select({companyId:intent.companyId,agentId:intent.agentId,userId:intent.ownerId,adapterType:'codex_local',binding:intent.spec.runtimeConfig.aiConnection,model:'gpt-6.1-sol',allowUninstalledPersonal:true});return{connectionId:selected.connection.id,createdByUserId:intent.ownerId};},
   requestPausedHire:intent=>lifecycle.requestHire(intent.companyId,intent.spec,{createdByUserId:intent.ownerId,responsibleUserId:intent.ownerId,aiConnectionInstall:intent.connectionInstall}),
   readAgent:async id=>(await db.select().from(schema.agents).where(orm.eq(schema.agents.id,id)))[0],
   prepareManagedInstructions:async agent=>{const files={[ROLE+'/AGENTS.md']:roleInstructions(ROLE),[ROLE+'/CAPABILITIES.md']:renderRoleCapabilitiesMarkdown(ROLE)};const materialized=await instructions.materializeManagedBundle(agent,files,{entryFile:ROLE+'/AGENTS.md',replaceExisting:false});await lifecycle.updateConfiguration(agent.id,{adapterConfig:materialized.adapterConfig},{recordRevision:{createdByUserId:registry().ownerId,source:'document_specialist_provision'}});},
   syncSkills:(id,keys)=>request('/agents/'+id+'/skills/sync',{mode:'replace',desiredSkills:keys}),updatePermissions:(id,permissions)=>request('/agents/'+id+'/permissions',permissions,'PATCH'),
   readManagedEntry:async(agent,profile)=>{const fresh=await ports.readAgent(agent.id),materialRoot=nativeInstructions.resolveManagedInstructionsRoot(fresh),files=[];for(const relative of [ROLE+'/AGENTS.md',ROLE+'/CAPABILITIES.md']){const filename=path.join(materialRoot,relative),stat=fs.lstatSync(filename);if(fs.realpathSync(materialRoot)!==materialRoot||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>262144)fail('DOC_PROVISION_MANAGED_CONTENT_CHANGED');const bytes=fs.readFileSync(filename),expected=relative.endsWith('/AGENTS.md')?roleInstructions(ROLE):renderRoleCapabilitiesMarkdown(ROLE);if(bytes.toString('utf8')!==expected)fail('DOC_PROVISION_MANAGED_CONTENT_CHANGED');files.push({path:relative,sha256:sha(bytes)});}return{profile,materialRoot,manifest:{schemaVersion:1,scope:'generic',project:profile.projectKey,role:ROLE,instructionsFilePath:ROLE+'/AGENTS.md',requiredReferences:[ROLE+'/CAPABILITIES.md'],files}};},
   projectDocument:async(state,intent,entry)=>{const tempRegistry=structuredClone(state.registry);tempRegistry.team.ids[ROLE]=intent.agentId;tempRegistry.agents=[...tempRegistry.agents.filter(value=>value.profile.role!==ROLE),entry];const roleBundles={},publicRoles={};for(const item of tempRegistry.agents){roleBundles[item.profile.role]=readRoleInstructionBundle(item);publicRoles[item.profile.role]={instructions:roleInstructions(item.profile.role),capabilities:renderRoleCapabilitiesMarkdown(item.profile.role)};}const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),assetManifest=JSON.parse(fs.readFileSync(base+'/assets/product-manager-coach.manifest.json')),pmAssets={files:assetManifest.files.map(file=>({...file,contentBase64:fs.readFileSync(base+'/assets/product-manager-coach/'+file.path).toString('base64')}))},legacyBytes=fs.readFileSync(root+'/knowledge.json');return documentProjection({registry:state.registry,entry,projects:state.projects,agents:[...state.agents.filter(value=>value.id!==intent.agentId),await ports.readAgent(intent.agentId)],roleBundles,publicRoles,pmAssets,legacyKnowledge:{...JSON.parse(legacyBytes),sha256:sha(legacyBytes)},root});},
   writeProjectionFiles:async files=>{for(const file of files){const target=file.area==='materials'?root+'/materials/'+file.path:root+'/context/legacy/'+file.path;const bytes=Buffer.from(file.contentBase64,'base64');if(sha(bytes)!==file.sha256)fail('DOC_PROVISION_PROJECTION_CHANGED');immutableFile(target,bytes);}},publishRegistration:async edit=>editRoleRegistry(edit),
   reserveVerification:async(intent,state)=>{const issues=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db);const task=await issues.getById(intent.verification.taskId)??await issues.create(intent.companyId,{id:intent.verification.taskId,projectId:intent.projectId,title:'Document Specialist connection verification',description:'Single owner-authorized subscription connection diagnostic. No business document execution or old Agent changes.',status:'todo',responsibleUserId:intent.ownerId,createdByUserId:intent.ownerId,assigneeUserId:intent.ownerId,actorResponsibleUserId:intent.ownerId,trustExplicitResponsibleUserId:true,idempotencyKey:'document-specialist-probe:'+intent.verification.operationId,allowDuplicate:false});if(task.companyId!==intent.companyId||task.projectId!==intent.projectId||task.responsibleUserId!==intent.ownerId)fail('DOC_PROVISION_PROBE_TASK_CHANGED');meter=new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[intent.projectId],log});const reserved=meter.reserveTask({taskId:task.id,projectId:intent.projectId,storageReceipt:readControl('/host-evidence/host-storage.json')});if(!reserved.allowed)fail('DOC_PROVISION_ADMISSION_DENIED');const lease={taskId:task.id,projectId:intent.projectId,nonce:reserved.nonce};fs.mkdirSync(root+'/budget/'+task.id,{mode:0o700});const previousLease=state.registry.lease;editRoleRegistry(r=>{if(r.operations.some(operation=>operation.kind==='probe'&&operation.agentId===intent.agentId))fail('DOC_PROVISION_PROBE_ALREADY_REGISTERED');r.tasks=[...new Set([...r.tasks,task.id])];r.operations.push({id:intent.verification.operationId,kind:'probe',taskId:task.id,agentId:intent.agentId,role:ROLE});r.lease={...lease,operationId:intent.verification.operationId};return r;});return{lease,previousLeasePresent:Object.hasOwn(state.registry,'lease'),previousLease};},
   startVerification:intent=>lifecycle.resumeAgent(intent.agentId),
   waitVerification:async intent=>{const start=Date.parse(intent.verification.startedAt);for(let n=0;n<180;n++){const agent=await ports.readAgent(intent.agentId);if(agent.lifecycleError)fail('DOC_PROVISION_LIFECYCLE_FAILED');if(agent.lifecycleState==='ready'){if(agent.status!=='idle'||fs.existsSync(root+'/call.lock'))fail('DOC_PROVISION_PROBE_UNSETTLED');const events=fs.readFileSync(root+'/events.jsonl','utf8').trim().split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}}),matches=events.filter(event=>event.code==='NATIVE_ROLE_PROBE_FINISHED'&&event.agentId===intent.agentId&&Date.parse(event.at)>=start);if(matches.length!==1||matches[0].status!=='pass')fail('DOC_PROVISION_PROBE_PROOF_MISSING');const event=matches[0],proof=readControl(root+'/probes/'+event.probeId+'/result.json'),permit=readControl(root+'/probes/'+event.probeId+'/hello-permit.json'),budget=fs.readdirSync(root+'/budget/'+intent.verification.taskId);if(proof.probeId!==event.probeId||proof.exitCode!==0||proof.timedOut||proof.interrupted||proof.spawnFailed||permit.companyId!==intent.companyId||permit.model!=='gpt-6.1-sol'||budget.length!==1||budget[0]!==intent.verification.operationId+'.json')fail('DOC_PROVISION_PROBE_PROOF_INVALID');return{status:'pass',calls:1,probeId:event.probeId};}await new Promise(resolve=>setTimeout(resolve,1000));}fail('DOC_PROVISION_PROBE_RESULT_UNKNOWN');},
   releaseVerification:async(intent,proof)=>{if(meter.verifyLease(intent.verification.lease).allowed!==true)fail('DOC_PROVISION_OWN_LEASE_CHANGED');meter.release({...intent.verification.lease,terminalEvidence:true});editRoleRegistry(r=>{if(r.lease?.operationId!==intent.verification.operationId||r.lease.nonce!==intent.verification.lease.nonce)fail('DOC_PROVISION_OWN_LEASE_CHANGED');if(intent.verification.previousLeasePresent)r.lease=intent.verification.previousLease;else delete r.lease;return r;});const issues=(await import(P+'/@paperclipai/server/dist/services/issues.js')).issueService(db);await issues.update(intent.verification.taskId,{status:'done'});log({code:'DOCUMENT_SPECIALIST_LIFECYCLE_VERIFIED',agentId:intent.agentId,probeId:proof.probeId,calls:1});},
  };
  const result=await provisionDocumentSpecialist({ports,...options});console.log(JSON.stringify(result));
 }finally{meter?.close();await schema.closeRegisteredClients(url);await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({code:/^DOC_PROVISION_[A-Z_]+$/.test(error.code??'')?error.code:'DOC_PROVISION_NATIVE_FAILURE',modelOutcome:'NOT_CERTIFIED'}));process.exitCode=1;});
