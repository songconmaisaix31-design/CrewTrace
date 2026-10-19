import {
  ApplicationError, CreateRunRequestSchema, RunSchema, TaskSchema, TimestampSchema,
  deriveTaskId, hashUtf8, type CreateRunRequest, type Run, type Task, type TaskStatus,
} from "../../../../packages/contracts/src/index.ts";

export const TEMPLATE_VERSION = "csv-analysis-v1" as const;
export const FIXED_WORKFLOW = Object.freeze([
  Object.freeze({ role: "DATA", dependsOnRoles: Object.freeze([]), output: "normalized CSV" }),
  Object.freeze({ role: "ANALYSIS", dependsOnRoles: Object.freeze(["DATA"] as const), output: "metrics JSON" }),
  Object.freeze({ role: "REPORT", dependsOnRoles: Object.freeze(["ANALYSIS"] as const), output: "report JSON and Markdown" }),
] as const);

export function createFixedRun(input: CreateRunRequest, createdAt: string): Run {
  const request = CreateRunRequestSchema.parse(input);
  const time = TimestampSchema.parse(createdAt);
  if (request.inputContent !== undefined && hashUtf8(request.inputContent) !== request.inputHash) {
    throw new ApplicationError("ARTIFACT_MISMATCH", "运行输入原始字节与 inputHash 不一致");
  }
  const fields = { runId: request.runId, inputHash: request.inputHash, criteriaHash: request.criteriaHash, validator: request.validator };
  const tasks = FIXED_WORKFLOW.map(step => TaskSchema.parse({
    ...fields,
    taskId: deriveTaskId(request.runId, step.role), role: step.role,
    dependsOn: step.dependsOnRoles.map(role => deriveTaskId(request.runId, role)),
    attempt: 1, assignee: null, status: "OPEN",
  }));
  return RunSchema.parse({ ...fields, templateVersion: TEMPLATE_VERSION, mode: "LIVE", status: "OPEN", tasks, createdAt: time });
}

export function deriveRunStatus(tasks: Task[]): Run["status"] {
  if (tasks.length !== 3) throw new ApplicationError("INVALID_INPUT", "固定工作流必须包含三个任务");
  const checked = tasks.map(task => TaskSchema.parse(task));
  if (new Set(checked.map(task => task.runId)).size !== 1 || new Set(checked.map(task => task.role)).size !== 3) {
    throw new ApplicationError("INVALID_INPUT", "运行任务必须属于同一 runId 并覆盖三个角色");
  }
  if (checked.some(task => task.status === "VERIFIED_FAIL")) return "VERIFIED_FAIL";
  if (checked.every(task => task.status === "VERIFIED_PASS")) return "VERIFIED_PASS";
  if (checked.every(task => task.status === "OPEN")) return "OPEN";
  return "RUNNING";
}

const allowedTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  OPEN: ["ASSIGNED"], ASSIGNED: ["RUNNING"], RUNNING: ["SUBMITTED"],
  SUBMITTED: ["VERIFIED_PASS", "VERIFIED_FAIL"], VERIFIED_PASS: [], VERIFIED_FAIL: [],
};

export function assertTaskTransition(current: TaskStatus, next: TaskStatus): void {
  if (!allowedTransitions[current]?.includes(next)) {
    throw new ApplicationError("INVALID_STATE", "任务状态不能进行该单步转换", { current, next });
  }
}

export interface ExecutionBudgetInput {
  operation: "CREATE_RUN" | "MODEL_CALL";
  activeRuns: number;
  modelCalls: number;
  stepCalls: number;
}

export function assertExecutionBudget(input: ExecutionBudgetInput): void {
  if (![input.activeRuns, input.modelCalls, input.stepCalls].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new ApplicationError("INVALID_INPUT", "预算计数必须为非负安全整数");
  }
  if (input.operation !== "CREATE_RUN" && input.operation !== "MODEL_CALL") {
    throw new ApplicationError("INVALID_INPUT", "未知预算操作");
  }
  if ((input.operation === "CREATE_RUN" && input.activeRuns >= 2) || input.activeRuns > 2) {
    throw new ApplicationError("BUDGET_EXCEEDED", "最多同时运行两轮，等待人工操作");
  }
  if (input.operation === "MODEL_CALL" && (input.modelCalls >= 6 || input.stepCalls >= 2)) {
    throw new ApplicationError("BUDGET_EXCEEDED", "模型调用或单步骤重试预算耗尽，等待人工操作");
  }
}
