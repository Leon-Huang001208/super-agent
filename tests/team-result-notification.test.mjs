import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {renderTeamResultNotification,sendTeamResult} from '../bridge/team-result-notification.mjs';

const R='/paperclip/control/research-pm';
const task={id:'5436f00e-75e6-49ce-821c-dbaff45798f3',identifier:'LEO-51',title:'RWB成熟工具复用验证',companyId:'company',responsibleUserId:'owner'};
const summary={sha256:'5c9b12feabb0c464afbcd497c1d47429adab5f5a4e4e9137cc862ffdf36c97b2',text:'Quality review requires work.\nReason: TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED\nRoot task: '+task.id+'\nQA run: 7c622126-3ab3-4e09-b67c-cbb3d1e54123\nQA artifact SHA256: '+ 'f'.repeat(64)};
const sourceRunId=randomUUID(),registry={companyId:task.companyId,ownerId:task.responsibleUserId};
const createdAt='2026-11-21T18:30:00.000Z';
const render=presentation=>renderTeamResultNotification({task,summary,presentation,createdAt});

test('result notification uses its separate brief summary instead of the LEO-65-shaped technical report',()=>{
 const userSummary={completed:'已完成两份交付文档，并通过独立质量复核。',pending:'源码整合和发布尚未执行。',next:'沿原任务整合两份成稿。'};
 const technical={sha256:'a'.repeat(64),text:'# 内部技术总结\n| Native ID | '+task.id+' |\n| SHA256 | '+'b'.repeat(64)+' |\nNOT_RUN: publish\nnode scripts/private-check.mjs\n\n<!-- user-notification:v1\n'+JSON.stringify(userSummary)+'\n-->'};
 const before=structuredClone(technical);
 const text=renderTeamResultNotification({task:{...task,identifier:'LEO-65',title:'RWB交付文档整合：飞书结果核对与原操作恢复'},summary:technical,createdAt,
  presentation:{kind:'result',stage:'documents-reviewed',userSummary,budget:{used:4,maximum:20}}});
 assert.ok(text.startsWith('RWB交付文档整合：飞书结果核对与原操作恢复（LEO-65）｜文档成果及质量复核完成'));
 assert.ok(text.includes('已完成：'+userSummary.completed));
 assert.ok(text.includes('待完成：'+userSummary.pending));
 assert.ok(text.includes('下一步：'+userSummary.next));
 assert.match(text,/当前阶段：文档成果及质量复核完成/);
 for(const raw of [task.id,'b'.repeat(64),'# 内部','| Native','NOT_RUN','node scripts','<!-- user-notification'])assert.equal(text.includes(raw),false,raw);
 assert.deepEqual(technical,before,'technical summary bytes and SHA remain unchanged');
 assert.match(text,/4 \/ 20 次/);assert.doesNotMatch(text,/100%/);
});

test('readable QA result explains dependency rebuilding without dumping internal identifiers',()=>{
 const text=render({kind:'quality-blocked',reasonCode:'TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED',budget:{used:8,maximum:20}});
 assert.match(text,/LEO-51.*需要修复.*暂停/);
 assert.match(text,/前置步骤/);assert.match(text,/后续.*重新验证/);
 assert.match(text,/尚未自动重建/);assert.match(text,/下一步/);assert.match(text,/原任务/);
 assert.match(text,/8\s*\/\s*20/);assert.match(text,/通知日期：2026-11-22/);
 for(const raw of [task.id,sourceRunId,summary.sha256,'TEAM_QA_REPAIR','Quality review','Native ID','版本：'])assert.equal(text.includes(raw),false,raw);
 assert.match(text,/Paperclip.*LEO-51/);
});

test('readable results lead with the actual task title and show known current-stage progress',()=>{
 const text=render({kind:'quality-blocked',reasonCode:'TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED',budget:{used:8,maximum:20}});
 assert.ok(text.startsWith(task.title+'（LEO-51）｜'));
 const progress=text.split('\n').find(line=>line.startsWith('当前阶段：'));
 assert.match(progress,/质量复核.*未通过/);assert.match(progress,/后续.*暂停/);
 assert.doesNotMatch(progress,/%|8\s*\/\s*20|100|已完成.*步骤/);
 assert.match(text,/本任务已用调用：8 \/ 20 次/);
});

