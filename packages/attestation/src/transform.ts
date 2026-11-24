import { parse } from 'csv-parse/sync';

export const CSV_TRANSFORM_RULE_ID = 'csv-dedupe-first';
export const CSV_TRANSFORM_RULE_VERSION = 'csv-dedupe-first-v1';
const HEADER = ['record_id', 'amount_cents'] as const;

export interface CsvTransformResult {
  ruleId: string;
  ruleVersion: string;
  transformable: boolean;
  expectedRows: string[][];
  issues: string[];
}

export interface CsvTransformComparison {
  status: 'MATCH' | 'MISMATCH' | 'NOT_ASSERTED';
  reasons: string[];
  expectedRowCount: number;
  actualRowCount: number;
}

function parseRows(content: string): string[][] {
  return parse(Buffer.from(content, 'utf8'), {
    bom: true, skip_empty_lines: true, relax_column_count: true,
  }) as string[][];
}

export function transformCsv(inputContent: string): CsvTransformResult {
  const issues: string[] = [];
  let rows: string[][];
  try {
    rows = parseRows(inputContent);
  } catch {
    return {
      ruleId: CSV_TRANSFORM_RULE_ID, ruleVersion: CSV_TRANSFORM_RULE_VERSION,
      transformable: false, expectedRows: [], issues: ['INPUT_PARSE_FAILED'],
    };
  }
  const header = rows.shift() ?? [];
  if (header.length !== HEADER.length || header[0] !== HEADER[0] || header[1] !== HEADER[1]) {
    issues.push('INPUT_HEADER_MISMATCH');
  }
  const seen = new Map<string, string>();
  const expectedRows: string[][] = [];
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    if (row.length !== 2) {
      issues.push(`INPUT_ROW_${rowNumber}:FIELD_COUNT`);
      continue;
    }
    const [id, amount] = row;
    if (!id || id !== id.trim()) {
      issues.push(`INPUT_ROW_${rowNumber}:INVALID_ID`);
      continue;
    }
    if (!amount || !/^(0|[1-9][0-9]{0,11})$/.test(amount)) {
      issues.push(`INPUT_ROW_${rowNumber}:INVALID_AMOUNT_CENTS`);
      continue;
    }
    const previous = seen.get(id);
    if (previous !== undefined) {
      if (previous !== amount) issues.push(`INPUT_CONFLICT:${id}`);
      continue;
    }
    seen.set(id, amount);
    expectedRows.push([id, amount]);
  }
  if (!expectedRows.length) issues.push('INPUT_NO_VALID_ROWS');
  return {
    ruleId: CSV_TRANSFORM_RULE_ID, ruleVersion: CSV_TRANSFORM_RULE_VERSION,
    transformable: issues.length === 0, expectedRows, issues,
  };
}

export function compareCsvTransformation(inputContent: string, deliveryContent: string): CsvTransformComparison {
  const transform = transformCsv(inputContent);
  if (!transform.transformable) {
    return {
      status: 'NOT_ASSERTED', reasons: transform.issues,
      expectedRowCount: transform.expectedRows.length, actualRowCount: -1,
    };
  }
  let actualRows: string[][];
  try {
    actualRows = parseRows(deliveryContent);
  } catch {
    return {
      status: 'MISMATCH', reasons: ['OUTPUT_PARSE_FAILED'],
      expectedRowCount: transform.expectedRows.length, actualRowCount: -1,
    };
  }
  const header = actualRows.shift() ?? [];
  const reasons: string[] = [];
  if (header.length !== HEADER.length || header[0] !== HEADER[0] || header[1] !== HEADER[1]) {
    reasons.push('OUTPUT_HEADER_MISMATCH');
  }
  const actualIds = new Set<string>();
  let duplicates = false;
  for (const row of actualRows) {
    if (row.length !== 2 || !row[0]) {
      reasons.push('OUTPUT_ROW_INVALID');
      continue;
    }
    if (actualIds.has(row[0])) duplicates = true;
    actualIds.add(row[0]);
  }
  if (duplicates) reasons.push('OUTPUT_DUPLICATE_RECORDS');
  const expectedIds = new Set(transform.expectedRows.map((row) => row[0]));
  if (transform.expectedRows.some((row) => !actualIds.has(row[0]))) reasons.push('OUTPUT_MISSING_RECORDS');
  if ([...actualIds].some((id) => !expectedIds.has(id))) reasons.push('OUTPUT_EXTRA_RECORDS');
  const actualMap = new Map(actualRows.filter((row) => row.length === 2).map((row) => [row[0], row[1]]));
  if (transform.expectedRows.some((row) => actualMap.get(row[0]) !== row[1])) reasons.push('OUTPUT_VALUE_MISMATCH');
  const actualOrder = actualRows.map((row) => row[0]);
  if (actualOrder.join('|') !== transform.expectedRows.map((row) => row[0]).join('|')) reasons.push('OUTPUT_ORDER_MISMATCH');
  return {
    status: reasons.length === 0 ? 'MATCH' : 'MISMATCH',
    reasons,
    expectedRowCount: transform.expectedRows.length,
    actualRowCount: actualRows.length,
  };
}
