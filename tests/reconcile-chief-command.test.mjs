import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
const load=()=>import('../scripts/reconcile-chief-command.mjs');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(){
 const request={schemaVersion:1,taskId:randomUUID(),companyId:randomUUID(),projectId:randomUUID(),sourceKey:'a'.repeat(64),operationId:randomUUID(),expectedInputRevision:'b'.repeat(64),expectedControlRevision:5,expectedFingerprint:'c'.repeat(64),expectedBodySha256:'d'.repeat(64)};
 const registry={ownerId:'owner',companyId:request.companyId,team:{enabled:false}},calls=[];
 const state={registrySha256:sha(registry),activeRuns:0,unsettledLeases:0,phaseLeases:0,callLock:false,controlLock:false,budgetSha256:'e'.repeat(64),usedCalls:8};
 const api={request:async route=>{calls.push(route);return route==='/auth/get-session'?{user:{id:registry.ownerId}}:{id:request.taskId,parentId:null,companyId:request.companyId,projectId:request.projectId,responsibleUserId:registry.ownerId};}};
 const runtime={reconcileOwnerContinue:async args=>{calls.push(args);return{mode:args.apply?'apply':'preview',status:args.apply?'applied':'preview',canApply:true,taskId:request.taskId,sourceKey:request.sourceKey,operationId:request.operationId,modelCalls:0,newTasks:0,result:{kind:'continue',status:'resume_requested',resumeOperationId:request.operationId}};}};
 return{request,registry,state,calls,api,runtime,snapshot:async()=>({...state}),log:()=>{}};
}
test('Owner command CLI rejects new text, message identifiers and arbitrary options',async()=>{
 const {chiefCommandArgs}=await load();assert.deepEqual(chiefCommandArgs(['--request','/private/request.json']),{requestFile:'/private/request.json',apply:false});
 for(const args of [['--text','continue'],['--request','/private/a','--message-id','om_new'],['--request','/private/a','--owner','fake'],['--request','/private/a','--apply','--apply']])assert.throws(()=>chiefCommandArgs(args),/CHIEF_CONTEXT_RECONCILE_ARGUMENTS_INVALID/);
});
test('default preview verifies the actual Owner and paused idle window without applying or acknowledging',async()=>{
 const {reconcileChiefCommand}=await load(),f=fixture(),result=await reconcileChiefCommand(f);assert.equal(result.mode,'preview');assert.equal(result.usedCalls,8);
 assert.deepEqual(f.calls.slice(0,2),['/auth/get-session','/issues/'+f.request.taskId]);assert.equal(f.calls[2].apply,false);assert.equal(f.calls.length,3);
});
test('the administrative CLI refuses wrong Owner, scope, active runs, leases, phase and stale registry',async()=>{
 const {reconcileChiefCommand}=await load();
 for(const alter of [f=>{f.api.request=async()=>({user:{id:'other'}});},f=>f.registry.team.enabled=true,f=>f.state.activeRuns=1,f=>f.state.unsettledLeases=1,f=>f.state.phaseLeases=1,f=>f.state.callLock=true,f=>f.state.controlLock=true,f=>f.state.registrySha256='0'.repeat(64)]){
  const f=fixture();alter(f);await assert.rejects(reconcileChiefCommand({...f,apply:true}),/^Error: (?:CHIEF_CONTEXT_RECONCILE_|ROLE_OWNER_)/);assert.ok(!f.calls.some(value=>typeof value==='object'));
 }
});
