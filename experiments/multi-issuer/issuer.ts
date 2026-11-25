import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  CodeTestSuiteSchema, IssueFactsSchema, issueAttestation, issueCodeAttestation, runFixedTestSuite,
} from '../../packages/attestation/src/index.js';
import {
  CODE_FIXTURES, CSV_FIXTURES, argument, read, readJson, write, writeJson,
} from './common.js';

// 受控模拟的签发主体。每个主体生成独立密钥，只导出公开身份、凭证与交付证据，
// 不导出私钥。角色 a 与 b 是两个隔离的签发主体，角色 c 仅用于未授权签发者负例，
// 不出现在任何已签名的信任配置中。

type Role = 'a' | 'b' | 'c';

const ROLES: Record<Role, { issuerId: string; agentId: string; serviceId: string; currentFrom: string }> = {
  a: {
    issuerId: 'issuer-a',
    agentId: '00000000-0000-4000-8000-00000000010a',
    serviceId: 'multi-issuer-a',
    currentFrom: '2026-11-15T00:00:00.000Z',
  },
  b: {
    issuerId: 'issuer-b',
    agentId: '00000000-0000-4000-8000-00000000010b',
    serviceId: 'multi-issuer-b',
    currentFrom: '2026-11-15T00:00:00.000Z',
  },
  c: {
    issuerId: 'issuer-c',
    agentId: '00000000-0000-4000-8000-00000000010c',
    serviceId: 'multi-issuer-c',
    currentFrom: '2026-09-01T00:00:00.000Z',
  },
};

const HISTORICAL_FROM = '2026-09-01T00:00:00.000Z';
const HISTORICAL_TO = '2026-11-15T00:00:00.000Z';
const CURRENT_ISSUED_AT = '2026-11-24T04:00:00.000Z';
const HISTORICAL_ISSUED_AT = '2026-11-01T04:00:00.000Z';

