/** Update existing Managed role documents through Native HTTP authorization and CAS. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {TEAM_ROLES,roleInstructions} from '../bridge/team-roles.mjs';
import {renderRoleCapabilitiesMarkdown} from '../bridge/role-capabilities.mjs';
import {editRoleRegistry} from '../bridge/role-control-store.mjs';

/** Scope metadata is granted only after the complete initial bundle matches public sources. */
export function verifiedGenericRoleManifest({manifest,role}){
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const entry=role+'/AGENTS.md',caps=role+'/CAPABILITIES.md';
 const allowed=new Map([[entry,sha(roleInstructions(role))],[caps,sha(renderRoleCapabilitiesMarkdown(role))]]);
 if(role==='pm')for(const asset of JSON.parse(fs.readFileSync(new URL('../assets/product-manager-coach.manifest.json',import.meta.url))).files)allowed.set(asset.path,asset.sha256);
 if(manifest?.instructionsFilePath!==entry||!Array.isArray(manifest.files)||!manifest.files.some(file=>file.path===caps)||
  manifest.files.some(file=>allowed.get(file.path)!==file.sha256))throw Object.assign(Error('ROLE_PROFILE_GENERIC_SOURCE_CHANGED'),{code:'ROLE_PROFILE_GENERIC_SOURCE_CHANGED'});
 return{...structuredClone(manifest),scope:'generic'};
}

export async function publishRoleProfiles({roles,readFile,writeFile,markGeneric,log}){
 let changedFiles=0;
 for(const entry of roles){
  const role=entry.profile.role,agentId=entry.profile.agentId;
  if(!TEAM_ROLES[role]||entry.manifest.instructionsFilePath!==role+'/AGENTS.md')throw Object.assign(Error('ROLE_PROFILE_ENTRY_CHANGED'),{code:'ROLE_PROFILE_ENTRY_CHANGED'});
  for(const [file,content,isEntry]of [[role+'/CAPABILITIES.md',renderRoleCapabilitiesMarkdown(role),false],[role+'/AGENTS.md',roleInstructions(role),true]]){
   const current=await readFile(agentId,file);
   if(current?.content===content)continue;
   log({code:'ROLE_PROFILE_SAVE_STARTED',role,file});
   await writeFile({agentId,path:file,content,...(isEntry?{baseRevisionId:current?.revision?.id??null}:{baseHash:current?.contentHash??null})});
   changedFiles++;log({code:'ROLE_PROFILE_SAVED',role,file});
  }
  if(markGeneric)await markGeneric({agentId,role});
 }
 return {status:'complete',roles:roles.length,changedFiles};
}

async function main(){
 if(process.platform!=='linux'||process.getuid()!==0||process.argv[2]!=='--apply')throw Object.assign(Error('ROLE_PROFILE_EXPLICIT_APPLY_REQUIRED'),{code:'ROLE_PROFILE_EXPLICIT_APPLY_REQUIRED'});
 const R='/paperclip/control/research-pm',P='/opt/paperclip/node_modules',r=JSON.parse(fs.readFileSync(R+'/registry.json'));
 if(r.team?.enabled!==false)throw Object.assign(Error('ROLE_PROFILE_DISPATCH_MUST_BE_PAUSED'),{code:'ROLE_PROFILE_DISPATCH_MUST_BE_PAUSED'});
 const url='postgres://paperclip:'+encodeURIComponent(fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim())+'@db:5432/paperclip';
 const s=await import(P+'/@paperclipai/db/dist/index.js'),o=await import(P+'/drizzle-orm/index.js'),db=s.createDb(url,{maxConnections:2});
 try{
  const active=await db.select({id:s.heartbeatRuns.id}).from(s.heartbeatRuns).where(o.inArray(s.heartbeatRuns.status,['running','queued','scheduled_retry']));
  if(active.length||fs.existsSync(R+'/call.lock'))throw Object.assign(Error('ROLE_PROFILE_NATIVE_BUSY'),{code:'ROLE_PROFILE_NATIVE_BUSY'});
  const[session]=await db.select({token:s.authSessions.token}).from(s.authSessions).where(o.and(o.eq(s.authSessions.userId,r.ownerId),o.gt(s.authSessions.expiresAt,new Date()))).orderBy(o.desc(s.authSessions.updatedAt)).limit(1);
  if(!session)throw Object.assign(Error('ROLE_PROFILE_OWNER_SESSION_REQUIRED'),{code:'ROLE_PROFILE_OWNER_SESSION_REQUIRED'});
  const {serializeSignedCookie}=await import(P+'/better-call/dist/index.mjs');
  const {deriveAuthCookiePrefix}=await import(P+'/@paperclipai/server/dist/auth/better-auth.js');
  const prefix=deriveAuthCookiePrefix()+'.session_token',secret=fs.readFileSync('/paperclip/secrets/better-auth','utf8').trim();
  const cookie=(await Promise.all([prefix,'__Secure-'+prefix].map(name=>serializeSignedCookie(name,session.token,secret,{path:'/'})))).map(value=>value.split(';')[0]).join('; ');
  const origin=process.env.PAPERCLIP_PUBLIC_URL??'https://mac-mini-1.tail947973.ts.net:8443';
  const headers={cookie,origin,host:new URL(origin).host,'x-forwarded-proto':new URL(origin).protocol.slice(0,-1)};
  const request=async(route,options={})=>{
   const response=await fetch('http://127.0.0.1:3100/api'+route,{...options,headers:{...headers,...options.headers}});
   if(response.status===404&&options.method!== 'PUT')return null;
   const body=await response.json();if(!response.ok)throw Object.assign(Error('ROLE_PROFILE_HTTP_'+response.status),{code:'ROLE_PROFILE_HTTP_'+response.status});return body;
  };
  if((await request('/auth/get-session'))?.user?.id!==r.ownerId)throw Object.assign(Error('ROLE_PROFILE_OWNER_SESSION_REJECTED'),{code:'ROLE_PROFILE_OWNER_SESSION_REJECTED'});
  const log=event=>fs.appendFileSync(R+'/events.jsonl',JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
  const result=await publishRoleProfiles({roles:r.agents,log,
   readFile:(agentId,file)=>request('/agents/'+agentId+'/instructions-bundle/file?path='+encodeURIComponent(file)),
   writeFile:({agentId,...body})=>request('/agents/'+agentId+'/instructions-bundle/file',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),
   markGeneric:({agentId,role})=>{editRoleRegistry(current=>{const entry=current.agents.find(item=>item.profile.agentId===agentId&&item.profile.role===role);
    if(!entry)throw Object.assign(Error('ROLE_PROFILE_GENERIC_SOURCE_CHANGED'),{code:'ROLE_PROFILE_GENERIC_SOURCE_CHANGED'});
    entry.manifest=verifiedGenericRoleManifest({manifest:entry.manifest,role});return current;});log({code:'ROLE_PROFILE_GENERIC_REGISTERED',agentId,role});},
  });
  console.log(JSON.stringify(result));
 }finally{await s.closeRegisteredClients(url);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({code:/^ROLE_[A-Z0-9_]+$/.test(error.code??'')?error.code:'ROLE_PROFILE_PUBLICATION_FAILED'}));process.exitCode=1;});
