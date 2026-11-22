import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  AcceptanceRequestSchema, AcceptanceSchema, CollaborationHandoffSchema, CollaborationIdSchema,
  CollaborationTaskSchema, CollaborationVersionSchema, CommerceOrderStatusSchema, CommerceServiceSchema,
  CommerceServicesResponseSchema, CreateOrderRequestSchema, DeliveryDownloadSchema, DeliverySchema,
  ExecutionSummarySchema, OrderDetailSchema, OrderEventSchema, OrderFailureSchema, OrderQuerySchema,
  OrderSchema, OrdersResponseSchema, PaymentModeSchema, PaymentProofResponseSchema, PaymentProviderSchema,
  PaymentRequestResponseSchema, PaymentStatusSchema, PaymentSummarySchema, PrepaySchema, ServiceQuoteSchema,
  TimestampSchema, CountSchema, HashSchema, hashUtf8,
  type PaymentStatus,
} from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import type { Principal } from './auth.js';
import { collaborator } from './collaboration-store.js';
import { Collaboration } from './collaboration.js';
import { acceptedStep, CSV_STEPS, CSV_WORKFLOW_VERSION, normalizedDelivery, workflow } from './csv-workflow.js';
import { verifyCsvDelivery } from '../../../workers/src/csv-delivery.ts';
import { AppError, requireValue } from './errors.js';
import { decodePaymentProof, proofHash, type PaymentProvider } from './payment.js';

const SYSTEM_AGENT_ID = 'f0000000-0000-4000-8000-000000000001';
const SYSTEM_TOKEN_HASH = 'c1'.padStart(64, '0');
const SYSTEM_PRINCIPAL: Principal = { kind: 'collaborator', agentId: SYSTEM_AGENT_ID, credentialId: SYSTEM_TOKEN_HASH };

const STEP_TITLE: Record<string, string> = {
  'csv-source-inspection': '结构巡检',
  'csv-data-review': '数据清洗',
  'csv-evidence-report': '证据报告',
};

const OrderRecordSchema = z.strictObject({
  orderId: CollaborationIdSchema,
  buyerAgentId: CollaborationIdSchema,
  status: CommerceOrderStatusSchema,
  quote: ServiceQuoteSchema,
  taskId: CollaborationIdSchema.nullable(),
  inputHash: HashSchema,
  inputRows: CountSchema.min(1),
  deliveryId: CollaborationIdSchema.nullable(),
  deliveryVersion: CountSchema.min(1).nullable(),
  acceptance: AcceptanceSchema.nullable(),
  failure: OrderFailureSchema.nullable(),
  paidAt: TimestampSchema.nullable(),
  deliveredAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: CollaborationVersionSchema,
});
type OrderRecord = z.infer<typeof OrderRecordSchema>;

const PaymentRecordSchema = z.strictObject({
  paymentId: CollaborationIdSchema,
  orderId: CollaborationIdSchema,
  mode: PaymentModeSchema,
  provider: PaymentProviderSchema,
  status: PaymentStatusSchema,
  amountFen: CountSchema,
  currency: z.literal('CNY'),
  orderReference: z.string().min(1).max(64),
  prepayId: z.string().nullable(),
  qrCodeUrl: z.string().nullable(),
  providerTradeNo: z.string().nullable(),
  expiresAt: TimestampSchema,
  verifiedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  // simulated 模式的本地签名绑定与内部凭证只在服务端保存，绝不返回给买家之外的使用者。
  binding: z.string().nullable(),
  simulatedProof: z.string().nullable(),
});
type PaymentRecord = z.infer<typeof PaymentRecordSchema>;

