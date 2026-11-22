import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AlipaySdk } from 'alipay-sdk';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';

export const PaymentProofSchema = z.strictObject({
  protocol: z.strictObject({
    payment_proof: z.string().length(64),
    trade_no: z.string().min(1).max(64),
  }),
  method: z.strictObject({ client_session: z.string().min(1).max(1024).optional() }),
});
export type PaymentProof = z.infer<typeof PaymentProofSchema>;

export function decodePaymentProof(header: string): PaymentProof {
  if (header.length > 20000 || !z.base64().safeParse(header).success) {
    throw new AppError(400, 'INVALID_PROOF', 'Payment-Proof 必须为 Base64 编码的 JSON');
  }
  try {
    return PaymentProofSchema.parse(JSON.parse(Buffer.from(header, 'base64').toString('utf8')));
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError(400, 'INVALID_PROOF', 'Payment-Proof 结构不正确');
  }
}

export function proofHash(header: string): string {
  return createHash('sha256').update(header).digest('hex');
}

export function money(fen: number): string {
  return (fen / 100).toFixed(2);
}

export function amountFen(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,6}(\.\d{1,2})?$/.test(value)) {
    throw new AppError(502, 'PAYMENT_AMOUNT_INVALID', '支付宝返回的金额格式异常');
  }
  const [yuan, cents = ''] = value.split('.');
  return Number(yuan) * 100 + Number(cents.padEnd(2, '0'));
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 支付宝按量付费单笔金额上限为 50 元。 */
export const ALIPAY_AMOUNT_LIMIT_FEN = 5000;
const ALIPAY_SERVICE_ID = /^[A-Za-z0-9_.-]{1,32}$/;

/** 支付宝按量付费后台分配的服务标识，与内部 serviceId 完全独立。 */
export function officialServiceIds(config: Config): Record<string, string> {
  if (!config.ALIPAY_SERVICE_IDS) {
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', '官方支付宝模式缺少 ALIPAY_SERVICE_IDS 服务映射');
  }
  const parsed: unknown = JSON.parse(config.ALIPAY_SERVICE_IDS);
  const result: Record<string, string> = {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(503, 'PAYMENT_CONFIG_INVALID', 'ALIPAY_SERVICE_IDS 必须是内部 serviceId 到官方 service_id 的 JSON 对象');
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !ALIPAY_SERVICE_ID.test(value)) {
      throw new AppError(503, 'PAYMENT_CONFIG_INVALID', `ALIPAY_SERVICE_IDS 中 ${key} 的官方 service_id 不合法`);
    }
    result[key] = value;
  }
  return result;
}

export function resolveOfficialServiceId(serviceIds: Record<string, string>, internalServiceId: string): string {
  const official = serviceIds[internalServiceId];
  if (!official) throw new AppError(503, 'PAYMENT_SERVICE_UNMAPPED', '该服务尚未在支付宝按量付费后台注册 service_id');
  return official;
}

/** 官方要求 pay_before 使用带时区的 ISO 8601 时间，截止时间不超过当前时间 12 小时。 */
export function alipayPayBefore(date: Date): string {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
  return `${local.replace(' ', 'T')}+08:00`;
}

export interface AlipayPrecreateInput {
  orderReference: string;
  officialServiceId: string;
  title: string;
  amountFen: number;
  payBefore: string;
}

/** 按官方预下单接口组装 biz_content；官方字段与内部服务标识在此完成最后一道校验。 */
export function alipayPrecreateBiz(input: AlipayPrecreateInput): Record<string, string> {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.orderReference)) {
    throw new AppError(422, 'PAYMENT_FIELD_INVALID', '商户订单号必须为 1 至 32 位字母、数字、下划线或连字符');
  }
  if (!ALIPAY_SERVICE_ID.test(input.officialServiceId)) {
    throw new AppError(503, 'PAYMENT_SERVICE_UNMAPPED', '支付宝官方 service_id 不合法');
  }
  if (input.title.length < 1 || input.title.length > 32) {
    throw new AppError(422, 'PAYMENT_FIELD_INVALID', '商品名称长度必须在 1 至 32 字符之间');
  }
  if (!Number.isInteger(input.amountFen) || input.amountFen <= 0 || input.amountFen > ALIPAY_AMOUNT_LIMIT_FEN) {
    throw new AppError(422, 'PAYMENT_AMOUNT_LIMIT', '支付宝按量付费单笔金额必须在 0.01 元至 50 元之间');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(input.payBefore)) {
    throw new AppError(422, 'PAYMENT_FIELD_INVALID', 'pay_before 必须使用 +08:00 时区的 ISO 8601 格式');
  }
  return {
    out_trade_no: input.orderReference,
    service_id: input.officialServiceId,
    goods_name: input.title,
    amount: money(input.amountFen),
    currency: 'CNY',
    pay_before: input.payBefore,
  };
}

