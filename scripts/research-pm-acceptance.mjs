/** Explicit operator acceptance. Native services own all projects, agents, tasks and runs. */
import fs from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import { AdmissionMeter } from '../bridge/admission.mjs';
import { NATIVE_ROLE_MANAGED_ARGS } from '../bridge/native-role-adapter.mjs';
const ROOT='/paperclip/control/research-pm',PKG='/opt/paperclip/node_modules';
const COMPANY='85f89b59-f73a-450d-8676-4afcab409fb0',OWNER='n6MxHj1whoJQggkbVPBdXUpybvBaa7RI';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const write=(p,v)=>{const tmp=p+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(v)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,p);};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const log=e=>fs.appendFileSync(ROOT+'/operator.jsonl',JSON.stringify({at:new Date().toISOString(),...e})+'\n',{mode:0o600});
if(process.platform!=='linux'||process.getuid()!==0)fail('ROLE_ACCEPTANCE_DOCKER_REQUIRED');
const password=fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim();
process.env.DATABASE_URL='postgres://paperclip:'+encodeURIComponent(password)+'@db:5432/paperclip';
const schema=await import(PKG+'/@paperclipai/db/dist/index.js'),orm=await import(PKG+'/drizzle-orm/index.js');
const config=await import(PKG+'/@paperclipai/server/dist/config.js');
process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE=config.loadConfig().secretsMasterKeyFilePath;
const db=schema.createDb(process.env.DATABASE_URL,{maxConnections:2,applicationName:'research-pm-acceptance'});
let meter;
try{
 for(const p of [ROOT, ...['materials','workspaces','permits','claims','results','probes','operations','budget','transport'].map(x=>ROOT+'/'+x)])
  if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});
 const action=process.argv[2];
 const issueSvc=(await import(PKG+'/@paperclipai/server/dist/services/issues.js')).issueService(db);
 const agentSvc=(await import(PKG+'/@paperclipai/server/dist/services/agent-lifecycle.js')).createAgentLifecycle(db);
 const active=await db.select({id:schema.heartbeatRuns.id}).from(schema.heartbeatRuns).where(orm.inArray(schema.heartbeatRuns.status,['running','queued','scheduled_retry']));
 if(active.length)fail('ROLE_ACCEPTANCE_NATIVE_BUSY');
 if(action==='provision'){
  if(fs.existsSync(ROOT+'/registry.json'))fail('ROLE_ACCEPTANCE_ALREADY_PROVISIONED');
  const intentFile=ROOT+'/provision.intent.json';
  const resume=process.argv[3]==='--resume-provision';
  if(fs.existsSync(intentFile)&&!resume)fail('ROLE_ACCEPTANCE_PROVISION_RECONCILIATION_REQUIRED');
  const ids=resume?read(intentFile):{projectId:randomUUID(),taskId:randomUUID(),researchId:randomUUID(),pmId:randomUUID()};
  if(!resume)fs.writeFileSync(intentFile,JSON.stringify(ids)+'\n',{flag:'wx',mode:0o600});
  const {projectService}=await import(PKG+'/@paperclipai/server/dist/services/projects.js');
  const project=await projectService(db).getById(ids.projectId)??await projectService(db).create(COMPANY,{id:ids.projectId,name:'Personal Automation M1',description:'Scoped Research and PM acceptance. No RWB code or deployment.',status:'in_progress'});
  if(project.id!==ids.projectId||project.companyId!==COMPANY||project.name!=='Personal Automation M1')fail('ROLE_ACCEPTANCE_PROJECT_CHANGED');
  const {taskId,researchId,pmId}=ids;
  const description='调研个人自动化中台如何支持公开来源研究到需求草案交付。仅使用公开官方来源，比较来源证据、需求假设、验收与记忆版本；不进行访谈，不修改RWB。依赖由Docker管理，Paperclip是唯一任务控制面。';
  const task=await issueSvc.getById(taskId)??await issueSvc.create(COMPANY,{id:taskId,projectId:project.id,title:'M1 Research to PM real acceptance',description,
    status:'todo',priority:'medium',responsibleUserId:OWNER,createdByUserId:OWNER,actorResponsibleUserId:OWNER,trustExplicitResponsibleUserId:true,
    idempotencyKey:'sa-research-pm-m1-20261119:A',allowDuplicate:false});
  if(task.id!==taskId||task.projectId!==project.id||task.description!==description||task.responsibleUserId!==OWNER)fail('ROLE_ACCEPTANCE_TASK_ID_CHANGED');
  meter=new AdmissionMeter({filename:'/paperclip/control/admission.sqlite',allowedProjectIds:[project.id],log});
  const receipt=read('/host-evidence/host-storage.json');
  const lease=meter.reserveTask({taskId,projectId:project.id,storageReceipt:receipt});
  if(!lease.allowed)fail('ROLE_ACCEPTANCE_ADMISSION_DENIED');
  const registry={schemaVersion:1,enabled:true,companyId:COMPANY,ownerId:OWNER,projectId:project.id,
    tasks:[taskId],taskId,researchId,pmId,lease:{taskId,projectId:project.id,nonce:lease.nonce},agents:[],operations:[]};
  const skillRoot='/opt/super-agent/role/assets/product-manager-coach/';
  for(const [role,agentId]of[['research',researchId],['pm',pmId]]){
   const referenceFiles=role==='pm'?['README.md','SKILL.md','references/modes.md','references/templates.md']:[];
   const instructions=(role==='research'
     ? '你是Research角色。用web search读取公开官方来源，为个人自动化中台提供来源可核验的调研。清晰区分事实与假设；不能把模拟访谈当事实。可使用已配置的shell、文件修改、Apps和Plugins。文件写入只在本任务工作目录。使用独立哨兵验证边界，禁止读取真实凭据和客户隐私。'
     : '你是PM角色。使用下列已核验产品经理教练材料，把Research产物转成简短中文需求草案与可观察验收。真实客户访谈未执行。')+
     '\n'+referenceFiles.map(name=>'\nMaterial '+name+'\n'+fs.readFileSync(skillRoot+name,'utf8')).join('\n');
   const name=agentId+'.md',bytes=Buffer.from(instructions);
   fs.writeFileSync(ROOT+'/materials/'+name,bytes,{mode:0o600,flag:'wx'});
   fs.mkdirSync(ROOT+'/workspaces/'+role,{mode:0o700});
   const profile={projectId:project.id,projectKey:'personal-automation-m1',agentId,role,engine:'codex_local',model:'gpt-6.1-sol',
     reasoningEffort:'low',dangerouslyBypassApprovalsAndSandbox:false,sandbox:'workspace-write',tools:['read_materials','read_sources','shell','apply_patch','apps','plugins']};
   registry.agents.push({profile,manifest:{schemaVersion:1,project:profile.projectKey,role,instructionsFilePath:name,requiredReferences:[],files:[{path:name,sha256:sha(bytes)}]}});
   registry.operations.push({id:randomUUID(),kind:'probe',taskId,agentId,role});
  }
  fs.mkdirSync(ROOT+'/budget/'+taskId,{mode:0o700});
  write(ROOT+'/registry.json',registry);
  write(ROOT+'/knowledge.json',{schemaVersion:1,records:[{project:'personal-automation-m1',id:'docker-dependencies',version:1,kind:'decision',visibility:'project',
    source:'owner-chat:2026-11-19',condition:'all product dependencies and model execution',text:'依赖和模型执行通过Docker管理，Paperclip保留唯一任务运行控制面。'}]});
  log({code:'ROLE_ACCEPTANCE_PROVISIONED',projectId:project.id,taskId});
  console.log(JSON.stringify({status:'PROVISIONED',projectId:project.id,taskId,researchId,pmId}));
 }else if(action==='hire'){
  const r=read(ROOT+'/registry.json'),roleName=process.argv[3],entry=r.agents.find(x=>x.profile.role===roleName);
  if(!entry)fail('ROLE_ACCEPTANCE_ROLE_DENIED');
  const id=entry.profile.agentId;
  const existing=await db.select({id:schema.agents.id}).from(schema.agents).where(orm.eq(schema.agents.id,id));
  if(existing.length)fail('ROLE_ACCEPTANCE_HIRE_ALREADY_EXISTS');
  const {companyService}=await import(PKG+'/@paperclipai/server/dist/services/companies.js');
  await companyService(db).update(COMPANY,{status:'active'},{actorType:'user',actorId:OWNER});
  const agent=await agentSvc.requestHire(COMPANY,{id,name:'M1 '+roleName,role:roleName==='research'?'researcher':'pm',title:roleName,
    adapterType:'codex_local',adapterConfig:{engine:'cli',command:'/opt/super-agent/bin/codex',cwd:ROOT+'/workspaces/'+roleName,
      instructionsFilePath:ROOT+'/materials/'+id+'.md',model:'gpt-6.1-sol',modelReasoningEffort:'low',search:true,
      dangerouslyBypassApprovalsAndSandbox:false,dangerouslyBypassSandbox:false,extraArgs:[...NATIVE_ROLE_MANAGED_ARGS],
      env:{SUPER_AGENT_ROLE_ENABLED:'true',SUPER_AGENT_ROLE_AGENT_ID:id}},
    runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:true,maxConcurrentRuns:1,maxDailyRuns:60},aiConnection:{mode:'responsible_user',method:'subscription',provider:'openai'}},
    status:'idle',spentMonthlyCents:0,budgetMonthlyCents:0},{createdByUserId:OWNER,responsibleUserId:OWNER});
  console.log(JSON.stringify({agentId:agent.id,status:agent.status,lifecycle:agent.lifecycleState}));
 }else if(action==='run'){
  const r=read(ROOT+'/registry.json'),roleName=process.argv[3],entry=r.agents.find(x=>x.profile.role===roleName);
  if(!entry)fail('ROLE_ACCEPTANCE_ROLE_DENIED');
  const taskId=r.taskId,agentId=entry.profile.agentId;
  await issueSvc.update(taskId,{assigneeAgentId:agentId,status:'todo'});
  const task=await issueSvc.getById(taskId);
  const op={id:randomUUID(),kind:'run',taskId,agentId,role:roleName};
  r.operations.push(op);write(ROOT+'/registry.json',r);
  const comment=await issueSvc.addComment(taskId,'按本人在Codex主聊天的续接授权继续本轮'+roleName+'验收；先前预检失败已核对未发生角色provider调用，当前使用修正的原生配置。',{userId:OWNER});
  const {heartbeatService}=await import(PKG+'/@paperclipai/server/dist/services/heartbeat.js');
  const result=await heartbeatService(db).wakeup(agentId,{manualUserWake:true,source:'on_demand',triggerDetail:'manual',
    requestedByActorType:'user',requestedByActorId:OWNER,reason:'issue_commented',idempotencyKey:'role:'+op.id,
    payload:{issueId:taskId,commentId:comment.id},contextSnapshot:{wakeCommentId:comment.id,issueId:taskId,taskId,projectId:r.projectId,responsibleUserId:OWNER,inputRevision:sha(task.description??''),
      roleOperationId:op.id,taskGoal:task.description,conversationMode:false}});
  log({code:'ROLE_ACCEPTANCE_WAKE_RETURNED',taskId,agentId,operationId:op.id,runId:result?.id});
  console.log(JSON.stringify({operationId:op.id,runId:result?.id,status:result?.status}));
  // Native execution continues in this process. Stay until the exact run ends.
  if(result?.id)for(;;){
    const [run]=await db.select().from(schema.heartbeatRuns).where(orm.eq(schema.heartbeatRuns.id,result.id));
    if(!['queued','running'].includes(run.status)){
      fs.writeFileSync(ROOT+'/results/native-'+run.id+'.json',JSON.stringify({id:run.id,status:run.status,errorCode:run.errorCode,sessionId:run.sessionId,
        nativeSessionId:run.nativeSessionId,resultJson:run.resultJson,usageJson:run.usageJson})+'\n',{mode:0o600,flag:'wx'});
      console.log(JSON.stringify({runId:run.id,status:run.status,errorCode:run.errorCode}));break;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }else if(action==='status'){
  const r=read(ROOT+'/registry.json');
  const agents=await db.select({id:schema.agents.id,name:schema.agents.name,status:schema.agents.status,lifecycle:schema.agents.lifecycleState,error:schema.agents.lifecycleError}).from(schema.agents).where(orm.inArray(schema.agents.id,r.agents.map(x=>x.profile.agentId)));
  console.log(JSON.stringify({taskId:r.taskId,agents,callLock:fs.existsSync(ROOT+'/call.lock'),calls:fs.readdirSync(ROOT+'/budget/'+r.taskId).length}));
 }else fail('ROLE_ACCEPTANCE_ACTION_DENIED');
}catch(e){
 const code=/^[A-Z_]+$/.test(e.code??'')?e.code:'ROLE_ACCEPTANCE_FAILED';
 console.error(JSON.stringify({code,errorType:e.name,site:typeof e.stack==='string'?e.stack.split('\n')[1]?.replace(/\(.*\)/,'(source)'):undefined}));
 process.exitCode=1;
}finally{if(meter)meter.close();await schema.closeRegisteredClients(process.env.DATABASE_URL);}
