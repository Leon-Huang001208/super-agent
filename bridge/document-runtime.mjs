import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Discover existing tools only. A file-format Skill never authorizes installation. */
export function documentRuntimeEnvironment({role,environment=process.env,home=os.homedir(),exists=fs.existsSync}={}){
 if(role!=='document-specialist')return {};
 const roots=[];
 const add=value=>{if(typeof value==='string'&&path.isAbsolute(value)&&!value.includes('\0'))roots.push(path.resolve(value));};
 add(environment.PAPERCLIP_DOCUMENT_RUNTIME_ROOT);
 for(const entry of (environment.PATH??'').split(path.delimiter)){
  if(entry.endsWith(path.join('bin','override')))add(path.resolve(entry,'../..'));
 }
 add(path.join(home,'.cache','codex-runtimes','codex-primary-runtime','dependencies'));
 for(const root of [...new Set(roots)]){
  const python=path.join(root,'python','bin','python3');
  if(!exists(python))continue;
  const office=path.join(root,'native','libreoffice-headless','libreoffice','LibreOfficeDev.app','Contents','MacOS','soffice');
  const hasOffice=exists(office);
  return {
   PAPERCLIP_DOCUMENT_RUNTIME_ROOT:root,
   PAPERCLIP_DOCUMENT_PYTHON:python,
   ...(hasOffice?{PAPERCLIP_DOCUMENT_SOFFICE:office}:{}),
   PAPERCLIP_DOCUMENT_RUNTIME_STATUS:hasOffice?'python-and-office-present':'python-present-office-missing',
   PATH:[path.dirname(python),...(hasOffice?[path.dirname(office)]:[]),path.join(root,'bin','override'),environment.PATH].filter(Boolean).join(path.delimiter),
  };
 }
 return {PAPERCLIP_DOCUMENT_RUNTIME_STATUS:'missing'};
}

/** LibreOffice's bundled font config omits macOS CJK fonts. Keep the correction local to this run. */
export function prepareDocumentRuntimeEnvironment({runDirectory,...options}={}){
 const environment=documentRuntimeEnvironment(options);
 if(!environment.PAPERCLIP_DOCUMENT_PYTHON)return environment;
 if(typeof runDirectory!=='string'||!path.isAbsolute(runDirectory))throw Error('DOCUMENT_RUNTIME_DIRECTORY_INVALID');
 const directory=path.join(runDirectory,'document-fonts'),cache=path.join(directory,'cache'),filename=path.join(directory,'fonts.conf');
 const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const text='<?xml version="1.0" encoding="UTF-8"?>\n<fontconfig>\n'+
  ['/System/Library/Fonts','/System/Library/Fonts/Supplemental','/Library/Fonts'].map(value=>'  <dir>'+value+'</dir>\n').join('')+
  '  <cachedir>'+escape(cache)+'</cachedir>\n</fontconfig>\n';
 fs.mkdirSync(cache,{recursive:true,mode:0o700});
 if(fs.existsSync(filename)){
  if(fs.lstatSync(filename).isSymbolicLink()||fs.readFileSync(filename,'utf8')!==text)throw Error('DOCUMENT_RUNTIME_FONT_CONFIG_CHANGED');
 }else fs.writeFileSync(filename,text,{flag:'wx',mode:0o400});
 return {...environment,FONTCONFIG_FILE:filename};
}
