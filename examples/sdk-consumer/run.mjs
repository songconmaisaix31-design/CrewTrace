import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EVIDENCE_DIMENSIONS, SDK_VERSION, aggregateReputation, evidenceLevelOf,
  loadTrustPolicy, verifyAndAggregateReputation,
} from '@crewtrace/trust-sdk';

// 独立消费者主程序：只依赖已安装的 SDK 包和本地输入文件。
const root = resolve(import.meta.dirname);
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const readText = (path) => readFileSync(resolve(root, path), 'utf8');

const policy = loadTrustPolicy(resolve(root, 'trust-policy.json'));
const input = readText('data/input.csv');
const delivery = readText('data/delivery.csv');
const valid = readJson('attestations/valid.json');
const tampered = readJson('attestations/tampered.json');

const evaluation = await verifyAndAggregateReputation({
  policy,
  candidates: [
    { attestation: valid, inputContent: input, deliveryContent: delivery },
    { attestation: tampered, inputContent: input, deliveryContent: delivery },
  ],
});

const [validEvaluation, tamperedEvaluation] = evaluation.evaluations;
const validDecision = evaluation.decisions.find((decision) => decision.attestationId === valid.attestationId);
const tamperedDecision = evaluation.decisions.find(
  (decision) => decision.attestationId === tampered.attestationId && !decision.admitted,
);
const forgedReport = { ...structuredClone(validEvaluation.report), outcome: 'VERIFIED', quality: 'RECALCULATED_PASS' };
const forged = aggregateReputation([{ attestation: valid, report: forgedReport }], {
  policy: policy.policy.reputation,
});

const checks = {
  validOutcomeOffline: validEvaluation.report.outcome === 'VERIFIED_OFFLINE',
  validSignature: validEvaluation.report.signature === 'VALID',
  validOutputFormat: validEvaluation.report.quality === 'RECALCULATED_PASS',
  validFulfillment: validEvaluation.report.fulfillment === 'RECALCULATED_PASS',
  tamperedRejected: tamperedEvaluation.report.outcome === 'REJECTED',
  tamperedSignatureInvalid: tamperedEvaluation.report.signature === 'INVALID',
  validAdmitted: validDecision?.admitted === true,
  tamperedRejectedAtAdmission: tamperedDecision !== undefined,
  oneBucketOneSample: evaluation.buckets.length === 1 && evaluation.buckets[0].sampleSize === 1,
  forgedReportRejected: forged.decisions[0]?.reasons.includes('UNTRUSTED_REPORT') === true,
  authenticityCounts: evaluation.summary.authenticity.verified === 1
    && evaluation.summary.authenticity.unverified === 1,
};

const output = {
  sdkVersion: SDK_VERSION,
  dimensions: EVIDENCE_DIMENSIONS,
  verificationPolicyDigest: evaluation.verificationPolicyDigest,
  reports: evaluation.evaluations.map(({ attestationId, report }) => ({
    attestationId,
    outcome: report.outcome,
    schema: report.schema,
    signature: report.signature,
    issuer: report.issuer,
    keyStatus: report.keyStatus,
    revocation: report.revocation,
    input: report.input,
    content: report.content,
    transformation: report.transformation,
    quality: report.quality,
    fulfillment: report.fulfillment,
    chainCommitment: report.chainCommitment,
    evidenceLevel: evidenceLevelOf(report),
    reasons: report.reasons,
  })),
  decisions: evaluation.decisions.map((decision) => ({
    attestationId: decision.attestationId,
    admitted: decision.admitted,
    reasons: decision.reasons,
    evidenceLevel: decision.evidenceLevel,
  })),
  buckets: evaluation.buckets,
  summary: evaluation.summary,
  checks,
};

console.log(JSON.stringify(output, null, 2));
const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name);
if (failed.length) {
  console.error(`CONSUMER_CHECK_FAILED:${failed.join(',')}`);
  process.exit(1);
}
