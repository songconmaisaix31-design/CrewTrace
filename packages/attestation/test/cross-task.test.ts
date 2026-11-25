import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyAttestation } from '../src/verify.js';
import { aggregateReputation, DEFAULT_REPUTATION_POLICY } from '../src/reputation.js';
import { issueCodeAttestation, CodeTestSuiteSchema } from '../src/code-task.js';
import type { FulfillmentAttestation, IssuerAllowlist, RevocationList } from '../src/schema.js';
import { issueFixture, resign, type IssuedFixture } from './helpers.js';

const CODE_DIR = new URL('../../../experiments/code-task/', import.meta.url);
const NOW = new Date('2026-11-24T04:05:00.000Z');

function read(relative: string): string {
  return readFileSync(new URL(relative, CODE_DIR), 'utf8');
}

const OFFLINE_POLICY = {
  ...DEFAULT_REPUTATION_POLICY,
  acceptedOutcomes: ['VERIFIED_OFFLINE' as const],
  allowOffline: true,
};

interface IssuedCode {
  attestation: FulfillmentAttestation;
  allowlist: IssuerAllowlist;
  revocations: RevocationList;
  privateKey: Hex;
  codeEvidence: {
    taskSpec: string;
    testSuite: string;
    artifactFiles: Array<{ path: string; content: string }>;
    testReport: string;
  };
}

async function issueCodeFixture(): Promise<IssuedCode> {
  const taskSpec = read('task-spec.md');
  const testSuite = read('tests.json');
  const artifactFiles = [
    { path: 'solution.mjs', content: read('artifacts/solution.mjs') },
    { path: 'ticket-rules.mjs', content: read('artifacts/ticket-rules.mjs') },
  ];
  const privateKey = generatePrivateKey();
  const attestation = await issueCodeAttestation({
    facts: {
      subject: {
        agentId: '33333333-3333-4333-8333-333333333333',
        identity: { namespace: 'ct-local', value: 'agent-code-cross-task' },
        signingAddress: null,
        role: 'code-artifact-author',
        serviceId: 'crewtrace-code-experiment',
        serviceVersion: 1,
      },
      task: {
        taskId: '44444444-4444-4444-8444-444444444444',
        attempt: 1,
        workflowVersion: 'synthetic-code-task-v1',
      },
      review: {
        decision: 'ACCEPTED', reviewerId: 'reviewer-code-1', reviewerAddress: null,
        reviewedAt: '2026-11-24T03:55:00.000Z',
      },
      reputation: { eventId: 'code-cross-task-1', outcome: 'PASS' },
      payment: { status: 'NOT_REQUIRED' },
    },
    taskSpec: { content: taskSpec, schemaVersion: 'synthetic-code-task-v1' },
    testSuite: { content: testSuite },
    artifact: { entrypoint: 'solution.mjs', files: artifactFiles },
    privateKey,
    issuerId: 'crewtrace-code-experiment',
    keyId: 'code-issuer-2026-11',
    environment: 'local',
    deployment: 'experiment-local',
    now: new Date('2026-11-24T04:00:00.000Z'),
  });
  const allowlist: IssuerAllowlist = {
    version: 'ct-issuer-allowlist-v1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    issuers: [{
      issuerId: 'crewtrace-code-experiment',
      keyId: 'code-issuer-2026-11',
      address: privateKeyToAccount(privateKey).address,
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
    }],
  };
  const revocations: RevocationList = {
    version: 'ct-revocation-list-v1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    entries: [],
  };
  const suite = CodeTestSuiteSchema.parse(JSON.parse(testSuite));
  const entry = artifactFiles[0];
  const { runFixedTestSuite } = await import('../src/code-task.js');
  const run = runFixedTestSuite({
    suite,
    artifactSource: entry.content,
    taskSpecDigest: attestation.input.contentHash,
    suiteDigest: attestation.evidence!.testSuite.contentHash,
    artifactDigest: attestation.delivery.contentHash,
  });
  assert.ok(run.report);
  return {
    attestation,
    allowlist,
    revocations,
    privateKey,
    codeEvidence: { taskSpec, testSuite, artifactFiles, testReport: JSON.stringify(run.report) },
  };
}

