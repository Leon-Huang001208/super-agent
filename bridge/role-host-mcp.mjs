import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const idPattern=/^[A-Za-z0-9_-]{1,96}$/;
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([name])=>['PATH','HOME','USER','LOGNAME','TMPDIR','LANG','LC_ALL','SHELL','XDG_CACHE_HOME','UV_CACHE_DIR'].includes(name)));
const ownProcessGroup=process.platform!=='win32';

/** A detached POSIX child owns its PGID, including wrapper descendants holding stdio. */
function ownedProcessTermination(child,onError){
 let closed=false,terminating=false,force;
 const completed=new Promise(resolve=>child.once('close',()=>{closed=true;clearTimeout(force);resolve();}));
 const send=signal=>{
  if(closed||!Number.isInteger(child.pid)||child.pid<2)return false;
  try{if(ownProcessGroup)process.kill(-child.pid,signal);else child.kill(signal);return true;}
  catch(error){if(error.code!=='ESRCH')onError(error);return false;}
 };
 return {completed,terminate(){
  if(closed||terminating)return;terminating=true;
  // An absent group has ended; do not leave a delayed signal for a reused ID.
  if(!send('SIGTERM'))return;
  force=setTimeout(()=>send('SIGKILL'),250);force.unref();
 }};
}

/** Built-in asynchronous subprocess port shared by the host tools and TOML reader. */
export function runHostCommand(binary,args,options={}){
 return new Promise(resolve=>{
  let child,owned,stdout='',stderr='',error,signal=null,timer,bytes=0,settled=false;
  const finish=status=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);resolve({status,stdout,stderr,error,signal});};
  const terminate=()=>owned?.terminate();
  const cancel=()=>{error??=Object.assign(new Error('HOST_COMMAND_CANCELLED'),{code:'ABORT_ERR'});terminate();};
  if(options.signal?.aborted){cancel();finish(null);return;}
  try{child=spawn(binary,args,{cwd:options.cwd,env:options.env,shell:false,detached:ownProcessGroup,stdio:['pipe','pipe','pipe']});}
  catch(cause){error=cause;finish(null);return;}
  owned=ownedProcessTermination(child,cause=>{error??=cause;});
  options.signal?.addEventListener('abort',cancel,{once:true});
  child.once('error',cause=>{error=cause;finish(null);});child.once('close',(status,sig)=>{signal=sig;finish(status);});
  for(const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']]){
   stream.setEncoding('utf8');stream.on('data',chunk=>{
    bytes+=Buffer.byteLength(chunk);if(bytes>(options.maxBuffer??512*1024)){error=Object.assign(new Error('HOST_COMMAND_OUTPUT_LIMIT'),{code:'ENOBUFS'});terminate();return;}
    if(key==='stdout')stdout+=chunk;else stderr+=chunk;
   });
  }
  child.stdin.on('error',cause=>{if(cause.code!=='EPIPE'){error=cause;terminate();}});child.stdin.end(options.input??'');
  if(options.timeout)timer=setTimeout(()=>{error??=Object.assign(new Error('HOST_COMMAND_TIMEOUT'),{code:'ETIMEDOUT'});terminate();},options.timeout);
 });
}

/** Read one configured stdio server. Configuration and environment remain on the host. */
export async function loadHostMcpServer({serverId,configPath=path.join(os.homedir(),'.codex','config.toml'),runner=runHostCommand,pythonBinary='/opt/homebrew/bin/python3.12',signal}={}){
 if(!idPattern.test(serverId??'')||!path.isAbsolute(configPath))fail('ROLE_HOST_MCP_CONFIG_DENIED');
 const source=`import json,sys,tomllib
with open(sys.argv[1], 'rb') as f: config=tomllib.load(f)
server=config.get('mcp_servers',{}).get(sys.argv[2])
if not isinstance(server,dict) or server.get('enabled',True) is False or not isinstance(server.get('command'),str) or server.get('url'):
 sys.exit(4)
print(json.dumps({'command':server['command'],'args':server.get('args',[]),'env':server.get('env',{}),'envVars':server.get('env_vars',[]),'enabledTools':server.get('enabled_tools'),'disabledTools':server.get('disabled_tools',[]),'cwd':server.get('cwd')}))`;
 let result;
 try{result=await runner(pythonBinary,['-c',source,configPath,serverId],{encoding:'utf8',env:cleanEnv(),shell:false,timeout:10000,maxBuffer:256*1024,signal});}
 catch{fail('ROLE_HOST_MCP_CONFIG_UNAVAILABLE');}
 if(result?.error||result?.signal||result?.status!==0)fail('ROLE_HOST_MCP_CONFIG_UNAVAILABLE');
 let server;try{server=JSON.parse(String(result.stdout));}catch{fail('ROLE_HOST_MCP_CONFIG_INVALID');}
 if(!object(server)||typeof server.command!=='string'||!Array.isArray(server.args)||server.args.some(x=>typeof x!=='string')||
  !object(server.env??{})||Object.values(server.env??{}).some(x=>typeof x!=='string')||
  !Array.isArray(server.envVars??[])||(server.envVars??[]).some(x=>typeof x!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))||
  (server.cwd!==undefined&&server.cwd!==null&&(!path.isAbsolute(server.cwd)||path.normalize(server.cwd)!==server.cwd)))fail('ROLE_HOST_MCP_CONFIG_INVALID');
 return server;
}

