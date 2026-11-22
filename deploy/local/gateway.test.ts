import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import { createDemoGateway } from './gateway.ts';

const root = resolve(import.meta.dirname, '../..');
const dist = resolve(root, '.local/gateway-test-dist');
const secretDirectory = resolve(root, '.local/gateway-test-secret');
const secret = resolve(secretDirectory, 'secret.txt');

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function prepare() {
  rmSync(dist, { recursive: true, force: true });
  rmSync(secretDirectory, { recursive: true, force: true });
  mkdirSync(resolve(dist, 'assets'), { recursive: true });
  mkdirSync(secretDirectory, { recursive: true });
  writeFileSync(resolve(dist, 'index.html'), '<!doctype html><title>crewtrace-gateway-test</title>');
  writeFileSync(resolve(dist, 'assets/app.js'), 'console.log("gateway");');
  writeFileSync(secret, 'should-not-be-served');
}

test('网关只提供静态构建与公开代理，不暴露管理端与本机文件', async t => {
  prepare();
  t.after(() => { rmSync(dist, { recursive: true, force: true }); rmSync(secretDirectory, { recursive: true, force: true }); });
  const upstream = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
  const upstreamPort = await listen(upstream);
  const server = createDemoGateway({ runtime: new URL(`http://127.0.0.1:${upstreamPort}`), webDist: dist });
  const port = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });

  const base = `http://127.0.0.1:${port}`;
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await index.text(), /crewtrace-gateway-test/);
  assert.equal(index.headers.get('cache-control'), 'no-store');

  const asset = await fetch(`${base}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') ?? '', /javascript/);

  const spa = await fetch(`${base}/tasks/anything`);
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /crewtrace-gateway-test/);

  assert.equal((await fetch(`${base}/admin/demo`)).status, 404);
  assert.equal((await fetch(`${base}/admin/demo/pause`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2f.gateway-test-secret%2fsecret.txt`)).status, 403);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  const traversal = await fetch(`${base}/api/%2e%2e%2fadmin`);
  assert.equal(traversal.status, 200, '代理路径由 Runtime 再次校验，网关不使用静态文件处理器');
});

test('网关转发 Host 与请求体，并覆写客户端提交的来源头', async t => {
  prepare();
  t.after(() => { rmSync(dist, { recursive: true, force: true }); rmSync(secretDirectory, { recursive: true, force: true }); });
  const seen: { method?: string; url?: string; headers?: Record<string, string | string[]>; body?: string }[] = [];
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamPort = await listen(upstream);
  const server = createDemoGateway({ runtime: new URL(`http://127.0.0.1:${upstreamPort}`), webDist: dist, publicOrigin: 'https://demo.trycloudflare.com' });
  const port = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });
  const base = `http://127.0.0.1:${port}`;

  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'attacker.example',
        'CF-Connecting-IP': '203.0.113.7',
        'X-Forwarded-For': '9.9.9.9',
        'X-Real-IP': '198.51.100.8',
        'Mcp-Protocol-Version': '2025-06-18',
      },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  const forwarded = seen[0];
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.url, '/mcp');
  assert.equal(forwarded.headers?.host, 'demo.trycloudflare.com');
  // 默认不采信 CF-Connecting-IP，也不转发客户端自带转发链。
  assert.equal(forwarded.headers?.['x-forwarded-for'], '127.0.0.1');
  assert.equal(forwarded.headers?.['x-real-ip'], '127.0.0.1');
  assert.equal(forwarded.headers?.['x-forwarded-proto'], 'https');
  assert.equal(forwarded.headers?.['mcp-protocol-version'], '2025-06-18');
  assert.deepEqual(JSON.parse(forwarded.body ?? '{}'), { jsonrpc: '2.0', id: 1, method: 'tools/list' });

  // 轮换伪造请求头不会改变网关上报的来源地址。
  await fetch(`${base}/api/commerce`, { headers: { 'CF-Connecting-IP': '203.0.113.90', 'X-Forwarded-For': '9.9.9.9', 'X-Real-IP': '198.51.100.9' } });
  assert.equal(seen[1].headers?.['x-forwarded-for'], '127.0.0.1');
  assert.equal(seen[1].headers?.['x-real-ip'], '127.0.0.1');
});

test('显式信任 Cloudflare 来源头时才使用合法地址，非法值回退到 socket', async t => {
  prepare();
  t.after(() => { rmSync(dist, { recursive: true, force: true }); rmSync(secretDirectory, { recursive: true, force: true }); });
  const seen: Record<string, string | string[]>[] = [];
  const upstream = createServer((req, res) => {
    req.resume();
    req.on('end', () => { seen.push(req.headers); res.end('{}'); });
  });
  const upstreamPort = await listen(upstream);
  const server = createDemoGateway({
    runtime: new URL(`http://127.0.0.1:${upstreamPort}`), webDist: dist, trustCloudflareHeader: true,
  });
  const port = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });
  const base = `http://127.0.0.1:${port}`;

  await fetch(`${base}/health`, { headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '9.9.9.9' } });
  assert.equal(seen[0]['x-forwarded-for'], '203.0.113.7');
  assert.equal(seen[0]['x-real-ip'], '203.0.113.7');

  await fetch(`${base}/health`, { headers: { 'CF-Connecting-IP': 'not-an-ip' } });
  assert.equal(seen[1]['x-forwarded-for'], '127.0.0.1');
});

test('网关把 /api/web 交给 Web 入口处理并使用公网地址展示 MCP', async t => {
  prepare();
  t.after(() => { rmSync(dist, { recursive: true, force: true }); rmSync(secretDirectory, { recursive: true, force: true }); });
  const previous = { RUNTIME_URL: process.env.RUNTIME_URL, PUBLIC_RUNTIME_URL: process.env.PUBLIC_RUNTIME_URL };
  process.env.RUNTIME_URL = 'http://127.0.0.1:1';
  process.env.PUBLIC_RUNTIME_URL = 'https://demo.trycloudflare.com';
  const upstream = createServer((req, res) => { res.end('{}'); });
  const upstreamPort = await listen(upstream);
  const server = createDemoGateway({ runtime: new URL(`http://127.0.0.1:${upstreamPort}`), webDist: dist });
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    await close(upstream);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  const config = await fetch(`http://127.0.0.1:${port}/api/web?action=collaboration-config`);
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { configured: true, mcpURL: 'https://demo.trycloudflare.com/mcp' });
});
