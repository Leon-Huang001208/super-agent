import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture,nativeFixture,contents,controlledPreflight} from './helpers/completed-resume-chief-fixture.mjs';
import {captureNativeChiefDispatch} from './helpers/native-chief-dispatch-fixture.mjs';
import {isPristineCompletedResumeChiefSuccessor} from '../bridge/role-native-retry.mjs';
import {bindNativeRetryAttempt,startTeamCoordinator} from '../bridge/team-native-runtime.mjs';

for(const second of [false,true])test('installed Native queue → selector → dispatch → production binder, attempt '+(second?2:1),{
 skip:!fs.existsSync('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),timeout:90000,
},async t=>{
 const f=second?controlledPreflight(fixture(t)):fixture(t);f.nativeWorkspace.cwd='/tmp/sa-native-source';
 for(const value of [f.ctx.context,f.wakeup.payload._paperclipWakeContext,...f.taskRuns.map(run=>run.contextSnapshot)])if(value?.paperclipWorkspace)value.paperclipWorkspace.cwd=f.nativeWorkspace.cwd;
 nativeFixture(t,f);const budgetBefore=contents(f.root+'/budget'),registryBefore=fs.readFileSync(f.root+'/registry.json');
 const captured=await captureNativeChiefDispatch(async p=>{
  assert.equal(p.run.status,'running');assert.ok(p.run.startedAt);assert.equal(p.run.nativeSessionId,null);assert.equal(p.run.processPid,null);assert.equal(p.run.lastOutputSeq,0);
  assert.equal(p.run.usageJson.accountingReceiptSequence,0);assert.equal(p.run.usageJson.accountingReceiptReady,false);
  assert.deepEqual(p.run.usageJson.ledgerScope,{issueId:f.task.id,projectId:f.task.projectId,billingCode:null});
  assert.equal(p.run.costAccountingPending,true);assert.equal(p.reservations.length,1);assert.equal(p.reservations[0].state,'held');
  assert.equal(isPristineCompletedResumeChiefSuccessor(p.run,'running',p.task),true,'real outer Native bookkeeping must be admitted');
  const ctx={runId:p.run.id,agent:{id:p.run.agentId},context:p.context};
  assert.equal(await bindNativeRetryAttempt(ctx,{database:async()=>p}),ctx);
 },{fixture:f,consume:async p=>{
  const coordinator=startTeamCoordinator({database:async()=>p,nativePorts:async()=>p});
  try{await coordinator.tick();}finally{coordinator.stop();}
 }});
 assert.equal(captured.entered,1);assert.deepEqual(contents(f.root+'/budget'),budgetBefore);assert.deepEqual(fs.readFileSync(f.root+'/registry.json'),registryBefore);
 for(const directory of ['permits','claims','results','transport','operations'])assert.equal(fs.existsSync(f.root+'/'+directory),false,directory);
 if(second)assert.equal(f.parentRun.resultJson.executionRecovery.providerWorkStarted,null);
});
