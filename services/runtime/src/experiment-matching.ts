import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { CollaborationAgentSchema, type CollaborationTask } from '../../../packages/contracts/src/index.ts';
import { CSV_ROLE } from '../../../workers/src/csv-delivery.ts';
import type { Collaboration } from './collaboration.js';
import { sameCollaborator } from './collaboration-store.js';
import { calculateReputation, HEARTBEAT_MAX_AGE_MS } from './domain/policy.js';
import type { Principal } from './auth.js';
import { loadVerifiedReputation, type AgentVerifiedSummary } from './trust/verified-reputation.js';
import type { TrustEnvironment } from './trust/trust-environment.js';

export const MATCHING_POLICY = 'csv-role-reputation-v1';
export const VERIFIED_MATCHING_POLICY = 'csv-verified-reputation-v1';
export const CAPABILITY_MATCHING_POLICY = 'csv-capability-v1';
export const RANDOM_MATCHING_POLICY = 'csv-random-v1';
const ACTIVE_CLAIM_LIMIT = 2;
const skill = (value: string) => value.trim().toLowerCase();

export type MatchingStrategy = 'A_RANDOM' | 'B_CAPABILITY' | 'C_RUNTIME_REPUTATION' | 'D_VERIFIED_REPUTATION';

export interface MatchingOptions {
  strategy?: MatchingStrategy;
  shadow?: boolean;
  trustEnvironment?: TrustEnvironment;
}

function policyVersionOf(strategy: MatchingStrategy, workers: boolean): string {
  if (strategy === 'C_RUNTIME_REPUTATION') return workers ? 'csv-worker-reputation-v2' : MATCHING_POLICY;
  if (strategy === 'A_RANDOM') return RANDOM_MATCHING_POLICY;
  if (strategy === 'B_CAPABILITY') return CAPABILITY_MATCHING_POLICY;
  return VERIFIED_MATCHING_POLICY;
}

function randomFraction(seed: string): number {
  return (Number.parseInt(seed.slice(0, 8), 16) + 1) / 0x1_0000_0000;
}

export async function snapshotMatching(service: Collaboration, actor: Principal, taskId: string) {
  return service.store.write(actor, async (client, actorId) => {
    const task = await service.task(taskId, client);
    sameCollaborator(actorId, task.creator);
    return rankAndSave(client, task, CSV_ROLE, undefined, true, {
      strategy: service.app.config.EXPERIMENT_MATCHING_POLICY,
      shadow: service.app.config.EXPERIMENT_MATCHING_MODE === 'shadow',
      trustEnvironment: service.app.trustEnvironment,
    });
  });
}

