import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { issueAttestation } from '@crewtrace/trust-sdk';

// 独立消费者自带的输入与凭证生成脚本。只使用 SDK 与 Node 内置模块，
// 不读取 CrewTrace 源码目录、不连接 PostgreSQL、不调用原 Web/Runtime/Worker 服务。
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

mkdirSync(resolve(root, 'data'), { recursive: true });
mkdirSync(resolve(root, 'attestations'), { recursive: true });
writeFileSync(resolve(root, 'data/input.csv'), input);
writeFileSync(resolve(root, 'data/delivery.csv'), delivery);

const privateKey = `0x${randomBytes(32).toString('hex')}`;
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
  issuerId: 'consumer-demo-issuer',
  keyId: 'consumer-demo-key',
  environment: 'local',
  deployment: 'sdk-consumer-demo',
  salts: { order: 'cc'.repeat(32), buyer: 'dd'.repeat(32) },
  now,
});

const tampered = structuredClone(attestation);
tampered.delivery.contentHash = `0x${'11'.repeat(32)}`;

writeFileSync(resolve(root, 'attestations/valid.json'), `${JSON.stringify(attestation, null, 2)}\n`);
writeFileSync(resolve(root, 'attestations/tampered.json'), `${JSON.stringify(tampered, null, 2)}\n`);

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
      issuerId: 'consumer-demo-issuer',
      keyId: 'consumer-demo-key',
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
  recognizedRuleVersions: ['csv-ledger-v1'],
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
    issuer: attestation.issuer,
    files: ['data/input.csv', 'data/delivery.csv', 'attestations/valid.json', 'attestations/tampered.json', 'trust-policy.json'],
  },
}, null, 2));
