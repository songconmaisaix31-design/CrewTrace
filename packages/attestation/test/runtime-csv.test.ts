import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson as chainCanonicalJson } from '../../chain/src/collaboration.js';
import { canonicalJson as sdkCanonicalJson } from '../src/canonical-json.js';
import {
  executeCsvCleanup as sdkCleanup, verifyCsvDelivery as sdkVerify, type CsvWorkerMode,
} from '../src/runtime-csv.js';
import { executeCsvCleanup as runtimeCleanup } from '../../../workers/src/csv-cleanup.js';
import { verifyCsvDelivery as runtimeVerify } from '../../../workers/src/csv-delivery.js';
import { transformCsv, compareCsvTransformation } from '../src/transform.js';

const DELIVERY_SAMPLES = [
  '',
  'record_id,amount_cents\n',
  'record_id,amount_cents\nmcp-a,5\n',
  '\ufeffrecord_id,amount_cents\r\nmcp-a,5\r\n',
  'record_id,amount_cents\nmcp-a,5\nmcp-a,5\n',
  'record_id,amount_cents\nmcp-a,5\nmcp-a,6\n',
  'record_id,amount_cents\nmcp-a,5,extra\n',
  'record_id,amount\nmcp-a,5\n',
  'record_id,amount_cents\n mcp-a ,5 \n',
  'record_id,amount_cents\nmcp-a,007\nmcp-b,-1\n',
  'record_id,amount_cents\nmcp-a\n',
];

const CLEANUP_SAMPLES = [
  'record_id,amount_cents\nmcp-a,5\nmcp-b,7\n',
  'record_id,amount_cents\r\n  mcp-a , 5 \r\n',
  'record_id,amount_cents\nmcp-a,5\nmcp-a,5\n',
  'record_id,amount_cents\nmcp-a,5\nmcp-a,6\n',
  'record_id,amount_cents\nmcp-a,5,extra\n',
  'record_id,amount_cents\nmcp-a\n',
  'record_id,amount_cents\nmcp-a,007\nmcp-b,-1\n',
];

type Thrown = { threw: true; name: string; message: string } | { threw: false; value: string };

function capture(fn: () => string): Thrown {
  try {
    return { threw: false, value: fn() };
  } catch (error) {
    return { threw: true, name: (error as Error).constructor.name, message: (error as Error).message };
  }
}

test('SDK 与 Runtime 的交付校验结果逐项一致', () => {
  for (const content of DELIVERY_SAMPLES) {
    assert.deepEqual(sdkVerify(content), runtimeVerify(content), `样本不一致: ${JSON.stringify(content)}`);
  }
});

test('SDK 与 Runtime 的清洗结果与错误逐项一致', () => {
  for (const mode of ['copy', 'normalize', 'deduplicate'] as CsvWorkerMode[]) {
    for (const content of CLEANUP_SAMPLES) {
      assert.deepEqual(
        capture(() => sdkCleanup(content, mode)),
        capture(() => runtimeCleanup(content, mode)),
        `样本不一致: ${mode} ${JSON.stringify(content)}`,
      );
    }
  }
});

test('转换规则直接采用 Runtime 去重清洗结果', () => {
  for (const content of CLEANUP_SAMPLES) {
    const transform = transformCsv(content);
    const expected = capture(() => runtimeCleanup(content, 'deduplicate'));
    if (!expected.threw) {
      assert.equal(transform.transformable, true);
      assert.equal(transform.expectedContent, expected.value);
    } else {
      assert.equal(transform.transformable, false);
      assert.ok(transform.issues.length > 0);
    }
  }
});

test('交付物与 Runtime 去重结果一致时转换判定通过', () => {
  const input = 'record_id,amount_cents\nmcp-a,5\nmcp-a,5\nmcp-b,7\n';
  const delivery = runtimeCleanup(input, 'deduplicate');
  const comparison = compareCsvTransformation(input, delivery);
  assert.equal(comparison.status, 'MATCH');
});

test('SDK 的 canonicalJson 与 packages/chain 实现一致', () => {
  const samples: unknown[] = [
    null, true, 0, 'text', [1, 'a', null],
    { b: 2, a: 1 }, { z: [{ y: 1, x: 2 }], a: null },
    { 'quote"key': 'line\nbreak' },
  ];
  for (const sample of samples) {
    assert.equal(sdkCanonicalJson(sample), chainCanonicalJson(sample));
  }
});
