import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { keccak256, toBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { canonicalJson } from '../../chain/src/collaboration.js';
import { verifyAttestation } from '../src/verify.js';
import { aggregateReputation } from '../src/reputation.js';
import { signDigest } from '../src/sign.js';
import { contentDigest } from '../src/canonical.js';
import { evaluateCsv } from '../src/csv.js';
import { compareCsvTransformation } from '../src/transform.js';
import { issueFixture, resign } from './helpers.js';
import type { FulfillmentAttestation } from '../src/schema.js';

const OFFLINE_POLICY = {
  acceptedOutcomes: ['VERIFIED_OFFLINE' as const],
  allowOffline: true,
  minOfflineEvidence: 'FULFILLMENT_RECALCULATED' as const,
};

async function verifiedOffline() {
  const issued = await issueFixture();
  const report = await verifyAttestation({
    attestation: issued.attestation, allowlist: issued.allowlist, revocations: issued.revocations,
    inputContent: issued.input, deliveryContent: issued.delivery,
  });
  return { ...issued, report };
}

test('用例 1：原始凭证在 B 模式离线核验通过', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const report = await verifyAttestation({
    attestation, allowlist, revocations, deliveryContent: null,
    now: new Date('2026-11-24T05:00:00.000Z'),
  });
  assert.equal(report.schema, 'VALID');
  assert.equal(report.signature, 'VALID');
  assert.equal(report.issuer, 'KNOWN');
  assert.equal(report.keyStatus, 'ACTIVE');
  assert.equal(report.revocation, 'CLEAR');
  assert.equal(report.ruleVersion, 'RECOGNIZED');
  assert.equal(report.chainCommitment, 'NOT_BOUND');
  assert.equal(report.quality, 'NOT_ASSERTED');
  assert.equal(report.outcome, 'VERIFIED_OFFLINE');
});

test('用例 3：修改验证结果后签名失效', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const tampered = structuredClone(attestation);
  tampered.validation.result = tampered.validation.result === 'PASS' ? 'FAIL' : 'PASS';
  const report = await verifyAttestation({ attestation: tampered, allowlist, revocations });
  assert.equal(report.signature, 'INVALID');
  assert.ok(report.reasons.includes('DIGEST_MISMATCH'));
  assert.equal(report.outcome, 'REJECTED');
});

test('用例 4：修改交付摘要后签名失效', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const tampered = structuredClone(attestation);
  tampered.delivery.contentHash = `0x${'11'.repeat(32)}`;
  const report = await verifyAttestation({ attestation: tampered, allowlist, revocations });
  assert.equal(report.signature, 'INVALID');
  assert.equal(report.outcome, 'REJECTED');
});

test('用例 5：名单外签发者被拒绝', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const rogueKey = generatePrivateKey();
  const rogue = await resign(attestation, rogueKey, (copy) => {
    copy.issuer.keyId = 'rogue-key';
    copy.issuer.signerAddress = privateKeyToAccount(rogueKey).address;
  });
  const report = await verifyAttestation({ attestation: rogue, allowlist, revocations });
  assert.equal(report.signature, 'VALID');
  assert.equal(report.issuer, 'UNKNOWN');
  assert.equal(report.outcome, 'REJECTED');
});

test('用例 6：复用合法 keyId 但替换地址被拒绝', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const rogueKey = generatePrivateKey();
  const rogue = await resign(attestation, rogueKey, (copy) => {
    copy.issuer.signerAddress = privateKeyToAccount(rogueKey).address;
  });
  const report = await verifyAttestation({ attestation: rogue, allowlist, revocations });
  assert.equal(report.issuer, 'KEY_MISMATCH');
  assert.equal(report.outcome, 'REJECTED');
});

test('用例 7：未知规则版本返回不确定', async () => {
  const { attestation, allowlist, revocations, privateKey } = await issueFixture();
  const unknownRule = await resign(attestation, privateKey, (copy) => {
    copy.validation.ruleVersion = 'csv-ledger-v2';
  });
  const report = await verifyAttestation({ attestation: unknownRule, allowlist, revocations });
  assert.equal(report.signature, 'VALID');
  assert.equal(report.ruleVersion, 'UNKNOWN');
  assert.equal(report.outcome, 'INDETERMINATE');
  assert.ok(report.reasons.includes('RULE_VERSION_UNKNOWN'));
});