async function main(): Promise<void> {
  const role = argument('--role') as Role;
  const meta = ROLES[role];
  if (!meta) throw new Error(`UNKNOWN_ROLE:${role}`);
  const out = argument('--out');

  const currentKey = generatePrivateKey();
  const currentAddress = privateKeyToAccount(currentKey).address;
  const historicalKey = role === 'c' ? null : generatePrivateKey();
  const historicalAddress = historicalKey ? privateKeyToAccount(historicalKey).address : null;
  const currentKeyId = `${meta.issuerId}-key-2`;
  const historicalKeyId = `${meta.issuerId}-key-1`;

  const baseFacts = IssueFactsSchema.parse(readJson(`${CSV_FIXTURES}/facts.json`));
  const input = read(`${CSV_FIXTURES}/input.csv`);
  const delivery = read(`${CSV_FIXTURES}/delivery.csv`);
  const eventId = 'shared-event-1:csv-data-review:PASS';

  const currentFacts = {
    ...baseFacts,
    source: { ...baseFacts.source, orderId: randomUUID(), buyerAgentId: randomUUID(), taskId: randomUUID() },
    service: { serviceId: meta.serviceId, serviceVersion: 1 },
    subject: {
      ...baseFacts.subject,
      agentId: meta.agentId,
      identity: { namespace: 'ct-local', value: `${meta.issuerId}:agent` },
    },
    review: { ...baseFacts.review, reviewerId: `${meta.issuerId}-reviewer`, reviewedAt: '2026-11-24T03:55:00.000Z' },
    reputation: { ...baseFacts.reputation, eventId },
  };

  const attestation = await issueAttestation({
    facts: currentFacts,
    inputContent: input,
    deliveryContent: delivery,
    privateKey: currentKey,
    issuerId: meta.issuerId,
    keyId: currentKeyId,
    environment: 'local',
    deployment: 'multi-issuer-experiment',
    salts: { order: 'aa'.repeat(32), buyer: 'bb'.repeat(32) },
    now: new Date(CURRENT_ISSUED_AT),
  });

  writeJson(`${out}/csv/attestation.json`, attestation);
  write(`${out}/csv/input.csv`, input);
  write(`${out}/csv/delivery.csv`, delivery);

  // 同一签发主体重复提交同一凭证的负例由验证方构造，签发主体只导出正常凭证。
  // 密钥轮换前的历史凭证由旧密钥签发。旧密钥已经退役但未被撤销，
  // 验证方应能按签发时间核验该凭证。
  if (historicalKey && historicalAddress) {
    const historical = await issueAttestation({
      facts: {
        ...currentFacts,
        review: { ...currentFacts.review, reviewedAt: '2026-11-01T03:55:00.000Z' },
      },
      inputContent: input,
      deliveryContent: delivery,
      privateKey: historicalKey,
      issuerId: meta.issuerId,
      keyId: historicalKeyId,
      environment: 'local',
      deployment: 'multi-issuer-experiment',
      salts: { order: 'cc'.repeat(32), buyer: 'dd'.repeat(32) },
      now: new Date(HISTORICAL_ISSUED_AT),
    });
    writeJson(`${out}/csv/historical-attestation.json`, historical);
  }

  if (role !== 'c') {
    const taskSpec = read(`${CODE_FIXTURES}/task-spec.md`);
    const testSuite = read(`${CODE_FIXTURES}/tests.json`);
    const artifactFiles = [
      { path: 'solution.mjs', content: read(`${CODE_FIXTURES}/artifacts/solution.mjs`) },
      { path: 'ticket-rules.mjs', content: read(`${CODE_FIXTURES}/artifacts/ticket-rules.mjs`) },
    ];
    const taskId = randomUUID();
    const codeAttestation = await issueCodeAttestation({
      facts: {
        subject: {
          agentId: meta.agentId,
          identity: { namespace: 'ct-local', value: `${meta.issuerId}:code-agent` },
          signingAddress: null,
          role: 'code-artifact-author',
          serviceId: `${meta.serviceId}-code`,
          serviceVersion: 1,
        },
        task: { taskId, attempt: 1, workflowVersion: 'multi-issuer-code-v1' },
        review: {
          decision: 'ACCEPTED',
          reviewerId: `${meta.issuerId}-reviewer`,
          reviewerAddress: null,
          reviewedAt: '2026-11-24T03:55:00.000Z',
        },
        reputation: { eventId: `${taskId}:code-artifact-test:PASS`, outcome: 'PASS' },
        payment: { status: 'NOT_REQUIRED' },
      },
      taskSpec: { content: taskSpec, schemaVersion: 'multi-issuer-code-v1' },
      testSuite: { content: testSuite },
      artifact: { entrypoint: 'solution.mjs', files: artifactFiles },
      privateKey: currentKey,
      issuerId: meta.issuerId,
      keyId: currentKeyId,
      environment: 'local',
      deployment: 'multi-issuer-experiment',
      now: new Date(CURRENT_ISSUED_AT),
    });
    const suite = CodeTestSuiteSchema.parse(JSON.parse(testSuite));
    const run = runFixedTestSuite({
      suite,
      artifactSource: artifactFiles[0].content,
      taskSpecDigest: codeAttestation.input.contentHash,
      suiteDigest: codeAttestation.evidence!.testSuite.contentHash,
      artifactDigest: codeAttestation.delivery.contentHash,
    });
    if (!run.report) throw new Error(`CODE_TEST_RUN_FAILED:${run.failure}`);
    writeJson(`${out}/code/attestation.json`, codeAttestation);
    write(`${out}/code/task-spec.md`, taskSpec);
    write(`${out}/code/tests.json`, testSuite);
    writeJson(`${out}/code/files.json`, artifactFiles);
    writeJson(`${out}/code/report.json`, run.report);
  }

  writeJson(`${out}/issuer.json`, {
    issuerId: meta.issuerId,
    role,
    trustStatus: role === 'c' ? 'NOT_IN_SIGNED_CONFIG' : 'DECLARED_BY_OPERATOR',
    credibilityIndependentlyCertified: false,
    privateKeyExported: false,
    activeKeyId: currentKeyId,
    keys: [
      ...(historicalAddress ? [{
        keyId: historicalKeyId,
        address: historicalAddress,
        validFrom: HISTORICAL_FROM,
        validTo: HISTORICAL_TO,
        state: 'ROTATED_OUT',
      }] : []),
      {
        keyId: currentKeyId,
        address: currentAddress,
        validFrom: meta.currentFrom,
        validTo: null,
        state: 'ACTIVE',
      },
    ],
  });

  console.log(JSON.stringify({
    issuer: meta.issuerId,
    out,
    currentAddress,
    historicalAddress,
    tasks: role === 'c' ? ['csv-data-review'] : ['csv-data-review', 'code-artifact-test'],
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
