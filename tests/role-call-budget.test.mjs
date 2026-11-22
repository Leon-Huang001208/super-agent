import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AdmissionMeter} from '../bridge/admission.mjs';
import {withRoleCall} from '../bridge/role-call-budget.mjs';
import {grantComplexTaskBudget} from '../bridge/task-call-policy.mjs';
test('the same original root spends up to twenty physical calls without refunding an earlier four',async t=>{
 const f=fixture(t),task=f.operation.taskId;
 f.registry={...f.registry,companyId:'company',ownerId:'owner',tasks:[task],taskRoots:{[task]:task}};
 f.registry=grantComplexTaskBudget(f.registry,{task:{id:task,companyId:'company',responsibleUserId:'owner',status:'in_review'},approvalSource:'owner-task-tier-policy'});
 for(let i=0;i<4;i++)fs.writeFileSync(f.root+'/budget/'+task+'/'+randomUUID()+'.json','{}',{mode:0o600});
 const original=new Map(fs.readdirSync(f.root+'/budget/'+task).map(file=>[file,fs.readFileSync(f.root+'/budget/'+task+'/'+file,'utf8')]));
 let calls=0;
 for(let i=0;i<16;i++)await withRoleCall({...f,operation:{...f.operation,id:randomUUID()},log(){},perform:async()=>{calls++;return{ok:true};},completed:x=>x.ok},f);
 assert.equal(calls,16);assert.equal(fs.readdirSync(f.root+'/budget/'+task).length,20);
 for(const[file,bytes]of original)assert.equal(fs.readFileSync(f.root+'/budget/'+task+'/'+file,'utf8'),bytes);
 await assert.rejects(withRoleCall({...f,operation:{...f.operation,id:randomUUID()},log(){},perform:()=>assert.fail('twenty-first'),completed:()=>true},f),/BUDGET_DENIED/);
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'role-budget-'));
 t.after(()=>fs.rmSync(root,{recursive:true}));
 const taskId=randomUUID(),projectId=randomUUID(),nonce='a'.repeat(64),admissionFile=root+'/admission.sqlite';
 const meter=new AdmissionMeter({filename:admissionFile,allowedProjectIds:[projectId],log(){}});meter.close();
 const db=new DatabaseSync(admissionFile);
 db.prepare('INSERT INTO admission_meter VALUES(?,?,?)').run(taskId,projectId,'2026-11-19');
 db.prepare('INSERT INTO admission_lease VALUES(1,?,?)').run(taskId,nonce);db.close();
 fs.mkdirSync(root+'/budget',{mode:0o700});fs.mkdirSync(root+'/budget/'+taskId,{mode:0o700});
 return{root,admissionFile,registry:{lease:{taskId,projectId,nonce}},operation:{id:randomUUID(),taskId,kind:'probe',agentId:randomUUID()}};
}
test('a preserved trusted twelve-call allocation still stops the thirteenth physical call',async t=>{
 const f=fixture(t),task=f.operation.taskId;
 f.registry={...f.registry,companyId:'company',ownerId:'owner',taskCallBudgets:{[task]:{maximum:12,tier:'complex',rootTaskId:task,companyId:'company',approvedBy:'owner',approvalSource:'historical-owner-policy'}}};
 for(let i=0;i<11;i++)fs.writeFileSync(f.root+'/budget/'+task+'/'+randomUUID()+'.json','{}',{mode:0o600});
 await withRoleCall({...f,log(){},perform:async()=>({ok:true}),completed:x=>x.ok},f);
 assert.equal(fs.readdirSync(f.root+'/budget/'+task).length,12);
 await assert.rejects(withRoleCall({...f,operation:{...f.operation,id:randomUUID()},log(){},perform:()=>assert.fail('legacy thirteenth'),completed:()=>true},f),/BUDGET_DENIED/);
});
test('probes and runs share one slot and a spent operation cannot call the provider again',async t=>{
 const f=fixture(t);let calls=0,finish;
 const first=withRoleCall({...f,log(){},perform:()=>{calls++;return new Promise(r=>finish=r);},completed:x=>x.status==='pass'},f);
 await assert.rejects(withRoleCall({...f,operation:{...f.operation,id:randomUUID(),kind:'run'},log(){},
   perform:async()=>{calls++;},completed:()=>true},f));
 assert.equal(calls,1);
 finish({status:'pass'});await first;assert.equal(fs.existsSync(f.root+'/call.lock'),false);
 await assert.rejects(withRoleCall({...f,log(){},perform:async()=>{calls++;},completed:()=>true},f));
 assert.equal(calls,1);
 assert.equal(fs.existsSync(f.root+'/call.lock'),false);
});
test('twenty physical calls and unknown outcomes stop further provider calls',async t=>{
 const f=fixture(t);
 for(let i=0;i<20;i++)fs.writeFileSync(f.root+'/budget/'+f.operation.taskId+'/'+randomUUID()+'.json','{}',{mode:0o600});
 await assert.rejects(withRoleCall({...f,log(){},perform:()=>assert.fail('over budget'),completed:()=>true},f),/ROLE_CALL_BUDGET_DENIED/);
 assert.equal(fs.existsSync(f.root+'/call.lock'),false);
 const g=fixture(t);
 await withRoleCall({...g,log(){},perform:async()=>({status:'unknown'}),completed:()=>false},g);
 assert.equal(fs.existsSync(g.root+'/call.lock'),true);
 await assert.rejects(withRoleCall({...g,operation:{...g.operation,id:randomUUID()},log(){},perform:()=>assert.fail('unknown rerun'),completed:()=>true},g));
});
test('delegated tasks spend their original root budget instead of receiving a new allowance',async t=>{
 const f=fixture(t),parent=randomUUID();fs.mkdirSync(f.root+'/budget/'+parent,{mode:0o700});
 f.registry.tasks=[parent,f.operation.taskId];f.registry.taskRoots={[f.operation.taskId]:parent};const operation={...f.operation,rootTaskId:parent,kind:'run'};
 await withRoleCall({...f,operation,log(){},perform:async()=>({ok:true}),completed:x=>x.ok},f);
 assert.equal(fs.readdirSync(f.root+'/budget/'+parent).length,1);assert.equal(fs.readdirSync(f.root+'/budget/'+f.operation.taskId).length,0);
 for(let i=0;i<19;i++)fs.writeFileSync(f.root+'/budget/'+parent+'/'+randomUUID()+'.json','{}',{mode:0o600});
 await assert.rejects(withRoleCall({...f,operation:{...operation,id:randomUUID()},log(){},perform:()=>assert.fail('child bypassed root cap'),completed:()=>true},f),/ROLE_CALL_BUDGET_DENIED/);
 await assert.rejects(withRoleCall({...f,operation:{...operation,id:randomUUID(),rootTaskId:randomUUID()},log(){},perform:()=>assert.fail('unregistered root'),completed:()=>true},f),/ROLE_CALL_ROOT_DENIED/);
});
function seventhFixture(t){const f=fixture(t),parent=randomUUID();fs.mkdirSync(f.root+'/budget/'+parent,{mode:0o700});for(let i=0;i<6;i++)fs.writeFileSync(f.root+'/budget/'+parent+'/'+randomUUID()+'.json','{}',{mode:0o600});f.registry.tasks=[parent,f.operation.taskId];f.registry.taskRoots={[f.operation.taskId]:parent};f.registry.ownerId='owner';f.registry.companyId='company';f.registry.team={ids:{qa:f.operation.agentId}};f.operation={...f.operation,rootTaskId:parent,kind:'run',role:'qa',phase:'qa-supplement',evidenceManifestSha256:'b'.repeat(64)};f.registry.qaSupplementAllowances={[parent]:{maximum:7,approvedBy:'owner',companyId:'company',rootTaskId:parent,qaTaskId:f.operation.taskId,agentId:f.operation.agentId,operationId:f.operation.id,evidenceManifestSha256:'b'.repeat(64),expiresAt:Date.now()+60000}};return f;}
test('only the exact owner-authorized QA can consume the seventh original-root slot once',async t=>{const f=seventhFixture(t);let calls=0;await withRoleCall({...f,log(){},perform:async()=>{calls++;return{ok:true};},completed:x=>x.ok},f);assert.equal(calls,1);assert.equal(fs.readdirSync(f.root+'/budget/'+f.operation.rootTaskId).length,7);await assert.rejects(withRoleCall({...f,log(){},perform:()=>assert.fail('replayed seventh'),completed:()=>true},f),/BUDGET_DENIED/);});
test('seventh allowance cannot authorize another actor, task, purpose, operation, evidence or expiry',async t=>{for(const change of[o=>o.role='chief',o=>o.kind='probe',o=>o.phase='work',o=>o.agentId=randomUUID(),o=>o.id=randomUUID(),o=>o.evidenceManifestSha256='c'.repeat(64)]){const f=seventhFixture(t);change(f.operation);await assert.rejects(withRoleCall({...f,log(){},perform:()=>assert.fail('expanded allowance'),completed:()=>true},f),/BUDGET_DENIED/);}const f=seventhFixture(t);f.registry.qaSupplementAllowances[f.operation.rootTaskId].expiresAt=1;await assert.rejects(withRoleCall({...f,log(){},perform:()=>assert.fail('expired'),completed:()=>true},f),/BUDGET_DENIED/);});
test('child cannot omit the root mapping and an unknown seventh keeps its owning fence',async t=>{const f=seventhFixture(t);const noRoot={...f.operation};delete noRoot.rootTaskId;await assert.rejects(withRoleCall({...f,operation:noRoot,log(){},perform:()=>assert.fail('child reset'),completed:()=>true},f),/ROOT_DENIED/);await withRoleCall({...f,log(){},perform:async()=>({unknown:true}),completed:()=>false},f);assert.equal(fs.existsSync(f.root+'/call.lock'),true);await assert.rejects(withRoleCall({...f,operation:{...f.operation,id:randomUUID()},log(){},perform:()=>assert.fail('unknown retry'),completed:()=>true},f));});
