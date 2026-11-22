import test from'node:test';import assert from'node:assert/strict';import{createResidentRuntimeObservation,createResidentRuntimeCatalog}from'../bridge/task-runtime-host-observation.mjs';import{RUNTIME_PROFILES}from'../bridge/role-runtime-profiles.mjs';
import{openCodeMetadata}from'../docker/role-opencode-gate.mjs';import{claudeMetadata}from'../docker/role-claude-gate.mjs';
test('the resident refreshes the existing API gate catalog with installed versions and canonical models',()=>{
 const commands=[],catalog=createResidentRuntimeCatalog({version:command=>{commands.push(command);return command.endsWith('/claude')?'2.1.330 (Claude Code)':'1.14.15';},now:100000});
 assert.equal(commands.length,2);assert.equal(openCodeMetadata(['--version'],catalog,{now:100001}),'1.14.15\n');assert.equal(claudeMetadata(['--version'],catalog,{now:100001}),'2.1.330 (Claude Code)\n');
 assert.equal(openCodeMetadata(['models'],catalog,{now:100001}),Object.values(RUNTIME_PROFILES).filter(profile=>['codex','opencode'].includes(profile.runtime)).map(profile=>profile.model).join('\n')+'\n');
 assert.throws(()=>openCodeMetadata(['models'],catalog,{now:1900000}),/CATALOG_DENIED/);
 const absent=createResidentRuntimeCatalog({version:()=>{throw Error('not installed');},now:100000});assert.equal(absent.opencode,undefined);assert.equal(absent.claude,undefined);assert.equal(absent.unavailable.length,2);
});
test('the existing resident snapshot binds real source and CLI ports without a model probe',()=>{
 let cliReads=0;const snapshot=createResidentRuntimeObservation({sourceRoot:'/candidate',readFile:file=>Buffer.from('actual '+file),cliIdentity:()=>{cliReads++;return{cliSha256:'a'.repeat(64)};},now:1000});
 assert.equal(snapshot.kind,'macos-runtime-implementations');assert.equal(snapshot.capturedAt,new Date(1000).toISOString());assert.equal(Object.keys(snapshot.bindings).length,Object.keys(RUNTIME_PROFILES).length);assert.equal(cliReads,Object.keys(RUNTIME_PROFILES).length);assert.deepEqual(snapshot.unavailable,[]);
 const absent=createResidentRuntimeObservation({readFile:()=>Buffer.from('source'),cliIdentity:()=>{throw Error('missing');}});assert.deepEqual(absent.bindings,{});assert.equal(absent.unavailable.length,Object.keys(RUNTIME_PROFILES).length);
});
