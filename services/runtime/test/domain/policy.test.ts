import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApplicationError, AssignmentDecisionSchema, RoleReputationSchema, deriveTaskId, hashUtf8,
  type AgentProfile, type DecisionInput, type RoleReputation,
} from "../../../../packages/contracts/src/index.ts";
import { calculateReputation, rankCandidates, serializeDecisionBody, verifyDecisionSnapshot } from "../../src/domain/index.ts";

// PRD 政策示例仅作为纯函数输入，不代表链上地址、回执或真实履历。
const alice = "0x0000000000000000000000000000000000000001";
const bob = "0x0000000000000000000000000000000000000002";
const time = "2026-10-17T08:00:00.000Z";
function agent(agentId: AgentProfile["agentId"], fields: Partial<AgentProfile> = {}): AgentProfile {
  return { agentId, roles: ["DATA"], manifestURI: "policy-example", manifestHash: hashUtf8("policy example"), runtimeId: agentId, lastSeenAt: time, activeTasks: 0, maxConcurrency: 1, admitted: true, conditionsAccepted: true, ...fields };
}
function reputation(agentId: AgentProfile["agentId"], passCount = 0, failCount = 0, role: RoleReputation["role"] = "DATA"): RoleReputation {
  return { agentId, role, passCount, failCount, blockNumber: "100", confirmed: true };
}
function input(fields: Partial<DecisionInput> = {}): DecisionInput {
  return { decisionId: "policy-example", taskId: deriveTaskId("policy-example", "DATA"), attempt: 1, role: "DATA", policyVersion: "role-rep-v1", repBlockNumber: "100", evaluatedAt: time, agents: [agent(alice), agent(bob)], reputations: [reputation(alice), reputation(bob)], ...fields };
}
function errorCode(code: string): (error: unknown) => boolean {
  return error => error instanceof ApplicationError && error.code === code;
}

test("PRD 冷启动先验、样本量及 1 PASS 排名例子", () => {
  assert.equal(calculateReputation(0, 0), 0.5);
  assert.equal(calculateReputation(1, 0), 2 / 3);
  const decision = rankCandidates(input({ reputations: [reputation(alice, 1), reputation(bob)] }));
  assert.equal(decision.selectedAgentId, alice);
  assert.equal(decision.candidateScores[0]?.sampleSize, 1);
  assert.equal(decision.candidateScores[0]?.score, 0.8 * (2 / 3) + 0.2);
  assert.equal(decision.candidateScores[1]?.sampleSize, 0);
  const cold = decision.candidateScores[1];
  assert.ok(cold);
  assert.ok(Math.abs(cold.score - 0.6) < 1e-12);
});

test("REPORT 履历不会增加 DATA 分值", () => {
  const without = rankCandidates(input());
  const withReport = rankCandidates(input({ reputations: [reputation(alice), reputation(alice, 50, 0, "REPORT"), reputation(bob)] }));
  assert.deepEqual(withReport.candidateScores, without.candidateScores);
  assert.throws(() => rankCandidates(input({ reputations: [reputation(alice, 50, 0, "REPORT"), reputation(bob)] })), errorCode("CHAIN_DATA_MISSING"));
});

test("同分按 agentId 排序且候选输入次序不影响快照", () => {
  const first = rankCandidates(input());
  const reversed = rankCandidates(input({ agents: [agent(bob), agent(alice)], reputations: [reputation(bob), reputation(alice)] }));
  assert.equal(reversed.selectedAgentId, alice);
  assert.deepEqual(reversed, first);
});

test("相等有理数评分使用稳定排序", () => {
  const decision = rankCandidates(input({
    agents: [agent(bob, { maxConcurrency: 2, activeTasks: 1 }), agent(alice)],
    reputations: [reputation(bob, 2, 4), reputation(alice, 0, 2)],
  }));
  // R甲=1/4,A甲=1；R乙=3/8,A乙=1/2，两者总分均为 0.4。
  assert.equal(decision.selectedAgentId, alice);
});

test("忙碌优先过滤，心跳 30 秒边界、过期与缺失原因完整", () => {
  const busy = rankCandidates(input({ agents: [agent(alice, { activeTasks: 1 }), agent(bob)], reputations: [reputation(bob)] }));
  assert.equal(busy.selectedAgentId, bob);
  assert.deepEqual(busy.excludedReasons, [{ agentId: alice, reasons: ["BUSY"] }]);
  const atBoundary = rankCandidates(input({ agents: [agent(alice, { lastSeenAt: "2026-10-17T07:59:30.000Z" })], reputations: [reputation(alice)] }));
  assert.equal(atBoundary.selectedAgentId, alice);
  const expired = rankCandidates(input({ agents: [agent(alice, { lastSeenAt: "2026-10-17T07:59:29.999Z" }), agent(bob, { lastSeenAt: null })], reputations: [] }));
  assert.equal(expired.selectedAgentId, null);
  assert.deepEqual(expired.excludedReasons.map(item => item.reasons), [["HEARTBEAT_EXPIRED"], ["HEARTBEAT_MISSING"]]);
});

test("角色、准入、接单条件与未来心跳逐一排除", () => {
  const decision = rankCandidates(input({ agents: [agent(alice, { roles: ["REPORT"], admitted: false, conditionsAccepted: false, lastSeenAt: "2026-10-17T08:00:01.000Z" })], reputations: [] }));
  assert.deepEqual(decision.excludedReasons[0]?.reasons, ["ROLE_MISMATCH", "HEARTBEAT_IN_FUTURE", "NOT_ADMITTED", "CONDITIONS_NOT_ACCEPTED"]);
});

test("缺链快照、区块不一致及重复候选立即失败", () => {
  assert.throws(() => rankCandidates(input({ reputations: [] })), errorCode("CHAIN_DATA_MISSING"));
  assert.throws(() => rankCandidates(input({ reputations: [{ ...reputation(alice), blockNumber: "99" }, reputation(bob)] })), errorCode("CHAIN_DATA_MISSING"));
  assert.throws(() => rankCandidates(input({ agents: [agent(alice), agent(alice)] })), errorCode("INVALID_INPUT"));
  assert.equal(RoleReputationSchema.safeParse({ ...reputation(alice), confirmed: false }).success, false);
});

test("快照可以独立复算，篡改分值、理由、选择及摘要均拒绝", () => {
  const decision = rankCandidates(input({ reputations: [reputation(alice, 1), reputation(bob)] }));
  assert.equal(hashUtf8(serializeDecisionBody(decision)), decision.decisionHash);
  assert.deepEqual(verifyDecisionSnapshot(JSON.parse(JSON.stringify(decision))), decision);
  const first = decision.candidateScores[0];
  assert.ok(first);
  assert.throws(() => verifyDecisionSnapshot({ ...decision, candidateScores: [{ ...first, score: 0.1 }, ...decision.candidateScores.slice(1)] }), errorCode("ARTIFACT_MISMATCH"));
  assert.throws(() => verifyDecisionSnapshot({ ...decision, selectionReason: "任意理由" }), errorCode("ARTIFACT_MISMATCH"));
  assert.throws(() => verifyDecisionSnapshot({ ...decision, selectedAgentId: bob }), errorCode("ARTIFACT_MISMATCH"));
  assert.throws(() => verifyDecisionSnapshot({ ...decision, decisionHash: hashUtf8("changed") }), errorCode("ARTIFACT_MISMATCH"));
  const { repBlockNumber: removed, ...incomplete } = decision;
  assert.ok(removed);
  assert.equal(AssignmentDecisionSchema.safeParse(incomplete).success, false);
});
