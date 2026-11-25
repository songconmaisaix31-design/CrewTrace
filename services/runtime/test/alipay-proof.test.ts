import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors.js';
import { decodePaymentProof } from '../src/payment.js';
import { parseProofHeader, verificationChecks } from '../scripts/alipay-sandbox-acceptance.js';

const INNER_PROOF = 'a1'.repeat(32);
const TRADE_NO = '2026112222001234567890';

function proofHeader(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    protocol: { payment_proof: INNER_PROOF, trade_no: TRADE_NO },
    method: { client_session: 'sess-1' },
    ...overrides,
  })).toString('base64');
}

test('Payment-Proof 请求头是 Base64 JSON，payment_proof 只是其中的字段', () => {
  const parsed = parseProofHeader(proofHeader());
  assert.equal(parsed.proof.protocol.payment_proof, INNER_PROOF);
  assert.equal(parsed.proof.protocol.trade_no, TRADE_NO);
  assert.equal(parsed.proof.method.client_session, 'sess-1');
  assert.ok(parsed.headerChars > parsed.paymentProofChars);
  assert.equal(parsed.paymentProofChars, 64);
  assert.throws(
    () => parseProofHeader(INNER_PROOF),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_PROOF' && error.message.includes('Base64'),
  );
  assert.throws(
    () => decodePaymentProof(Buffer.from(JSON.stringify({ protocol: { payment_proof: INNER_PROOF } })).toString('base64')),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_PROOF',
  );
});

test('验付响应严格核对 out_trade_no、trade_no 与金额', () => {
  const expected = { tradeNo: TRADE_NO, outTradeNo: 'RC1234567890', amount: '0.01' };
  const response = {
    code: '10000', active: true, trade_no: TRADE_NO, out_trade_no: 'RC1234567890', amount: '0.01',
  };
  assert.deepEqual(verificationChecks(response, expected), {
    checks: { code: true, active: true, tradeNoMatches: true, outTradeNoMatches: true, amountMatches: true },
    verified: true,
  });
  for (const patch of [
    { trade_no: '2026112222009999999999' },
    { out_trade_no: 'RC0000000000' },
    { amount: '0.02' },
    { amount: 'abc' },
    { active: false },
    { code: '40004' },
  ]) {
    const result = verificationChecks({ ...response, ...patch }, expected);
    assert.equal(result.verified, false, JSON.stringify(patch));
  }
});
