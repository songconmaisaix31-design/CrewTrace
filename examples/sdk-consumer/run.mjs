import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EVIDENCE_DIMENSIONS, SDK_VERSION, aggregateReputation, evidenceLevelOf,
  loadTrustPolicy, verifyAndAggregateReputation, verifyAttestation,
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

const codeEvidence = {
  taskSpec: readText('data/code/task-spec.md'),
  testSuite: readText('data/code/tests.json'),
  artifactFiles: readJson('data/code/files.json'),
  testReport: readText('data/code/report.json'),
};
const codeValid = readJson('attestations/code-valid.json');
const codeTampered = readJson('attestations/code-tampered.json');

const evaluation = await verifyAndAggregateReputation({
  policy,
  candidates: [
    { attestation: valid, inputContent: input, deliveryContent: delivery },
    { attestation: tampered, inputContent: input, deliveryContent: delivery },
    { attestation: codeValid, codeEvidence },
    { attestation: codeTampered, codeEvidence },
  ],
});

const [validEvaluation, tamperedEvaluation, codeValidEvaluation, codeTamperedEvaluation] = evaluation.evaluations;
const validDecision = evaluation.decisions.find((decision) => decision.attestationId === valid.attestationId);
const tamperedDecision = evaluation.decisions.find(
  (decision) => decision.attestationId === tampered.attestationId && !decision.admitted,
);
const codeDecision = evaluation.decisions.find((decision) => decision.attestationId === codeValid.attestationId);
const codeTamperedDecision = evaluation.decisions.find(
  (decision) => decision.attestationId === codeTampered.attestationId && !decision.admitted,
);

const forgedReport = { ...structuredClone(validEvaluation.report), outcome: 'VERIFIED', quality: 'RECALCULATED_PASS' };
const forged = aggregateReputation([{ attestation: valid, report: forgedReport }], {
  policy: policy.policy.reputation,
});

const forgedCodeReport = JSON.parse(codeEvidence.testReport);
forgedCodeReport.passed = 0;
forgedCodeReport.failed = 6;
forgedCodeReport.exitCode = 1;
const forgedCode = await verifyAttestation({
  attestation: codeValid,
  allowlist: policy.policy.allowlist,
  revocations: policy.policy.revocations,
  codeEvidence: { ...codeEvidence, testReport: JSON.stringify(forgedCodeReport) },
  recognizedRuleVersions: policy.policy.recognizedRuleVersions,
  expectedBinding: policy.policy.expectedBinding,
  now: new Date(policy.policy.freshness.now),
});

const bucketTaskTypes = evaluation.buckets.map((bucket) => bucket.taskType).sort();
const checks = {
  validOutcomeOffline: validEvaluation.report.outcome === 'VERIFIED_OFFLINE',
  validSignature: validEvaluation.report.signature === 'VALID',
  validOutputFormat: validEvaluation.report.quality === 'RECALCULATED_PASS',
  validFulfillment: validEvaluation.report.fulfillment === 'RECALCULATED_PASS',
  tamperedRejected: tamperedEvaluation.report.outcome === 'REJECTED',
  tamperedSignatureInvalid: tamperedEvaluation.report.signature === 'INVALID',
  validAdmitted: validDecision?.admitted === true,
  tamperedRejectedAtAdmission: tamperedDecision !== undefined,
  codeValidOutcomeOffline: codeValidEvaluation.report.outcome === 'VERIFIED_OFFLINE',
  codeValidTaskType: codeValidEvaluation.report.taskType === 'code-artifact-test',
  codeValidOutputFormat: codeValidEvaluation.report.quality === 'RECALCULATED_PASS',
  codeValidFulfillment: codeValidEvaluation.report.fulfillment === 'RECALCULATED_PASS',
  codeValidAdmitted: codeDecision?.admitted === true,
  codeTamperedRejected: codeTamperedEvaluation.report.outcome === 'REJECTED',
  codeTamperedRejectedAtAdmission: codeTamperedDecision !== undefined,
  codeForgedReportRejected: forgedCode.outcome === 'REJECTED'
    && forgedCode.reasons.includes('TEST_REPORT_DIGEST_MISMATCH'),
  twoTaskBuckets: bucketTaskTypes.join(',') === 'code-artifact-test,csv-data-review',
  oneSamplePerTask: evaluation.buckets.length === 2
    && evaluation.buckets.every((bucket) => bucket.sampleSize === 1),
  forgedReportRejected: forged.decisions[0]?.reasons.includes('UNTRUSTED_REPORT') === true,
  authenticityCounts: evaluation.summary.authenticity.verified === 2
    && evaluation.summary.authenticity.unverified === 2,
  admissionCounts: evaluation.summary.admission.admitted === 2
    && evaluation.summary.admission.rejected === 2,
};

const output = {
  sdkVersion: SDK_VERSION,
  dimensions: EVIDENCE_DIMENSIONS,
  verificationPolicyDigest: evaluation.verificationPolicyDigest,
  reports: evaluation.evaluations.map(({ attestationId, report }) => ({
    attestationId,
    taskType: report.taskType,
    verifierId: report.verifierId,
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
