import { z } from "zod";
import { CsvError } from "csv-parse";
import { ArtifactSchema, RoleSchema, TaskSchema, type Artifact, type AssessmentCheck, type Task } from "../../packages/contracts/src/index.ts";
import { contentHash, exact, jsonBytes, utf8 } from "./content.ts";
import { LIMITATIONS } from "./data.ts";
import { requireValue, WorkerError } from "./errors.ts";
import { validateAnalysis, validateData, validateReport } from "./validator.ts";
import { CRITERIA_HASH } from "./criteria.ts";

const FileSchema = z.strictObject({
  name: z.enum(["data.csv", "data-plan.json", "metrics.json", "report.json", "report.md"]),
  schemaVersion: z.string().min(1),
  mediaType: z.enum(["text/csv", "application/json", "text/markdown"]),
  content: z.string(),
  contentHash: z.string().regex(/^0x[0-9a-f]{64}$/),
});
const ParentSchema = z.strictObject({ artifactId: z.string(), contentHash: z.string().regex(/^0x[0-9a-f]{64}$/), schemaVersion: z.string() });
export const WorkerProductSchema = z.strictObject({
  schemaVersion: z.literal("worker-output-v1"),
  role: RoleSchema,
  sourceHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  parentArtifacts: z.array(ParentSchema),
  limitations: z.array(z.string().min(1)).min(1),
  files: z.array(FileSchema).min(1).max(2),
});
export type WorkerProduct = z.infer<typeof WorkerProductSchema>;
export interface VerifiedParent { task: Task; artifact: Artifact; content: string }

const FILE_FORMATS = {
  "data.csv": { schemaVersion: "business-csv-v1", mediaType: "text/csv" },
  "data-plan.json": { schemaVersion: "business-data-plan-v1", mediaType: "application/json" },
  "metrics.json": { schemaVersion: "business-metrics-v1", mediaType: "application/json" },
  "report.json": { schemaVersion: "business-report-v1", mediaType: "application/json" },
  "report.md": { schemaVersion: "business-report-markdown-v1", mediaType: "text/markdown" },
} as const;

export function productBytes(role: WorkerProduct["role"], sourceBytes: Uint8Array, files: Partial<Record<keyof typeof FILE_FORMATS, Uint8Array>>, parents: Artifact[]): Buffer {
  return jsonBytes(WorkerProductSchema.parse({
    schemaVersion: "worker-output-v1", role, sourceHash: contentHash(sourceBytes),
    parentArtifacts: parents.map(artifact => ({ artifactId: artifact.artifactId, contentHash: artifact.contentHash, schemaVersion: artifact.schemaVersion })),
    limitations: LIMITATIONS,
    files: Object.entries(files).map(([name, bytes]) => ({ name, ...FILE_FORMATS[name as keyof typeof FILE_FORMATS], content: utf8(bytes!), contentHash: contentHash(bytes!) })),
  }));
}

export function readProduct(content: string): WorkerProduct {
  const product = WorkerProductSchema.parse(JSON.parse(content));
  requireValue(new Set(product.files.map(file => file.name)).size === product.files.length, "ARTIFACT_MISMATCH", "产物文件名重复");
  const required = product.role === "DATA" ? ["data.csv", "data-plan.json"] : product.role === "ANALYSIS" ? ["metrics.json"] : ["report.json", "report.md"];
  exact(product.files.map(file => file.name).sort(), required.sort(), "角色产物文件缺失或多余");
  for (const file of product.files) {
    exact(contentHash(Buffer.from(file.content, "utf8")), file.contentHash, `文件摘要不符 ${file.name}`);
    exact(file.schemaVersion, FILE_FORMATS[file.name].schemaVersion, "文件 schema 不符");
    exact(file.mediaType, FILE_FORMATS[file.name].mediaType, "文件媒体类型不符");
  }
  return product;
}

export function fileBytes(product: WorkerProduct, name: keyof typeof FILE_FORMATS): Buffer {
  const file = product.files.find(file => file.name === name);
  requireValue(file, "ARTIFACT_MISMATCH", `缺少产物文件 ${name}`);
  return Buffer.from(file.content, "utf8");
}

