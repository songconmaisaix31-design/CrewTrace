import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { issueCodeAttestation, CodeTestSuiteSchema, codeReportDigest, runFixedTestSuite } from '../src/code-task.js';
import { verifyAttestation } from '../src/verify.js';
import { attestationDigest } from '../src/canonical.js';
import { attestationRecordId, commitmentKey } from '../src/chain-verify.js';
import type { FulfillmentAttestation, IssuerAllowlist, RevocationList } from '../src/schema.js';
import type { CodeIssueFacts } from '../src/code-task.js';
import { resign } from './helpers.js';

const CODE_DIR = new URL('../../../experiments/code-task/', import.meta.url);
const NOW = new Date('2026-11-24T04:05:00.000Z');

function read(relative: string): string {
  return readFileSync(new URL(relative, CODE_DIR), 'utf8');
}

function codeFacts(overrides: Partial<CodeIssueFacts> = {}): CodeIssueFacts {
  return {
    subject: {
      agentId: '11111111-1111-4111-8111-111111111111',
      identity: { namespace: 'ct-local', value: 'agent-code-a' },
      signingAddress: null,
      role: 'code-artifact-author',
      serviceId: 'crewtrace-code-experiment',
      serviceVersion: 1,
    },
    task: {
      taskId: '22222222-2222-4222-8222-222222222222',
      attempt: 1,
      workflowVersion: 'synthetic-code-task-v1',
    },
    review: {
      decision: 'ACCEPTED',
      reviewerId: 'reviewer-code-1',
      reviewerAddress: null,
      reviewedAt: '2026-11-24T03:55:00.000Z',
    },
    reputation: { eventId: 'code-event-1', outcome: 'PASS' },
    payment: { status: 'NOT_REQUIRED' },
    ...overrides,
  };
}

interface IssuedCode {
  attestation: FulfillmentAttestation;
  allowlist: IssuerAllowlist;
  revocations: RevocationList;
  privateKey: Hex;
  taskSpec: string;
  suiteContent: string;
  artifactFiles: Array<{ path: string; content: string }>;
  report: string;
}

async function issueCode(options: {
  artifactFiles?: Array<{ path: string; content: string }>;
  suiteContent?: string;
  taskSpec?: string;
  facts?: Partial<CodeIssueFacts>;
  attestationId?: string;
  privateKey?: Hex;
} = {}): Promise<IssuedCode> {
  const taskSpec = options.taskSpec ?? read('task-spec.md');
  const suiteContent = options.suiteContent ?? read('tests.json');
  const artifactFiles = options.artifactFiles ?? [
    { path: 'solution.mjs', content: read('artifacts/solution.mjs') },
    { path: 'ticket-rules.mjs', content: read('artifacts/ticket-rules.mjs') },
  ];
  const privateKey = options.privateKey ?? generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const attestation = await issueCodeAttestation({
    facts: codeFacts(options.facts),
    taskSpec: { content: taskSpec, schemaVersion: 'synthetic-code-task-v1' },
    testSuite: { content: suiteContent },
    artifact: { entrypoint: 'solution.mjs', files: artifactFiles },
    privateKey,
    issuerId: 'crewtrace-code-experiment',
    keyId: 'code-issuer-2026-11',
    environment: 'local',
    deployment: 'experiment-local',
    now: new Date('2026-11-24T04:00:00.000Z'),
    attestationId: options.attestationId,
  });
  const suite = CodeTestSuiteSchema.parse(JSON.parse(suiteContent));
  const entry = artifactFiles.find((file) => file.path === 'solution.mjs')!;
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
    allowlist: {
      version: 'ct-issuer-allowlist-v1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-12-31T23:59:59.000Z',
      issuers: [{
        issuerId: 'crewtrace-code-experiment',
        keyId: 'code-issuer-2026-11',
        address,
        validFrom: '2020-01-01T00:00:00.000Z',
        validTo: null,
        revokedAt: null,
      }],
    },
    revocations: {
      version: 'ct-revocation-list-v1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-12-31T23:59:59.000Z',
      entries: [],
    },
    privateKey,
    taskSpec,
    suiteContent,
    artifactFiles,
    report: JSON.stringify(run.report),
  };
}

