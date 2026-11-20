/** Reuse the active owner's Native session; authentication material never leaves this process. */
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';

export async function createRoleOwnerApi({registry,packageRoot='/opt/paperclip/node_modules',controlRoot='/paperclip/control/research-pm',requirePaused=false}={}){
 if(process.platform!=='linux'||process.getuid()!==0)throw Error('ROLE_OWNER_API_CONTAINER_REQUIRED');
 if(requirePaused&&(registry?.team?.enabled!==false||fs.existsSync(controlRoot+'/call.lock')))throw Error('ROLE_OWNER_API_NATIVE_BUSY');
 const password=fs.readFileSync('/paperclip/secrets/postgres-password','utf8').trim();
 const url='postgres://paperclip:'+encodeURIComponent(password)+'@db:5432/paperclip';
 const schema=await import(packageRoot+'/@paperclipai/db/dist/index.js'),orm=await import(packageRoot+'/drizzle-orm/index.js'),db=schema.createDb(url,{maxConnections:2});
 try{
  if(requirePaused){const active=await db.select({id:schema.heartbeatRuns.id}).from(schema.heartbeatRuns).where(orm.inArray(schema.heartbeatRuns.status,['running','queued','scheduled_retry']));if(active.length)throw Error('ROLE_OWNER_API_NATIVE_BUSY');}
  const[session]=await db.select({token:schema.authSessions.token}).from(schema.authSessions).where(orm.and(orm.eq(schema.authSessions.userId,registry.ownerId),orm.gt(schema.authSessions.expiresAt,new Date()))).orderBy(orm.desc(schema.authSessions.updatedAt)).limit(1);
  if(!session)throw Error('ROLE_OWNER_API_SESSION_REQUIRED');
  const{serializeSignedCookie}=await import(packageRoot+'/better-call/dist/index.mjs');
  const{deriveAuthCookiePrefix}=await import(packageRoot+'/@paperclipai/server/dist/auth/better-auth.js');
  const prefix=deriveAuthCookiePrefix()+'.session_token',secret=fs.readFileSync('/paperclip/secrets/better-auth','utf8').trim();
  const cookie=(await Promise.all([prefix,'__Secure-'+prefix].map(name=>serializeSignedCookie(name,session.token,secret,{path:'/'})))).map(value=>value.split(';')[0]).join('; ');
  const origin=process.env.PAPERCLIP_PUBLIC_URL??'http://127.0.0.1:8097';
  const headers={cookie,origin,host:new URL(origin).host,'x-forwarded-proto':new URL(origin).protocol.slice(0,-1)};
  const request=async(route,options={})=>{
   const response=await fetch('http://127.0.0.1:3100/api'+route,{...options,headers:{...headers,...options.headers}});
   if(response.status===404&&!options.method)return null;
   const body=await response.json();if(!response.ok)throw Object.assign(Error('ROLE_OWNER_API_HTTP_'+response.status),{code:'ROLE_OWNER_API_HTTP_'+response.status,status:response.status,detail:typeof body?.error==='string'?body.error.slice(0,200):undefined});return body;
  };
  if((await request('/auth/get-session'))?.user?.id!==registry.ownerId)throw Error('ROLE_OWNER_API_SESSION_REJECTED');
  const recordSkillReview=async(skillId,reviewedSource)=>{
   const[skill]=await db.select().from(schema.companySkills).where(orm.and(orm.eq(schema.companySkills.id,skillId),orm.eq(schema.companySkills.companyId,registry.companyId)));
   if(!skill)throw Error('ROLE_OWNER_API_SKILL_CHANGED');
   if(isDeepStrictEqual(skill.metadata?.reviewedSource,reviewedSource))return;
   // The installed public PATCH schema has no metadata field. Scope this administrative
   // provenance extension to the authenticated owner's company and exact imported row.
   const {logActivity}=await import(packageRoot+'/@paperclipai/server/dist/services/activity-log.js');
   await db.transaction(async tx=>{
    await tx.update(schema.companySkills).set({metadata:{...skill.metadata,reviewedSource},updatedAt:new Date()}).where(orm.and(orm.eq(schema.companySkills.id,skillId),orm.eq(schema.companySkills.companyId,registry.companyId)));
    await logActivity(tx,{companyId:registry.companyId,actorType:'user',actorId:registry.ownerId,action:'company.skill_review_recorded',entityType:'company_skill',entityId:skillId,details:{sourceRepo:reviewedSource.sourceRepo,sourceRef:reviewedSource.sourceRef,bundleSha256:reviewedSource.bundleSha256,verdict:reviewedSource.review?.verdict,importMethod:'reviewed_local_snapshot'}});
   });
  };
  return{request,recordSkillReview,close:()=>schema.closeRegisteredClients(url)};
 }catch(error){await schema.closeRegisteredClients(url);throw error;}
}
