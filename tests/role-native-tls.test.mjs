import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {rootCertificates} from 'node:tls';
import {spawn} from 'node:child_process';
import {createNativeRoleTls} from '../scripts/role-proxy-tls.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-role-tls-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['proxy','client'])fs.mkdirSync(root+'/'+name,{mode:0o700});
 return {root,...createNativeRoleTls({proxyRoot:root+'/proxy',clientRoot:root+'/client'})};
}
function request(url,options={}){return new Promise((resolve,reject)=>{
 const req=https.get(url,options,res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.once('error',reject);
});}

test('task-local TLS trusts its loopback certificate and rejects unrelated CA or host',async t=>{
 const tls=fixture(t),other=fixture(t);
 const server=https.createServer({key:fs.readFileSync(tls.keyFile),cert:fs.readFileSync(tls.certFile)},(_req,res)=>res.end('local only'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='https://127.0.0.1:'+server.address().port;
 assert.deepEqual(await request(url,{ca:fs.readFileSync(tls.caFile)}),{status:200,body:'local only'});
 await assert.rejects(request(url,{ca:fs.readFileSync(other.caFile)}),/certificate|self.signed|issuer/i);
 await assert.rejects(request(url,{ca:fs.readFileSync(tls.caFile),servername:'wrong.local'}),/altname|altnames|hostname|does not match/i);
 for(const file of [tls.caFile,tls.certFile,tls.keyFile,tls.trustFile])assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(fs.existsSync(tls.caKeyFile),false,'signing CA key is removed before returning');
 const trust=fs.readFileSync(tls.trustFile,'utf8');
 assert.ok(trust.includes(rootCertificates[0]),'existing public roots remain trusted in the CLI bundle');
 assert.ok(trust.endsWith(fs.readFileSync(tls.caFile,'utf8')),'the task CA is appended to public trust');
 assert.throws(()=>createNativeRoleTls({proxyRoot:tls.root+'/proxy',clientRoot:tls.root+'/client'}),/ROLE_NATIVE_TLS_/,'an existing run is not overwritten');
});

test('real Node stdio MCP client inherits only this run CA for the HTTPS broker',async t=>{
 const tls=fixture(t);const server=https.createServer({key:fs.readFileSync(tls.keyFile),cert:fs.readFileSync(tls.certFile)},async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer synthetic-local-token');let body='';for await(const chunk of req)body+=chunk;const m=JSON.parse(body);
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'host.project_inspect',inputSchema:{type:'object'}}]}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const child=spawn(process.execPath,['docker/role-host-mcp-server.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tls.caFile,CODEX_CONNECTORS_TOKEN:'synthetic-local-token',ROLE_HOST_MCP_ENDPOINT:'https://127.0.0.1:'+server.address().port+'/backend-api/role-host-mcp'},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,0);assert.equal(stderr,'');assert.deepEqual(JSON.parse(stdout).result.tools.map(tool=>tool.name),['host.project_inspect']);
});
