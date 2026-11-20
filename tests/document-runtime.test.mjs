import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {documentRuntimeEnvironment,prepareDocumentRuntimeEnvironment} from '../bridge/document-runtime.mjs';

test('existing roles receive no document runtime environment changes',()=>{
 assert.deepEqual(documentRuntimeEnvironment({role:'research',environment:{PATH:'/usr/bin'},home:'/Users/test'}),{});
});

test('document role reuses the installed bundle rather than the system Python',()=>{
 const root='/Users/test/.cache/codex-runtimes/codex-primary-runtime/dependencies';
 const python=path.join(root,'python/bin/python3');
 const office=path.join(root,'native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/MacOS/soffice');
 const files=new Set([python,office]);
 const env=documentRuntimeEnvironment({role:'document-specialist',environment:{PATH:'/opt/homebrew/bin:/usr/bin'},home:'/Users/test',exists:p=>files.has(p)});
 assert.equal(env.PAPERCLIP_DOCUMENT_PYTHON,python);
 assert.equal(env.PAPERCLIP_DOCUMENT_SOFFICE,office);
 assert.equal(env.PAPERCLIP_DOCUMENT_RUNTIME_STATUS,'python-and-office-present');
 assert.equal(env.PATH.split(path.delimiter)[0],path.dirname(python));
 assert.ok(env.PATH.endsWith('/opt/homebrew/bin:/usr/bin'));
 assert.ok(!Object.keys(env).some(key=>/TOKEN|SECRET|KEY|AUTH/.test(key)));
});

test('runtime discovery is bounded and missing prerequisites remain explicit',()=>{
 const checked=[];
 const env=documentRuntimeEnvironment({role:'document-specialist',environment:{PATH:'/usr/bin'},home:'/Users/test',exists:p=>{checked.push(p);return false;}});
 assert.equal(env.PAPERCLIP_DOCUMENT_RUNTIME_STATUS,'missing');
 assert.equal(env.PAPERCLIP_DOCUMENT_PYTHON,undefined);
 assert.equal(env.PATH,undefined);
 assert.ok(checked.length<20);
});

test('document font configuration uses existing system fonts and a run-private cache',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'document-fonts-'));
 try{
  const root='/Users/test/.cache/codex-runtimes/codex-primary-runtime/dependencies';
  const env=prepareDocumentRuntimeEnvironment({role:'document-specialist',runDirectory:directory,environment:{PATH:'/usr/bin'},home:'/Users/test',exists:p=>p===root+'/python/bin/python3'});
  const text=fs.readFileSync(env.FONTCONFIG_FILE,'utf8');
  assert.ok(env.FONTCONFIG_FILE.startsWith(directory+path.sep));
  assert.ok(text.includes('/System/Library/Fonts'));
  assert.ok(text.includes(path.join(directory,'document-fonts','cache')));
  assert.ok(!text.includes('/var/cache/fontconfig'));
  assert.equal(prepareDocumentRuntimeEnvironment({role:'document-specialist',runDirectory:directory,environment:{PATH:'/usr/bin'},home:'/Users/test',exists:p=>p===root+'/python/bin/python3'}).FONTCONFIG_FILE,env.FONTCONFIG_FILE);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
