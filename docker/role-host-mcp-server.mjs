/** Task-local stdio transport. The broker and Native permit authorize every host operation. */
import readline from 'node:readline';
const endpoint=process.env.ROLE_HOST_MCP_ENDPOINT??'http://provider:8090/backend-api/role-host-mcp';
const token=process.env.CODEX_CONNECTORS_TOKEN;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(!token){process.stderr.write('{"code":"ROLE_HOST_MCP_TOKEN_MISSING"}\n');process.exitCode=1;}
else{
 const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of lines){
  let message;
  try{
   if(!line.trim())continue;
   message=JSON.parse(line);
   if(message.id===undefined)continue;
   if(message.method==='initialize'){
    send({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'paperclip-role-host',version:'1.0.0'}}});continue;
   }
   if(message.method==='ping'){send({jsonrpc:'2.0',id:message.id,result:{}});continue;}
   if(!['tools/list','tools/call'].includes(message.method))throw Object.assign(Error(),{code:'ROLE_HOST_MCP_METHOD_DENIED'});
   const release=process.env.ROLE_HOST_RWB_RELEASE==='1'&&message.method==='tools/call'&&message.params?.name==='host.rwb_release';
   // Legacy task containers mount this stdio file by itself. Only native release runs load the scoped helper.
   const response=release?await (await import('../bridge/rwb-release.mjs')).postRwbReleaseRequest(endpoint,token,message):await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(message)});
   const body=release?response.body:await response.json();
   if(!response.ok)throw Object.assign(Error(),{code:/^(?:HOST|ROLE)_[A-Z_]+$/.test(body?.error?.message??'')?body.error.message:'ROLE_HOST_MCP_REQUEST_FAILED'});
   send({...body,jsonrpc:'2.0',id:message.id});
  }catch(error){
   const code=/^(?:HOST|ROLE)_[A-Z_]+$/.test(error.code??'')?error.code:'ROLE_HOST_MCP_PROTOCOL_FAILED';
   process.stderr.write(JSON.stringify({code})+'\n');send({jsonrpc:'2.0',id:message?.id??null,error:{code:-32000,message:code}});
  }
 }
}
