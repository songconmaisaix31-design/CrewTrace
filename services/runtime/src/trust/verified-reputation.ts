import type { PoolClient } from 'pg';
import {
  loadTrustPolicy, verifyAndAggregateReputation,
  type AdmissionDecision, type FulfillmentAttestation, type VerificationReport,
} from '../../../../packages/attestation/src/index.ts';
import type { Application } from '../application.js';
import { attestationRevocations, attestationTrustPolicy, type TrustEnvironment } from './trust-environment.js';

export type VerificationStatus =
  | 'TRUSTED' | 'BUSINESS_FAILURE' | 'REVOKED' | 'EXPIRED'
  | 'TAMPERED' | 'INSUFFICIENT_EVIDENCE' | 'POLICY_REJECTED' | 'UNKNOWN';

export interface AttestationEvidence {
  attestationId: string;
  taskId: string;
  agentId: string;
  role: string;
  outcome: 'PASS' | 'FAIL';
  issuedAt: string;
  expiresAt: string | null;
  status: VerificationStatus;
  evidenceLevel: string;
  reasons: string[];
  digest: string;
}

export interface AgentVerifiedSummary {
  pass: number;
  fail: number;
  sampleSize: number;
  attestationIds: string[];
  verificationLevels: string[];
  coldStart: boolean;
}

export interface VerifiedReputation {
  source: 'VERIFIED_ATTESTATION';
  trustEnabled: boolean;
  issuer: { issuerId: string; keyId: string; address: string | null; environment: string; deployment: string } | null;
  policyDigest: string | null;
  verifications: AttestationEvidence[];
  byAgent: Record<string, AgentVerifiedSummary>;
}

interface EvidenceRow {
  attestation_id: string;
  task_id: string;
  agent_id: string;
  role: string;
  issued_at: Date;
  document: FulfillmentAttestation;
  input_csv: string | null;
  delivery_content: string | null;
  revoked_at: Date | null;
  reason_code: string | null;
}

function evidenceQuery(agentId: string | null, role: string | null): { text: string; values: unknown[] } {
  return {
    text: `SELECT a.attestation_id, a.task_id, a.agent_id, a.role, a.issued_at, a.document,
      w.input_csv, h.delivery_content, r.revoked_at, r.reason_code
      FROM experiment_attestations a
      JOIN experiment_csv_workflows w ON w.task_id=a.task_id
      LEFT JOIN LATERAL (
        SELECT ch.document->>'content' AS delivery_content
        FROM collaboration_handoffs ch
        WHERE ch.claim_id=a.claim_id AND ch.document->>'status'='ACCEPTED'
        LIMIT 1
      ) h ON true
      LEFT JOIN experiment_attestation_revocations r ON r.attestation_id=a.attestation_id
      WHERE ($1::text IS NULL OR a.agent_id=$1) AND ($2::text IS NULL OR a.role=$2)
      ORDER BY a.issued_at, a.attestation_id`,
    values: [agentId, role],
  };
}

function statusOf(report: VerificationReport | null, decision: AdmissionDecision | null, revoked: boolean, expiresAt: string | null, now: Date): VerificationStatus {
  if (revoked || report?.revocation === 'REVOKED') return 'REVOKED';
  if (decision?.admitted) return 'TRUSTED';
  if (!report) return 'UNKNOWN';
  if (report.keyStatus === 'EXPIRED' || (expiresAt !== null && Date.parse(expiresAt) <= now.getTime())) return 'EXPIRED';
  if (report.schema === 'INVALID' || report.signature !== 'VALID' || report.issuer !== 'KNOWN') return 'TAMPERED';
  if (report.input === 'NOT_PROVIDED' || report.quality === 'NOT_ASSERTED' || report.fulfillment === 'NOT_ASSERTED') return 'INSUFFICIENT_EVIDENCE';
  if (report.quality === 'RECALCULATED_FAIL' || report.fulfillment === 'RECALCULATED_FAIL' || report.outcome === 'REJECTED') return 'BUSINESS_FAILURE';
  if (report.reasons.some(reason => reason.startsWith('OUTCOME_') || reason.startsWith('QUALITY_') || reason.startsWith('FULFILLMENT_') || reason.startsWith('RULE_VERSION'))) return 'POLICY_REJECTED';
  return 'UNKNOWN';
}

