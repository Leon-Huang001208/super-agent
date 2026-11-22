import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareIsolatedRoleProvider} from '../bridge/role-isolated-transport.mjs';

function fixture(t,profile='deepseek_opencode'){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sa-provider-transport-'))),runId=randomUUID(),dir=root+'/transport/'+runId;
 t.after(()=>fs.rmSync(root,{recursive:true}));fs.mkdirSync(dir+'/provider',{recursive:true,mode:0o700});fs.mkdirSync(root+'/runtime-secrets',{mode:0o700});
 const permit={runId,runtimeProfileId:profile},secret={runId,runtimeProfileId:profile,apiKey:'synthetic-private-api-key'};
 fs.writeFileSync(root+'/runtime-secrets/'+runId+'.json',JSON.stringify(secret),{mode:0o600});return{root,dir,permit,secret};
}
test('API transport privately copies only the matching resolved Native secret, and removes only its work copy',t=>{
 for(const profile of ['deepseek_opencode','minimax_opencode']){
  const f=fixture(t,profile),provider=prepareIsolatedRoleProvider({permit:f.permit},{root:f.root});
  assert.deepEqual(JSON.parse(fs.readFileSync(f.dir+'/provider/api-auth.json')),f.secret);
  assert.equal(fs.statSync(f.dir+'/provider/api-auth.json').mode&0o777,0o600);
  assert.deepEqual(provider.requestFields,{runtimeProfileId:profile});assert.ok(!JSON.stringify(provider).includes('synthetic-private-api-key'));
  provider.verify();provider.cleanup();assert.equal(fs.existsSync(f.dir+'/provider/api-auth.json'),false);
  assert.equal(fs.existsSync(f.root+'/runtime-secrets/'+f.permit.runId+'.json'),true);
 }
});
test('secret changes, mismatched identities, unsafe files and unknown runtime profiles fail closed',t=>{
 const f=fixture(t),file=f.root+'/runtime-secrets/'+f.permit.runId+'.json';
 for(const secret of [{...f.secret,runId:randomUUID()},{...f.secret,runtimeProfileId:'minimax_opencode'},{...f.secret,apiKey:''}]){
  fs.writeFileSync(file,JSON.stringify(secret));assert.throws(()=>prepareIsolatedRoleProvider({permit:f.permit},{root:f.root}),/ROLE_TRANSPORT_PROVIDER_DENIED/);
 }
 fs.writeFileSync(file,JSON.stringify(f.secret));fs.chmodSync(file,0o644);
 assert.throws(()=>prepareIsolatedRoleProvider({permit:f.permit},{root:f.root}),/ROLE_TRANSPORT_PROVIDER_FILE_DENIED/);fs.chmodSync(file,0o600);
 assert.throws(()=>prepareIsolatedRoleProvider({permit:{...f.permit,runtimeProfileId:'unknown'}},{root:f.root}),/ROLE_TRANSPORT_PROVIDER_DENIED/);
 const provider=prepareIsolatedRoleProvider({permit:f.permit},{root:f.root});fs.writeFileSync(file,JSON.stringify({...f.secret,apiKey:'rotated'}));
 assert.throws(()=>provider.verify(),/ROLE_TRANSPORT_AUTH_CHANGED/);
});
test('Codex keeps its original auth bytes and immutability check',t=>{
 const f=fixture(t,'codex_subscription'),home=f.root+'/codex-home',auth=Buffer.from('{"tokens":{"refresh_token":"synthetic"}}\n');
 fs.mkdirSync(home);fs.writeFileSync(home+'/auth.json',auth,{mode:0o600});
 const provider=prepareIsolatedRoleProvider({permit:f.permit,home},{root:f.root});
 assert.deepEqual(fs.readFileSync(f.dir+'/provider/auth.json'),auth);assert.deepEqual(provider.requestFields,{});provider.verify();
 fs.writeFileSync(home+'/auth.json','changed');assert.throws(()=>provider.verify(),/ROLE_TRANSPORT_AUTH_CHANGED/);
 provider.cleanup();assert.equal(fs.existsSync(f.dir+'/provider/auth.json'),false);assert.equal(fs.existsSync(home+'/auth.json'),true);
});