/** One bounded stdio session uses the existing local server; no package installation or config writes. */
export async function callHostMcp({permit,serverId,operation='tools/call',toolName,arguments:args={},loadServer=loadHostMcpServer,spawnProcess=spawn,log=()=>{},timeoutMs=30000,maxOutputBytes=512*1024,configPath,runner,signal}={}){
 const entry=permit?.projectContext?.hostMcpServers?.find(value=>object(value)&&value.id===serverId);
 if(!idPattern.test(serverId??'')||!entry||(entry.allowedRoles&&!entry.allowedRoles.includes(permit.role)))fail('ROLE_HOST_MCP_SERVER_DENIED');
 if(!['tools/list','tools/call'].includes(operation))fail('ROLE_HOST_MCP_OPERATION_DENIED');
 if(!Array.isArray(entry.tools)||(operation==='tools/call'&&(!entry.tools.includes(toolName)||typeof toolName!=='string'||!object(args))))fail('ROLE_HOST_MCP_TOOL_DENIED');
 const audit=(code,extra={})=>log({code,serverId,operation,...(toolName?{toolName}:{}),...extra});
 let child,owned,timer,closed=false,activeReject,pending='',received=0,sequence=0;
 const waiting=new Map();
 function stop(code){
  if(closed)return;closed=true;clearTimeout(timer);
  const error=Object.assign(new Error(code),{code});for(const value of waiting.values())value.reject(error);waiting.clear();
  if(activeReject)activeReject(error);terminate();
 }
 function terminate(){owned?.terminate();}
 const cancel=()=>stop('ROLE_HOST_MCP_CANCELLED');
 try{
  if(signal?.aborted)fail('ROLE_HOST_MCP_CANCELLED');
  const config=await loadServer({serverId,configPath,runner,signal});
  if(signal?.aborted)fail('ROLE_HOST_MCP_CANCELLED');
  if(typeof config?.command!=='string'||!config.command||!Array.isArray(config.args??[])||!object(config.env??{})||
    (config.args??[]).some(x=>typeof x!=='string')||Object.values(config.env??{}).some(x=>typeof x!=='string'))fail('ROLE_HOST_MCP_CONFIG_INVALID');
  const allowedTool=name=>entry.tools.includes(name)&&(!Array.isArray(config.enabledTools)||config.enabledTools.includes(name))&&!(config.disabledTools??[]).includes(name);
  if(operation==='tools/call'&&!allowedTool(toolName))fail('ROLE_HOST_MCP_TOOL_DENIED');
  const env={...cleanEnv(),...(config.env??{})};
  for(const name of config.envVars??[]){if(typeof process.env[name]!=='string')fail('ROLE_HOST_MCP_ENV_UNAVAILABLE');env[name]=process.env[name];}
  const started=Date.now();
  child=spawnProcess(config.command,config.args??[],{cwd:config.cwd??undefined,env,shell:false,detached:ownProcessGroup,stdio:['pipe','pipe','pipe']});
  owned=ownedProcessTermination(child,()=>audit('ROLE_HOST_MCP_TERMINATION_FAILED'));
  signal?.addEventListener('abort',cancel,{once:true});
  const fatal=new Promise((resolve,reject)=>{activeReject=reject;});
  // Every request races this promise, so a failed process cannot strand a request.
  fatal.catch(()=>{});
  child.once('error',()=>stop('ROLE_HOST_MCP_START_FAILED'));
  child.once('close',()=>{if(!closed)stop('ROLE_HOST_MCP_CLOSED');});
  child.stdin.on('error',()=>stop('ROLE_HOST_MCP_WRITE_FAILED'));
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
   received+=Buffer.byteLength(chunk);if(received>maxOutputBytes){stop('ROLE_HOST_MCP_OUTPUT_LIMIT');return;}
   pending+=chunk;let cut;while(!closed&&(cut=pending.indexOf('\n'))>=0){
    const line=pending.slice(0,cut);pending=pending.slice(cut+1);if(!line.trim())continue;
    let message;try{message=JSON.parse(line);}catch{stop('ROLE_HOST_MCP_PROTOCOL_INVALID');return;}
    if(!object(message)||message.jsonrpc!=='2.0'){stop('ROLE_HOST_MCP_PROTOCOL_INVALID');return;}
    if(message.id!==undefined&&waiting.has(message.id)){
     const response=waiting.get(message.id);waiting.delete(message.id);
     if(message.error)response.reject(Object.assign(new Error('ROLE_HOST_MCP_REQUEST_FAILED'),{code:'ROLE_HOST_MCP_REQUEST_FAILED'}));else response.resolve(message.result);
    }else if(message.id!==undefined&&typeof message.method==='string'){
     // Local tools cannot obtain sampling, credentials or a second authority source.
     child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Host client does not support server requests'}})+'\n');
    }
   }
  });
  // Drain, but never propagate server stderr; it may contain local credentials.
  let stderrBytes=0;child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>maxOutputBytes)stop('ROLE_HOST_MCP_OUTPUT_LIMIT');});
  timer=setTimeout(()=>stop('ROLE_HOST_MCP_TIMEOUT'),timeoutMs);
  const request=(method,params)=>Promise.race([new Promise((resolve,reject)=>{
   if(closed){reject(Object.assign(new Error('ROLE_HOST_MCP_CLOSED'),{code:'ROLE_HOST_MCP_CLOSED'}));return;}
   const id=++sequence;waiting.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  }),fatal]);
  const initialized=await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'super-agent-role-host',version:'1'}});
  if(!initialized?.serverInfo||!initialized?.capabilities)fail('ROLE_HOST_MCP_PROTOCOL_INVALID');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  let cursor,found=false;const seen=new Set(),tools=[];
  for(let page=0;page<32;page++){
   const listed=await request('tools/list',cursor?{cursor}:{});if(!Array.isArray(listed?.tools))fail('ROLE_HOST_MCP_PROTOCOL_INVALID');
   for(const tool of listed.tools)if(allowedTool(tool?.name)&&object(tool?.inputSchema)&&!tools.some(value=>value.name===tool.name))tools.push({name:tool.name,...(typeof tool.description==='string'?{description:tool.description}:{}),inputSchema:tool.inputSchema});
   if(operation==='tools/call'&&listed.tools.some(tool=>tool?.name===toolName)){found=true;break;}
   if(!listed.nextCursor)break;if(typeof listed.nextCursor!=='string'||seen.has(listed.nextCursor))fail('ROLE_HOST_MCP_PROTOCOL_INVALID');seen.add(listed.nextCursor);cursor=listed.nextCursor;
  }
  if(operation==='tools/list'){audit('ROLE_HOST_MCP_COMPLETED',{durationMs:Date.now()-started,toolCount:tools.length});return {serverId,tools};}
  if(!found)fail('ROLE_HOST_MCP_TOOL_UNAVAILABLE');
  const result=await request('tools/call',{name:toolName,arguments:args});
  if(!object(result)||result.isError===true)fail('ROLE_HOST_MCP_TOOL_FAILED');
  audit('ROLE_HOST_MCP_COMPLETED',{durationMs:Date.now()-started,outputBytes:Buffer.byteLength(JSON.stringify(result))});return result;
 }catch(error){const code=/^ROLE_HOST_MCP_[A-Z_]+$/.test(error?.code??'')?error.code:'ROLE_HOST_MCP_FAILED';audit('ROLE_HOST_MCP_FAILED',{errorCode:code});throw Object.assign(new Error(code),{code});}
 finally{
  closed=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);terminate();if(owned)await owned.completed;
 }
}
