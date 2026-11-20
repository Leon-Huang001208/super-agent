import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {requestHostCapability,serveHostCapabilityCalls} from '../bridge/role-host-call-queue.mjs';
test('a host capability result is bound to one Native run and reused for a repeated RPC',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-calls-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const permit={runId:'run',taskId:'task',projectId:'project',effectiveCapabilities:{hostAllowedTools:['host.project_inspect']}};
 let calls=0;const executor={execute:async()=>{calls++;return{head:'candidate'};}};
 const timer=setInterval(()=>void serveHostCapabilityCalls({root,permit,executor}),5);t.after(()=>clearInterval(timer));
 const args={root,runId:'run',taskId:'task',projectId:'project',requestId:1,tool:'host.project_inspect',args:{},timeoutMs:1000,pollMs:5};
 assert.deepEqual(await requestHostCapability(args),{head:'candidate'});
 assert.deepEqual(await requestHostCapability(args),{head:'candidate'});assert.equal(calls,1);
 await assert.rejects(requestHostCapability({...args,requestId:2,runId:'foreign'}),/HOST_CALL_BINDING_DENIED/);
});
test('host failures preserve bounded redacted diagnostics needed for the next repair',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-call-errors-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const permit={runId:'run',taskId:'task',projectId:'project',effectiveCapabilities:{hostAllowedTools:['host.project_check']}};
 const executor={execute:async()=>{throw Object.assign(Error('check failed'),{code:'ROLE_HOST_COMMAND_FAILED',details:{exitCode:7,output:'FAIL unit.mjs:8\nAuthorization: Bearer example-secret-value'}});}};
 const timer=setInterval(()=>void serveHostCapabilityCalls({root,permit,executor}),5);t.after(()=>clearInterval(timer));
 await assert.rejects(requestHostCapability({root,runId:'run',taskId:'task',projectId:'project',requestId:1,tool:'host.project_check',args:{},timeoutMs:1000,pollMs:5}),error=>{
  assert.equal(error.code,'ROLE_HOST_COMMAND_FAILED');assert.equal(error.details.exitCode,7);assert.match(error.details.output,/unit.mjs:8/);assert.equal(error.details.output.includes('example-secret-value'),false);return true;
 });
});
test('registered RWB operations reuse the original host result across different RPC IDs',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-release-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const permit={runId:'run',taskId:'task',projectId:'project',effectiveCapabilities:{hostAllowedTools:['host.rwb_release']}};
 let calls=0;const executor={execute:async()=>{calls++;return{status:'consumed'};}};
 const timer=setInterval(()=>void serveHostCapabilityCalls({root,permit,executor}),5);t.after(()=>clearInterval(timer));
 const request={root,runId:'run',taskId:'task',projectId:'project',requestId:1,tool:'host.rwb_release',args:{operationId:'managed-operation'},timeoutMs:1000,pollMs:5};
 assert.deepEqual(await requestHostCapability(request),{status:'consumed'});
 assert.deepEqual(await requestHostCapability({...request,requestId:22}),{status:'consumed'});assert.equal(calls,1);
 await assert.rejects(requestHostCapability({...request,runId:'new-run',requestId:23}),/HOST_CALL_BINDING_DENIED/);assert.equal(calls,1);
 await assert.rejects(requestHostCapability({...request,args:{operationId:'x'.repeat(129)}}),/HOST_CALL_RWB_REQUEST_DENIED/);
 await assert.rejects(requestHostCapability({...request,args:{operationId:'managed-operation',action:'deploy'}}),/HOST_CALL_RWB_REQUEST_DENIED/);
});
test('a started RWB operation without a result remains unknown for subsequent RPC IDs',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-release-unknown-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const request={root,runId:'run',taskId:'task',projectId:'project',requestId:1,tool:'host.rwb_release',args:{operationId:'original-operation'},timeoutMs:15,pollMs:5};
 await assert.rejects(requestHostCapability(request),/HOST_CALL_RESULT_UNKNOWN/);
 const directories=fs.readdirSync(root);assert.equal(directories.length,1);const directory=path.join(root,directories[0]);
 fs.writeFileSync(path.join(directory,'started.json'),'{}');
 let calls=0;const permit={runId:'run',taskId:'task',projectId:'project',effectiveCapabilities:{hostAllowedTools:['host.rwb_release']}};
 await serveHostCapabilityCalls({root,permit,executor:{execute:async()=>{calls++;}}});
 await assert.rejects(requestHostCapability({...request,requestId:99}),/HOST_CALL_RESULT_UNKNOWN/);assert.equal(calls,0);assert.deepEqual(fs.readdirSync(root),directories);
});
