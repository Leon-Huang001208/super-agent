import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
import { installChiefWebAppHook } from './chief-web-app-hook.mjs';
export async function loadServer(directory='/opt/paperclip', { mountChiefWebPilot } = {}) {
  const root=fs.realpathSync(path.join(directory,'node_modules','@paperclipai','server'));
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const target=pkg.exports?.['.']?.import;
  if(typeof target!=='string'||!target.startsWith('./'))throw new Error('PAPERCLIP_SERVER_EXPORT_UNSUPPORTED');
  const entry=fs.realpathSync(path.resolve(root,target)),relative=path.relative(root,entry);
  if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('PAPERCLIP_SERVER_ENTRY_ESCAPE');
  if (mountChiefWebPilot === undefined) return import(pathToFileURL(entry).href);
  const appFile = fs.realpathSync(path.join(root, 'dist', 'app.js'));
  if (appFile !== path.join(root, 'dist', 'app.js')) throw new Error('CHIEF_WEB_APP_ENTRY_ESCAPE');
  const hook = installChiefWebAppHook(appFile, mountChiefWebPilot);
  try {
    const server = await import(pathToFileURL(entry).href);
    hook.verify();
    return server;
  } finally {
    hook.close();
  }
}
