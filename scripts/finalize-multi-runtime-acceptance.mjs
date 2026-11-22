/** Complete an already executed matrix after the ordinary-artifact reader fix. Never dispatches a model. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {CSV_TESTS,readAcceptanceArtifactJson,verifyAcceptanceHandoff} from './multi-runtime-acceptance.mjs';
import {ACCEPTANCE_ROOT as ROOT,privateJson,writePrivate,archivePrivateSnapshot} from '../tests/helpers/multi-runtime-native-fixture.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
export async function finalizeExecutedAcceptance(){
 if(process.platform!=='linux'||process.getuid()!==0||process.env.SUPER_AGENT_ISOLATED_MULTI_RUNTIME!=='1'||
  process.env.SUPER_AGENT_ISOLATED_DATABASE_URL!=='postgres://postgres@127.0.0.1:5432/sa_multi_runtime_acceptance')fail('MULTI_RUNTIME_FINALIZATION_SCOPE_DENIED');
 const reportFile=ROOT+'/multi-runtime-acceptance.json',plan=privateJson(reportFile),registry=privateJson(ROOT+'/registry.json');
 if(plan.status!=='FAILED'||plan.errorCode!=='MULTI_RUNTIME_PRIVATE_INPUT_DENIED'||plan.steps?.length!==5||plan.steps.slice(0,4).some(step=>step.status!=='PASS')||
  plan.steps[4].role!=='qa'||plan.steps[4].status!=='succeeded'||registry.companyId!==plan.companyId||registry.taskId!==plan.rootTaskId||registry.lease||fs.existsSync(ROOT+'/call.lock')||
  fs.readFileSync(ROOT+'/.multi-runtime-owner','utf8')!==plan.companyId)fail('MULTI_RUNTIME_FINALIZATION_STATE_DENIED');
 const s=await import('/opt/paperclip/node_modules/@paperclipai/db/dist/index.js');
 const url=process.env.SUPER_AGENT_ISOLATED_DATABASE_URL,db=s.createDb(url);
 try{
  const runs=await db.select().from(s.heartbeatRuns),agents=await db.select().from(s.agents);
  if(runs.some(run=>!['succeeded','failed','cancelled','timed_out'].includes(run.status))||agents.length!==Object.keys(plan.agentIds).length||
   Object.values(plan.agentIds).some(id=>!agents.some(agent=>agent.id===id&&agent.companyId===plan.companyId)))fail('MULTI_RUNTIME_FINALIZATION_EXECUTION_OPEN');
  const cwd='/paperclip/instances/default/projects/'+plan.companyId+'/'+plan.projectId+'/_default';
  for(const step of plan.steps){
   const run=runs.find(value=>value.id===step.runId),directory=ROOT+'/transport/'+step.runId,transport=privateJson(directory+'/result.json'),proof=privateJson(directory+'/native-proof.json');
   if(!run||run.companyId!==plan.companyId||run.issueId!==step.taskId||run.agentId!==step.agentId||run.status!=='succeeded'||!run.finishedAt||run.exitCode!==0||
    transport.runId!==run.id||transport.exitCode!==0||transport.signal!==null||transport.timedOut!==false||transport.cancelled!==false||transport.outputUnknown!==false||
    proof.runId!==run.id||proof.executor!=='macos_native'||proof.platform!=='darwin')fail('MULTI_RUNTIME_FINALIZATION_RUN_DENIED');
   for(const stream of ['stdout','stderr'])if(sha(fs.readFileSync(directory+'/'+stream))!==transport[stream+'Sha256'])fail('MULTI_RUNTIME_FINALIZATION_OUTPUT_CHANGED');
   for(const name of ['process-cleanup.json','broker-process-cleanup.json'])if(privateJson(directory+'/'+name).status!=='terminated')fail('MULTI_RUNTIME_FINALIZATION_EXECUTION_OPEN');
   for(const ref of step.artifacts??[]){const file=path.join(cwd,ref.file),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||ref.taskId!==step.taskId||ref.runId!==step.runId||sha(fs.readFileSync(file))!==ref.sha256)fail('MULTI_RUNTIME_FINALIZATION_ARTIFACT_CHANGED');}
   if(step.handoff)verifyAcceptanceHandoff({cwd,receipt:step.handoff});
  }
  const qa=plan.steps[4],references=plan.steps.slice(0,4).flatMap(step=>step.artifacts),verdict=readAcceptanceArtifactJson({cwd,reference:qa.artifacts.find(ref=>ref.file==='qa.json')});
  if(verdict.verdict!=='PASS'||!Array.isArray(verdict.findings)||verdict.findings.length||!Array.isArray(verdict.notRun)||!isDeepStrictEqual(verdict.reviewedArtifacts,references))fail('MULTI_RUNTIME_FINALIZATION_QA_DENIED');
  if(sha(fs.readFileSync(cwd+'/csv.test.mjs'))!==sha(CSV_TESTS)||qa.fixedTests?.exitCode!==0||qa.fixedTests?.count!==5)fail('MULTI_RUNTIME_FINALIZATION_TESTS_DENIED');
  const budget=fs.readdirSync(ROOT+'/budget/'+plan.rootTaskId).sort();
  if(budget.length!==6||plan.steps.some(step=>!budget.includes(step.operationId+'.json')))fail('MULTI_RUNTIME_FINALIZATION_BUDGET_CHANGED');
  const original=archivePrivateSnapshot(ROOT+'/finalization-history','report',fs.readFileSync(reportFile));
  const validation=spawnSync(process.execPath,['--test','--test-reporter=tap','csv.test.mjs'],{cwd,encoding:'utf8',timeout:10000,maxBuffer:1048576});
  if(validation.status!==0||!/# pass 5\b/.test(validation.stdout??''))fail('MULTI_RUNTIME_FINALIZATION_TESTS_DENIED');
  const finalization={schemaVersion:1,reason:'ordinary_artifact_reader_corrected',previousReportSha256:original.sha256,modelCallsAdded:0,sourceRoleCount:Object.keys(plan.agentIds).length,
   budgetUsedBefore:budget.length,budgetUsedAfter:budget.length,fixedTests:{exitCode:validation.status,count:5,stdoutSha256:sha(validation.stdout??''),stderrSha256:sha(validation.stderr??'')},at:new Date().toISOString()};
  archivePrivateSnapshot(ROOT+'/finalization-history','tests',Buffer.from(validation.stdout??''));
  qa.status='PASS';qa.verdict='PASS';plan.status='PASS';plan.callsSpent=budget.length;plan.postExecutionFinalization=finalization;delete plan.errorCode;
  writePrivate(reportFile,plan);return{status:'PASS',sourceRoleCount:finalization.sourceRoleCount,modelCallsAdded:0,budgetSpent:budget.length,successfulNativeRuns:5,independentQa:'PASS'};
 }finally{await s.closeRegisteredClients(url);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await finalizeExecutedAcceptance()));}catch(error){console.error(JSON.stringify({status:'FAILED',errorCode:/^[A-Z_]+$/.test(error.code??'')?error.code:'MULTI_RUNTIME_FINALIZATION_UNKNOWN'}));process.exitCode=1;}
}
