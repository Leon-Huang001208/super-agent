import test from 'node:test';
import assert from 'node:assert/strict';
import {hostProxyEnvironment} from '../bridge/host-proxy-environment.mjs';

const bypass='127.0.0.1,localhost,mac-mini-1.tail947973.ts.net';
test('explicit host proxy variables keep precedence without carrying HOME or credentials',()=>{
 const env={HTTP_PROXY:'http://host-proxy:8080',HTTPS_PROXY:'http://host-proxy:8081',ALL_PROXY:'socks5://host-proxy:1080',NO_PROXY:'localhost,example.internal',HOME:'/private/task-home',CODEX_CONNECTORS_TOKEN:'fixture-secret',GH_TOKEN:'fixture-secret'};
 const actual=hostProxyEnvironment({env,platform:'darwin',probe:()=>assert.fail('explicit HTTPS proxy must not run scutil')});
 assert.deepEqual(actual,{HTTP_PROXY:env.HTTP_PROXY,HTTPS_PROXY:env.HTTPS_PROXY,ALL_PROXY:env.ALL_PROXY,NO_PROXY:bypass+',example.internal',NODE_USE_ENV_PROXY:'1'});
 assert.ok(!JSON.stringify(actual).includes('fixture-secret'));assert.ok(!Object.hasOwn(actual,'HOME'));
});
test('macOS fallback reads only fixed scutil proxy settings and accepts the existing loopback HTTPS proxy',()=>{
 const calls=[];
 const actual=hostProxyEnvironment({env:{HTTP_PROXY:'http://previous:1'},platform:'darwin',probe:(...args)=>{calls.push(args);return{status:0,stdout:'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 29758\n'};}});
 assert.deepEqual(calls,[['/usr/sbin/scutil',['--proxy'],{encoding:'utf8',timeout:3000}]]);
 assert.deepEqual(actual,{HTTP_PROXY:'http://127.0.0.1:29758',HTTPS_PROXY:'http://127.0.0.1:29758',NO_PROXY:bypass,NODE_USE_ENV_PROXY:'1'});
});
test('disabled or non-loopback system proxy does not become a new transport setting',()=>{
 for(const stdout of ['HTTPSEnable : 0\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 29758','HTTPSEnable : 1\nHTTPSProxy : example.invalid\nHTTPSPort : 29758','HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1']){
  assert.deepEqual(hostProxyEnvironment({env:{},platform:'darwin',probe:()=>({stdout})}),{NO_PROXY:bypass,NODE_USE_ENV_PROXY:'1'});
 }
});
test('non-macOS behavior keeps provided proxy values and never probes another platform',()=>{
 const actual=hostProxyEnvironment({env:{ALL_PROXY:'socks5://provided:1080'},platform:'linux',probe:()=>assert.fail('no scutil outside macOS')});
 assert.deepEqual(actual,{ALL_PROXY:'socks5://provided:1080',NO_PROXY:bypass,NODE_USE_ENV_PROXY:'1'});
});
