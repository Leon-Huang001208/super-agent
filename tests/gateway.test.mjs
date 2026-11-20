import test from'node:test';import assert from'node:assert/strict';import http from'node:http';import{once}from'node:events';import{createGateway}from'../docker/gateway.mjs';
test('gateway reaches only its fixed backend and rejects absolute proxy targets',async t=>{let calls=0;const backend=http.createServer((req,res)=>{calls++;res.end('ok:'+req.url);});backend.listen(0,'127.0.0.1');await once(backend,'listening');const gateway=createGateway('127.0.0.1',backend.address().port);gateway.listen(0,'127.0.0.1');await once(gateway,'listening');t.after(()=>{gateway.closeAllConnections();gateway.close();backend.closeAllConnections();backend.close();});const port=gateway.address().port;assert.equal(await(await fetch('http://127.0.0.1:'+port+'/api/health')).text(),'ok:/api/health');const status=await new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path:'http://external.invalid/',method:'GET'},r=>{resolve(r.statusCode);r.resume();});r.on('error',reject);r.end();});assert.equal(status,400);assert.equal(calls,1);});

import net from 'node:net';
async function fixture(t, options) {
  let calls=0;const upgrades=[];
  const backend=http.createServer((req,res)=>{calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.headers));});
  backend.on('upgrade',(req,socket)=>{upgrades.push(req.headers);socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');});
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const gateway=createGateway('127.0.0.1',backend.address().port,options);gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
  t.after(()=>{gateway.closeAllConnections();gateway.close();backend.closeAllConnections();backend.close();});
  const request=(headers={},path='/',method='GET')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:gateway.address().port,path,method,headers},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));});req.setTimeout(2000,()=>req.destroy(Error('TEST_TIMEOUT')));req.on('error',reject);req.end();});
  const raw=message=>new Promise((resolve,reject)=>{const socket=net.connect(gateway.address().port,'127.0.0.1');let data='';socket.setTimeout(2000,()=>socket.destroy(Error('TEST_TIMEOUT')));socket.on('connect',()=>socket.write(message));socket.on('data',b=>{data+=b;if(data.includes('\r\n\r\n')){resolve(data);socket.destroy();}});socket.on('error',reject);socket.on('end',()=>resolve(data));});
  return{request,raw,upgrades,calls:()=>calls};
}
const tailHost='mac-mini-1.tail947973.ts.net:8443';
const injected={forwarded:'host=evil.invalid;proto=http','x-forwarded-host':'evil.invalid','x-forwarded-proto':'ftp','x-forwarded-for':'1.2.3.4','x-forwarded-port':'9','x-real-ip':'1.2.3.4','proxy-authorization':'secret'};
test('tailnet8443 derives HTTPS from exact Host and drops forged proxy metadata',async t=>{
  const f=await fixture(t);const r=await f.request({host:tailHost,...injected,authorization:'Bearer retained',cookie:'retained=yes'});
  assert.equal(r.status,200);const h=JSON.parse(r.body);assert.equal(h.host,tailHost);assert.equal(h['x-forwarded-host'],tailHost);assert.equal(h['x-forwarded-proto'],'https');
  for(const k of ['forwarded','x-forwarded-for','x-forwarded-port','x-real-ip','proxy-authorization'])assert.equal(h[k],undefined);
  assert.equal(h.authorization,'Bearer retained');assert.equal(h.cookie,'retained=yes');
});
test('loopback stays HTTP regardless of client Forwarded protocol',async t=>{
  const f=await fixture(t);for(const host of ['127.0.0.1:8097','localhost:8097','[::1]:8097']){const r=await f.request({host,'x-forwarded-proto':'https'});assert.equal(r.status,200);assert.equal(JSON.parse(r.body)['x-forwarded-proto'],'http');}
});
test('unknown, spoofed, ambiguous or non8443 tailnet Hosts never reach the backend',async t=>{
  const f=await fixture(t);for(const host of ['evil.invalid',tailHost+'.evil.invalid','mac-mini-1.tail947973.ts.net','mac-mini-1.tail947973.ts.net:443','127.0.0.1.evil:8097','localhost:0','localhost:65536','localhost:08097','user@localhost:8097'])assert.equal((await f.request({host})).status,421,host);
  assert.match(await f.raw('GET / HTTP/1.1\r\nHost: localhost:8097\r\nHost: '+tailHost+'\r\nConnection: close\r\n\r\n'),/^HTTP\/1.1 421/);
  assert.equal(f.calls(),0);
});
test('WebSocket upgrades use the same Host policy and sanitized forwarding headers',async t=>{
  const f=await fixture(t);const extra=Object.entries(injected).map(([k,v])=>k+': '+v+'\r\n').join('');
  assert.match(await f.raw('GET /api/events/ws HTTP/1.1\r\nHost: '+tailHost+'\r\nConnection: Upgrade, x-forwarded-proto\r\nUpgrade: websocket\r\n'+extra+'\r\n'),/^HTTP\/1.1 101/);
  assert.equal(f.upgrades.length,1);const h=f.upgrades[0];assert.equal(h['x-forwarded-proto'],'https');assert.equal(h['x-forwarded-host'],tailHost);assert.equal(h.forwarded,undefined);assert.equal(h['proxy-authorization'],undefined);assert.equal(h['x-forwarded-for'],undefined);assert.equal(h.connection.toLowerCase(),'upgrade');
  assert.match(await f.raw('GET /api/events/ws HTTP/1.1\r\nHost: evil.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'),/^HTTP\/1.1 421/);assert.equal(f.upgrades.length,1);
});
test('nonce probe logs only three incoming header fields exactly once and never proxies',async t=>{
  const logs=[],nonce='a'.repeat(32),path='/__sa_header_probe_'+nonce,f=await fixture(t,{headerProbeNonce:nonce,logProbe:record=>logs.push(record)});
  assert.equal((await f.request({host:tailHost},path,'POST')).status,405);assert.equal(logs.length,0);
  assert.equal((await f.request({host:tailHost,...injected,cookie:'do-not-log',authorization:'do-not-log'},path)).status,204);
  assert.deepEqual(logs,[{host:tailHost,'x-forwarded-host':'evil.invalid','x-forwarded-proto':'ftp'}]);
  assert.equal((await f.request({host:tailHost},path)).status,410);assert.equal(logs.length,1);assert.equal(f.calls(),0);
});
test('probe is disabled by default and invalid operator nonce fails before listen',async t=>{
  const f=await fixture(t);assert.equal((await f.request({host:tailHost},'/__sa_header_probe_'+'a'.repeat(32))).status,200);assert.equal(f.calls(),1);
  assert.throws(()=>createGateway('127.0.0.1',3100,{headerProbeNonce:'unsafe?'}),/GATEWAY_PROBE_NONCE_INVALID/);
});
test('probe URL never reaches the backend through a WebSocket upgrade',async t=>{
  const logs=[],nonce='b'.repeat(32),f=await fixture(t,{headerProbeNonce:nonce,logProbe:r=>logs.push(r)}),path='/__sa_header_probe_'+nonce;
  assert.match(await f.raw('GET '+path+' HTTP/1.1\r\nHost: '+tailHost+'\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'),/^HTTP\/1.1 400/);
  assert.equal(f.upgrades.length,0);assert.equal(logs.length,0);assert.equal((await f.request({host:tailHost},path)).status,204);
});
test('ordinary HTTP with an Upgrade header cannot be promoted into a backend upgrade',async t=>{
  const f=await fixture(t);const r=await f.request({host:tailHost,connection:'close',upgrade:'websocket'});
  assert.equal(r.status,200);assert.equal(JSON.parse(r.body).upgrade,undefined);assert.equal(f.upgrades.length,0);assert.equal(f.calls(),1);
});
