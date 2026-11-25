import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyCsvDelivery } from '../src/runtime-csv.js';
import { CSV_TRANSFORM_RULE_ID, CSV_TRANSFORM_RULE_VERSION, compareCsvTransformation } from '../src/transform.js';
import { IssueFactsSchema } from '../src/issue.js';

const FIXTURE_DIR = resolve('experiments/verifiable-trust/fixtures');
const read = (name: string): string => readFileSync(join(FIXTURE_DIR, name), 'utf8');

test('实验样本由确定性合成生成器产生', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.classification, 'CONTROLLED_SYNTHETIC_EXPERIMENT');
  assert.equal(manifest.containsPersonalData, false);
  assert.equal(manifest.containsRealOrders, false);
  assert.equal(manifest.derivedFromHistoricalOrders, false);
  assert.equal(manifest.generation.source, 'DETERMINISTIC_SYNTHETIC_GENERATOR');
  assert.equal(manifest.generation.databaseUsed, false);
  assert.equal(manifest.generation.script, 'experiments/verifiable-trust/generate-fixtures.ts');
  assert.equal(manifest.transformRule.ruleId, CSV_TRANSFORM_RULE_ID);
  assert.equal(manifest.transformRule.ruleVersion, CSV_TRANSFORM_RULE_VERSION);
});

test('签发事实来源标注为合成实验而不是历史订单', () => {
  const facts = IssueFactsSchema.parse(JSON.parse(read('facts.json')));
  assert.equal(facts.source.kind, 'synthetic-experiment');
  assert.equal(facts.source.orderId, '00000000-0000-4000-8000-000000000001');
  assert.equal(facts.source.taskId, '00000000-0000-4000-8000-000000000003');
  assert.equal(facts.subject.agentId, '00000000-0000-4000-8000-000000000004');
  const raw = read('facts.json');
  for (const historical of ['crewtrace-local-order', 'e1d9e295', '82d7c1ba', 'ea2dbb8a', 'e57c31ad']) {
    assert.equal(raw.includes(historical), false, `facts.json 仍包含历史订单标记 ${historical}`);
  }
});

test('manifest 记录的文件摘要与实际文件一致', () => {
  const manifest = JSON.parse(read('manifest.json'));
  for (const [name, entry] of Object.entries(manifest.files as Record<string, { sha256: string }>)) {
    const content = readFileSync(join(FIXTURE_DIR, name));
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256, `哈希不一致: ${name}`);
  }
});

test('evidence.json 与交付文件的实际校验结果一致', () => {
  const evidence = JSON.parse(read('evidence.json'));
  assert.deepEqual(evidence, verifyCsvDelivery(read('delivery.csv')));
});

test('交付文件符合 Runtime 去重清洗契约', () => {
  const comparison = compareCsvTransformation(read('input.csv'), read('delivery.csv'));
  assert.equal(comparison.status, 'MATCH');
  assert.equal(comparison.expectedRowCount, 2);
  assert.equal(comparison.actualRowCount, 2);
});