test('task titles normalize whitespace and preserve meaningful words without inventing a description',()=>{
 const title='  RWB资料验证\n  2.0 https://example.org/topic/42  ';
 const text=renderTeamResultNotification({task:{...task,title},summary,createdAt,presentation:{kind:'quality-blocked'}});
 assert.ok(text.startsWith('RWB资料验证 2.0 https://example.org/topic/42（LEO-51）｜'));
 for(const missing of [undefined,null,0,'',' \n ']){
  const result=renderTeamResultNotification({task:{...task,title:missing,description:'internal source '+task.id},summary:{...summary,text:'本轮记录'},createdAt,presentation:{kind:'result'}});
  assert.match(result,/任务标题未提供（LEO-51）/);
  assert.equal(result.includes('internal source'),false);assert.equal(result.includes(task.id),false);
 }
});

test('long task titles have a readable Unicode-safe bound',()=>{
 const title='研'.repeat(118)+'🧭✅结束';
 const text=renderTeamResultNotification({task:{...task,title},summary,createdAt,presentation:{kind:'quality-blocked'}});
 assert.ok(text.startsWith('研'.repeat(118)+'🧭✅…（LEO-51）｜'));
 assert.equal(text.includes('�'),false);
 assert.equal(text.includes('结束'),false);
});

test('normal and missing stage metadata do not imply whole-goal completion or fabricated progress',()=>{
 const value={task,summary:{...summary,text:'已提交本轮资料核对结果'},createdAt};
 const text=renderTeamResultNotification({...value,presentation:{kind:'result'}});
 assert.match(text,/当前阶段：本轮结果已汇总/);assert.match(text,/质量复核状态未确认/);
 assert.match(text,/简短用户摘要未提供或无法核对/);assert.equal(text.includes(value.summary.text),false);
 assert.doesNotMatch(text,/100%|全部任务已完成|独立质检通过|S0|S1/);
 const unknown=renderTeamResultNotification(value);
 assert.match(unknown,/当前阶段：未提供可信阶段信息/);
 assert.doesNotMatch(unknown,/100%|全部任务已完成|独立质检通过/);
});

for(const [code,reason] of [
 ['TEAM_QA_REPAIR_LIMIT',/返修轮次.*上限/],
 ['TEAM_QA_REPAIR_BUDGET_EXHAUSTED',/剩余调用.*不足/],
 ['TEAM_QA_REPAIR_TARGET_REQUIRED',/返修负责人/],
 ['TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED',/后续.*重新验证/],
])test('readable QA reason uses its actual decision: '+code,()=>{
 const text=render({kind:'quality-blocked',reasonCode:code});assert.match(text,reason);
 assert.equal(text.includes(code),false);assert.match(text,/下一步/);
});

test('readable unknown quality reason stays generic and never exposes its opaque code or claims approval',()=>{
 for(const reasonCode of ['FUTURE_REASON_'+randomUUID(),'toString','__proto__']){
  const text=render({kind:'quality-blocked',reasonCode});
  assert.match(text,/质量检查.*未通过/);assert.match(text,/任务记录/);
  assert.doesNotMatch(text,/FUTURE_REASON|undefined|独立质检通过|等待.*授权|0\s*\/\s*20/);
 }
});

test('brief results retain business numbers and URLs while technical commits remain in the original report',()=>{
 const completed='净值 1.2345；截至2026-11-22；来源 https://example.org/report/12345678901234567890';
 const technical={...summary,text:completed+'；commit '+'a'.repeat(40)},before=structuredClone(technical);
 const text=renderTeamResultNotification({task,summary:technical,createdAt,presentation:{kind:'result',userSummary:{completed,pending:'后续资料更新待下一轮核对。',next:'查看原任务中的来源记录。'}}});
 assert.match(text,/本轮结果已汇总/);assert.equal(text.includes(completed),true);
 assert.doesNotMatch(text,/任务已完成|独立质检通过|Native ID|版本：/);
 assert.equal(text.includes(summary.sha256),false);assert.equal(text.includes('a'.repeat(40)),false);assert.deepEqual(technical,before);
});