async function verifyCsv(issued: IssuedFixture) {
  return verifyAttestation({
    attestation: issued.attestation,
    allowlist: issued.allowlist,
    revocations: issued.revocations,
    inputContent: issued.input,
    deliveryContent: issued.delivery,
    recognizedRuleVersions: ['csv-ledger-v1', 'code-artifact-test-v1'],
    now: NOW,
  });
}

async function verifyCode(issued: IssuedCode, overrides: { codeEvidence?: unknown; attestation?: unknown } = {}) {
  return verifyAttestation({
    attestation: overrides.attestation ?? issued.attestation,
    allowlist: issued.allowlist,
    revocations: issued.revocations,
    codeEvidence: (overrides.codeEvidence === undefined ? issued.codeEvidence : overrides.codeEvidence) as never,
    recognizedRuleVersions: ['csv-ledger-v1', 'code-artifact-test-v1'],
    now: NOW,
  });
}

test('CSV 履约成功不会自动提高代码开发信誉', async () => {
  const csv = await issueFixture();
  const code = await issueCodeFixture();
  const csvReport = await verifyCsv(csv);
  const codeReport = await verifyCode(code);
  assert.equal(csvReport.outcome, 'VERIFIED_OFFLINE');
  assert.equal(codeReport.outcome, 'VERIFIED_OFFLINE');

  const csvOnly = aggregateReputation([{ attestation: csv.attestation, report: csvReport }], { policy: OFFLINE_POLICY });
  assert.equal(csvOnly.buckets.length, 1);
  assert.equal(csvOnly.buckets[0].taskType, 'csv-data-review');
  assert.equal(csvOnly.buckets.some((bucket) => bucket.taskType === 'code-artifact-test'), false);

  const combined = aggregateReputation([
    { attestation: csv.attestation, report: csvReport },
    { attestation: code.attestation, report: codeReport },
  ], { policy: OFFLINE_POLICY });
  const csvBucket = combined.buckets.find((bucket) => bucket.taskType === 'csv-data-review');
  const codeBucket = combined.buckets.find((bucket) => bucket.taskType === 'code-artifact-test');
  assert.equal(csvBucket?.sampleSize, 1);
  assert.equal(codeBucket?.sampleSize, 1);
  assert.equal(codeBucket?.pass, 1);
  assert.notEqual(csvBucket?.agentId, codeBucket?.agentId);
});

