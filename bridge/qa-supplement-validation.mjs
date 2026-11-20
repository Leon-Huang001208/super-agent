import{sameReviewedArtifacts}from'./team-plan.mjs';
const fail=()=>{throw Error('SUPPLEMENT_REPORT_BINDING_FAILED');};
export function validateQaSupplement(report,{rootTaskId,qaTaskId,runId,originalQaSha256,manifestSha256,manifest,audit,reviewedArtifacts,retainedNotRun}){
 if(!['PASS','NEEDS_WORK'].includes(report?.verdict)||report.verdictScope!=='F04/F08 evidence supplement only'||report.rootTaskId!==rootTaskId||report.qaTaskId!==qaTaskId||report.runId!==runId||report.originalQaSha256!==originalQaSha256||report.evidenceManifestSha256!==manifestSha256||!Array.isArray(report.findings)||!Array.isArray(report.notRun)||!sameReviewedArtifacts(report.reviewedArtifacts,reviewedArtifacts))fail();
 const expected=manifest.files.filter(x=>x.path.startsWith('materials/'));if(!Array.isArray(report.materials)||report.materials.length!==expected.length||new Set(report.materials.map(x=>x.path)).size!==expected.length)fail();
 for(const f of expected){const actual=report.materials.find(x=>x.path===f.path);if(!actual||actual.bytes!==f.bytes||actual.sha256!==f.sha256)fail();}
 const tuples=items=>items.map(x=>[x.runId,x.taskId,x.agentId,x.sessionId,x.originalCliThreadMatches]).sort((a,b)=>a[0].localeCompare(b[0]));if(!Array.isArray(report.history)||JSON.stringify(tuples(report.history))!==JSON.stringify(tuples(audit.history)))fail();
 if(report.budget?.historicalMaximum!==6||report.budget.historicalUsed!==6||report.budget.authorizedMaximum!==7||report.budget.thisSupplementSlot!==7||report.execution?.maximumConcurrentNativeRunIntervals!==1)fail();
 if(!Array.isArray(report.provider)||report.provider.length!==audit.provider.length||new Set(report.provider.map(x=>x.runId)).size!==audit.provider.length)fail();
 for(const p of audit.provider){const actual=report.provider.find(x=>x.runId===p.runId);if(!actual||actual.sourceAuditSha256!==p.sourceAuditSha256||actual.responsesCompleted200!==p.responsesCompleted200||actual.maxResponseRequestCounter!==p.maxResponseRequestCounter||actual.unknownProviderResults!==p.events.filter(x=>x.code==='ROLE_PROXY_UPSTREAM_UNKNOWN').length)fail();}
 if(retainedNotRun.some(x=>!report.notRun.some(n=>n.item===x.item)))fail();
 return report;
}
