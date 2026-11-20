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
import {assertRoleInstructionsReady} from './role-instruction-store.mjs';
import {resolveRoleInstructionCopy} from './role-instruction-paths.mjs';
import {readRoleProjectContext} from './role-project-context.mjs';
import {resolveRoleCapabilities} from './role-capabilities.mjs';
import {readControl} from './role-control-store.mjs';
import {validateTeamCodeCandidate} from './team-plan.mjs';

const ROOT='/paperclip/control/research-pm',PKG='/opt/paperclip/node_modules';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashReview=value=>/^[a-f0-9]{64}$/.test(value??'');
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
  assertRoleInstructionsReady({companyId:registry.companyId,agentId});
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
        const {role,registry:r}=registered(ctx.agent.id);
        const {schema:s,orm:o,db}=await database();
        const [issue]=await db.select().from(s.issues).where(o.eq(s.issues.id,ctx.context.issueId));
        const [run]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ctx.runId));
        const [agent]=await db.select().from(s.agents).where(o.eq(s.agents.id,ctx.agent.id));
        const operation=r.operations?.find(x=>x.kind==='run'&&x.role===role.profile.role&&x.id===ctx.context.roleOperationId&&x.taskId===issue?.id&&x.agentId===ctx.agent.id);
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
        if(!operation||active.some(x=>x.id!==ctx.runId)||!issue||!run||!agent||!r.tasks.includes(issue.id)||issue.companyId!==r.companyId||
           issue.projectId!==(operation.projectId??role.profile.projectId)||
           issue.responsibleUserId!==r.ownerId||issue.assigneeAgentId!==agent.id||run.agentId!==agent.id||run.companyId!==r.companyId||
           run.responsibleUserId!==r.ownerId||run.issueId!==issue.id||run.status!=='running'||agent.adapterType!=='codex_local')fail('NATIVE_ROLE_DATABASE_BINDING_DENIED');
        let material={materialRoot:ROOT+'/materials',manifest:role.manifest};
        if(role.materialRoot){
          const[workingCopy]=await db.select().from(s.agentInstructionWorkingCopies).where(o.and(o.eq(s.agentInstructionWorkingCopies.companyId,r.companyId),o.eq(s.agentInstructionWorkingCopies.runId,ctx.runId)));
          const snapshots=await import(PKG+'/@paperclipai/adapter-utils/dist/workspace-restore-merge.js');
          const baseline=snapshots.parseDirectorySnapshot(workingCopy?.receipt?.baseline);
          if(!baseline||workingCopy.receipt?.schema!=='paperclip.agent-files.v1'||snapshots.directorySnapshotSha256(baseline)!==workingCopy.baseHash)fail('NATIVE_ROLE_INSTRUCTION_BASELINE_CHANGED');
          material=resolveRoleInstructionCopy({role,identity:{companyId:r.companyId,agentId:ctx.agent.id,runId:ctx.runId,ownerId:r.ownerId},
            workingCopy,baseline,history:r.materialHistory,executionPath:ctx.config.instructionsFilePath});
        }
        const projectContext=await readRoleProjectContext({db,schema:s,orm:o,task:issue,companyId:r.companyId,ownerId:r.ownerId,
          legacyProfile:role.profile,rootTaskId:operation.rootTaskId??issue.id});
        if(operation.codeCandidate){
          const[sourceRun]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,operation.codeCandidate.runId));
          if(role.profile.role!=='qa')fail('NATIVE_ROLE_CODE_CANDIDATE_DENIED');
          validateTeamCodeCandidate(operation.codeCandidate,{rootTaskId:operation.rootTaskId??issue.id,projectId:issue.projectId,
            workspaceHostPath:projectContext.workspace.hostPath,companyId:r.companyId,artifacts:operation.reviewedArtifacts??[],run:sourceRun,qaAgentId:agent.id});
        }
        if(operation.codeReview){
          const review=operation.codeReview,[qaRun]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,review.runId));
          if(review.verdict!=='PASS'||review.rootTaskId!==(operation.rootTaskId??issue.id)||review.projectId!==issue.projectId||
            !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(review.candidateSha??'')||!hashReview(review.artifactSha256)||
            review.agentId!==r.team?.ids?.qa||!qaRun||qaRun.status!=='succeeded'||qaRun.companyId!==r.companyId||qaRun.agentId!==review.agentId||
            r.taskRoots?.[qaRun.issueId]!==review.rootTaskId)fail('NATIVE_ROLE_CODE_REVIEW_DENIED');
        }
        const capabilityRequests=operation.additionalCapabilities??[];
        const catalogFile=ROOT+'/apps-tool-catalog.json',catalog=fs.existsSync(catalogFile)?readControl(catalogFile):null;
        const effectiveCapabilities=resolveRoleCapabilities({role:role.profile.role,additionalCapabilities:capabilityRequests,projectContext,toolCatalog:catalog?.result?.tools??[]});
        return {binding:{companyId:r.companyId,projectId:issue.projectId,taskId:issue.id,agentId:agent.id,runId:run.id,
          ownerId:r.ownerId,inputRevision:taskInputRevision(issue)},profile:{...role.profile,projectId:issue.projectId,projectKey:projectContext.key},...material,
          projectContext,capabilityRequests,effectiveCapabilities,authorizedHostActions:operation.authorizedHostActions??[],networkScope:operation.networkScope,resourceScope:operation.resourceScope,codeCandidate:operation.codeCandidate,codeReview:operation.codeReview,
          rootTaskId:operation.rootTaskId??issue.id,phase:operation.phase,additionalInput:operation.additionalInput,reviewedArtifacts:operation.reviewedArtifacts,teamRoster:role.profile.role==='chief'?r.team?.ids:undefined};
      };
      const readContext=async()=>{
        const r=await readRegistration();
        const {schema:s,orm:o,db}=await database();
        const [issue]=await db.select().from(s.issues).where(o.eq(s.issues.id,r.binding.taskId));
        return {...r.binding,revision:sha(JSON.stringify({updatedAt:issue.updatedAt,description:issue.description})),
          projectKey:r.profile.projectKey,role:r.profile.role,runState:'authorized',sessionId:ctx.runtime?.sessionId??null,
          dispatchMode:'controlled',model:ctx.config.model,reasoningEffort:ctx.config.modelReasoningEffort};
      };
      const prepareRole=createRolePreparation({readContext,readKnowledge:async()=>json(ROOT+'/knowledge.json').records,log});
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
          const managedCwd='/paperclip/instances/default/projects/'+r.binding.companyId+'/'+r.binding.projectId+'/_default';
          const executionCwd=managedCwd;
          fs.mkdirSync(executionCwd,{recursive:true});
          const execution={...checked,config:{...checked.config,cwd:executionCwd},context:{...checked.context,
            paperclipWorkspace:{...checked.context.paperclipWorkspace,cwd:executionCwd}}};
          const grantId=grantFor(checked.config.env?.CODEX_HOME,r.binding.companyId);
          const operationFile=ROOT+'/operations/'+ctx.context.roleOperationId+'.json';
          if(fs.existsSync(operationFile)){
            const prior=json(operationFile);
            if(prior.runId!==ctx.runId)fail('NATIVE_ROLE_OPERATION_ALREADY_STARTED');
          }else write(operationFile,{operationId:ctx.context.roleOperationId,runId:ctx.runId,taskId:r.binding.taskId,agentId:r.binding.agentId});
          const required=r.manifest.files.find(x=>path.join(r.materialRoot,x.path)===file);
          if(!required||sha(fs.readFileSync(file))!==required.sha256)fail('NATIVE_ROLE_MATERIAL_CHANGED');
          const approvedOperation=registered(ctx.agent.id).registry.operations.find(x=>x.id===ctx.context.roleOperationId);
          write(ROOT+'/permits/'+ctx.runId+'.json',{schemaVersion:1,...r.binding,credentialGrantId:grantId,role:r.profile.role,
            model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:Date.now()+300000,cwd:executionCwd,
            instructionsFilePath:file,materialSha256:required.sha256,materialRoot:r.materialRoot,materialFiles:r.manifest.files,
            rootTaskId:r.rootTaskId,projectContext:r.projectContext,additionalCapabilities:r.capabilityRequests,effectiveCapabilities:r.effectiveCapabilities,
            authorizedHostActions:r.authorizedHostActions,networkScope:r.networkScope,resourceScope:r.resourceScope,reviewedArtifacts:r.reviewedArtifacts,codeCandidate:r.codeCandidate,codeReview:r.codeReview,
            ...(r.sourceInstructionsFilePath?{materialSourcePath:r.sourceInstructionsFilePath}:{}),
            ...(approvedOperation?.phase==='qa-supplement'?{evidencePacket:{name:'qa-evidence-v2',manifestSha256:approvedOperation.evidenceManifestSha256}}:{})});
          const operation=registered(ctx.agent.id).registry.operations.find(x=>x.kind==='run'&&x.role===r.profile.role&&x.id===ctx.context.roleOperationId&&x.taskId===r.binding.taskId&&x.agentId===r.binding.agentId);
          return withRoleCall({registry:registered(ctx.agent.id).registry,operation,log,
            perform:async()=>{nativeEntered=true;const result=await original.execute({...execution,onLog:async(stream,chunk)=>{
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
        const code=/^(?:NATIVE_ROLE|ROLE_PROJECT|ROLE_CAPABILITY|ROLE_INSTRUCTION|ROLE_MATERIAL|NETWORK_ROLE|RESOURCE_ROLE)_[A-Z_]+$/.test(error.code??'')?error.code:'NATIVE_ROLE_PREFLIGHT_FAILED';
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
