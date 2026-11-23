import test from 'node:test';import assert from 'node:assert/strict';
import {feishuNotificationCard,feishuCardMessage} from '../bridge/feishu-notification-card.mjs';
test('card separates human sections and preserves real identifier and usage',()=>{
 const c=feishuNotificationCard('研究任务（LEO-65）｜文档成果及质量复核完成\n已完成：两份文档。\n当前阶段：文档质量已通过。\n待完成：源码提交。\n下一步：提交原PR。\n本任务已用调用：4 / 20 次\n通知日期：2026-11-23');
 assert.equal(c.header.title.content,'研究任务');const s=JSON.stringify(c);
 for(const v of ['当前状态','已完成','待完成','下一步','任务编号：LEO-65','4 / 20','2026-11-23'])assert.ok(s.includes(v));
 assert.equal(feishuCardMessage('已登记 LEO-1').msg_type,'interactive');
});
test('ack cards omit redundant native IDs and do not invent a task number',()=>{
 const s=JSON.stringify(feishuNotificationCard('已登记 LEO-9\nNative ID：opaque\n正在推进'));
 assert.ok(s.includes('LEO-9'));assert.ok(!s.includes('opaque'));
 const no=JSON.stringify(feishuNotificationCard('命令暂无法处理'));assert.ok(!no.includes('任务编号：'));
});
test('long plan body stays in task details and blocked cards have distinct status color',()=>{
 const c=feishuNotificationCard('需要修复，已暂停\n'+('内部明细'.repeat(200)));
 assert.equal(c.header.template,'orange');assert.ok(!JSON.stringify(c).includes('内部明细'));
});

test("ack body without its ID still keeps the authoritative receipt identifier",()=>{const c=feishuNotificationCard("已暂停后续派发，保留当前运行与账本。",{identifier:"LEO-51",updatedAt:"2026-11-23T02:30:00Z"});assert.match(JSON.stringify(c),/任务编号：LEO-51/);assert.match(JSON.stringify(c),/2026-11-23 10:30/);});