const StepRowSchema = z.object({
  role: z.string(),
  agentId: z.string().nullable(),
  claimStatus: z.string().nullable(),
  handoffStatus: z.string().nullable(),
  attempt: z.number().int().nullable(),
  failure: z.string().nullable(),
});

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function alipayTime(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

function paymentStatusOf(order: OrderRecord, payment: PaymentRecord | null): PaymentStatus {
  if (order.quote.priceFen === 0) return 'NOT_REQUIRED';
  if (!payment) return 'UNPAID';
  return payment.status;
}

export class Commerce {
  readonly collaboration: Collaboration;
  constructor(readonly app: Application, readonly payments: PaymentProvider) {
    this.collaboration = new Collaboration(app);
  }

  private emit(client: Pick<PoolClient, 'query'>, orderId: string, type: string, actor: 'BUYER' | 'SYSTEM' | 'PAYMENT', detail: Record<string, unknown>) {
    return client.query('INSERT INTO commerce_order_events(order_id,type,document) VALUES($1,$2,$3)', [
      orderId, type, { orderId, type, actor, detail, createdAt: new Date().toISOString() },
    ]);
  }

  async services() {
    const { rows } = await this.app.db.pool.query(
      `SELECT document,active FROM commerce_services WHERE active ORDER BY (document->>'priceFen')::int DESC, service_id`,
    );
    return CommerceServicesResponseSchema.parse({
      services: rows.map(row => CommerceServiceSchema.parse({ ...row.document, active: row.active })),
      paymentMode: this.payments.mode,
      officialPayment: this.payments.official,
    });
  }

  private async quote(serviceId: string, expectedVersion: number) {
    const row = (await this.app.db.pool.query(
      'SELECT document,active FROM commerce_services WHERE service_id=$1 AND version=$2', [serviceId, expectedVersion],
    )).rows[0];
    if (!row) throw new AppError(409, 'SERVICE_VERSION_MISMATCH', '服务目录已变化，请重新读取服务列表');
    if (!row.active) throw new AppError(409, 'SERVICE_INACTIVE', '该服务当前未开放下单');
    return ServiceQuoteSchema.parse(row.document);
  }

  private async orderRecord(orderId: string, client: Pick<PoolClient, 'query'> = this.app.db.pool): Promise<OrderRecord> {
    const row = requireValue((await client.query('SELECT document FROM commerce_orders WHERE id=$1', [orderId])).rows[0]);
    return OrderRecordSchema.parse(row.document);
  }

  private async latestPayment(orderId: string, client: Pick<PoolClient, 'query'> = this.app.db.pool): Promise<PaymentRecord | null> {
    const row = (await client.query(
      'SELECT document FROM commerce_payments WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [orderId],
    )).rows[0];
    return row ? PaymentRecordSchema.parse(row.document) : null;
  }

  private async owned(principal: Principal, orderId: string): Promise<OrderRecord> {
    const actor = collaborator(principal);
    const record = await this.orderRecord(CollaborationIdSchema.parse(orderId));
    if (record.buyerAgentId !== actor.agentId && principal.kind !== 'admin') {
      throw new AppError(403, 'UNAUTHORIZED', '只有下单买家可以访问该订单');
    }
    return record;
  }

  async createOrder(principal: Principal, input: unknown) {
    const actor = collaborator(principal);
    const request = CreateOrderRequestSchema.parse(input);
    if (request.inputCsv.length > 80_000) throw new AppError(422, 'INPUT_TOO_LARGE', '订单输入上限为 80,000 字符');
    normalizedDelivery(request.inputCsv);
    const quote = await this.quote(request.serviceId, request.expectedServiceVersion);
    if (request.maxAmountFen !== undefined && quote.priceFen > request.maxAmountFen) {
      throw new AppError(409, 'PRICE_EXCEEDS_MAX', '服务价格超过订单允许的最高金额');
    }
    if (quote.priceFen > 0 && this.payments.mode === 'disabled') {
      throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', '默认未开通支付宝支付，收费服务暂不可下单');
    }
    const inputHash = hashUtf8(request.inputCsv);
    const requestHash = hashUtf8(JSON.stringify({ serviceId: quote.serviceId, serviceVersion: quote.serviceVersion, priceFen: quote.priceFen, inputHash }));
    const existing = (await this.app.db.pool.query(
      'SELECT id, request_hash FROM commerce_orders WHERE buyer_agent_id=$1 AND idempotency_key=$2', [actor.agentId, request.idempotencyKey],
    )).rows[0];
    if (existing) {
      if (existing.request_hash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '幂等编号已用于不同的订单内容');
      return this.getOrder(principal, existing.id);
    }
    const now = new Date().toISOString();
    const inputRows = z.number().int().min(1).parse(verifyCsvDelivery(normalizedDelivery(request.inputCsv)).rowCount);
    const record = OrderRecordSchema.parse({
      orderId: randomUUID(), buyerAgentId: actor.agentId, status: quote.priceFen === 0 ? 'READY' : 'AWAITING_PAYMENT',
      quote, taskId: null, inputHash, inputRows, deliveryId: null, deliveryVersion: null, acceptance: null, failure: null,
      paidAt: quote.priceFen === 0 ? now : null, deliveredAt: null, createdAt: now, updatedAt: now, version: 1,
    });
    await this.app.store.write(async client => {
      await client.query(
        `INSERT INTO commerce_orders(id,buyer_agent_id,idempotency_key,request_hash,status,task_id,input_csv,document,version)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [record.orderId, actor.agentId, request.idempotencyKey, requestHash, record.status, null, request.inputCsv, record, record.version],
      );
      await this.emit(client, record.orderId, 'ORDER_CREATED', 'BUYER', { serviceId: quote.serviceId, priceFen: quote.priceFen });
    });
    if (record.status === 'READY') await this.startExecution(record.orderId);
    return this.getOrder(principal, record.orderId);
  }

  async getOrder(principal: Principal, orderId: string) {
    await this.owned(principal, orderId);
    return this.detail(orderId);
  }

  private async detail(orderId: string) {
    const record = await this.refresh(orderId);
    const payment = await this.latestPayment(orderId);
    const history = (await this.app.db.pool.query(
      'SELECT seq,document FROM commerce_order_events WHERE order_id=$1 ORDER BY seq LIMIT 100', [orderId],
    )).rows.map(row => OrderEventSchema.parse({ ...row.document, seq: Number(row.seq) }));
    return OrderDetailSchema.parse({
      ...record, payment: this.paymentSummary(record, payment), execution: await this.executionSummary(record), history,
    });
  }

  async listOrders(principal: Principal, input: unknown) {
    const actor = collaborator(principal);
    const { limit } = OrderQuerySchema.parse(input);
    const rows = (await this.app.db.pool.query(
      'SELECT document FROM commerce_orders WHERE buyer_agent_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2', [actor.agentId, limit],
    )).rows;
    const orders = [];
    for (const row of rows) {
      const record = OrderRecordSchema.parse(row.document);
      const payment = await this.latestPayment(record.orderId);
      orders.push(OrderSchema.parse({ ...record, payment: this.paymentSummary(record, payment), execution: await this.executionSummary(record) }));
    }
    return OrdersResponseSchema.parse({ orders });
  }

  private paymentSummary(record: OrderRecord, payment: PaymentRecord | null) {
    return PaymentSummarySchema.parse({
      paymentId: payment?.paymentId ?? null,
      mode: this.payments.mode,
      provider: payment?.provider ?? null,
      status: paymentStatusOf(record, payment),
      amountFen: record.quote.priceFen,
      currency: 'CNY',
      payable: record.quote.priceFen > 0 && record.status === 'AWAITING_PAYMENT' && this.payments.mode !== 'disabled',
      expiresAt: payment?.expiresAt ?? null,
      verifiedAt: payment?.verifiedAt ?? null,
      providerTradeNo: payment?.providerTradeNo ?? null,
    });
  }

  private async executionSummary(record: OrderRecord) {
    const taskId = record.taskId;
    if (!taskId) {
      return ExecutionSummarySchema.parse({
        taskId: null, workflowVersion: null,
        status: record.status === 'READY' ? 'QUEUED' : record.status === 'FAILED' ? 'FAILED' : 'NOT_STARTED',
        steps: CSV_STEPS.map(step => ({ role: step.role, title: STEP_TITLE[step.role]!, status: 'PENDING', agentId: null, attempt: null })),
        failure: record.failure ? { code: record.failure.code, message: record.failure.message } : null,
      });
    }
    const plan = await workflow(this.app.db.pool, taskId);
    const rows = (await this.app.db.pool.query(
      `SELECT c.scope AS role, c.agent_id AS "agentId", c.document->>'status' AS "claimStatus",
         h.document->>'status' AS "handoffStatus",
         (SELECT max(a.attempt) FROM experiment_csv_attempts a WHERE a.claim_id=c.id) AS attempt,
         (SELECT a.failure_code FROM experiment_csv_attempts a WHERE a.claim_id=c.id ORDER BY a.attempt DESC LIMIT 1) AS failure
       FROM collaboration_claims c LEFT JOIN collaboration_handoffs h ON h.claim_id=c.id
       WHERE c.task_id=$1 ORDER BY c.created_at,c.id`, [taskId],
    )).rows.map(row => StepRowSchema.parse(row));
    const steps = CSV_STEPS.map(step => {
      const last = [...rows].reverse().find(row => row.role === step.role);
      const failed = plan?.failedStep === step.role;
      const accepted = last?.claimStatus === 'COMPLETED' && last?.handoffStatus === 'ACCEPTED';
      const status = accepted ? 'COMPLETED' : failed && last?.claimStatus !== 'ACTIVE' ? 'FAILED'
        : last?.claimStatus === 'ACTIVE' ? 'ACTIVE' : 'PENDING';
      return { role: step.role, title: STEP_TITLE[step.role]!, status, agentId: last?.agentId ?? null, attempt: last?.attempt ?? null };
    });
    const status = record.status === 'FAILED' || plan?.failedAt ? 'FAILED'
      : ['DELIVERED', 'ACCEPTED', 'DECLINED'].includes(record.status) ? 'COMPLETED'
        : steps.some(step => step.status !== 'PENDING') ? 'RUNNING' : 'QUEUED';
    return ExecutionSummarySchema.parse({
      taskId, workflowVersion: plan?.version ?? null, status, steps,
      failure: record.failure ? { code: record.failure.code, message: record.failure.message } : null,
    });
  }

  private async refresh(orderId: string): Promise<OrderRecord> {
    let record = await this.orderRecord(orderId);
    if (record.status === 'AWAITING_PAYMENT') {
      const payment = await this.latestPayment(orderId);
      if (payment?.status === 'PENDING' && Date.parse(payment.expiresAt) <= Date.now()) {
        record = await this.setStatus(record, 'EXPIRED', { payment });
      }
    }
    if (record.status === 'READY' && !record.taskId) await this.startExecution(orderId);
    if (record.status === 'IN_PROGRESS' && record.taskId) {
      const plan = await workflow(this.app.db.pool, record.taskId);
      if (plan?.failedAt) await this.setStatus(record, 'FAILED', {
        failure: { code: 'EXECUTION_FAILED', message: `CSV 工作流在步骤 ${plan.failedStep ?? '未知'} 失败`, at: plan.failedAt },
      });
      else await this.createDeliveryIfComplete(orderId);
    }
    return this.orderRecord(orderId);
  }

  private async setStatus(record: OrderRecord, status: z.infer<typeof CommerceOrderStatusSchema>, extra: { payment?: PaymentRecord; failure?: z.infer<typeof OrderFailureSchema> } = {}) {
    const now = new Date().toISOString();
    const next = OrderRecordSchema.parse({
      ...record, status, failure: extra.failure ?? record.failure, version: record.version + 1, updatedAt: now,
    });
    await this.app.store.write(async client => {
      await client.query('UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1', [record.orderId, next.status, next, next.version]);
      if (extra.payment) {
        await client.query('UPDATE commerce_payments SET status=$2,document=jsonb_set(document,\'{status}\',to_jsonb($2::text)) WHERE id=$1', [extra.payment.paymentId, 'EXPIRED']);
      }
      await this.emit(client, record.orderId, status === 'EXPIRED' ? 'PAYMENT_EXPIRED' : 'EXECUTION_FAILED', status === 'EXPIRED' ? 'PAYMENT' : 'SYSTEM', { status });
    });
    return next;
  }

  async requestPayment(principal: Principal, orderId: string) {
    const record = await this.owned(principal, orderId);
    const current = await this.refresh(record.orderId);
    const existing = await this.latestPayment(current.orderId);
    if (current.quote.priceFen === 0) {
      return PaymentRequestResponseSchema.parse({
        orderId: current.orderId, mode: this.payments.mode, official: this.payments.official, simulated: this.payments.simulated,
        amountFen: 0, currency: 'CNY', status: 'NOT_REQUIRED', prepay: null,
        paymentProofHeader: 'Payment-Proof', instruction: '该服务免费，无需支付即可执行。', simulatedProof: null,
      });
    }
    if (current.status !== 'AWAITING_PAYMENT') {
      if (existing?.status === 'VERIFIED') {
        return PaymentRequestResponseSchema.parse({
          orderId: current.orderId, mode: this.payments.mode, official: this.payments.official, simulated: this.payments.simulated,
          amountFen: current.quote.priceFen, currency: 'CNY', status: 'VERIFIED', prepay: null,
          paymentProofHeader: 'Payment-Proof', instruction: '该订单已完成支付。', simulatedProof: null,
        });
      }
      throw new AppError(409, 'INVALID_STATE', '当前订单状态不接受支付');
    }
    if (this.payments.mode === 'disabled') throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', '默认未开通支付宝支付，收费服务暂不可支付');
    if (existing && existing.status === 'PENDING' && Date.parse(existing.expiresAt) > Date.now()) {
      return this.paymentResponse(current, existing);
    }
    const expiresAt = new Date(Date.now() + this.app.config.PAYMENT_TTL_SECONDS * 1000);
    const prepay = await this.payments.precreate({
      orderReference: current.orderId.replace(/-/g, ''), serviceId: current.quote.serviceId,
      title: current.quote.title, amountFen: current.quote.priceFen, payBefore: alipayTime(expiresAt),
    });
    const payment = PaymentRecordSchema.parse({
      paymentId: randomUUID(), orderId: current.orderId, mode: this.payments.mode,
      provider: this.payments.simulated ? 'simulated' : 'alipay', status: 'PENDING',
      amountFen: current.quote.priceFen, currency: 'CNY', orderReference: current.orderId.replace(/-/g, ''),
      prepayId: prepay.prepayId, qrCodeUrl: prepay.qrCodeUrl, providerTradeNo: prepay.providerTradeNo,
      expiresAt: expiresAt.toISOString(), verifiedAt: null, createdAt: new Date().toISOString(),
      binding: prepay.binding, simulatedProof: prepay.simulatedProof,
    });
    await this.app.store.write(async client => {
      await client.query(
        `INSERT INTO commerce_payments(id,order_id,mode,provider,status,amount_fen,currency,provider_trade_no,document)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [payment.paymentId, payment.orderId, payment.mode, payment.provider, payment.status, payment.amountFen, payment.currency, payment.providerTradeNo, payment],
      );
      await this.emit(client, current.orderId, 'PAYMENT_REQUESTED', 'PAYMENT', { paymentId: payment.paymentId, provider: payment.provider });
    });
    return this.paymentResponse(current, payment);
  }

  private paymentResponse(record: OrderRecord, payment: PaymentRecord) {
    return PaymentRequestResponseSchema.parse({
      orderId: record.orderId, mode: payment.mode, official: this.payments.official, simulated: this.payments.simulated,
      amountFen: payment.amountFen, currency: payment.currency, status: payment.status,
      prepay: PrepaySchema.parse({
        prepayId: payment.prepayId ?? payment.paymentId, qrCodeUrl: payment.qrCodeUrl,
        providerTradeNo: payment.providerTradeNo, expiresAt: payment.expiresAt,
      }),
      paymentProofHeader: 'Payment-Proof',
      instruction: payment.provider === 'simulated'
        ? '当前为内部模拟支付：simulatedProof 只用于验证内部状态机，不代表支付宝官方支付成功。'
        : '请使用支付宝完成支付，随后把 Payment-Proof 请求头提交到本订单的 payment-proof 端点。',
      simulatedProof: payment.simulatedProof,
    });
  }

  async submitPaymentProof(principal: Principal, orderId: string, header: string) {
    await this.owned(principal, orderId);
    const proof = decodePaymentProof(header);
    const canonicalHash = proofHash(Buffer.from(JSON.stringify(proof)).toString('base64'));
    const record = await this.orderRecord(orderId);
    if (record.quote.priceFen === 0) throw new AppError(409, 'INVALID_STATE', '免费订单不需要支付凭证');
    const current = await this.latestPayment(orderId);
    if (!current) throw new AppError(409, 'INVALID_STATE', '请先请求预下单');
    if (current.status === 'VERIFIED') {
      if (current.orderReference && Date.parse(current.expiresAt) < Date.now()) throw new AppError(409, 'INVALID_STATE', '支付凭证已过期');
      return PaymentProofResponseSchema.parse({
        orderId, status: 'VERIFIED', official: this.payments.official, simulated: this.payments.simulated,
        providerTradeNo: current.providerTradeNo, verifiedAt: current.verifiedAt,
      });
    }
    if (record.status !== 'AWAITING_PAYMENT' || current.status !== 'PENDING') throw new AppError(409, 'INVALID_STATE', '当前订单状态不接受支付凭证');
    if (Date.parse(current.expiresAt) <= Date.now()) {
      await this.setStatus(record, 'EXPIRED', { payment: current });
      throw new AppError(409, 'PAYMENT_EXPIRED', '支付已超时，请重新下单');
    }
    const verified = await this.payments.verify({
      proof, header, orderReference: current.orderReference, serviceId: record.quote.serviceId,
      amountFen: record.quote.priceFen, expectedProviderTradeNo: current.providerTradeNo, binding: current.binding,
    });
    const now = new Date().toISOString();
    try {
      await this.app.store.write(async client => {
        const duplicate = (await client.query(
          'SELECT order_id FROM commerce_payments WHERE (proof_hash=$1 OR provider_trade_no=$2) AND id<>$3 LIMIT 1',
          [canonicalHash, verified.providerTradeNo, current.paymentId],
        )).rows[0];
        if (duplicate) throw new AppError(409, 'PROOF_ALREADY_USED', '该支付凭证已用于其他订单');
        const inserted = await client.query(
          `UPDATE commerce_payments SET status='VERIFIED',proof_hash=$2,provider_trade_no=$3,verified_at=now(),
             document=$4 WHERE id=$1 AND status='PENDING'`,
          [current.paymentId, canonicalHash, verified.providerTradeNo, PaymentRecordSchema.parse({
            ...current, status: 'VERIFIED', providerTradeNo: verified.providerTradeNo, verifiedAt: now,
          })],
        );
        if (!inserted.rowCount) throw new AppError(409, 'INVALID_STATE', '支付记录状态已经变化');
        const updated = OrderRecordSchema.parse({ ...record, status: 'READY', paidAt: now, version: record.version + 1, updatedAt: now });
        await client.query('UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1', [orderId, updated.status, updated, updated.version]);
        await this.emit(client, orderId, 'PAYMENT_VERIFIED', 'PAYMENT', { providerTradeNo: verified.providerTradeNo, official: this.payments.official });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'PROOF_ALREADY_USED', '该支付凭证已被使用');
      throw error;
    }
    await this.startExecution(orderId);
    return PaymentProofResponseSchema.parse({
      orderId, status: 'VERIFIED', official: this.payments.official, simulated: this.payments.simulated,
      providerTradeNo: verified.providerTradeNo, verifiedAt: now,
    });
  }

  private async startExecution(orderId: string) {
    const now = new Date().toISOString();
    const started = await this.app.store.write(async client => {
      const current = await this.orderRecord(orderId, client);
      if (current.taskId || current.status !== 'READY') return false;
      const input = z.string().parse((await client.query('SELECT input_csv FROM commerce_orders WHERE id=$1', [orderId])).rows[0]?.input_csv);
      const task = CollaborationTaskSchema.parse({
        taskId: randomUUID(), creator: SYSTEM_AGENT_ID, parentTaskId: null,
        title: `订单 ${orderId} · ${current.quote.title}`,
        description: `系统为订单 ${orderId} 创建的 CSV 数据清洗与校验任务，买家验收结果决定订单完成状态。`,
        requiredCapabilities: [], bountyMON: null, bountyMode: 'MOCK', status: 'OPEN', version: 1, createdAt: now, updatedAt: now,
      });
      await client.query('INSERT INTO collaboration_tasks(id,author_id,parent_task_id,version,document) VALUES($1,$2,$3,$4,$5)', [task.taskId, SYSTEM_AGENT_ID, null, task.version, task]);
      await this.collaboration.store.event(client, 'TASK_CREATED', SYSTEM_AGENT_ID, task.taskId, { taskId: task.taskId, orderId });
      await client.query('INSERT INTO experiment_csv_workflows(task_id,input_csv,lease_seconds,version,mode) VALUES($1,$2,$3,$4,$5)', [task.taskId, input, 300, CSV_WORKFLOW_VERSION, 'AUTO']);
      const next = OrderRecordSchema.parse({ ...current, status: 'IN_PROGRESS', taskId: task.taskId, version: current.version + 1, updatedAt: now });
      await client.query('UPDATE commerce_orders SET status=$2,task_id=$3,document=$4,version=$5,updated_at=now() WHERE id=$1', [orderId, next.status, task.taskId, next, next.version]);
      await this.emit(client, orderId, 'EXECUTION_STARTED', 'SYSTEM', { taskId: task.taskId, workflowVersion: CSV_WORKFLOW_VERSION });
      return true;
    });
    return started;
  }

  private async createDeliveryIfComplete(orderId: string) {
    const current = await this.orderRecord(orderId);
    if (current.deliveryId || !current.taskId) return;
    const cleaned = await acceptedStep(this.app.db.pool, current.taskId, 'csv-data-review');
    const reportRaw = await acceptedStep(this.app.db.pool, current.taskId, 'csv-evidence-report');
    if (cleaned === undefined || reportRaw === undefined) return;
    const report = z.record(z.string(), z.unknown()).parse(JSON.parse(reportRaw));
    const rows = (await this.app.db.pool.query(
      `SELECT c.id AS "claimId", c.agent_id AS "agentId", c.scope AS role, h.id AS "handoffId", h.document->>'content' AS content
       FROM collaboration_claims c JOIN collaboration_handoffs h ON h.claim_id=c.id AND h.document->>'status'='ACCEPTED'
       WHERE c.task_id=$1 AND c.document->>'status'='COMPLETED' ORDER BY c.created_at,c.id`, [current.taskId],
    )).rows;
    const evidence = rows.map(row => ({
      role: z.string().parse(row.role), agentId: z.string().parse(row.agentId), claimId: z.string().parse(row.claimId),
      handoffId: z.string().parse(row.handoffId), contentHash: hashUtf8(z.string().parse(row.content)),
    }));
    const now = new Date().toISOString();
    const delivery = DeliverySchema.parse({
      deliveryId: randomUUID(), orderId, version: 1, taskId: current.taskId,
      contentHash: hashUtf8(cleaned), cleanedCsv: cleaned, report, evidence, createdAt: now,
    });
    await this.app.store.write(async client => {
      const fresh = await this.orderRecord(orderId, client);
      if (fresh.deliveryId) return;
      await client.query(
        'INSERT INTO commerce_deliveries(id,order_id,version,task_id,content,content_hash,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [delivery.deliveryId, orderId, delivery.version, current.taskId, delivery.cleanedCsv, delivery.contentHash, delivery],
      );
      const next = OrderRecordSchema.parse({
        ...fresh, status: 'DELIVERED', deliveryId: delivery.deliveryId, deliveryVersion: 1, deliveredAt: now, version: fresh.version + 1, updatedAt: now,
      });
      await client.query('UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1', [orderId, next.status, next, next.version]);
      await this.emit(client, orderId, 'DELIVERED', 'SYSTEM', { deliveryId: delivery.deliveryId, version: 1 });
    });
  }

  async onHandoffSubmitted(taskId: string) {
    const row = (await this.app.db.pool.query('SELECT id FROM commerce_orders WHERE task_id=$1', [taskId])).rows[0];
    if (!row) return;
    const handoffs = (await this.app.db.pool.query(
      "SELECT document FROM collaboration_handoffs WHERE task_id=$1 AND document->>'status'='SUBMITTED' ORDER BY created_at,id", [taskId],
    )).rows;
    for (const handoffRow of handoffs) {
      const handoff = CollaborationHandoffSchema.parse(handoffRow.document);
      // 系统运营身份按确定性规则自动验收；核验失败会直接抛出，不会把失败步骤标记为已交付。
      await this.collaboration.reviewHandoff(SYSTEM_PRINCIPAL, handoff.handoffId, {
        expectedVersion: handoff.version, status: 'ACCEPTED', reason: '',
      });
    }
    await this.refresh(row.id);
  }

  async acceptDelivery(principal: Principal, orderId: string, input: unknown) {
    const request = AcceptanceRequestSchema.parse(input);
    const record = await this.owned(principal, orderId);
    const existing = (await this.app.db.pool.query('SELECT id FROM commerce_acceptances WHERE order_id=$1', [orderId])).rows[0];
    if (existing) throw new AppError(409, 'ALREADY_ACCEPTED', '该订单已经完成验收');
    if (record.status !== 'DELIVERED') throw new AppError(409, 'INVALID_STATE', '订单尚未交付，不能验收');
    const reputationRows = (await this.app.db.pool.query(
      'SELECT claim_id AS "claimId", agent_id AS "agentId", role, outcome FROM experiment_reputation_events WHERE task_id=$1', [record.taskId],
    )).rows;
    const claims = (await this.app.db.pool.query(
      `SELECT DISTINCT ON (scope) scope AS role, id AS "claimId", agent_id AS "agentId"
       FROM collaboration_claims WHERE task_id=$1 ORDER BY scope, created_at DESC,id DESC`, [record.taskId],
    )).rows;
    const reputation = CSV_STEPS.map(step => {
      const claim = claims.find(item => item.role === step.role);
      const event = reputationRows.find(item => item.claimId === claim?.claimId && item.outcome === 'PASS');
      return {
        role: step.role, agentId: claim ? z.string().parse(claim.agentId) : SYSTEM_AGENT_ID,
        claimId: claim ? z.string().parse(claim.claimId) : record.deliveryId!,
        outcome: event ? 'PASS' as const : null,
        source: event ? 'DETERMINISTIC_REVIEW' as const : 'NOT_TRACKED' as const,
      };
    });
    const now = new Date().toISOString();
    const acceptance = AcceptanceSchema.parse({
      acceptanceId: randomUUID(), orderId, decision: request.decision, rating: request.rating, comment: request.comment,
      reputation, createdAt: now,
    });
    await this.app.store.write(async client => {
      await client.query('INSERT INTO commerce_acceptances(id,order_id,decision,document) VALUES($1,$2,$3,$4)', [acceptance.acceptanceId, orderId, acceptance.decision, acceptance]);
      const next = OrderRecordSchema.parse({
        ...record, status: request.decision, acceptance, version: record.version + 1, updatedAt: now,
      });
      await client.query('UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1', [orderId, next.status, next, next.version]);
      await this.emit(client, orderId, 'ACCEPTANCE_RECORDED', 'BUYER', { decision: request.decision, rating: request.rating });
    });
    return acceptance;
  }

  async delivery(principal: Principal, orderId: string) {
    const record = await this.owned(principal, orderId);
    if (!record.deliveryId) {
      if (record.status === 'AWAITING_PAYMENT') throw new AppError(402, 'PAYMENT_REQUIRED', '该订单尚未支付');
      throw new AppError(404, 'NOT_FOUND', '该订单尚无交付');
    }
    const row = requireValue((await this.app.db.pool.query('SELECT content,content_hash FROM commerce_deliveries WHERE id=$1', [record.deliveryId])).rows[0]);
    return DeliveryDownloadSchema.parse({ orderId, version: record.deliveryVersion, contentHash: row.content_hash, content: row.content });
  }

  async execution(principal: Principal, orderId: string) {
    const record = await this.owned(principal, orderId);
    if (record.status === 'AWAITING_PAYMENT') throw new AppError(402, 'PAYMENT_REQUIRED', '该订单尚未支付');
    return this.executionSummary(record);
  }
}
