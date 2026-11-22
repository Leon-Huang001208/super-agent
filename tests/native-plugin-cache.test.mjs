import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareNativePluginCache} from '../bridge/native-plugin-cache.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-plugin-cache-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const codexHome=root+'/client';fs.mkdirSync(codexHome,{mode:0o700});
 return{root,codexHome,cacheRoot:root+'/caches/native-only/plugins-cache',verifyVolume:async()=>true};
}

test('a failed volume check creates neither plugin directories nor cache/link and keeps private files unchanged',async t=>{
 const f=fixture(t);for(const name of ['auth.json','config.toml','state_5.sqlite'])fs.writeFileSync(f.codexHome+'/'+name,'private '+name,{mode:0o600});
 let observed;await assert.rejects(prepareNativePluginCache({...f,verifyVolume:async target=>{observed=target;return false;}}),/ROLE_NATIVE_PLUGIN_CACHE_VOLUME_IDENTITY_MISMATCH/);
 assert.equal(observed,f.cacheRoot);assert.equal(fs.existsSync(f.root+'/caches'),false);assert.equal(fs.existsSync(f.codexHome+'/plugins'),false);
 for(const name of ['auth.json','config.toml','state_5.sqlite'])assert.equal(fs.readFileSync(f.codexHome+'/'+name,'utf8'),'private '+name);
});

