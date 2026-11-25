import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyCsvDelivery } from '../../packages/attestation/src/runtime-csv.js';

// 确定性合成样本生成器：不读取数据库、不使用历史测试订单，仅由固定字面量生成。
// 重新生成命令：node --import tsx experiments/verifiable-trust/generate-fixtures.ts
const OUT_DIR = resolve('experiments/verifiable-trust/fixtures');
const GENERATED_AT = '2026-11-25T00:00:00.000Z';

const facts = {
  source: {
    kind: 'synthetic-experiment',
    orderId: '00000000-0000-4000-8000-000000000001',
    buyerAgentId: '00000000-0000-4000-8000-000000000002',
    taskId: '00000000-0000-4000-8000-000000000003',
    attempt: 1,
    workflowVersion: 'csv-workflow-v1',
  },
  service: { serviceId: 'csv-clean-verify-free', serviceVersion: 1 },
  subject: {
    agentId: '00000000-0000-4000-8000-000000000004',
    identity: { namespace: 'ct-local', value: '00000000-0000-4000-8000-000000000004' },
    signingAddress: null,
    role: 'csv-data-review',
  },
  input: { path: 'input.csv', schemaVersion: 'csv-ledger-v1' },
  delivery: { path: 'delivery.csv', deliveryVersion: 1 },
  review: {
    decision: 'ACCEPTED',
    reviewerId: 'synthetic-reviewer',
    reviewerAddress: null,
    reviewedAt: '2026-11-24T03:22:56.583Z',
  },
  reputation: {
    eventId: '00000000-0000-4000-8000-000000000003:csv-data-review:PASS',
    outcome: 'PASS',
    source: 'DETERMINISTIC_REVIEW',
  },
  payment: { status: 'NOT_REQUIRED' },
  rules: { ruleId: 'csv-ledger', ruleVersion: 'csv-ledger-v1' },
};

const input = [
  'record_id,amount_cents',
  'syn-a,1250',
  'syn-a,1250',
  'syn-b,800',
  '',
].join('\n');
const delivery = [
  'record_id,amount_cents',
  'syn-a,1250',
  'syn-b,800',
  '',
].join('\n');

const evidence = verifyCsvDelivery(delivery);
const files: Record<string, string> = {
  'input.csv': input,
  'delivery.csv': delivery,
  'facts.json': `${JSON.stringify(facts, null, 2)}\n`,
  'evidence.json': `${JSON.stringify(evidence, null, 2)}\n`,
};

const sha256 = (content: string): string => createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
const manifest = {
  classification: 'CONTROLLED_SYNTHETIC_EXPERIMENT',
  containsPersonalData: false,
  containsRealOrders: false,
  derivedFromHistoricalOrders: false,
  description: 'Trust SDK V0.1 受控实验样本。全部标识由确定性合成生成器产生，不来自 CrewTrace 数据库、历史测试订单或真实客户。',
  generation: {
    source: 'DETERMINISTIC_SYNTHETIC_GENERATOR',
    script: 'experiments/verifiable-trust/generate-fixtures.ts',
    generatedAt: GENERATED_AT,
    databaseUsed: false,
  },
  transformRule: {
    ruleId: 'csv-cleanup-deduplicate',
    ruleVersion: 'csv-cleanup-deduplicate-v1',
    runtimeContract: 'workers/src/csv-cleanup.ts#deduplicate',
  },
  files: {
    'input.csv': { sha256: sha256(files['input.csv']), role: '原始输入，包含一条重复记录' },
    'delivery.csv': { sha256: sha256(files['delivery.csv']), role: '按 Runtime 去重清洗契约生成的交付物' },
    'facts.json': { sha256: sha256(files['facts.json']), role: '确定性合成签发事实' },
    'evidence.json': { sha256: sha256(files['evidence.json']), role: '确定性审核结果样本' },
  },
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  writeFileSync(resolve(OUT_DIR, name), content);
}
writeFileSync(resolve(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  outDir: OUT_DIR,
  status: evidence.status,
  rowCount: evidence.rowCount,
  contentHash: evidence.contentHash,
  files: Object.fromEntries(Object.entries(manifest.files).map(([name, entry]) => [name, entry.sha256])),
}, null, 2));
