import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {rwbReleaseTimeoutPolicy} from './rwb-release.mjs';
import {RUNTIME_PROFILES} from './role-runtime-profiles.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const ROOT='/paperclip/control/research-pm';
function exclusive(file,bytes) {
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function privateProviderBytes(file){
 let cursor=path.parse(file).root;for(const part of file.slice(cursor.length).split(path.sep)){
  cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink()||(cursor!==file&&!stat.isDirectory()))fail('ROLE_TRANSPORT_PROVIDER_FILE_DENIED');
 }
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.size>262144)fail('ROLE_TRANSPORT_PROVIDER_FILE_DENIED');return fs.readFileSync(fd);}
 finally{fs.closeSync(fd);}
}
/** Only control-side private files hold real credentials. The management root is never taken from the model request. */
export function prepareIsolatedRoleProvider({permit,home},{root=ROOT}={}){
 const dir=root+'/transport/'+permit.runId,profile=permit.runtimeProfileId===undefined?RUNTIME_PROFILES.codex_subscription:
  Object.hasOwn(RUNTIME_PROFILES,permit.runtimeProfileId)?RUNTIME_PROFILES[permit.runtimeProfileId]:null;
 if(!profile)fail('ROLE_TRANSPORT_PROVIDER_DENIED');
 const sources=[],copies=[];
 const copyAuth=()=>{const file=home+'/auth.json',bytes=fs.readFileSync(file);exclusive(dir+'/provider/auth.json',bytes);sources.push({file,bytes});copies.push(dir+'/provider/auth.json');};
 if(profile.runtime==='codex')copyAuth();
 else{
  const source=root+'/runtime-secrets/'+permit.runId+'.json',bytes=privateProviderBytes(source);let value;
  try{value=JSON.parse(bytes);}catch{fail('ROLE_TRANSPORT_PROVIDER_DENIED');}
  if(value.runId!==permit.runId||value.runtimeProfileId!==profile.id||typeof value.apiKey!=='string'||!value.apiKey.trim()||value.apiKey.length>65536)fail('ROLE_TRANSPORT_PROVIDER_DENIED');
  const destination=dir+'/provider/api-auth.json';exclusive(destination,Buffer.from(JSON.stringify({runId:permit.runId,runtimeProfileId:profile.id,apiKey:value.apiKey})+'\n'));
  sources.push({file:source,bytes,privateFile:true});copies.push(destination);
  if(home){
   if(!new RegExp('^/tmp/paperclip-ai-'+permit.companyId+'-'+permit.credentialGrantId+'-[A-Za-z0-9]+/provider$').test(home))fail('ROLE_TRANSPORT_PROVIDER_DENIED');
   copyAuth();
  }
 }
 return{requestFields:profile.runtime!=='codex'?{runtimeProfileId:profile.id}:{},
  verify(){for(const source of sources)if(!(source.privateFile?privateProviderBytes(source.file):fs.readFileSync(source.file)).equals(source.bytes))fail('ROLE_TRANSPORT_AUTH_CHANGED');},
  cleanup(){for(const copy of copies)fs.unlinkSync(copy);}};
}
/** Native remains the owner. This transports its already-authorized stdio to a task container. */
export async function executeIsolatedRole({permit,args,input,home}) {
 const dir=ROOT+'/transport/'+permit.runId;
 fs.mkdirSync(dir,{mode:0o700});
 fs.mkdirSync(dir+'/provider',{mode:0o700});
 const provider=prepareIsolatedRoleProvider({permit,home});
 exclusive(dir+'/stdin',Buffer.from(input));
 exclusive(dir+'/request.json',Buffer.from(JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,role:permit.role,cwd:permit.cwd,
   home,args,...provider.requestFields,...(permit.executionPolicy?{executionPolicy:permit.executionPolicy}:{}),inputSha256:hash(input),expiresAt:permit.expiresAt,createdAt:new Date().toISOString()})+'\n'));
 let interrupted=false,outputFailed=false;
 const stop=()=>{interrupted=true;if(!fs.existsSync(dir+'/cancel.json'))exclusive(dir+'/cancel.json',Buffer.from(JSON.stringify({runId:permit.runId})+'\n'));};
 const outputError=()=>{outputFailed=true;stop();};
 process.stdout.on('error',outputError);process.stderr.on('error',outputError);
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 let out=0,err=0;
 const stream=(filename,offset,destination)=>{
  if(!fs.existsSync(filename))return offset;
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const size=fs.fstatSync(fd).size;if(size>16*1024*1024||size<offset)fail('ROLE_TRANSPORT_OUTPUT_LIMIT');
   if(size>offset){const bytes=Buffer.alloc(size-offset);fs.readSync(fd,bytes,0,bytes.length,offset);destination.write(bytes);}return size;
  }finally{fs.closeSync(fd);}
 };
 try{
  const deadline=Date.now()+(rwbReleaseTimeoutPolicy(permit)?.transportMs??660000);
  while(Date.now()<deadline){
   if(outputFailed)fail('ROLE_TRANSPORT_OUTPUT_UNKNOWN');
   out=stream(dir+'/stdout',out,process.stdout);err=stream(dir+'/stderr',err,process.stderr);
   if(fs.existsSync(dir+'/result.json')){
    const r=JSON.parse(fs.readFileSync(dir+'/result.json','utf8'));
    if(r.runId!==permit.runId||!Number.isInteger(r.exitCode)||r.exitCode<0||r.exitCode>255||r.signal!==null)fail('ROLE_TRANSPORT_RESULT_DENIED');
    out=stream(dir+'/stdout',out,process.stdout);err=stream(dir+'/stderr',err,process.stderr);
    if(hash(fs.readFileSync(dir+'/stdout'))!==r.stdoutSha256||hash(fs.readFileSync(dir+'/stderr'))!==r.stderrSha256)fail('ROLE_TRANSPORT_OUTPUT_CHANGED');
    // Tool processes never receive the real provider authorization; Native's
    // selected credential remains immutable in the external provider broker.
    provider.verify();provider.cleanup();fs.unlinkSync(dir+'/stdin');
    return {exitCode:r.exitCode,signal:r.signal,timedOut:r.timedOut===true,spawnFailed:false,interrupted:interrupted||r.cancelled===true};
   }
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  stop();fail('ROLE_TRANSPORT_RESULT_UNKNOWN');
 }catch(error){stop();throw error;}finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);process.stdout.off('error',outputError);process.stderr.off('error',outputError);}
}
