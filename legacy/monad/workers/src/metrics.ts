import { Decimal } from "decimal.js";
import { z } from "zod";
import type { BusinessRow } from "./data.ts";
import { exact } from "./content.ts";
import { requireValue } from "./errors.ts";

export const MetricSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().regex(/^\d+(?:\.\d{2})?$/),
  unit: z.enum(["yuan", "orders", "records"]),
  dimension: z.strictObject({ kind: z.enum(["total", "category", "date"]), key: z.string() }),
});
export type Metric = z.infer<typeof MetricSchema>;
export const ObservationSchema = z.strictObject({
  metricId: z.string().min(1), value: z.string(), explanation: z.string().min(1).max(500),
});
export const AnalysisChoiceSchema = z.strictObject({ observations: z.array(ObservationSchema).min(3).max(8) });
export const MetricsDocumentSchema = z.strictObject({
  schemaVersion: z.literal("business-metrics-v1"),
  sourceHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  dataHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  metrics: z.array(MetricSchema).min(4),
  observations: z.array(ObservationSchema).min(3).max(8),
  limitations: z.array(z.string()).min(1),
});
export type MetricsDocument = z.infer<typeof MetricsDocumentSchema>;

export function computeMetrics(rows: BusinessRow[]): Metric[] {
  const result: Metric[] = [];
  function aggregate(group: BusinessRow[], kind: "total" | "category" | "date", key: string) {
    const prefix = kind === "total" ? "total" : `${kind}.${encodeURIComponent(key)}`;
    const sales = group.reduce((sum, row) => sum.plus(row.sales_yuan), new Decimal(0));
    const orders = group.reduce((sum, row) => sum.plus(row.orders), new Decimal(0));
    const dimension = { kind, key };
    const label = kind === "total" ? "全部数据" : key;
    result.push(
      { id: `${prefix}.sales_yuan`, label: `${label}销售额`, value: sales.toFixed(2), unit: "yuan", dimension },
      { id: `${prefix}.orders`, label: `${label}订单数`, value: orders.toFixed(0), unit: "orders", dimension },
      { id: `${prefix}.records`, label: `${label}记录数`, value: String(group.length), unit: "records", dimension },
    );
    if (!orders.isZero()) result.push({ id: `${prefix}.average_order_yuan`, label: `${label}平均订单金额`, value: sales.div(orders).toFixed(2, Decimal.ROUND_HALF_UP), unit: "yuan", dimension });
  }
  aggregate(rows, "total", "all");
  for (const kind of ["category", "date"] as const) {
    for (const key of [...new Set(rows.map(row => row[kind]))].sort()) aggregate(rows.filter(row => row[kind] === key), kind, key);
  }
  return result;
}

export function checkObservations(observations: z.infer<typeof ObservationSchema>[], metrics: Metric[]): void {
  requireValue(new Set(observations.map(item => item.metricId)).size === observations.length, "INVALID_METRIC_REFERENCE", "指标引用重复");
  for (const id of ["total.sales_yuan", "total.orders", "total.records"]) {
    requireValue(observations.some(item => item.metricId === id), "INVALID_METRIC_REFERENCE", `缺少必需指标 ${id}`);
  }
  for (const item of observations) {
    const metric = metrics.find(metric => metric.id === item.metricId);
    requireValue(metric, "INVALID_METRIC_REFERENCE", `未定义指标 ${item.metricId}`);
    exact(item.value, metric.value, `指标值不符 ${item.metricId}`);
  }
}
