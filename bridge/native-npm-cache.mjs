/** Supported npm cache configuration; Native HOME and credentials remain run-private. */
import fs from 'node:fs';
import path from 'node:path';
import {verifyHostVolume} from './role-host-capabilities.mjs';

const CACHE_ROOT='/Volumes/WorkDisk/Caches/SuperAgent/npm';
const fail=code=>{throw Object.assign(new Error(code),{code});};
function stat(filename){try{return fs.lstatSync(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function absolute(value){return typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value!=='/'&&!/[\x00-\x1f\x7f]/.test(value);}
function directoryChain(filename){
 for(let current=filename;;current=path.dirname(current)){
  const entry=stat(current);if(entry&&(!entry.isDirectory()||entry.isSymbolicLink()))fail('ROLE_NATIVE_NPM_PATH_DENIED');
  if(current===path.dirname(current))return;
 }
}
function ownedDirectory(filename,{privateMode=false}={}){
 const entry=stat(filename);
 if(!entry?.isDirectory()||entry.isSymbolicLink()||entry.uid!==process.getuid()||(entry.mode&(privateMode?0o077:0o022)))fail('ROLE_NATIVE_NPM_DIRECTORY_DENIED');
}
function userConfigAvailable(home){
 directoryChain(home);ownedDirectory(home,{privateMode:true});
 if(stat(path.join(home,'.npmrc')))fail('ROLE_NATIVE_NPM_USER_CONFIG_EXISTS');
}
function createCache(cacheRoot){
 directoryChain(cacheRoot);
 const missing=[];let existing=cacheRoot;
 while(!stat(existing)){missing.unshift(existing);existing=path.dirname(existing);}
 ownedDirectory(existing);
 if(existing===cacheRoot)ownedDirectory(path.dirname(cacheRoot));
 for(const filename of missing){fs.mkdirSync(filename,{mode:0o700});ownedDirectory(filename);}
}

/** cacheRoot/verifyVolume are trusted management test ports, never Native permit fields. */
export async function prepareNativeNpmCache({home,cacheRoot=CACHE_ROOT,verifyVolume=verifyHostVolume}={}){
 if(!absolute(home)||!absolute(cacheRoot)||!/^[A-Za-z0-9_./ -]+$/.test(cacheRoot)||home===cacheRoot||home.startsWith(cacheRoot+'/')||cacheRoot.startsWith(home+'/'))fail('ROLE_NATIVE_NPM_PATH_DENIED');
 userConfigAvailable(home);directoryChain(cacheRoot);
 if(await verifyVolume(cacheRoot)!==true)fail('ROLE_NATIVE_NPM_VOLUME_IDENTITY_MISMATCH');
 // Recheck after the asynchronous volume observation, before either destination is written.
 userConfigAvailable(home);createCache(cacheRoot);
 const userConfigPath=path.join(home,'.npmrc');let fd;
 try{fd=fs.openSync(userConfigPath,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);}
 catch(error){if(error.code==='EEXIST')fail('ROLE_NATIVE_NPM_USER_CONFIG_EXISTS');throw error;}
 try{fs.writeFileSync(fd,'cache='+cacheRoot+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 return {environment:{NPM_CONFIG_CACHE:cacheRoot},proof:{status:'configured',cacheRoot,userConfigPath,volumeVerified:true}};
}
