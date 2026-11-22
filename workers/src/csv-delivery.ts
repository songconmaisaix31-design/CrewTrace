import { createHash } from 'node:crypto';
import { CsvError, parse } from 'csv-parse/sync';

export const CSV_ROLE = 'csv-data-review';
export const CSV_RULE_VERSION = 'csv-ledger-v1';

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
  return { ruleVersion: CSV_RULE_VERSION, contentHash, rowCount, status: issues.length ? 'FAIL' as const : 'PASS' as const, issues };
}
