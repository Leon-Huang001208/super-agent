import http from'node:http';import{fileURLToPath}from'node:url';import path from'node:path';
function allowedPath(value){return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\r\n]/.test(value);}
export function createGateway(targetHost='paperclip',targetPort=3100){
  const server=http.createServer((request,response)=>{
    if(!allowedPath(request.url)){response.writeHead(400);response.end('Invalid request target');return;}
    const headers={...request.headers,'x-forwarded-host':request.headers.host??'','x-forwarded-proto':'http'};
    delete headers['proxy-authorization'];delete headers['proxy-connection'];
    const upstream=http.request({hostname:targetHost,port:targetPort,path:request.url,method:request.method,headers},r=>{response.writeHead(r.statusCode??502,r.headers);r.pipe(response);});
    upstream.setTimeout(120000,()=>upstream.destroy(new Error('UPSTREAM_TIMEOUT')));
    upstream.on('error',()=>{console.error('{"stage":"gateway","errorCode":"UPSTREAM_UNAVAILABLE"}');if(!response.headersSent)response.writeHead(502);response.end('Backend unavailable');});
    request.on('aborted',()=>upstream.destroy());request.on('error',()=>upstream.destroy());request.pipe(upstream);
  });
  server.on('connect',(_request,socket)=>socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  server.on('upgrade',(request,socket,head)=>{
    if(!allowedPath(request.url)){socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');return;}
    const upstream=http.request({hostname:targetHost,port:targetPort,path:request.url,headers:request.headers});
    upstream.on('upgrade',(r,target,targetHead)=>{
      socket.write(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n`);
      for(const[k,v]of Object.entries(r.headers)){if(v!==undefined)for(const value of Array.isArray(v)?v:[v])socket.write(`${k}: ${value}\r\n`);}socket.write('\r\n');
      if(targetHead.length)socket.write(targetHead);if(head.length)target.write(head);
      socket.on('error',()=>target.destroy());target.on('error',()=>socket.destroy());socket.pipe(target).pipe(socket);
    });
    upstream.on('response',r=>{socket.end(`HTTP/1.1 ${r.statusCode??502} Upgrade Rejected\r\nConnection: close\r\n\r\n`);r.resume();});
    upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());upstream.end();
  });
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=createGateway();server.on('error',()=>{console.error('{"stage":"gateway","errorCode":"GATEWAY_LISTEN_FAILED"}');process.exitCode=1;});server.listen(3100,'0.0.0.0',()=>console.log('{"stage":"gateway","status":"listening"}'));for(const signal of['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));}