test('a fake CLI writes only plugin code through the shared cache link while auth/config/data/session/SQLite remain private',async t=>{
 const f=fixture(t),second=f.root+'/second-client';fs.mkdirSync(second,{mode:0o700});
 const one=await prepareNativePluginCache(f),two=await prepareNativePluginCache({...f,codexHome:second});
 for(const home of [f.codexHome,second]){
  fs.writeFileSync(home+'/auth.json','private credentials',{mode:0o600});fs.writeFileSync(home+'/config.toml','private = true',{mode:0o600});
  const code='const fs=require("node:fs"),h=process.env.CODEX_HOME;fs.mkdirSync(h+"/plugins/cache/example/1",{recursive:true});fs.writeFileSync(h+"/plugins/cache/example/1/code.js","package code");fs.mkdirSync(h+"/plugins/data",{recursive:true,mode:448});fs.writeFileSync(h+"/plugins/data/private.json","run data");fs.mkdirSync(h+"/sessions",{mode:448});fs.writeFileSync(h+"/sessions/run.jsonl","run history");fs.writeFileSync(h+"/state_5.sqlite","run database");console.log(JSON.stringify({cache:fs.realpathSync(h+"/plugins/cache"),data:fs.realpathSync(h+"/plugins/data"),state:fs.realpathSync(h+"/state_5.sqlite"),session:fs.realpathSync(h+"/sessions/run.jsonl")}));';
  const result=spawnSync(process.execPath,['-e',code],{env:{PATH:process.env.PATH,CODEX_HOME:home},encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{cache:f.cacheRoot,data:home+'/plugins/data',state:home+'/state_5.sqlite',session:home+'/sessions/run.jsonl'});
  assert.equal(fs.lstatSync(home+'/plugins').isSymbolicLink(),false);assert.equal(fs.lstatSync(home+'/plugins/cache').isSymbolicLink(),true);
  assert.equal(fs.readFileSync(home+'/auth.json','utf8'),'private credentials');assert.equal(fs.readFileSync(home+'/config.toml','utf8'),'private = true');
 }
 assert.equal(one.verify().cacheRoot,two.verify().cacheRoot);assert.equal(fs.statSync(f.cacheRoot).mode&0o777,0o700);
 assert.deepEqual(fs.readdirSync(f.cacheRoot),['example']);assert.equal(one.proof.cliCompatibility,'NOT_RUN');
 const inode=fs.lstatSync(f.codexHome+'/plugins/cache').ino;await prepareNativePluginCache(f);assert.equal(fs.lstatSync(f.codexHome+'/plugins/cache').ino,inode);
});

test('cache/home overlap, noncanonical paths and sealed cache retirement destinations cannot become runtime links',async t=>{
 for(const kind of ['overlap','parent','relative','dotdot','control','sealed']){
  const f=fixture(t),cacheRoot={overlap:f.codexHome+'/cache',parent:f.root,relative:'relative',dotdot:f.root+'/caches/../escape',control:f.root+'/cache\npath',sealed:f.root+'/native-run-cache-retirement/canonical'}[kind];
  await assert.rejects(prepareNativePluginCache({...f,cacheRoot}),/ROLE_NATIVE_PLUGIN_CACHE_PATH_DENIED/);assert.equal(fs.existsSync(f.codexHome+'/plugins'),false);
 }
});

test('directory ancestors and existing cache roots cannot be replaced by escaping links or old private caches',async t=>{
 for(const kind of ['home-link','cache-ancestor','plugin-ancestor','wrong-cache-link','old-cache-directory']){
  const f=fixture(t),outside=f.root+'/outside';fs.mkdirSync(outside,{mode:0o700});let options=f;
  if(kind==='home-link'){fs.symlinkSync(f.codexHome,f.root+'/home-link');options={...f,codexHome:f.root+'/home-link'};}
  if(kind==='cache-ancestor'){fs.symlinkSync(outside,f.root+'/linked');options={...f,cacheRoot:f.root+'/linked/cache'};}
  if(kind==='plugin-ancestor')fs.symlinkSync(outside,f.codexHome+'/plugins');
  if(kind==='wrong-cache-link'||kind==='old-cache-directory'){
   fs.mkdirSync(f.codexHome+'/plugins',{mode:0o700});
   if(kind==='wrong-cache-link')fs.symlinkSync(outside,f.codexHome+'/plugins/cache');
   else{fs.mkdirSync(f.codexHome+'/plugins/cache',{mode:0o700});fs.writeFileSync(f.codexHome+'/plugins/cache/keep','keep');}
  }
  await assert.rejects(prepareNativePluginCache(options),/ROLE_NATIVE_PLUGIN_CACHE_(?:PATH_DENIED|TARGET_EXISTS)/);
  assert.equal(fs.existsSync(f.root+'/caches'),false);assert.deepEqual(fs.readdirSync(outside),[]);
  if(kind==='old-cache-directory')assert.equal(fs.readFileSync(f.codexHome+'/plugins/cache/keep','utf8'),'keep');
 }
});

test('ownership/private modes and a path swap during the volume observation are rejected before writes',async t=>{
 const f=fixture(t);fs.chmodSync(f.codexHome,0o755);await assert.rejects(prepareNativePluginCache(f),/ROLE_NATIVE_PLUGIN_CACHE_DIRECTORY_DENIED/);fs.chmodSync(f.codexHome,0o700);
 const outside=f.root+'/outside';fs.mkdirSync(outside,{mode:0o700});
 await assert.rejects(prepareNativePluginCache({...f,verifyVolume:async()=>{fs.symlinkSync(outside,f.codexHome+'/plugins');return true;}}),/ROLE_NATIVE_PLUGIN_CACHE_PATH_DENIED/);
 assert.equal(fs.existsSync(f.root+'/caches'),false);assert.deepEqual(fs.readdirSync(outside),[]);
 const g=fixture(t);fs.mkdirSync(g.cacheRoot,{recursive:true,mode:0o700});fs.chmodSync(g.cacheRoot,0o777);await assert.rejects(prepareNativePluginCache(g),/ROLE_NATIVE_PLUGIN_CACHE_DIRECTORY_DENIED/);
 if(process.getuid()===0){fs.chmodSync(g.cacheRoot,0o700);fs.chownSync(g.cacheRoot,12345,12345);await assert.rejects(prepareNativePluginCache(g),/ROLE_NATIVE_PLUGIN_CACHE_DIRECTORY_DENIED/);}
});

test('post-process verification refuses a removed or substituted cache link without repairing it',async t=>{
 const f=fixture(t),configured=await prepareNativePluginCache(f),link=f.codexHome+'/plugins/cache';fs.unlinkSync(link);
 assert.throws(()=>configured.verify(),/ROLE_NATIVE_PLUGIN_CACHE_LINK_CHANGED/);assert.equal(fs.existsSync(link),false);
 fs.mkdirSync(link,{mode:0o700});assert.throws(()=>configured.verify(),/ROLE_NATIVE_PLUGIN_CACHE_TARGET_EXISTS/);assert.equal(fs.lstatSync(link).isSymbolicLink(),false);
});
