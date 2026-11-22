import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativePlanCollectionFixture,claimNativePlanControl,retireNativePlanControl} from './helpers/native-plan-collection-fixture.mjs';

const options={skip:!fs.existsSync('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js'),timeout:90000};

test('a pre-existing control root is refused before fixture initialization and its sentinel/registry stay unchanged',options,async t=>{
 const root='/paperclip/control';fs.mkdirSync(root,{mode:0o700});const identity=fs.lstatSync(root);
 fs.mkdirSync(root+'/research-pm',{mode:0o700});fs.writeFileSync(root+'/sentinel','foreign state must survive\n',{mode:0o600});
 fs.writeFileSync(root+'/research-pm/registry.json','{"foreign":"preserve original bytes"}\n',{mode:0o600});
 const before={sentinel:fs.readFileSync(root+'/sentinel'),registry:fs.readFileSync(root+'/research-pm/registry.json'),entries:fs.readdirSync(root).sort()};
 t.after(()=>{const stat=fs.lstatSync(root);assert.equal(stat.ino,identity.ino);assert.equal(stat.dev,identity.dev);assert.deepEqual(fs.readFileSync(root+'/sentinel'),before.sentinel);assert.deepEqual(fs.readFileSync(root+'/research-pm/registry.json'),before.registry);assert.deepEqual(fs.readdirSync(root).sort(),before.entries);fs.rmSync(root,{recursive:true});});
 await assert.rejects(nativePlanCollectionFixture(t),/NATIVE_PLAN_FIXTURE_CONTROL_EXISTS/);
 assert.deepEqual(fs.readFileSync(root+'/sentinel'),before.sentinel);assert.deepEqual(fs.readFileSync(root+'/research-pm/registry.json'),before.registry);
 assert.deepEqual(fs.readdirSync(root).sort(),before.entries);assert.equal(fs.lstatSync(root).ino,identity.ino);
});

test('the actual controller rejects a different generation after filename validation, without collecting or reserving',options,async t=>{
 const p=await nativePlanCollectionFixture(t,{foreignGeneration:true}),budget=p.budget(),runs=await p.rootRuns();
 assert.equal(p.phase().length,0);await p.coordinator.tick();
 assert.equal(p.runtimeEvents().at(-1).code,'TEAM_PLAN_OUTPUT_SCOPE_DENIED');
 assert.deepEqual(await p.children(),p.historicalChildren);assert.equal((await p.control()).plan,null);assert.equal(p.executions.length,0);assert.equal(p.phase().length,0);
 assert.deepEqual(await p.rootRuns(),runs);assert.deepEqual(p.budget(),budget);assert.deepEqual(fs.readFileSync(p.planFile),p.planBytes);
 assert.equal(fs.existsSync(p.workflowFile),false);
 t.diagnostic(JSON.stringify({contract:'isolated Native foreign-generation collection',guard:'TEAM_PLAN_OUTPUT_SCOPE_DENIED',historicalChildrenPreserved:2,newChildren:0,newNativeChiefRuns:0,providerCalls:0,rootCallFiles:5}));
});

