import {
  AddressSchema, ApplicationError, ArtifactSchema, AssessmentSchema, HandoffSchema, SubmissionReceiptSchema, TaskSchema,
  hashUtf8, type Address, type Artifact, type Assessment, type ChainReceipt, type Hash,
  type Handoff, type SubmissionReceipt, type Task, type TaskStatus,
} from "../../../../packages/contracts/src/index.ts";
import { assertConfirmedReceipt, type ChainExpectation } from "./chain.ts";
import { assertTaskTransition } from "./workflow.ts";

export interface UpstreamDependency {
  task: Task;
  artifact: Artifact;
  assessment: Assessment;
  handoff?: Handoff;
}
export interface VerifiedDependency extends UpstreamDependency {
  handoff: Handoff;
}

export function assertArtifactBinding(task: Task, artifact: Artifact): void {
  const checkedTask = TaskSchema.parse(task);
  const checkedArtifact = ArtifactSchema.parse(artifact);
  if (checkedArtifact.attempt !== checkedTask.attempt) throw new ApplicationError("STALE_ATTEMPT", "产物 attempt 已失效");
  if (checkedArtifact.taskId !== checkedTask.taskId || checkedArtifact.producer !== checkedTask.assignee) {
    throw new ApplicationError("ARTIFACT_MISMATCH", "产物任务或生产者与指派不一致");
  }
}

export function assertUpstreamVerified(task: Task, dependencies: readonly UpstreamDependency[], expected: ChainExpectation): void {
  const checked = TaskSchema.parse(task);
  if (dependencies.length !== checked.dependsOn.length) {
    throw new ApplicationError("DEPENDENCY_NOT_READY", "缺少完整的已验收上游交接");
  }
  const seen = new Set<string>();
  for (const dependency of dependencies) {
    const upstream = TaskSchema.parse(dependency.task);
    if (seen.has(upstream.taskId) || !checked.dependsOn.includes(upstream.taskId) || upstream.runId !== checked.runId) {
      throw new ApplicationError("ARTIFACT_MISMATCH", "上游交接不属于当前依赖");
    }
    seen.add(upstream.taskId);
    assertArtifactBinding(upstream, dependency.artifact);
    assertPassedAssessment(upstream, dependency.assessment, expected);
  }
}

export function assertDependenciesReady(task: Task, dependencies: readonly UpstreamDependency[], expected: ChainExpectation): void {
  assertUpstreamVerified(task, dependencies, expected);
  const checked = TaskSchema.parse(task);
  for (const dependency of dependencies) {
    const upstream = TaskSchema.parse(dependency.task);
    if (dependency.handoff === undefined) throw new ApplicationError("DEPENDENCY_NOT_READY", "上游产物尚未交接");
    const handoff = HandoffSchema.parse(dependency.handoff);
    if (handoff.status !== "ACCEPTED" || handoff.runId !== checked.runId || handoff.fromTaskId !== upstream.taskId || handoff.toTaskId !== checked.taskId || handoff.artifactId !== dependency.artifact.artifactId || handoff.contentHash !== dependency.artifact.contentHash || handoff.schemaVersion !== dependency.artifact.schemaVersion) {
      throw new ApplicationError("DEPENDENCY_NOT_READY", "下游尚未接受相同版本的已验收上游产物");
    }
  }
}

export function assertPassedAssessment(task: Task, assessment: Assessment, expected: ChainExpectation): void {
  const checked = AssessmentSchema.parse(assessment);
  if (task.status !== "VERIFIED_PASS" || checked.verdict !== "PASS") {
    throw new ApplicationError("DEPENDENCY_NOT_READY", "上游任务尚未通过验收");
  }
  assertAssessmentBinding(task, checked, expected);
}

function assertAssessmentBinding(task: Task, assessment: Assessment, expected: ChainExpectation): void {
  if (assessment.attempt !== task.attempt) throw new ApplicationError("STALE_ATTEMPT", "验收 attempt 已失效");
  if (assessment.taskId !== task.taskId || assessment.validator !== task.validator) {
    throw new ApplicationError("UNAUTHORIZED", "验收任务或验收地址不匹配");
  }
  const receipt = assertConfirmedReceipt(assessment.receipt, expected);
  if (receipt.signer !== task.validator) throw new ApplicationError("UNAUTHORIZED", "回执签名者并非指定验收方");
  if (assessment.checks.length === 0) throw new ApplicationError("INVALID_INPUT", "验收缺少确定性检查项");
  if ((assessment.verdict === "PASS" && assessment.checks.some(check => !check.passed)) || (assessment.verdict === "FAIL" && assessment.checks.every(check => check.passed))) {
    throw new ApplicationError("INVALID_INPUT", "验收结论与检查项矛盾");
  }
}

