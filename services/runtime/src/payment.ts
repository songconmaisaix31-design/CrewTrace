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
  method: z.strictObject({ client_session: z.string().min(1).max(1024) }),
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

export interface PrepayInput {
  orderReference: string;
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
export interface VerifyInput {
  proof: PaymentProof;
  header: string;
  orderReference: string;
  serviceId: string;
  amountFen: number;
  expectedProviderTradeNo: string | null;
  binding: string | null;
}
export interface PaymentProvider {
  readonly mode: 'disabled' | 'sandbox' | 'production' | 'simulated';
  readonly official: boolean;
  readonly simulated: boolean;
  precreate(input: PrepayInput): Promise<PrepayResult>;
  verify(input: VerifyInput): Promise<{ providerTradeNo: string }>;
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
  constructor(readonly mode: 'sandbox' | 'production', config: Config) {
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
  private async call(method: string, bizContent: Record<string, unknown>): Promise<Record<string, unknown>> {
    // 使用官方 Machine Pay v2 方法名并强制验签，避免把未签名的返回当作支付成功。
    const result = await this.sdk.exec(method, { bizContent }, { validateSign: true }) as Record<string, unknown>;
    if (result.code !== '10000') {
      throw new AppError(502, 'ALIPAY_REJECTED', '支付宝未确认本次请求，请保留订单后重试');
    }
    return result;
  }
  async precreate(input: PrepayInput): Promise<PrepayResult> {
    const result = await this.call('alipay.aipay.agent.payment.precreate', {
      out_trade_no: input.orderReference,
      service_id: input.serviceId,
      goods_name: input.title,
      amount: money(input.amountFen),
      currency: 'CNY',
      pay_before: input.payBefore,
    });
    if (typeof result.amt_pre_pay_id !== 'string' || !result.amt_pre_pay_id) {
      throw new AppError(502, 'INVALID_PREPAY', '支付宝未返回预下单号');
    }
    const qr = typeof result.qr_code_url === 'string' && result.qr_code_url.startsWith('https://') ? result.qr_code_url : null;
    return { prepayId: result.amt_pre_pay_id, qrCodeUrl: qr, providerTradeNo: null, binding: null, simulatedProof: null };
  }
  async verify(input: VerifyInput): Promise<{ providerTradeNo: string }> {
    const { protocol, method } = input.proof;
    const result = await this.call('alipay.aipay.agent.payment.verify', {
      trade_no: protocol.trade_no,
      payment_proof: protocol.payment_proof,
      client_session: method.client_session,
    });
    if (result.active !== true || result.trade_no !== protocol.trade_no
      || result.out_trade_no !== input.orderReference
      || result.resource_id !== input.serviceId
      || amountFen(result.amount) !== input.amountFen) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '支付凭证与本订单、服务或金额不匹配');
    }
    return { providerTradeNo: protocol.trade_no };
  }
}

export class SimulatedPayment implements PaymentProvider {
  readonly mode = 'simulated' as const;
  readonly official = false;
  readonly simulated = true;
  constructor(private readonly secret: string) {}
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
  async verify(input: VerifyInput): Promise<{ providerTradeNo: string }> {
    const { protocol, method } = input.proof;
    if (input.expectedProviderTradeNo && protocol.trade_no !== input.expectedProviderTradeNo) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '模拟支付凭证与本订单预下单号不匹配');
    }
    const expected = this.sign({
      orderReference: input.orderReference,
      serviceId: input.serviceId,
      amountFen: input.amountFen,
      tradeNo: protocol.trade_no,
      paymentProof: protocol.payment_proof,
      clientSession: method.client_session,
    });
    if (!input.binding || !constantTimeEqual(input.binding, expected)) {
      throw new AppError(402, 'PAYMENT_MISMATCH', '模拟支付凭证校验失败');
    }
    return { providerTradeNo: protocol.trade_no };
  }
}

export function createPaymentProvider(config: Config): PaymentProvider {
  if (config.PAYMENT_MODE === 'simulated') return new SimulatedPayment(config.PAYMENT_SIMULATION_SECRET!);
  if (config.PAYMENT_MODE === 'sandbox' || config.PAYMENT_MODE === 'production') return new AlipayPayment(config.PAYMENT_MODE, config);
  return new DisabledPayment();
}
