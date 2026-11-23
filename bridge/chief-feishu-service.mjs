import {feishuCardMessage} from './feishu-notification-card.mjs';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createChiefFeishuIntake} from './chief-feishu-intake.mjs';
import {createChiefFeishuNative} from './chief-feishu-native.mjs';
import {parseChiefContextCommand} from './chief-context-commands.mjs';
import {createHash} from 'node:crypto';
import {ROLE_ROOT as R,readControl,writeControl} from './role-control-store.mjs';
import {selectNativeProject} from './role-project-context.mjs';
const require=createRequire('/opt/super-agent/bridge-dependencies/package.json');
const fail=code=>{throw Object.assign(Error(code),{code});};
export async function startChiefFeishuService({database}){
 const registry=readControl(R+'/registry.json'),credentials=readControl('/paperclip/feishu/feishu.json'),owner=readControl('/paperclip/feishu/ownership.json'),identity=readControl('/chief-feishu-identity/owner-context.json');
 // The receiver may connect while dispatch is paused; currentScope still guards every intake/drain.
 if(![true,false].includes(registry.team?.enabled)||identity.appId!==credentials.appId||identity.ownerOpenId!==owner.ownerOpenId)fail('CHIEF_FEISHU_DEPLOYMENT_BINDING_DENIED');
 const binding={...identity,nativeOwnerId:registry.ownerId,companyId:registry.companyId,projectId:registry.team.projectId,chiefAgentId:registry.team.ids.chief};
 const contextEnabled=registry.context?.enabled===true,catalogDigest=createHash('sha256').update(JSON.stringify(registry.context?.catalog??null)).digest('hex');
 const currentScope=()=>{const r=readControl(R+'/registry.json'),i=readControl('/chief-feishu-identity/owner-context.json'),u=readControl('/paperclip/feishu/ownership.json');if(r.team?.enabled!==true||r.ownerId!==binding.nativeOwnerId||r.companyId!==binding.companyId||r.team.projectId!==binding.projectId||r.team.ids.chief!==binding.chiefAgentId||i.appId!==binding.appId||i.tenantKey!==binding.tenantKey||i.ownerOpenId!==binding.ownerOpenId||u.ownerOpenId!==binding.ownerOpenId||(r.context?.enabled===true)!==contextEnabled||createHash('sha256').update(JSON.stringify(r.context?.catalog??null)).digest('hex')!==catalogDigest)fail('CHIEF_FEISHU_DEPLOYMENT_BINDING_DENIED');};
 const log=e=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...e})+'\n',{mode:0o600});
 const sdk=require('@larksuiteoapi/node-sdk');if(require('@larksuiteoapi/node-sdk/package.json').version!=='1.76.0')fail('CHIEF_FEISHU_SDK_VERSION_DENIED');
 const noop=()=>{},client=new sdk.Client({appId:credentials.appId,appSecret:credentials.appSecret,logger:{error:noop,warn:noop,info:noop,debug:noop,trace:noop}});
 const context=contextEnabled?await(await import('./chief-context-service.mjs')).createChiefContextApplication({database,binding,registry,client,log,currentScope,readRegistry:()=>readControl(R+'/registry.json')}):null;
 const native=context??await createChiefFeishuNative({database,binding,log,
  canDispatch:async({db:transaction}={})=>{currentScope();if(fs.existsSync(R+'/call.lock')||fs.existsSync(R+'/registry.control.lock'))return false;const {db,schema:s,orm:o}=await database();return !(await (transaction??db).select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry'])).limit(1)).length;},
  acknowledge:async record=>{const k=record.operationId,uuid=k.slice(0,8)+'-'+k.slice(8,12)+'-4'+k.slice(13,16)+'-8'+k.slice(17,20)+'-'+k.slice(20,32);
   const response=await client.im.message.reply({path:{message_id:record.sourceParams.messageId},data:{...feishuCardMessage('已登记 Chief 任务 '+record.identifier+'\n项目：'+record.projectId+'\n按当前项目授权和原调用预算推进。',{identifier:record.identifier}),uuid}});
   if(response.code!==0||!/^om_[A-Za-z0-9]+$/.test(response.data?.message_id??''))fail('CHIEF_FEISHU_ACK_UNKNOWN');return {messageId:response.data.message_id};}
 });
 const receive=createChiefFeishuIntake({binding,...(context&&{parseCommand:parseChiefContextCommand}),resolveProject:async selector=>{
  currentScope();const{db,schema:s,orm:o}=await database();
  const projects=await db.select().from(s.projects).where(o.eq(s.projects.companyId,binding.companyId));
  const workspaces=projects.length?await db.select().from(s.projectWorkspaces).where(o.inArray(s.projectWorkspaces.projectId,projects.map(p=>p.id))):[];
  return selectNativeProject({projects,workspaces,companyId:binding.companyId,selector,defaultProjectId:binding.projectId});
 },registerTrustedMessage:async message=>{currentScope();return context?context.receiveTrusted(message):native.registerTrustedMessage(message);},log});
 const {createFeishuConnection}=await import('/chief-feishu-transport/bridge/feishu-connection.mjs');
 const connection=createFeishuConnection({sdk,...credentials,log,store:{getOwner:async()=>readControl('/paperclip/feishu/ownership.json').ownerOpenId,compareAndBind:async()=>false},
  persistHealth:async health=>writeControl(R+'/team/feishu-connection.health.json',health),
  dispatcherBindings:{wrapMessage:()=>async data=>{
   const header=data?.header??data??{},wrapped={...data,header:{...header,event_type:header.event_type??'im.message.receive_v1'}};
   const result=await receive(wrapped);if(result.kind==='ignored'){log({code:'CHIEF_FEISHU_OTHER_NAMESPACE_DISABLED'});return result;}
   if(result.kind==='registered')log({code:context?'CHIEF_CONTEXT_SOURCE_HANDLED':'CHIEF_FEISHU_NATIVE_REGISTERED',kind:result.result.kind,taskId:result.result.taskId,operationId:result.result.operationId,reused:result.result.reused});return result;
  },wrapCard:()=>async()=>({toast:{type:'info',content:'该入口仅接收 Chief 任务；旧决策请在原任务核对。'}})}
 });
 let busy=false,stopping=false,lastError;const tick=async()=>{if(busy||stopping)return;busy=true;try{await native.drain();lastError=null;}catch(e){const code=/^(?:CHIEF_FEISHU|CHIEF_CONTEXT|CONTEXT_PROJECT|PROJECT_KNOWLEDGE)_[A-Z_]+$/.test(e.code??'')?e.code:'CHIEF_FEISHU_DRAIN_FAILED';if(lastError!==code){log({code});lastError=code;}}finally{busy=false;}};
 await connection.start();const timer=setInterval(()=>void tick(),2000);timer.unref();log({code:'CHIEF_FEISHU_RECEIVER_STARTED',appId:binding.appId});
 const close=()=>{if(stopping)return;stopping=true;clearInterval(timer);connection.close();};process.once('SIGTERM',close);process.once('SIGINT',close);return {connection,tick,close};
}