export interface PrepayInput {
  orderReference: string;
  /** 内部服务标识，官方适配层会映射为支付宝分配的 service_id。 */
  serviceId: string;
  title: string;
  amountFen: number;
  payBefore: string;
}
export interface PrepayResult {
  prepayId: string;
  qrCodeUrl: string | null;
  providerTradeNo: string | null;
  /** 内部模拟模式的本地绑定串，只写入服务端存储，绝不出现在接口响应里。 */
  binding: string | null;
  simulatedProof: string | null;
}
export interface VerifyExpected {
  orderReference: string;
  serviceId: string;
  amountFen: number;
  binding: string | null;
  providerTradeNo: string | null;
}
export interface VerifyInput {
  proof: PaymentProof;
  header: string;
  /** simulated 模式必须提供本地候选支付记录；官方模式由支付宝返回外部商户订单号。 */
  expected: VerifyExpected | null;
}
export interface VerifyResult {
  providerTradeNo: string;
  orderReference: string | null;
  amountFen: number | null;
}
export interface PaymentProvider {
  readonly mode: 'disabled' | 'sandbox' | 'production' | 'simulated';
  readonly official: boolean;
  readonly simulated: boolean;
  precreate(input: PrepayInput): Promise<PrepayResult>;
  verify(input: VerifyInput): Promise<VerifyResult>;
}

export class DisabledPayment implements PaymentProvider {
  readonly mode = 'disabled' as const;
  readonly official = false;
  readonly simulated = false;
  async precreate(): Promise<PrepayResult> {
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', '默认未开通支付宝支付，收费服务暂不可支付');
  }
  async verify(): Promise<never> {
    throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', '默认未开通支付宝支付，收费服务暂不可支付');
  }
}

export class AlipayPayment implements PaymentProvider {
  readonly official = true;
  readonly simulated = false;
  private readonly sdk: AlipaySdk;
  private readonly serviceIds: Record<string, string>;
  constructor(readonly mode: 'sandbox' | 'production', config: Config) {
    this.serviceIds = officialServiceIds(config);
    this.sdk = new AlipaySdk({
      appId: config.ALIPAY_APP_ID!,
      privateKey: config.ALIPAY_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      alipayPublicKey: config.ALIPAY_PUBLIC_KEY!.replace(/\\n/g, '\n'),
      keyType: config.ALIPAY_KEY_TYPE,
      signType: 'RSA2',
      camelcase: false,
      timeout: 8000,
      gateway: config.ALIPAY_GATEWAY
        ?? (mode === 'production' ? 'https://openapi.alipay.com/gateway.do' : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'),
    });
  }

  private async call(method: string, bizContent: Record<string, string>, failure: { status: number; code: string; message: string }): Promise<Record<string, unknown>> {
    let result: Record<string, unknown>;
    try {
      // 强制验签，避免把未签名的返回当作支付成功。
      result = await this.sdk.exec(method, { bizContent }, { validateSign: true }) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'ALIPAY_UNAVAILABLE', '支付宝接口暂时不可用');
    }
    if (result.code !== '10000') throw new AppError(failure.status, failure.code, failure.message);
    return result;
  }

