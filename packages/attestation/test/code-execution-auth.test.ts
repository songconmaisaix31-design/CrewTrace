import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { issueCodeAttestation, runFixedTestSuite, CodeTestSuiteSchema, evaluateCodeVerification } from '../src/code-task.js';
import { authorizeCodeExecution } from '../src/code-execution-grant.js';
import { verifyAttestation } from '../src/verify.js';
import { resolveVerifier, verifierCatalogue } from '../src/verifier.js';
import type { FulfillmentAttestation, IssuerAllowlist, RevocationList } from '../src/schema.js';
import { resign } from './helpers.js';

const NOW = new Date('2026-11-24T04:05:00.000Z');
const ISSUED_AT = new Date('2026-11-24T04:00:00.000Z');

const taskSpec = [
  '# 受控合成任务：工单编号规范化',
  '实现纯函数 normalizeTicketCode(value)，转大写、删除非字母数字、去掉开头 TC、返回 TC- 前缀结果。',
].join('\n');

const suiteText = JSON.stringify({
  format: 'ct-code-test-suite-v1',
  ruleVersion: 'code-artifact-test-v1',
  entrypoint: 'solution.mjs',
  exportName: 'normalizeTicketCode',
  caseTimeoutMs: 500,
  cases: [
    { name: '保留前缀', input: ' tc-1024 ', expected: 'TC-1024' },
    { name: '补全前缀', input: 'ab 77', expected: 'TC-AB77' },
  ],
}, null, 2);

const solutionSource = `function normalizeTicketCode(value) {
  const cleaned = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withoutPrefix = cleaned.startsWith('TC') ? cleaned.slice(2) : cleaned;
  return \`TC-\${withoutPrefix}\`;
}
module.exports = { normalizeTicketCode };
`;

const hangingSource = `function normalizeTicketCode() { while (true) {} }
module.exports = { normalizeTicketCode };
`;

const artifactFiles = [{ path: 'solution.mjs', content: solutionSource }];

async function codeFixture() {
  const issuerKey = generatePrivateKey();
  const issuerAddress = privateKeyToAccount(issuerKey).address;
  const attestation = await issueCodeAttestation({
    facts: {
      subject: {
        agentId: randomUUID(),
        identity: { namespace: 'ct-local', value: 'code-auth-agent' },
        signingAddress: null,
        role: 'code-artifact-author',
        serviceId: 'code-auth-experiment',
        serviceVersion: 1,
      },
      task: { taskId: randomUUID(), attempt: 1, workflowVersion: 'code-auth-v1' },
      review: {
        decision: 'ACCEPTED', reviewerId: 'reviewer-code-auth', reviewerAddress: null,
        reviewedAt: '2026-11-24T03:55:00.000Z',
      },
      reputation: { eventId: 'code-auth-event-1', outcome: 'PASS' },
      payment: { status: 'NOT_REQUIRED' },
    },
    taskSpec: { content: taskSpec, schemaVersion: 'code-auth-v1' },
    testSuite: { content: suiteText },
    artifact: { entrypoint: 'solution.mjs', files: artifactFiles },
    privateKey: issuerKey,
    issuerId: 'code-auth-issuer',
    keyId: 'code-auth-key-1',
    environment: 'local',
    deployment: 'code-execution-auth-experiment',
    now: ISSUED_AT,
  });
  const suite = CodeTestSuiteSchema.parse(JSON.parse(suiteText));
  const run = runFixedTestSuite({
    suite,
    artifactSource: solutionSource,
    taskSpecDigest: attestation.input.contentHash,
    suiteDigest: attestation.evidence!.testSuite.contentHash,
    artifactDigest: attestation.delivery.contentHash,
  });
  if (!run.report) throw new Error('FIXTURE_REPORT_MISSING');
  const allowlist: IssuerAllowlist = {
    version: 'ct-issuer-allowlist-v1',
    issuedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    issuers: [{
      issuerId: 'code-auth-issuer',
      keyId: 'code-auth-key-1',
      address: issuerAddress,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
    }],
  };
  const revocations: RevocationList = {
    version: 'ct-revocation-list-v1',
    issuedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    entries: [],
  };
  return {
    attestation,
    issuerKey,
    issuerAddress,
    allowlist,
    revocations,
    codeEvidence: {
      taskSpec,
      testSuite: suiteText,
      artifactFiles,
      testReport: JSON.stringify(run.report),
    },
  };
}

