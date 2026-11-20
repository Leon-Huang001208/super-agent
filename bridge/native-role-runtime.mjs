import{taskInputRevision}from'./task-input.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createNativeRoleAdapter } from './native-role-adapter.mjs';
import { withRoleCall } from './role-call-budget.mjs';
import { createRolePreparation } from './role-preparation.mjs';
import { settleNativeRole } from './role-native-settlement.mjs';
import { validateNetworkScope } from './network-role.mjs';
import { validateResourceScope } from './system-resource-role.mjs';
import {createProjectCatalog} from './context-projects.mjs';
import {teamContextEnabled,projectForTask,projectForOperation,scopedRegistry,teamArtifactNames} from './team-context.mjs';
import {createProjectKnowledgeStore} from './project-knowledge-store.mjs';
import {selectRoleKnowledge} from './role-materials.mjs';
import {createRoleMaterialSnapshot} from './role-material-snapshot.mjs';

const ROOT='/paperclip/control/research-pm',PKG='/opt/paperclip/node_modules';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function json(file) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o077)||stat.size>1048576)fail('NATIVE_ROLE_PRIVATE_FILE_DENIED');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function write(file,value) {
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
const log=event=>{
  fs.appendFileSync(ROOT+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
};
function registered(agentId) {
  const registry=json(ROOT+'/registry.json');
  const role=registry.agents.find(x=>x.profile.agentId===agentId);
  if(registry.enabled!==true||!role)fail('NATIVE_ROLE_NOT_REGISTERED');
  return {registry,role};
}
let connection;
export async function database() {
  if(connection)return connection;
  const password=fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim();
  const schema=await import(PKG+'/@paperclipai/db/dist/index.js');
  const orm=await import(PKG+'/drizzle-orm/index.js');
  const url='postgres://paperclip:'+encodeURIComponent(password)+'@db:5432/paperclip';
  connection={schema,orm,db:schema.createDb(url,{maxConnections:2,applicationName:'research-pm-role-preflight'})};
  return connection;
}
function grantFor(home,companyId) {
  const match=new RegExp('^/tmp/paperclip-ai-'+companyId+'-([a-f0-9-]{36})-[A-Za-z0-9]+/provider$').exec(home??'');
  if(!match)fail('NATIVE_ROLE_PROVIDER_HOME_DENIED');
  return match[1];
}
/** Resolve only through a freshly read Native task and deployment-owned catalog. */
export function resolveNativeRoleScope({registry,role,task,operation,log:audit=log}) {
  try {
    const project=projectForTask(registry,task,{log:audit});
    if(operation)projectForOperation(registry,operation,{task,log:audit});
    if(!teamContextEnabled(registry))return{registry,role};
    const catalog=createProjectCatalog({registry:registry.context.catalog,
      authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log:audit});
    const selected=catalog.roleBinding(role,project);
    const override=registry.context.materials?.[project.projectId]?.[selected.profile.role];
    if(!override&&role.profile.projectId!==project.projectId&&role.manifest.scope!=='generic')fail('NATIVE_ROLE_PROJECT_MATERIALS_REQUIRED');
    const manifest=structuredClone(override??selected.manifest);
    if(manifest.schemaVersion!==1||manifest.project!==project.key||manifest.role!==selected.profile.role||
      !Array.isArray(manifest.files)||!manifest.files.length)fail('NATIVE_ROLE_PROJECT_MATERIALS_DENIED');
    const basePrimary=role.manifest.files.find(f=>f.path===role.manifest.instructionsFilePath);
    const primary=manifest.files.find(f=>f.path===manifest.instructionsFilePath);
    if(!basePrimary||!primary||primary.sha256!==basePrimary.sha256||
      (role.manifest.requiredReferences??[]).some(name=>{const source=role.manifest.files.find(f=>f.path===name);return !source||!manifest.files.some(f=>f.sha256===source.sha256);})) {
      fail('NATIVE_ROLE_GENERIC_CONTENT_CHANGED');
    }
    audit({code:'NATIVE_ROLE_PROJECT_BOUND',taskId:task.id,projectId:project.projectId,role:selected.profile.role,agentId:selected.profile.agentId});
    return{registry:scopedRegistry(registry,project,{log:audit}),role:{...selected,manifest},contextVersion:1,workspaceCwd:project.workspaceCwd};
  }catch(error){const code=/^(?:NATIVE_ROLE|TEAM_CONTEXT|CONTEXT_PROJECT)_[A-Z_]+$/.test(error.code??'')?error.code:'NATIVE_ROLE_PROJECT_SCOPE_DENIED';audit({code,taskId:task?.id});fail(code);}
}
function nativeKnowledgeQuery(task){
  let query=Buffer.from(String(task.title??'')+'\\n'+String(task.description??'')).subarray(0,4096).toString('utf8');
  while(Buffer.byteLength(query)>4096)query=query.slice(0,-1);return query;
}
function legacyProjection(root,projection,profile){
  const base=path.join(root,'context','legacy');
  if(!projection||typeof projection.path!=='string'||path.resolve(projection.path)!==projection.path||
    !projection.path.startsWith(base+path.sep)||!/^[a-f0-9]{64}$/.test(projection.sha256??''))fail('NATIVE_ROLE_LEGACY_SCOPE_DENIED');
  let cursor=path.parse(projection.path).root;
  for(const part of projection.path.slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);const s=fs.lstatSync(cursor);if(s.isSymbolicLink()||(cursor!==projection.path&&!s.isDirectory()))fail('NATIVE_ROLE_LEGACY_SCOPE_DENIED');}
  const fd=fs.openSync(projection.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let bytes;
  try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>1048576)fail('NATIVE_ROLE_LEGACY_FILE_DENIED');bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
  if(sha(bytes)!==projection.sha256)fail('NATIVE_ROLE_LEGACY_DIGEST_CHANGED');
  const payload=JSON.parse(bytes);if(payload.schemaVersion!==1||!Array.isArray(payload.records)||payload.records.length>1000)fail('NATIVE_ROLE_LEGACY_FORMAT_DENIED');
  for(const record of payload.records)if(record?.project!==profile.projectKey||
    !(record.visibility==='project'&&(record.role===undefined||record.role===null||record.role===profile.role)||record.visibility==='private'&&record.role===profile.role))fail('NATIVE_ROLE_LEGACY_PARTITION_DENIED');
  return selectRoleKnowledge({project:profile.projectKey,role:profile.role,records:payload.records}).map(record=>({...record,
    confirmation:{status:'historical-reference'},historicalProvenance:{projectionSha256:projection.sha256,originalConfirmation:record.confirmation??null}}));
}
/** Read-only context projection: no global legacy file is opened when M2 is enabled. */
export function readNativeRoleKnowledge({root=ROOT,registry,task,profile,log:audit=log}) {
  try{
    if(!teamContextEnabled(registry))return json(root+'/knowledge.json').records;
    const project=projectForTask(registry,task,{log:audit});
    if(profile.projectId!==project.projectId||profile.projectKey!==project.key||!project.allowedRoles.includes(profile.role))fail('NATIVE_ROLE_KNOWLEDGE_SCOPE_DENIED');
    const scope={companyId:registry.companyId,ownerId:registry.ownerId,projectId:project.projectId,projectKey:project.key};
    const store=createProjectKnowledgeStore({root:root+'/context/knowledge',log:audit,authorizeOwner:()=>false});
    const current=store.query({scope,role:profile.role,query:nativeKnowledgeQuery(task),limit:32});
    const projection=registry.context.legacyKnowledge?.[project.projectId]?.[profile.role];
    const legacy=projection?legacyProjection(root,projection,profile):[];
    const identity=record=>record.visibility+':'+(record.visibility==='private'?profile.role+':':'')+record.id;
    const currentIds=new Set(current.map(identity));
    const references=legacy.filter(record=>!currentIds.has(identity(record))&&!store.history({scope,id:record.id,
      visibility:record.visibility,...(record.visibility==='private'?{role:profile.role}:{})}).some(version=>version.confirmation?.status==='owner-confirmed'));
    const records=selectRoleKnowledge({project:project.key,role:profile.role,
      records:[...current,...references.slice(0,32)]});
    audit({code:'NATIVE_ROLE_KNOWLEDGE_LOADED',taskId:task.id,projectId:project.projectId,role:profile.role,
      loaded:records.map(record=>({id:record.id,version:record.version,sourceSha256:sha(record.source),
        recordSha256:record.sha256??sha(JSON.stringify(record)),confirmation:record.confirmation?.status??'historical-reference'}))});
    return records;
  }catch(error){const code=/^(?:NATIVE_ROLE|PROJECT_KNOWLEDGE|ROLE_KNOWLEDGE|TEAM_CONTEXT|CONTEXT_PROJECT)_[A-Z_]+$/.test(error.code??'')?error.code:'NATIVE_ROLE_KNOWLEDGE_READ_FAILED';audit({code,taskId:task?.id});fail(code);}
}
/** Called only with rows read under the root row lock; no pool, SDK or model work occurs here. */
export async function assertNativeRoleStart({registry,binding,operation,task,rootTask,run,transaction,contextRuntime,log:audit=log}) {
  if(!teamContextEnabled(registry))return;
  try{
    if(!transaction?.db||!contextRuntime?.syncTask||!task||!rootTask||!run||!operation||
      task.id!==binding.taskId||task.companyId!==binding.companyId||task.projectId!==binding.projectId||
      task.responsibleUserId!==binding.ownerId||task.assigneeAgentId!==binding.agentId||taskInputRevision(task)!==binding.inputRevision||
      (binding.projectWorkspaceId??null)!==(task.projectWorkspaceId??null)||
      rootTask.id!==(operation.rootTaskId??task.id)||rootTask.companyId!==binding.companyId||rootTask.projectId!==binding.projectId||
      rootTask.responsibleUserId!==binding.ownerId||rootTask.parentId||['done','cancelled','blocked'].includes(task.status)||
      ['done','cancelled','blocked'].includes(rootTask.status)||run.id!==binding.runId||run.issueId!==task.id||
      run.agentId!==binding.agentId||run.companyId!==binding.companyId||run.responsibleUserId!==binding.ownerId||run.status!=='running')fail('NATIVE_ROLE_START_BINDING_DENIED');
    projectForOperation(registry,operation,{task,log:audit});
    const rootRevision=rootTask.id===task.id?binding.inputRevision:operation.rootInputRevision;
    if(taskInputRevision(rootTask)!==rootRevision||rootTask.id!==task.id&&
      (task.parentId!==rootTask.id||rootTask.status!=='in_review'||rootTask.assigneeUserId!==binding.ownerId||rootTask.assigneeAgentId))fail('NATIVE_ROLE_START_BINDING_DENIED');
    const selected=projectForTask(registry,rootTask,{log:audit});
    const view=await contextRuntime.syncTask({registry,task:rootTask,flow:{rootTaskId:rootTask.id,inputRevision:rootRevision,
      projectId:selected.projectId,projectKey:selected.key,workspaceCwd:selected.workspaceCwd,phase:operation.phase,
      ...(selected.projectWorkspaceId?{projectWorkspaceId:selected.projectWorkspaceId}:{})},transaction});
    if(!view?.task||view.task.id!==rootTask.id||view.task.projectId!==binding.projectId||taskInputRevision(view.task)!==rootRevision||
      view.control?.managed!==true||view.control.inputRevision!==rootRevision||view.control.pauseRequested||
      view.control.reviewBeforeDispatch&&operation.phase!=='plan'&&!/^[a-f0-9]{64}$/.test(view.control.approvedPlanSha256??''))fail('NATIVE_ROLE_START_CONTROL_DENIED');
    audit({code:'NATIVE_ROLE_START_GUARD_PASSED',taskId:binding.taskId,rootTaskId:rootTask.id,runId:binding.runId});
  }catch(error){const code=/^NATIVE_ROLE_START_[A-Z_]+$/.test(error.code??'')?error.code:'NATIVE_ROLE_START_CONTROL_DENIED';audit({code,taskId:binding?.taskId,runId:binding?.runId});fail(code);}
}
export async function installNativeRoles() {
  if(process.env.SUPER_AGENT_ROLE_RUNTIME_ENABLED!=='true')return;
  const registry=await import(PKG+'/@paperclipai/server/dist/adapters/index.js');
  const utils=await import(PKG+'/@paperclipai/adapter-utils/dist/server-utils.js');
  const original=registry.getServerAdapter('codex_local');
  if(!original?.execute||!original.testEnvironment)fail('NATIVE_ROLE_ADAPTER_UNAVAILABLE');
  registry.registerServerAdapter({...original,
    async execute(ctx) {
      if(ctx.config?.env?.SUPER_AGENT_ROLE_ENABLED!=='true')return original.execute(ctx);
      if(!ctx.context?.roleOperationId&&process.env.SUPER_AGENT_TEAM_COORDINATOR_ENABLED==='true'){
        try{ctx=await(await import('./team-native-runtime.mjs')).admitChiefInput(ctx,{database});}
        catch(error){return {exitCode:1,signal:null,timedOut:false,errorCode:/^(?:TEAM|NATIVE_ROLE)_[A-Z_]+$/.test(error.code??error.message)?(error.code??error.message):'NATIVE_ROLE_PREFLIGHT_FAILED',errorMessage:'The controlled Chief intake did not admit this execution.',resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};}
      }
      const readRegistration=async()=>{
        const originalRegistration=registered(ctx.agent.id);
        const {schema:s,orm:o,db}=await database();
        const [issue]=await db.select().from(s.issues).where(o.eq(s.issues.id,ctx.context.issueId));
        const [run]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ctx.runId));
        const [agent]=await db.select().from(s.agents).where(o.eq(s.agents.id,ctx.agent.id));
        const operation=originalRegistration.registry.operations?.find(x=>x.kind==='run'&&x.role===originalRegistration.role.profile.role&&x.id===ctx.context.roleOperationId&&x.taskId===issue?.id&&x.agentId===ctx.agent.id);
        const resolved=resolveNativeRoleScope({...originalRegistration,task:issue,operation,log});const {role,registry:r}=resolved;
        if(operation?.artifactGeneration){const expected=teamArtifactNames({taskId:operation.rootTaskId??issue.id,inputRevision:operation.rootInputRevision??operation.inputRevision,generationId:operation.artifactGeneration});if(Object.entries(expected).some(([key,value])=>operation[key]!==value))fail('NATIVE_ROLE_ARTIFACT_GENERATION_DENIED');}
        if(role.profile.role==='network-engineer')validateNetworkScope(operation?.networkScope);
        if(role.profile.role==='system-resource-engineer')validateResourceScope(operation?.resourceScope);
        if(operation?.rootTaskId&&operation.rootTaskId!==issue?.id&&
           (issue?.parentId!==operation.rootTaskId||r.taskRoots?.[issue.id]!==operation.rootTaskId))fail('NATIVE_ROLE_ROOT_BINDING_DENIED');
        if(operation?.rootTaskId&&operation.rootTaskId!==issue?.id){
          const[parent]=await db.select().from(s.issues).where(o.eq(s.issues.id,operation.rootTaskId));
          if(!parent||parent.companyId!==r.companyId||parent.projectId!==issue.projectId||parent.responsibleUserId!==r.ownerId||parent.assigneeUserId!==r.ownerId||parent.assigneeAgentId||parent.status!=='in_review'||taskInputRevision(parent)!==operation.rootInputRevision)fail('NATIVE_ROLE_ROOT_AUTHORITY_CHANGED');
        }
        if(role.profile.role==='qa'&&operation?.reviewedArtifacts){
          for(const ref of operation.reviewedArtifacts){const[reviewed]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ref.runId));if(!reviewed||reviewed.status!=='succeeded'||reviewed.agentId===ctx.agent.id||reviewed.companyId!==r.companyId||reviewed.issueId!==ref.taskId)fail('NATIVE_ROLE_INDEPENDENT_REVIEW_DENIED');}
        }
        const active=await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns)
          .where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
        if(!operation||active.some(x=>x.id!==ctx.runId)||!issue||!run||!agent||!r.tasks.includes(issue.id)||issue.companyId!==r.companyId||issue.projectId!==role.profile.projectId||
           issue.responsibleUserId!==r.ownerId||issue.assigneeAgentId!==agent.id||run.agentId!==agent.id||run.companyId!==r.companyId||
           run.responsibleUserId!==r.ownerId||run.issueId!==issue.id||run.status!=='running'||agent.adapterType!=='codex_local')fail('NATIVE_ROLE_DATABASE_BINDING_DENIED');
        return {binding:{companyId:r.companyId,projectId:issue.projectId,taskId:issue.id,agentId:agent.id,runId:run.id,
          ...(resolved.contextVersion===1&&issue.projectWorkspaceId?{projectWorkspaceId:issue.projectWorkspaceId}:{}),
          ownerId:r.ownerId,inputRevision:taskInputRevision(issue)},profile:role.profile,materialRoot:ROOT+'/materials',manifest:role.manifest,
          rootTaskId:operation.rootTaskId??issue.id,phase:operation.phase,additionalInput:operation.additionalInput,reviewedArtifacts:operation.reviewedArtifacts,teamRoster:role.profile.role==='chief'?r.team?.ids:undefined,
          ...(operation.artifactGeneration?{artifactGeneration:operation.artifactGeneration,planFile:operation.planFile,summaryFile:operation.summaryFile,outputPrefix:operation.outputPrefix}:{}),
          ...(resolved.contextVersion===1?{contextVersion:1,workspaceCwd:resolved.workspaceCwd,knowledgeQuery:nativeKnowledgeQuery(issue),
            knowledgeTask:{id:issue.id,companyId:issue.companyId,projectId:issue.projectId,projectWorkspaceId:issue.projectWorkspaceId,responsibleUserId:issue.responsibleUserId,title:issue.title,description:issue.description}}:{})};
      };
      const readContext=async()=>{
        const r=await readRegistration();
        const {schema:s,orm:o,db}=await database();
        const [issue]=await db.select().from(s.issues).where(o.eq(s.issues.id,r.binding.taskId));
        return {...r.binding,revision:sha(JSON.stringify({updatedAt:issue.updatedAt,description:issue.description})),
          projectKey:r.profile.projectKey,role:r.profile.role,runState:'authorized',sessionId:ctx.runtime?.sessionId??null,
          dispatchMode:'controlled',model:ctx.config.model,reasoningEffort:ctx.config.modelReasoningEffort};
      };
      const prepareRole=createRolePreparation({readContext,readKnowledge:async request=>{const current=await readRegistration();
        if(current.contextVersion!==1)return json(ROOT+'/knowledge.json').records;
        if(request.project!==current.profile.projectKey||request.role!==current.profile.role)fail('NATIVE_ROLE_KNOWLEDGE_SCOPE_DENIED');
        return readNativeRoleKnowledge({registry:registered(ctx.agent.id).registry,task:current.knowledgeTask,profile:current.profile,log});},log});
      let nativeEntered=false,gateStderr='';
      const knownUnstarted=result=>{
        if(result?.signal||result?.timedOut||result?.exitCode===0||fs.existsSync(ROOT+'/claims/'+ctx.runId+'.json'))return false;
        return String(gateStderr||result?.stderr||result?.resultJson?.stderr||'').split('\n').some(line=>{
          try{const e=JSON.parse(line);return /^ROLE_GATE_[A-Z_]+$/.test(e.code??'')&&e.claimed===false;}catch{return false;}
        });
      };
      const wrapped=createNativeRoleAdapter({readRegistration,prepareRole,log,basePromptTemplate:utils.DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
        nativeExecute:async checked=>{
          const r=await readRegistration(),file=checked.config.instructionsFilePath;
          const executionCwd=checked.context.paperclipWorkspace?.cwd??checked.config.cwd;
          const managedCwd='/paperclip/instances/default/projects/'+r.binding.companyId+'/'+r.binding.projectId+'/_default';
          if(r.contextVersion===1?executionCwd!==managedCwd:executionCwd!==managedCwd&&executionCwd!==checked.config.cwd)fail('NATIVE_ROLE_WORKSPACE_DENIED');
          const grantId=grantFor(checked.config.env?.CODEX_HOME,r.binding.companyId);
          if(r.contextVersion===1){
            const currentRegistry=registered(ctx.agent.id).registry;
            const currentOperation=currentRegistry.operations.find(x=>x.id===ctx.context.roleOperationId&&x.kind==='run'&&x.taskId===r.binding.taskId&&x.agentId===r.binding.agentId);
            if(!currentOperation)fail('NATIVE_ROLE_START_BINDING_DENIED');
            const data=await database(),{db,schema:s,orm:o}=data;
            const contextRuntime=await(await import('./chief-context-native.mjs')).createChiefContextRuntime({database});
            await db.transaction(async tx=>{
              const[rootTask]=await tx.select().from(s.issues).where(o.eq(s.issues.id,currentOperation.rootTaskId??r.binding.taskId)).for('update');
              const task=rootTask?.id===r.binding.taskId?rootTask:(await tx.select().from(s.issues).where(o.eq(s.issues.id,r.binding.taskId)).for('update'))[0];
              const[run]=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,r.binding.runId)).for('update');
              await assertNativeRoleStart({registry:currentRegistry,binding:r.binding,operation:currentOperation,task,rootTask,run,transaction:{db:tx},contextRuntime,log});
            });
          }
          const operationFile=ROOT+'/operations/'+ctx.context.roleOperationId+'.json';
          if(fs.existsSync(operationFile)){
            const prior=json(operationFile);
            if(prior.runId!==ctx.runId)fail('NATIVE_ROLE_OPERATION_ALREADY_STARTED');
          }else write(operationFile,{operationId:ctx.context.roleOperationId,runId:ctx.runId,taskId:r.binding.taskId,agentId:r.binding.agentId});
          const required=r.manifest.files.find(x=>ROOT+'/materials/'+x.path===file);
          if(!required||sha(fs.readFileSync(file))!==required.sha256)fail('NATIVE_ROLE_MATERIAL_CHANGED');
          const approvedOperation=registered(ctx.agent.id).registry.operations.find(x=>x.id===ctx.context.roleOperationId);
          write(ROOT+'/permits/'+ctx.runId+'.json',{schemaVersion:1,...r.binding,credentialGrantId:grantId,role:r.profile.role,
            model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:Date.now()+300000,cwd:executionCwd,
            instructionsFilePath:file,materialSha256:required.sha256,
            ...(r.contextVersion===1?{materialSnapshot:createRoleMaterialSnapshot({binding:r.binding,profile:r.profile,manifest:r.manifest})}:{}),
            ...(approvedOperation?.phase==='qa-supplement'?{evidencePacket:{name:'qa-evidence-v2',manifestSha256:approvedOperation.evidenceManifestSha256}}:{})});
          const operation=registered(ctx.agent.id).registry.operations.find(x=>x.kind==='run'&&x.role===r.profile.role&&x.id===ctx.context.roleOperationId&&x.taskId===r.binding.taskId&&x.agentId===r.binding.agentId);
          return withRoleCall({registry:registered(ctx.agent.id).registry,operation,log,
            perform:async()=>{nativeEntered=true;const result=await original.execute({...checked,onLog:async(stream,chunk)=>{
                if(stream==='stderr'&&gateStderr.length<8192)gateStderr+=String(chunk).slice(0,8192-gateStderr.length);
                return checked.onLog(stream,chunk);
              }});
              if(knownUnstarted(result))return {...result,resultJson:{...result.resultJson,executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};
              return settleNativeRole({binding:r.binding,result,log,transaction:async fn=>{
                const {schema:s,orm:o,db}=await database();
                return db.transaction(async tx=>{
                  const issues=(await import(PKG+'/@paperclipai/server/dist/services/issues.js')).issueService(tx);
                  return fn({lock:async()=>{
                    const [run]=await tx.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,r.binding.runId)).for('update');
                    const [task]=await tx.select().from(s.issues).where(o.eq(s.issues.id,r.binding.taskId)).for('update');
                    return {task,run};
                  },addCompletion:(id,body,actor)=>issues.addComment(id,body,actor,{completionReply:true}),handBack:(id,patch)=>issues.update(id,patch)});
                });
              }});
            },
            completed:result=>(result?.exitCode===0&&!result.signal&&!result.timedOut&&!result.errorCode)||knownUnstarted(result)});
        }});
      try{return await wrapped(ctx);}
      catch(error){
        if(nativeEntered)throw error;
        const code=/^(?:NATIVE_ROLE|NETWORK_ROLE|RESOURCE_ROLE)_[A-Z_]+$/.test(error.code??'')?error.code:'NATIVE_ROLE_PREFLIGHT_FAILED';
        return {exitCode:1,signal:null,timedOut:false,errorCode:code,errorMessage:code,
          resultJson:{executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};
      }
    },
    async testEnvironment(input) {
      const agentId=input.config?.env?.SUPER_AGENT_ROLE_AGENT_ID;
      if(input.config?.env?.SUPER_AGENT_ROLE_ENABLED!=='true'||!agentId)return original.testEnvironment(input);
      const {role,registry:r}=registered(agentId);
      if(input.companyId!==r.companyId||input.config.model!=='gpt-6.1-sol'||role.profile.agentId!==agentId)fail('NATIVE_ROLE_PROBE_SCOPE_DENIED');
      if(input.config.modelReasoningEffort!=='low')fail('NATIVE_ROLE_PROBE_SCOPE_DENIED');
      const operation=r.operations?.find(x=>x.kind==='probe'&&x.agentId===agentId);
      if(!operation)fail('NATIVE_ROLE_PROBE_OPERATION_DENIED');
      return withRoleCall({registry:r,operation,log,completed:result=>result?.status==='pass',
        perform:async()=>{
          const grantId=grantFor(input.config.env?.CODEX_HOME,r.companyId),id=randomUUID(),dir=ROOT+'/probes/'+id;
          fs.mkdirSync(dir,{mode:0o700});
          write(dir+'/hello-permit.json',{id,companyId:r.companyId,grantId,model:'gpt-6.1-sol',expiresAt:new Date(Date.now()+300000).toISOString()});
          log({code:'NATIVE_ROLE_PROBE_STARTED',agentId,probeId:id});
          const result=await original.testEnvironment({...input,config:{...input.config,cwd:'/opt/paperclip',search:false,extraArgs:[],
            modelReasoningEffort:'low',env:{...input.config.env,SUPER_AGENT_ROLE_PROBE_ID:id}}});
          log({code:'NATIVE_ROLE_PROBE_FINISHED',agentId,probeId:id,status:result.status});
          return result;
        }});

    }});
}
