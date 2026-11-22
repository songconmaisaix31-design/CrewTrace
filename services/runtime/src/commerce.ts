import { createHash, randomUUID } from 'node:crypto';
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
  type PaymentRequestResponse, type PaymentStatus,
} from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import type { Principal } from './auth.js';
import { admin } from './auth.js';
import { collaborator } from './collaboration-store.js';
import { Collaboration } from './collaboration.js';
import { acceptedStep, CSV_STEPS, CSV_WORKFLOW_VERSION, normalizedDelivery, workflow } from './csv-workflow.js';
import { verifyCsvDelivery } from '../../../workers/src/csv-delivery.ts';
import { AppError, requireValue } from './errors.js';
import {
  ALIPAY_AMOUNT_LIMIT_FEN, alipayPayBefore, decodePaymentProof, proofHash,
  isPrecreateRejected, isPrecreateUnknown, PrecreateUnknownError,
  type PaymentProvider, type VerifyExpected,
} from './payment.js';

const SYSTEM_AGENT_ID = 'f0000000-0000-4000-8000-000000000001';
const SYSTEM_TOKEN_HASH = 'c1'.padStart(64, '0');
const SYSTEM_PRINCIPAL: Principal = { kind: 'collaborator', agentId: SYSTEM_AGENT_ID, credentialId: SYSTEM_TOKEN_HASH };

/** 预下单网络请求超过该时间仍未落到本地 PENDING，视为未确认并允许重新预下单。 */
const PREPARE_TIMEOUT_MS = 60_000;
const PREPARE_WAIT_MS = 5_000;
const PREPARE_POLL_MS = 100;

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
  attempt: CountSchema.min(1).default(1),
  /** 明确失败或人工关闭的原因；结果未知时也用于记录外部错误码。 */
  failureCode: z.string().max(80).nullable().default(null),
  failureMessage: z.string().max(500).nullable().default(null),
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

type PaymentOutcome =
  | { kind: 'ready'; record: OrderRecord; payment: PaymentRecord }
  | { kind: 'preparing'; record: OrderRecord; payment: PaymentRecord }
  | { kind: 'retry'; record: OrderRecord; payment: PaymentRecord }
  | { kind: 'created'; record: OrderRecord; payment: PaymentRecord }
  | { kind: 'paid'; record: OrderRecord; payment: PaymentRecord }
  | { kind: 'invalid'; record: OrderRecord };

