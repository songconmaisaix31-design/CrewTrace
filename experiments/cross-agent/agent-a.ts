import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  issueAttestation, issueCodeAttestation, IssueFactsSchema, CodeTestSuiteSchema, runFixedTestSuite,
  authorizeCodeExecution,
} from '../../packages/attestation/src/index.js';

// 受控模拟的 Agent A：执行合成任务、生成交付证据并使用自己的签发密钥签发凭证。
// 该实验只导出公开证据与凭证，不导出私钥，也不代表真实第三方组织采用。

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CSV_FIXTURES = join(ROOT, 'experiments/verifiable-trust/fixtures');
const CODE_FIXTURES = join(ROOT, 'experiments/code-task');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function main(): Promise<void> {
  const out = resolve(argument('--out', join(ROOT, '.local/cross-agent/a-public')));
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const issuer = { issuerId: 'cross-agent-a', keyId: 'agent-a-key-2026-11', address };

  const csvFacts = IssueFactsSchema.parse(JSON.parse(read(join(CSV_FIXTURES, 'facts.json'))));
  const csvInput = read(join(CSV_FIXTURES, 'input.csv'));
  const csvDelivery = read(join(CSV_FIXTURES, 'delivery.csv'));
  const csvAttestation = await issueAttestation({
    facts: csvFacts,
    inputContent: csvInput,
    deliveryContent: csvDelivery,
    privateKey,
    issuerId: issuer.issuerId,
    keyId: issuer.keyId,
    environment: 'local',
    deployment: 'cross-agent-experiment',
    salts: { order: 'cc'.repeat(32), buyer: 'dd'.repeat(32) },
    now: new Date('2026-11-24T04:00:00.000Z'),
  });

  const taskSpec = read(join(CODE_FIXTURES, 'task-spec.md'));
  const testSuite = read(join(CODE_FIXTURES, 'tests.json'));
  const artifactFiles = [
    { path: 'solution.mjs', content: read(join(CODE_FIXTURES, 'artifacts/solution.mjs')) },
    { path: 'ticket-rules.mjs', content: read(join(CODE_FIXTURES, 'artifacts/ticket-rules.mjs')) },
  ];
  const codeAttestation = await issueCodeAttestation({
    facts: {
      subject: {
        agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        identity: { namespace: 'ct-local', value: 'agent-a-code' },
        signingAddress: null,
        role: 'code-artifact-author',
        serviceId: 'crewtrace-code-experiment',
        serviceVersion: 1,
      },
      task: {
        taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        attempt: 1,
        workflowVersion: 'synthetic-code-task-v1',
      },
      review: {
        decision: 'ACCEPTED', reviewerId: 'reviewer-code-1', reviewerAddress: null,
        reviewedAt: '2026-11-24T03:55:00.000Z',
      },
      reputation: { eventId: 'cross-agent-code-1', outcome: 'PASS' },
      payment: { status: 'NOT_REQUIRED' },
    },
    taskSpec: { content: taskSpec, schemaVersion: 'synthetic-code-task-v1' },
    testSuite: { content: testSuite },
    artifact: { entrypoint: 'solution.mjs', files: artifactFiles },
    privateKey,
    issuerId: issuer.issuerId,
    keyId: issuer.keyId,
    environment: 'local',
    deployment: 'cross-agent-experiment',
    now: new Date('2026-11-24T04:00:00.000Z'),
  });

  const suite = CodeTestSuiteSchema.parse(JSON.parse(testSuite));
  const run = runFixedTestSuite({
    suite,
    artifactSource: artifactFiles[0].content,
    taskSpecDigest: codeAttestation.input.contentHash,
    suiteDigest: codeAttestation.evidence!.testSuite.contentHash,
    artifactDigest: codeAttestation.delivery.contentHash,
  });
  if (!run.report) throw new Error('CODE_TEST_RUN_FAILED');

  // 执行授权由独立审批身份签发，与凭证签发密钥无关。审批私钥不导出，
  // Agent B 只获得公开审批地址并自行决定是否信任。
  const approverKey = generatePrivateKey();
  const approverAddress = privateKeyToAccount(approverKey).address;
  const executionGrant = await authorizeCodeExecution({
    grantId: randomUUID(),
    artifactFiles,
    testSuiteContent: testSuite,
    issuedAt: new Date('2026-11-24T04:10:00.000Z'),
    expiresAt: new Date('2026-11-24T06:00:00.000Z'),
    approverKey,
  });

  write(join(out, 'approver.json'), JSON.stringify({
    approverId: 'cross-agent-approver',
    address: approverAddress,
    note: '独立于签发者的受控审批身份，私钥不导出。',
  }, null, 2));

  write(join(out, 'allowlist.json'), JSON.stringify({
    version: 'ct-issuer-allowlist-v1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    issuers: [{
      issuerId: issuer.issuerId,
      keyId: issuer.keyId,
      address,
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
    }],
  }, null, 2));
  write(join(out, 'revocations.json'), JSON.stringify({
    version: 'ct-revocation-list-v1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    entries: [],
  }, null, 2));
  write(join(out, 'csv/attestation.json'), JSON.stringify(csvAttestation, null, 2));
  write(join(out, 'csv/input.csv'), csvInput);
  write(join(out, 'csv/delivery.csv'), csvDelivery);
  write(join(out, 'code/attestation.json'), JSON.stringify(codeAttestation, null, 2));
  write(join(out, 'code/task-spec.md'), taskSpec);
  write(join(out, 'code/tests.json'), testSuite);
  write(join(out, 'code/files.json'), JSON.stringify(artifactFiles, null, 2));
  write(join(out, 'code/report.json'), JSON.stringify(run.report, null, 2));
  write(join(out, 'code/execution-grant.json'), JSON.stringify(executionGrant, null, 2));
  write(join(out, 'manifest.json'), JSON.stringify({
    experiment: 'controlled-cross-agent-simulation',
    note: '受控模拟的跨主体集成，不是真实第三方组织采用。',
    issuer,
    approver: { approverId: 'cross-agent-approver', address: approverAddress, privateKeyExported: false },
    privateKeyExported: false,
    generatedAt: new Date().toISOString(),
    tasks: ['csv-data-review', 'code-artifact-test'],
  }, null, 2));

  console.log(JSON.stringify({
    agent: 'A',
    out,
    issuer: issuer.issuerId,
    taskTypes: ['csv-data-review', 'code-artifact-test'],
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
