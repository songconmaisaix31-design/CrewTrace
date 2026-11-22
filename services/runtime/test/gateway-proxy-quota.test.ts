import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { createDemoGateway } from '../../../deploy/local/gateway.ts';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';

const INPUT = 'record_id,amount_cents\nitem-a,10\n';

/**
 * 隔离验收：真实 HTTP 网关 + 公开模式 Runtime + 真实 PostgreSQL。
 * 客户端轮换 CF-Connecting-IP、X-Forwarded-For、X-Real-IP 不能改变来源计数，
 * 配额耗尽与暂停开关在网关之后仍然生效。
 */
test('网关不采信可伪造的来源头，配额与暂停开关无法绕过', async t => {
  await createPortfolioTestSchema();
  process.env.PAYMENT_MODE = 'disabled';
  process.env.DEPLOYMENT_ENV = 'local';
  const { runtime } = await import('../src/index.js');
  const { Application } = await import('../src/application.js');
  const { createHttp } = await import('../src/http.js');
  const { migrate } = await import('../src/migrate.js');
  await migrate(runtime.db);

  const app = new Application(runtime.db, {
    ...runtime.config,
    PUBLIC_DEPLOYMENT: true,
    DEPLOYMENT_ENV: 'staging',
    PROXY_TRUST_MODE: 'cidr',
    TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    PUBLIC_RATE_LIMIT_PER_MINUTE: 1000,
    PUBLIC_ORDER_LIMIT_PER_HOUR: 1000,
    PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE: 1000,
    DEMO_AGENT_REGISTRATIONS_PER_IP_DAY: 100,
    DEMO_GLOBAL_ORDERS_PER_DAY: 100,
    DEMO_IP_ORDERS_PER_DAY: 1,
    DEMO_AGENT_ORDERS_PER_DAY: 100,
    DEMO_MAX_ACTIVE_ORDERS: 100,
  } as typeof runtime.config);

  const runtimeServer = serve({ fetch: createHttp(app).fetch, hostname: '127.0.0.1', port: 0 });
  if (!runtimeServer.listening) await once(runtimeServer, 'listening');
  const runtimeAddress = runtimeServer.address();
  assert.ok(runtimeAddress && typeof runtimeAddress !== 'string');
  const runtimeBase = `http://127.0.0.1:${runtimeAddress.port}`;
  // Web 入口网关从进程环境读取 Runtime 地址。
  process.env.RUNTIME_URL = runtimeBase;

  const gatewayServer = createDemoGateway({
    runtime: new URL(runtimeBase),
    webDist: resolve(import.meta.dirname, '../../../apps/web/dist'),
  });
  gatewayServer.listen(0, '127.0.0.1');
  if (!gatewayServer.listening) await once(gatewayServer, 'listening');
  const gatewayAddress = gatewayServer.address();
  assert.ok(gatewayAddress && typeof gatewayAddress !== 'string');
  const gatewayBase = `http://127.0.0.1:${gatewayAddress.port}`;

  t.after(async () => {
    gatewayServer.closeAllConnections();
    await new Promise<void>(done => gatewayServer.close(() => done()));
    (runtimeServer as unknown as { closeAllConnections(): void }).closeAllConnections();
    await new Promise<void>(done => runtimeServer.close(() => done()));
    await runtime.db.close();
  });

  const register = await fetch(`${gatewayBase}/api/collaboration/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' },
    body: JSON.stringify({ name: 'Proxy quota buyer' }),
  });
  const registerBody = await register.text();
  assert.equal(register.status, 201, registerBody);
  const buyer = JSON.parse(registerBody) as { credential: string };

  // 浏览器通过 /api/web 传递带查询串的路径，历史订单列表必须能正常读取。
  const list = await fetch(`${gatewayBase}/api/web?path=${encodeURIComponent('/api/commerce/orders?limit=20')}`, {
    headers: { Authorization: `Bearer ${buyer.credential}` },
  });
  assert.equal(list.status, 200, await list.text());

  const order = (forged: Record<string, string>) => fetch(`${gatewayBase}/api/commerce/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${buyer.credential}`, 'Content-Type': 'application/json', ...forged },
    body: JSON.stringify({
      serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1,
      idempotencyKey: randomUUID(), inputCsv: INPUT,
    }),
  });

  const first = await order({ 'CF-Connecting-IP': '203.0.113.10', 'X-Forwarded-For': '198.51.100.10', 'X-Real-IP': '192.0.2.10' });
  const firstBody = await first.text();
  assert.equal(first.status, 201, firstBody);

  const second = await order({ 'CF-Connecting-IP': '203.0.113.11', 'X-Forwarded-For': '198.51.100.11', 'X-Real-IP': '192.0.2.11' });
  assert.equal(second.status, 429);
  const failure = await second.json() as { error: { code: string; details?: { scope?: string } } };
  assert.equal(failure.error.code, 'DEMO_QUOTA_EXCEEDED');
  assert.equal(failure.error.details?.scope, 'order:ip');

  const ips = await runtime.db.pool.query("SELECT bucket,used FROM demo_usage_counters WHERE scope='order:ip'");
  assert.equal(ips.rowCount, 1);
  assert.match(String(ips.rows[0].bucket), /^127\.0\.0\.1\|/);
  assert.equal(Number(ips.rows[0].used), 1);

  const pause = await fetch(`${runtimeBase}/admin/demo/pause`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${runtime.config.ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused: true }),
  });
  assert.equal(pause.status, 200, await pause.text());

  const paused = await order({ 'CF-Connecting-IP': '203.0.113.12' });
  assert.equal(paused.status, 503);
  assert.equal((await paused.json() as { error: { code: string } }).error.code, 'DEMO_PAUSED');

  const resume = await fetch(`${runtimeBase}/admin/demo/pause`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${runtime.config.ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused: false }),
  });
  assert.equal(resume.status, 200, await resume.text());
});