async function grantFor(fixture: Awaited<ReturnType<typeof codeFixture>>, options: {
  approverKey?: Hex;
  artifactFiles?: Array<{ path: string; content: string }>;
  suiteText?: string;
  issuedAt?: Date;
  expiresAt?: Date;
} = {}) {
  const approverKey = options.approverKey ?? generatePrivateKey();
  const grant = await authorizeCodeExecution({
    grantId: randomUUID(),
    artifactFiles: options.artifactFiles ?? fixture.codeEvidence.artifactFiles,
    testSuiteContent: options.suiteText ?? fixture.codeEvidence.testSuite,
    issuedAt: options.issuedAt ?? ISSUED_AT,
    expiresAt: options.expiresAt ?? new Date('2026-11-24T05:00:00.000Z'),
    approverKey,
  });
  return { grant, address: privateKeyToAccount(approverKey).address, approverKey };
}

async function verify(
  fixture: Awaited<ReturnType<typeof codeFixture>>,
  options: {
    attestation?: unknown;
    grant?: unknown;
    trustedGrantSigners?: string[];
    codeEvidence?: unknown;
  } = {},
) {
  const authorization = await grantFor(fixture);
  return verifyAttestation({
    attestation: options.attestation ?? fixture.attestation,
    allowlist: fixture.allowlist,
    revocations: fixture.revocations,
    codeEvidence: (options.codeEvidence === undefined ? fixture.codeEvidence : options.codeEvidence) as never,
    codeExecutionGrant: options.grant === undefined ? authorization.grant : options.grant,
    trustedGrantSigners: options.trustedGrantSigners ?? [authorization.address],
    recognizedRuleVersions: ['code-artifact-test-v1'],
    now: NOW,
  });
}

test('独立审批授权匹配时执行固定测试并通过', async () => {
  const fixture = await codeFixture();
  const report = await verify(fixture);
  assert.equal(report.outcome, 'VERIFIED_OFFLINE');
  assert.equal(report.codeExecution, 'AUTHORIZED');
  assert.equal(report.quality, 'RECALCULATED_PASS');
});

test('缺少执行授权时验证器不执行代码', async () => {
  const fixture = await codeFixture();
  const report = await verify(fixture, { grant: null });
  assert.equal(report.outcome, 'INDETERMINATE');
  assert.equal(report.codeExecution, 'NOT_AUTHORIZED');
  assert.ok(report.reasons.includes('CODE_EXECUTION_NOT_AUTHORIZED'));
  assert.ok(report.reasons.includes('CODE_EXECUTION_GRANT_MISSING'));
  assert.equal(report.reasons.includes('TEST_RESULT_MISMATCH'), false);
  assert.equal(report.reasons.includes('TESTS_FAILED'), false);
});

test('审批签名者不在本地信任列表时不执行', async () => {
  const fixture = await codeFixture();
  const otherApprover = generatePrivateKey();
  const report = await verify(fixture, { trustedGrantSigners: [privateKeyToAccount(otherApprover).address] });
  assert.equal(report.codeExecution, 'NOT_AUTHORIZED');
  assert.ok(report.reasons.includes('CODE_EXECUTION_GRANT_SIGNER_UNTRUSTED'));
});

test('授权过期、与证据不匹配或审批身份独立于凭证签名', async () => {
  const fixture = await codeFixture();
  const expired = await grantFor(fixture, { expiresAt: new Date('2026-11-24T04:04:59.000Z') });
  const expiredReport = await verify(fixture, { grant: expired.grant, trustedGrantSigners: [expired.address] });
  assert.equal(expiredReport.codeExecution, 'NOT_AUTHORIZED');
  assert.ok(expiredReport.reasons.includes('CODE_EXECUTION_GRANT_EXPIRED'));

  const otherFiles = [{ path: 'solution.mjs', content: `${solutionSource}\n// changed` }];
  const mismatch = await grantFor(fixture, { artifactFiles: otherFiles });
  const mismatchReport = await verify(fixture, { grant: mismatch.grant, trustedGrantSigners: [mismatch.address] });
  assert.equal(mismatchReport.codeExecution, 'NOT_AUTHORIZED');
  assert.ok(mismatchReport.reasons.includes('CODE_EXECUTION_GRANT_MISMATCH'));

  // 用凭证签发密钥签发的授权在审批地址不受信时同样被拒绝。
  const selfGrant = await grantFor(fixture, { approverKey: fixture.issuerKey });
  const independentApprover = generatePrivateKey();
  const selfReport = await verify(fixture, {
    grant: selfGrant.grant,
    trustedGrantSigners: [privateKeyToAccount(independentApprover).address],
  });
  assert.equal(selfReport.codeExecution, 'NOT_AUTHORIZED');
  assert.ok(selfReport.reasons.includes('CODE_EXECUTION_GRANT_SIGNER_UNTRUSTED'));
});

