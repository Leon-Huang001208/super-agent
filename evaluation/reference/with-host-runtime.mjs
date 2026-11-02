import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function digestFile(file){const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}finally{fs.closeSync(fd);}return hash.digest('hex');}
export function launch(args=process.argv.slice(2)){
 const c=JSON.parse(fs.readFileSync(path.join(root,'evaluation/candidate.json'),'utf8')),runtime=c.nodeRuntime;
 if(!runtime||digestFile(runtime.executable)!==runtime.sha256)throw new Error('PINNED_RUNTIME_CHANGED');
 if(args[0]!=='--test'&&args[0]!=='scripts/paperclip-preflight.mjs')throw new Error('RUNTIME_ENTRY_NOT_ALLOWED');
 const version=spawnSync(runtime.executable,['--version'],{encoding:'utf8',timeout:5000});if(version.status!==0||version.stdout.trim()!==runtime.version)throw new Error('PINNED_RUNTIME_VERSION_CHANGED');
 const r=spawnSync(runtime.executable,args,{cwd:root,stdio:'inherit',env:{...process.env,PATH:path.dirname(runtime.executable)+path.delimiter+(process.env.PATH??'')}});
 if(r.error)throw new Error('PINNED_RUNTIME_START_FAILED');process.exitCode=r.status??1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{launch();}catch(error){console.error(JSON.stringify({errorCode:error.message,modelCalls:0}));process.exitCode=1;}}
