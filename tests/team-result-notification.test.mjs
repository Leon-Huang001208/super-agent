import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {renderTeamResultNotification,sendTeamResult} from '../bridge/team-result-notification.mjs';

const R='/paperclip/control/research-pm';
const task={id:'5436f00e-75e6-49ce-821c-dbaff45798f3',identifier:'LEO-51',companyId:'company',responsibleUserId:'owner'};
const summary={sha256:'5c9b12feabb0c464afbcd497c1d47429adab5f5a4e4e9137cc862ffdf36c97b2',text:'Quality review requires work.\nReason: TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED\nRoot task: '+task.id+'\nQA run: 7c622126-3ab3-4e09-b67c-cbb3d1e54123\nQA artifact SHA256: '+ 'f'.repeat(64)};
const sourceRunId=randomUUID(),registry={companyId:task.companyId,ownerId:task.responsibleUserId};
const createdAt='2026-11-21T18:30:00.000Z';
const render=presentation=>renderTeamResultNotification({task,summary,presentation,createdAt});

test('readable QA result explains dependency rebuilding without dumping internal identifiers',()=>{
 const text=render({kind:'quality-blocked',reasonCode:'TEAM_QA_REPAIR_DEPENDENT_REBUILD_REQUIRED',budget:{used:8,maximum:20}});
 assert.match(text,/LEO-51.*需要修复.*暂停/);
 assert.match(text,/前置步骤/);assert.match(text,/后续.*重新验证/);
 assert.match(text,/尚未自动重建/);assert.match(text,/下一步/);assert.match(text,/原任务/);
 assert.match(text,/8\s*\/\s*20/);assert.match(text,/通知日期：2026-11-22/);
 for(const raw of [task.id,sourceRunId,summary.sha256,'TEAM_QA_REPAIR','Quality review','Native ID','版本：'])assert.equal(text.includes(raw),false,raw);
 assert.match(text,/Paperclip.*LEO-51/);
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

test('readable ordinary results retain legitimate business numbers, URLs and source identifiers',()=>{
 const body='净值 1.2345；截至2026-11-22；来源 https://example.org/report/12345678901234567890；commit '+ 'a'.repeat(40);
 const text=renderTeamResultNotification({task,summary:{...summary,text:body},createdAt,presentation:{kind:'result'}});
 assert.match(text,/本轮结果已汇总/);assert.equal(text.includes(body),true);
 assert.doesNotMatch(text,/任务已完成|独立质检通过|Native ID|版本：/);
 assert.equal(text.includes(summary.sha256),false);
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