const ReconcilePaymentRequestSchema = z.strictObject({
  paymentId: CollaborationIdSchema,
  /** 运营在官方后台核对后的外部状态；不允许通过该接口把支付标记为已付款。 */
  externalState: z.enum(['NO_TRANSACTION', 'TRANSACTION_CLOSED']),
  reason: z.string().min(3).max(200),
});

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function paymentStatusOf(order: OrderRecord, payments: PaymentRecord[], mode: string): PaymentStatus {
  if (order.quote.priceFen === 0) return 'NOT_REQUIRED';
  if (!payments.length) return 'UNPAID';
  const current = payments.filter(payment => payment.mode === mode);
  return (current.find(payment => payment.status === 'VERIFIED') ?? current[0])?.status ?? 'EXPIRED';
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
      deploymentEnv: this.app.config.DEPLOYMENT_ENV,
      publicDeployment: this.app.config.PUBLIC_DEPLOYMENT,
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

  private async orderRecordForUpdate(orderId: string, client: Pick<PoolClient, 'query'>): Promise<OrderRecord> {
    const row = requireValue((await client.query('SELECT document FROM commerce_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]);
    return OrderRecordSchema.parse(row.document);
  }

  private async paymentsFor(orderId: string, client: Pick<PoolClient, 'query'> = this.app.db.pool): Promise<PaymentRecord[]> {
    const rows = (await client.query(
      'SELECT document FROM commerce_payments WHERE order_id=$1 ORDER BY created_at DESC,id DESC', [orderId],
    )).rows;
    return rows.map(row => PaymentRecordSchema.parse(row.document));
  }

  private async paymentById(orderId: string, paymentId: string): Promise<PaymentRecord | null> {
    const row = (await this.app.db.pool.query(
      'SELECT document FROM commerce_payments WHERE id=$1 AND order_id=$2', [paymentId, orderId],
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
    if (quote.priceFen > ALIPAY_AMOUNT_LIMIT_FEN && this.payments.official) {
      throw new AppError(409, 'PRICE_EXCEEDS_ALIPAY_LIMIT', '支付宝按量付费单笔金额不能超过 50 元');
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
    try {
      await this.app.store.write(async client => {
        await client.query(
          `INSERT INTO commerce_orders(id,buyer_agent_id,idempotency_key,request_hash,status,task_id,input_csv,document,version)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [record.orderId, actor.agentId, request.idempotencyKey, requestHash, record.status, null, request.inputCsv, record, record.version],
        );
        await this.emit(client, record.orderId, 'ORDER_CREATED', 'BUYER', { serviceId: quote.serviceId, priceFen: quote.priceFen });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = (await this.app.db.pool.query(
        'SELECT id, request_hash FROM commerce_orders WHERE buyer_agent_id=$1 AND idempotency_key=$2', [actor.agentId, request.idempotencyKey],
      )).rows[0];
      if (!raced) throw error;
      if (raced.request_hash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '幂等编号已用于不同的订单内容');
      return this.getOrder(principal, raced.id);
    }
    if (record.status === 'READY') await this.startExecution(record.orderId);
    return this.getOrder(principal, record.orderId);
  }

  async getOrder(principal: Principal, orderId: string) {
    await this.owned(principal, orderId);
    return this.detail(orderId);
  }

  private async detail(orderId: string) {
    const record = await this.refresh(orderId);
    const payments = await this.paymentsFor(orderId);
    const history = (await this.app.db.pool.query(
      'SELECT seq,document FROM commerce_order_events WHERE order_id=$1 ORDER BY seq LIMIT 100', [orderId],
    )).rows.map(row => OrderEventSchema.parse({ ...row.document, seq: Number(row.seq) }));
    return OrderDetailSchema.parse({
      ...record, payment: this.paymentSummary(record, payments), execution: await this.executionSummary(record), history,
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
      const payments = await this.paymentsFor(record.orderId);
      orders.push(OrderSchema.parse({ ...record, payment: this.paymentSummary(record, payments), execution: await this.executionSummary(record) }));
    }
    return OrdersResponseSchema.parse({ orders });
  }

  private paymentSummary(record: OrderRecord, payments: PaymentRecord[]) {
    const current = payments.filter(payment => payment.mode === this.payments.mode);
    const chosen = current.find(payment => payment.status === 'VERIFIED') ?? current[0] ?? null;
    const status = paymentStatusOf(record, payments, this.payments.mode);
    return PaymentSummarySchema.parse({
      paymentId: chosen?.paymentId ?? null,
      mode: this.payments.mode,
      provider: chosen?.provider ?? null,
      status,
      amountFen: record.quote.priceFen,
      currency: 'CNY',
      payable: record.quote.priceFen > 0 && record.status === 'AWAITING_PAYMENT' && this.payments.mode !== 'disabled',
      expiresAt: chosen?.expiresAt ?? null,
      verifiedAt: chosen?.verifiedAt ?? null,
      providerTradeNo: chosen?.providerTradeNo ?? null,
      simulated: this.payments.simulated,
      deploymentEnv: this.app.config.DEPLOYMENT_ENV,
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
      const payments = await this.paymentsFor(orderId);
      const active = payments.find(payment => payment.mode === this.payments.mode
        && (payment.status === 'PENDING' || payment.status === 'PREPARING' || payment.status === 'UNKNOWN'));
      if (active && Date.parse(active.expiresAt) <= Date.now()) {
        if (active.status === 'PENDING') {
          // 只把本地支付尝试标记为超时，订单保留待支付状态，已付款但延迟到达的凭证仍可验证。
          await this.transitionPayment(active, 'EXPIRED', 'PAYMENT_EXPIRED', { reason: 'PAY_BEFORE_PASSED' });
        } else {
          // pay_before 已过，远端同一笔预下单不可能再被支付；不能把本地超时当成远端失败，但可以安全关闭。
          await this.transitionPayment(active, 'FAILED', 'PAYMENT_PREPARE_CLOSED', { reason: 'PAY_BEFORE_PASSED' });
        }
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

  private async setStatus(record: OrderRecord, status: z.infer<typeof CommerceOrderStatusSchema>, extra: { failure?: z.infer<typeof OrderFailureSchema> } = {}) {
    const now = new Date().toISOString();
    const next = OrderRecordSchema.parse({
      ...record, status, failure: extra.failure ?? record.failure, version: record.version + 1, updatedAt: now,
    });
    await this.app.store.write(async client => {
      // 版本条件更新避免读取后过期状态覆盖其他写入。
      const updated = await client.query(
        'UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1 AND version=$5',
        [record.orderId, next.status, next, next.version, record.version],
      );
      if (!updated.rowCount) return;
      await this.emit(client, record.orderId, status === 'FAILED' ? 'EXECUTION_FAILED' : 'ORDER_STATUS_CHANGED', 'SYSTEM', { status });
    });
    return this.orderRecord(record.orderId);
  }

  private async transitionPayment(payment: PaymentRecord, status: 'FAILED' | 'EXPIRED' | 'UNKNOWN', event: string, detail: Record<string, unknown>) {
    await this.app.store.write(async client => {
      const next = PaymentRecordSchema.parse({
        ...payment,
        status,
        failureCode: typeof detail.reason === 'string' ? detail.reason : payment.failureCode,
        failureMessage: typeof detail.message === 'string' ? detail.message : payment.failureMessage,
      });
      const updated = await client.query(
        'UPDATE commerce_payments SET status=$2,document=$3 WHERE id=$1 AND status=$4',
        [payment.paymentId, status, next, payment.status],
      );
      if (!updated.rowCount) return;
      await this.emit(client, payment.orderId, event, 'PAYMENT', { paymentId: payment.paymentId, status, ...detail });
    });
  }

  private orderReference(orderId: string, attempt: number) {
    // 支付宝 out_trade_no 上限 32 位；按订单与尝试序号稳定派生，重试同一尝试时得到相同值。
    return createHash('sha256').update(`${orderId}:${attempt}`).digest('hex').slice(0, 32);
  }

  private async settlePrecreate(record: OrderRecord, payment: PaymentRecord) {
    let prepay;
    try {
      prepay = await this.payments.precreate({
        orderReference: payment.orderReference, serviceId: record.quote.serviceId,
        title: record.quote.title, amountFen: record.quote.priceFen,
        payBefore: alipayPayBefore(new Date(payment.expiresAt)),
      });
    } catch (error) {
      if (isPrecreateRejected(error)) {
        // 支付宝明确拒绝，远端没有产生可支付交易，可以安全标记失败。
        await this.transitionPayment(payment, 'FAILED', 'PAYMENT_PREPARE_REJECTED', {
          reason: 'ALIPAY_REJECTED', message: error.message,
        });
        throw error;
      }
      // 网络、超时、系统错误或响应缺字段：保留同一 out_trade_no，禁止自动创建第二笔支付。
      await this.transitionPayment(payment, 'UNKNOWN', 'PAYMENT_PREPARE_UNKNOWN', {
        reason: 'PRECREATE_UNCONFIRMED', message: '支付宝预下单结果未确认，已保留原商户订单号等待人工核对或原样重试',
      });
      throw isPrecreateUnknown(error) ? error : new PrecreateUnknownError();
    }
    const next = PaymentRecordSchema.parse({
      ...payment, status: 'PENDING', prepayId: prepay.prepayId, qrCodeUrl: prepay.qrCodeUrl,
      providerTradeNo: prepay.providerTradeNo, binding: prepay.binding, simulatedProof: prepay.simulatedProof,
      failureCode: null, failureMessage: null,
    });
    const settled = await this.app.store.write(async client => {
      const updated = await client.query(
        `UPDATE commerce_payments SET status='PENDING',provider_trade_no=$2,document=$3
         WHERE id=$1 AND status=$4`,
        [payment.paymentId, next.providerTradeNo, next, payment.status],
      );
      if (updated.rowCount) {
        await this.emit(client, payment.orderId, 'PAYMENT_REQUESTED', 'PAYMENT', {
          paymentId: payment.paymentId, provider: payment.provider, attempt: payment.attempt,
          resolvedFrom: payment.status, orderReference: payment.orderReference,
        });
        return next;
      }
      const row = (await client.query(
        'SELECT document FROM commerce_payments WHERE id=$1 AND order_id=$2', [payment.paymentId, payment.orderId],
      )).rows[0];
      return row ? PaymentRecordSchema.parse(row.document) : null;
    });
    if (!settled) throw new AppError(409, 'INVALID_STATE', '支付记录已经变化，请重新查询订单');
    return this.paymentResponse(record, settled);
  }

  async requestPayment(principal: Principal, orderId: string) {
    const owned = await this.owned(principal, orderId);
    const current = await this.refresh(owned.orderId);
    if (current.quote.priceFen === 0) {
      return PaymentRequestResponseSchema.parse({
        orderId: current.orderId, mode: this.payments.mode, official: this.payments.official, simulated: this.payments.simulated,
        amountFen: 0, currency: 'CNY', status: 'NOT_REQUIRED', prepay: null, paymentLink: null,
        paymentProofHeader: 'Payment-Proof', instruction: '该服务免费，无需支付即可执行。', simulatedProof: null,
      });
    }
    if (this.payments.mode === 'disabled') throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', '默认未开通支付宝支付，收费服务暂不可支付');
    const outcome = await this.app.store.write(async (client): Promise<PaymentOutcome> => {
      const record = await this.orderRecordForUpdate(orderId, client);
      if (record.quote.priceFen === 0 || record.status !== 'AWAITING_PAYMENT') {
        const payments = await this.paymentsFor(orderId, client);
        const verified = payments.find(payment => payment.mode === this.payments.mode && payment.status === 'VERIFIED');
        return verified ? { kind: 'paid', record, payment: verified } : { kind: 'invalid', record };
      }
      const payments = await this.paymentsFor(orderId, client);
      const currentMode = payments.filter(payment => payment.mode === this.payments.mode);
      const closeAttempt = async (payment: PaymentRecord, status: 'FAILED' | 'EXPIRED', reason: string, event: string) => {
        const next = PaymentRecordSchema.parse({ ...payment, status, failureCode: reason });
        const closed = await client.query(
          'UPDATE commerce_payments SET status=$2,document=$3 WHERE id=$1 AND status=$4',
          [payment.paymentId, status, next, payment.status],
        );
        if (closed.rowCount) {
          await this.emit(client, orderId, event, 'PAYMENT', { paymentId: payment.paymentId, reason, orderReference: payment.orderReference });
        }
      };
      const pending = currentMode.find(payment => payment.status === 'PENDING');
      if (pending && Date.parse(pending.expiresAt) > Date.now()) return { kind: 'ready', record, payment: pending };
      if (pending) await closeAttempt(pending, 'EXPIRED', 'PAY_WINDOW_CLOSED', 'PAYMENT_EXPIRED');
      const preparing = currentMode.find(payment => payment.status === 'PREPARING');
      if (preparing) {
        if (Date.parse(preparing.expiresAt) <= Date.now()) {
          // pay_before 已过，远端同一笔预下单不可能再被支付，可以安全关闭。
          await closeAttempt(preparing, 'FAILED', 'PAY_BEFORE_PASSED', 'PAYMENT_PREPARE_CLOSED');
        } else if (Date.now() - Date.parse(preparing.createdAt) <= PREPARE_TIMEOUT_MS) {
          return { kind: 'preparing', record, payment: preparing };
        } else {
          // 超时只代表本地未确认，使用同一 out_trade_no 重试，不创建第二笔支付。
          return { kind: 'retry', record, payment: preparing };
        }
      }
      const unknown = currentMode.find(payment => payment.status === 'UNKNOWN');
      if (unknown) {
        if (Date.parse(unknown.expiresAt) <= Date.now()) {
          await closeAttempt(unknown, 'FAILED', 'PAY_BEFORE_PASSED', 'PAYMENT_PREPARE_CLOSED');
        } else {
          return { kind: 'retry', record, payment: unknown };
        }
      }
      // 只有不存在未确认尝试时才创建新的商户订单号。
      const attempt = Math.max(0, ...currentMode.map(payment => payment.attempt)) + 1;
      const expiresAt = new Date(Date.now() + this.app.config.PAYMENT_TTL_SECONDS * 1000);
      const payment = PaymentRecordSchema.parse({
        paymentId: randomUUID(), orderId: record.orderId, mode: this.payments.mode,
        provider: this.payments.simulated ? 'simulated' : 'alipay', status: 'PREPARING',
        amountFen: record.quote.priceFen, currency: 'CNY', orderReference: this.orderReference(record.orderId, attempt),
        prepayId: null, qrCodeUrl: null, providerTradeNo: null, expiresAt: expiresAt.toISOString(), verifiedAt: null,
        createdAt: new Date().toISOString(), attempt, failureCode: null, failureMessage: null,
        binding: null, simulatedProof: null,
      });
      await client.query(
        `INSERT INTO commerce_payments(id,order_id,mode,provider,status,amount_fen,currency,provider_trade_no,document)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [payment.paymentId, payment.orderId, payment.mode, payment.provider, payment.status, payment.amountFen, payment.currency, null, payment],
      );
      await this.emit(client, orderId, 'PAYMENT_PREPARING', 'PAYMENT', {
        paymentId: payment.paymentId, attempt, provider: payment.provider, orderReference: payment.orderReference,
      });
      return { kind: 'created', record, payment };
    });
    if (outcome.kind === 'paid') return this.paymentResponse(outcome.record, outcome.payment);
    if (outcome.kind === 'invalid') throw new AppError(409, 'INVALID_STATE', '当前订单状态不接受支付');
    if (outcome.kind === 'ready') return this.paymentResponse(outcome.record, outcome.payment);
    if (outcome.kind === 'preparing') {
      const settled = await this.waitForPayment(orderId, outcome.payment.paymentId);
      if (settled) return this.paymentResponse(outcome.record, settled);
      throw new AppError(409, 'PAYMENT_PREPARING', '支付预下单正在处理，请稍后重试');
    }
    return this.settlePrecreate(outcome.record, outcome.payment);
  }

  private async waitForPayment(orderId: string, paymentId: string): Promise<PaymentRecord | null> {
    const deadline = Date.now() + PREPARE_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, PREPARE_POLL_MS));
      const payment = await this.paymentById(orderId, paymentId);
      if (!payment) return null;
      if (payment.status === 'PENDING' || payment.status === 'UNKNOWN' || payment.status === 'VERIFIED') return payment;
      if (payment.status === 'FAILED' || payment.status === 'EXPIRED') return null;
    }
    return null;
  }

  private paymentResponse(record: OrderRecord, payment: PaymentRecord) {
    return PaymentRequestResponseSchema.parse({
      orderId: record.orderId, mode: payment.mode, official: this.payments.official, simulated: this.payments.simulated,
      amountFen: payment.amountFen, currency: payment.currency, status: payment.status,
      prepay: payment.prepayId ? PrepaySchema.parse({
        prepayId: payment.prepayId, qrCodeUrl: payment.qrCodeUrl,
        providerTradeNo: payment.providerTradeNo, expiresAt: payment.expiresAt,
      }) : null,
      paymentProofHeader: 'Payment-Proof',
      paymentLink: payment.prepayId,
      instruction: payment.provider === 'simulated'
        ? '当前为内部模拟支付：simulatedProof 只用于验证内部状态机，不代表支付宝官方支付成功。'
        : payment.status === 'UNKNOWN'
          ? '预下单结果未确认，请勿重复付款；可使用原 Payment-Proof 验证，或联系运营核对后关闭该次尝试。'
          : '请使用支付宝完成支付，随后把 Payment-Proof 请求头提交到本订单的 payment-proof 端点。',
      simulatedProof: payment.simulatedProof,
    });
  }

  async submitPaymentProof(principal: Principal, orderId: string, header: string) {
    await this.owned(principal, orderId);
    const record = await this.orderRecord(orderId);
    if (record.quote.priceFen === 0) throw new AppError(409, 'INVALID_STATE', '免费订单不需要支付凭证');
    const proof = decodePaymentProof(header);
    const canonical = Buffer.from(JSON.stringify({
      protocol: { payment_proof: proof.protocol.payment_proof, trade_no: proof.protocol.trade_no },
      method: { client_session: proof.method.client_session ?? null },
    })).toString('base64');
    const canonicalHash = proofHash(canonical);
    const initialPayments = await this.paymentsFor(orderId);
    const currentMode = initialPayments.filter(payment => payment.mode === this.payments.mode);
    const verifiedAlready = currentMode.find(payment => payment.status === 'VERIFIED');
    if (verifiedAlready) {
      // 已验付订单重复提交凭证只返回既有结果，不重新启动工作流。
      return this.verifiedResponse(orderId, verifiedAlready);
    }
    if (!['AWAITING_PAYMENT', 'EXPIRED'].includes(record.status)) {
      // 订单已经进入执行或交付阶段时，迟到凭证只补记支付证据，不改变订单状态，也不重复启动 Workflow。
      return this.verifyLatePayment(orderId, record, proof, header, canonicalHash, currentMode);
    }
    if (!currentMode.length) {
      throw new AppError(409, 'PAYMENT_MODE_MISMATCH', '订单支付尝试与当前支付模式不一致，请重新预下单');
    }
    const candidate = this.proofCandidate(currentMode, proof);
    if (this.payments.simulated && (!candidate.binding || candidate.status === 'PREPARING')) {
      throw new AppError(409, 'PAYMENT_PREPARING', '支付预下单尚未完成，请稍后重试');
    }
    const expected: VerifyExpected | null = this.payments.simulated ? {
      orderReference: candidate.orderReference, serviceId: record.quote.serviceId,
      amountFen: record.quote.priceFen, binding: candidate.binding, providerTradeNo: candidate.providerTradeNo,
    } : null;
    const verified = await this.payments.verify({ proof, header, expected });
    if (verified.providerTradeNo !== proof.protocol.trade_no) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '支付凭证交易号不一致');
    }
    const matched = (verified.orderReference
      ? currentMode.find(payment => payment.orderReference === verified.orderReference)
      : candidate) ?? null;
    if (!matched) throw new AppError(402, 'PAYMENT_MISMATCH', '支付凭证不属于该订单');
    if (verified.amountFen !== null && verified.amountFen !== record.quote.priceFen) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '支付金额与订单金额不一致');
    }
    const now = new Date().toISOString();
    let already: PaymentRecord | null = null;
    try {
      await this.app.store.write(async client => {
        const fresh = await this.orderRecordForUpdate(orderId, client);
        const payments = await this.paymentsFor(orderId, client);
        const verifiedRow = payments.find(payment => payment.mode === this.payments.mode && payment.status === 'VERIFIED');
        if (verifiedRow) { already = verifiedRow; return; }
        if (!['AWAITING_PAYMENT', 'EXPIRED'].includes(fresh.status)) {
          throw new AppError(409, 'INVALID_STATE', '当前订单状态不接受支付凭证');
        }
        const duplicate = (await client.query(
          `SELECT id FROM commerce_payments
           WHERE (proof_hash=$1 OR ($2::text IS NOT NULL AND provider_trade_no=$2)) AND id<>$3 LIMIT 1`,
          [canonicalHash, verified.providerTradeNo, matched.paymentId],
        )).rows[0];
        if (duplicate) throw new AppError(409, 'PROOF_ALREADY_USED', '该支付凭证已用于其他订单');
        const nextPayment = PaymentRecordSchema.parse({
          ...matched, status: 'VERIFIED', providerTradeNo: verified.providerTradeNo, verifiedAt: now,
        });
        const updated = await client.query(
          `UPDATE commerce_payments SET status='VERIFIED',proof_hash=$2,provider_trade_no=$3,verified_at=now(),document=$4
           WHERE id=$1 AND status<>'VERIFIED'`,
          [matched.paymentId, canonicalHash, verified.providerTradeNo, nextPayment],
        );
        if (!updated.rowCount) {
          const latest = await this.paymentById(orderId, matched.paymentId);
          if (latest?.status === 'VERIFIED') { already = latest; return; }
          throw new AppError(409, 'INVALID_STATE', '支付记录状态已经变化');
        }
        const nextOrder = OrderRecordSchema.parse({
          ...fresh, status: 'READY', paidAt: now, version: fresh.version + 1, updatedAt: now,
        });
        const moved = await client.query(
          'UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1 AND version=$5',
          [orderId, nextOrder.status, nextOrder, nextOrder.version, fresh.version],
        );
        if (!moved.rowCount) throw new AppError(409, 'INVALID_STATE', '订单状态已经变化，请重新查询订单');
        await this.emit(client, orderId, 'PAYMENT_VERIFIED', 'PAYMENT', {
          providerTradeNo: verified.providerTradeNo, official: this.payments.official, orderReference: verified.orderReference,
          attempt: matched.attempt,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'PROOF_ALREADY_USED', '该支付凭证已被使用');
      throw error;
    }
    if (already) return this.verifiedResponse(orderId, already);
    await this.startExecution(orderId);
    return this.verifiedResponse(orderId, { ...matched, status: 'VERIFIED', providerTradeNo: verified.providerTradeNo, verifiedAt: now });
  }

  private proofCandidate(currentMode: PaymentRecord[], proof: ReturnType<typeof decodePaymentProof>) {
    return this.payments.simulated
      ? currentMode.find(payment => payment.providerTradeNo && payment.providerTradeNo === proof.protocol.trade_no)
        ?? currentMode.find(payment => payment.status !== 'FAILED') ?? currentMode[0]
      : currentMode.find(payment => payment.status === 'PENDING')
        ?? currentMode.find(payment => payment.status === 'EXPIRED')
        ?? currentMode.find(payment => payment.status === 'UNKNOWN')
        ?? currentMode.find(payment => payment.status === 'PREPARING') ?? currentMode[0];
  }

  private async verifyLatePayment(
    orderId: string,
    record: OrderRecord,
    proof: ReturnType<typeof decodePaymentProof>,
    header: string,
    canonicalHash: string,
    currentMode: PaymentRecord[],
  ) {
    if (!currentMode.length) {
      throw new AppError(409, 'PAYMENT_MODE_MISMATCH', '订单支付尝试与当前支付模式不一致');
    }
    const candidate = this.proofCandidate(currentMode, proof);
    const expected: VerifyExpected | null = this.payments.simulated ? {
      orderReference: candidate.orderReference, serviceId: record.quote.serviceId,
      amountFen: record.quote.priceFen, binding: candidate.binding, providerTradeNo: candidate.providerTradeNo,
    } : null;
    const verified = await this.payments.verify({ proof, header, expected });
    if (verified.providerTradeNo !== proof.protocol.trade_no) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '支付凭证交易号不一致');
    }
    const matched = (verified.orderReference
      ? currentMode.find(payment => payment.orderReference === verified.orderReference)
      : candidate) ?? null;
    if (!matched) throw new AppError(402, 'PAYMENT_MISMATCH', '支付凭证不属于该订单');
    if (verified.amountFen !== null && verified.amountFen !== record.quote.priceFen) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '支付金额与订单金额不一致');
    }
    const now = new Date().toISOString();
    let result: PaymentRecord | null = null;
    try {
      await this.app.store.write(async client => {
        const duplicate = (await client.query(
          `SELECT id FROM commerce_payments
           WHERE (proof_hash=$1 OR ($2::text IS NOT NULL AND provider_trade_no=$2)) AND id<>$3 LIMIT 1`,
          [canonicalHash, verified.providerTradeNo, matched.paymentId],
        )).rows[0];
        if (duplicate) throw new AppError(409, 'PROOF_ALREADY_USED', '该支付凭证已用于其他订单');
        const next = PaymentRecordSchema.parse({
          ...matched, status: 'VERIFIED', providerTradeNo: verified.providerTradeNo, verifiedAt: now,
        });
        const updated = await client.query(
          `UPDATE commerce_payments SET status='VERIFIED',proof_hash=$2,provider_trade_no=$3,verified_at=now(),document=$4
           WHERE id=$1 AND status<>'VERIFIED'`,
          [matched.paymentId, canonicalHash, verified.providerTradeNo, next],
        );
        if (updated.rowCount) {
          result = next;
        } else {
          const latest = await this.paymentById(orderId, matched.paymentId);
          if (latest?.status !== 'VERIFIED') throw new AppError(409, 'INVALID_STATE', '支付记录状态已经变化');
          result = latest;
        }
        await this.emit(client, orderId, 'PAYMENT_VERIFIED_LATE', 'PAYMENT', {
          providerTradeNo: verified.providerTradeNo, attempt: matched.attempt, orderStatus: record.status,
          note: '迟到支付凭证只补记售后证据，不改变订单状态，也不重新启动工作流',
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'PROOF_ALREADY_USED', '该支付凭证已被使用');
      throw error;
    }
    return this.verifiedResponse(orderId, result!);
  }

  private verifiedResponse(orderId: string, payment: PaymentRecord) {
    return PaymentProofResponseSchema.parse({
      orderId, status: 'VERIFIED', official: this.payments.official, simulated: this.payments.simulated,
      providerTradeNo: payment.providerTradeNo, verifiedAt: payment.verifiedAt,
    });
  }

  /**
   * 运营在支付宝后台人工核对后关闭一次未确认的预下单。
   * 该接口只允许把 UNKNOWN/PREPARING 标记为 FAILED，不能把支付伪造成已付款。
   */
  async reconcilePayment(principal: Principal, orderId: string, input: unknown) {
    admin(principal);
    const request = ReconcilePaymentRequestSchema.parse(input);
    const record = await this.orderRecord(CollaborationIdSchema.parse(orderId));
    const payments = await this.paymentsFor(record.orderId);
    const payment = payments.find(item => item.paymentId === request.paymentId && item.mode === this.payments.mode);
    if (!payment) throw new AppError(404, 'NOT_FOUND', '支付尝试不存在');
    if (payment.status !== 'UNKNOWN' && payment.status !== 'PREPARING') {
      throw new AppError(409, 'INVALID_STATE', '只有结果未知或未完成的预下单可以人工关闭');
    }
    await this.app.store.write(async client => {
      const next = PaymentRecordSchema.parse({
        ...payment, status: 'FAILED', failureCode: `MANUAL_CLOSE_${request.externalState}`, failureMessage: request.reason,
      });
      const updated = await client.query(
        'UPDATE commerce_payments SET status=$2,document=$3 WHERE id=$1 AND status=$4',
        [payment.paymentId, 'FAILED', next, payment.status],
      );
      if (!updated.rowCount) throw new AppError(409, 'INVALID_STATE', '支付记录状态已经变化，请重新查询订单');
      await this.emit(client, record.orderId, 'PAYMENT_MANUALLY_CLOSED', 'PAYMENT', {
        paymentId: payment.paymentId, attempt: payment.attempt, orderReference: payment.orderReference,
        previousStatus: payment.status, externalState: request.externalState, reason: request.reason,
      });
    });
    return this.detail(record.orderId);
  }

  private async startExecution(orderId: string) {
    const now = new Date().toISOString();
    const started = await this.app.store.write(async client => {
      const current = await this.orderRecordForUpdate(orderId, client);
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
      const moved = await client.query(
        'UPDATE commerce_orders SET status=$2,task_id=$3,document=$4,version=$5,updated_at=now() WHERE id=$1 AND version=$6',
        [orderId, next.status, task.taskId, next, next.version, current.version],
      );
      if (!moved.rowCount) throw new AppError(409, 'INVALID_STATE', '订单状态已经变化，无法开始执行');
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
      const fresh = await this.orderRecordForUpdate(orderId, client);
      if (fresh.deliveryId || !fresh.taskId) return;
      const inserted = await client.query(
        `INSERT INTO commerce_deliveries(id,order_id,version,task_id,content,content_hash,document)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (order_id,version) DO NOTHING RETURNING id`,
        [delivery.deliveryId, orderId, delivery.version, fresh.taskId, delivery.cleanedCsv, delivery.contentHash, delivery],
      );
      if (!inserted.rowCount) return;
      const next = OrderRecordSchema.parse({
        ...fresh, status: 'DELIVERED', deliveryId: delivery.deliveryId, deliveryVersion: 1, deliveredAt: now, version: fresh.version + 1, updatedAt: now,
      });
      const moved = await client.query(
        'UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1 AND version=$5',
        [orderId, next.status, next, next.version, fresh.version],
      );
      if (!moved.rowCount) throw new AppError(409, 'INVALID_STATE', '订单状态已经变化，无法记录交付');
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
    try {
      await this.app.store.write(async client => {
        const fresh = await this.orderRecordForUpdate(orderId, client);
        const accepted = (await client.query('SELECT id FROM commerce_acceptances WHERE order_id=$1', [orderId])).rows[0];
        if (accepted) throw new AppError(409, 'ALREADY_ACCEPTED', '该订单已经完成验收');
        if (fresh.status !== 'DELIVERED') throw new AppError(409, 'INVALID_STATE', '订单尚未交付，不能验收');
        await client.query('INSERT INTO commerce_acceptances(id,order_id,decision,document) VALUES($1,$2,$3,$4)', [acceptance.acceptanceId, orderId, acceptance.decision, acceptance]);
        const next = OrderRecordSchema.parse({
          ...fresh, status: request.decision, acceptance, version: fresh.version + 1, updatedAt: now,
        });
        const moved = await client.query(
          'UPDATE commerce_orders SET status=$2,document=$3,version=$4,updated_at=now() WHERE id=$1 AND version=$5',
          [orderId, next.status, next, next.version, fresh.version],
        );
        if (!moved.rowCount) throw new AppError(409, 'INVALID_STATE', '订单状态已经变化，无法记录验收');
        await this.emit(client, orderId, 'ACCEPTANCE_RECORDED', 'BUYER', { decision: request.decision, rating: request.rating });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'ALREADY_ACCEPTED', '该订单已经完成验收');
      throw error;
    }
    return acceptance;
  }

  private paymentRequired(record: OrderRecord, payment: PaymentRequestResponse) {
    return new AppError(402, 'PAYMENT_REQUIRED', '该订单尚未支付', {
      headers: payment.paymentLink ? { amtPaymentLink: payment.paymentLink } : undefined,
      details: {
        payment: {
          orderId: record.orderId, mode: payment.mode, official: payment.official, simulated: payment.simulated,
          amountFen: payment.amountFen, currency: payment.currency, status: payment.status,
          paymentLink: payment.paymentLink, prepay: payment.prepay, simulatedProof: payment.simulatedProof,
          instruction: payment.instruction,
        },
      },
    });
  }

  private async accessPayment(principal: Principal, orderId: string) {
    try {
      return await this.requestPayment(principal, orderId);
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'PAYMENT_PREPARING')) throw error;
      const payments = await this.paymentsFor(orderId);
      const payment = payments.find(item => item.mode === this.payments.mode && item.prepayId);
      if (!payment) throw error;
      return this.paymentResponse(await this.orderRecord(orderId), payment);
    }
  }

  async delivery(principal: Principal, orderId: string, proofHeader?: string) {
    await this.owned(principal, orderId);
    if (proofHeader) {
      try { await this.submitPaymentProof(principal, orderId, proofHeader); }
      catch (error) { if (!(error instanceof AppError && error.status === 402)) throw error; }
    }
    let record = await this.refresh(CollaborationIdSchema.parse(orderId));
    if (!record.deliveryId && record.status === 'AWAITING_PAYMENT') {
      const payment = await this.accessPayment(principal, orderId);
      if (payment.status === 'VERIFIED') record = await this.refresh(orderId);
      else throw this.paymentRequired(record, payment);
    }
    if (!record.deliveryId) throw new AppError(404, 'NOT_FOUND', '该订单尚无交付');
    const row = requireValue((await this.app.db.pool.query('SELECT content,content_hash FROM commerce_deliveries WHERE id=$1', [record.deliveryId])).rows[0]);
    return DeliveryDownloadSchema.parse({ orderId, version: record.deliveryVersion, contentHash: row.content_hash, content: row.content });
  }

  async execution(principal: Principal, orderId: string, proofHeader?: string) {
    await this.owned(principal, orderId);
    if (proofHeader) {
      try { await this.submitPaymentProof(principal, orderId, proofHeader); }
      catch (error) { if (!(error instanceof AppError && error.status === 402)) throw error; }
    }
    const record = await this.refresh(CollaborationIdSchema.parse(orderId));
    if (record.status === 'AWAITING_PAYMENT') {
      const payment = await this.accessPayment(principal, orderId);
      if (payment.status === 'VERIFIED') return this.executionSummary(await this.refresh(orderId));
      throw this.paymentRequired(record, payment);
    }
    return this.executionSummary(record);
  }
}
