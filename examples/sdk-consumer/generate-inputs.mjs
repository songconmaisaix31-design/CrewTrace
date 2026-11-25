import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { issueAttestation, issueCodeAttestation, CodeTestSuiteSchema, runFixedTestSuite } from '@crewtrace/trust-sdk';

// 独立消费者自带的输入与凭证生成脚本。只使用 SDK 与 Node 内置模块，
// 不读取 CrewTrace 源码目录、不连接 PostgreSQL、不调用原 Web/Runtime/Worker 服务。
// 代码任务为合成样本，不对应任何真实客户或生产仓库。
const root = resolve(import.meta.dirname);
const now = new Date();
const iso = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString();

const input = [
  'record_id,amount_cents',
  'syn-001,1250',
  'syn-001,1250',
  'syn-002,800',
  '',
].join('\n');
const delivery = [
  'record_id,amount_cents',
  'syn-001,1250',
  'syn-002,800',
  '',
].join('\n');

const taskSpec = [
  '# 合成代码任务：工单编号规范化',
  '',
  '实现纯函数 normalizeTicketCode(value)，规则：',
  '1. 转大写；2. 删除非 A-Z、0-9 字符；3. 删除开头的 TC；4. 返回 TC- 加剩余字符。',
].join('\n');

const testSuite = {
  format: 'ct-code-test-suite-v1',
  ruleVersion: 'code-artifact-test-v1',
  entrypoint: 'solution.mjs',
  exportName: 'normalizeTicketCode',
  caseTimeoutMs: 500,
  cases: [
    { name: '保留已有前缀', input: '  tc-1024 ', expected: 'TC-1024' },
    { name: '补全缺失前缀', input: 'ab 77', expected: 'TC-AB77' },
    { name: '统一大写', input: 'TC-9x', expected: 'TC-9X' },
    { name: '空字符串', input: '', expected: 'TC-' },
    { name: '仅符号', input: '  - ', expected: 'TC-' },
    { name: '混合分隔符', input: 'tc_88-a', expected: 'TC-88A' },
  ],
};

const solutionSource = `function normalizeTicketCode(value) {
  const cleaned = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withoutPrefix = cleaned.startsWith('TC') ? cleaned.slice(2) : cleaned;
  return \`TC-\${withoutPrefix}\`;
}

module.exports = { normalizeTicketCode };
`;
const helperSource = `const TICKET_PREFIX = 'TC-';\n\nmodule.exports = { TICKET_PREFIX };\n`;
const artifactFiles = [
  { path: 'solution.mjs', content: solutionSource },
  { path: 'ticket-rules.mjs', content: helperSource },
];

mkdirSync(resolve(root, 'data/code'), { recursive: true });
mkdirSync(resolve(root, 'attestations'), { recursive: true });
writeFileSync(resolve(root, 'data/input.csv'), input);
writeFileSync(resolve(root, 'data/delivery.csv'), delivery);
writeFileSync(resolve(root, 'data/code/task-spec.md'), taskSpec);
writeFileSync(resolve(root, 'data/code/tests.json'), `${JSON.stringify(testSuite, null, 2)}\n`);
writeFileSync(resolve(root, 'data/code/files.json'), `${JSON.stringify(artifactFiles, null, 2)}\n`);

const privateKey = `0x${randomBytes(32).toString('hex')}`;
const issuerId = 'consumer-demo-issuer';
const keyId = 'consumer-demo-key';

const facts = {
  source: {
    kind: 'synthetic-experiment',
    orderId: randomUUID(),
    buyerAgentId: randomUUID(),
    taskId: randomUUID(),
    attempt: 1,
    workflowVersion: 'sdk-consumer-demo-v1',
  },
  service: { serviceId: 'csv-clean-verify-consumer', serviceVersion: 1 },
  subject: {
    agentId: randomUUID(),
    identity: { namespace: 'ct-local', value: 'consumer-demo-agent' },
    signingAddress: null,
    role: 'csv-data-review',
  },
  input: { path: 'data/input.csv', schemaVersion: 'csv-ledger-v1' },
  delivery: { path: 'data/delivery.csv', deliveryVersion: 1 },
  review: {
    decision: 'ACCEPTED',
    reviewerId: 'consumer-demo-reviewer',
    reviewerAddress: null,
    reviewedAt: iso(-60 * 60 * 1000),
  },
  reputation: {
    eventId: `${randomUUID()}:csv-data-review:PASS`,
    outcome: 'PASS',
    source: 'DETERMINISTIC_REVIEW',
  },
  payment: { status: 'NOT_REQUIRED' },
  rules: { ruleId: 'csv-ledger', ruleVersion: 'csv-ledger-v1' },
};

const attestation = await issueAttestation({
  facts,
  inputContent: input,
  deliveryContent: delivery,
  privateKey,
  issuerId,
  keyId,
  environment: 'local',
  deployment: 'sdk-consumer-demo',
  salts: { order: 'cc'.repeat(32), buyer: 'dd'.repeat(32) },
  now,
});

const tampered = structuredClone(attestation);
tampered.delivery.contentHash = `0x${'11'.repeat(32)}`;

