import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
export async function loadServer(directory='/opt/paperclip'){
  const root=fs.realpathSync(path.join(directory,'node_modules','@paperclipai','server'));
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const target=pkg.exports?.['.']?.import;
  if(typeof target!=='string'||!target.startsWith('./'))throw new Error('PAPERCLIP_SERVER_EXPORT_UNSUPPORTED');
  const entry=fs.realpathSync(path.resolve(root,target)),relative=path.relative(root,entry);
  if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('PAPERCLIP_SERVER_ENTRY_ESCAPE');
  return import(pathToFileURL(entry).href);
}
