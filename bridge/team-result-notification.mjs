import fs from'node:fs';import{createHash}from'node:crypto';import{createRequire}from'node:module';
import{ROLE_ROOT as R,readControl,writeControl}from'./role-control-store.mjs';
const require=createRequire('/opt/super-agent/bridge-dependencies/package.json');
export async function sendTeamResult({task,summary,registry,sourceRunId}){
 if(task.companyId!==registry.companyId||task.responsibleUserId!==registry.ownerId||!summary.sha256||!sourceRunId)throw Error('TEAM_NOTIFICATION_BINDING_DENIED');
 const key=createHash('sha256').update(task.id+':'+summary.sha256).digest('hex'),file=R+'/team/notifications/'+key+'.json';
 if(fs.existsSync(file)){const prior=readControl(file);if(prior.taskId!==task.id||prior.summarySha256!==summary.sha256)throw Error('TEAM_NOTIFICATION_BINDING_CHANGED');if(prior.status==='sent')return {...prior,reused:true};throw Error('TEAM_NOTIFICATION_RECONCILIATION_REQUIRED');}
 const credentials=readControl('/paperclip/feishu/feishu.json'),owner=readControl('/paperclip/feishu/ownership.json');if(credentials.appId!=='cli_aa62f59439b89d16'||!/^ou_[A-Za-z0-9]+$/.test(owner.ownerOpenId??''))throw Error('TEAM_NOTIFICATION_OWNER_DENIED');
 const uuid=key.slice(0,8)+'-'+key.slice(8,12)+'-4'+key.slice(13,16)+'-8'+key.slice(17,20)+'-'+key.slice(20,32);
 const base={schemaVersion:1,taskId:task.id,sourceRunId,summarySha256:summary.sha256,uuid,createdAt:new Date().toISOString()};writeControl(file,{...base,status:'sending'});
 try{
  const sdk=require('@larksuiteoapi/node-sdk'),noop=()=>{},client=new sdk.Client({appId:credentials.appId,appSecret:credentials.appSecret,logger:{trace:noop,debug:noop,info:noop,warn:noop,error:noop}});
  const text='Chief Coordinator 已收回成果\n任务：'+(task.identifier??task.id)+'\nNative ID：'+task.id+'\n版本：'+summary.sha256.slice(0,12)+'\n\n'+summary.text.slice(0,2400)+'\n\n完整成果和验证记录已保存在同一Native任务。未合并或部署RWB。';
  const response=await client.im.message.create({params:{receive_id_type:'open_id'},data:{receive_id:owner.ownerOpenId,msg_type:'text',content:JSON.stringify({text}),uuid}});
  if(response.code!==0||!/^om_[A-Za-z0-9]+$/.test(response.data?.message_id??''))throw Object.assign(Error('TEAM_NOTIFICATION_RESPONSE_UNKNOWN'),{safeCode:response.code});
  const receipt={...base,status:'sent',messageId:response.data.message_id,sentAt:new Date().toISOString(),reused:false};writeControl(file,receipt);return receipt;
 }catch(e){writeControl(file,{...base,status:'unknown',errorCode:Number.isInteger(e.safeCode)?e.safeCode:'SDK_RESULT_UNKNOWN'});throw Error('TEAM_NOTIFICATION_RECONCILIATION_REQUIRED');}
}
