/** Serialized role permits include the bounded company skill snapshot and metadata. */
export const ROLE_COMPANY_SKILL_SNAPSHOT_MAX_BYTES=8*1024*1024;
export const ROLE_PERMIT_MAX_BYTES=ROLE_COMPANY_SKILL_SNAPSHOT_MAX_BYTES+4*1024*1024;

export function assertRolePermitSize(permit){
 if(Buffer.byteLength(JSON.stringify(permit)+'\n')>ROLE_PERMIT_MAX_BYTES){
  throw Object.assign(Error('NATIVE_ROLE_PERMIT_TOO_LARGE'),{code:'NATIVE_ROLE_PERMIT_TOO_LARGE'});
 }
 return permit;
}
