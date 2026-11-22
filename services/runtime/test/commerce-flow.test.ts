import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { migrate } from '../src/migrate.js';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';
import { Application } from '../src/application.js';
import { tokenHash, type Principal } from '../src/auth.js';
import { Commerce } from '../src/commerce.js';
import { DisabledPayment } from '../src/payment.js';

const INPUT = 'record_id,amount_cents\n item-a , 10 \nitem-a,10\n';

test('商业闭环：服务目录、订单、模拟支付、三 Agent 履约、交付验收与失败隔离', async t => {
  await createPortfolioTestSchema();
  process.env.PAYMENT_MODE = 'simulated';
  process.env.PAYMENT_SIMULATION_SECRET = 'commerce-test-simulation-secret-0123456789';
  process.env.PAYMENT_SIMULATED_ACK = 'local-only';
  process.env.DEPLOYMENT_ENV = 'local';
  const { default: app, runtime } = await import('../src/index.js');
  await migrate(runtime.db);
  await migrate(runtime.db); // 迁移必须可重复执行
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  runtime.config.PUBLIC_BASE_URL = base;
  t.after(async () => {
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
  async function commerce(path: string, credential?: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, status = 200) {
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const response = await fetch(`${base}/api/commerce${path}`, {
      method, headers: { ...(credential && { Authorization: `Bearer ${credential}` }), ...(options.body !== undefined && { 'Content-Type': 'application/json' }), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const record = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, text);
    return record;
  }
  const join = (name: string, capabilities: string[] = []) => collaboration('/agents', undefined, { name, capabilities }, 201);

  const buyer = await join('Commerce buyer');
  const intruder = await join('Commerce intruder');
  const workers = await Promise.all([
    join('Commerce inspector', ['csv-source-inspection']),
    join('Commerce cleaner', ['csv-data-review']),
    join('Commerce reporter', ['csv-evidence-report']),
  ]);
  runtime.config.EXPERIMENT_WORKER_AGENT_IDS = workers.map(worker => worker.agent.agentId).join(',');

  const catalog = await commerce('/services');
  assert.equal(catalog.paymentMode, 'simulated');
  assert.equal(catalog.officialPayment, false);
  assert.equal(catalog.deploymentEnv, 'local');
  assert.equal(catalog.publicDeployment, false);
  assert.deepEqual(catalog.services.map((service: { serviceId: string }) => service.serviceId), ['csv-clean-verify', 'csv-clean-verify-free']);
  assert.equal(catalog.services[0].priceFen, 100);
  assert.equal(catalog.services[0].currency, 'CNY');

  const idempotencyKey = randomUUID();
  const first = await commerce('/orders', buyer.credential, { body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey, inputCsv: INPUT } }, 201);
  assert.equal(first.status, 'AWAITING_PAYMENT');
  assert.equal(first.quote.priceFen, 100);
  assert.equal(first.payment.status, 'UNPAID');
  assert.equal(first.payment.payable, true);
  const repeat = await commerce('/orders', buyer.credential, { body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey, inputCsv: INPUT } }, 201);
  assert.equal(repeat.orderId, first.orderId);
  const conflict = await commerce('/orders', buyer.credential, { body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey, inputCsv: 'record_id,amount_cents\nitem-b,20\n' } }, 409);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
  await commerce(`/orders/${first.orderId}`, intruder.credential, {}, 403);
  await commerce(`/orders/${first.orderId}/delivery`, buyer.credential, {}, 402);
  await commerce(`/orders/${first.orderId}/execution`, buyer.credential, {}, 402);

  const prepay = await commerce(`/orders/${first.orderId}/payment`, buyer.credential, { method: 'POST', body: {} });
  assert.equal(prepay.status, 'PENDING');
  assert.equal(prepay.simulated, true);
  assert.match(prepay.simulatedProof, /^[A-Za-z0-9+/=]+$/);
  assert.doesNotMatch(JSON.stringify(prepay), /binding|proof_hash/);
  const proof = await commerce(`/orders/${first.orderId}/payment-proof`, buyer.credential, { method: 'POST', headers: { 'Payment-Proof': prepay.simulatedProof } });
  assert.equal(proof.status, 'VERIFIED');
  assert.equal(proof.official, false);
  const paid = await commerce(`/orders/${first.orderId}`, buyer.credential);
  assert.equal(paid.status, 'IN_PROGRESS');
  assert.ok(paid.execution.taskId);
  assert.equal(paid.execution.workflowVersion, 'csv-workflow-v1');
  const replay = await commerce(`/orders/${first.orderId}/payment-proof`, buyer.credential, { method: 'POST', headers: { 'Payment-Proof': prepay.simulatedProof } });
  assert.equal(replay.status, 'VERIFIED');
  const afterReplay = await commerce(`/orders/${first.orderId}`, buyer.credential);
  assert.equal(afterReplay.execution.taskId, paid.execution.taskId);
  assert.doesNotMatch(JSON.stringify(afterReplay), /proof_hash|binding/);

  const other = await commerce('/orders', buyer.credential, { body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: 'record_id,amount_cents\nitem-c,30\n' } }, 201);
  await commerce(`/orders/${other.orderId}/payment`, buyer.credential, { method: 'POST', body: {} });
  const crossOrder = await commerce(`/orders/${other.orderId}/payment-proof`, buyer.credential, { method: 'POST', headers: { 'Payment-Proof': prepay.simulatedProof } }, 402);
  assert.equal(crossOrder.error.code, 'PAYMENT_MISMATCH');
  const untouched = await commerce(`/orders/${other.orderId}`, buyer.credential);
  assert.equal(untouched.status, 'AWAITING_PAYMENT');

  const free = await commerce('/orders', buyer.credential, { body: { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT } }, 201);
  assert.equal(free.status, 'IN_PROGRESS');
  assert.equal(free.payment.status, 'NOT_REQUIRED');
  assert.ok(free.execution.taskId);

  function work(agent: { credential: string }) {
    const path = fileURLToPath(new URL('../../../workers/', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/portfolio-worker.ts', '--once'], {
      cwd: path, env: { PATH: process.env.PATH, CREWTRACE_WORKER_RUNTIME: base, CREWTRACE_WORKER_CREDENTIAL: agent.credential },
    });
    return once(child, 'exit').then(([code]) => assert.equal(code, 0));
  }
  async function drive(orderId: string) {
    for (let round = 0; round < 15; round += 1) {
      await Promise.all(workers.map(work));
      const order = await commerce(`/orders/${orderId}`, buyer.credential);
      if (['DELIVERED', 'FAILED'].includes(order.status)) return order;
    }
    assert.fail(`订单 ${orderId} 未在预期轮次内完成`);
  }

  const freeDelivered = await drive(free.orderId);
  assert.equal(freeDelivered.status, 'DELIVERED');
  assert.equal(freeDelivered.execution.status, 'COMPLETED');
  assert.deepEqual(freeDelivered.execution.steps.map((step: { status: string }) => step.status), ['COMPLETED', 'COMPLETED', 'COMPLETED']);
  assert.ok(freeDelivered.deliveryId);
  const download = await commerce(`/orders/${free.orderId}/delivery`, buyer.credential);
  assert.match(download.contentHash, /^0x[0-9a-f]{64}$/);
  assert.equal(download.content, 'record_id,amount_cents\nitem-a,10\n');
  const accepted = await commerce(`/orders/${free.orderId}/acceptance`, buyer.credential, { body: { decision: 'ACCEPTED', rating: 5, comment: '结果与规则一致' } }, 201);
  assert.equal(accepted.decision, 'ACCEPTED');
  assert.equal(accepted.reputation.length, 3);
  assert.equal(accepted.reputation.find((item: { role: string }) => item.role === 'csv-data-review').source, 'DETERMINISTIC_REVIEW');
  const acceptedOrder = await commerce(`/orders/${free.orderId}`, buyer.credential);
  assert.equal(acceptedOrder.status, 'ACCEPTED');
  const duplicateAcceptance = await commerce(`/orders/${free.orderId}/acceptance`, buyer.credential, { body: { decision: 'DECLINED', rating: null, comment: null } }, 409);
  assert.equal(duplicateAcceptance.error.code, 'ALREADY_ACCEPTED');

  const paidDelivered = await drive(first.orderId);
  assert.equal(paidDelivered.status, 'DELIVERED');
  const declined = await commerce(`/orders/${first.orderId}/acceptance`, buyer.credential, { body: { decision: 'DECLINED', rating: 2, comment: '需要调整列名' } }, 201);
  assert.equal(declined.decision, 'DECLINED');
  assert.equal((await commerce(`/orders/${first.orderId}`, buyer.credential)).status, 'DECLINED');

  const failing = await commerce('/orders', buyer.credential, { body: { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT } }, 201);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const worker = workers[0];
    const poll = await collaboration('/csv-worker/poll', worker.credential, {});
    assert.ok(poll.job, `第 ${attempt} 次轮询应分配步骤`);
    await collaboration(`/claims/${poll.job.claimId}/worker-failure`, worker.credential, {});
  }
  const failed = await commerce(`/orders/${failing.orderId}`, buyer.credential);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.execution.status, 'FAILED');
  assert.equal(failed.execution.failure.code, 'EXECUTION_FAILED');
  assert.equal(failed.deliveryId, null);
  await commerce(`/orders/${failing.orderId}/delivery`, buyer.credential, {}, 404);
  await commerce(`/orders/${failing.orderId}/acceptance`, buyer.credential, { body: { decision: 'ACCEPTED', rating: null, comment: null } }, 409);

  const mcp = new Client({ name: 'commerce-verification', version: '1.0.0' });
  try {
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp', base)));
    const tool = async (name: string, args: Record<string, unknown>) => {
      const result = await mcp.callTool({ name, arguments: args }) as { isError?: boolean; content: { type: string; text: string }[] };
      assert.notEqual(result.isError, true, result.content[0]?.text);
      return JSON.parse(result.content[0]!.text);
    };
    const remoteCatalog = await tool('list_service_catalog', {});
    assert.equal(remoteCatalog.services.length, 2);
    const remoteOrder = await tool('create_service_order', {
      credential: buyer.credential,
      request: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT },
    });
    assert.equal(remoteOrder.status, 'AWAITING_PAYMENT');
    const fetched = await tool('get_service_order', { credential: buyer.credential, orderId: remoteOrder.orderId });
    assert.equal(fetched.orderId, remoteOrder.orderId);
    const listed = await tool('list_service_orders', { credential: buyer.credential, limit: 20 });
    assert.ok(listed.orders.length >= 4);
    const remotePayment = await tool('request_service_payment', { credential: buyer.credential, orderId: remoteOrder.orderId });
    assert.equal(remotePayment.status, 'PENDING');
    assert.ok(remotePayment.paymentLink);
    assert.equal(remotePayment.simulated, true);
    const remoteProof = await tool('submit_service_payment', {
      credential: buyer.credential, orderId: remoteOrder.orderId, paymentProof: remotePayment.simulatedProof,
    });
    assert.equal(remoteProof.status, 'VERIFIED');
    const remotePaid = await tool('get_service_order', { credential: buyer.credential, orderId: remoteOrder.orderId });
    assert.equal(remotePaid.status, 'IN_PROGRESS');
    assert.equal(remotePaid.payment.status, 'VERIFIED');
    const delivery = await tool('get_service_delivery', { credential: buyer.credential, orderId: free.orderId });
    assert.equal(delivery.content, download.content);
    const mcpFree = await tool('create_service_order', {
      credential: buyer.credential,
      request: { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT },
    });
    assert.equal(mcpFree.status, 'IN_PROGRESS');
    const mcpDelivered = await drive(mcpFree.orderId);
    assert.equal(mcpDelivered.status, 'DELIVERED');
    const mcpAccepted = await tool('accept_service_delivery', {
      credential: buyer.credential, orderId: mcpFree.orderId, request: { decision: 'ACCEPTED', rating: 5, comment: 'MCP 验收' },
    });
    assert.equal(mcpAccepted.decision, 'ACCEPTED');
  } finally { await mcp.close(); }

  const disabledConfig = { ...runtime.config, PAYMENT_MODE: 'disabled' as const };
  const disabledApp = new Application(runtime.db, disabledConfig);
  const disabledCommerce = new Commerce(disabledApp, new DisabledPayment());
  const principal: Principal = { kind: 'collaborator', agentId: buyer.agent.agentId, credentialId: tokenHash(buyer.credential) };
  await assert.rejects(
    () => disabledCommerce.createOrder(principal, { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT }),
    (error: { status?: number; code?: string }) => error.status === 503 && error.code === 'PAYMENT_NOT_CONFIGURED',
  );
  const freeDisabled = await disabledCommerce.createOrder(principal, { serviceId: 'csv-clean-verify-free', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT });
  assert.equal(freeDisabled.payment.status, 'NOT_REQUIRED');
  assert.equal(freeDisabled.status, 'IN_PROGRESS');

  const records = await runtime.db.pool.query("SELECT count(*)::int AS count FROM commerce_services");
  assert.equal(records.rows[0].count, 2);
});
