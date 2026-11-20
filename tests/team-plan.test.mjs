import test from'node:test';import assert from'node:assert/strict';import{validateTeamPlan,authorizeChiefOwnerInput}from'../bridge/team-plan.mjs';
const plan=()=>({schemaVersion:1,tasks:[{key:'network',role:'network-engineer',title:'Read network snapshot',goal:'Observe only',outputFile:'network-report.md',dependsOn:[],networkScope:{topics:['gateway','tailscale'],actions:['observe','diagnose','report']}},{key:'pm',role:'pm',title:'Requirements',goal:'Read report',outputFile:'requirements.md',dependsOn:['network']}]});
test('Chief plan is bounded by the same root budget, DAG, scoped roles and unique artifacts',()=>{assert.equal(validateTeamPlan(plan(),{remainingCalls:5}).tasks.length,2);assert.throws(()=>validateTeamPlan(plan(),{remainingCalls:2}),/BUDGET/);const p=plan();p.tasks[0].dependsOn=['pm'];assert.throws(()=>validateTeamPlan(p,{remainingCalls:5}),/DEPENDENCY/);const q=plan();q.tasks[0].networkScope.actions=['restart'];assert.throws(()=>validateTeamPlan(q,{remainingCalls:5}),/NETWORK_ROLE_SCOPE/);const x=plan();x.tasks[1].role='chief';assert.throws(()=>validateTeamPlan(x,{remainingCalls:5}),/SCOPE/);});
test('automatic Chief admission requires the authoritative owner and no unknown prior provider work',()=>{
 const registry={companyId:'c',ownerId:'u',team:{enabled:true,projectId:'p',ids:{chief:'a'}}},task={companyId:'c',projectId:'p',createdByUserId:'u',responsibleUserId:'u',assigneeAgentId:'a',status:'todo'},run={agentId:'a',companyId:'c',responsibleUserId:'u',status:'running'},wakeup={requestedByActorType:'user',requestedByActorId:'u',agentId:'a'};const input={registry,task,run,wakeup,previousRuns:[]};assert.equal(authorizeChiefOwnerInput(input),true);assert.throws(()=>authorizeChiefOwnerInput({...input,wakeup:{...wakeup,requestedByActorId:'other'}}),/OWNER_INPUT/);assert.throws(()=>authorizeChiefOwnerInput({...input,previousRuns:[{status:'failed',resultJson:{}}]}),/OWNER_INPUT/);assert.throws(()=>authorizeChiefOwnerInput({...input,task:{...task,projectId:null}}),/OWNER_INPUT/);
});
test('title and description both participate in the actual Native input version',async()=>{const{taskInputRevision}=await import('../bridge/task-input.mjs');assert.notEqual(taskInputRevision({title:'old',description:'same'}),taskInputRevision({title:'new',description:'same'}));assert.notEqual(taskInputRevision({title:'same',description:'old'}),taskInputRevision({title:'same',description:'new'}));});
test('quality review must follow all work it certifies and bind exact artifact identities',async()=>{const p=plan();p.tasks.push({key:'quality',role:'qa',title:'Independent review',goal:'Review actual artifacts',outputFile:'quality.json',dependsOn:[]});assert.throws(()=>validateTeamPlan(p,{remainingCalls:5}),/REVIEW_DEPENDENCY/);p.tasks[2].dependsOn=['pm'];assert.equal(validateTeamPlan(p,{remainingCalls:5}).tasks.length,3);const{sameReviewedArtifacts}=await import('../bridge/team-plan.mjs');const expected=[{taskId:'task',runId:'run',file:'artifact.md',sha256:'a'.repeat(64)}];assert.equal(sameReviewedArtifacts([{sha256:'a'.repeat(64),file:'artifact.md',runId:'run',taskId:'task'}],expected),true);assert.equal(sameReviewedArtifacts([{...expected[0],sha256:'b'.repeat(64)}],expected),false);});
test('Chief may request supplementary role capabilities but cannot provide arbitrary tools',()=>{
 const p=plan();p.tasks[1].capabilities=['designer'];
 assert.deepEqual(validateTeamPlan(p,{remainingCalls:5}).tasks[1].capabilities,['designer']);
 p.tasks[1].capabilities=['host.shell'];assert.throws(()=>validateTeamPlan(p,{remainingCalls:5}),/CAPABILITIES/);
});
test('Chief carries selected metadata host action IDs but rejects command objects',()=>{
 const p=plan();p.tasks[0].hostActions=['switch-proxy'];assert.deepEqual(validateTeamPlan(p,{remainingCalls:5}).tasks[0].hostActions,['switch-proxy']);
 p.tasks[0].hostActions=[{argv:['sudo','reboot']}];assert.throws(()=>validateTeamPlan(p,{remainingCalls:5}),/HOST_ACTIONS/);
});
test('company Chief accepts an owner task in another Native project with the same authority checks',()=>{
 const registry={companyId:'c',ownerId:'u',team:{enabled:true,projectId:'m1',ids:{chief:'a'}}},task={companyId:'c',projectId:'rwb',createdByUserId:'u',responsibleUserId:'u',assigneeAgentId:'a',status:'todo'},run={agentId:'a',companyId:'c',responsibleUserId:'u',status:'running'},wakeup={requestedByActorType:'user',requestedByActorId:'u',agentId:'a'};
 assert.equal(authorizeChiefOwnerInput({registry,task,run,wakeup,previousRuns:[]}),true);
 assert.throws(()=>authorizeChiefOwnerInput({registry,task:{...task,companyId:'foreign'},run,wakeup,previousRuns:[]}),/OWNER_INPUT/);
});
test('code review binds the successful source Native run and exact Git candidate SHA',async()=>{
 const {validateTeamCodeCandidate,validateTeamQaResult}=await import('../bridge/team-plan.mjs');
 const candidate={rootTaskId:'root',projectId:'rwb',runId:'source-run',agentId:'backend',taskId:'source-task',candidateSha:'a'.repeat(40),hostPath:'/task/worktree',branch:'codex/root-paperclip-work'};
 const options={rootTaskId:'root',projectId:'rwb',workspaceHostPath:'/task/worktree',artifacts:[{runId:'source-run',taskId:'source-task'}],run:{id:'source-run',agentId:'backend',companyId:'company',issueId:'source-task',status:'succeeded'},companyId:'company',qaAgentId:'quality'};
 assert.deepEqual(validateTeamCodeCandidate(candidate,options),candidate);
 assert.throws(()=>validateTeamCodeCandidate(candidate,{...options,run:{...options.run,status:'running'}}),/CODE_CANDIDATE/);
 assert.throws(()=>validateTeamCodeCandidate(candidate,{...options,artifacts:[]}),/CODE_CANDIDATE/);
 const reviewedArtifacts=[{taskId:'source-task',runId:'source-run',file:'report.md',sha256:'b'.repeat(64)}];
 const result={verdict:'PASS',findings:[],notRun:[],reviewedArtifacts,reviewedCandidateSha:'a'.repeat(40)};
 assert.equal(validateTeamQaResult(result,{reviewedArtifacts,codeCandidate:candidate}).verdict,'PASS');
 assert.throws(()=>validateTeamQaResult({...result,reviewedCandidateSha:'c'.repeat(40)},{reviewedArtifacts,codeCandidate:candidate}),/QA_CANDIDATE/);
 assert.equal(validateTeamQaResult({...result,reviewedCandidateSha:undefined},{reviewedArtifacts}).verdict,'PASS');
});
test('integration candidate is constrained to the same root sibling and managed branch',async()=>{
 const {validateTeamCodeCandidate}=await import('../bridge/team-plan.mjs');
 const candidate={rootTaskId:'root',projectId:'p',runId:'dev-run',agentId:'dev',taskId:'dev-task',candidateSha:'a'.repeat(40),hostPath:'/task/root-integration-r1',branch:'codex/integrate-root-r1'};
 const options={rootTaskId:'root',projectId:'p',workspaceHostPath:'/task/root',companyId:'c',artifacts:[{runId:'dev-run',taskId:'dev-task'}],run:{id:'dev-run',agentId:'dev',issueId:'dev-task',companyId:'c',status:'succeeded'},qaAgentId:'qa'};
 assert.deepEqual(validateTeamCodeCandidate(candidate,options),candidate);
 for(const replacement of [{hostPath:'/elsewhere/root-integration-r1'},{branch:'foreign'},{hostPath:'/task/other-integration'}])assert.throws(()=>validateTeamCodeCandidate({...candidate,...replacement},options),/CODE_CANDIDATE/);
});
test('delivery may depend on independent QA without QA certifying its downstream publication',()=>{
 const p={schemaVersion:1,tasks:[{key:'code',role:'backend-engineer',title:'Code',goal:'Implement',outputFile:'code.md',dependsOn:[]},{key:'quality',role:'qa',title:'QA',goal:'Review integration',outputFile:'quality.json',dependsOn:['code']},{key:'publish',role:'devops',title:'PR',goal:'Publish reviewed candidate',outputFile:'publish.md',dependsOn:['quality']}]};
 assert.equal(validateTeamPlan(p,{remainingCalls:5}).tasks.length,3);
});
test('QA check evidence and downstream review use trusted Native identities',async()=>{
 const {validateTeamCheckEvidence,codeReviewForTeamStep}=await import('../bridge/team-plan.mjs');assert.equal(typeof validateTeamCheckEvidence,'function');assert.equal(typeof codeReviewForTeamStep,'function');
 const permit={rootTaskId:'root',projectId:'p',runId:'qa-run',agentId:'qa',taskId:'qa-task',projectContext:{checks:[{id:'unit'}]}};
 const evidence={rootTaskId:'root',projectId:'p',runId:'qa-run',agentId:'qa',taskId:'qa-task',candidateSha:'a'.repeat(40),checks:[{checkId:'unit',status:'passed',durationSeconds:2}]};
 const actual=validateTeamCheckEvidence(evidence,{permit,candidateSha:evidence.candidateSha});assert.equal(actual.verification.durationSeconds,2);assert.equal(actual.checks[0].id,'unit');
 assert.throws(()=>validateTeamCheckEvidence({...evidence,runId:'model-claimed-run'},{permit,candidateSha:evidence.candidateSha}),/CHECK_EVIDENCE/);
 const flow={codeReview:{candidateSha:evidence.candidateSha},taskEntries:[{key:'code',role:'backend-engineer',dependsOn:[]},{key:'qa',role:'qa',dependsOn:['code']},{key:'release',role:'devops',dependsOn:['qa']}]};
 assert.deepEqual(codeReviewForTeamStep(flow,flow.taskEntries[2],'work'),flow.codeReview);assert.equal(codeReviewForTeamStep(flow,flow.taskEntries[0],'work'),undefined);assert.deepEqual(codeReviewForTeamStep(flow,{},'summary'),flow.codeReview);
});
