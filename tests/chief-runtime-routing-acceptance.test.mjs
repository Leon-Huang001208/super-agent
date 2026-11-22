import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createIsolatedAcceptance} from '../scripts/multi-runtime-acceptance.mjs';
import {taskInputRevision} from '../bridge/task-input.mjs';
import {assertChiefRoutingSource,createChiefRuntimeRoutingStage,chiefRuntimeRoutingPrompt,validateChiefRuntimeDecision,currentImplementationRegistration,
 validateRuntimeImplementationObservation,writeChiefRoutingEvidenceOnce,chiefRuntimeCheckCommands,runChiefRuntimeRoutingAcceptance} from '../scripts/chief-runtime-routing-acceptance.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),clone=structuredClone;
test('historical success remains evidence but a changed implementation cannot enter the current pool',()=>{
 const original={id:randomUUID(),status:'ACTIVE'},recorded={sourceSha256:sha('old source'),cliSha256:sha('same CLI')};
 assert.equal(currentImplementationRegistration(original,recorded,recorded).status,'ACTIVE');
 assert.equal(currentImplementationRegistration(original,recorded,{...recorded,sourceSha256:sha('prepared source')}).status,'INACTIVE_IMPLEMENTATION');
 assert.equal(currentImplementationRegistration(original,recorded,{...recorded,cliSha256:sha('new CLI')}).status,'INACTIVE_IMPLEMENTATION');
 assert.equal(original.status,'ACTIVE');assert.throws(()=>currentImplementationRegistration(original,recorded,{sourceSha256:'invented'}));
});
function fixture(){
 const plan=createIsolatedAcceptance();plan.status='PASS';for(const step of plan.steps){step.status='PASS';step.runId=randomUUID();}
 const rootTask={id:plan.rootTaskId,title:'Same original goal',description:'Original unchanged description',projectId:plan.projectId,companyId:plan.companyId};plan.rootInputRevision=taskInputRevision(rootTask);
 const backend=plan.steps.find(step=>step.key==='backend-handoff'),targetTask={id:backend.taskId,title:'Original feature',description:'Existing same task',projectId:plan.projectId,companyId:plan.companyId};
 const registry={companyId:plan.companyId,projectId:plan.projectId,taskId:plan.rootTaskId,ownerId:'fixture-owner',enabled:true,
  team:{enabled:false,ids:clone(plan.agentIds)},agents:Object.entries(plan.agentIds).map(([role,agentId])=>({profile:{role,agentId}})),runtimeRouting:{schemaVersion:1,mode:'task'},policy:{maxRootRoleCalls:20,maxResponsesPerRun:64,concurrentExecutions:1}};
 return{plan,rootTask,targetTask,registry};
}

test('Chief stage retains the original root and registered roster while deferring the unique execution Owner to the Chief',()=>{
 const f=fixture();assertChiefRoutingSource(f.plan,f.registry);
 const before=clone(f),stage=createChiefRuntimeRoutingStage({...f,sourcePlanSha256:sha('source'),budgetBefore:[{file:randomUUID()+'.json',sha256:sha('budget')}]});
 assert.deepEqual(f,before);assert.equal(stage.chief.taskId,f.plan.rootTaskId);assert.equal(stage.chief.role,'chief');assert.equal(stage.chief.agentId,f.plan.agentIds.chief);
 assert.equal(stage.execution.taskId,f.targetTask.id);assert.equal(stage.execution.agentId,undefined);
 assert.deepEqual(stage.execution.ownerCandidates.map(owner=>owner.role),['full-stack-engineer','backend-engineer','frontend-engineer']);
 assert.notEqual(stage.chief.operationId,stage.execution.operationId);assert.equal(stage.execution.handoffFromOperationId,f.plan.steps.find(step=>step.key==='backend-handoff').operationId);
 for(const phase of [stage.chief,stage.execution]){assert.match(phase.outputFile,/^[a-z][a-z0-9-]{0,110}\.json$/);assert.ok(!f.plan.steps.some(step=>step.outputFile===phase.outputFile));}
 assert.equal(stage.chief.phase,'summary');assert.match(stage.chief.summaryFile,/\.md$/);assert.ok(stage.chief.artifactGeneration);
 assert.equal(stage.status,'NOT_RUN');assert.equal(stage.chief.status,'NOT_RUN');assert.equal(stage.execution.status,'NOT_RUN');
});

test('unpassed or switched original namespaces cannot enter the real Chief stage',()=>{
 for(const mutate of [f=>{f.plan.status='FAILED';},f=>{f.plan.steps[0].status='NOT_RUN';},f=>{f.registry.companyId=randomUUID();},
  f=>{f.registry.team.ids.chief=randomUUID();},f=>{f.registry.team.enabled=true;},f=>{f.registry.policy.maxRootRoleCalls=21;}]){
  const f=fixture();mutate(f);assert.throws(()=>assertChiefRoutingSource(f.plan,f.registry));
 }
});

