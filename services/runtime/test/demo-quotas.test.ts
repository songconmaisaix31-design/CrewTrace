import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test, { after } from 'node:test';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Application } from '../src/application.js';
import { createHttp } from '../src/http.js';
import { migrate } from '../src/migrate.js';
import { runtime } from '../src/index.js';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';

const INPUT = 'record_id,amount_cents\nitem-a,10\n';

const PUBLIC = {
  PUBLIC_DEPLOYMENT: true,
  DEPLOYMENT_ENV: 'staging' as const,
  PROXY_TRUST_MODE: 'cidr' as const,
  TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
  PUBLIC_RATE_LIMIT_PER_MINUTE: 1000,
  PUBLIC_ORDER_LIMIT_PER_HOUR: 1000,
  PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE: 1000,
  DEMO_AGENT_REGISTRATIONS_PER_IP_DAY: 100,
  DEMO_MAX_ACTIVE_ORDERS: 100,
  DEMO_GLOBAL_ORDERS_PER_DAY: 100,
  DEMO_IP_ORDERS_PER_DAY: 100,
  DEMO_AGENT_ORDERS_PER_DAY: 100,
  DEMO_MAX_INPUT_ROWS: 2000,
};

async function withApp(overrides: Record<string, unknown>, run: (context: { base: string; app: Application }) => Promise<void>) {
  const app = new Application(runtime.db, { ...runtime.config, ...PUBLIC, ...overrides } as typeof runtime.config);
  const server = serve({ fetch: createHttp(app).fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  app.config.PUBLIC_BASE_URL = base;
  app.config.PUBLIC_MCP_URL = `${base}/mcp`;
  try {
    await run({ base, app });
  } finally {
    (server as unknown as { closeAllConnections(): void }).closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

/** 两个独立 Application 各持连接池，等价于两个 Runtime 进程共享同一数据库。 */
async function withApps(count: number, overrides: Record<string, unknown>, run: (context: { bases: string[]; apps: Application[] }) => Promise<void>) {
  const apps = Array.from({ length: count }, () => new Application(runtime.db, { ...runtime.config, ...PUBLIC, ...overrides } as typeof runtime.config));
  const servers = apps.map(app => serve({ fetch: createHttp(app).fetch, hostname: '127.0.0.1', port: 0 }));
  for (const server of servers) if (!server.listening) await once(server, 'listening');
  const bases = servers.map((server, index) => {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    apps[index].config.PUBLIC_BASE_URL = base;
    apps[index].config.PUBLIC_MCP_URL = `${base}/mcp`;
    return base;
  });
  try {
    await run({ bases, apps });
  } finally {
    for (const server of servers) {
      (server as unknown as { closeAllConnections(): void }).closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
}

async function reset(): Promise<void> {
  await runtime.db.pool.query('DELETE FROM demo_usage_counters');
  await runtime.db.pool.query("UPDATE runtime_settings SET value='{\"paused\":false}'::jsonb WHERE key='demo_pause'");
  await runtime.db.pool.query("UPDATE commerce_orders SET status='COMPLETED' WHERE status IN ('READY','IN_PROGRESS')");
}

async function register(base: string, name: string, ip: string): Promise<{ agentId: string; credential: string }> {
  const response = await fetch(`${base}/api/collaboration/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ name }),
  });
  const text = await response.text();
  assert.equal(response.status, 201, text);
  return JSON.parse(text) as { agentId: string; credential: string };
}

function order(base: string, credential: string, ip: string, input = INPUT, idempotencyKey = randomUUID()) {
  return fetch(`${base}/api/commerce/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey, inputCsv: input }),
  });
}

test.before(async () => { await createPortfolioTestSchema(); await migrate(runtime.db); });
after(async () => { await runtime.db.close(); });

test('并发订单在数据库全局额度下原子收敛', async () => {
  await reset();
  await withApp({ DEMO_GLOBAL_ORDERS_PER_DAY: 3 }, async ({ base }) => {
    const buyer = await register(base, 'Quota buyer', '198.51.100.1');
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => order(base, buyer.credential, `203.0.113.${index + 1}`)));
    const statuses = responses.map(response => response.status);
    assert.equal(statuses.filter(status => status === 201).length, 3, JSON.stringify(statuses));
    assert.equal(statuses.filter(status => status === 429).length, 5, JSON.stringify(statuses));
    for (const response of responses.filter(item => item.status === 429)) {
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'DEMO_QUOTA_EXCEEDED');
    }
  });
});

