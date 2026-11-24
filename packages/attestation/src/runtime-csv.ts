import { createHash } from 'node:crypto';
import { CsvError, parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// 本文件是 workers/src/csv-delivery.ts 与 workers/src/csv-cleanup.ts 契约的封装副本。
// Runtime 的清洗与交付校验语义必须与这里逐字一致，SDK 才能在不依赖 workers 源码的情况下复算。
// 一致性由 test/runtime-csv.test.ts 对同一组样本比较两套实现来保证。

export { CsvError } from 'csv-parse/sync';

export const CSV_ROLE = 'csv-data-review';
export const CSV_RULE_VERSION = 'csv-ledger-v1';
export const CSV_WORKER_MODES = ['copy', 'normalize', 'deduplicate'] as const;
export type CsvWorkerMode = typeof CSV_WORKER_MODES[number];

export class CsvConflictError extends Error {}

export function verifyCsvDelivery(content: string) {
  const bytes = Buffer.from(content, 'utf8');
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const issues: string[] = [];
  let rowCount = 0;
  const recordIds = new Set<string>();
  if (!content.trim()) {
    return { ruleVersion: CSV_RULE_VERSION, contentHash, rowCount, status: 'UNRESOLVED' as const, issues: ['INLINE_CSV_REQUIRED'] };
  }
  try {
    const records: string[][] = parse(bytes, { bom: true, skip_empty_lines: true, relax_column_count: true });
    const header = records.shift();
    if (header?.length !== 2 || header[0] !== 'record_id' || header[1] !== 'amount_cents') issues.push('HEADER_MISMATCH');
    if (!records.length) issues.push('NO_DATA_ROWS');
    rowCount = records.length;
    for (const [index, row] of records.entries()) {
      const rowNumber = index + 2;
      const [id, amount] = row;
      if (row.length !== 2) issues.push(`RECORD_${rowNumber}:FIELD_COUNT`);
      if (!id || id !== id.trim()) issues.push(`RECORD_${rowNumber}:INVALID_ID`);
      else if (recordIds.has(id)) issues.push(`RECORD_${rowNumber}:DUPLICATE_ID`);
      else recordIds.add(id);
      if (!amount || !/^(0|[1-9][0-9]{0,11})$/.test(amount)) issues.push(`RECORD_${rowNumber}:INVALID_AMOUNT_CENTS`);
    }
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    issues.push(error.code ?? 'INVALID_CSV');
  }
  return {
    ruleVersion: CSV_RULE_VERSION, contentHash, rowCount,
    status: issues.length ? 'FAIL' as const : 'PASS' as const, issues,
  };
}

export function replayCsvDelivery(content: string, stored: Partial<ReturnType<typeof verifyCsvDelivery>> | null | undefined) {
  const result = verifyCsvDelivery(content);
  const matches = result.ruleVersion === stored?.ruleVersion && result.status === stored.status
    && result.contentHash === stored.contentHash && result.rowCount === stored.rowCount
    && JSON.stringify(result.issues) === JSON.stringify(stored.issues);
  return { matches, result };
}

export function executeCsvCleanup(source: string, mode: CsvWorkerMode): string {
  if (mode === 'copy') return source;
  const rows: string[][] = parse(source, { bom: true });
  const [header, ...data] = rows;
  const seen = new Map<string, string>();
  const normalized = data.flatMap(([rawId, rawAmount]) => {
    const id = rawId.trim();
    const amount = rawAmount.trim();
    if (mode === 'normalize') return [[id, amount]];
    const prior = seen.get(id);
    if (prior !== undefined) {
      if (prior !== amount) throw new CsvConflictError('Duplicate record_id has conflicting amount_cents');
      return [];
    }
    seen.set(id, amount);
    return [[id, amount]];
  });
  return stringify([header, ...normalized]);
}