test('missing or invalid brief metadata falls back without leaking the report or accepting an invented stage',()=>{
 for(const userSummary of [undefined,null,{completed:'done',pending:'none',next:'next',stage:'deployed'},JSON.parse('{"completed":"done","pending":"none","next":"next","__proto__":{}}')]){
  const text=render({kind:'result',stage:'deployed',userSummary});
  assert.match(text,/待完成：简短用户摘要未提供或无法核对/);
  assert.match(text,/当前阶段：本轮结果已汇总，质量复核状态未确认/);
  for(const raw of ['TEAM_QA_REPAIR',task.id,summary.sha256,'deployed'])assert.equal(text.includes(raw),false);
 }
});

test('readable dates come from the recorded notification time and missing metadata is not invented',()=>{
 assert.match(render({kind:'result'}),/通知日期：2026-11-22/);
 const text=renderTeamResultNotification({task:{...task,identifier:undefined},summary:{...summary,text:'本轮结果'},createdAt:'not-a-date'});
 assert.match(text,/当前任务/);assert.match(text,/通知日期：未知/);
 assert.equal(text.includes(task.id),false);assert.doesNotMatch(text,/已用调用|0\s*\/\s*20/);
 assert.match(renderTeamResultNotification({task,summary,createdAt:null}),/通知日期：未知/);
});

test('readable inconsistent historical QA budget is omitted without inventing another limit',()=>{
 const budget={used:7,maximum:6},text=render({kind:'quality-blocked',reasonCode:'TEAM_QA_REPAIR_LIMIT',budget});
 assert.doesNotMatch(text,/已用调用|7\s*\/\s*6|0\s*\/\s*20/);
 assert.deepEqual(budget,{used:7,maximum:6});
 assert.match(render({kind:'result',budget:{used:8,maximum:20}}),/8\s*\/\s*20/);
});

// Remap fixed production paths to private real files. The real control reader
// still checks file type, links, UID and mode; no successful stat is fabricated.
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'team-result-notification-'));
 const control=path.join(root,'control'),credentials=path.join(root,'feishu');
 fs.mkdirSync(path.join(control,'team/notifications'),{recursive:true,mode:0o700});fs.mkdirSync(credentials,{mode:0o700});
 const credentialFile=path.join(credentials,'feishu.json'),ownerFile=path.join(credentials,'ownership.json');
 fs.writeFileSync(credentialFile,JSON.stringify({appId:'cli_aa62f59439b89d16',appSecret:'fixture-not-a-secret'}),{mode:0o600});
 fs.writeFileSync(ownerFile,JSON.stringify({ownerOpenId:'ou_fixtureOwner'}),{mode:0o600});
 const map=file=>typeof file==='string'&&(file===R||file.startsWith(R+'/'))?control+file.slice(R.length):typeof file==='string'&&(file==='/paperclip/feishu'||file.startsWith('/paperclip/feishu/'))?credentials+file.slice('/paperclip/feishu'.length):file;
 for(const method of ['existsSync','lstatSync','readFileSync','openSync','writeFileSync']){
  const original=fs[method];t.mock.method(fs,method,function(file,...args){return original.call(this,map(file),...args);});
 }
 const rename=fs.renameSync;t.mock.method(fs,'renameSync',function(from,to,...args){return rename.call(this,map(from),map(to),...args);});
 t.after(()=>{t.mock.restoreAll();fs.rmSync(root,{recursive:true});});
 const selected={...task,id:randomUUID()},selectedSummary={...summary,sha256:createHash('sha256').update(randomUUID()).digest('hex')};
 const key=createHash('sha256').update(selected.id+':'+selectedSummary.sha256).digest('hex');
 const outbox=path.join(control,'team/notifications',key+'.json');
 return{root,control,credentialFile,ownerFile,key,outbox,args:{task:selected,summary:selectedSummary,registry,sourceRunId,presentation:{kind:'quality-blocked',reasonCode:'TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED'}}};
}

