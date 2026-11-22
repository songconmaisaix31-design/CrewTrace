import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { AlipaySdk } from 'alipay-sdk';
import { alipayPayBefore } from '../src/payment.js';

/**
 * 支付宝 Machine Pay 沙箱验收脚本。
 *
 * 只使用环境变量中的真实沙箱凭证，不写死密钥，不伪造成功结果。
 * 缺少凭证、未显式确认沙箱、网关不是沙箱地址时以 BLOCKED 退出。
 */

const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';

function fail(reason: string, detail?: unknown): never {
  writeSync(2, `${JSON.stringify({ status: 'BLOCKED', reason, detail }, null, 2)}\n`);
  process.exit(2);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`环境变量 ${name} 未设置`);
  return value;
}

function mask(value: string) {
  return value.length <= 8 ? '***' : `${value.slice(0, 4)}***${value.slice(-4)}`;
}

if (process.env.ALIPAY_SANDBOX_CONFIRM !== 'yes') {
  fail('必须显式设置 ALIPAY_SANDBOX_CONFIRM=yes，避免对真实账户发起误操作');
}

const gateway = process.env.ALIPAY_GATEWAY?.trim() || SANDBOX_GATEWAY;
if (!gateway.includes('sandbox')) {
  fail('验收脚本只允许连接支付宝沙箱网关', { gateway });
}

const appId = required('ALIPAY_APP_ID');
const privateKey = required('ALIPAY_PRIVATE_KEY').replace(/\\n/g, '\n');
const publicKey = required('ALIPAY_PUBLIC_KEY').replace(/\\n/g, '\n');

