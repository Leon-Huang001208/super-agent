import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{fileURLToPath}from'node:url';
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
export function verifyInstall(directory='/opt/paperclip',source='/opt/super-agent'){
  const expected=fs.readFileSync(path.join(source,'package.install.json'));
  const actual=fs.readFileSync(path.join(directory,'package.json'));
  if(digest(actual)!==digest(expected))throw new Error('DEPENDENCY_SPEC_CHANGED');
  const canonical=fs.readFileSync(path.join(source,'package-lock.install.json'));
  const lock=fs.readFileSync(path.join(directory,'package-lock.json'));
  const marker=JSON.parse(fs.readFileSync(path.join(directory,'.super-agent-installed'),'utf8'));
  const lockSha=digest(lock);if(marker.lockSha256!==lockSha||digest(canonical)!==lockSha)throw new Error('DEPENDENCY_LOCK_CHANGED');
  const wanted=JSON.parse(expected);const versions={};
  for(const[name,version]of Object.entries(wanted.dependencies)){const installed=JSON.parse(fs.readFileSync(path.join(directory,'node_modules',name,'package.json'),'utf8'));if(installed.version!==version)throw new Error('DEPENDENCY_VERSION_CHANGED');versions[name]=version;}
  return{stage:'dependency-integrity-verified',lockSha256:lockSha,versions,modelCalls:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(verifyInstall()));}catch(e){console.error(JSON.stringify({errorCode:/^[A-Z_]+$/.test(e.message)?e.message:'INSTALL_VERIFY_FAILED',modelCalls:0}));process.exitCode=1;}}
