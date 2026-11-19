import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createNativeRoleAdapter } from './native-role-adapter.mjs';
import { withRoleCall } from './role-call-budget.mjs';
import { createRolePreparation } from './role-preparation.mjs';

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
async function database() {
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
      const readRegistration=async()=>{
        const {role,registry:r}=registered(ctx.agent.id);
        const {schema:s,orm:o,db}=await database();
        const [issue]=await db.select().from(s.issues).where(o.eq(s.issues.id,ctx.context.issueId));
        const [run]=await db.select().from(s.heartbeatRuns).where(o.eq(s.heartbeatRuns.id,ctx.runId));
        const [agent]=await db.select().from(s.agents).where(o.eq(s.agents.id,ctx.agent.id));
        const operation=r.operations?.find(x=>x.kind==='run'&&x.role===role.profile.role&&x.id===ctx.context.roleOperationId&&x.taskId===issue?.id&&x.agentId===ctx.agent.id);
        const active=await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns)
          .where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
        if(!operation||active.some(x=>x.id!==ctx.runId)||!issue||!run||!agent||!r.tasks.includes(issue.id)||issue.companyId!==r.companyId||issue.projectId!==role.profile.projectId||
           issue.responsibleUserId!==r.ownerId||issue.assigneeAgentId!==agent.id||run.agentId!==agent.id||run.companyId!==r.companyId||
           run.responsibleUserId!==r.ownerId||run.issueId!==issue.id||run.status!=='running'||agent.adapterType!=='codex_local')fail('NATIVE_ROLE_DATABASE_BINDING_DENIED');
        return {binding:{companyId:r.companyId,projectId:issue.projectId,taskId:issue.id,agentId:agent.id,runId:run.id,
          ownerId:r.ownerId,inputRevision:sha(issue.description??'')},profile:role.profile,materialRoot:ROOT+'/materials',manifest:role.manifest};
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
      let nativeEntered=false;
      const knownUnstarted=result=>{
        if(result?.signal||result?.timedOut||result?.exitCode===0||fs.existsSync(ROOT+'/claims/'+ctx.runId+'.json'))return false;
        return String(result?.resultJson?.stderr??'').split('\n').some(line=>{
          try{const e=JSON.parse(line);return /^ROLE_GATE_[A-Z_]+$/.test(e.code??'')&&e.claimed===false;}catch{return false;}
        });
      };
      const wrapped=createNativeRoleAdapter({readRegistration,prepareRole,log,basePromptTemplate:utils.DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
        nativeExecute:async checked=>{
          const r=await readRegistration(),file=checked.config.instructionsFilePath;
          const executionCwd=checked.context.paperclipWorkspace?.cwd??checked.config.cwd;
          const managedCwd='/paperclip/instances/default/projects/'+r.binding.companyId+'/'+r.binding.projectId+'/_default';
          if(executionCwd!==managedCwd&&executionCwd!==checked.config.cwd)fail('NATIVE_ROLE_WORKSPACE_DENIED');
          const grantId=grantFor(checked.config.env?.CODEX_HOME,r.binding.companyId);
          const operationFile=ROOT+'/operations/'+ctx.context.roleOperationId+'.json';
          if(fs.existsSync(operationFile)){
            const prior=json(operationFile);
            if(prior.runId!==ctx.runId)fail('NATIVE_ROLE_OPERATION_ALREADY_STARTED');
          }else write(operationFile,{operationId:ctx.context.roleOperationId,runId:ctx.runId,taskId:r.binding.taskId,agentId:r.binding.agentId});
          const required=r.manifest.files.find(x=>ROOT+'/materials/'+x.path===file);
          if(!required||sha(fs.readFileSync(file))!==required.sha256)fail('NATIVE_ROLE_MATERIAL_CHANGED');
          write(ROOT+'/permits/'+ctx.runId+'.json',{schemaVersion:1,...r.binding,credentialGrantId:grantId,role:r.profile.role,
            model:'gpt-6.1-sol',reasoningEffort:'low',apiFallback:false,expiresAt:Date.now()+300000,cwd:executionCwd,
            instructionsFilePath:file,materialSha256:required.sha256});
          const operation=registered(ctx.agent.id).registry.operations.find(x=>x.kind==='run'&&x.role===r.profile.role&&x.id===ctx.context.roleOperationId&&x.taskId===r.binding.taskId&&x.agentId===r.binding.agentId);
          return withRoleCall({registry:registered(ctx.agent.id).registry,operation,log,
            perform:async()=>{nativeEntered=true;const result=await original.execute(checked);
              if(knownUnstarted(result))return {...result,resultJson:{...result.resultJson,executionRecovery:{kind:'bootstrap',providerWorkStarted:false}}};
              return result;
            },
            completed:result=>(result?.exitCode===0&&!result.signal&&!result.timedOut&&!result.errorCode)||knownUnstarted(result)});
        }});
      try{return await wrapped(ctx);}
      catch(error){
        if(nativeEntered)throw error;
        const code=/^NATIVE_ROLE_[A-Z_]+$/.test(error.code??'')?error.code:'NATIVE_ROLE_PREFLIGHT_FAILED';
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