export async function rankAndSave(client:PoolClient,task:CollaborationTask,role:string,workers?:string[],saveEmpty=true,options:MatchingOptions={}) {
    const {taskId,creator:actorId}=task;
    const strategy=options.strategy??'C_RUNTIME_REPUTATION';
    const shadow=options.shadow===true;
    const verified=options.trustEnvironment?.enabled&&(strategy==='D_VERIFIED_REPUTATION'||shadow)
      ?(await loadVerifiedReputation(client,options.trustEnvironment,{role})).byAgent:{};
    const evaluatedAt = new Date().toISOString();
    const requiredSkills = [...new Set([...(role===CSV_ROLE?task.requiredCapabilities.map(skill):[]), role])].sort();
    const rows = (await client.query(`
      SELECT a.document,
             COALESCE(load.active, 0)::int AS active,
             COALESCE(load.executing, 0)::int AS executing,
             COALESCE(history.passed, 0)::int AS passed,
             COALESCE(history.failed, 0)::int AS failed,
             p.polled_at, EXISTS(SELECT 1 FROM collaboration_claims c WHERE c.task_id=$2 AND c.agent_id=a.id
               AND c.scope<>$1 AND c.document->>'status' IN ('ACTIVE','COMPLETED')) AS assigned_elsewhere,
             (SELECT count(*)::int FROM experiment_csv_attempts t JOIN collaboration_claims c ON c.id=t.claim_id
              WHERE t.task_id=$2 AND t.step=$1 AND c.agent_id=a.id AND t.failure_code IS NOT NULL) AS prior_attempt_failures
      FROM collaboration_agents a
      LEFT JOIN (
        SELECT c.agent_id, count(*) AS active,
          count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM collaboration_handoffs h WHERE h.claim_id=c.id AND h.document->>'status'='SUBMITTED')) AS executing
        FROM collaboration_claims c WHERE c.document->>'status'='ACTIVE' GROUP BY c.agent_id
      ) load ON load.agent_id=a.id
      LEFT JOIN (
        SELECT agent_id, count(*) FILTER (WHERE outcome='PASS') AS passed,
          count(*) FILTER (WHERE outcome='FAIL') AS failed
        FROM experiment_reputation_events WHERE role=$1 GROUP BY agent_id
      ) history ON history.agent_id=a.id
      LEFT JOIN experiment_worker_presence p ON p.agent_id=a.id
      ORDER BY a.id`, [role,taskId])).rows;
    const candidates = rows.map(row => {
      const agent = CollaborationAgentSchema.parse(row.document);
      const lastSeenAt=workers ? row.polled_at?.toISOString()??null : agent.lastSeenAt;
      const availableFor = lastSeenAt === null ? Infinity : Date.parse(evaluatedAt) - Date.parse(lastSeenAt);
      const missingSkills = requiredSkills.filter(value => !agent.capabilities.map(skill).includes(value));
      const reasons = [];
      if (agent.agentId === actorId) reasons.push('TASK_CREATOR');
      if (missingSkills.length) reasons.push('MISSING_SKILLS');
      if (availableFor < 0 || availableFor > HEARTBEAT_MAX_AGE_MS) reasons.push('UNAVAILABLE');
      const capacity=workers?1:ACTIVE_CLAIM_LIMIT;
      const active=workers?row.executing:row.active;
      if (active >= capacity) reasons.push('AT_CAPACITY');
      if(workers&&!workers.includes(agent.agentId))reasons.push('WORKER_NOT_ENABLED');
      if(workers&&row.assigned_elsewhere)reasons.push('ALREADY_ASSIGNED');
      const reputation = calculateReputation(row.passed, row.failed);
      const availability = Math.max(0, 1 - active / capacity);
      const verifiedSummary: AgentVerifiedSummary | undefined = verified[agent.agentId];
      const verifiedPass = verifiedSummary?.pass ?? 0;
      const verifiedFail = verifiedSummary?.fail ?? 0;
      const verifiedReputation = calculateReputation(verifiedPass, verifiedFail);
      const tieBreaker = createHash('sha256').update(`${taskId}:${agent.agentId}`).digest('hex');
      const scores = {
        runtime: 0.8 * reputation + 0.2 * availability,
        verified: 0.8 * verifiedReputation + 0.2 * availability,
        capability: availability,
        random: randomFraction(tieBreaker),
      };
      const score = strategy === 'D_VERIFIED_REPUTATION' ? scores.verified
        : strategy === 'B_CAPABILITY' ? scores.capability
        : strategy === 'A_RANDOM' ? scores.random : scores.runtime;
      const evidence = strategy === 'D_VERIFIED_REPUTATION'
        ? {
          source: 'VERIFIED_ATTESTATION',
          verifiedPass, verifiedFail, sampleSize: verifiedPass + verifiedFail,
          attestationIds: verifiedSummary?.attestationIds ?? [],
          verificationLevels: verifiedSummary?.verificationLevels ?? [],
          coldStart: (verifiedPass + verifiedFail) === 0,
        }
        : {
          source: row.passed + row.failed > 0 ? 'RUNTIME_HISTORICAL_EVENTS' : 'NONE',
          verifiedPass, verifiedFail, sampleSize: verifiedPass + verifiedFail,
          attestationIds: verifiedSummary?.attestationIds ?? [],
          verificationLevels: verifiedSummary?.verificationLevels ?? [],
          coldStart: (row.passed + row.failed) === 0,
        };
      return {
        agentId: agent.agentId, name: agent.name, skills: agent.capabilities, missingSkills,
        lastSeenAt, active, capacity, priorAttemptFailures:Number(row.prior_attempt_failures),
        passed: row.passed, failed: row.failed, sampleSize: row.passed + row.failed, reputation, availability,
        verifiedReputation, scores, evidence,
        score: reasons.length ? null : score, reasons, tieBreaker,
      };
    }).sort((left, right) => Number(left.score===null)-Number(right.score===null) ||
      (workers?left.priorAttemptFailures-right.priorAttemptFailures:0) ||
      (right.score ?? -1) - (left.score ?? -1) || left.tieBreaker.localeCompare(right.tieBreaker));
    const selectedAgentId=candidates.find(candidate=>candidate.score!==null)?.agentId??null;
    const selected=candidates.find(candidate=>candidate.agentId===selectedAgentId);
    const policyVersion=policyVersionOf(strategy, Boolean(workers));
    const selectionReason=selected
      ?`按 ${strategy} 选择 ${selected.name}；可验证样本 ${selected.evidence.sampleSize}；运行期样本 ${selected.sampleSize}；score=${selected.score}；同分按稳定哈希`
      :'所有候选均被资格规则排除，等待符合条件的 Agent';
    const shadowDecision=shadow&&options.trustEnvironment?.enabled?(()=>{
      const ranked=[...candidates].filter(candidate=>candidate.score!==null).sort((left,right)=>
        (workers?left.priorAttemptFailures-right.priorAttemptFailures:0) ||
        (right.scores.verified-left.scores.verified) || left.tieBreaker.localeCompare(right.tieBreaker));
      return {
        strategy:'D_VERIFIED_REPUTATION' as const,
        policyVersion:VERIFIED_MATCHING_POLICY,
        selectedAgentId:ranked[0]?.agentId??null,
        candidates:ranked.map(candidate=>({agentId:candidate.agentId,score:candidate.scores.verified,evidence:candidate.evidence})),
      };
    })():null;
    const decision = { id: randomUUID(), taskId, taskVersion: task.version, actorId, evaluatedAt, role, requiredSkills,
      policyVersion, strategy, selectionReason, selectedAgentId,candidates, shadow:shadowDecision };
    if(saveEmpty||selectedAgentId) await client.query('INSERT INTO experiment_matching_decisions(id,task_id,actor_id,document) VALUES($1,$2,$3,$4)',[decision.id,taskId,actorId,decision]);
    return decision;
}