export async function loadVerifiedReputation(client: Pick<PoolClient, 'query'>, env: TrustEnvironment, options: { agentId?: string | null; role?: string | null } = {}): Promise<VerifiedReputation> {
  const empty: VerifiedReputation = {
    source: 'VERIFIED_ATTESTATION', trustEnabled: env.enabled,
    issuer: env.enabled ? { issuerId: env.issuerId, keyId: env.keyId, address: env.address, environment: env.environment, deployment: env.deployment } : null,
    policyDigest: null, verifications: [], byAgent: {},
  };
  if (!env.enabled) return empty;
  const query = evidenceQuery(options.agentId ?? null, options.role ?? null);
  const rows = (await client.query(query.text, query.values)).rows as EvidenceRow[];
  if (rows.length === 0) return empty;
  const now = new Date();
  const revocations = attestationRevocations(rows.filter(row => row.revoked_at !== null).map(row => ({
    attestationId: row.attestation_id, revokedAt: row.revoked_at as Date, reasonCode: row.reason_code ?? 'REVOKED',
  })), now);
  const policy = loadTrustPolicy(attestationTrustPolicy(env, revocations, now));
  const evaluation = await verifyAndAggregateReputation({
    policy,
    candidates: rows.map(row => ({ attestation: row.document, inputContent: row.input_csv, deliveryContent: row.delivery_content })),
    now,
  });
  const decisions = new Map(evaluation.decisions.map(decision => [`${decision.attestationId}`, decision]));
  const verifications = rows.map((row, index) => {
    const decision = decisions.get(row.attestation_id) ?? null;
    const report = evaluation.evaluations[index]?.report ?? null;
    return {
      attestationId: row.attestation_id,
      taskId: row.task_id,
      agentId: row.agent_id,
      role: row.role,
      outcome: row.document.reputation.outcome,
      issuedAt: row.document.issuedAt,
      expiresAt: row.document.expiresAt,
      status: statusOf(report, decision, row.revoked_at !== null, row.document.expiresAt, now),
      evidenceLevel: decision?.evidenceLevel ?? 'UNVERIFIED',
      reasons: report?.reasons ?? [],
      digest: row.document.integrity.digest,
    } satisfies AttestationEvidence;
  });
  const byAgent: Record<string, AgentVerifiedSummary> = {};
  for (const bucket of evaluation.buckets) {
    const current = byAgent[bucket.agentId] ?? { pass: 0, fail: 0, sampleSize: 0, attestationIds: [], verificationLevels: [], coldStart: false };
    current.pass += bucket.pass;
    current.fail += bucket.fail;
    current.sampleSize += bucket.sampleSize;
    current.attestationIds.push(...bucket.attestationIds);
    byAgent[bucket.agentId] = current;
  }
  for (const verification of verifications) {
    if (verification.status !== 'TRUSTED') continue;
    const current = byAgent[verification.agentId];
    if (current) current.verificationLevels.push(verification.evidenceLevel);
  }
  for (const [agentId, summary] of Object.entries(byAgent)) {
    summary.coldStart = summary.sampleSize === 0;
    summary.attestationIds = [...new Set(summary.attestationIds)];
    summary.verificationLevels = [...new Set(summary.verificationLevels)];
    byAgent[agentId] = summary;
  }
  return { ...empty, policyDigest: evaluation.verificationPolicyDigest, verifications, byAgent };
}

export async function legacyReputation(client: Pick<PoolClient, 'query'>, agentId: string, role: string | null) {
  const row = (await client.query(`
    SELECT count(*) FILTER (WHERE outcome='PASS')::int AS pass,
           count(*) FILTER (WHERE outcome='FAIL')::int AS fail
    FROM experiment_reputation_events
    WHERE agent_id=$1 AND ($2::text IS NULL OR role=$2)`, [agentId, role])).rows[0];
  return {
    source: 'RUNTIME_HISTORICAL_EVENTS' as const,
    pass: Number(row?.pass ?? 0), fail: Number(row?.fail ?? 0),
    sampleSize: Number(row?.pass ?? 0) + Number(row?.fail ?? 0),
    note: '历史信誉事件未经凭证核验，不参与可验证信誉聚合。',
  };
}

export async function agentReputationPassport(app: Application, agentId: string, role: string | null) {
  const verified = await loadVerifiedReputation(app.db.pool, app.trustEnvironment, { agentId, role });
  const historical = await legacyReputation(app.db.pool, agentId, role);
  const roles = (await app.db.pool.query(`
    SELECT role FROM experiment_reputation_events WHERE agent_id=$1
    UNION SELECT role FROM experiment_attestations WHERE agent_id=$1
    ORDER BY role`, [agentId])).rows.map(row => row.role as string);
  return {
    agentId, role,
    roles,
    verified: {
      source: verified.source,
      trustEnabled: verified.trustEnabled,
      issuer: verified.issuer,
      policyDigest: verified.policyDigest,
      sampleSize: verified.byAgent[agentId]?.sampleSize ?? 0,
      pass: verified.byAgent[agentId]?.pass ?? 0,
      fail: verified.byAgent[agentId]?.fail ?? 0,
      coldStart: verified.byAgent[agentId]?.coldStart ?? true,
      attestationIds: verified.byAgent[agentId]?.attestationIds ?? [],
      verificationLevels: verified.byAgent[agentId]?.verificationLevels ?? [],
      records: verified.verifications,
    },
    runtimeHistorical: historical,
    chain: { status: 'NOT_BOUND' as const, note: '本轮不写入公共链，凭证为本地签名与本地复算核验。' },
  };
}