test('released Chief phase naturally collects the original success, then the first child reserves a fresh Native phase',options,async t=>{
 const p=await nativePlanCollectionFixture(t),budget=p.budget(),runs=await p.rootRuns();
 assert.equal(p.phase().length,0);assert.equal(p.f.operation.acceptedRunId,undefined);
 await p.coordinator.tick();
 const children=await p.children();assert.equal(children.length,6,JSON.stringify(p.runtimeEvents()));
 const historicalIds=new Set(p.historicalChildren.map(child=>child.id));assert.deepEqual(children.filter(child=>historicalIds.has(child.id)),p.historicalChildren);
 const control=await p.control();assert.equal(control.plan.runId,p.f.run.id);assert.equal(control.plan.sourceOperationId,p.f.operation.id);
 assert.equal(control.resumeClaim.status,'completed');assert.equal(control.resumeOperationId,null);
 const flow=JSON.parse(fs.readFileSync(p.workflowFile));assert.equal(flow.dispatched,true);assert.equal(flow.sourceRunId,p.f.run.id);assert.equal(flow.sourceOperationId,p.f.operation.id);
 let timer;const captured=await Promise.race([p.reached,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('first child did not reach the no-model boundary: '+JSON.stringify(p.runtimeEvents()))),15000);})]).finally(()=>clearTimeout(timer));
 assert.equal(p.executions.length,1);assert.notEqual(captured.agentId,p.f.operation.agentId);
 assert.equal(captured.phase.length,1);assert.notEqual(captured.phase[0].nonce,p.oldNonce);
 assert.ok(children.some(child=>child.id===captured.phase[0].taskId));assert.equal(captured.registry.lease.taskId,captured.phase[0].taskId);
 assert.equal(captured.registry.lease.nonce,captured.phase[0].nonce);assert.notEqual(captured.registry.lease.operationId,p.f.operation.id);
 assert.ok(p.runtimeEvents().some(event=>event.code==='ADMISSION_RESERVING'&&event.taskId===captured.phase[0].taskId));
 const childIds=children.map(child=>child.id).sort(),planControl=JSON.stringify(control.plan);
 for(let repeat=0;repeat<3;repeat++)await p.coordinator.tick();
 assert.deepEqual((await p.children()).map(child=>child.id).sort(),childIds);assert.equal(JSON.stringify((await p.control()).plan),planControl);
 assert.equal(p.executions.length,1);assert.deepEqual(await p.rootRuns(),runs);assert.deepEqual(p.budget(),budget);assert.deepEqual(fs.readFileSync(p.planFile),p.planBytes);
 assert.equal(p.runtimeEvents().filter(event=>event.code==='TEAM_NATIVE_CHILDREN_CREATED').length,1);
 assert.equal(p.runtimeEvents().some(event=>event.code==='TEAM_RUNTIME_FAILED'),false);
 assert.ok(p.runtimeEvents().some(event=>event.code==='ADMISSION_LEASE_DENIED'),'the historical expired nonce is informational and must not prevent collection');
 t.diagnostic(JSON.stringify({contract:'isolated Native stored-success collection',storedChiefSuccessReused:true,newNativeChiefRuns:0,newNativeChildRuns:1,providerCalls:0,
  historicalChildrenPreserved:2,newChildren:4,rootCallFiles:5,sourcePlanBytesUnchanged:true,oldNonceRestored:false,firstChildFreshFormalPhase:true,repeatedTicks:3,duplicateChildren:0}));
});

test('control retirement preserves changed markers and replacement directory identities',options,()=>{
 const root='/paperclip/control',marker=root+'/.native-plan-collection-owner.json',owner=claimNativePlanControl(),original=fs.readFileSync(marker),identity=fs.lstatSync(root);
 fs.writeFileSync(marker,'changed marker\n');assert.throws(()=>retireNativePlanControl(owner),/NATIVE_PLAN_FIXTURE_CONTROL_CHANGED/);
 assert.equal(fs.readFileSync(marker,'utf8'),'changed marker\n');
 fs.writeFileSync(marker,original);fs.renameSync(root,root+'-owned-drift');fs.mkdirSync(root,{mode:0o700});
 fs.renameSync(root+'-owned-drift/.native-plan-collection-owner.json',marker);fs.writeFileSync(root+'/sentinel','replacement must remain',{mode:0o600});
 assert.notEqual(fs.lstatSync(root).ino,identity.ino);assert.throws(()=>retireNativePlanControl(owner),/NATIVE_PLAN_FIXTURE_CONTROL_CHANGED/);
 assert.equal(fs.readFileSync(root+'/sentinel','utf8'),'replacement must remain');assert.deepEqual(fs.readFileSync(marker),original);
 assert.equal(fs.lstatSync(root+'-owned-drift').ino,identity.ino);
 // Deliberately retained after refusal; the owning disposable container retires its bounded tmpfs after this final case.
});
