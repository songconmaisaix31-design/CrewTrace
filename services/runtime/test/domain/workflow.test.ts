import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApplicationError, ArtifactSchema, AssessmentSchema, ChainReceiptSchema, QualityRecordSchema, TaskSchema,
  CreateRunWithInputRequestSchema, deriveTaskId, hashUtf8, nodeBindingMessage,
  type Address, type OutcomeRecord,
} from "../../../../packages/contracts/src/index.ts";
import {
  aggregateRoleReputation, assertDependenciesReady, assertExecutionBudget, assertTaskTransition,
  collectConfirmedQuality, createFixedRun, deriveRunStatus, requireChainPort, transitionTask,
} from "../../src/domain/index.ts";

const actor: Address = "0x0000000000000000000000000000000000000001";
const validator: Address = "0x0000000000000000000000000000000000000002";
const contract: Address = "0x0000000000000000000000000000000000000003";
const now = "2026-10-17T08:00:00.000Z";
const request = { runId: "policy-example", inputHash: hashUtf8("公开合成 CSV 政策样本\n"), criteriaHash: hashUtf8("公开固定规则样本"), validator };
function errorCode(code: string): (error: unknown) => boolean {
  return error => error instanceof ApplicationError && error.code === code;
}
const run = createFixedRun(request, now);
const data = run.tasks[0];
const analysis = run.tasks[1];
assert.ok(data);
assert.ok(analysis);

test("固定三角色、派生标识、输入与规则绑定", () => {
  assert.deepEqual(run.tasks.map(task => task.role), ["DATA", "ANALYSIS", "REPORT"]);
  assert.deepEqual(data.dependsOn, []);
  assert.deepEqual(analysis.dependsOn, [data.taskId]);
  assert.deepEqual(run.tasks[2]?.dependsOn, [analysis.taskId]);
  assert.ok(run.tasks.every(task => task.status === "OPEN" && task.assignee === null && task.attempt === 1 && task.inputHash === request.inputHash && task.criteriaHash === request.criteriaHash));
  assert.equal(data.taskId, deriveTaskId(request.runId, "DATA"));
  assert.notEqual(data.taskId, deriveTaskId("another-run", "DATA"));
  assert.notEqual(data.taskId, analysis.taskId);
  assert.equal(deriveRunStatus(run.tasks), "OPEN");
  assert.throws(() => createFixedRun({ ...request, inputContent: "改动后的输入" }, now), errorCode("ARTIFACT_MISMATCH"));
  assert.equal(CreateRunWithInputRequestSchema.safeParse(request).success, false);
});

