import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256, toBytes } from "viem";
import { ChainReceiptSchema, SubmissionReceiptSchema, type ChainEvent, type ChainReceipt } from "../../contracts/src/index.ts";
import {
  assertAssignmentReceipt, assertOutcomeReceipt, assertSubmissionReceipt, ChainError,
  createChainPort, fromLedgerRole, safeCount, toChainRunId, toLedgerRole,
} from "../src/index.ts";

// 原样保留 A 已确认的公开测试网记录，数据来源和范围由该文件注明。
const history = JSON.parse(await readFile(new URL("./fixtures/a-smoke-testnet.json", import.meta.url), "utf8"));
const receipts: ChainReceipt[] = history.receipts.map((receipt: { events: { args: { role?: number } }[] }) => ChainReceiptSchema.parse({
  ...receipt,
  events: receipt.events.map(event => ({ ...event, args: event.args.role === undefined ? event.args : { ...event.args, role: fromLedgerRole(event.args.role) } })),
}));
function findReceipt<N extends ChainEvent["eventName"]>(name: N): { receipt: ChainReceipt; event: Extract<ChainEvent, { eventName: N }> } {
  for (const receipt of receipts) {
    const event = receipt.events?.find(value => value.eventName === name);
    if (event) return { receipt, event: event as Extract<ChainEvent, { eventName: N }> };
  }
  throw new Error(`A 交付缺少 ${name}`);
}
const assigned = findReceipt("TaskAssigned");
const submitted = findReceipt("ArtifactSubmitted");
const outcome = findReceipt("OutcomeRecorded");
const registered = findReceipt("AgentRegistered");
const network = { chainId: outcome.receipt.chainId, contract: outcome.receipt.contract };
const submissionInput = {
  ...network, taskId: submitted.event.args.taskId, attempt: submitted.event.args.attempt,
  artifactHash: submitted.event.args.artifactHash, artifactURI: submitted.event.args.artifactURI,
  producer: submitted.event.args.producer, chainRunId: submitted.event.args.runId,
};
const outcomeInput = {
  ...network, taskId: outcome.event.args.taskId, attempt: outcome.event.args.attempt,
  verdict: outcome.event.args.passed ? "PASS" as const : "FAIL" as const,
  artifactHash: outcome.event.args.artifactHash, criteriaHash: assigned.event.args.criteriaHash,
  evidenceHash: outcome.event.args.evidenceHash, evidenceURI: outcome.event.args.evidenceURI,
  validator: outcome.event.args.validator, assignee: outcome.event.args.assignee,
  role: outcome.event.args.role, chainRunId: outcome.event.args.runId,
};
const mismatch = (error: unknown) => error instanceof ChainError && error.code === "RECEIPT_MISMATCH";

test("真实提交回执保留事件标识并绑定产物与执行者", () => {
  const result = assertSubmissionReceipt(submitted.receipt, submissionInput);
  assert.equal(result.txHash, submitted.receipt.txHash);
  assert.equal(result.events?.[0]?.eventId, submitted.event.eventId);
  assert.deepEqual(SubmissionReceiptSchema.parse(result), result);
});

test("同合约已确认登记交易不能作为提交或验收回执", () => {
  assert.throws(() => assertSubmissionReceipt(registered.receipt, submissionInput), mismatch);
  assert.throws(() => assertOutcomeReceipt(registered.receipt, outcomeInput), mismatch);
});

test("真实提交回执拒绝其他实际任务、签名者、产物与URI", () => {
  const another = receipts.flatMap(receipt => receipt.events ?? []).find(event => event.eventName === "ArtifactSubmitted" && event.args.taskId !== submitted.event.args.taskId);
  assert.ok(another && another.eventName === "ArtifactSubmitted");
  assert.throws(() => assertSubmissionReceipt(submitted.receipt, { ...submissionInput, taskId: another.args.taskId }), mismatch);
  assert.throws(() => assertSubmissionReceipt(submitted.receipt, { ...submissionInput, producer: outcome.event.args.validator }), mismatch);
  assert.throws(() => assertSubmissionReceipt(submitted.receipt, { ...submissionInput, artifactHash: outcome.event.args.evidenceHash }), mismatch);
  assert.throws(() => assertSubmissionReceipt(submitted.receipt, { ...submissionInput, artifactURI: outcome.event.args.evidenceURI }), mismatch);
  assert.throws(() => assertSubmissionReceipt(submitted.receipt, { ...submissionInput, attempt: submissionInput.attempt + 1 }), mismatch);
});

test("真实验收回执逐项核对结论、证据、角色与验收方", () => {
  assert.deepEqual(assertOutcomeReceipt(outcome.receipt, outcomeInput), outcome.receipt);
  assert.throws(() => assertOutcomeReceipt(outcome.receipt, { ...outcomeInput, verdict: "FAIL" }), mismatch);
  assert.throws(() => assertOutcomeReceipt(outcome.receipt, { ...outcomeInput, validator: outcome.event.args.assignee }), mismatch);
  assert.throws(() => assertOutcomeReceipt(outcome.receipt, { ...outcomeInput, evidenceHash: outcome.event.args.artifactHash }), mismatch);
  assert.throws(() => assertOutcomeReceipt(outcome.receipt, { ...outcomeInput, role: "REPORT" }), mismatch);
  assert.throws(() => assertOutcomeReceipt(outcome.receipt, { ...outcomeInput, assignee: outcome.event.args.validator }), mismatch);
});

test("真实指派的链上runId不能冒充应用runId原文", () => {
  const args = assigned.event.args;
  assert.throws(() => assertAssignmentReceipt(assigned.receipt, { ...network, ...args, coordinator: assigned.receipt.signer }), mismatch);
});

test("角色、runId映射与安全整数边界", () => {
  for (const role of ["DATA", "ANALYSIS", "REPORT"] as const) assert.equal(fromLedgerRole(toLedgerRole(role)), role);
  assert.equal(toChainRunId(history.runIds[0]), keccak256(toBytes(history.runIds[0])));
  assert.equal(safeCount(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.throws(() => safeCount(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
  assert.throws(() => safeCount(-1n));
  assert.throws(() => fromLedgerRole(3));
});

test("缺少真实链配置立即失败", async () => {
  await assert.rejects(createChainPort({ rpcUrl: "", chainId: 10143, contractAddress: network.contract, deploymentBlock: "71765088" }), { code: "CHAIN_NOT_CONFIGURED" });
});