test('同一事件重复提交不会重复计分', async () => {
  const csv = await issueFixture();
  const csvReport = await verifyCsv(csv);
  const same = aggregateReputation([
    { attestation: csv.attestation, report: csvReport },
    { attestation: csv.attestation, report: csvReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(same.buckets.length, 1);
  assert.equal(same.buckets[0].sampleSize, 1);
  assert.equal(same.buckets[0].pass, 1);
  assert.ok(same.ignored.some((item) => item.reason === 'DUPLICATE_ATTESTATION'));

  const duplicate = await resign(csv.attestation, csv.privateKey, (copy) => {
    copy.attestationId = '99999999-9999-4999-8999-999999999999';
  });
  const duplicateReport = await verifyAttestation({
    attestation: duplicate,
    allowlist: csv.allowlist,
    revocations: csv.revocations,
    inputContent: csv.input,
    deliveryContent: csv.delivery,
    recognizedRuleVersions: ['csv-ledger-v1'],
    now: NOW,
  });
  const distinct = aggregateReputation([
    { attestation: csv.attestation, report: csvReport },
    { attestation: duplicate, report: duplicateReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(distinct.buckets.length, 1);
  assert.equal(distinct.buckets[0].sampleSize, 1);
  assert.ok(distinct.ignored.some((item) => item.reason === 'CONSUMED_REPUTATION_EVENT'));
});

test('不同任务的合法凭证能够同时存在', async () => {
  const csv = await issueFixture();
  const code = await issueCodeFixture();
  const result = aggregateReputation([
    { attestation: csv.attestation, report: await verifyCsv(csv) },
    { attestation: code.attestation, report: await verifyCode(code) },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 2);
  assert.deepEqual(result.buckets.map((bucket) => bucket.taskType).sort(), ['code-artifact-test', 'csv-data-review']);
});

test('不同任务类型使用错误验证器时不得通过', async () => {
  const code = await issueCodeFixture();
  const csvVerifier = await resign(code.attestation, code.privateKey, (copy) => {
    copy.validation.verifierId = 'csv-ledger';
    copy.validation.ruleId = 'csv-ledger';
    copy.validation.ruleVersion = 'csv-ledger-v1';
    copy.evidence!.testSuite.ruleVersion = 'csv-ledger-v1';
  });
  const report = await verifyCode(code, { attestation: csvVerifier });
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('EVIDENCE_KIND_MISMATCH'));

  const csv = await issueFixture();
  const codeVerifier = await resign(csv.attestation, csv.privateKey, (copy) => {
    copy.validation.verifierId = 'code-artifact-test';
    copy.validation.ruleId = 'code-artifact-test';
    copy.validation.ruleVersion = 'code-artifact-test-v1';
    copy.evidence = structuredClone(code.attestation.evidence!);
  });
  const csvReport = await verifyCsv(csv);
  const codeReport = await verifyAttestation({
    attestation: codeVerifier,
    allowlist: csv.allowlist,
    revocations: csv.revocations,
    inputContent: csv.input,
    deliveryContent: csv.delivery,
    recognizedRuleVersions: ['csv-ledger-v1', 'code-artifact-test-v1'],
    now: NOW,
  });
  assert.equal(csvReport.outcome, 'VERIFIED_OFFLINE');
  assert.equal(codeReport.outcome, 'INDETERMINATE');
  assert.equal(codeReport.taskType, 'code-artifact-test');
  assert.ok(codeReport.reasons.includes('CODE_EVIDENCE_NOT_PROVIDED'));
  const result = aggregateReputation([{ attestation: codeVerifier, report: codeReport }], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 0);
});

test('未核验或不确定凭证不进入默认可信信誉聚合', async () => {
  const code = await issueCodeFixture();
  const indeterminate = await verifyCode(code, { codeEvidence: null });
  assert.equal(indeterminate.outcome, 'INDETERMINATE');
  const result = aggregateReputation([
    { attestation: code.attestation, report: indeterminate },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 0);
  assert.equal(result.decisions[0].admitted, false);
  assert.ok(result.decisions[0].reasons.includes('OUTCOME_INDETERMINATE'));

  const untrusted = aggregateReputation([
    { attestation: code.attestation, report: null },
  ], { policy: OFFLINE_POLICY });
  assert.equal(untrusted.buckets.length, 0);
  assert.equal(untrusted.decisions[0].reasons[0], 'NOT_VERIFIED');
});

test('不同信任策略对同一凭证作出不同准入决定', async () => {
  const csv = await issueFixture();
  const report = await verifyCsv(csv);
  const accepted = aggregateReputation([{ attestation: csv.attestation, report }], { policy: OFFLINE_POLICY });
  const strict = aggregateReputation([{ attestation: csv.attestation, report }], {
    policy: { ...DEFAULT_REPUTATION_POLICY, acceptedOutcomes: ['VERIFIED'], allowOffline: false },
  });
  assert.equal(accepted.decisions[0].admitted, true);
  assert.equal(strict.decisions[0].admitted, false);
  assert.ok(strict.decisions[0].reasons.includes('OUTCOME_NOT_ACCEPTED'));
  assert.equal(strict.buckets.length, 0);
});
