import test from 'node:test';import assert from 'node:assert/strict';
import {createChiefFeishuNative} from '../bridge/chief-feishu-native.mjs';
const binding={companyId:'company',projectId:'project',nativeOwnerId:'owner',chiefAgentId:'chief',appId:'app',tenantKey:'tenant',ownerOpenId:'ou_owner'};
function fixture(){
 const records=[],tasks=[],created=[],contexts=[];
 const o={and:(...conditions)=>conditions,eq:(a,b)=>({field:a,value:b}),sql:(...parts)=>parts};
 const projects=[{id:'project',companyId:'company'},{id:'rwb',companyId:'company'},{id:'foreign',companyId:'other'}];
 const s={activityLog:{companyId:'company',action:'action',details:'details',createdAt:'createdAt'},issues:{id:'id'},projects:{id:'id'},agentWakeupRequests:{companyId:'company',idempotencyKey:'key'}};
 const tx={execute:async()=>{},select:()=>({from:table=>({where:conditions=>{const selected=table===s.issues?tasks.filter(t=>t.id===conditions.value):table===s.projects?projects.filter(t=>t.id===conditions.value):[];const p=Promise.resolve(selected);p.for=()=>p;p.orderBy=()=>p;return p;}})})};
 const db={transaction:fn=>fn(tx),select:()=>({from:()=>({where:()=>({orderBy:async()=>records.filter(x=>x.action==='team.feishu.registered').map(x=>({details:x.details}))})})})};
 const services={issueService:()=>({create:async(company,options)=>{created.push(options);/* Match the pinned Native's cross-project title dedup when false. */if(!options.allowDuplicate)return {id:'old-cross-project',projectId:'other'};const task={...options,companyId:company,identifier:'LEO-fixture'};tasks.push(task);return task;}}),heartbeatService:()=>({wakeup:async()=>({id:'run'})}),logActivity:async(_tx,record)=>{assert.equal(_tx,tx);records.push(record);},publishActivity:()=>{}};
 return {database:async()=>({db,schema:s,orm:o}),services,created,contexts,tx,db,records};
}
const message=id=>({...binding,messageId:id,goal:'Same title\nDistinct actual goal '+id,bodySha256:id,sourceParams:{messageId:id}});
test('Native adapter disables title merging; distinct source messages with the same first line get distinct tasks',async()=>{
 const f=fixture(),native=await createChiefFeishuNative({...f,binding,loadServices:async()=>f.services,canDispatch:async()=>false,acknowledge:async()=>({messageId:'om_ack'}),log:()=>{}});
 const a=await native.registerTrustedMessage(message('om_one')),b=await native.registerTrustedMessage(message('om_two'));
 assert.notEqual(a.taskId,b.taskId);assert.equal(f.created.length,2);assert.ok(f.created.every(x=>x.allowDuplicate===true));assert.equal(f.created[0].title,f.created[1].title);
});
test('dispatch recheck receives the locked Native transaction instead of acquiring a pool connection',async()=>{
 const f=fixture(),contexts=[];const native=await createChiefFeishuNative({...f,binding,loadServices:async()=>f.services,canDispatch:async context=>{contexts.push(context);return context===undefined;},acknowledge:async()=>({messageId:'om_ack'}),log:()=>{}});
 await native.registerTrustedMessage(message('om_one'));await native.drain();assert.equal(contexts.length,2);assert.equal(contexts[0],undefined);assert.equal(contexts[1].db,f.tx);assert.equal(f.records.some(x=>x.action==='team.feishu.wake_claimed'),false);
});

test('Native creates a new explicit project task and rejects another company without changing old tasks',async()=>{
 const f=fixture(),native=await createChiefFeishuNative({...f,binding,loadServices:async()=>f.services,canDispatch:async()=>false,acknowledge:async()=>({messageId:'om_ack'}),log:()=>{}});
 const first=await native.registerTrustedMessage(message('om_default'));
 const chosen=await native.registerTrustedMessage({...message('om_project'),projectId:'rwb'});
 assert.equal(first.projectId,'project');assert.equal(chosen.projectId,'rwb');assert.equal(f.created[1].projectId,'rwb');
 await assert.rejects(native.registerTrustedMessage({...message('om_foreign'),projectId:'foreign'}),/PROJECT/);assert.equal(f.created.length,2);
});
