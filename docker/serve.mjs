import{loadServer}from'./server-entry.mjs';

async function chiefWebOptions() {
  const pilot = process.env.SUPER_AGENT_CHIEF_WEB_ENABLED === 'true';
  const evaluation = process.env.SUPER_AGENT_CHIEF_WEB_EVALUATION_ENABLED === 'true';
  const real = process.env.SUPER_AGENT_CHIEF_WEB_REAL_ENABLED === 'true';
  if ([pilot, evaluation, real].filter(Boolean).length > 1) throw new Error('CHIEF_WEB_MODE_CONFLICT');
  const log = event => console.log(JSON.stringify(event));
  if (real) {
    const { loadChiefWebRealRuntime } = await import('./bridge/chief-web-real-runtime.mjs');
    return loadChiefWebRealRuntime({ log });
  }
  if (pilot) {
    const { loadChiefWebRuntimeBootstrap } = await import('./bridge/chief-web-runtime-bootstrap.mjs');
    return loadChiefWebRuntimeBootstrap({ log });
  }
  if (evaluation) {
    if (process.env.PAPERCLIP_INSTANCE_ID !== 'chief-web-rehearsal' ||
        process.env.HEARTBEAT_SCHEDULER_ENABLED !== 'false' ||
        ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'].some(key => process.env[key])) {
      throw new Error('CHIEF_WEB_EVALUATION_ISOLATION_REQUIRED');
    }
    const { readChiefWebPrivateJson } = await import('./bridge/chief-web-private-file.mjs');
    const { loadPinnedChiefWebEvaluationMount } = await import('./bridge/chief-web-evaluation.mjs');
    const config = await readChiefWebPrivateJson('/paperclip/control/chief-web-evaluation.json');
    return { mountChiefWebPilot: await loadPinnedChiefWebEvaluationMount({ config, log }) };
  }
  return undefined;
}

try{const m=await loadServer('/opt/paperclip',await chiefWebOptions());if(typeof m.startServer!=='function')throw new Error('PAPERCLIP_SERVER_ENTRY_UNSUPPORTED');await m.startServer();}
catch(e){let message=String(e?.message??'startup failed');const secrets=[process.env.BETTER_AUTH_SECRET,process.env.DATABASE_URL];try{secrets.push(new URL(process.env.DATABASE_URL).password);}catch{}for(const value of secrets)if(value)message=message.split(value).join('[redacted]');console.error(JSON.stringify({stage:'serve',errorCode:'PAPERCLIP_START_FAILED',errorType:e?.name??'unknown',code:typeof e?.code==='string'?e.code:undefined,message:message.slice(0,500)}));process.exitCode=1;}