async function verifyCode(
  issued: IssuedCode,
  options: {
    attestation?: unknown;
    taskSpec?: string;
    suiteContent?: string;
    artifactFiles?: Array<{ path: string; content: string }>;
    testReport?: string;
    recognizedRuleVersions?: string[];
  } = {},
) {
  return verifyAttestation({
    attestation: options.attestation ?? issued.attestation,
    allowlist: issued.allowlist,
    revocations: issued.revocations,
    codeEvidence: {
      taskSpec: options.taskSpec ?? issued.taskSpec,
      testSuite: options.suiteContent ?? issued.suiteContent,
      artifactFiles: options.artifactFiles ?? issued.artifactFiles,
      testReport: options.testReport ?? issued.report,
    },
    recognizedRuleVersions: options.recognizedRuleVersions ?? ['code-artifact-test-v1'],
    now: NOW,
  });
}

test('代码交付满足固定测试集合时获得可复算通过结论', async () => {
  const issued = await issueCode();
  const report = await verifyCode(issued);
  assert.equal(report.outcome, 'VERIFIED_OFFLINE', JSON.stringify(report.reasons));
  assert.equal(report.taskType, 'code-artifact-test');
  assert.equal(report.verifierStatus, 'REGISTERED');
  assert.equal(report.quality, 'RECALCULATED_PASS');
  assert.equal(report.fulfillment, 'RECALCULATED_PASS');
  assert.equal(issued.attestation.validation.result, 'PASS');
  assert.equal(issued.attestation.evidence?.testRun.total, 6);
  assert.equal(issued.attestation.evidence?.testRun.passed, 6);
});

test('负例：代码被篡改时拒绝通过', async () => {
  const issued = await issueCode();
  const tampered = issued.artifactFiles.map((file) => (
    file.path === 'solution.mjs' ? { ...file, content: `${file.content}\n// tampered` } : file
  ));
  const report = await verifyCode(issued, { artifactFiles: tampered });
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('ARTIFACT_HASH_MISMATCH'));
  assert.ok(report.reasons.includes('ARTIFACT_FILE_DIGEST_MISMATCH'));
});

test('负例：测试结果被伪造时拒绝通过', async () => {
  const issued = await issueCode();
  const forged = JSON.parse(issued.report) as Record<string, unknown>;
  forged.passed = 0;
  forged.failed = 6;
  forged.cases = (forged.cases as Array<Record<string, unknown>>).map((item) => ({
    ...item, status: 'FAIL', detail: 'FORGED',
  }));
  const report = await verifyCode(issued, { testReport: JSON.stringify(forged) });
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('TEST_REPORT_DIGEST_MISMATCH'));
});

test('负例：测试集合被替换时拒绝通过', async () => {
  const issued = await issueCode();
  const suite = JSON.parse(issued.suiteContent) as { cases: Array<{ expected: unknown }> };
  suite.cases[0].expected = 'TC-0000';
  const report = await verifyCode(issued, { suiteContent: JSON.stringify(suite) });
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('TEST_SUITE_DIGEST_MISMATCH'));
});

test('负例：部分测试未执行时拒绝通过', async () => {
  const issued = await issueCode();
  const mutated = await resign(issued.attestation, issued.privateKey, (copy) => {
    copy.evidence!.testRun.total = 3;
    copy.evidence!.testRun.passed = 3;
  });
  const report = await verifyCode(issued, { attestation: mutated });
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('TESTS_NOT_FULLY_EXECUTED'));
});

test('负例：输出文件缺失时拒绝通过', async () => {
  const issued = await issueCode();
  const partial = issued.artifactFiles.filter((file) => file.path !== 'ticket-rules.mjs');
  const report = await verifyCode(issued, { artifactFiles: partial });
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('ARTIFACT_FILE_MISSING'));
});

test('负例：未知规则版本返回不确定结果', async () => {
  const issued = await issueCode();
  const mutated = await resign(issued.attestation, issued.privateKey, (copy) => {
    copy.validation.ruleVersion = 'code-artifact-test-v9';
    copy.evidence!.testSuite.ruleVersion = 'code-artifact-test-v9';
  });
  const unknown = await verifyCode(issued, { attestation: mutated, recognizedRuleVersions: ['code-artifact-test-v9'] });
  assert.equal(unknown.outcome, 'INDETERMINATE');
  assert.ok(unknown.reasons.includes('VERIFIER_UNKNOWN'));
  assert.equal(unknown.taskType, null);

  const unrecognized = await verifyCode(issued, { attestation: mutated });
  assert.equal(unrecognized.outcome, 'INDETERMINATE');
  assert.ok(unrecognized.reasons.includes('RULE_VERSION_UNKNOWN'));
});

