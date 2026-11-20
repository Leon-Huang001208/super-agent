import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
import { installChiefWebAppHook } from './chief-web-app-hook.mjs';
import { installRoleAiBindingHook } from './role-ai-binding-hook.mjs';
export async function loadServer(directory='/opt/paperclip', {
  mountChiefWebPilot, settleChiefWebPilot, admitChiefWebCall, recoverChiefWebSkippedWake,
  chiefHookFactory=installChiefWebAppHook, aiHookFactory=installRoleAiBindingHook,
} = {}) {
  const root=fs.realpathSync(path.join(directory,'node_modules','@paperclipai','server'));
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const target=pkg.exports?.['.']?.import;
  if(typeof target!=='string'||!target.startsWith('./'))throw new Error('PAPERCLIP_SERVER_EXPORT_UNSUPPORTED');
  const entry=fs.realpathSync(path.resolve(root,target)),relative=path.relative(root,entry);
  if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('PAPERCLIP_SERVER_ENTRY_ESCAPE');
  let chiefHook,aiHook;
  try {
    if (mountChiefWebPilot === undefined) {
      if (settleChiefWebPilot !== undefined || admitChiefWebCall !== undefined || recoverChiefWebSkippedWake !== undefined) throw new Error('CHIEF_WEB_APP_NOT_CONFIGURED');
    } else {
      const appFile=fs.realpathSync(path.join(root,'dist','app.js'));
      if(appFile!==path.join(root,'dist','app.js'))throw new Error('CHIEF_WEB_APP_ENTRY_ESCAPE');
      const conversationPath=path.join(root,'dist','services','agent-conversations.js');
      const conversationFile=settleChiefWebPilot===undefined?undefined:fs.realpathSync(conversationPath);
      if(conversationFile!==undefined&&conversationFile!==conversationPath)throw new Error('CHIEF_WEB_APP_ENTRY_ESCAPE');
      const queuePath=path.join(root,'dist','services','heartbeat','queue.js');
      const queueFile=recoverChiefWebSkippedWake===undefined?undefined:fs.realpathSync(queuePath);
      if(queueFile!==undefined&&queueFile!==queuePath)throw new Error('CHIEF_WEB_APP_ENTRY_ESCAPE');
      chiefHook=chiefHookFactory({appFile,conversationFile,queueFile,mountPilot:mountChiefWebPilot,settlePilot:settleChiefWebPilot,admitPilot:admitChiefWebCall,recoverSkippedWakePilot:recoverChiefWebSkippedWake});
    }
    // Both hooks must be active before routes load their shared heartbeat/conversation dependencies.
    if(process.env.SUPER_AGENT_ROLE_RUNTIME_ENABLED==='true')aiHook=aiHookFactory({directory});
    const server=await import(pathToFileURL(entry).href);
    chiefHook?.verify();
    aiHook?.verify();
    return server;
  } finally {
    try{aiHook?.close();}finally{chiefHook?.close();}
  }
}
