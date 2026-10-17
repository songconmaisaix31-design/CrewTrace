import { z } from "zod";
import { exact } from "./content.ts";
import { requireValue } from "./errors.ts";
import type { Metric } from "./metrics.ts";

const prose = z.string().min(1).max(800);
export const ReportDraftSchema = z.strictObject({
  title: prose,
  summary: prose,
  claims: z.array(z.strictObject({ metricId: z.string(), value: z.string(), interpretation: prose })).min(3).max(8),
  limitations: z.array(prose).min(1).max(5),
});
export const ReportDocumentSchema = ReportDraftSchema.extend({
  schemaVersion: z.literal("business-report-v1"),
  sourceHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  metricsHash: z.string().regex(/^0x[a-f0-9]{64}$/),
});
export type ReportDraft = z.infer<typeof ReportDraftSchema>;
export type ReportDocument = z.infer<typeof ReportDocumentSchema>;

export function checkClaims(report: ReportDraft, confirmedMetrics: Metric[]): void {
  ReportDraftSchema.parse({ title: report.title, summary: report.summary, claims: report.claims, limitations: report.limitations });
  requireValue(new Set(report.claims.map(claim => claim.metricId)).size === report.claims.length, "INVALID_CLAIM", "报告引用重复");
  for (const id of ["total.sales_yuan", "total.orders", "total.records"]) requireValue(report.claims.some(claim => claim.metricId === id), "INVALID_CLAIM", `报告缺少 ${id}`);
  for (const claim of report.claims) {
    const metric = confirmedMetrics.find(metric => metric.id === claim.metricId);
    requireValue(metric, "INVALID_METRIC_REFERENCE", `报告引用未确认指标 ${claim.metricId}`);
    exact(claim.value, metric.value, `报告数值不符 ${claim.metricId}`);
  }
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>#|!]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

export function renderMarkdown(report: ReportDocument, metrics: Metric[]): Buffer {
  checkClaims(report, metrics);
  const unit = { yuan: "元", orders: "笔", records: "条" };
  const claims = report.claims.map(claim => {
    const metric = metrics.find(metric => metric.id === claim.metricId)!;
    return `- ${markdownText(metric.label)}：${claim.value} ${unit[metric.unit]}。${markdownText(claim.interpretation)} [指标：${claim.metricId}]`;
  });
  return Buffer.from([
    `# ${markdownText(report.title)}`, "", "来源：公开合成业务 CSV。", "", markdownText(report.summary), "", ...claims, "", "## 限制", "",
    ...report.limitations.map(value => `- ${markdownText(value)}`), "", `指标原始字节摘要：${report.metricsHash}`, `输入原始字节摘要：${report.sourceHash}`, "",
  ].join("\n"), "utf8");
}