let officialServiceId = process.env.ALIPAY_SERVICE_ID?.trim();
if (!officialServiceId) {
  const mapping = required('ALIPAY_SERVICE_IDS');
  let parsed: unknown;
  try { parsed = JSON.parse(mapping); } catch { fail('ALIPAY_SERVICE_IDS 不是合法 JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('ALIPAY_SERVICE_IDS 必须是对象');
  const internal = process.env.ALIPAY_INTERNAL_SERVICE_ID?.trim() || 'csv-clean-verify';
  officialServiceId = (parsed as Record<string, unknown>)[internal] as string | undefined;
  if (!officialServiceId) fail(`ALIPAY_SERVICE_IDS 中缺少内部服务 ${internal} 的官方 service_id`);
}
if (!/^[A-Za-z0-9_.-]{1,32}$/.test(officialServiceId)) {
  fail('官方 service_id 必须为 1 至 32 位字母、数字、下划线、点或连字符', { officialServiceId });
}

const sdk = new AlipaySdk({
  appId,
  privateKey,
  alipayPublicKey: publicKey,
  keyType: (process.env.ALIPAY_KEY_TYPE as 'PKCS1' | 'PKCS8' | undefined) ?? 'PKCS8',
  signType: 'RSA2',
  camelcase: false,
  timeout: 15000,
  gateway,
});

const amount = process.env.ALIPAY_AMOUNT_YUAN?.trim() || '0.01';
if (!/^\d{1,2}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 50) {
  fail('ALIPAY_AMOUNT_YUAN 必须是 0.01 至 50 之间的金额', { amount });
}

const orderReference = `RC${Date.now().toString(36)}${createHash('sha256').update(`${appId}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12)}`.slice(0, 32);
const payBefore = alipayPayBefore(new Date(Date.now() + 10 * 60 * 1000));

const bizContent: Record<string, string> = {
  out_trade_no: orderReference,
  service_id: officialServiceId,
  goods_name: process.env.ALIPAY_GOODS_NAME?.trim() || 'CrewTrace CSV 清洗验收',
  amount,
  currency: 'CNY',
  pay_before: payBefore,
};

console.log(JSON.stringify({
  status: 'READY',
  gateway,
  appId: mask(appId),
  internalServiceId: process.env.ALIPAY_INTERNAL_SERVICE_ID?.trim() || 'csv-clean-verify',
  officialServiceId,
  outTradeNo: orderReference,
  amount,
  payBefore,
}, null, 2));

let precreate: Record<string, unknown>;
try {
  precreate = await sdk.exec('alipay.aipay.agent.payment.precreate', { bizContent }, { validateSign: true }) as Record<string, unknown>;
} catch (error) {
  // 网络、超时、验签失败都代表外部结果未知，不能据此判定远端没有创建交易。
  writeSync(2, `${JSON.stringify({
    status: 'BLOCKED', reason: 'precreate 调用未获得可验证响应，外部结果未知',
    externalState: 'UNKNOWN', retrySameOrderReference: true, outTradeNo: orderReference,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exit(2);
}

const precreateOk = precreate.code === '10000' && typeof precreate.amt_pre_pay_id === 'string' && precreate.amt_pre_pay_id.length > 0;
console.log(JSON.stringify({
  status: precreateOk ? 'PRECREATE_OK' : 'PRECREATE_FAILED',
  code: precreate.code,
  subCode: precreate.sub_code ?? null,
  message: precreate.msg ?? precreate.sub_msg ?? null,
  amtPrePayId: precreate.amt_pre_pay_id ?? null,
  outTradeNo: orderReference,
}, null, 2));
if (!precreateOk) {
  // 明确失败与结果未知分开处理，未知时提示使用同一 out_trade_no 重试或人工核对。
  const subCode = typeof precreate.sub_code === 'string' ? precreate.sub_code : '';
  const unknown = precreate.code === '20000'
    || (precreate.code === '40004' && !subCode)
    || ['SYSTEM_ERROR', 'isp.unknow-error', 'ACQ.SYSTEM_ERROR', 'aipay.unknown-error'].includes(subCode);
  writeSync(2, `${JSON.stringify({
    externalState: unknown ? 'UNKNOWN' : 'REJECTED',
    action: unknown ? '使用同一 out_trade_no 重试，不要创建第二笔交易' : '修正参数后重新发起预下单',
  }, null, 2)}\n`);
  process.exit(unknown ? 2 : 1);
}

const tradeNo = process.env.ALIPAY_TRADE_NO?.trim();
const paymentProof = process.env.ALIPAY_PAYMENT_PROOF?.trim();
if (!tradeNo || !paymentProof) {
  console.log(JSON.stringify({
    status: 'AWAITING_PROOF',
    reason: '已完成真实沙箱预下单；设置 ALIPAY_TRADE_NO 与 ALIPAY_PAYMENT_PROOF 后可继续验付',
    outTradeNo: orderReference,
    amount,
    instruction: '在沙箱买家账户完成支付，从 Payment-Proof 请求头复制 trade_no 与 payment_proof',
  }, null, 2));
  process.exitCode = 0;
} else {
  if (!/^[A-Za-z0-9+/=]{100,20000}$/.test(paymentProof)) fail('ALIPAY_PAYMENT_PROOF 必须是 Base64 编码的 Payment-Proof 请求头');

  let verify: Record<string, unknown>;
  try {
    verify = await sdk.exec('alipay.aipay.agent.payment.verify', {
      bizContent: {
        trade_no: tradeNo,
        payment_proof: paymentProof,
        ...(process.env.ALIPAY_CLIENT_SESSION ? { client_session: process.env.ALIPAY_CLIENT_SESSION } : {}),
      },
    }, { validateSign: true }) as Record<string, unknown>;
  } catch (error) {
    writeSync(2, `${JSON.stringify({
      status: 'VERIFY_UNCONFIRMED', reason: '验付调用未获得可验证响应', tradeNo,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`);
    process.exit(2);
  }

  const checks = {
    code: verify.code === '10000',
    active: verify.active === true,
    tradeNoMatches: typeof verify.trade_no === 'string' && verify.trade_no === tradeNo,
    outTradeNoPresent: typeof verify.out_trade_no === 'string' && verify.out_trade_no.length > 0,
    amountParsable: typeof verify.amount === 'string' && /^\d{1,6}(\.\d{1,2})?$/.test(verify.amount),
  };
  const verified = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    status: verified ? 'VERIFIED' : 'VERIFY_REJECTED',
    checks,
    code: verify.code ?? null,
    subCode: verify.sub_code ?? null,
    tradeNo: verify.trade_no ?? null,
    outTradeNo: verify.out_trade_no ?? null,
    amount: verify.amount ?? null,
    note: '本结果来自支付宝沙箱验付接口；脚本不会把沙箱结果表述为正式支付成功',
  }, null, 2));
  process.exitCode = verified ? 0 : 2;
}
