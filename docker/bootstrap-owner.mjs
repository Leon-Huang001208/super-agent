import fs from'node:fs';import path from'node:path';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
export function extractInvite(output){const clean=output.replace(/\u001b\[[0-9;]*m/g,'');const url=clean.match(/http:\/\/127\.0\.0\.1:8097\/invite\/pcp_bootstrap_[a-f0-9]{48}/)?.[0];return url??null;}
export async function bootstrapOwner(){
  const secretRoot='/paperclip/secrets',privateFile=secretRoot+'/bootstrap-invite.txt';
  if(fs.existsSync(privateFile)){const s=fs.lstatSync(privateFile);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0)throw new Error('UNSAFE_BOOTSTRAP_MATERIAL');return{status:'existing-private-invitation-preserved',privateFile,modelCalls:0};}
  const{paperclipConfigSchema}=await import('/opt/paperclip/node_modules/@paperclipai/shared/dist/index.js');
  const configPath='/paperclip/instances/default/config.json';
  const input={$meta:{version:1,updatedAt:new Date().toISOString(),source:'configure'},database:{mode:'postgres',connectionString:'postgres://paperclip@db:5432/paperclip'},logging:{mode:'file',logDir:'/paperclip/logs'},server:{port:3100,host:'0.0.0.0',deploymentMode:'authenticated',exposure:'private',allowedHostnames:['localhost','127.0.0.1','mac-mini-1.tail947973.ts.net']},auth:{baseUrlMode:'explicit',publicBaseUrl:'http://127.0.0.1:8097'}};
  if(fs.existsSync(configPath)){const s=fs.lstatSync(configPath);if(!s.isFile()||s.isSymbolicLink())throw new Error('UNSAFE_CONFIG_FILE');const c=paperclipConfigSchema.parse(JSON.parse(fs.readFileSync(configPath,'utf8')));if(c.server.deploymentMode!=='authenticated'||c.database.mode!=='postgres'||!c.database.connectionString.includes('@db:5432/paperclip'))throw new Error('BOOTSTRAP_INSTANCE_MISMATCH');}
  else{const config=paperclipConfigSchema.parse(input);fs.mkdirSync(path.dirname(configPath),{recursive:true,mode:0o700});fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});}
  const password=fs.readFileSync(secretRoot+'/postgres-password','utf8').trim();
  const databaseUrl=`postgres://paperclip:${password}@db:5432/paperclip`;
  const r=spawnSync('/opt/paperclip/node_modules/.bin/paperclipai',['auth','bootstrap-ceo','--config',configPath,'--base-url','http://127.0.0.1:8097','--expires-hours','24'],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:{...process.env,DATABASE_URL:databaseUrl}});
  const output=(r.stdout??'')+'\n'+(r.stderr??'');
  if(/Instance already has an admin user/.test(output))return{status:'admin-already-initialized',modelCalls:0};
  const url=extractInvite(output);
  if(r.status!==0||!url){let safe=output.split(password).join('[redacted]').split(databaseUrl).join('[redacted]').replace(/pcp_bootstrap_[A-Za-z0-9]+/g,'[redacted]');fs.appendFileSync('/paperclip/logs/owner-bootstrap-failure.log',safe+'\n',{mode:0o600});throw new Error('OWNER_BOOTSTRAP_FAILED');}
  fs.writeFileSync(privateFile,url+'\n',{flag:'wx',mode:0o600});
  const receipt={status:'bootstrap-invitation-created',privateFile,expiresHours:24,modelCalls:0};
  fs.appendFileSync('/paperclip/logs/owner-bootstrap.jsonl',JSON.stringify({at:new Date().toISOString(),...receipt})+'\n',{mode:0o600});return receipt;
}
if(process.argv[1]==='-'||(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))){try{console.log(JSON.stringify(await bootstrapOwner()));}catch(e){console.error(JSON.stringify({errorCode:/^[A-Z_]+$/.test(e.message)?e.message:'OWNER_BOOTSTRAP_FAILED',modelCalls:0}));process.exitCode=1;}}
