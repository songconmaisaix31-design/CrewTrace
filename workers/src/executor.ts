import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { contentHash, jsonBytes, utf8 } from "./content.ts";
import { DataPlanSchema, executeCleaning, inspectInput, LIMITATIONS, OPERATIONS } from "./data.ts";
import { AnalysisChoiceSchema, checkObservations, computeMetrics, type MetricsDocument } from "./metrics.ts";
import { ModelBudget, type ModelCall, StepModel } from "./model.ts";
import { checkClaims, type ReportDocument, ReportDraftSchema, renderMarkdown } from "./report.ts";
import { validateAnalysis, validateData, validateReport } from "./validator.ts";

export interface ExecutionContext {
  model: StepModel;
  budget: ModelBudget;
  signal?: AbortSignal;
  beforeCall?: (attempt: number) => Promise<void>;
  onAudit?: (call: ModelCall) => Promise<void>;
}

export async function executeData(sourceBytes: Uint8Array, context: ExecutionContext) {
  const inspection = inspectInput(sourceBytes);
  const plan = await context.model.generate({
    ...context,
    step: "DATA",
    schema: DataPlanSchema,
    instructions: "你负责 DATA。阅读原始 CSV 与工具检查结果，给出可由清洗工具执行的计划。operations 必须包含提供的全部操作且不重复。核对实际行数和重复 record_id；冲突记录禁止猜测。",
    context: { csv: utf8(sourceBytes), inspection: inspection.profile, requiredOperations: OPERATIONS, limitations: LIMITATIONS },
  });
  const dataBytes = executeCleaning(sourceBytes, plan);
  const planBytes = jsonBytes(plan);
  validateData(sourceBytes, dataBytes, planBytes);
  return { dataBytes, planBytes };
}

export async function executeAnalysis(sourceBytes: Uint8Array, dataBytes: Uint8Array, context: ExecutionContext) {
  validateData(sourceBytes, dataBytes);
  const metrics = computeMetrics(inspectInput(dataBytes).records);
  const selected = await context.model.generate({
    ...context,
    step: "ANALYSIS",
    schema: AnalysisChoiceSchema,
    instructions: "你负责 ANALYSIS。核对规范化 CSV 和可信统计工具指标，选择有意义的指标并给出解释。必须包含 total.sales_yuan、total.orders、total.records，可额外选择分类指标。value 逐字复制对应指标的 value。explanation 写简洁中文解释，所有数值都放在 value 字段，文字不另写数值。禁止虚构趋势、因果、额外计算。",
    context: { csv: utf8(dataBytes), trustedToolMetrics: metrics, limitations: LIMITATIONS },
  });
  checkObservations(selected.observations, metrics);
  const document: MetricsDocument = {
    schemaVersion: "business-metrics-v1", sourceHash: contentHash(sourceBytes), dataHash: contentHash(dataBytes),
    metrics, observations: selected.observations, limitations: LIMITATIONS,
  };
  const metricsBytes = jsonBytes(document);
  validateAnalysis(sourceBytes, dataBytes, metricsBytes);
  return { metricsBytes };
}

export async function executeReport(sourceBytes: Uint8Array, dataBytes: Uint8Array, metricsBytes: Uint8Array, context: ExecutionContext) {
  const confirmed = validateAnalysis(sourceBytes, dataBytes, metricsBytes);
  const draft = await context.model.generate({
    ...context,
    step: "REPORT",
    schema: ReportDraftSchema,
    instructions: "你负责 REPORT。只基于本次独立重算确认的指标与分析观察写结构化报告。claims 必须包含 total.sales_yuan、total.orders、total.records，value 必须逐字复制真实指标。数值仅放在 claims.value，正文不另写数值。说明数据为合成示例；不要推断真实业务、增长、因果。报告文字保持简洁，所有数值由工具从 claims 与确认指标渲染。自由文字只提供解释与风格，不作为数值验收证据。",
    context: { confirmedMetrics: confirmed.confirmedMetrics, observations: confirmed.document.observations, limitations: LIMITATIONS },
  });
  checkClaims(draft, confirmed.confirmedMetrics);
  const report: ReportDocument = { ...draft, schemaVersion: "business-report-v1", sourceHash: contentHash(sourceBytes), metricsHash: contentHash(metricsBytes) };
  const reportBytes = jsonBytes(report);
  const markdownBytes = renderMarkdown(report, confirmed.confirmedMetrics);
  validateReport(sourceBytes, dataBytes, metricsBytes, reportBytes, markdownBytes);
  return { reportBytes, markdownBytes };
}

export async function executeRound(inputPath: string, outputPath: string, signal?: AbortSignal) {
  const sourceBytes = await readFile(inputPath);
  inspectInput(sourceBytes);
  const model = new StepModel();
  await model.assertAvailable(signal);
  const budget = new ModelBudget();
  const startedAt = new Date().toISOString();
  const start = performance.now();
  await mkdir(outputPath, { recursive: false });
  await writeFile(join(outputPath, "input.csv"), sourceBytes);
  const onAudit = async () => writeFile(join(outputPath, "model-calls.json"), jsonBytes(budget.calls));
  const context: ExecutionContext = { model, budget, signal, onAudit };
  const data = await executeData(sourceBytes, context);
  await writeFile(join(outputPath, "data.csv"), data.dataBytes);
  await writeFile(join(outputPath, "data-plan.json"), data.planBytes);
  const analysis = await executeAnalysis(sourceBytes, data.dataBytes, context);
  await writeFile(join(outputPath, "metrics.json"), analysis.metricsBytes);
  const report = await executeReport(sourceBytes, data.dataBytes, analysis.metricsBytes, context);
  await writeFile(join(outputPath, "report.json"), report.reportBytes);
  await writeFile(join(outputPath, "report.md"), report.markdownBytes);
  const validation = validateReport(sourceBytes, data.dataBytes, analysis.metricsBytes, report.reportBytes, report.markdownBytes);
  const result = {
    mode: "LOCAL_MODEL_EXECUTION",
    inputPath: resolve(inputPath),
    startedAt,
    durationMs: Math.round(performance.now() - start),
    model: model.model,
    callCount: budget.calls.length,
    validation,
    chainIntegration: "NOT_VERIFIED",
    serviceIntegration: "NOT_VERIFIED",
  };
  await writeFile(join(outputPath, "execution.json"), jsonBytes(result));
  return result;
}

export async function validateDirectory(inputPath: string, outputPath: string) {
  const [source, data, plan, metrics, report, markdown] = await Promise.all([
    readFile(inputPath), readFile(join(outputPath, "data.csv")), readFile(join(outputPath, "data-plan.json")),
    readFile(join(outputPath, "metrics.json")), readFile(join(outputPath, "report.json")), readFile(join(outputPath, "report.md")),
  ]);
  validateData(source, data, plan);
  return validateReport(source, data, metrics, report, markdown);
}
