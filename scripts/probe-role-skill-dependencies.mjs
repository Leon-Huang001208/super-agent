/** Read-only Mac prerequisite inspection. It never installs, authenticates or calls a model. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function probeRoleSkillDependencies({pythonPath,run=spawnSync,exists=fs.existsSync,platform=process.platform}={}){
 const check=(command,args)=>{const result=run(command,args,{encoding:'utf8',timeout:5000,maxBuffer:4096});return result.status===0&&!result.error;};
 const python=pythonPath??['/opt/homebrew/bin/python3.12','/opt/homebrew/bin/python3','/usr/bin/python3'].find(exists);
 const modules=['playwright','PIL','openpyxl','pandas','reportlab','pypdf','pdfplumber','lxml','psutil'];
 const pythonModules=Object.fromEntries(modules.map(name=>[name,python?check(python,['-c',`import importlib.util,sys;sys.exit(0 if importlib.util.find_spec(${JSON.stringify(name)}) else 1)`]):false]));
 const office=['/Applications/LibreOffice.app/Contents/MacOS/soffice','/opt/homebrew/bin/soffice','/usr/bin/libreoffice'].find(exists);
 const cli={node:check(process.execPath,['--version']),python:Boolean(python),gh:check('gh',['--version']),git:check('/usr/bin/git',['--version']),libreoffice:Boolean(office)&&check(office,['--version'])};
 const requirementMap={'webapp-testing':['module:playwright'],'canvas-design':['module:PIL'],'storage-analyzer':['module:psutil'],xlsx:['module:openpyxl','module:pandas','cli:libreoffice'],pdf:['module:pypdf','module:pdfplumber'],docx:['module:lxml'],'gh-fix-ci':['cli:gh','cli:python'],'gh-address-comments':['cli:gh','cli:python'],'jupyter-notebook':['cli:python']};
 const skills=Object.fromEntries(Object.entries(requirementMap).map(([name,requirements])=>{
  const missing=requirements.filter(item=>{const[kind,key]=item.split(':');return !(kind==='module'?pythonModules[key]:cli[key]);});
  return[name,{load:'ready',execution:missing.length?'missing-prerequisites':'prerequisites-present',missing,authorizationAndConnections:'NOT_RUN'}];
 }));
 return{schemaVersion:1,capturedAt:new Date().toISOString(),platform,pythonPath:python??null,prerequisites:{cli,pythonModules},skills,changesMade:false,modelCalls:0};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const index=process.argv.indexOf('--python');
 console.log(JSON.stringify(probeRoleSkillDependencies({pythonPath:index<0?undefined:process.argv[index+1]})));
}
