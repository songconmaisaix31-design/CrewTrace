import { createHash, randomUUID } from 'node:crypto';
import { CollaborationAgentSchema } from '../../../packages/contracts/src/index.ts';
import { CSV_ROLE } from '../../../workers/src/csv-delivery.ts';
import { Collaboration } from './collaboration.js';
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
    const evaluatedAt = new Date().toISOString();
    const role = CSV_ROLE;
    const requiredSkills = [...new Set([...task.requiredCapabilities.map(skill), role])].sort();
    const rows = (await client.query(`
      SELECT a.document,
             COALESCE(load.active, 0)::int AS active,
             COALESCE(history.passed, 0)::int AS passed,
             COALESCE(history.failed, 0)::int AS failed
      FROM collaboration_agents a
      LEFT JOIN (
        SELECT agent_id, count(*) AS active FROM collaboration_claims
        WHERE document->>'status'='ACTIVE' GROUP BY agent_id
      ) load ON load.agent_id=a.id
      LEFT JOIN (
        SELECT agent_id, count(*) FILTER (WHERE outcome='PASS') AS passed,
          count(*) FILTER (WHERE outcome='FAIL') AS failed
        FROM experiment_reputation_events WHERE role=$1 GROUP BY agent_id
      ) history ON history.agent_id=a.id
      ORDER BY a.id`, [role])).rows;
    const candidates = rows.map(row => {
      const agent = CollaborationAgentSchema.parse(row.document);
      const availableFor = agent.lastSeenAt === null ? Infinity : Date.parse(evaluatedAt) - Date.parse(agent.lastSeenAt);
      const missingSkills = requiredSkills.filter(value => !agent.capabilities.map(skill).includes(value));
      const reasons = [];
      if (agent.agentId === actorId) reasons.push('TASK_CREATOR');
      if (missingSkills.length) reasons.push('MISSING_SKILLS');
      if (availableFor < 0 || availableFor > HEARTBEAT_MAX_AGE_MS) reasons.push('UNAVAILABLE');
      if (row.active >= ACTIVE_CLAIM_LIMIT) reasons.push('AT_CAPACITY');
      const reputation = calculateReputation(row.passed, row.failed);
      const availability = Math.max(0, 1 - row.active / ACTIVE_CLAIM_LIMIT);
      return {
        agentId: agent.agentId, name: agent.name, skills: agent.capabilities, missingSkills,
        lastSeenAt: agent.lastSeenAt, active: row.active, capacity: ACTIVE_CLAIM_LIMIT,
        passed: row.passed, failed: row.failed, sampleSize: row.passed + row.failed, reputation, availability,
        score: reasons.length ? null : 0.8 * reputation + 0.2 * availability, reasons,
        tieBreaker: createHash('sha256').update(`${taskId}:${agent.agentId}`).digest('hex'),
      };
    }).sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.tieBreaker.localeCompare(right.tieBreaker));
    const decision = { id: randomUUID(), taskId, taskVersion: task.version, actorId, evaluatedAt, role, requiredSkills, policyVersion: MATCHING_POLICY, candidates };
    await client.query('INSERT INTO experiment_matching_decisions(id,task_id,actor_id,document) VALUES($1,$2,$3,$4)',[decision.id,taskId,actorId,decision]);
    return decision;
  });
}