test("keccak256 使用原始 UTF-8 字节并保留换行差异", () => {
  assert.equal(hashUtf8(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(hashUtf8("公开合成 CSV\n"), hashUtf8(new TextEncoder().encode("公开合成 CSV\n")));
  assert.notEqual(hashUtf8("CSV\n"), hashUtf8("CSV\r\n"));
  assert.throws(() => hashUtf8(new Uint8Array([0xff])));
  assert.equal(nodeBindingMessage({ agentId: actor, runtimeId: "data-1" }), `co-vibe node binding\nagentId:${actor}\nruntimeId:data-1`);
});

test("单步合法状态、跨步、终态和旧 attempt", () => {
  assert.doesNotThrow(() => assertTaskTransition("OPEN", "ASSIGNED"));
  assert.doesNotThrow(() => assertTaskTransition("ASSIGNED", "RUNNING"));
  assert.doesNotThrow(() => assertTaskTransition("RUNNING", "SUBMITTED"));
  assert.doesNotThrow(() => assertTaskTransition("SUBMITTED", "VERIFIED_PASS"));
  assert.doesNotThrow(() => assertTaskTransition("SUBMITTED", "VERIFIED_FAIL"));
  for (const [current, next] of [["OPEN", "RUNNING"], ["RUNNING", "VERIFIED_PASS"], ["VERIFIED_PASS", "ASSIGNED"], ["VERIFIED_FAIL", "VERIFIED_PASS"]] as const) {
    assert.throws(() => assertTaskTransition(current, next), errorCode("INVALID_STATE"));
  }
  assert.throws(() => transitionTask(data, "ASSIGNED", { attempt: 2, chainId: 10143, contract }), errorCode("STALE_ATTEMPT"));
  assert.throws(() => transitionTask(data, "ASSIGNED", { attempt: 1, chainId: 10143, contract, assignee: actor, coordinator: actor, dependencies: [] }), errorCode("CHAIN_DATA_MISSING"));
  assert.throws(() => transitionTask({ ...data, status: "SUBMITTED", assignee: actor }, "VERIFIED_PASS", { attempt: 1, chainId: 10143, contract, existingOutcome: true }), errorCode("DUPLICATE_OUTCOME"));
});

test("执行身份必须匹配当前指派且分析任务必须具备上游交接", () => {
  const assigned = { ...data, status: "ASSIGNED" as const, assignee: actor };
  const running = transitionTask(assigned, "RUNNING", { attempt: 1, actor, chainId: 10143, contract, dependencies: [] });
  assert.equal(running.status, "RUNNING");
  assert.equal(assigned.status, "ASSIGNED");
  assert.throws(() => transitionTask(assigned, "RUNNING", { attempt: 1, actor: validator, chainId: 10143, contract, dependencies: [] }), errorCode("UNAUTHORIZED"));
  assert.throws(() => assertDependenciesReady(analysis, [], { chainId: 10143, contract }), errorCode("DEPENDENCY_NOT_READY"));
});

test("未解决、未确认和没有回执的记录不会进入质量统计", () => {
  const waiting: OutcomeRecord = {
    taskId: data.taskId, attempt: 1, assignee: actor, role: "DATA", criteriaHash: request.criteriaHash,
    artifactHash: hashUtf8("公开政策产物"), verdict: "UNRESOLVED", evidenceURI: "policy-example",
    evidenceHash: hashUtf8("尚未获得链上回执"), validator, receipt: null,
  };
  const query = { agentId: actor, role: "DATA" as const, blockNumber: "100", validator, chainId: 10143, contract };
  assert.deepEqual(collectConfirmedQuality([waiting, { ...waiting, verdict: "PASS" }], query), []);
  const pending: OutcomeRecord = { ...waiting, verdict: "PASS", receipt: { chainId: 10143, contract, txHash: hashUtf8("未确认政策输入，不代表真实链上交易"), blockNumber: null, status: "PENDING", signer: validator } };
  assert.deepEqual(collectConfirmedQuality([pending], query), []);
  assert.equal(aggregateRoleReputation([pending], query).passCount, 0);
  assert.equal(aggregateRoleReputation([waiting], query).passCount, 0);
  assert.equal(aggregateRoleReputation([waiting], query).failCount, 0);
  assert.equal(QualityRecordSchema.safeParse({ ...waiting, verdict: "PASS" }).success, false);
  assert.throws(() => aggregateRoleReputation(undefined, query), errorCode("CHAIN_DATA_MISSING"));
  assert.throws(() => requireChainPort(undefined), errorCode("CHAIN_NOT_CONFIGURED"));
});

test("schema 拒绝缺少必需字段、无效确认结构和伪装的旧 attempt", () => {
  const { validator: removed, ...incomplete } = data;
  assert.ok(removed);
  assert.equal(TaskSchema.safeParse(incomplete).success, false);
  assert.equal(TaskSchema.safeParse({ ...data, attempt: 0 }).success, false);
  assert.equal(ChainReceiptSchema.safeParse({ status: "CONFIRMED", blockNumber: null }).success, false);
  assert.equal(ArtifactSchema.safeParse({ artifactId: "missing-fields" }).success, false);
  assert.equal(AssessmentSchema.safeParse({ taskId: data.taskId, verdict: "PASS" }).success, false);
});

test("模型与并行预算边界在调用前拒绝", () => {
  assert.doesNotThrow(() => assertExecutionBudget({ operation: "CREATE_RUN", activeRuns: 1, modelCalls: 0, stepCalls: 0 }));
  assert.throws(() => assertExecutionBudget({ operation: "CREATE_RUN", activeRuns: 2, modelCalls: 0, stepCalls: 0 }), errorCode("BUDGET_EXCEEDED"));
  assert.doesNotThrow(() => assertExecutionBudget({ operation: "MODEL_CALL", activeRuns: 2, modelCalls: 5, stepCalls: 1 }));
  assert.throws(() => assertExecutionBudget({ operation: "MODEL_CALL", activeRuns: 1, modelCalls: 6, stepCalls: 0 }), errorCode("BUDGET_EXCEEDED"));
  assert.throws(() => assertExecutionBudget({ operation: "MODEL_CALL", activeRuns: 1, modelCalls: 4, stepCalls: 2 }), errorCode("BUDGET_EXCEEDED"));
});