test('凭证签名无效或签发者未知时不执行代码', async () => {
  const fixture = await codeFixture();
  const tampered = structuredClone(fixture.attestation) as FulfillmentAttestation;
  tampered.integrity.signature = `0x${'11'.repeat(65)}`;
  const tamperedReport = await verify(fixture, { attestation: tampered });
  assert.equal(tamperedReport.outcome, 'REJECTED');
  assert.equal(tamperedReport.codeExecution, 'NOT_AUTHORIZED');

  const unknownIssuer = await resign(fixture.attestation, fixture.issuerKey, (copy) => {
    copy.issuer.issuerId = 'unlisted-issuer';
    copy.issuer.keyId = 'unlisted-key';
  });
  const unknownReport = await verify(fixture, { attestation: unknownIssuer });
  assert.equal(unknownReport.outcome, 'REJECTED');
  assert.equal(unknownReport.codeExecution, 'NOT_AUTHORIZED');
  assert.ok(unknownReport.reasons.includes('ISSUER_UNKNOWN'));
  assert.ok(unknownReport.reasons.includes('CODE_EXECUTION_PRECONDITION_UNMET'));
});

test('直接调用验证器且未授权时快速返回不执行', async () => {
  const fixture = await codeFixture();
  const hangingSuite = JSON.stringify({
    ...JSON.parse(suiteText),
    caseTimeoutMs: 5000,
    cases: [{ name: '会挂起', input: 'x', expected: 'TC-X' }],
  });
  const started = Date.now();
  const evaluation = evaluateCodeVerification({
    attestation: fixture.attestation,
    inputContent: null,
    deliveryContent: null,
    codeEvidence: {
      taskSpec,
      testSuite: hangingSuite,
      artifactFiles: [{ path: 'solution.mjs', content: hangingSource }],
      testReport: fixture.codeEvidence.testReport,
    },
    codeExecutionAuthorized: false,
    now: NOW,
  });
  const elapsed = Date.now() - started;
  assert.equal(evaluation.result, 'UNRESOLVED');
  assert.ok(evaluation.reasons.includes('CODE_EXECUTION_NOT_AUTHORIZED'));
  assert.ok(elapsed < 1500, `未授权调用耗时过长: ${elapsed}ms`);
});

test('内置验证器注册表在运行时不可替换', async () => {
  const verifier = resolveVerifier('code-artifact-test', 'code-artifact-test-v1');
  assert.ok(verifier);
  assert.equal(Object.isFrozen(verifier), true);
  assert.throws(() => {
    (verifier as unknown as { evaluate: unknown }).evaluate = () => { throw new Error('replaced'); };
  }, TypeError);
  assert.throws(() => {
    (verifierCatalogue() as unknown as Array<unknown>).push({ verifierId: 'evil', ruleVersion: 'evil-v1', taskType: 'csv-data-review' });
  }, TypeError);
  const entry = verifierCatalogue().find((item) => item.verifierId === 'code-artifact-test');
  assert.ok(entry);
  assert.equal(Object.isFrozen(entry), true);
  assert.deepEqual(verifierCatalogue().map((item) => item.verifierId), ['csv-ledger', 'code-artifact-test']);

  const csvVerifier = resolveVerifier('csv-ledger', 'csv-ledger-v1');
  assert.ok(csvVerifier);
  assert.throws(() => {
    (csvVerifier as unknown as { taskType: unknown }).taskType = 'code-artifact-test';
  }, TypeError);
  assert.equal(resolveVerifier('code-artifact-test', 'csv-ledger-v1'), null);
  assert.equal(resolveVerifier('unknown', 'unknown-v1'), null);
});
