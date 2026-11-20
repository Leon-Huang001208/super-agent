/** Per-run trust only: no system trust store or reusable private CA is changed. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {rootCertificates} from 'node:tls';

const fail=code=>{throw Object.assign(Error(code),{code});};
export function createNativeRoleTls({proxyRoot,clientRoot,opensslPath='/usr/bin/openssl'}={}){
 for(const directory of [proxyRoot,clientRoot]){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory)fail('ROLE_NATIVE_TLS_DIRECTORY_DENIED');
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))fail('ROLE_NATIVE_TLS_DIRECTORY_DENIED');
 }
 const paths={caFile:proxyRoot+'/ca.crt',caKeyFile:proxyRoot+'/ca.key',keyFile:proxyRoot+'/tls.key',certFile:proxyRoot+'/tls.crt',trustFile:clientRoot+'/trust.pem'};
 const write=(filename,text='')=>{
  try{fs.writeFileSync(filename,text,{mode:0o600,flag:'wx'});}catch(error){if(error.code==='EEXIST')fail('ROLE_NATIVE_TLS_PATH_ALREADY_EXISTS');throw error;}
 };
 const command=(step,args)=>{
  const result=spawnSync(opensslPath,args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
  if(result.error||result.signal||result.status!==0)fail('ROLE_NATIVE_TLS_'+step+'_FAILED');
 };
 // Pre-create private outputs so OpenSSL cannot briefly create group/world-readable keys.
 for(const filename of [paths.caKeyFile,paths.caFile,paths.keyFile,paths.certFile,proxyRoot+'/tls.csr'])write(filename);
 write(proxyRoot+'/ca.cnf','[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=role_ca\n[dn]\nCN=Task-local Native Role CA\n[role_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
 write(proxyRoot+'/leaf.ext','subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
 command('CA',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',paths.caKeyFile,'-out',paths.caFile,'-config',proxyRoot+'/ca.cnf']);
 command('CSR',['req','-newkey','rsa:2048','-nodes','-keyout',paths.keyFile,'-out',proxyRoot+'/tls.csr','-subj','/CN=127.0.0.1']);
 command('CERTIFICATE',['x509','-req','-in',proxyRoot+'/tls.csr','-CA',paths.caFile,'-CAkey',paths.caKeyFile,'-set_serial','0x'+randomBytes(16).toString('hex'),'-out',paths.certFile,'-days','1','-extfile',proxyRoot+'/leaf.ext']);
 fs.unlinkSync(paths.caKeyFile);
 write(paths.trustFile,rootCertificates.join('\n')+'\n'+fs.readFileSync(paths.caFile,'utf8'));
 return paths;
}
