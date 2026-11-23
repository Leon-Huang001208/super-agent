import {feishuCardMessage} from './feishu-notification-card.mjs';
import fs from'node:fs';import{createHash}from'node:crypto';import{createRequire}from'node:module';
import{ROLE_ROOT as R,readControl,writeControl}from'./role-control-store.mjs';
import{parseUserSummary}from'./team-user-summary.mjs';
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
function notificationTitle(task){
 const title=typeof task.title==='string'?task.title.replace(/\s+/gu,' ').trim():'';
 if(!title)return'任务标题未提供';
 const characters=Array.from(title);return characters.length>120?characters.slice(0,120).join('')+'…':title;
}
function notificationUserSummary(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 try{return parseUserSummary('<!-- user-notification:v1\n'+JSON.stringify(value)+'\n-->');}
 catch{return null;}
}
const resultStages={
 'documents-reviewed':'文档成果及质量复核完成',
 'artifacts-reviewed':'本轮产物及质量复核完成',
 'results-collected':'本轮结果已汇总，质量复核状态未确认。',
};
/** Presentation is independent of the preserved technical summary and delivery key. */
export function renderTeamResultNotification({task,summary,presentation={},createdAt}){
 const label=typeof task.identifier==='string'&&/^[A-Z][A-Z0-9]*-\d+$/.test(task.identifier)?task.identifier:'当前任务';
 const view=presentation&&typeof presentation==='object'?presentation:{};
 const blocked=view.kind==='quality-blocked',result=view.kind==='result';
 const stage=blocked?'质量复核未通过，后续自动推进已暂停。':result?(Object.hasOwn(resultStages,view.stage)?resultStages[view.stage]:resultStages['results-collected']):'未提供可信阶段信息，请查看任务记录。';
 const brief=result?notificationUserSummary(view.userSummary):null;
 const headline=blocked?'需要修复，已暂停':result&&['documents-reviewed','artifacts-reviewed'].includes(view.stage)?resultStages[view.stage]:result?'本轮结果已汇总':'本轮状态待核对';
 const lines=[notificationTitle(task)+'（'+label+'）｜'+headline,''];
 if(blocked){
  const reason=(Object.hasOwn(qualityReasons,view.reasonCode)?qualityReasons[view.reasonCode]:null)??{reason:'质量检查未通过，需要先核对任务记录中的返修意见。',next:'沿原任务核对未通过项，再继续处理。'};
  lines.push('已完成：本轮任务记录已保存。','当前阶段：'+stage,'待完成：'+reason.reason+(reason.detail?' '+reason.detail:''),'下一步：'+reason.next);
 }else{
  lines.push('已完成：'+(brief?.completed??(result?'本轮完整记录已保存。':'完成内容尚未提供可信摘要。')),'当前阶段：'+stage,
   '待完成：'+(brief?.pending??'简短用户摘要未提供或无法核对，具体后续状态待核对。'),
   '下一步：'+(brief?.next??'查看原任务中的完整成果与验证记录。'));
 }
 const budget=view.budget;
 if(Number.isSafeInteger(budget?.used)&&budget.used>=0&&Number.isSafeInteger(budget.maximum)&&budget.maximum>0&&budget.used<=budget.maximum)lines.push('','本任务已用调用：'+budget.used+' / '+budget.maximum+' 次');
 lines.push('','通知日期：'+notificationDate(createdAt),'完整成果与验证记录请查看 Paperclip 任务'+(label==='当前任务'?'。':' '+label+'。'));
 return lines.join('\n');
}
async function sendFeishuMessage({credentials,owner,text,uuid,identifier}){
 const sdk=require('@larksuiteoapi/node-sdk'),noop=()=>{},client=new sdk.Client({appId:credentials.appId,appSecret:credentials.appSecret,logger:{trace:noop,debug:noop,info:noop,warn:noop,error:noop}});
 return client.im.message.create({params:{receive_id_type:'open_id'},data:{receive_id:owner.ownerOpenId,...feishuCardMessage(text,{identifier}),uuid}});
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
  const response=await sendMessage({credentials,owner,text,uuid,identifier:task.identifier||task.id});
  if(response.code!==0||!/^om_[A-Za-z0-9]+$/.test(response.data?.message_id??''))throw Object.assign(Error('TEAM_NOTIFICATION_RESPONSE_UNKNOWN'),{safeCode:response.code});
  const receipt={...base,status:'sent',messageId:response.data.message_id,sentAt:new Date().toISOString(),reused:false};writeControl(file,receipt);return receipt;
 }catch(e){writeControl(file,{...base,status:'unknown',errorCode:Number.isInteger(e.safeCode)?e.safeCode:'SDK_RESULT_UNKNOWN'});throw Error('TEAM_NOTIFICATION_RECONCILIATION_REQUIRED');}
}