test('Chief prompt separates models from runtimes and contains only verified availability metadata',()=>{
 const f=fixture(),stage=createChiefRuntimeRoutingStage({...f,sourcePlanSha256:sha('source'),budgetBefore:[]});
 const pool={available:[{modelId:'MiniMax-M3.1-Flash',runtimeId:'opencode',profileId:'minimax_opencode',tools:['shell'],taskTypes:['execution'],receiptSha256:sha('receipt')}],blocked:[{private:'DO_NOT_INCLUDE'}]};
 const text=chiefRuntimeRoutingPrompt(stage,pool);
 assert.match(text,/modelId/);assert.match(text,/runtimeId/);assert.match(text,/requiredTools/);assert.match(text,/MiniMax-M3\.1-Flash/);
 assert.ok(!text.includes('DO_NOT_INCLUDE'));assert.ok(!text.includes('apiKey'));assert.match(text,/不创建/);assert.match(text,/真实/);
});

test('decision validation rejects changed identities and prompt-provided PASS/evidence without executing a Native fixture',()=>{
 const f=fixture(),stage=createChiefRuntimeRoutingStage({...f,sourcePlanSha256:sha('source'),budgetBefore:[]});
 const proposal={...stage.execution.identity,role:'backend-engineer',agentId:f.plan.agentIds['backend-engineer'],complexity:'routine',risk:'low',purpose:'execution',modelId:'MiniMax-M3.1-Flash',runtimeId:'opencode',requiredTools:['shell']};
 for(const changes of [{schemaVersion:2},{status:'PASS'},{proposal:{...proposal,taskId:randomUUID()}},{proposal:{...proposal,pool:'PASS'}},
  {proposal:{...proposal,requiredTools:[]}}]){
  const value={schemaVersion:1,proposal,ownerReason:'specialist work',modelReason:'routine work',runtimeReason:'proven shell',...changes};
  assert.throws(()=>validateChiefRuntimeDecision(value,{stage,pool:{}}));
 }
});

test('fresh Host observations cannot be replaced by stale records or invented bindings',()=>{
 const now=Date.now(),profileId='minimax_opencode',actual={sourceSha256:sha('source'),cliSha256:sha('cli')};
 const observation={schemaVersion:1,kind:'macos-runtime-implementations',hostPlatform:'darwin',capturedAt:new Date(now).toISOString(),bindings:{[profileId]:actual}};
 assert.deepEqual(validateRuntimeImplementationObservation(observation,{profileId,now,sourceSha256:actual.sourceSha256}),actual);
 for(const changed of [{...observation,capturedAt:new Date(now-300001).toISOString()},{...observation,hostPlatform:'linux'},
  {...observation,bindings:{[profileId]:{...actual,cliSha256:'invented'}}}])assert.throws(()=>validateRuntimeImplementationObservation(changed,{profileId,now,sourceSha256:actual.sourceSha256}));
 assert.throws(()=>validateRuntimeImplementationObservation(observation,{profileId,now,sourceSha256:sha('changed source')}));
});

test('evidence writes are immutable and refuse traversal, links and different existing bytes',t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chief-routing-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const item={file:'runs/'+randomUUID()+'/source.json',bytes:Buffer.from('{}\n')};writeChiefRoutingEvidenceOnce(root,[item]);writeChiefRoutingEvidenceOnce(root,[item]);
 assert.throws(()=>writeChiefRoutingEvidenceOnce(root,[{...item,bytes:Buffer.from('changed')}]));
 assert.throws(()=>writeChiefRoutingEvidenceOnce(root,[{file:'../outside',bytes:Buffer.from('bad')}]));
 fs.symlinkSync(root,path.join(root,'linked'));assert.throws(()=>writeChiefRoutingEvidenceOnce(root,[{file:'linked/escape.json',bytes:Buffer.from('{}')}]));
});

test('only previously operator-tested local Node suites are eligible for independent execution',()=>{
 const taskId=randomUUID(),cases={steps:[{taskId,testing:[{command:'node --test feature.test.mjs',exitCode:0},{command:'node --test --test-reporter=tap feature.test.mjs',exitCode:0}]}]};
 assert.deepEqual(chiefRuntimeCheckCommands(cases,taskId),[{file:'feature.test.mjs',command:'node --test feature.test.mjs'}]);
 for(const command of ['node --test ../outside.test.mjs','node --test feature.test.mjs; fake-command','curl https://remote.invalid','node --eval fake']){
  assert.throws(()=>chiefRuntimeCheckCommands({steps:[{taskId,testing:[{command,exitCode:0}]}]},taskId));
 }
 assert.throws(()=>chiefRuntimeCheckCommands({steps:[{taskId,testing:[{command:'node --test feature.test.mjs',exitCode:1}]}]},taskId));
});

test('the executable rejects this host before reading credentials, creating tasks or contacting models',async()=>{
 if(process.platform==='linux'&&process.getuid?.()===0&&process.env.SUPER_AGENT_ISOLATED_MULTI_RUNTIME==='1')return;
 await assert.rejects(runChiefRuntimeRoutingAcceptance('/not-read-secret-input'),error=>error.code==='CHIEF_ROUTING_ISOLATED_ENVIRONMENT_REQUIRED');
});
