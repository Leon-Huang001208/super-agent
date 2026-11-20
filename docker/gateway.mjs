import http from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const tailnetHost = 'mac-mini-1.tail947973.ts.net:8443';
function allowedPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\r\n]/.test(value);
}
// The listener is published on host loopback only. Never trust client proxy
// headers to select the public scheme; HTTP and upgrades share this policy.
export function forwardingHeaders(request, {upgrade = false} = {}) {
  const hostEntries = request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === 'host');
  const value = request.headers.host;
  if (hostEntries.length !== 1 || typeof value !== 'string') return null;
  const host = value.toLowerCase();
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/.exec(host);
  if (host !== tailnetHost && (!loopback || (loopback[2] && Number(loopback[2]) > 65535))) return null;
  const headers = {...request.headers};
  const connectionFields = typeof headers.connection === 'string' ? headers.connection.split(',').map(x => x.trim().toLowerCase()) : [];
  const hopHeaders = new Set(['connection', 'upgrade', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', ...connectionFields]);
  for (const key of Object.keys(headers)) {
    if (hopHeaders.has(key) || key === 'forwarded' || key.startsWith('x-forwarded-') || key === 'x-real-ip') delete headers[key];
  }
  headers.host = host;
  headers['x-forwarded-host'] = host;
  headers['x-forwarded-proto'] = host === tailnetHost ? 'https' : 'http';
  if (upgrade && request.headers.upgrade) {
    headers.upgrade = request.headers.upgrade;
    headers.connection = 'Upgrade';
  }
  return headers;
}
function probeField(value) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256) : null;
}
export function createGateway(targetHost = 'paperclip', targetPort = 3100, {headerProbeNonce, logProbe = record => console.log(JSON.stringify(record))} = {}) {
  if (headerProbeNonce !== undefined && !/^[a-f0-9]{32}$/.test(headerProbeNonce)) throw new Error('GATEWAY_PROBE_NONCE_INVALID');
  const probePath = headerProbeNonce ? '/__sa_header_probe_' + headerProbeNonce : null;
  let probeConsumed = false;
  const server = http.createServer((request, response) => {
    if (!allowedPath(request.url)) { response.writeHead(400); response.end('Invalid request target'); return; }
    const headers = forwardingHeaders(request);
    if (!headers) { response.writeHead(421); response.end('Host not allowed'); return; }
    if (probePath && request.url === probePath) {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'GET') { response.writeHead(405, {Allow: 'GET'}); response.end(); return; }
      if (probeConsumed) { response.writeHead(410); response.end(); return; }
      probeConsumed = true;
      try {
        logProbe({host: probeField(request.headers.host), 'x-forwarded-host': probeField(request.headers['x-forwarded-host']), 'x-forwarded-proto': probeField(request.headers['x-forwarded-proto'])});
      } catch {
        console.error('{"stage":"gateway","errorCode":"GATEWAY_PROBE_LOG_FAILED"}');
        response.writeHead(503); response.end(); return;
      }
      response.writeHead(204); response.end(); return;
    }
    const upstream = http.request({hostname: targetHost, port: targetPort, path: request.url, method: request.method, headers}, r => {
      response.writeHead(r.statusCode ?? 502, r.headers); r.pipe(response);
    });
    upstream.setTimeout(120000, () => upstream.destroy(new Error('UPSTREAM_TIMEOUT')));
    upstream.on('error', () => { console.error('{"stage":"gateway","errorCode":"UPSTREAM_UNAVAILABLE"}'); if (!response.headersSent) response.writeHead(502); response.end('Backend unavailable'); });
    request.on('aborted', () => upstream.destroy()); request.on('error', () => upstream.destroy()); request.pipe(upstream);
  });
  server.on('connect', (_request, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  server.on('upgrade', (request, socket, head) => {
    if (!allowedPath(request.url)) { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const headers = forwardingHeaders(request, {upgrade: true});
    if (!headers) { socket.end('HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n'); return; }
    if (probePath && request.url === probePath) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    const upstream = http.request({hostname: targetHost, port: targetPort, path: request.url, method: request.method, headers});
    upstream.setTimeout(120000, () => upstream.destroy(new Error('UPSTREAM_TIMEOUT')));
    upstream.on('upgrade', (r, target, targetHead) => {
      socket.write(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n`);
      for (const [k, v] of Object.entries(r.headers)) {
        if (v !== undefined) for (const value of Array.isArray(v) ? v : [v]) socket.write(`${k}: ${value}\r\n`);
      }
      socket.write('\r\n');
      if (targetHead.length) socket.write(targetHead); if (head.length) target.write(head);
      socket.on('error', () => target.destroy()); target.on('error', () => socket.destroy()); socket.pipe(target).pipe(socket);
    });
    upstream.on('response', r => { socket.end(`HTTP/1.1 ${r.statusCode ?? 502} Upgrade Rejected\r\nConnection: close\r\n\r\n`); r.resume(); });
    upstream.on('error', () => { console.error('{"stage":"gateway","errorCode":"UPSTREAM_UNAVAILABLE"}'); socket.destroy(); });
    socket.on('error', () => upstream.destroy()); upstream.end();
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createGateway('paperclip', 3100, {headerProbeNonce: process.env.SUPER_AGENT_GATEWAY_HEADER_PROBE_NONCE || undefined});
  server.on('error', () => { console.error('{"stage":"gateway","errorCode":"GATEWAY_LISTEN_FAILED"}'); process.exitCode = 1; });
  server.listen(3100, '0.0.0.0', () => console.log('{"stage":"gateway","status":"listening"}'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
