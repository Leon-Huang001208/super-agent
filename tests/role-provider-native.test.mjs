import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('native provider broker binds loopback dynamic port and serves only the scoped authenticated directory',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-broker-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const key='a'.repeat(64),runId='fixture',jwt='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture'}})).toString('base64url')+'.eA';
 fs.mkdirSync(root+'/audit');fs.writeFileSync(root+'/config.json',JSON.stringify({key,runId,expiresAt:Date.now()+10000,hostTools:[{name:'host.network_observe'}]}));fs.writeFileSync(root+'/auth.json',JSON.stringify({tokens:{id_token:jwt,access_token:'synthetic'}}));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../docker/role-provider-proxy.mjs',import.meta.url))],{stdio:['ignore','ignore','pipe'],env:{PATH:process.env.PATH,SUPER_AGENT_ROLE_PROXY_ROOT:root,SUPER_AGENT_ROLE_PROXY_AUDIT:root+'/audit',SUPER_AGENT_ROLE_PROXY_LISTEN_HOST:'127.0.0.1',SUPER_AGENT_ROLE_PROXY_PORT:'0',SUPER_AGENT_ROLE_PROXY_READY_FILE:root+'/ready.json'}});
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('close',resolve));}});
 for(let n=0;n<100&&!fs.existsSync(root+'/ready.json');n++){if(child.exitCode!==null)throw Error('broker exited '+child.exitCode);await new Promise(resolve=>setTimeout(resolve,20));}
 const ready=JSON.parse(fs.readFileSync(root+'/ready.json'));assert.equal(ready.host,'127.0.0.1');assert.ok(ready.port>0);
 const address='http://127.0.0.1:'+ready.port;
 assert.equal((await fetch(address+'/backend-api/role-host-mcp',{method:'POST',body:'{}'})).status,403);
 const response=await fetch(address+'/backend-api/role-host-mcp',{method:'POST',headers:{authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 assert.equal(response.status,200);assert.deepEqual((await response.json()).result.tools,[{name:'host.network_observe'}]);
 assert.equal((await fetch(address+'/unexpected',{headers:{authorization:'Bearer '+key}})).status,403);
});
