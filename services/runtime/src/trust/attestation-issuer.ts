import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  issueAttestation, reputationEventKey, type FulfillmentAttestation,
} from '../../../../packages/attestation/src/index.ts';
import { CSV_ROLE } from '../../../../workers/src/csv-delivery.ts';
import type { Application } from '../application.js';
import { acceptedStep, CSV_WORKFLOW_VERSION } from '../csv-workflow.js';
import type { TrustEnvironment } from './trust-environment.js';

export const ATTESTATION_SERVICE_ID = 'csv-clean-verify-free';
export const ATTESTATION_SERVICE_VERSION = 1;
export const ATTESTATION_RULE_ID = 'csv-ledger';
export const ATTESTATION_RULE_VERSION = 'csv-ledger-v1';

export function deterministicAttestationId(claimId: string): string {
  const bytes = createHash('sha256').update(`ct-runtime-attestation:${claimId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function enqueueCsvAttestation(client: Pick<PoolClient, 'query'>, env: TrustEnvironment, taskId: string, claimId: string): Promise<string | null> {
  if (!env.enabled) return null;
  const claim = (await client.query(`
    SELECT c.scope, r.outcome
    FROM collaboration_claims c
    LEFT JOIN experiment_reputation_events r ON r.claim_id=c.id
    WHERE c.id=$1 AND c.task_id=$2`, [claimId, taskId])).rows[0];
  if (!claim || claim.scope !== CSV_ROLE || claim.outcome !== 'PASS') return null;
  const evidence = await client.query(`
    SELECT 1 FROM experiment_csv_evidence e
    JOIN collaboration_handoffs h ON h.id=e.handoff_id
    WHERE e.claim_id=$1 AND h.document->>'status'='ACCEPTED'`, [claimId]);
  if (!evidence.rowCount) return null;
  if (await acceptedStep(client, taskId, 'csv-evidence-report') === undefined) return null;
  const attestationId = deterministicAttestationId(claimId);
  const inserted = await client.query(`
    INSERT INTO experiment_attestation_jobs(claim_id,task_id,attestation_id)
    VALUES($1,$2,$3) ON CONFLICT (claim_id) DO NOTHING RETURNING claim_id`, [claimId, taskId, attestationId]);
  return inserted.rowCount ? attestationId : null;
}

interface AttestationFactsRow {
  task_id: string;
  agent_id: string;
  attempt: number;
  input_csv: string;
  handoff: { content: string; updatedAt: string };
  task: { creator: string };
}

export async function readAttestationFacts(client: Pick<PoolClient, 'query'>, claimId: string): Promise<AttestationFactsRow> {
  const row = (await client.query(`
    SELECT c.task_id, c.agent_id, a.attempt, w.input_csv,
           h.document AS handoff, t.document AS task
    FROM collaboration_claims c
    JOIN experiment_csv_attempts a ON a.claim_id=c.id
    JOIN experiment_csv_workflows w ON w.task_id=c.task_id
    JOIN collaboration_handoffs h ON h.claim_id=c.id AND h.document->>'status'='ACCEPTED'
    JOIN collaboration_tasks t ON t.id=c.task_id
    WHERE c.id=$1 AND c.scope=$2`, [claimId, CSV_ROLE])).rows[0];
  if (!row) throw new Error(`签发任务缺少已验收的交付事实: ${claimId}`);
  return row as AttestationFactsRow;
}

function attestationFacts(row: AttestationFactsRow, claimId: string) {
  return {
    source: {
      kind: 'crewtrace-collaboration-task' as const,
      orderId: null,
      buyerAgentId: row.task.creator,
      taskId: row.task_id,
      attempt: row.attempt,
      workflowVersion: CSV_WORKFLOW_VERSION,
    },
    service: { serviceId: ATTESTATION_SERVICE_ID, serviceVersion: ATTESTATION_SERVICE_VERSION },
    subject: {
      agentId: row.agent_id,
      identity: { namespace: 'ct-local' as const, value: row.agent_id },
      signingAddress: null,
      role: CSV_ROLE,
    },
    input: { path: `task://${row.task_id}/input.csv`, schemaVersion: ATTESTATION_RULE_VERSION },
    delivery: { path: `task://${row.task_id}/delivery.csv`, deliveryVersion: row.attempt },
    // 步骤审核记录来自交付交接的验收，买方验收由三步全部接受这一条件表达。
    review: { decision: 'ACCEPTED' as const, reviewerId: row.task.creator, reviewerAddress: null, reviewedAt: row.handoff.updatedAt },
    reputation: { eventId: claimId, outcome: 'PASS' as const, source: 'DETERMINISTIC_REVIEW' as const },
    payment: { status: 'NOT_REQUIRED' as const },
    rules: { ruleId: ATTESTATION_RULE_ID, ruleVersion: ATTESTATION_RULE_VERSION },
  };
}

