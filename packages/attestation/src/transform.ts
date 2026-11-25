import { parse } from 'csv-parse/sync';
import { CsvConflictError, CsvError, executeCsvCleanup } from './runtime-csv.js';

// 转换规则直接复用 Runtime 的去重清洗契约（workers/src/csv-cleanup.ts 的 deduplicate 模式），
// 而不是另写一套仅适配固定样本的规则。输入是否可转换、期望输出行序都来自同一实现。
export const CSV_TRANSFORM_RULE_ID = 'csv-cleanup-deduplicate';
export const CSV_TRANSFORM_RULE_VERSION = 'csv-cleanup-deduplicate-v1';
const HEADER = ['record_id', 'amount_cents'] as const;

export interface CsvTransformResult {
  ruleId: string;
  ruleVersion: string;
  transformable: boolean;
  expectedRows: string[][];
  expectedContent: string | null;
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

function transformFailure(issues: string[]): CsvTransformResult {
  return {
    ruleId: CSV_TRANSFORM_RULE_ID, ruleVersion: CSV_TRANSFORM_RULE_VERSION,
    transformable: false, expectedRows: [], expectedContent: null, issues,
  };
}

export function transformCsv(inputContent: string): CsvTransformResult {
  let expectedContent: string;
  try {
    expectedContent = executeCsvCleanup(inputContent, 'deduplicate');
  } catch (error) {
    if (error instanceof CsvConflictError) return transformFailure(['INPUT_DUPLICATE_CONFLICT']);
    if (error instanceof CsvError) return transformFailure([`INPUT_PARSE_FAILED:${error.code ?? 'INVALID_CSV'}`]);
    if (error instanceof TypeError) return transformFailure(['INPUT_ROW_SHAPE_INVALID']);
    throw error;
  }

  let rows: string[][];
  try {
    rows = parseRows(expectedContent);
  } catch (error) {
    if (error instanceof CsvError) return transformFailure([`INPUT_PARSE_FAILED:${error.code ?? 'INVALID_CSV'}`]);
    throw error;
  }

  const issues: string[] = [];
  const header = rows.shift() ?? [];
  if (header.length !== HEADER.length || header[0] !== HEADER[0] || header[1] !== HEADER[1]) {
    issues.push('INPUT_HEADER_MISMATCH');
  }
  for (const [index, row] of rows.entries()) {
    if (row.length !== 2) issues.push(`INPUT_ROW_${index + 2}:FIELD_COUNT`);
  }
  if (!rows.length) issues.push('INPUT_NO_VALID_ROWS');
  return {
    ruleId: CSV_TRANSFORM_RULE_ID, ruleVersion: CSV_TRANSFORM_RULE_VERSION,
    transformable: issues.length === 0, expectedRows: rows, expectedContent, issues,
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
