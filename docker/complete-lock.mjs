import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{fileURLToPath}from'node:url';
const metadata={version:'2.3.3',resolved:'https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz',integrity:'sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==',hasInstallScript:true,license:'MIT',optional:true,os:['darwin'],engines:{node:'^8.16.0 || ^10.6.0 || >=11.0.0'}};
export function completeLock(lock){
  if(lock.lockfileVersion!==3||!lock.packages)throw new Error('LOCK_SCHEMA_UNSUPPORTED');
  const parents=Object.values(lock.packages).map(p=>p.optionalDependencies?.fsevents).filter(Boolean);
  if(!parents.length)return false;
  if(parents.some(r=>r!=='~2.3.3'&&r!=='2.3.3'))throw new Error('OPTIONAL_DEPENDENCY_RANGE_CHANGED');
  const existing=lock.packages['node_modules/fsevents'];
  if(existing){if(existing.version!==metadata.version||existing.resolved!==metadata.resolved||existing.integrity!==metadata.integrity||existing.hasInstallScript!==true||existing.optional!==true||existing.os?.length!==1||existing.os[0]!=='darwin')throw new Error('OPTIONAL_DEPENDENCY_METADATA_CHANGED');return false;}
  lock.packages['node_modules/fsevents']=structuredClone(metadata);return true;
}
export function repairFile(file='/opt/paperclip/package-lock.json',logs='/paperclip/logs'){
  const original=fs.readFileSync(file,'utf8'),lock=JSON.parse(original),changed=completeLock(lock);
  if(changed){const id=crypto.randomUUID();fs.writeFileSync(path.join(logs,`dependency-lock-before-optional-${id}.json`),original,{flag:'wx',mode:0o600});const temp=file+'.'+id+'.tmp';fs.writeFileSync(temp,JSON.stringify(lock,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
  const receipt={stage:'optional-lock-closure',changed,package:'fsevents',version:'2.3.3',platform:'darwin-only-not-installed-on-linux',sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),modelCalls:0};fs.appendFileSync(path.join(logs,'lock-closure.jsonl'),JSON.stringify(receipt)+'\n',{mode:0o600});return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(repairFile()));}catch(e){console.error(JSON.stringify({errorCode:/^[A-Z_]+$/.test(e.message)?e.message:'LOCK_CLOSURE_FAILED',modelCalls:0}));process.exitCode=1;}}
