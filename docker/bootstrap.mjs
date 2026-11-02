import fs from'node:fs';import crypto from'node:crypto';
const roots=['/paperclip/home','/paperclip/installer-home','/paperclip/logs','/paperclip/npm-cache','/paperclip/secrets'];
for(const p of roots){fs.mkdirSync(p,{recursive:true,mode:0o700});if(fs.lstatSync(p).isSymbolicLink())throw new Error('UNSAFE_DATA_PATH');fs.chmodSync(p,0o700);}
let created=0;
for(const name of['better-auth','postgres-password']){const file='/paperclip/secrets/'+name;if(fs.existsSync(file)){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0)throw new Error('UNSAFE_SECRET_FILE');continue;}fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});created++;}
const receipt={at:new Date().toISOString(),stage:'bootstrap',createdSecretFiles:created,modelCalls:0};fs.appendFileSync('/paperclip/logs/bootstrap.jsonl',JSON.stringify(receipt)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