test('负例：凭证声明规则版本与测试集合版本不一致时拒绝通过', async () => {
  const issued = await issueCode();
  const mutated = await resign(issued.attestation, issued.privateKey, (copy) => {
    copy.evidence!.testSuite.ruleVersion = 'code-artifact-test-v9';
  });
  const report = await verifyCode(issued, { attestation: mutated });
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('RULE_VERSION_BINDING_MISMATCH'));
});

test('负例：代码未通过固定测试集合时拒绝通过', async () => {
  const failing = [{ path: 'solution.mjs', content: read('artifacts/solution-failing.mjs') }];
  const issued = await issueCode({
    artifactFiles: failing,
    facts: {
      review: {
        decision: 'REJECTED', reviewerId: 'reviewer-code-1', reviewerAddress: null,
        reviewedAt: '2026-11-24T03:55:00.000Z',
      },
      reputation: { eventId: 'code-event-fail', outcome: 'FAIL' },
    },
  });
  assert.equal(issued.attestation.validation.result, 'FAIL');
  const report = await verifyCode(issued);
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('TESTS_FAILED'));
  assert.equal(report.fulfillment, 'RECALCULATED_FAIL');
});

test('负例：测试执行失败或超时不会被视为通过', async () => {
  const hanging = [{ path: 'solution.mjs', content: read('artifacts/solution-hangs.mjs') }];
  const issued = await issueCode({
    artifactFiles: hanging,
    facts: {
      review: {
        decision: 'REJECTED', reviewerId: 'reviewer-code-1', reviewerAddress: null,
        reviewedAt: '2026-11-24T03:55:00.000Z',
      },
      reputation: { eventId: 'code-event-hang', outcome: 'FAIL' },
    },
  });
  assert.equal(issued.attestation.validation.result, 'FAIL');
  const report = await verifyCode(issued);
  assert.equal(report.outcome, 'REJECTED');
  assert.ok(report.reasons.includes('TESTS_FAILED'));

  const suite = CodeTestSuiteSchema.parse(JSON.parse(read('tests.json')));
  const run = runFixedTestSuite({
    suite,
    artifactSource: read('artifacts/solution-hangs.mjs'),
    taskSpecDigest: issued.attestation.input.contentHash,
    suiteDigest: issued.attestation.evidence!.testSuite.contentHash,
    artifactDigest: issued.attestation.delivery.contentHash,
    totalTimeoutMs: 100,
  });
  assert.equal(run.report, null);
  assert.equal(run.failure, 'TEST_RUN_TIMEOUT');
});

test('凭证不包含代码、测试源码与测试名，只保留摘要', async () => {
  const issued = await issueCode();
  const serialized = JSON.stringify(issued.attestation);
  assert.equal(serialized.includes('normalizeTicketCode'), false);
  assert.equal(serialized.includes('保留已有前缀'), false);
  assert.equal(serialized.includes('toUpperCase'), false);
  const digests = [
    issued.attestation.input.contentHash,
    issued.attestation.delivery.contentHash,
    issued.attestation.validation.checksDigest,
    issued.attestation.evidence?.testRun.reportDigest,
  ];
  for (const digest of digests) assert.match(String(digest), /^0x[0-9a-f]{64}$/);
});

test('代码凭证可复用现有摘要与链上承诺标识推导', async () => {
  const issued = await issueCode();
  const digest = attestationDigest(issued.attestation as unknown as Record<string, unknown>);
  assert.equal(digest, issued.attestation.integrity.digest);
  const recordId = attestationRecordId(issued.attestation.attestationId);
  assert.match(recordId, /^0x[0-9a-f]{64}$/);
  assert.match(commitmentKey(recordId), /^0x[0-9a-f]{64}$/);
  const mutated = structuredClone(issued.attestation) as FulfillmentAttestation;
  mutated.evidence!.testRun.passed = 5;
  assert.notEqual(attestationDigest(mutated as unknown as Record<string, unknown>), digest);
  assert.equal(codeReportDigest(JSON.parse(issued.report)), issued.attestation.evidence!.testRun.reportDigest);
});
