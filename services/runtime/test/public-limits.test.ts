import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { Application } from '../src/application.js';
import { createHttp } from '../src/http.js';
import { migrate } from '../src/migrate.js';
import { FixedWindowLimiter } from '../src/rate-limit.js';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';

const INPUT = 'record_id,amount_cents\nitem-a,10\n';

test('固定窗口限流在窗口结束后重置', () => {
  const limiter = new FixedWindowLimiter(2, 1000);
  assert.equal(limiter.take('a', 0).allowed, true);
  assert.equal(limiter.take('a', 100).allowed, true);
  assert.equal(limiter.take('a', 200).allowed, false);
  assert.equal(limiter.take('a', 200).retryAfterSeconds, 1);
  assert.equal(limiter.take('a', 1000).allowed, true);
});

test('公开部署请求限额保护免费订单接口', async t => {
  await createPortfolioTestSchema();
  process.env.PAYMENT_MODE = 'disabled';
  process.env.DEPLOYMENT_ENV = 'local';
  const { runtime } = await import('../src/index.js');
  await migrate(runtime.db);
  const limited = new Application(runtime.db, {
    ...runtime.config,
    PUBLIC_DEPLOYMENT: true,
    DEPLOYMENT_ENV: 'staging',
    PUBLIC_RATE_LIMIT_PER_MINUTE: 3,
    PUBLIC_ORDER_LIMIT_PER_HOUR: 1,
    PAYMENT_MODE: 'disabled',
  });
  const app = createHttp(limited);
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    (server as unknown as { closeAllConnections(): void }).closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await runtime.db.close();
  });

  const agent = await fetch(`${base}/api/collaboration/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Limits buyer' }),
  });
  assert.equal(agent.status, 201);
  const buyer = await agent.json() as { credential: string };

  const order = (ip: string) => fetch(`${base}/api/commerce/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${buyer.credential}`, 'Content-Type': 'application/json', 'X-Forwarded-For': ip,
    },
    body: JSON.stringify({ serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT }),
  });
  const first = await order('203.0.113.10');
  assert.equal(first.status, 201, await first.text());
  const second = await order('203.0.113.10');
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get('retry-after')) > 0);
  assert.equal((await second.json() as { error: { code: string } }).error.code, 'RATE_LIMITED');

  const read = (ip: string, token?: string) => fetch(`${base}/api/commerce`, {
    headers: { 'X-Forwarded-For': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  for (let index = 0; index < 3; index += 1) assert.equal((await read('203.0.113.20')).status, 200);
  const throttled = await read('203.0.113.20');
  assert.equal(throttled.status, 429);
  assert.equal((await throttled.json() as { error: { code: string } }).error.code, 'RATE_LIMITED');
  assert.equal((await read('203.0.113.20', runtime.config.ADMIN_TOKEN)).status, 200);
});
