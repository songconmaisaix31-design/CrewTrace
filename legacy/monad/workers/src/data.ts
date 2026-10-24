import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { format, isValid, parse as parseDate } from "date-fns";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { exact, utf8 } from "./content.ts";
import { requireValue, WorkerError } from "./errors.ts";

export const COLUMNS = ["record_id", "date", "category", "sales_yuan", "orders"] as const;
export const CLEANING_RULE = "business-csv-v1";
export const DATE_FORMATS = ["yyyy-MM-dd", "yyyy/MM/dd", "yyyy/M/d"] as const;
export const OPERATIONS = ["normalize_dates", "remove_identical_duplicates", "sort_record_id"] as const;
export const LIMITATIONS = ["公开合成业务数据，不代表真实商户", "仅接受固定字段与已定义日期格式", "同一 record_id 的冲突记录立即拒绝"];

const RawRowSchema = z.strictObject({
  record_id: z.string().trim().min(1).max(100),
  date: z.string().trim().min(1),
  category: z.string().trim().min(1).max(100),
  sales_yuan: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/),
  orders: z.string().trim().regex(/^\d+$/),
});
export type BusinessRow = z.infer<typeof RawRowSchema>;

export const DataPlanSchema = z.strictObject({
  ruleVersion: z.literal(CLEANING_RULE),
  operations: z.array(z.enum(OPERATIONS)).length(3),
  sourceRowCount: z.number().int().positive(),
  duplicateRecordIds: z.array(z.string()),
  reason: z.string().min(1).max(1000),
});
export type DataPlan = z.infer<typeof DataPlanSchema>;

function normalizedDate(value: string): { date: string; pattern: string } {
  for (const pattern of DATE_FORMATS) {
    const date = parseDate(value, pattern, new Date(2000, 0, 1));
    if (isValid(date) && format(date, pattern) === value) return { date: format(date, "yyyy-MM-dd"), pattern };
  }
  throw new WorkerError("INVALID_DATE", `不支持或无效的日期 ${value}`);
}

export function inspectInput(bytes: Uint8Array) {
  const matrix = parse(utf8(bytes), { bom: false, skip_empty_lines: false, relax_column_count: false }) as string[][];
  requireValue(matrix.length > 1, "INVALID_CSV", "CSV 必须包含表头与数据");
  exact(matrix[0], COLUMNS, "CSV 字段必须严格为 record_id/date/category/sales_yuan/orders");
  const records: BusinessRow[] = [];
  const seen = new Map<string, BusinessRow>();
  const duplicates = new Set<string>();
  const formats = new Set<string>();
  for (const fields of matrix.slice(1)) {
    requireValue(fields.length === COLUMNS.length, "INVALID_CSV", "CSV 列数不符");
    const raw = RawRowSchema.parse(Object.fromEntries(COLUMNS.map((key, index) => [key, fields[index]])));
    const parsed = normalizedDate(raw.date);
    formats.add(parsed.pattern);
    const sales = new Decimal(raw.sales_yuan);
    requireValue(sales.lte("1000000000000"), "INVALID_AMOUNT", "sales_yuan 超出支持范围");
    requireValue(Number.isSafeInteger(Number(raw.orders)), "INVALID_ORDERS", "orders 超出安全整数范围");
    const row = { ...raw, date: parsed.date, sales_yuan: sales.toFixed(2), orders: String(Number(raw.orders)) };
    const previous = seen.get(row.record_id);
    if (previous) {
      exact(previous, row, `同一 record_id 存在冲突记录: ${row.record_id}`);
      duplicates.add(row.record_id);
    } else {
      seen.set(row.record_id, row);
      records.push(row);
    }
  }
  records.sort((a, b) => a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0);
  return {
    records,
    profile: {
      sourceRowCount: matrix.length - 1,
      normalizedRowCount: records.length,
      duplicateRecordIds: [...duplicates].sort(),
      dateFormats: [...formats].sort(),
      ruleVersion: CLEANING_RULE,
    },
  };
}

export function canonicalCsv(records: BusinessRow[]): Buffer {
  return Buffer.from(stringify(records, { header: true, columns: [...COLUMNS], record_delimiter: "\n" }), "utf8");
}

export function checkDataPlan(bytes: Uint8Array, plan: DataPlan): void {
  const { profile } = inspectInput(bytes);
  exact([...plan.operations].sort(), [...OPERATIONS].sort(), "模型清洗计划缺少必需操作");
  exact(plan.sourceRowCount, profile.sourceRowCount, "模型输入行数不符");
  exact([...plan.duplicateRecordIds].sort(), profile.duplicateRecordIds, "模型重复记录判断不符");
}

export function executeCleaning(bytes: Uint8Array, plan: DataPlan): Buffer {
  checkDataPlan(bytes, DataPlanSchema.parse(plan));
  return canonicalCsv(inspectInput(bytes).records);
}
