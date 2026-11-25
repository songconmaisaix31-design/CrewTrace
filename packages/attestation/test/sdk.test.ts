import test from 'node:test';
import assert from 'node:assert/strict';
import type { FulfillmentAttestation } from '../src/schema.js';
import { verifyAttestation, type VerificationReport } from '../src/verify.js';
import {
  aggregateReputation, DEFAULT_REPUTATION_POLICY, reputationEventKey,
} from '../src/reputation.js';
import { verifyAndAggregateReputation } from '../src/evaluate.js';
import { loadTrustPolicy, type TrustPolicy } from '../src/trust-policy.js';
import { ERROR_CODES, TrustSdkError } from '../src/errors.js';
import { issueFixture, resign, type IssuedFixture } from './helpers.js';

const OFFLINE_POLICY = {
  ...DEFAULT_REPUTATION_POLICY,
  acceptedOutcomes: ['VERIFIED_OFFLINE' as const],
  allowOffline: true,
};

async function verified(issued: IssuedFixture): Promise<VerificationReport> {
  return verifyAttestation({
    attestation: issued.attestation,
    allowlist: issued.allowlist,
    revocations: issued.revocations,
    inputContent: issued.input,
    deliveryContent: issued.delivery,
    now: new Date('2026-11-24T04:05:00.000Z'),
  });
}

