/** Human-facing card projection; technical reports remain in the task. */
export function feishuNotificationCard(text,{title,identifier,updatedAt}={}){
 const lines=String(text).split('\n').map(x=>x.trim()).filter(Boolean);
 const first=lines.shift()??'任务进度';
 const field=prefix=>lines.find(x=>x.startsWith(prefix))?.slice(prefix.length).trim();
 const id=identifier||first.match(/\b[A-Z][A-Z0-9]*-\d+\b/u)?.[0];
 const headline=first.includes('｜')?first.split('｜').slice(1).join('｜'):first;
 const section=(label,value)=>({tag:'div',text:{tag:'lark_md',content:'**'+label+'**\n'+value}});
 const elements=[section('当前状态',field('当前阶段：')||headline),{tag:'hr'}];
 for(const [label,prefix]of [['已完成','已完成：'],['待完成','待完成：'],['下一步','下一步：']]){
  const value=field(prefix);if(value)elements.push(section(label,value));
 }
 if(!field('已完成：')){
  const detail=lines.filter(x=>!x.startsWith('Native ID：')).join('\n');
  if(detail)elements.push(section('说明',detail.length<=500?detail:'完整计划和执行记录已保存在原任务，请到任务详情查看。'));
 }
 const notes=[];if(id)notes.push('任务编号：'+id);
 const usage=field('本任务已用调用：');if(usage)notes.push('调用用量：'+usage);
 const date=updatedAt?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(updatedAt)):field('通知日期：');if(date)notes.push('更新于 '+date);
 if(notes.length)elements.push({tag:'hr'},{tag:'note',elements:notes.map(content=>({tag:'plain_text',content}))});
 return {config:{wide_screen_mode:true},header:{template:/失败/u.test(headline)?'red':/暂停|未通过/u.test(headline)?'orange':/完成|已交付/u.test(headline)?'green':'blue',title:{tag:'plain_text',content:title||first.split('｜')[0].trim().replace(/（[A-Z][A-Z0-9]*-\d+）$/u,'')}},elements};
}
export const feishuCardMessage=(text,context)=>({msg_type:'interactive',content:JSON.stringify(feishuNotificationCard(text,{...context,updatedAt:new Date().toISOString()}))});