test('单地址订单额度独立计数', async () => {
  await reset();
  await withApp({ DEMO_IP_ORDERS_PER_DAY: 2 }, async ({ base }) => {
    const buyer = await register(base, 'IP quota buyer', '198.51.100.2');
    const first = await order(base, buyer.credential, '203.0.113.20');
    const second = await order(base, buyer.credential, '203.0.113.20');
    const third = await order(base, buyer.credential, '203.0.113.20');
    assert.deepEqual([first.status, second.status, third.status], [201, 201, 429]);
    assert.equal((await third.json() as { error: { details: { scope: string } } }).error.details.scope, 'order:ip');
  });
});

test('暂停开关拒绝新订单并可恢复', async () => {
  await reset();
  await withApp({}, async ({ base, app }) => {
    const buyer = await register(base, 'Pause buyer', '198.51.100.3');
    const pause = await fetch(`${base}/admin/demo/pause`, {
      method: 'POST', headers: { Authorization: `Bearer ${app.config.ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(pause.status, 200);
    const blocked = await order(base, buyer.credential, '203.0.113.30');
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json() as { error: { code: string } }).error.code, 'DEMO_PAUSED');
    const resume = await fetch(`${base}/admin/demo/pause`, {
      method: 'POST', headers: { Authorization: `Bearer ${app.config.ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: false }),
    });
    assert.equal(resume.status, 200);
    assert.equal((await order(base, buyer.credential, '203.0.113.30')).status, 201);
  });
});

test('同时执行上限在创建订单前生效', async () => {
  await reset();
  await withApp({ DEMO_MAX_ACTIVE_ORDERS: 1 }, async ({ base }) => {
    const buyer = await register(base, 'Capacity buyer', '198.51.100.4');
    assert.equal((await order(base, buyer.credential, '203.0.113.40')).status, 201);
    const second = await order(base, buyer.credential, '203.0.113.40');
    assert.equal(second.status, 503);
    assert.equal((await second.json() as { error: { code: string } }).error.code, 'DEMO_CAPACITY_REACHED');
  });
});

test('订单进入终态后释放执行容量', async () => {
  await reset();
  await withApp({ DEMO_MAX_ACTIVE_ORDERS: 1 }, async ({ base }) => {
    const buyer = await register(base, 'Release buyer', '198.51.100.12');
    assert.equal((await order(base, buyer.credential, '203.0.113.60')).status, 201);
    assert.equal((await order(base, buyer.credential, '203.0.113.60')).status, 503);
    await runtime.db.pool.query("UPDATE commerce_orders SET status='COMPLETED' WHERE status IN ('READY','IN_PROGRESS')");
    assert.equal((await order(base, buyer.credential, '203.0.113.60')).status, 201);
  });
});

test('50 个并发请求跨两个连接池不突破执行容量上限', async () => {
  await reset();
  await withApps(2, { DEMO_MAX_ACTIVE_ORDERS: 10 }, async ({ bases }) => {
    const buyer = await register(bases[0], 'Stress buyer', '198.51.100.8');
    const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => order(
      bases[index % 2], buyer.credential, `203.0.113.${100 + index}`,
    )));
    const statuses = responses.map(response => response.status);
    assert.equal(statuses.filter(status => status === 201).length, 10, JSON.stringify(statuses));
    assert.equal(statuses.filter(status => status === 503).length, 40, JSON.stringify(statuses));
    for (const response of responses.filter(item => item.status === 503)) {
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'DEMO_CAPACITY_REACHED');
    }
    const active = (await runtime.db.pool.query(
      "SELECT count(*)::int AS count FROM commerce_orders WHERE status IN ('READY','IN_PROGRESS')",
    )).rows[0].count;
    assert.equal(active, 10);
    const counters = (await runtime.db.pool.query("SELECT scope,bucket,used FROM demo_usage_counters")).rows;
    assert.equal(Number(counters.find(row => row.scope === 'order:global')?.used ?? 0), 10);
  });
});