function checkEnvelope(task: Task, artifact: Artifact, content: string, sourceBytes: Uint8Array) {
  TaskSchema.parse(task);
  ArtifactSchema.parse(artifact);
  exact(contentHash(Buffer.from(content, "utf8")), artifact.contentHash, "主产物原始字节摘要不符");
  exact(artifact.schemaVersion, "worker-output-v1", "主产物 schema 不符");
  exact(artifact.taskId, task.taskId, "产物 taskId 不符");
  exact(artifact.attempt, task.attempt, "产物 attempt 不符");
  exact(artifact.producer, task.assignee, "产物 producer 不符");
  const product = readProduct(content);
  exact(product.role, task.role, "产物角色不符");
  exact(product.sourceHash, contentHash(sourceBytes), "产物原始输入摘要不符");
  exact(task.inputHash, contentHash(sourceBytes), "任务原始输入摘要不符");
  exact(task.criteriaHash, CRITERIA_HASH, "任务规则摘要与实际固定验收规则不符");
  exact(artifact.parentArtifactIds, product.parentArtifacts.map(parent => parent.artifactId), "交接父产物集合不符");
  exact(artifact.limitations, product.limitations, "交接限制不符");
  return product;
}

export function validateProduct(input: { task: Task; artifact: Artifact; content: string; inputContent: string; parents: VerifiedParent[] }): AssessmentCheck[] {
  const sourceBytes = Buffer.from(input.inputContent, "utf8");
  const product = checkEnvelope(input.task, input.artifact, input.content, sourceBytes);
  const parents = new Map<string, { parent: VerifiedParent; product: WorkerProduct }>();
  for (const parent of input.parents) {
    requireValue(parent.task.status === "VERIFIED_PASS", "DEPENDENCY_NOT_READY", "上游尚未通过真实验收");
    exact(parent.task.runId, input.task.runId, "上游不属于当前运行");
    const parsed = checkEnvelope(parent.task, parent.artifact, parent.content, sourceBytes);
    requireValue(!parents.has(parent.task.role), "ARTIFACT_MISMATCH", "上游同角色产物存在歧义");
    parents.set(parent.task.role, { parent, product: parsed });
  }
  for (const reference of product.parentArtifacts) {
    const parent = [...parents.values()].find(parent => parent.parent.artifact.artifactId === reference.artifactId);
    requireValue(parent, "DEPENDENCY_NOT_READY", "交接缺少已验收父产物");
    exact(reference.contentHash, parent.parent.artifact.contentHash, "交接父产物摘要不符");
    exact(reference.schemaVersion, parent.parent.artifact.schemaVersion, "交接父产物 schema 不符");
  }
  if (input.task.role === "DATA") {
    exact(product.parentArtifacts, [], "DATA 不应包含父产物");
    validateData(sourceBytes, fileBytes(product, "data.csv"), fileBytes(product, "data-plan.json"));
  } else {
    const data = parents.get("DATA");
    requireValue(data, "DEPENDENCY_NOT_READY", "缺少已验收 DATA 产物");
    const dataBytes = fileBytes(data.product, "data.csv");
    validateData(sourceBytes, dataBytes, fileBytes(data.product, "data-plan.json"));
    if (input.task.role === "ANALYSIS") {
      exact(input.task.dependsOn, [data.parent.task.taskId], "ANALYSIS 依赖任务不符");
      exact(product.parentArtifacts.map(parent => parent.artifactId), [data.parent.artifact.artifactId], "ANALYSIS 父产物不符");
      validateAnalysis(sourceBytes, dataBytes, fileBytes(product, "metrics.json"));
    } else {
      const analysis = parents.get("ANALYSIS");
      requireValue(analysis, "DEPENDENCY_NOT_READY", "缺少已验收 ANALYSIS 产物");
      exact(input.task.dependsOn, [analysis.parent.task.taskId], "REPORT 依赖任务不符");
      exact(product.parentArtifacts.map(parent => parent.artifactId), [analysis.parent.artifact.artifactId], "REPORT 父产物不符");
      exact(analysis.product.parentArtifacts.map(parent => parent.artifactId), [data.parent.artifact.artifactId], "ANALYSIS 的 DATA 来源不符");
      validateReport(sourceBytes, dataBytes, fileBytes(analysis.product, "metrics.json"), fileBytes(product, "report.json"), fileBytes(product, "report.md"));
    }
  }
  return [
    { checkId: "original-bytes", passed: true, message: "原始输入与所有产物字节摘要相符" },
    { checkId: "schema-and-lineage", passed: true, message: "角色 schema、父产物与已验收上游版本相符" },
    { checkId: "trusted-recomputation", passed: true, message: "由原始 CSV 重算通过；指标与 claims 引用相符" },
  ];
}

export function validateArtifact(input: Parameters<typeof validateProduct>[0]): AssessmentCheck[] {
  try {
    return validateProduct(input);
  } catch (error) {
    if (error instanceof WorkerError && error.code === "DEPENDENCY_NOT_READY") throw error;
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof WorkerError || error instanceof CsvError) {
      return [{ checkId: "deterministic-validation", passed: false, message: error instanceof z.ZodError ? "产物 schema 缺项或字段无效" : error.message }];
    }
    throw error;
  }
}
