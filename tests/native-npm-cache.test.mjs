import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareNativeNpmCache} from '../bridge/native-npm-cache.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'native-npm-cache-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'home');fs.mkdirSync(home,{mode:0o700});
 return {root,home,cacheRoot:path.join(root,'caches','npm'),verifyVolume:async()=>true};
}

test('invalid volume identity performs no cache or user configuration writes',async t=>{
 const f=fixture(t);let observed;
 await assert.rejects(prepareNativeNpmCache({...f,verifyVolume:async target=>{observed=target;return false;}}),/ROLE_NATIVE_NPM_VOLUME_IDENTITY_MISMATCH/);
 assert.equal(observed,f.cacheRoot);assert.equal(fs.existsSync(path.join(f.root,'caches')),false);
 assert.equal(fs.existsSync(path.join(f.home,'.npmrc')),false);
});

test('different isolated homes reuse one supported cache without copying host npm config',async t=>{
 const f=fixture(t),secondHome=path.join(f.root,'second-home');fs.mkdirSync(secondHome,{mode:0o700});
 const first=await prepareNativeNpmCache(f),second=await prepareNativeNpmCache({...f,home:secondHome});
 assert.deepEqual(first.environment,{NPM_CONFIG_CACHE:f.cacheRoot});assert.deepEqual(second.environment,first.environment);
 for(const home of [f.home,secondHome]){
  const filename=path.join(home,'.npmrc');assert.equal(fs.readFileSync(filename,'utf8'),'cache='+f.cacheRoot+'\n');
  assert.equal(fs.statSync(filename).mode&0o777,0o600);assert.equal(fs.lstatSync(filename).isSymbolicLink(),false);
 }
 assert.equal(fs.statSync(f.cacheRoot).mode&0o777,0o700);
 assert.deepEqual(first.proof,{status:'configured',cacheRoot:f.cacheRoot,userConfigPath:path.join(f.home,'.npmrc'),volumeVerified:true});
});

test('cache and home symlinks, unsafe directories, overlap and escaped paths are refused',async t=>{
 const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside,{mode:0o700});
 fs.symlinkSync(outside,path.join(f.root,'linked'));
 for(const cacheRoot of [path.join(f.root,'linked','npm'),path.join(f.root,'linked')+'/',f.root+'/caches/../outside',path.join(f.home,'cache'),f.root,f.root+'/cache\n_authToken=secret']){
  await assert.rejects(prepareNativeNpmCache({...f,cacheRoot}),/ROLE_NATIVE_NPM_PATH_DENIED/);
 }
 await assert.rejects(prepareNativeNpmCache({...f,home:path.join(f.root,'linked')}),/ROLE_NATIVE_NPM_PATH_DENIED/);
 fs.mkdirSync(f.cacheRoot,{recursive:true,mode:0o700});fs.chmodSync(f.cacheRoot,0o777);
 await assert.rejects(prepareNativeNpmCache(f),/ROLE_NATIVE_NPM_DIRECTORY_DENIED/);
 assert.equal(fs.existsSync(path.join(f.home,'.npmrc')),false);
});

test('existing npmrc is never overwritten, including a dangling symlink or hard link',async t=>{
 for(const type of ['file','symlink','hardlink']){
  const f=fixture(t),filename=path.join(f.home,'.npmrc'),protectedFile=path.join(f.root,'protected');
  fs.writeFileSync(protectedFile,'//registry.example/:_authToken=protected\n',{mode:0o600});
  if(type==='file')fs.writeFileSync(filename,'original\n',{mode:0o600});
  else if(type==='symlink')fs.symlinkSync(path.join(f.root,'missing'),filename);
  else fs.linkSync(protectedFile,filename);
  await assert.rejects(prepareNativeNpmCache(f),/ROLE_NATIVE_NPM_USER_CONFIG_EXISTS/);
  assert.equal(fs.existsSync(path.join(f.root,'caches')),false);
  assert.equal(fs.readFileSync(protectedFile,'utf8'),'//registry.example/:_authToken=protected\n');
  if(type==='file')assert.equal(fs.readFileSync(filename,'utf8'),'original\n');
 }
});

test('unowned or group writable cache creation parents are refused',async t=>{
 const f=fixture(t);fs.mkdirSync(path.dirname(f.cacheRoot),{mode:0o700});fs.chmodSync(path.dirname(f.cacheRoot),0o770);
 await assert.rejects(prepareNativeNpmCache(f),/ROLE_NATIVE_NPM_DIRECTORY_DENIED/);
 assert.equal(fs.existsSync(f.cacheRoot),false);
 if(process.getuid()===0){
  fs.chmodSync(path.dirname(f.cacheRoot),0o700);fs.chownSync(path.dirname(f.cacheRoot),12345,12345);
  await assert.rejects(prepareNativeNpmCache(f),/ROLE_NATIVE_NPM_DIRECTORY_DENIED/);
  fs.chownSync(path.dirname(f.cacheRoot),0,0);fs.mkdirSync(f.cacheRoot,{mode:0o700});fs.chownSync(f.cacheRoot,12345,12345);
  await assert.rejects(prepareNativeNpmCache(f),/ROLE_NATIVE_NPM_DIRECTORY_DENIED/);
 }
});

test('npm child with filtered environment reads the run home user config without an install',async t=>{
 const f=fixture(t);await prepareNativeNpmCache(f);
 const result=spawnSync('npm',['config','get','cache'],{cwd:f.home,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,HOME:f.home}});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),f.cacheRoot);
 assert.equal(fs.existsSync(path.join(f.home,'.npm')),false);
});
