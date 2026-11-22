import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { CollaborationAgentSchema, type CollaborationTask } from '../../../packages/contracts/src/index.ts';
import { CSV_ROLE } from '../../../workers/src/csv-delivery.ts';
import type { Collaboration } from './collaboration.js';
import { sameCollaborator } from './collaboration-store.js';
import { calculateReputation, HEARTBEAT_MAX_AGE_MS } from './domain/policy.js';
import type { Principal } from './auth.js';

export const MATCHING_POLICY = 'csv-role-reputation-v1';
const ACTIVE_CLAIM_LIMIT = 2;
const skill = (value: string) => value.trim().toLowerCase();

export async function snapshotMatching(service: Collaboration, actor: Principal, taskId: string) {
  return service.store.write(actor, async (client, actorId) => {
    const task = await service.task(taskId, client);
    sameCollaborator(actorId, task.creator);
    return rankAndSave(client, task, CSV_ROLE);
  });
}

export async function rankAndSave(client:PoolClient,task:CollaborationTask,role:string,workers?:string[],saveEmpty=true) {
    const {taskId,creator:actorId}=task;
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
      return {
        agentId: agent.agentId, name: agent.name, skills: agent.capabilities, missingSkills,
        lastSeenAt, active, capacity, priorAttemptFailures:Number(row.prior_attempt_failures),
        passed: row.passed, failed: row.failed, sampleSize: row.passed + row.failed, reputation, availability,
        score: reasons.length ? null : 0.8 * reputation + 0.2 * availability, reasons,
        tieBreaker: createHash('sha256').update(`${taskId}:${agent.agentId}`).digest('hex'),
      };
    }).sort((left, right) => Number(left.score===null)-Number(right.score===null) ||
      (workers?left.priorAttemptFailures-right.priorAttemptFailures:0) ||
      (right.score ?? -1) - (left.score ?? -1) || left.tieBreaker.localeCompare(right.tieBreaker));
    const selectedAgentId=candidates.find(candidate=>candidate.score!==null)?.agentId??null;
    const decision = { id: randomUUID(), taskId, taskVersion: task.version, actorId, evaluatedAt, role, requiredSkills,
      policyVersion:workers?'csv-worker-reputation-v2':MATCHING_POLICY, selectedAgentId,candidates };
    if(saveEmpty||selectedAgentId) await client.query('INSERT INTO experiment_matching_decisions(id,task_id,actor_id,document) VALUES($1,$2,$3,$4)',[decision.id,taskId,actorId,decision]);
    return decision;
}