  async precreate(input: PrepayInput): Promise<PrepayResult> {
    const biz = alipayPrecreateBiz({
      orderReference: input.orderReference,
      officialServiceId: resolveOfficialServiceId(this.serviceIds, input.serviceId),
      title: input.title,
      amountFen: input.amountFen,
      payBefore: input.payBefore,
    });
    const result = await this.call('alipay.aipay.agent.payment.precreate', biz, {
      status: 502, code: 'ALIPAY_REJECTED', message: '支付宝未确认本次预下单，请稍后重试',
    });
    if (typeof result.amt_pre_pay_id !== 'string' || !result.amt_pre_pay_id || result.amt_pre_pay_id.length > 512) {
      throw new AppError(502, 'INVALID_PREPAY', '支付宝未返回有效的预下单号');
    }
    return {
      prepayId: result.amt_pre_pay_id, qrCodeUrl: null, providerTradeNo: null, binding: null, simulatedProof: null,
    };
  }

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const { protocol, method } = input.proof;
    const biz: Record<string, string> = { trade_no: protocol.trade_no, payment_proof: protocol.payment_proof };
    if (method.client_session) biz.client_session = method.client_session;
    const result = await this.call('alipay.aipay.agent.payment.verify', biz, {
      status: 402, code: 'PAYMENT_REJECTED', message: '支付宝未确认该支付凭证',
    });
    if (result.active !== true) throw new AppError(402, 'PAYMENT_REJECTED', '支付凭证未生效');
    if (typeof result.trade_no !== 'string' || result.trade_no !== protocol.trade_no) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '支付宝交易号与支付凭证不一致');
    }
    if (typeof result.out_trade_no !== 'string' || !result.out_trade_no) {
      throw new AppError(502, 'INVALID_PAYMENT_RESPONSE', '支付宝未返回外部商户订单号');
    }
    return {
      providerTradeNo: result.trade_no,
      orderReference: result.out_trade_no,
      amountFen: amountFen(result.amount),
    };
  }
}

export class SimulatedPayment implements PaymentProvider {
  readonly mode = 'simulated' as const;
  readonly official = false;
  readonly simulated = true;
  constructor(private readonly secret: string) {
    if (process.env.NODE_ENV === 'production') throw new Error('simulated 支付模式禁止在生产环境启用');
    if (secret.length < 32) throw new Error('simulated 支付模式需要至少 32 位的本地签名密钥');
  }
  private sign(input: { orderReference: string; serviceId: string; amountFen: number; tradeNo: string; paymentProof: string; clientSession: string }) {
    return createHmac('sha256', this.secret)
      .update([input.orderReference, input.serviceId, String(input.amountFen), input.tradeNo, input.paymentProof, input.clientSession].join('|'))
      .digest('hex');
  }
  async precreate(input: PrepayInput): Promise<PrepayResult> {
    const tradeNo = `SIM${randomBytes(20).toString('hex')}`;
    const paymentProof = randomBytes(32).toString('hex');
    const clientSession = randomBytes(32).toString('hex');
    const header = Buffer.from(JSON.stringify({
      protocol: { payment_proof: paymentProof, trade_no: tradeNo },
      method: { client_session: clientSession },
    })).toString('base64');
    return {
      prepayId: `SIM-PREPAY-${randomBytes(12).toString('hex')}`,
      qrCodeUrl: null,
      providerTradeNo: tradeNo,
      binding: this.sign({ ...input, tradeNo, paymentProof, clientSession }),
      // 仅 simulated 模式返回内部模拟凭证，用于验证状态机；它不是支付宝官方支付结果。
      simulatedProof: header,
    };
  }
  async verify(input: VerifyInput): Promise<VerifyResult> {
    const expected = input.expected;
    if (!expected) throw new AppError(409, 'PAYMENT_MODE_MISMATCH', '当前支付模式不接受模拟凭证');
    const { protocol, method } = input.proof;
    if (expected.providerTradeNo && protocol.trade_no !== expected.providerTradeNo) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '模拟支付凭证与本订单预下单号不匹配');
    }
    const binding = this.sign({
      orderReference: expected.orderReference,
      serviceId: expected.serviceId,
      amountFen: expected.amountFen,
      tradeNo: protocol.trade_no,
      paymentProof: protocol.payment_proof,
      clientSession: method.client_session ?? '',
    });
    if (!expected.binding || !constantTimeEqual(expected.binding, binding)) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '模拟支付凭证校验失败');
    }
    return { providerTradeNo: protocol.trade_no, orderReference: expected.orderReference, amountFen: expected.amountFen };
  }
}

export function createPaymentProvider(config: Config): PaymentProvider {
  if (config.PAYMENT_MODE === 'simulated') return new SimulatedPayment(config.PAYMENT_SIMULATION_SECRET!);
  if (config.PAYMENT_MODE === 'sandbox' || config.PAYMENT_MODE === 'production') {
    return new AlipayPayment(config.PAYMENT_MODE, config);
  }
  return new DisabledPayment();
}
