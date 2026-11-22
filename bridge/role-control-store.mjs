import fs from'node:fs';import path from'node:path';import{randomUUID}from'node:crypto';
import{ROLE_PERMIT_MAX_BYTES}from'./role-permit-contract.mjs';
export const ROLE_ROOT='/paperclip/control/research-pm';
function readPrivate(file,maximumBytes,ownerUid){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==ownerUid||(s.mode&0o077)||s.size>maximumBytes)throw Error('TEAM_CONTROL_FILE_DENIED');return fs.readFileSync(file);}
export function readControl(file){return JSON.parse(readPrivate(file,4*1024*1024,0));}
export function readRolePermitBytes(file,{ownerUid=0}={}){return readPrivate(file,ROLE_PERMIT_MAX_BYTES,ownerUid);}
export function readRolePermit(file,options){return JSON.parse(readRolePermitBytes(file,options));}
export function writeControl(file,value){const tmp=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
export function editRoleRegistry(edit){const lock=ROLE_ROOT+'/registry.control.lock',fd=fs.openSync(lock,'wx',0o600);try{const r=readControl(ROLE_ROOT+'/registry.json'),next=edit(r)??r;writeControl(ROLE_ROOT+'/registry.json',next);return next;}finally{fs.closeSync(fd);fs.unlinkSync(lock);}}