export interface TaskTransitionContext extends ChainExpectation {
  attempt: number;
  actor?: Address;
  assignee?: Address;
  coordinator?: Address;
  receipt?: ChainReceipt;
  submissionReceipt?: SubmissionReceipt;
  artifact?: Artifact;
  assessment?: Assessment;
  dependencies?: readonly UpstreamDependency[];
  existingOutcome?: boolean;
}

function requireValue<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new ApplicationError("INVALID_INPUT", `状态转换缺少 ${field}`);
  return value;
}

export function transitionTask(task: Task, next: TaskStatus, context: TaskTransitionContext): Task {
  const checked = TaskSchema.parse(task);
  if (context.attempt !== checked.attempt) throw new ApplicationError("STALE_ATTEMPT", "状态转换 attempt 已失效");
  if (context.existingOutcome && (next === "VERIFIED_PASS" || next === "VERIFIED_FAIL")) {
    throw new ApplicationError("DUPLICATE_OUTCOME", "该 taskId 与 attempt 已记录验收结果");
  }
  assertTaskTransition(checked.status, next);
  if (next === "ASSIGNED") {
    const assignee = AddressSchema.parse(requireValue(context.assignee, "assignee"));
    const receipt = assertConfirmedReceipt(context.receipt, context);
    if (receipt.signer !== AddressSchema.parse(requireValue(context.coordinator, "coordinator"))) {
      throw new ApplicationError("UNAUTHORIZED", "指派回执签名者不匹配授权协调者");
    }
    assertUpstreamVerified(checked, requireValue(context.dependencies, "dependencies"), context);
    return TaskSchema.parse({ ...checked, assignee, status: next });
  }
  if (next === "RUNNING" || next === "SUBMITTED") {
    if (AddressSchema.parse(requireValue(context.actor, "actor")) !== checked.assignee) {
      throw new ApplicationError("UNAUTHORIZED", "只有当前被指派的 Agent 可以执行与提交");
    }
  }
  if (next === "RUNNING") {
    assertDependenciesReady(checked, requireValue(context.dependencies, "dependencies"), context);
  }
  if (next === "SUBMITTED") {
    const artifact = ArtifactSchema.parse(requireValue(context.artifact, "artifact"));
    assertArtifactBinding(checked, artifact);
    const receipt = SubmissionReceiptSchema.parse(requireValue(context.submissionReceipt, "submissionReceipt"));
    assertConfirmedReceipt(receipt, context);
    if (receipt.attempt !== checked.attempt) throw new ApplicationError("STALE_ATTEMPT", "提交回执 attempt 已失效");
    if (receipt.signer !== checked.assignee || receipt.taskId !== checked.taskId || receipt.artifactHash !== artifact.contentHash) {
      throw new ApplicationError("ARTIFACT_MISMATCH", "提交回执与 Agent、任务或产物摘要不一致");
    }
  }
  if (next === "VERIFIED_PASS" || next === "VERIFIED_FAIL") {
    const assessment = AssessmentSchema.parse(requireValue(context.assessment, "assessment"));
    const expectedVerdict = next === "VERIFIED_PASS" ? "PASS" : "FAIL";
    if (assessment.verdict === "UNRESOLVED") throw new ApplicationError("DEPENDENCY_NOT_READY", "验收尚未解决，保持等待状态");
    if (assessment.verdict !== expectedVerdict) throw new ApplicationError("INVALID_STATE", "目标状态与验收结论不一致");
    assertArtifactBinding(checked, requireValue(context.artifact, "artifact"));
    assertAssessmentBinding(checked, assessment, context);
  }
  return TaskSchema.parse({ ...checked, status: next });
}

export interface HandoffValidationInput extends ChainExpectation {
  upstream: Task;
  downstream: Task;
  artifact: Artifact;
  assessment: Assessment;
  content: string | Uint8Array;
  expectedSchemaVersion: string;
}

export function validateHandoff(input: HandoffValidationInput): Hash {
  const upstream = TaskSchema.parse(input.upstream);
  const downstream = TaskSchema.parse(input.downstream);
  const artifact = ArtifactSchema.parse(input.artifact);
  if (upstream.runId !== downstream.runId || !downstream.dependsOn.includes(upstream.taskId)) {
    throw new ApplicationError("ARTIFACT_MISMATCH", "交接任务之间没有固定工作流依赖");
  }
  assertArtifactBinding(upstream, artifact);
  assertPassedAssessment(upstream, input.assessment, input);
  const actual = hashUtf8(input.content);
  if (artifact.contentHash !== actual || artifact.schemaVersion !== input.expectedSchemaVersion) {
    throw new ApplicationError("ARTIFACT_MISMATCH", "上游原始文件摘要或 schema 版本不匹配");
  }
  return actual;
}
