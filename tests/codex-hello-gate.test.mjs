import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Writable, PassThrough } from 'node:stream';
import { authorizeHello, safeHelloArgs, isSubscriptionAuth, runHelloProcess } from '../docker/codex-hello-gate.mjs';

const companyId = '85f89b59-f73a-450d-8676-4afcab409fb0';
const grantId = 'c2291b72-baf7-4b9a-bc3d-fa5ae2f356cb';
const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5.6-sol', '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false', '-c', 'project_doc_max_bytes=0', '--ephemeral', '-'];
async function fixture(t, changes = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-hello-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const permit = { id: randomUUID(), companyId, grantId, model: 'gpt-5.6-sol', expiresAt: new Date(Date.now() + 60_000).toISOString(), ...changes };
  await fs.writeFile(path.join(directory, 'hello-permit.json'), JSON.stringify(permit));
  return { directory, args, input: 'Respond with hello.', cwd: '/opt/paperclip', home: `/tmp/paperclip-ai-${companyId}-${grantId}-abcdef/provider`, apiKeysPresent: false };
}
test('one selected-account hello consumes the permit atomically and retains the requested model', async t => {
  const input = await fixture(t);
  const raced = await Promise.allSettled([authorizeHello(input), authorizeHello(input)]);
  assert.equal(raced.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(raced.filter(x => x.status === 'rejected').length, 1);
  const passed = raced.find(x => x.status === 'fulfilled').value;
  const safe = safeHelloArgs(passed);
  assert.equal(safe[safe.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.equal(safe[safe.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(safe.includes('--ignore-user-config'));
  assert.ok(!safe.includes('--dangerously-bypass-approvals-and-sandbox'));
});
for (const [name, change] of Object.entries({
  prompt: { input: 'Fix the repository' },
  accountHome: { home: '/paperclip/home/.codex' },
  anotherAccount: { home: `/tmp/paperclip-ai-${companyId}-${randomUUID()}-abcdef/provider` },
  apiFallback: { apiKeysPresent: true },
  modelChange: { args: args.map(x => x === 'gpt-5.6-sol' ? 'gpt-6.1-sol' : x) },
  resume: { args: [...args, 'resume'] },
  customConfig: { args: [...args.slice(0, -1), '-c', 'model_provider="other"', '-'] },
  nonEphemeral: { args: args.filter(x => x !== '--ephemeral') },
})) test(`hello permit rejects ${name} without consuming it`, async t => {
  const input = await fixture(t);
  await assert.rejects(authorizeHello({ ...input, ...change }));
  await authorizeHello(input);
});
test('verified Paperclip OAuth token files work without auth_mode; API key files do not', () => {
  const auth={tokens:{access_token:'synthetic-a',refresh_token:'synthetic-r',id_token:'synthetic-i'}};
  assert.equal(isSubscriptionAuth(auth),true);
  assert.equal(isSubscriptionAuth({...auth,auth_mode:'chatgpt'}),true);
  assert.equal(isSubscriptionAuth({...auth,OPENAI_API_KEY:'synthetic-key'}),false);
  assert.equal(isSubscriptionAuth({tokens:{access_token:'only-one-token'}}),false);
});
test('timeout kills the wrapper and a native-style descendant that ignores SIGTERM', {timeout:4000}, async () => {
  const output=new PassThrough();output.resume();
  const script=`const{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000);`;
  const result=await runHelloProcess({command:process.execPath,args:['-e',script],input:'',stdout:output,stderr:output,signals:new EventEmitter(),timeoutMs:200,killGraceMs:100});
  assert.equal(result.timedOut,true);assert.equal(result.signal,'SIGKILL');
});
test('a lost output reader stops the probe and records interruption', {timeout:4000}, async () => {
  const output=new Writable({write(_chunk,_encoding,callback){callback(Object.assign(new Error('synthetic pipe closed'),{code:'EPIPE'}));}});
  const result=await runHelloProcess({command:process.execPath,args:['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],input:'',stdout:output,stderr:new PassThrough(),signals:new EventEmitter(),timeoutMs:2000,killGraceMs:100});
  assert.equal(result.interrupted,true);assert.equal(result.signal,'SIGTERM');
});
test('expired permits cannot launch an inference', async t => {
  const input = await fixture(t, { expiresAt: new Date(Date.now() - 1).toISOString() });
  await assert.rejects(authorizeHello(input), /HELLO_PERMIT_EXPIRED/);
});
test('an unspecified onboarding model is pinned to the explicit operator permit, never an implicit CLI default', async t => {
  const input = await fixture(t, {model:'gpt-6.1-sol'});
  const selected = await authorizeHello({...input,args:args.filter((_,i)=>i!==3&&i!==4)});
  assert.equal(selected.model,'gpt-6.1-sol');
  assert.equal(selected.defaultModelApplied,true);
});
