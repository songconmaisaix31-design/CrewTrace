import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { migrate } from '../src/migrate.js';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';
import { Application } from '../src/application.js';
import { tokenHash, type Principal } from '../src/auth.js';
import { Commerce } from '../src/commerce.js';
import { loadConfig } from '../src/config.js';
import { normalizedDelivery } from '../src/csv-workflow.js';
import {
  ALIPAY_AMOUNT_LIMIT_FEN, alipayPayBefore, alipayPrecreateBiz, AlipayPayment, DisabledPayment,
  resolveOfficialServiceId, SimulatedPayment,
} from '../src/payment.js';
import { verifyCsvDelivery } from '../../../workers/src/csv-delivery.ts';
import { DEFAULT_CSV_SAMPLE } from '../../../apps/web/src/commerce-sample.ts';

const INPUT = 'record_id,amount_cents\n item-a , 10 \nitem-a,10\n';

test('支付预下单并发、恢复、隔离与 402 协议', async t => {
  await createPortfolioTestSchema();
  process.env.PAYMENT_MODE = 'simulated';
  process.env.PAYMENT_SIMULATION_SECRET = 'commerce-payment-secret-0123456789abcdef';
  const { default: app, runtime } = await import('../src/index.js');
  await migrate(runtime.db);
  await migrate(runtime.db);
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

  async function collaboration(path: string, body: unknown, status = 200) {
    const response = await fetch(`${base}/api/collaboration${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text);
  }
  async function commerce(path: string, credential?: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, status = 200) {
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const response = await fetch(`${base}/api/commerce${path}`, {
      method,
      headers: { ...(credential && { Authorization: `Bearer ${credential}` }), ...(options.body !== undefined && { 'Content-Type': 'application/json' }), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const record = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, text);
    return { record, headers: response.headers };
  }
  const buyer = await collaboration('/agents', { name: 'Payment buyer' }, 201);
  const principal: Principal = { kind: 'collaborator', agentId: buyer.agent.agentId, credentialId: tokenHash(buyer.credential) };
  const order = (await commerce('/orders', buyer.credential, {
    body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT },
  }, 201)).record as { orderId: string };

  await t.test('官方字段映射与模拟/生产模式隔离', () => {
    const biz = alipayPrecreateBiz({
      orderReference: 'a'.repeat(32), officialServiceId: 'API2094383984',
      title: 'CSV 数据清洗与校验', amountFen: 100, payBefore: '2026-11-22T15:31:31+08:00',
    });
    assert.deepEqual(biz, {
      out_trade_no: 'a'.repeat(32), service_id: 'API2094383984', goods_name: 'CSV 数据清洗与校验',
      amount: '1.00', currency: 'CNY', pay_before: '2026-11-22T15:31:31+08:00',
    });
    assert.equal('serviceId' in biz, false);
    assert.equal(alipayPayBefore(new Date('2026-11-22T07:31:31Z')), '2026-11-22T15:31:31+08:00');
    assert.match(alipayPayBefore(new Date()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    assert.equal(resolveOfficialServiceId({ 'csv-clean-verify': 'API2094383984' }, 'csv-clean-verify'), 'API2094383984');
    assert.throws(() => resolveOfficialServiceId({}, 'csv-clean-verify'), (error: { code?: string }) => error.code === 'PAYMENT_SERVICE_UNMAPPED');
    assert.throws(() => alipayPrecreateBiz({
      orderReference: 'a'.repeat(32), officialServiceId: 'API2094383984', title: 't',
      amountFen: ALIPAY_AMOUNT_LIMIT_FEN + 1, payBefore: '2026-11-22T15:31:31+08:00',
    }), (error: { code?: string }) => error.code === 'PAYMENT_AMOUNT_LIMIT');
    assert.throws(() => alipayPrecreateBiz({
      orderReference: 'a'.repeat(33), officialServiceId: 'API2094383984', title: 't',
      amountFen: 100, payBefore: '2026-11-22T15:31:31+08:00',
    }), (error: { code?: string }) => error.code === 'PAYMENT_FIELD_INVALID');
    const saved = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(() => new SimulatedPayment('commerce-payment-secret-0123456789abcdef'));
      process.env.PAYMENT_MODE = 'simulated';
      process.env.PAYMENT_SIMULATION_SECRET = 'commerce-payment-secret-0123456789abcdef';
      assert.throws(() => loadConfig());
      process.env.PAYMENT_MODE = 'sandbox';
      process.env.ALIPAY_APP_ID = '2021000000000000';
      process.env.ALIPAY_PRIVATE_KEY = 'private';
      process.env.ALIPAY_PUBLIC_KEY = 'public';
      delete process.env.ALIPAY_SERVICE_IDS;
      assert.throws(() => loadConfig());
      process.env.ALIPAY_SERVICE_IDS = JSON.stringify({ 'csv-clean-verify': 'API2094383984' });
      const sandbox = loadConfig();
      assert.equal(sandbox.ALIPAY_SERVICE_IDS, process.env.ALIPAY_SERVICE_IDS);
      assert.ok(new AlipayPayment('sandbox', sandbox));
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  await t.test('并发预下单与并发验付只产生一条活动支付和一个工作流', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, async () => commerce(`/orders/${order.orderId}/payment`, buyer.credential, { method: 'POST', body: {} })));
    const bodies = results.map(result => result.record as { prepay: { prepayId: string }; paymentLink: string; simulatedProof: string; amountFen: number });
    assert.equal(new Set(bodies.map(body => body.prepay.prepayId)).size, 1);
    assert.equal(new Set(bodies.map(body => body.paymentLink)).size, 1);
    assert.equal(bodies[0]!.amountFen, 100);
    assert.equal(results[0]!.headers.get('amtPaymentLink'), bodies[0]!.paymentLink);
    const active = await runtime.db.pool.query(
      "SELECT count(*)::int AS count FROM commerce_payments WHERE order_id=$1 AND status IN ('PREPARING','PENDING')", [order.orderId],
    );
    assert.equal(active.rows[0].count, 1);
    const total = await runtime.db.pool.query('SELECT count(*)::int AS count FROM commerce_payments WHERE order_id=$1', [order.orderId]);
    assert.equal(total.rows[0].count, 1);

    const headers = bodies[0]!.simulatedProof;
    const proofs = await Promise.all(Array.from({ length: 5 }, async () =>
      commerce(`/orders/${order.orderId}/payment-proof`, buyer.credential, { method: 'POST', headers: { 'Payment-Proof': headers } })));
    assert.deepEqual(proofs.map(result => (result.record as { status: string }).status), Array(5).fill('VERIFIED'));
    const paid = (await commerce(`/orders/${order.orderId}`, buyer.credential)).record as { status: string; execution: { taskId: string } };
    assert.equal(paid.status, 'IN_PROGRESS');
    const workflows = await runtime.db.pool.query('SELECT count(*)::int AS count FROM experiment_csv_workflows WHERE task_id=$1', [paid.execution.taskId]);
    assert.equal(workflows.rows[0].count, 1);
    const verified = await runtime.db.pool.query("SELECT count(*)::int AS count FROM commerce_payments WHERE order_id=$1 AND status='VERIFIED'", [order.orderId]);
    assert.equal(verified.rows[0].count, 1);
  });

  await t.test('HTTP 402 返回 amtPaymentLink，携带 Payment-Proof 可直接访问资源', async () => {
    const unpaid = (await commerce('/orders', buyer.credential, {
      body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT },
    }, 201)).record as { orderId: string };
    const denied = await commerce(`/orders/${unpaid.orderId}/delivery`, buyer.credential, {}, 402);
    const link = denied.headers.get('amtPaymentLink');
    assert.ok(link);
    const detail = denied.record.error.details.payment as { amountFen: number; simulated: boolean; simulatedProof: string; paymentLink: string };
    assert.equal(detail.amountFen, 100);
    assert.equal(detail.simulated, true);
    assert.equal(detail.paymentLink, link);
    assert.equal(typeof detail.simulatedProof, 'string');

    const execution = await commerce(`/orders/${unpaid.orderId}/execution`, buyer.credential, { headers: { 'Payment-Proof': detail.simulatedProof } });
    assert.equal((execution.record as { status: string }).status, 'QUEUED');
    await commerce(`/orders/${unpaid.orderId}/delivery`, buyer.credential, { headers: { 'Payment-Proof': detail.simulatedProof } }, 404);
    const paid = (await commerce(`/orders/${unpaid.orderId}`, buyer.credential)).record as { status: string };
    assert.equal(paid.status, 'IN_PROGRESS');
  });

  await t.test('本地已过期但支付宝确认已付款时仍可完成验付', async () => {
    const late = (await commerce('/orders', buyer.credential, {
      body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT },
    }, 201)).record as { orderId: string };
    const prepared = (await commerce(`/orders/${late.orderId}/payment`, buyer.credential, { method: 'POST', body: {} })).record as { simulatedProof: string };
    await runtime.db.pool.query(
      `UPDATE commerce_payments SET status='EXPIRED',
         document=jsonb_set(jsonb_set(document,'{status}','"EXPIRED"'),'{expiresAt}','"2020-01-01T00:00:00.000Z"')
       WHERE order_id=$1`, [late.orderId],
    );
    const expired = (await commerce(`/orders/${late.orderId}`, buyer.credential)).record as { status: string; payment: { status: string; payable: boolean } };
    assert.equal(expired.status, 'AWAITING_PAYMENT');
    assert.equal(expired.payment.status, 'EXPIRED');
    assert.equal(expired.payment.payable, true);
    const proof = (await commerce(`/orders/${late.orderId}/payment-proof`, buyer.credential, {
      method: 'POST', headers: { 'Payment-Proof': prepared.simulatedProof },
    })).record as { status: string };
    assert.equal(proof.status, 'VERIFIED');
    assert.equal(((await commerce(`/orders/${late.orderId}`, buyer.credential)).record as { status: string }).status, 'IN_PROGRESS');
  });

  await t.test('预下单未落库的陈旧 PREPARING 记录会被关闭并重新预下单', async () => {
    const stale = (await commerce('/orders', buyer.credential, {
      body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT },
    }, 201)).record as { orderId: string };
    const first = (await commerce(`/orders/${stale.orderId}/payment`, buyer.credential, { method: 'POST', body: {} })).record as { prepay: { prepayId: string } };
    await runtime.db.pool.query(
      `UPDATE commerce_payments SET status='PREPARING',provider_trade_no=NULL,created_at=now()-interval '10 minutes',
         document=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(document,'{status}','"PREPARING"'),
           '{prepayId}','null'),'{providerTradeNo}','null'),'{binding}','null'),'{createdAt}','"2020-01-01T00:00:00.000Z"')
       WHERE order_id=$1 AND status='PENDING'`, [stale.orderId],
    );
    const retried = (await commerce(`/orders/${stale.orderId}/payment`, buyer.credential, { method: 'POST', body: {} })).record as { status: string; prepay: { prepayId: string } };
    assert.equal(retried.status, 'PENDING');
    assert.notEqual(retried.prepay.prepayId, first.prepay.prepayId);
    const rows = await runtime.db.pool.query('SELECT status,count(*)::int AS count FROM commerce_payments WHERE order_id=$1 GROUP BY status ORDER BY status', [stale.orderId]);
    assert.deepEqual(rows.rows, [{ status: 'FAILED', count: 1 }, { status: 'PENDING', count: 1 }]);
  });

  await t.test('支付凭证不能跨支付模式使用', async () => {
    const fresh = (await commerce('/orders', buyer.credential, {
      body: { serviceId: 'csv-clean-verify', expectedServiceVersion: 1, idempotencyKey: randomUUID(), inputCsv: INPUT },
    }, 201)).record as { orderId: string };
    const prepared = (await commerce(`/orders/${fresh.orderId}/payment`, buyer.credential, { method: 'POST', body: {} })).record as { simulatedProof: string };
    const disabled = new Commerce(new Application(runtime.db, { ...runtime.config, PAYMENT_MODE: 'disabled' }), new DisabledPayment());
    await assert.rejects(
      () => disabled.submitPaymentProof(principal, fresh.orderId, prepared.simulatedProof),
      (error: { status?: number; code?: string }) => error.status === 409 && error.code === 'PAYMENT_MODE_MISMATCH',
    );
  });

  await t.test('Web 默认 CSV 示例可以通过清洗与校验', () => {
    const cleaned = normalizedDelivery(DEFAULT_CSV_SAMPLE);
    assert.equal(verifyCsvDelivery(cleaned).status, 'PASS');
    assert.equal(cleaned, 'record_id,amount_cents\nitem-a,10\nitem-b,25\nitem-c,7\n');
  });
});
