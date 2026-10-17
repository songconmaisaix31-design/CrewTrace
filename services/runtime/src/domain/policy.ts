import {
  AgentProfileSchema, ApplicationError, AssignmentDecisionSchema, DecisionInputSchema, RoleReputationSchema, RoleSchema, TimestampSchema,
  hashUtf8, type AgentProfile, type AssignmentDecision, type CandidateScore, type DecisionInput,
  type ExclusionReason, type RoleReputation,
} from "../../../../packages/contracts/src/index.ts";

export const POLICY_VERSION = "role-rep-v1" as const;
export const HEARTBEAT_MAX_AGE_MS = 30_000;

export function calculateReputation(passCount: number, failCount: number): number {
  if (!Number.isSafeInteger(passCount) || !Number.isSafeInteger(failCount) || passCount < 0 || failCount < 0 || !Number.isSafeInteger(passCount + failCount)) {
    throw new ApplicationError("INVALID_INPUT", "PASS 与 FAIL 必须为安全范围内的非负整数");
  }
  return (passCount + 1) / (passCount + failCount + 2);
}

export function candidateExclusions(agent: AgentProfile, role: DecisionInput["role"], evaluatedAt: string): ExclusionReason[] {
  agent = AgentProfileSchema.parse(agent);
  role = RoleSchema.parse(role);
  evaluatedAt = TimestampSchema.parse(evaluatedAt);
  const reasons: ExclusionReason[] = [];
  if (!agent.roles.includes(role)) reasons.push("ROLE_MISMATCH");
  if (agent.lastSeenAt === null) {
    reasons.push("HEARTBEAT_MISSING");
  } else {
    const age = Date.parse(evaluatedAt) - Date.parse(agent.lastSeenAt);
    if (age < 0) reasons.push("HEARTBEAT_IN_FUTURE");
    if (age > HEARTBEAT_MAX_AGE_MS) reasons.push("HEARTBEAT_EXPIRED");
  }
  if (agent.activeTasks >= agent.maxConcurrency) reasons.push("BUSY");
  if (!agent.admitted) reasons.push("NOT_ADMITTED");
  if (!agent.conditionsAccepted) reasons.push("CONDITIONS_NOT_ACCEPTED");
  return reasons;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scoreFraction(candidate: CandidateScore): [bigint, bigint] {
  const pass = BigInt(candidate.passCount);
  const total = pass + BigInt(candidate.failCount) + 2n;
  const max = BigInt(candidate.maxConcurrency);
  return [4n * (pass + 1n) * max + (max - BigInt(candidate.activeTasks)) * total, 5n * total * max];
}

function compareScores(left: CandidateScore, right: CandidateScore): number {
  const [ln, ld] = scoreFraction(left);
  const [rn, rd] = scoreFraction(right);
  const difference = ln * rd - rn * ld;
  return difference === 0n ? compareIds(left.agentId, right.agentId) : difference > 0n ? -1 : 1;
}

function canonicalInput(input: DecisionInput): DecisionInput {
  const parsed = DecisionInputSchema.parse(input);
  const agentIds = new Set<string>();
  for (const agent of parsed.agents) {
    if (agentIds.has(agent.agentId)) throw new ApplicationError("INVALID_INPUT", "候选 Agent 重复", { agentId: agent.agentId });
    agentIds.add(agent.agentId);
  }
  const reputationKeys = new Set<string>();
  for (const reputation of parsed.reputations) {
    const key = `${reputation.agentId}:${reputation.role}`;
    if (reputationKeys.has(key)) throw new ApplicationError("INVALID_INPUT", "角色信誉快照重复", { key });
    reputationKeys.add(key);
    if (reputation.blockNumber !== parsed.repBlockNumber) {
      throw new ApplicationError("CHAIN_DATA_MISSING", "角色信誉与决策区块不一致", { agentId: reputation.agentId, expectedBlock: parsed.repBlockNumber, actualBlock: reputation.blockNumber });
    }
  }
  return {
    ...parsed,
    agents: parsed.agents.sort((a, b) => compareIds(a.agentId, b.agentId)),
    reputations: parsed.reputations.sort((a, b) => compareIds(`${a.agentId}:${a.role}`, `${b.agentId}:${b.role}`)),
  };
}

export function rankCandidates(input: DecisionInput): AssignmentDecision {
  if (!input || !Array.isArray(input.reputations)) {
    throw new ApplicationError("CHAIN_DATA_MISSING", "缺少已确认角色信誉快照");
  }
  if (input.reputations.some(reputation => reputation.confirmed !== true)) {
    throw new ApplicationError("CHAIN_DATA_MISSING", "候选信誉尚未在链上确认");
  }
  const snapshot = canonicalInput(input);
  const candidateScores: CandidateScore[] = [];
  const excludedReasons: AssignmentDecision["excludedReasons"] = [];
  for (const agent of snapshot.agents) {
    const reasons = candidateExclusions(agent, snapshot.role, snapshot.evaluatedAt);
    if (reasons.length > 0) {
      excludedReasons.push({ agentId: agent.agentId, reasons });
      continue;
    }
    const reputation = snapshot.reputations.find(item => item.agentId === agent.agentId && item.role === snapshot.role);
    if (!reputation) {
      throw new ApplicationError("CHAIN_DATA_MISSING", "候选缺少指定角色的已确认链上快照", { agentId: agent.agentId, role: snapshot.role, blockNumber: snapshot.repBlockNumber });
    }
    const checked: RoleReputation = RoleReputationSchema.parse(reputation);
    const R = calculateReputation(checked.passCount, checked.failCount);
    const availability = 1 - agent.activeTasks / agent.maxConcurrency;
    candidateScores.push({
      agentId: agent.agentId, role: snapshot.role, passCount: checked.passCount, failCount: checked.failCount,
      sampleSize: checked.passCount + checked.failCount, reputation: R, availability,
      score: 0.8 * R + 0.2 * availability, activeTasks: agent.activeTasks, maxConcurrency: agent.maxConcurrency,
    });
  }
  candidateScores.sort(compareScores);
  const selected = candidateScores[0];
  const selectedAgentId = selected ? selected.agentId : null;
  const selectionReason = selected
    ? `按 ${POLICY_VERSION} 排名第一；角色 ${snapshot.role}；PASS ${selected.passCount}，FAIL ${selected.failCount}；R=${selected.reputation}，A=${selected.availability}，score=${selected.score}；同分按 agentId 升序`
    : "所有候选均被资格规则排除，等待符合条件的节点";
  const body = { ...snapshot, candidateScores, excludedReasons, selectedAgentId, selectionReason };
  return AssignmentDecisionSchema.parse({ ...body, decisionHash: hashUtf8(JSON.stringify(body)) });
}

export function serializeDecisionBody(decision: AssignmentDecision): string {
  const { decisionHash, ...body } = AssignmentDecisionSchema.parse(decision);
  if (!decisionHash) throw new ApplicationError("INVALID_INPUT", "决策缺少摘要");
  return JSON.stringify(body);
}

export function verifyDecisionSnapshot(decision: AssignmentDecision): AssignmentDecision {
  const stored = AssignmentDecisionSchema.parse(decision);
  const rebuilt = rankCandidates({
    decisionId: stored.decisionId, taskId: stored.taskId, attempt: stored.attempt, role: stored.role,
    policyVersion: stored.policyVersion, repBlockNumber: stored.repBlockNumber, evaluatedAt: stored.evaluatedAt,
    agents: stored.agents, reputations: stored.reputations,
  });
  if (JSON.stringify(stored) !== JSON.stringify(rebuilt)) {
    throw new ApplicationError("ARTIFACT_MISMATCH", "决策快照与复算结果不一致", { decisionId: stored.decisionId });
  }
  return rebuilt;
}
