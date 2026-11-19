import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AdmissionMeter} from '../bridge/admission.mjs';
import {withRoleCall} from '../bridge/role-call-budget.mjs';
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
test('six physical calls and unknown outcomes stop further provider calls',async t=>{
 const f=fixture(t);
 for(let i=0;i<6;i++)fs.writeFileSync(f.root+'/budget/'+f.operation.taskId+'/'+randomUUID()+'.json','{}',{mode:0o600});
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
 for(let i=0;i<5;i++)fs.writeFileSync(f.root+'/budget/'+parent+'/'+randomUUID()+'.json','{}',{mode:0o600});
 await assert.rejects(withRoleCall({...f,operation:{...operation,id:randomUUID()},log(){},perform:()=>assert.fail('child bypassed root cap'),completed:()=>true},f),/ROLE_CALL_BUDGET_DENIED/);
 await assert.rejects(withRoleCall({...f,operation:{...operation,id:randomUUID(),rootTaskId:randomUUID()},log(){},perform:()=>assert.fail('unregistered root'),completed:()=>true},f),/ROLE_CALL_ROOT_DENIED/);
});
