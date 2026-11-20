import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {patchRoleAiBindingSource,installRoleAiBindingHook,ROLE_AI_BINDING_SOURCE_SHA256} from '../docker/role-ai-binding-hook.mjs';
const comparison='JSON.stringify(nextAiBinding) !== JSON.stringify(existing.runtimeConfig.aiConnection)';
const fixture=`export async function update(nextAiBinding,existing,validateManagedAgentBinding){const changed = ${comparison};if(changed)await validateManagedAgentBinding(nextAiBinding);return changed;}`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const current={mode:'responsible_user',method:'subscription',provider:'openai'};
const parsed={mode:'responsible_user',provider:'openai',method:'subscription'};

test('JSONB key order must not make an unchanged subscription binding trigger a probe',async()=>{
 assert.notEqual(JSON.stringify(parsed),JSON.stringify(current));
 const source=patchRoleAiBindingSource(fixture,{expectedSha256:sha(fixture)});
 const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let probes=0;assert.equal(await module.update(parsed,{runtimeConfig:{aiConnection:current}},async()=>{probes++;}),false);assert.equal(probes,0);
 for(const change of [{provider:'anthropic'},{method:'api_key'},{connectionId:'different'},{mode:'router'}]){
  assert.equal(await module.update({...parsed,...change},{runtimeConfig:{aiConnection:current}},async()=>{probes++;}),true);
 }
 assert.equal(probes,4);
});

test('drift and duplicate comparisons fail closed, while disabled installation reads no package',()=>{
 assert.throws(()=>patchRoleAiBindingSource(fixture),{code:'ROLE_AI_BINDING_BASE_DRIFT'});
 const duplicate=fixture+'\n// '+comparison;assert.throws(()=>patchRoleAiBindingSource(duplicate,{expectedSha256:sha(duplicate)}),{code:'ROLE_AI_BINDING_BASE_DRIFT'});
 const hook=installRoleAiBindingHook({directory:'/missing',enabled:false});assert.equal(hook.enabled,false);assert.deepEqual(hook.moduleUrls,[]);hook.verify();hook.close();
});

test('actual process-local module loading applies the semantic comparison without editing source bytes',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'binding-hook-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const filename=root+'/route.mjs';fs.writeFileSync(filename,fixture);const url=pathToFileURL(filename).href;
 let loaded=false;const hook=registerHooks({load(specifier,context,nextLoad){const result=nextLoad(specifier,context);if(specifier!==url)return result;loaded=true;return {...result,source:patchRoleAiBindingSource(Buffer.from(result.source).toString(),{expectedSha256:sha(fixture)})};}});
 try{const module=await import(url);assert.equal(await module.update(parsed,{runtimeConfig:{aiConnection:current}},async()=>assert.fail('unchanged binding must not validate')),false);assert.equal(loaded,true);}finally{hook.deregister();}
 assert.equal(fs.readFileSync(filename,'utf8'),fixture);
});

test('pinned installed Native route changes only the comparison and retains real validation', {skip:!process.env.PAPERCLIP_TEST_SERVER_ROOT},()=>{
 const filename=path.join(process.env.PAPERCLIP_TEST_SERVER_ROOT,'dist/routes/agents.js'),source=fs.readFileSync(filename,'utf8');assert.equal(sha(source),ROLE_AI_BINDING_SOURCE_SHA256);
 const patched=patchRoleAiBindingSource(source),prefix='import { isDeepStrictEqual as roleAiBindingDeepEqual } from "node:util";\n';
 assert.equal(patched.replace(prefix,'').replace('!roleAiBindingDeepEqual(nextAiBinding, existing.runtimeConfig.aiConnection)',comparison),source);
 assert.match(patched,/if \(changed \|\| \(nextAiBinding.mode === "router" && requestedAdapterType !== existing.adapterType\)\)/);
 assert.match(patched,/await validateManagedAgentBinding\(req, existing.companyId/);assert.equal(fs.readFileSync(filename,'utf8'),source);
});

test('production hook refuses an already-cached or drifted route and ignores fixture hash overrides',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'binding-install-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const server=root+'/node_modules/@paperclipai/server';fs.mkdirSync(server+'/dist/routes',{recursive:true});fs.writeFileSync(server+'/package.json','{"type":"module"}');fs.writeFileSync(server+'/dist/routes/agents.js',fixture);
 const hook=installRoleAiBindingHook({directory:root,expectedSha256:sha(fixture)});
 try{assert.throws(()=>hook.verify(),{code:'ROLE_AI_BINDING_HOOK_NOT_APPLIED'});await assert.rejects(import(hook.moduleUrls[0]),{code:'ROLE_AI_BINDING_BASE_DRIFT'});assert.throws(()=>hook.verify(),{code:'ROLE_AI_BINDING_HOOK_NOT_APPLIED'});}finally{hook.close();}
 assert.equal(fs.readFileSync(server+'/dist/routes/agents.js','utf8'),fixture);
});