test('sender preserves the original technical binding and sends the readable text only once',async t=>{
 const f=fixture(t),before=structuredClone(f.args),sent=[];
 const ports={sendMessage:async value=>{sent.push(value);return{code:0,data:{message_id:'om_fixtureResult'}};}};
 const result=await sendTeamResult(f.args,ports),record=JSON.parse(fs.readFileSync(f.outbox,'utf8'));
 assert.equal(result.status,'sent');assert.equal(sent.length,1);assert.deepEqual(f.args,before);
 assert.equal(record.taskId,f.args.task.id);assert.equal(record.sourceRunId,sourceRunId);assert.equal(record.summarySha256,f.args.summary.sha256);
 const key=f.key,uuid=key.slice(0,8)+'-'+key.slice(8,12)+'-4'+key.slice(13,16)+'-8'+key.slice(17,20)+'-'+key.slice(20,32);
 assert.equal(record.uuid,uuid);assert.equal(sent[0].uuid,uuid);
 assert.match(sent[0].text,/LEO-51.*需要修复/);assert.equal(sent[0].text.includes(f.args.summary.sha256),false);
 const bytes=fs.readFileSync(f.outbox);
 const again=await sendTeamResult({...f.args,presentation:{kind:'result'}},ports);
 assert.equal(again.reused,true);assert.equal(sent.length,1);assert.deepEqual(fs.readFileSync(f.outbox),bytes);
});

test('sender keeps unknown delivery reconciliation-only without sending or rewriting its original receipt',async t=>{
 const f=fixture(t);let sent=0;
 const ports={sendMessage:async()=>{sent++;throw Error('fixture-uncertain-result');}};
 await assert.rejects(sendTeamResult(f.args,ports),/TEAM_NOTIFICATION_RECONCILIATION_REQUIRED/);
 const bytes=fs.readFileSync(f.outbox),record=JSON.parse(bytes);assert.equal(record.status,'unknown');
 await assert.rejects(sendTeamResult(f.args,ports),/TEAM_NOTIFICATION_RECONCILIATION_REQUIRED/);
 assert.equal(sent,1);assert.deepEqual(fs.readFileSync(f.outbox),bytes);
});

test('sender retains company, owner and real private-file authority checks before transport',async t=>{
 const f=fixture(t);let sent=0;const ports={sendMessage:async()=>{sent++;return{code:0,data:{message_id:'om_fixtureResult'}};}};
 for(const args of [{...f.args,task:{...f.args.task,companyId:'other'}},{...f.args,registry:{...registry,ownerId:'other'}}])await assert.rejects(sendTeamResult(args,ports),/TEAM_NOTIFICATION_BINDING_DENIED/);
 fs.chmodSync(f.ownerFile,0o644);await assert.rejects(sendTeamResult(f.args,ports),/TEAM_CONTROL_FILE_DENIED/);fs.chmodSync(f.ownerFile,0o600);
 fs.chownSync(f.ownerFile,1,1);await assert.rejects(sendTeamResult(f.args,ports),/TEAM_CONTROL_FILE_DENIED/);fs.chownSync(f.ownerFile,0,0);
 const backup=f.ownerFile+'.original';fs.renameSync(f.ownerFile,backup);fs.symlinkSync(backup,f.ownerFile);
 await assert.rejects(sendTeamResult(f.args,ports),/TEAM_CONTROL_FILE_DENIED/);fs.unlinkSync(f.ownerFile);fs.renameSync(backup,f.ownerFile);
 fs.writeFileSync(f.credentialFile,JSON.stringify({appId:'other',appSecret:'fixture'}),{mode:0o600});
 await assert.rejects(sendTeamResult(f.args,ports),/TEAM_NOTIFICATION_OWNER_DENIED/);
 assert.equal(sent,0);assert.equal(fs.existsSync(f.outbox),false);
});
