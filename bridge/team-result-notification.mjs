import fs from'node:fs';import{createHash}from'node:crypto';import{createRequire}from'node:module';
import{ROLE_ROOT as R,readControl,writeControl}from'./role-control-store.mjs';
const require=createRequire('/opt/super-agent/bridge-dependencies/package.json');
const qualityReasons={
 TEAM_QA_REPAIR_LIMIT:{reason:'质量检查仍未通过，已达到本任务的返修轮次上限。',next:'查看原任务中的未通过项和保留结果，再安排后续处理。'},
 TEAM_QA_REPAIR_BUDGET_EXHAUSTED:{reason:'剩余调用不足以完成返修、复核和汇总。',next:'保留原任务及已有结果，先安排剩余工作。'},
 TEAM_QA_REPAIR_TARGET_REQUIRED:{reason:'质量检查要求返修，但尚未确定唯一的返修负责人。',next:'在原任务明确需要修改的步骤与负责人，再继续处理。'},
 TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED:{reason:'质量检查要求修改前置步骤，已有后续成果也需要重新验证。',detail:'系统尚未自动重建这些依赖任务。',next:'修正前置检查后，沿原任务继续处理。'},
};
function notificationDate(createdAt){
 if(typeof createdAt!=='string'||!createdAt.trim())return'未知';
 const date=new Date(createdAt);if(!Number.isFinite(date.getTime()))return'未知';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
/** Presentation is independent of the preserved technical summary and delivery key. */
export function renderTeamResultNotification({task,summary,presentation={},createdAt}){
 const label=typeof task.identifier==='string'&&/^[A-Z][A-Z0-9]*-\d+$/.test(task.identifier)?task.identifier:'当前任务';
 const blocked=presentation.kind==='quality-blocked';
 const lines=[label+'｜'+(blocked?'需要修复，已暂停':'本轮结果已汇总'),''];
 if(blocked){
  const result=(Object.hasOwn(qualityReasons,presentation.reasonCode)?qualityReasons[presentation.reasonCode]:null)??{reason:'质量检查未通过，需要先核对任务记录中的返修意见。',next:'沿原任务核对未通过项，再继续处理。'};
  lines.push('原因：'+result.reason);if(result.detail)lines.push(result.detail);
  lines.push('','下一步：'+result.next);
 }else lines.push(summary.text.slice(0,2400));
 const budget=presentation.budget;
 if(Number.isSafeInteger(budget?.used)&&budget.used>=0&&Number.isSafeInteger(budget.maximum)&&budget.maximum>0&&budget.used<=budget.maximum)lines.push('','本任务已用调用：'+budget.used+' / '+budget.maximum+' 次');
 lines.push('','通知日期：'+notificationDate(createdAt),'完整成果与验证记录请查看 Paperclip 任务'+(label==='当前任务'?'。':' '+label+'。'));
 return lines.join('\n');
}
async function sendFeishuMessage({credentials,owner,text,uuid}){
 const sdk=require('@larksuiteoapi/node-sdk'),noop=()=>{},client=new sdk.Client({appId:credentials.appId,appSecret:credentials.appSecret,logger:{trace:noop,debug:noop,info:noop,warn:noop,error:noop}});
 return client.im.message.create({params:{receive_id_type:'open_id'},data:{receive_id:owner.ownerOpenId,msg_type:'text',content:JSON.stringify({text}),uuid}});
}
export async function sendTeamResult({task,summary,registry,sourceRunId,presentation},{sendMessage=sendFeishuMessage}={}){
 if(task.companyId!==registry.companyId||task.responsibleUserId!==registry.ownerId||!summary.sha256||!sourceRunId)throw Error('TEAM_NOTIFICATION_BINDING_DENIED');
 const key=createHash('sha256').update(task.id+':'+summary.sha256).digest('hex'),file=R+'/team/notifications/'+key+'.json';
 if(fs.existsSync(file)){const prior=readControl(file);if(prior.taskId!==task.id||prior.summarySha256!==summary.sha256)throw Error('TEAM_NOTIFICATION_BINDING_CHANGED');if(prior.status==='sent')return {...prior,reused:true};throw Error('TEAM_NOTIFICATION_RECONCILIATION_REQUIRED');}
 const credentials=readControl('/paperclip/feishu/feishu.json'),owner=readControl('/paperclip/feishu/ownership.json');if(credentials.appId!=='cli_aa62f59439b89d16'||!/^ou_[A-Za-z0-9]+$/.test(owner.ownerOpenId??''))throw Error('TEAM_NOTIFICATION_OWNER_DENIED');
 const uuid=key.slice(0,8)+'-'+key.slice(8,12)+'-4'+key.slice(13,16)+'-8'+key.slice(17,20)+'-'+key.slice(20,32);
 const base={schemaVersion:1,taskId:task.id,sourceRunId,summarySha256:summary.sha256,uuid,createdAt:new Date().toISOString()};writeControl(file,{...base,status:'sending'});
 try{
  const text=renderTeamResultNotification({task,summary,presentation,createdAt:base.createdAt});
  const response=await sendMessage({credentials,owner,text,uuid});
  if(response.code!==0||!/^om_[A-Za-z0-9]+$/.test(response.data?.message_id??''))throw Object.assign(Error('TEAM_NOTIFICATION_RESPONSE_UNKNOWN'),{safeCode:response.code});
  const receipt={...base,status:'sent',messageId:response.data.message_id,sentAt:new Date().toISOString(),reused:false};writeControl(file,receipt);return receipt;
 }catch(e){writeControl(file,{...base,status:'unknown',errorCode:Number.isInteger(e.safeCode)?e.safeCode:'SDK_RESULT_UNKNOWN'});throw Error('TEAM_NOTIFICATION_RECONCILIATION_REQUIRED');}
}
