import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {rwbReleaseTimeoutPolicy} from './rwb-release.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const ROOT='/paperclip/control/research-pm';
function exclusive(file,bytes) {
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
/** Native remains the owner. This transports its already-authorized stdio to a task container. */
export async function executeIsolatedRole({permit,args,input,home}) {
 const dir=ROOT+'/transport/'+permit.runId;
 fs.mkdirSync(dir,{mode:0o700});
 fs.mkdirSync(dir+'/provider',{mode:0o700});
 const initialAuth=fs.readFileSync(home+'/auth.json');
 exclusive(dir+'/provider/auth.json',initialAuth);
 exclusive(dir+'/stdin',Buffer.from(input));
 exclusive(dir+'/request.json',Buffer.from(JSON.stringify({schemaVersion:1,runId:permit.runId,taskId:permit.taskId,role:permit.role,cwd:permit.cwd,
   home,args,...(permit.executionPolicy?{executionPolicy:permit.executionPolicy}:{}),inputSha256:hash(input),expiresAt:permit.expiresAt,createdAt:new Date().toISOString()})+'\n'));
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
    if(!fs.readFileSync(home+'/auth.json').equals(initialAuth))fail('ROLE_TRANSPORT_AUTH_CHANGED');
    fs.unlinkSync(dir+'/provider/auth.json');fs.unlinkSync(dir+'/stdin');
    return {exitCode:r.exitCode,signal:r.signal,timedOut:r.timedOut===true,spawnFailed:false,interrupted:interrupted||r.cancelled===true};
   }
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  stop();fail('ROLE_TRANSPORT_RESULT_UNKNOWN');
 }catch(error){stop();throw error;}finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
