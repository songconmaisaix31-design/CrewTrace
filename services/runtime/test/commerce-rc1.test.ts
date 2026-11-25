import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { migrate } from '../src/migrate.js';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';
import { Application } from '../src/application.js';
import { Database } from '../src/db.js';
import { createHttp } from '../src/http.js';
import { DEFAULT_CSV_SAMPLE } from '../../../apps/web/src/commerce-sample.ts';

const WORKER_DIR = fileURLToPath(new URL('../../../workers/', import.meta.url));

type OrderDetail = {
  orderId: string; status: string; deliveryId: string | null;
  payment: { status: string; simulated: boolean; deploymentEnv: string; mode: string; provider: string | null; verifiedAt: string | null };
  execution: { taskId: string; status: string; steps: Array<{ status: string; agentId: string; attempt: number | null }> };
};

test('RC1 免费演示：三个常驻 Worker、刷新恢复、停止重派与审计隔离', async t => {
  await createPortfolioTestSchema();
  const { default: app, runtime } = await import('../src/index.js');
  await migrate(runtime.db);
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  runtime.config.PUBLIC_BASE_URL = base;
  assert.equal(runtime.config.PAYMENT_MODE, 'disabled');

  const children: ChildProcess[] = [];
  const running = new Map<string, ChildProcess>();
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    (server as unknown as { closeAllConnections(): void }).closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await runtime.db.close();
  });

  async function collaboration(path: string, credential?: string, body?: unknown, status = 200) {
    const response = await fetch(`${base}/api/collaboration${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(credential && { Authorization: `Bearer ${credential}` }), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const record = await response.json();
    assert.equal(response.status, status, JSON.stringify(record));
    return record;
  }
  async function commerce(path: string, credential?: string, options: { method?: string; body?: unknown } = {}, status = 200) {
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const response = await fetch(`${base}/api/commerce${path}`, {
      method, headers: { ...(credential && { Authorization: `Bearer ${credential}` }), ...(options.body !== undefined && { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const record = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, text);
    return record;
  }
  const join = (name: string, capabilities: string[] = []) => collaboration('/agents', undefined, { name, capabilities }, 201);
  function workerIds(agents: Array<{ agent: { agentId: string } }>) {
    runtime.config.EXPERIMENT_WORKER_AGENT_IDS = agents.map(item => item.agent.agentId).join(',');
  }
  function start(agent: { agent: { agentId: string }; credential: string }) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/portfolio-worker.ts'], {
      cwd: WORKER_DIR,
      env: { PATH: process.env.PATH, CREWTRACE_WORKER_RUNTIME: base, CREWTRACE_WORKER_CREDENTIAL: agent.credential },
    });
    children.push(child);
    running.set(agent.agent.agentId, child);
  }
  async function stop(agentId: string) {
    const child = running.get(agentId);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.fail(`等待超时：${label}`);
  }
  async function waitPresence(agents: Array<{ agent: { agentId: string } }>) {
    const ids = agents.map(item => item.agent.agentId);
    await waitFor(async () => {
      const result = await runtime.db.pool.query('SELECT count(*)::int AS count FROM experiment_worker_presence WHERE agent_id::text = ANY($1::text[])', [ids]);
      return result.rows[0].count === ids.length;
    }, '三个 Worker 上报轮询状态');
  }
  async function waitStatus(orderId: string, credential: string, status: string) {
    let current: OrderDetail | null = null;
    await waitFor(async () => {
      current = await commerce(`/orders/${orderId}`, credential) as OrderDetail;
      return current.status === status;
    }, `订单 ${orderId} 进入 ${status}`);
    return current!;
  }

  const buyer = await join('RC1 buyer');
  const intruder = await join('RC1 intruder');
  const inspector = await join('RC1 inspector', ['csv-source-inspection']);
  const cleaner = await join('RC1 cleaner', ['csv-data-review']);
  const reporter = await join('RC1 reporter', ['csv-evidence-report']);
  workerIds([inspector, cleaner, reporter]);
  for (const agent of [inspector, cleaner, reporter]) start(agent);
  await waitPresence([inspector, cleaner, reporter]);

  const catalog = await commerce('/services');
  assert.equal(catalog.paymentMode, 'disabled');
  assert.equal(catalog.officialPayment, false);
  assert.equal(catalog.deploymentEnv, 'local');
  assert.equal(catalog.publicDeployment, false);
  assert.equal(catalog.services.find((item: { serviceId: string }) => item.serviceId === 'csv-clean-verify-free').priceFen, 0);
  const paymentStatus = await commerce('');
  assert.equal(paymentStatus.paymentMode, 'disabled');
  assert.equal(paymentStatus.simulatedPayment, false);

  const paidRejected = await commerce('/orders', buyer.credential, {
    body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: DEFAULT_CSV_SAMPLE },
  }, 503);
  assert.equal(paidRejected.error.code, 'PAYMENT_NOT_CONFIGURED');

  const idempotencyKey = randomUUID();
  const order = await commerce('/orders', buyer.credential, {
    body: { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey, inputCsv: DEFAULT_CSV_SAMPLE },
  }, 201);
  assert.equal(order.status, 'IN_PROGRESS');
  assert.equal(order.payment.status, 'NOT_REQUIRED');
  assert.equal(order.payment.simulated, false);
  assert.equal(order.payment.deploymentEnv, 'local');
  assert.ok(order.execution.taskId);

  const duplicate = await commerce('/orders', buyer.credential, {
    body: { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey, inputCsv: DEFAULT_CSV_SAMPLE },
  }, 201);
  assert.equal(duplicate.orderId, order.orderId);
  await commerce(`/orders/${order.orderId}`, intruder.credential, {}, 403);

  const delivered = await waitStatus(order.orderId, buyer.credential, 'DELIVERED');
  assert.equal(delivered.execution.status, 'COMPLETED');
  assert.deepEqual(delivered.execution.steps.map((step: { status: string }) => step.status), ['COMPLETED', 'COMPLETED', 'COMPLETED']);
  const agents = delivered.execution.steps.map((step: { agentId: string }) => step.agentId);
  assert.equal(new Set(agents).size, 3, '三个 CSV 角色必须由三个不同 Agent 执行');

  const delivery = await commerce(`/orders/${order.orderId}/delivery`, buyer.credential);
  const accepted = await commerce(`/orders/${order.orderId}/acceptance`, buyer.credential, { body: { decision: 'ACCEPTED', rating: 5, comment: 'RC1 免费演示验收' } }, 201);
  assert.equal(accepted.reputation.length, 3);

  // 多次刷新与页面关闭恢复：重复读取不产生新的工作流或交付记录。
  const counts = async () => {
    const result = await runtime.db.pool.query(`SELECT
      (SELECT count(*)::int FROM experiment_csv_workflows WHERE task_id=$1) AS workflows,
      (SELECT count(*)::int FROM commerce_deliveries WHERE order_id=$2) AS deliveries,
      (SELECT count(*)::int FROM commerce_orders WHERE id=$2) AS orders`, [order.execution.taskId, order.orderId]);
    return result.rows[0] as { workflows: number; deliveries: number; orders: number };
  };
  const before = await counts();
  for (let round = 0; round < 10; round += 1) {
    const refreshed = await commerce(`/orders/${order.orderId}`, buyer.credential);
    assert.equal(refreshed.execution.taskId, order.execution.taskId);
    assert.equal(refreshed.deliveryId, delivered.deliveryId);
  }
  await Promise.all(Array.from({ length: 10 }, () => commerce(`/orders/${order.orderId}`, buyer.credential)));
  assert.deepEqual(await counts(), before);

  const recoveredDb = new Database(runtime.config.DATABASE_URL);
  try {
    const recovered = createHttp(new Application(recoveredDb, runtime.config, null, null));
    const response = await recovered.request(`${base}/api/commerce/orders/${order.orderId}`, { headers: { Authorization: `Bearer ${buyer.credential}` } });
    assert.equal(response.status, 200);
    const reread = await response.json() as { orderId: string; status: string; deliveryId: string };
    assert.equal(reread.orderId, order.orderId);
    assert.equal(reread.status, 'ACCEPTED');
    assert.equal(reread.deliveryId, delivered.deliveryId);
  } finally { await recoveredDb.close(); }

  // 审计日志与接口响应不得泄漏管理密钥或协作凭证。
  const secrets = [runtime.config.ADMIN_TOKEN, buyer.credential, inspector.credential, cleaner.credential, reporter.credential];
  for (const [table, column, value] of [
    ['commerce_order_events', 'order_id', order.orderId],
    ['collaboration_events', 'task_id', order.execution.taskId],
  ] as const) {
    const rows = await runtime.db.pool.query(`SELECT document FROM ${table} WHERE ${column}=$1`, [value]);
    assert.ok(rows.rows.length > 0, `${table} 应保留审计记录`);
    const serialized = JSON.stringify(rows.rows);
    for (const secret of secrets) assert.ok(!serialized.includes(secret), `${table} 不得包含密钥`);
  }
  const detailText = JSON.stringify(await commerce(`/orders/${order.orderId}`, buyer.credential));
  for (const secret of secrets) assert.ok(!detailText.includes(secret), '订单响应不得包含密钥');

  // 停止一个常驻 Worker 后，新加入的同类 Worker 能接管后续订单。
  await stop(inspector.agent.agentId);
  const replacement = await join('RC1 replacement inspector', ['csv-source-inspection']);
  workerIds([cleaner, reporter, replacement]);
  start(replacement);
  const second = await commerce('/orders', buyer.credential, {
    body: { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: DEFAULT_CSV_SAMPLE },
  }, 201);
  const secondDelivered = await waitStatus(second.orderId, buyer.credential, 'DELIVERED');
  assert.equal(secondDelivered.execution.steps[0].agentId, replacement.agent.agentId, '停止后由新 Worker 执行第一项角色');

  // Worker 领取任务后停止：租期到期记为 TIMEOUT，新 Worker 接管同一步骤并完成订单。
  await stop(replacement.agent.agentId);
  await stop(cleaner.agent.agentId);
  await stop(reporter.agent.agentId);
  await new Promise(resolve => setTimeout(resolve, 300));
  const timedOut = await commerce('/orders', buyer.credential, {
    body: { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: DEFAULT_CSV_SAMPLE },
  }, 201);
  assert.ok(timedOut.execution.taskId);
  await runtime.db.pool.query('UPDATE experiment_csv_workflows SET lease_seconds=5 WHERE task_id=$1', [timedOut.execution.taskId]);
  const manual = await collaboration('/csv-worker/poll', replacement.credential, {});
  assert.ok(manual.job, '停止前应领取第一项角色');
  await new Promise(resolve => setTimeout(resolve, 5600));
  const takeover = await join('RC1 takeover inspector', ['csv-source-inspection']);
  workerIds([cleaner, reporter, takeover]);
  start(takeover);
  start(cleaner);
  start(reporter);
  const timedOutDelivered = await waitStatus(timedOut.orderId, buyer.credential, 'DELIVERED');
  assert.deepEqual(timedOutDelivered.execution.steps.map((step: { status: string }) => step.status), ['COMPLETED', 'COMPLETED', 'COMPLETED']);
  const attempts = await runtime.db.pool.query(
    `SELECT a.attempt, a.failure_code AS "failureCode", a.expired_at IS NOT NULL AS expired
     FROM experiment_csv_attempts a WHERE a.task_id=$1 AND a.step='csv-source-inspection' ORDER BY a.attempt`,
    [timedOut.execution.taskId],
  );
  assert.ok(attempts.rows.length >= 2, '超时后必须创建新的尝试');
  assert.equal(attempts.rows[0].failureCode, 'TIMEOUT');
  assert.equal(attempts.rows[0].expired, true);

  assert.equal(delivery.content, 'record_id,amount_cents\nitem-a,10\nitem-b,25\nitem-c,7\n');
});