const codeAttestation = await issueCodeAttestation({
  facts: {
    subject: {
      agentId: randomUUID(),
      identity: { namespace: 'ct-local', value: 'consumer-demo-code-agent' },
      signingAddress: null,
      role: 'code-artifact-author',
      serviceId: 'code-artifact-verify-consumer',
      serviceVersion: 1,
    },
    task: { taskId: randomUUID(), attempt: 1, workflowVersion: 'sdk-consumer-code-demo-v1' },
    review: {
      decision: 'ACCEPTED',
      reviewerId: 'consumer-demo-reviewer',
      reviewerAddress: null,
      reviewedAt: iso(-60 * 60 * 1000),
    },
    reputation: { eventId: `${randomUUID()}:code-artifact-test:PASS`, outcome: 'PASS' },
    payment: { status: 'NOT_REQUIRED' },
  },
  taskSpec: { content: taskSpec, schemaVersion: 'sdk-consumer-code-demo-v1' },
  testSuite: { content: `${JSON.stringify(testSuite, null, 2)}\n` },
  artifact: { entrypoint: 'solution.mjs', files: artifactFiles },
  privateKey,
  issuerId,
  keyId,
  environment: 'local',
  deployment: 'sdk-consumer-demo',
  now,
});

const suite = CodeTestSuiteSchema.parse(testSuite);
const run = runFixedTestSuite({
  suite,
  artifactSource: solutionSource,
  taskSpecDigest: codeAttestation.input.contentHash,
  suiteDigest: codeAttestation.evidence.testSuite.contentHash,
  artifactDigest: codeAttestation.delivery.contentHash,
});
if (!run.report) throw new Error(`CODE_TEST_RUN_FAILED:${run.failure}`);
writeFileSync(resolve(root, 'data/code/report.json'), `${JSON.stringify(run.report, null, 2)}\n`);

const codeTampered = structuredClone(codeAttestation);
codeTampered.evidence.testRun.passed = 0;
codeTampered.evidence.testRun.failed = 6;
codeTampered.evidence.testRun.exitCode = 1;

writeFileSync(resolve(root, 'attestations/valid.json'), `${JSON.stringify(attestation, null, 2)}\n`);
writeFileSync(resolve(root, 'attestations/tampered.json'), `${JSON.stringify(tampered, null, 2)}\n`);
writeFileSync(resolve(root, 'attestations/code-valid.json'), `${JSON.stringify(codeAttestation, null, 2)}\n`);
writeFileSync(resolve(root, 'attestations/code-tampered.json'), `${JSON.stringify(codeTampered, null, 2)}\n`);

const policy = {
  version: 'ct-trust-policy-v1',
  trustRoot: {
    kind: 'CONTROLLED_LOCAL_CONFIG',
    issuerSource: 'CALLER_SUPPLIED_UNSIGNED',
    revocationSource: 'CALLER_SUPPLIED_UNSIGNED',
    independentlyCertified: false,
    notes: '独立消费者自带受控本地配置；名单未经独立认证，仅用于 SDK 预览验证。',
  },
  allowlist: {
    version: 'ct-issuer-allowlist-v1',
    issuedAt: iso(-60 * 60 * 1000),
    expiresAt: iso(365 * 24 * 60 * 60 * 1000),
    issuers: [{
      issuerId,
      keyId,
      address: attestation.issuer.signerAddress,
      validFrom: iso(-24 * 60 * 60 * 1000),
      validTo: null,
      revokedAt: null,
    }],
  },
  revocations: {
    version: 'ct-revocation-list-v1',
    issuedAt: iso(-60 * 60 * 1000),
    expiresAt: iso(365 * 24 * 60 * 60 * 1000),
    entries: [],
  },
  requireRevocations: true,
  freshness: {
    now: iso(0),
    maxAllowlistAgeSeconds: 365 * 24 * 60 * 60,
    maxRevocationAgeSeconds: 365 * 24 * 60 * 60,
  },
  recognizedRuleVersions: ['csv-ledger-v1', 'code-artifact-test-v1'],
  expectedBinding: { environment: 'local', deployment: 'sdk-consumer-demo' },
  reputation: {
    acceptedOutcomes: ['VERIFIED_OFFLINE'],
    allowOffline: true,
    minOfflineEvidence: 'FULFILLMENT_RECALCULATED',
    requireQuality: true,
    requireFulfillment: true,
    requireFreshRevocationList: true,
    requireFreshAllowlist: true,
  },
};
writeFileSync(resolve(root, 'trust-policy.json'), `${JSON.stringify(policy, null, 2)}\n`);

console.log(JSON.stringify({
  generated: {
    attestationId: attestation.attestationId,
    codeAttestationId: codeAttestation.attestationId,
    issuer: attestation.issuer,
    files: [
      'data/input.csv', 'data/delivery.csv', 'data/code/task-spec.md', 'data/code/tests.json',
      'data/code/files.json', 'data/code/report.json',
      'attestations/valid.json', 'attestations/tampered.json',
      'attestations/code-valid.json', 'attestations/code-tampered.json', 'trust-policy.json',
    ],
  },
}, null, 2));