test('幂等重放不重复消耗额度，超限时额度递增整体回滚', async () => {
  await reset();
  await withApp({ DEMO_IP_ORDERS_PER_DAY: 1, DEMO_GLOBAL_ORDERS_PER_DAY: 50 }, async ({ base }) => {
    const buyer = await register(base, 'Replay buyer', '198.51.100.9');
    const key = randomUUID();
    const first = await order(base, buyer.credential, '203.0.113.200', INPUT, key);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { orderId: string };
    const replay = await order(base, buyer.credential, '203.0.113.200', INPUT, key);
    assert.equal(replay.status, 201);
    assert.equal((await replay.json() as { orderId: string }).orderId, firstBody.orderId);
    const globalAfterReplay = (await runtime.db.pool.query(
      "SELECT used FROM demo_usage_counters WHERE scope='order:global'",
    )).rows[0]?.used;
    assert.equal(Number(globalAfterReplay), 1);
    const blocked = await order(base, buyer.credential, '203.0.113.200');
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json() as { error: { details: { scope: string } } }).error.details.scope, 'order:ip');
    const globalAfterBlocked = (await runtime.db.pool.query(
      "SELECT used FROM demo_usage_counters WHERE scope='order:global'",
    )).rows[0]?.used;
    assert.equal(Number(globalAfterBlocked), 1);
    const orders = (await runtime.db.pool.query(
      'SELECT count(*)::int AS count FROM commerce_orders WHERE idempotency_key=$1', [key],
    )).rows[0].count;
    assert.equal(orders, 1);
  });
});

test('输入行数超过公开上限时拒绝', async () => {
  await reset();
  await withApp({ DEMO_MAX_INPUT_ROWS: 1 }, async ({ base }) => {
    const buyer = await register(base, 'Rows buyer', '198.51.100.5');
    const response = await order(base, buyer.credential, '203.0.113.50', 'record_id,amount_cents\nitem-a,10\nitem-b,20\n');
    assert.equal(response.status, 422);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'INPUT_TOO_LARGE');
  });
});

test('公开部署拒绝非管理员的协作任务写入，MCP 隐藏高成本工具', async () => {
  await reset();
  await withApp({}, async ({ base }) => {
    const buyer = await register(base, 'Read only buyer', '198.51.100.6');
    const blocked = await fetch(`${base}/api/collaboration/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer.credential}`, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.60' },
      body: '{}',
    });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json() as { error: { code: string } }).error.code, 'PUBLIC_DEMO_READ_ONLY');

    const client = new Client({ name: 'rc3-public-tools', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      const names = new Set((await client.listTools()).tools.map(tool => tool.name));
      assert.ok(names.has('join_collaboration'));
      assert.ok(names.has('list_service_catalog'));
      assert.ok(!names.has('create_collaboration_task'));
      assert.ok(!names.has('create_run'));
      assert.ok(!names.has('submit_collaboration_handoff'));
    } finally { await client.close(); }
  });
});

test('伪造代理头不能绕过限流，可信代理的不同客户端独立计数', async () => {
  await reset();
  await withApp({ PROXY_TRUST_MODE: 'none', PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE: 2 }, async ({ base }) => {
    const read = (ip: string) => fetch(`${base}/api/collaboration`, { headers: { 'X-Forwarded-For': ip } });
    assert.equal((await read('203.0.113.71')).status, 200);
    assert.equal((await read('203.0.113.72')).status, 200);
    const blocked = await read('203.0.113.73');
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json() as { error: { code: string } }).error.code, 'RATE_LIMITED');
  });
  await withApp({ PROXY_TRUST_MODE: 'cidr', TRUSTED_PROXY_CIDRS: '127.0.0.1/32', PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE: 1 }, async ({ base }) => {
    const read = (ip: string) => fetch(`${base}/api/collaboration`, { headers: { 'X-Forwarded-For': ip } });
    assert.equal((await read('203.0.113.81')).status, 200);
    assert.equal((await read('203.0.113.82')).status, 200);
    assert.equal((await read('203.0.113.81')).status, 429);
  });
});

test('管理端可观测数据包含订单、Worker 与额度', async () => {
  await reset();
  await withApp({}, async ({ base, app }) => {
    const buyer = await register(base, 'Ops buyer', '198.51.100.7');
    assert.equal((await order(base, buyer.credential, '203.0.113.90')).status, 201);
    const response = await fetch(`${base}/admin/demo`, { headers: { Authorization: `Bearer ${app.config.ADMIN_TOKEN}` } });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      deployment: { paused: boolean; publicDeployment: boolean };
      orders: { total: number; today: number; byStatus: Record<string, number> };
      workers: { configured: number; online: number };
      quotas: { limits: { globalOrdersPerDay: number }; usage: { scope: string; used: number }[] };
    };
    assert.equal(body.deployment.publicDeployment, true);
    assert.equal(body.deployment.paused, false);
    assert.ok(body.orders.today >= 1);
    assert.ok(body.orders.total >= 1);
    assert.equal(typeof body.workers.configured, 'number');
    assert.equal(body.quotas.limits.globalOrdersPerDay, 100);
    assert.ok(body.quotas.usage.some(item => item.scope === 'order:global' && item.used >= 1));
  });
});