test('用例 10：提供交付物后完成质量复算', async () => {
  const { attestation, allowlist, revocations, input, delivery } = await issueFixture();
  const report = await verifyAttestation({
    attestation, allowlist, revocations, inputContent: input, deliveryContent: delivery,
  });
  assert.equal(report.input, 'MATCH');
  assert.equal(report.content, 'MATCH');
  assert.equal(report.quality, 'RECALCULATED_PASS');
  assert.equal(report.transformation, 'MATCH');
  assert.equal(report.fulfillment, 'RECALCULATED_PASS');
  assert.equal(report.outcome, 'VERIFIED_OFFLINE');
});

test('缺少原始输入时保留输出质量检查但不宣称端到端复算', async () => {
  const { attestation, allowlist, revocations, delivery } = await issueFixture();
  const report = await verifyAttestation({ attestation, allowlist, revocations, deliveryContent: delivery });
  assert.equal(report.quality, 'RECALCULATED_PASS');
  assert.equal(report.transformation, 'NOT_ASSERTED');
  assert.equal(report.fulfillment, 'NOT_ASSERTED');
  assert.equal(report.outcome, 'VERIFIED_OFFLINE');
});

test('用例 11：交付物被替换后拒绝', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const report = await verifyAttestation({
    attestation, allowlist, revocations, deliveryContent: 'record_id,date,category,sales_yuan,orders\nx,2026-01-01,a,1,1\n',
  });
  assert.equal(report.content, 'MISMATCH');
  assert.equal(report.outcome, 'REJECTED');
});

test('缺少实际交付物时不得宣称质量已复算', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const report = await verifyAttestation({ attestation, allowlist, revocations, deliveryContent: null });
  assert.equal(report.content, 'NOT_PROVIDED');
  assert.equal(report.quality, 'NOT_ASSERTED');
});

test('用例 12：重复凭证不会重复产生信誉', async () => {
  const first = await verifiedOffline();
  const duplicate = aggregateReputation(
    [{ attestation: first.attestation, report: first.report }, { attestation: structuredClone(first.attestation), report: first.report }],
    { policy: OFFLINE_POLICY },
  );
  assert.equal(duplicate.buckets.length, 1);
  assert.equal(duplicate.buckets[0].pass, 1);
  assert.equal(duplicate.buckets[0].sampleSize, 1);
  assert.equal(duplicate.ignored.filter((item) => item.reason === 'DUPLICATE_ATTESTATION').length, 1);

  const second = await verifiedOffline();
  const merged = aggregateReputation(
    [{ attestation: first.attestation, report: first.report }, { attestation: second.attestation, report: second.report }],
    { policy: OFFLINE_POLICY },
  );
  assert.equal(merged.buckets[0].sampleSize, 1);
  assert.equal(merged.ignored.some((item) => item.reason === 'CONSUMED_REPUTATION_EVENT'), true);
});

test('未经核验的凭证不得进入信誉聚合', async () => {
  const { attestation } = await issueFixture();
  const result = aggregateReputation([{ attestation, report: null }], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 0);
  assert.equal(result.decisions[0].admitted, false);
  assert.ok(result.decisions[0].reasons.includes('NOT_VERIFIED'));
  assert.equal(result.decisions[0].evidenceLevel, 'UNVERIFIED');
});

test('VERIFIED_OFFLINE 默认不允许计分', async () => {
  const { attestation, report } = await verifiedOffline();
  const result = aggregateReputation([{ attestation, report }]);
  assert.equal(result.buckets.length, 0);
  assert.ok(result.decisions[0].reasons.includes('OUTCOME_NOT_ACCEPTED'));
});