test('调用者自行构造的有效报告不被接受', async () => {
  const issued = await issueFixture();
  const report = await verified(issued);
  const forged = { ...structuredClone(report), quality: 'RECALCULATED_PASS' as const, fulfillment: 'RECALCULATED_PASS' as const };
  const result = aggregateReputation([
    { attestation: issued.attestation, report: forged },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.decisions[0].admitted, false);
  assert.deepEqual(result.decisions[0].reasons, ['UNTRUSTED_REPORT']);
  assert.equal(result.buckets.length, 0);
});

test('其他凭证的核验报告不能被替换拼接', async () => {
  const first = await issueFixture({ attestationId: '55555555-5555-4555-8555-555555555555' });
  const second = await issueFixture({
    attestationId: '66666666-6666-4666-8666-666666666666',
    inputContent: 'record_id,amount_cents\nmcp-z,9\n',
    deliveryContent: 'record_id,amount_cents\nmcp-z,9\n',
  });
  const firstReport = await verified(first);
  const secondReport = await verified(second);
  assert.equal(firstReport.outcome, 'VERIFIED_OFFLINE');
  const result = aggregateReputation([
    { attestation: first.attestation, report: secondReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.decisions[0].admitted, false);
  assert.ok(result.decisions[0].reasons.includes('REPORT_ATTESTATION_MISMATCH'));
});

test('核验后修改报告对象不能改变准入结论', async () => {
  const issued = await issueFixture();
  const report = await verifyAttestation({
    attestation: issued.attestation, allowlist: issued.allowlist, revocations: issued.revocations,
    now: new Date('2026-11-24T04:05:00.000Z'),
  });
  assert.equal(report.outcome, 'VERIFIED_OFFLINE');
  report.outcome = 'VERIFIED';
  report.quality = 'RECALCULATED_PASS';
  report.fulfillment = 'RECALCULATED_PASS';
  const result = aggregateReputation([
    { attestation: issued.attestation, report },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.decisions[0].admitted, false);
  assert.equal(result.decisions[0].outcome, 'VERIFIED_OFFLINE');
  assert.ok(result.decisions[0].reasons.includes('QUALITY_NOT_RECALCULATED'));
});

test('无效冲突凭证不污染合法凭证的信誉', async () => {
  const issued = await issueFixture();
  const validReport = await verified(issued);
  const tampered = structuredClone(issued.attestation) as FulfillmentAttestation;
  tampered.delivery.contentHash = `0x${'11'.repeat(32)}`;
  const tamperedReport = await verifyAttestation({
    attestation: tampered, allowlist: issued.allowlist, revocations: issued.revocations,
    inputContent: issued.input, deliveryContent: issued.delivery,
    now: new Date('2026-11-24T04:05:00.000Z'),
  });
  assert.equal(tamperedReport.outcome, 'REJECTED');
  assert.equal(reputationEventKey(issued.attestation), reputationEventKey(tampered));
  const result = aggregateReputation([
    { attestation: issued.attestation, report: validReport },
    { attestation: tampered, report: tamperedReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].sampleSize, 1);
  const tamperedDecisions = result.decisions.filter((decision) => decision.attestationId === tampered.attestationId);
  assert.equal(tamperedDecisions.filter((decision) => decision.admitted).length, 1);
  assert.equal(tamperedDecisions.filter((decision) => !decision.admitted).length, 1);
  const rejected = tamperedDecisions.find((decision) => !decision.admitted);
  assert.ok(rejected?.reasons.includes('AUTHENTICITY_FAILED'));
  assert.equal(result.ignored.some((item) => item.reason === 'CONFLICTING_EVENT'), false);
});

test('相同 Agent ID 在不同身份命名空间下不合并', async () => {
  const base = await issueFixture();
  const alternate = await resign(base.attestation, base.privateKey, (copy) => {
    copy.attestationId = '77777777-7777-4777-8777-777777777777';
    copy.subject.identity = { namespace: 'eip155', value: `0x${'ab'.repeat(20)}` };
  });
  const baseReport = await verified(base);
  const alternateReport = await verifyAttestation({
    attestation: alternate, allowlist: base.allowlist, revocations: base.revocations,
    inputContent: base.input, deliveryContent: base.delivery,
    now: new Date('2026-11-24T04:05:00.000Z'),
  });
  assert.notEqual(reputationEventKey(base.attestation), reputationEventKey(alternate));
  const result = aggregateReputation([
    { attestation: base.attestation, report: baseReport },
    { attestation: alternate, report: alternateReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 2);
  assert.deepEqual(
    result.buckets.map((bucket) => bucket.subjectNamespace).sort(),
    ['ct-local', 'eip155'],
  );
});

function policyFor(issued: IssuedFixture, overrides: Record<string, unknown> = {}): TrustPolicy {
  return {
    version: 'ct-trust-policy-v1',
    trustRoot: {
      kind: 'CONTROLLED_LOCAL_CONFIG',
      issuerSource: 'CALLER_SUPPLIED_UNSIGNED',
      revocationSource: 'CALLER_SUPPLIED_UNSIGNED',
      independentlyCertified: false,
      notes: '测试使用受控本地配置，不代表独立认证',
    },
    allowlist: structuredClone(issued.allowlist),
    revocations: structuredClone(issued.revocations),
    requireRevocations: true,
    freshness: {
      now: '2026-11-24T05:00:00.000Z',
      maxAllowlistAgeSeconds: 365 * 24 * 60 * 60,
      maxRevocationAgeSeconds: 365 * 24 * 60 * 60,
    },
    recognizedRuleVersions: ['csv-ledger-v1'],
    expectedBinding: { environment: 'local', deployment: 'experiment-local' },
    reputation: {
      acceptedOutcomes: ['VERIFIED_OFFLINE'],
      allowOffline: true,
      minOfflineEvidence: 'FULFILLMENT_RECALCULATED',
      requireQuality: true,
      requireFulfillment: true,
      requireFreshRevocationList: true,
      requireFreshAllowlist: true,
    },
    ...overrides,
  } as TrustPolicy;
}

test('loadTrustPolicy 与 verifyAndAggregateReputation 完成端到端准入', async () => {
  const issued = await issueFixture();
  const loaded = loadTrustPolicy(policyFor(issued));
  assert.equal(loaded.warnings.length, 0);
  assert.equal(loaded.fingerprints.revocations?.startsWith('0x'), true);

  const tampered = structuredClone(issued.attestation) as FulfillmentAttestation;
  tampered.delivery.contentHash = `0x${'22'.repeat(32)}`;
  const result = await verifyAndAggregateReputation({
    policy: loaded,
    candidates: [
      { attestation: issued.attestation, inputContent: issued.input, deliveryContent: issued.delivery },
      { attestation: tampered, inputContent: issued.input, deliveryContent: issued.delivery },
    ],
  });
  assert.equal(result.evaluations.length, 2);
  assert.equal(result.summary.authenticity.verified, 1);
  assert.equal(result.summary.authenticity.unverified, 1);
  assert.equal(result.summary.outputFormat.pass, 1);
  assert.equal(result.summary.fulfillment.pass, 1);
  assert.equal(result.summary.admission.admitted, 1);
  assert.equal(result.summary.admission.rejected, 1);
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].sampleSize, 1);
  assert.equal(result.decisions.length, 2);
  assert.deepEqual(result.decisions.map((decision) => decision.verificationPolicyDigest), [
    result.verificationPolicyDigest, result.verificationPolicyDigest,
  ]);
});

test('信任策略拒绝自述独立认证的名单', async () => {
  const issued = await issueFixture();
  const policy = policyFor(issued, {
    trustRoot: {
      ...policyFor(issued).trustRoot,
      independentlyCertified: true,
    },
  });
  assert.throws(() => loadTrustPolicy(policy), (error: unknown) => {
    assert.ok(error instanceof TrustSdkError);
    assert.equal(error.code, ERROR_CODES.POLICY_INVALID);
    return true;
  });
});

test('信任策略拒绝缺失元数据或已过期的名单', async () => {
  const issued = await issueFixture();
  const missing = policyFor(issued);
  delete (missing.allowlist as { issuedAt?: string }).issuedAt;
  assert.throws(() => loadTrustPolicy(missing), (error: unknown) => {
    assert.ok(error instanceof TrustSdkError);
    assert.equal(error.code, ERROR_CODES.ALLOWLIST_MISSING_METADATA);
    return true;
  });

  const stale = policyFor(issued);
  stale.freshness.now = '2028-01-01T00:00:00.000Z';
  assert.throws(() => loadTrustPolicy(stale), (error: unknown) => {
    assert.ok(error instanceof TrustSdkError);
    assert.equal(error.code, ERROR_CODES.ALLOWLIST_STALE);
    return true;
  });

  const noRevocations = policyFor(issued, { revocations: null });
  assert.throws(() => loadTrustPolicy(noRevocations), (error: unknown) => {
    assert.ok(error instanceof TrustSdkError);
    assert.equal(error.code, ERROR_CODES.REVOCATION_LIST_REQUIRED);
    return true;
  });
});