export async function processAttestationJobs(app: Application, limit = 5): Promise<{ processed: number; issued: number; failed: number }> {
  const env = app.trustEnvironment;
  if (!env.enabled || !env.privateKey) return { processed: 0, issued: 0, failed: 0 };
  const candidates = (await app.db.pool.query(`
    SELECT claim_id FROM experiment_attestation_jobs
    WHERE (status IN ('PENDING','FAILED') OR (status='ISSUING' AND updated_at < now() - interval '60 seconds'))
      AND attempts < $1
    ORDER BY created_at, claim_id LIMIT $2`, [env.maxAttempts, limit])).rows;
  let issued = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimed = (await app.db.pool.query(`
      UPDATE experiment_attestation_jobs
      SET status='ISSUING', attempts=attempts+1, updated_at=now()
      WHERE claim_id=$1
        AND (status IN ('PENDING','FAILED') OR (status='ISSUING' AND updated_at < now() - interval '60 seconds'))
        AND attempts < $2
      RETURNING claim_id, attestation_id`, [candidate.claim_id, env.maxAttempts])).rows[0];
    if (!claimed) continue;
    try {
      const row = await readAttestationFacts(app.db.pool, claimed.claim_id);
      const attestation: FulfillmentAttestation = await issueAttestation({
        facts: attestationFacts(row, claimed.claim_id),
        inputContent: row.input_csv,
        deliveryContent: row.handoff.content,
        privateKey: env.privateKey,
        issuerId: env.issuerId,
        keyId: env.keyId,
        environment: env.environment,
        deployment: env.deployment,
        salts: { order: env.orderSalt, buyer: env.buyerSalt },
        attestationId: claimed.attestation_id,
        chain: undefined,
      });
      await app.db.transaction(async client => {
        await client.query(`
          INSERT INTO experiment_attestations(
            attestation_id,claim_id,task_id,agent_id,role,issuer_id,key_id,environment,deployment,
            rule_id,rule_version,event_key,outcome,digest,document,issued_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (claim_id) DO NOTHING`,
        [attestation.attestationId, claimed.claim_id, row.task_id, row.agent_id, attestation.subject.role,
          env.issuerId, env.keyId, env.environment, env.deployment,
          attestation.validation.ruleId, attestation.validation.ruleVersion, reputationEventKey(attestation),
          attestation.reputation.outcome, attestation.integrity.digest, attestation, attestation.issuedAt]);
        await client.query(`
          UPDATE experiment_attestation_jobs
          SET status='ISSUED', issued_at=now(), updated_at=now(), last_error=NULL
          WHERE claim_id=$1`, [claimed.claim_id]);
      });
      issued++;
    } catch (error) {
      failed++;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await app.db.pool.query(`
        UPDATE experiment_attestation_jobs SET status='FAILED', last_error=$2, updated_at=now() WHERE claim_id=$1`,
      [claimed.claim_id, message]);
    }
  }
  return { processed: candidates.length, issued, failed };
}

export async function resetFailedAttestationJobs(app: Application): Promise<number> {
  const rows = (await app.db.pool.query(`
    UPDATE experiment_attestation_jobs SET status='PENDING', attempts=0, last_error=NULL, updated_at=now()
    WHERE status='FAILED' RETURNING claim_id`)).rows;
  return rows.length;
}
