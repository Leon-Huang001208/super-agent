import fs from 'node:fs/promises';
import path from 'node:path';
import { authorizeHello, isSubscriptionAuth, runHelloProcess, safeHelloArgs } from './codex-hello-gate.mjs';
try {
  const id=process.env.SUPER_AGENT_ROLE_PROBE_ID;
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id??'')||process.getuid()!==0)throw Error('ROLE_PROBE_DENIED');
  let input='',length=0;
  for await(const chunk of process.stdin){length+=chunk.length;if(length>4096)throw Error('ROLE_PROBE_INPUT_DENIED');input+=chunk;}
  const directory='/paperclip/control/research-pm/probes/'+id;
  const permit=await authorizeHello({directory,args:process.argv.slice(2),input,cwd:process.cwd(),home:process.env.CODEX_HOME,
    apiKeysPresent:Boolean(process.env.OPENAI_API_KEY||process.env.CODEX_API_KEY||process.env.OPENAI_BASE_URL)});
  const auth=JSON.parse(await fs.readFile(path.join(process.env.CODEX_HOME,'auth.json'),'utf8'));
  if(!isSubscriptionAuth(auth))throw Error('ROLE_PROBE_SUBSCRIPTION_REQUIRED');
  const result=await runHelloProcess({command:'/opt/paperclip/node_modules/.bin/codex',args:safeHelloArgs(permit),input});
  await fs.writeFile(directory+'/result.json',JSON.stringify({probeId:id,...result})+'\n',{flag:'wx',mode:0o600});
  process.exitCode=result.exitCode===0&&!result.timedOut&&!result.interrupted&&!result.spawnFailed?0:1;
}catch(e){process.stderr.write(JSON.stringify({code:/^[A-Z_]+$/.test(e.code??e.message)?(e.code??e.message):'ROLE_PROBE_UNKNOWN'})+'\n');process.exitCode=1;}
