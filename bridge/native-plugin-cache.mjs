/** Only Codex plugin package code is shared; its configuration and data stay run-private. */
import fs from 'node:fs';
import path from 'node:path';
import {verifyHostVolume} from './role-host-capabilities.mjs';

const CACHE_ROOT='/Volumes/WorkDisk/Caches/SuperAgent/codex-native/plugins-cache';
const fail=code=>{throw Object.assign(Error(code),{code});};
const stat=file=>{try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value!=='/'&&!/[\x00-\x1f\x7f]/.test(value);
function directoryChain(directory){
 for(let current=directory;;current=path.dirname(current)){
  const entry=stat(current);if(entry&&(!entry.isDirectory()||entry.isSymbolicLink()))fail('ROLE_NATIVE_PLUGIN_CACHE_PATH_DENIED');
  if(current===path.dirname(current))return;
 }
}
function ownedDirectory(directory,{privateMode=true}={}){
 const entry=stat(directory);if(!entry?.isDirectory()||entry.isSymbolicLink()||entry.uid!==process.getuid()||(entry.mode&(privateMode?0o077:0o022)))fail('ROLE_NATIVE_PLUGIN_CACHE_DIRECTORY_DENIED');
}
function homeState(codexHome,cacheRoot){
 directoryChain(codexHome);ownedDirectory(codexHome);
 const plugins=path.join(codexHome,'plugins');directoryChain(plugins);if(stat(plugins))ownedDirectory(plugins);
 const linkPath=path.join(plugins,'cache'),entry=stat(linkPath);
 if(entry&&(!entry.isSymbolicLink()||entry.uid!==process.getuid()||entry.nlink!==1||fs.readlinkSync(linkPath)!==cacheRoot))fail('ROLE_NATIVE_PLUGIN_CACHE_TARGET_EXISTS');
 return{plugins,linkPath,linked:Boolean(entry)};
}
function createCache(cacheRoot){
 directoryChain(cacheRoot);const missing=[];let existing=cacheRoot;
 while(!stat(existing)){missing.unshift(existing);existing=path.dirname(existing);}
 ownedDirectory(existing,{privateMode:existing===cacheRoot});
 if(existing===cacheRoot)ownedDirectory(path.dirname(cacheRoot),{privateMode:false});
 for(const directory of missing){fs.mkdirSync(directory,{mode:0o700});ownedDirectory(directory);}
}

/** cacheRoot/verifyVolume are trusted management test ports, never task/env/permit fields. */
export async function prepareNativePluginCache({codexHome,cacheRoot=CACHE_ROOT,verifyVolume=verifyHostVolume}={}){
 if(!absolute(codexHome)||!absolute(cacheRoot)||!/^[A-Za-z0-9_./ -]+$/.test(cacheRoot)||cacheRoot.split(path.sep).includes('native-run-cache-retirement')||
  codexHome===cacheRoot||codexHome.startsWith(cacheRoot+'/')||cacheRoot.startsWith(codexHome+'/'))fail('ROLE_NATIVE_PLUGIN_CACHE_PATH_DENIED');
 homeState(codexHome,cacheRoot);directoryChain(cacheRoot);
 if(await verifyVolume(cacheRoot)!==true)fail('ROLE_NATIVE_PLUGIN_CACHE_VOLUME_IDENTITY_MISMATCH');
 // Recheck after the asynchronous observation before creating either cache or link.
 const state=homeState(codexHome,cacheRoot);createCache(cacheRoot);
 if(!stat(state.plugins))fs.mkdirSync(state.plugins,{mode:0o700});ownedDirectory(state.plugins);
 if(!state.linked)fs.symlinkSync(cacheRoot,state.linkPath,'dir');
 const proof={status:'configured',cacheRoot,linkPath:state.linkPath,volumeVerified:true,cliCompatibility:'NOT_RUN'};
 const verify=()=>{
  directoryChain(cacheRoot);ownedDirectory(cacheRoot);const current=homeState(codexHome,cacheRoot);
  if(!current.linked||fs.realpathSync(current.linkPath)!==cacheRoot)fail('ROLE_NATIVE_PLUGIN_CACHE_LINK_CHANGED');
  return proof;
 };
 verify();return{proof,verify};
}
