/** Administrative recovery of one verified original goal. No listener or run consumer is started. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {ROLE_ROOT,readControl} from '../bridge/role-control-store.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const codeOf=error=>/^(?:CHIEF_FEISHU|CHIEF_CONTEXT|CHIEF_MESSAGE_RECOVERY|CONTEXT_PROJECT)_[A-Z_]+$/.test(error?.code??'')?error.code:'CHIEF_FEISHU_RECOVERY_FAILED';

export function parseFeishuRecoveryArgs(args){
  let messageId,expectedBodySha256,apply=false;
  for(let index=0;index<args.length;index++){
    const flag=args[index];
    if(flag==='--apply'&&!apply)apply=true;
    else if(flag==='--message-id'&&messageId===undefined)messageId=args[++index];
    else if(flag==='--expected-body-sha'&&expectedBodySha256===undefined)expectedBodySha256=args[++index];
    else fail('CHIEF_FEISHU_RECOVERY_ARGUMENTS_INVALID');
  }
  if(!/^om_[A-Za-z0-9]{1,245}$/.test(messageId??'')||!/^[a-f0-9]{64}$/.test(expectedBodySha256??''))fail('CHIEF_FEISHU_RECOVERY_ARGUMENTS_INVALID');
  return {messageId,expectedBodySha256,apply};
}

export async function runFeishuRecovery({app,request,log}){
  if(typeof app?.recoverOfficialGoal!=='function'||typeof log!=='function')fail('CHIEF_FEISHU_RECOVERY_CONFIGURATION_INVALID');
  try{
    const value=await app.recoverOfficialGoal({messageId:request.messageId,expectedBodySha256:request.expectedBodySha256},{apply:request.apply===true});
    const summary=Object.fromEntries(['mode','verified','origin','messageId','bodySha256','createdAt','commandKind','reviewBeforeDispatch'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
    if(value.result)summary.result=Object.fromEntries(['kind','taskId','identifier','operationId','status','reused','legacy','code'].filter(key=>value.result[key]!==undefined).map(key=>[key,value.result[key]]));
    await log({code:request.apply?'CHIEF_FEISHU_RECOVERY_APPLY_RESULT':'CHIEF_FEISHU_RECOVERY_PREVIEW',messageId:request.messageId,
      bodySha256:request.expectedBodySha256,...(summary.result?.taskId&&{taskId:summary.result.taskId}),...(summary.result?.code&&{resultCode:summary.result.code})});
    return summary;
  }catch(error){await log({code:codeOf(error),messageId:request.messageId});throw error;}
}

async function main(){
  if(process.platform!=='linux'||process.getuid()!==0)fail('CHIEF_FEISHU_RECOVERY_DOCKER_REQUIRED');
  const request=parseFeishuRecoveryArgs(process.argv.slice(2));
  const registry=readControl(ROLE_ROOT+'/registry.json'),identity=readControl('/chief-feishu-identity/owner-context.json'),
    owner=readControl('/paperclip/feishu/ownership.json'),credentials=readControl('/paperclip/feishu/feishu.json');
  if(identity.appId!==credentials.appId||identity.ownerOpenId!==owner.ownerOpenId||registry.context?.enabled!==true)fail('CHIEF_FEISHU_RECOVERY_BINDING_DENIED');
  const binding={...identity,nativeOwnerId:registry.ownerId,companyId:registry.companyId,projectId:registry.team.projectId,chiefAgentId:registry.team.ids.chief};
  const catalogHash=hash(registry.context.catalog);
  const currentScope=()=>{
    const r=readControl(ROLE_ROOT+'/registry.json'),i=readControl('/chief-feishu-identity/owner-context.json'),o=readControl('/paperclip/feishu/ownership.json');
    if(r.ownerId!==binding.nativeOwnerId||r.companyId!==binding.companyId||r.team?.projectId!==binding.projectId||r.team?.ids?.chief!==binding.chiefAgentId||
      i.appId!==binding.appId||i.tenantKey!==binding.tenantKey||i.ownerOpenId!==binding.ownerOpenId||o.ownerOpenId!==binding.ownerOpenId||
      r.context?.enabled!==true||hash(r.context.catalog)!==catalogHash)fail('CHIEF_FEISHU_RECOVERY_BINDING_DENIED');
    if(request.apply&&(r.enabled!==true||r.team.enabled!==true||['SUPER_AGENT_ROLE_RUNTIME_ENABLED','SUPER_AGENT_TEAM_COORDINATOR_ENABLED','SUPER_AGENT_CHIEF_FEISHU_ENABLED'].some(key=>process.env[key]!=='true')))
      fail('CHIEF_FEISHU_RECOVERY_RUNTIME_NOT_READY');
  };
  currentScope();
  const require=createRequire('/opt/super-agent/bridge-dependencies/package.json');
  if(require('@larksuiteoapi/node-sdk/package.json').version!=='1.76.0')fail('CHIEF_FEISHU_RECOVERY_SDK_VERSION_DENIED');
  const sdk=require('@larksuiteoapi/node-sdk'),noop=()=>{},client=new sdk.Client({appId:credentials.appId,appSecret:credentials.appSecret,logger:{error:noop,warn:noop,info:noop,debug:noop,trace:noop}});
  const password=fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim(),url='postgres://paperclip:'+encodeURIComponent(password)+'@db:5432/paperclip';
  const schema=await import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),orm=await import('/opt/paperclip/node_modules/drizzle-orm/index.js');
  const db=schema.createDb(url,{maxConnections:2,applicationName:'chief-feishu-official-message-recovery'});
  try{
    const {createChiefContextApplication}=await import('../bridge/chief-context-service.mjs');
    const app=await createChiefContextApplication({database:async()=>({db,schema,orm}),binding,registry,client,log:recoveryLog,currentScope,readRegistry:()=>readControl(ROLE_ROOT+'/registry.json')});
    const result=await runFeishuRecovery({app,request,log:recoveryLog});
    console.log(JSON.stringify(result));
    if(request.apply&&!result.result?.taskId)process.exitCode=1;
  }finally{await schema.closeRegisteredClients(url);}
}

function recoveryLog(event){
  const directory=process.env.SUPER_AGENT_LOG_ROOT??'/paperclip/logs';fs.mkdirSync(directory,{recursive:true,mode:0o700});
  fs.appendFileSync(path.join(directory,'chief-feishu-recover.jsonl'),JSON.stringify({at:new Date().toISOString(),component:'chief-feishu-recover',...event})+'\n',{mode:0o600});
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
  const code=codeOf(error);try{recoveryLog({code});}catch{console.error('CHIEF_FEISHU_RECOVERY_LOG_FAILED');}
  console.error(JSON.stringify({component:'chief-feishu-recover',code}));process.exitCode=1;
});