test('允许离线但证据等级不足时仍不计分', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const signatureOnly = await verifyAttestation({ attestation, allowlist, revocations });
  assert.equal(signatureOnly.outcome, 'VERIFIED_OFFLINE');
  const result = aggregateReputation([{ attestation, report: signatureOnly }], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 0);
  assert.ok(result.decisions[0].reasons.includes('OFFLINE_EVIDENCE_INSUFFICIENT'));
});

test('信誉聚合与输入顺序无关', async () => {
  const first = await verifiedOffline();
  const second = await verifiedOffline();
  const forward = aggregateReputation([
    { attestation: first.attestation, report: first.report },
    { attestation: second.attestation, report: second.report },
  ], { policy: OFFLINE_POLICY });
  const backward = aggregateReputation([
    { attestation: second.attestation, report: second.report },
    { attestation: first.attestation, report: first.report },
  ], { policy: OFFLINE_POLICY });
  assert.deepEqual(forward.buckets, backward.buckets);
});

test('同一信誉事件出现冲突结论时不计分', async () => {
  const first = await verifiedOffline();
  const alternate = await issueFixture({
    facts: first.facts,
    attestationId: '44444444-4444-4444-8444-444444444444',
    inputContent: 'record_id,amount_cents\nmcp-z,9\n',
    deliveryContent: 'record_id,amount_cents\nmcp-z,9\n',
  });
  const alternateReport = await verifyAttestation({
    attestation: alternate.attestation, allowlist: alternate.allowlist, revocations: alternate.revocations,
    inputContent: alternate.input, deliveryContent: alternate.delivery,
  });
  const result = aggregateReputation([
    { attestation: first.attestation, report: first.report },
    { attestation: alternate.attestation, report: alternateReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 0);
  assert.equal(result.decisions.every((decision) => decision.reasons.includes('CONFLICTING_EVENT')), true);
});

test('同一履约的 B/C 凭证只计一次', async () => {
  const first = await verifiedOffline();
  const secondCredential = await issueFixture({
    facts: first.facts, attestationId: '11111111-1111-4111-8111-111111111111',
  });
  const secondReport = await verifyAttestation({
    attestation: secondCredential.attestation, allowlist: secondCredential.allowlist,
    revocations: secondCredential.revocations,
    inputContent: secondCredential.input, deliveryContent: secondCredential.delivery,
  });
  const result = aggregateReputation([
    { attestation: first.attestation, report: first.report },
    { attestation: secondCredential.attestation, report: secondReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets[0].sampleSize, 1);
  assert.equal(result.decisions.filter((decision) => decision.admitted).length, 1);
});

test('跨环境重放同一事件只计一次', async () => {
  const first = await verifiedOffline();
  const replay = await issueFixture({
    facts: first.facts, attestationId: '22222222-2222-4222-8222-222222222222',
  });
  const replayAttestation = structuredClone(replay.attestation);
  replayAttestation.binding.deployment = 'another-deployment';
  const resigned = await resign(replayAttestation, replay.privateKey);
  const replayReport = await verifyAttestation({
    attestation: resigned, allowlist: replay.allowlist, revocations: replay.revocations,
    inputContent: replay.input, deliveryContent: replay.delivery,
  });
  const result = aggregateReputation([
    { attestation: first.attestation, report: first.report },
    { attestation: resigned, report: replayReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets[0].sampleSize, 1);
});

test('不同签发者使用相同事件标识时按命名空间区分', async () => {
  const first = await verifiedOffline();
  const other = await issueFixture({
    facts: first.facts, attestationId: '33333333-3333-4333-8333-333333333333',
  });
  const otherAttestation = structuredClone(other.attestation);
  otherAttestation.issuer.issuerId = 'second-issuer';
  const resigned = await resign(otherAttestation, other.privateKey);
  const allowlist = {
    ...other.allowlist,
    issuers: [...other.allowlist.issuers, {
      issuerId: 'second-issuer', keyId: 'issuer-2026-11', address: other.address,
      validFrom: '2020-01-01T00:00:00.000Z', validTo: null, revokedAt: null,
    }],
  };
  const otherReport = await verifyAttestation({
    attestation: resigned, allowlist, revocations: other.revocations,
    inputContent: other.input, deliveryContent: other.delivery,
  });
  assert.equal(otherReport.issuer, 'KNOWN');
  const result = aggregateReputation([
    { attestation: first.attestation, report: first.report },
    { attestation: resigned, report: otherReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 2);
  assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.sampleSize, 0), 2);
});

test('用例 13：跨部署与签名域不得重放', async () => {
  const { attestation, allowlist, revocations, privateKey } = await issueFixture();
  const deploymentReport = await verifyAttestation({
    attestation, allowlist, revocations,
    expectedBinding: { environment: 'local', deployment: 'another-deployment' },
  });
  assert.ok(deploymentReport.reasons.includes('DEPLOYMENT_MISMATCH'));
  assert.equal(deploymentReport.outcome, 'REJECTED');

  const copy = structuredClone(attestation) as FulfillmentAttestation;
  delete (copy as { integrity?: unknown }).integrity;
  const plainDigest = keccak256(toBytes(canonicalJson(copy)));
  copy.integrity = {
    canonicalization: 'ct-canonical-json-v1',
    digest: plainDigest,
    signature: await signDigest(plainDigest, privateKey),
  };
  const domainReport = await verifyAttestation({ attestation: copy, allowlist, revocations });
  assert.equal(domainReport.signature, 'INVALID');
  assert.equal(domainReport.outcome, 'REJECTED');
});

test('用例 14：撤销状态未知时不得报告完全可信', async () => {
  const { attestation, allowlist } = await issueFixture();
  const report = await verifyAttestation({ attestation, allowlist, revocations: null });
  assert.equal(report.revocation, 'NOT_CHECKED');
  assert.equal(report.outcome, 'INDETERMINATE');
  assert.ok(report.reasons.includes('REVOCATION_STATUS_UNKNOWN'));
});

test('已撤销凭证被拒绝', async () => {
  const { attestation, allowlist, revocations } = await issueFixture();
  const revoked = {
    ...revocations,
    entries: [{ attestationId: attestation.attestationId, revokedAt: '2026-11-25T00:00:00.000Z', reasonCode: 'TEST' }],
  };
  const report = await verifyAttestation({ attestation, allowlist, revocations: revoked });
  assert.equal(report.revocation, 'REVOKED');
  assert.equal(report.outcome, 'REJECTED');
});

test('凭证过期与密钥过期均被拒绝', async () => {
  const issued = await issueFixture();
  const expired = await verifyAttestation({
    attestation: issued.attestation, allowlist: issued.allowlist, revocations: issued.revocations,
    now: new Date('2028-01-01T00:00:00.000Z'),
  });
  assert.ok(expired.reasons.includes('ATTESTATION_EXPIRED'));
  assert.equal(expired.outcome, 'REJECTED');

  const oldKey = await issueFixture({ keyValidTo: '2020-12-31T00:00:00.000Z' });
  const keyExpired = await verifyAttestation({
    attestation: oldKey.attestation, allowlist: oldKey.allowlist, revocations: oldKey.revocations,
  });
  assert.equal(keyExpired.keyStatus, 'EXPIRED');
  assert.equal(keyExpired.outcome, 'REJECTED');

  const revokedKey = await issueFixture({ keyRevokedAt: '2026-11-24T04:30:00.000Z' });
  const keyRevoked = await verifyAttestation({
    attestation: revokedKey.attestation, allowlist: revokedKey.allowlist, revocations: revokedKey.revocations,
  });
  assert.equal(keyRevoked.keyStatus, 'REVOKED');
  assert.equal(keyRevoked.outcome, 'REJECTED');
});

test('自验收与未知签发者被拒绝', async () => {
  const { attestation, allowlist, revocations, privateKey } = await issueFixture();
  const selfReview = await resign(attestation, privateKey, (copy) => {
    copy.review.reviewerId = copy.subject.agentId;
  });
  const report = await verifyAttestation({ attestation: selfReview, allowlist, revocations });
  assert.ok(report.reasons.includes('SELF_REVIEW'));
  assert.equal(report.outcome, 'REJECTED');

  const otherKey = generatePrivateKey();
  const unknownAllowlist = {
    version: 'ct-issuer-allowlist-v1' as const,
    issuers: [{
      issuerId: 'another-issuer', keyId: 'other-key',
      address: privateKeyToAccount(otherKey).address,
      validFrom: '2020-01-01T00:00:00.000Z', validTo: null, revokedAt: null,
    }],
  };
  const unknown = await verifyAttestation({ attestation, allowlist: unknownAllowlist, revocations });
  assert.equal(unknown.issuer, 'UNKNOWN');
  assert.equal(unknown.outcome, 'REJECTED');
});

test('签发日志拒绝重复 attestationId 与重复信誉事件', async () => {
  const journalDir = resolve(import.meta.dirname, '../../../.local/attestation');
  mkdirSync(journalDir, { recursive: true });
  const journal = resolve(journalDir, `journal-${randomUUID()}.jsonl`);
  if (existsSync(journal)) rmSync(journal);
  const attestationId = randomUUID();
  await issueFixture({ attestationId, journalPath: journal });
  await assert.rejects(
    () => issueFixture({ attestationId, journalPath: journal }),
    /DUPLICATE_ATTESTATION_ID/,
  );
  await assert.rejects(
    () => issueFixture({ attestationId: randomUUID(), journalPath: journal }),
    /DUPLICATE_REPUTATION_EVENT/,
  );
  writeFileSync(resolve(journalDir, 'journal-last.txt'), `${journal}\n`);
});

test('未知规则与缺失交付物组合返回不确定而非通过', async () => {
  const { attestation, allowlist, revocations, privateKey } = await issueFixture();
  const unknownRule = await resign(attestation, privateKey, (copy) => {
    copy.validation.ruleVersion = 'csv-ledger-v9';
  });
  const report = await verifyAttestation({
    attestation: unknownRule, allowlist, revocations, deliveryContent: null,
  });
  assert.equal(report.quality, 'NOT_ASSERTED');
  assert.equal(report.outcome, 'INDETERMINATE');
});

test('输出 CSV 合法但遗漏有效输入记录时不得通过完整履约验证', async () => {
  const inputContent = 'record_id,amount_cents\nmcp-a,5\nmcp-b,7\n';
  const completeDelivery = inputContent;
  const missingRecordDelivery = 'record_id,amount_cents\nmcp-a,5\n';

  const direct = compareCsvTransformation(inputContent, missingRecordDelivery);
  assert.equal(direct.status, 'MISMATCH');
  assert.ok(direct.reasons.includes('OUTPUT_MISSING_RECORDS'));

  const issued = await issueFixture({ inputContent, deliveryContent: completeDelivery });
  const incomplete = evaluateCsv(missingRecordDelivery);
  const forgedDelivery = await resign(issued.attestation, issued.privateKey, (copy) => {
    copy.delivery.contentHash = contentDigest(missingRecordDelivery);
    copy.delivery.rowCount = incomplete.rowCount;
    copy.validation.ruleVersion = incomplete.ruleVersion;
    copy.validation.result = incomplete.result;
    copy.validation.checkCodes = incomplete.checkCodes;
    copy.validation.checksDigest = incomplete.checksDigest;
  });
  const report = await verifyAttestation({
    attestation: forgedDelivery, allowlist: issued.allowlist, revocations: issued.revocations,
    inputContent, deliveryContent: missingRecordDelivery,
  });
  assert.equal(report.signature, 'VALID');
  assert.equal(report.input, 'MATCH');
  assert.equal(report.content, 'MATCH');
  assert.equal(report.quality, 'RECALCULATED_PASS');
  assert.equal(report.transformation, 'MISMATCH');
  assert.equal(report.fulfillment, 'RECALCULATED_FAIL');
  assert.ok(report.reasons.includes('OUTPUT_MISSING_RECORDS'));
  assert.equal(report.outcome, 'REJECTED');
});
