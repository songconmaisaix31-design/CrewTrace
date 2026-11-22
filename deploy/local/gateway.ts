import { createReadStream, statSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateway } from '../../apps/web/server/gateway.ts';

/**
 * 零成本本地入口：同源提供 Web 静态文件，并把 /api、/mcp、/health 转发到回环 Runtime。
 * 只监听 127.0.0.1，由 Cloudflare Quick Tunnel 或本机浏览器访问；不转发 /admin。
 */

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

type Options = { runtime: URL; webDist: string; publicOrigin?: string };

export function createDemoGateway(options: Options) {
  const { runtime, webDist, publicOrigin } = options;

  function json(res: ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }

  function clientAddress(req: IncomingMessage): string {
    // Cloudflare 注入 CF-Connecting-IP；网关覆写 X-Forwarded-For，客户端自带的同名头不参与。
    const forwarded = req.headers['cf-connecting-ip'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (value) return value.trim();
    return req.socket.remoteAddress ?? 'unknown';
  }

  function proxy(req: IncomingMessage, res: ServerResponse) {
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name)) continue;
      headers[name] = value;
    }
    const address = clientAddress(req);
    headers['x-forwarded-for'] = address;
    headers['x-real-ip'] = address;
    if (publicOrigin) headers['x-forwarded-proto'] = 'https';
    const upstream = httpRequest({
      protocol: runtime.protocol, hostname: runtime.hostname, port: runtime.port || 80,
      method: req.method, path: req.url, headers,
    }, response => {
      res.statusCode = response.statusCode ?? 502;
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        res.setHeader(name, value);
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!response.headers['cache-control']) res.setHeader('Cache-Control', 'no-store');
      response.pipe(res);
    });
    upstream.on('error', () => json(res, 502, { error: { code: 'GATEWAY_UPSTREAM_UNAVAILABLE', message: 'Runtime 未就绪' } }));
    req.pipe(upstream);
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '只支持读取静态文件' } }); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://gateway').pathname); }
    catch { json(res, 400, { error: { code: 'BAD_PATH', message: '路径无法解析' } }); return; }
    if (pathname.includes('\0')) { json(res, 400, { error: { code: 'BAD_PATH', message: '路径无法解析' } }); return; }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let file = resolve(webDist, relative);
    if (!file.startsWith(webDist + sep) && file !== webDist) { json(res, 403, { error: { code: 'PATH_REJECTED', message: '不允许访问该路径' } }); return; }
    try {
      if (statSync(file).isDirectory()) file = resolve(file, 'index.html');
      statSync(file);
    } catch {
      if (extname(relative)) { json(res, 404, { error: { code: 'NOT_FOUND', message: '文件不存在' } }); return; }
      file = resolve(webDist, 'index.html');
      try { statSync(file); } catch { json(res, 404, { error: { code: 'WEB_NOT_BUILT', message: 'Web 构建产物不存在，请先执行 npm run build' } }); return; }
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-store' : 'public, max-age=300');
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).on('error', () => { res.statusCode = 500; res.end(); }).pipe(res);
  }

  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://gateway').pathname;
    if (path === '/api/web') {
      req.url = (req.url ?? '').slice('/api/web'.length) || '/';
      void gateway(req, res);
      return;
    }
    if (path === '/admin' || path.startsWith('/admin/')) { json(res, 404, { error: { code: 'NOT_FOUND', message: '端点不存在' } }); return; }
    if (path === '/mcp' || path === '/health' || path.startsWith('/api/')) { proxy(req, res); return; }
    serveStatic(req, res);
  });
}

if (import.meta.main) {
  const webDist = resolve(fileURLToPath(new URL('../../apps/web/dist/', import.meta.url)));
  const server = createDemoGateway({
    runtime: new URL(process.env.GATEWAY_RUNTIME_URL ?? 'http://127.0.0.1:3000'),
    webDist,
    publicOrigin: process.env.GATEWAY_PUBLIC_ORIGIN,
  });
  const port = Number(process.env.GATEWAY_PORT ?? 8080);
  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({ event: 'gateway_listening', url: `http://127.0.0.1:${port}`, runtime: (process.env.GATEWAY_RUNTIME_URL ?? 'http://127.0.0.1:3000'), webDist }));
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

