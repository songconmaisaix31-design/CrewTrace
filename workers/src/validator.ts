import { contentHash, exact, utf8 } from "./content.ts";
import { canonicalCsv, checkDataPlan, DataPlanSchema, inspectInput } from "./data.ts";
import { checkObservations, computeMetrics, MetricsDocumentSchema } from "./metrics.ts";
import { checkClaims, renderMarkdown, ReportDocumentSchema } from "./report.ts";

export function validateData(sourceBytes: Uint8Array, dataBytes: Uint8Array, planBytes?: Uint8Array) {
  const source = inspectInput(sourceBytes);
  exact(utf8(dataBytes), utf8(canonicalCsv(source.records)), "规范化 CSV 与原始输入重算结果不同");
  if (planBytes) checkDataPlan(sourceBytes, DataPlanSchema.parse(JSON.parse(utf8(planBytes))));
  return { sourceHash: contentHash(sourceBytes), dataHash: contentHash(dataBytes), normalizedRows: source.records.length, profile: source.profile };
}

export function validateAnalysis(sourceBytes: Uint8Array, dataBytes: Uint8Array, metricsBytes: Uint8Array) {
  const dataValidation = validateData(sourceBytes, dataBytes);
  const document = MetricsDocumentSchema.parse(JSON.parse(utf8(metricsBytes)));
  exact(document.sourceHash, dataValidation.sourceHash, "指标输入摘要不符");
  exact(document.dataHash, dataValidation.dataHash, "指标父产物摘要不符");
  const confirmedMetrics = computeMetrics(inspectInput(sourceBytes).records);
  exact(document.metrics, confirmedMetrics, "指标与实际原始输入重算结果不同");
  checkObservations(document.observations, confirmedMetrics);
  return { ...dataValidation, metricsHash: contentHash(metricsBytes), confirmedMetrics, document };
}

export function validateReport(sourceBytes: Uint8Array, dataBytes: Uint8Array, metricsBytes: Uint8Array, reportBytes: Uint8Array, markdownBytes?: Uint8Array) {
  const analysisValidation = validateAnalysis(sourceBytes, dataBytes, metricsBytes);
  const document = ReportDocumentSchema.parse(JSON.parse(utf8(reportBytes)));
  exact(document.sourceHash, analysisValidation.sourceHash, "报告输入摘要不符");
  exact(document.metricsHash, analysisValidation.metricsHash, "报告指标父产物摘要不符");
  checkClaims(document, analysisValidation.confirmedMetrics);
  if (markdownBytes) exact(utf8(markdownBytes), utf8(renderMarkdown(document, analysisValidation.confirmedMetrics)), "Markdown 与已验证 claims 不符");
  return {
    sourceHash: analysisValidation.sourceHash,
    dataHash: analysisValidation.dataHash,
    metricsHash: analysisValidation.metricsHash,
    reportHash: contentHash(reportBytes),
    normalizedRows: analysisValidation.normalizedRows,
    metricsCount: analysisValidation.confirmedMetrics.length,
    claimsCount: document.claims.length,
  };
}
