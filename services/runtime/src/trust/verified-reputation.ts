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
  outcome: 'PASS' | 'FAIL';
  issued_at: Date;
  document: FulfillmentAttestation;
  input_csv: string | null;
  delivery_content: string | null;
  revoked_at: Date | null;
  reason_code: string | null;
}

function evidenceQuery(agentId: string | null, role: string | null): { text: string; values: unknown[] } {
  return {
    text: `SELECT a.attestation_id, a.task_id, a.agent_id, a.role, a.outcome, a.issued_at, a.document,
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

// 只读取展示所需字段；结构损坏的凭证交由 SDK 判定并在记录层标记，不阻断整个查询。
function displayableDocument(value: unknown): FulfillmentAttestation | null {
  if (!value || typeof value !== 'object') return null;
  const document = value as Partial<FulfillmentAttestation>;
  if (typeof document.issuedAt !== 'string') return null;
  if (!document.integrity || typeof document.integrity.digest !== 'string') return null;
  if (!document.reputation || (document.reputation.outcome !== 'PASS' && document.reputation.outcome !== 'FAIL')) return null;
  return document as FulfillmentAttestation;
}

function statusOf(report: VerificationReport | null, decision: AdmissionDecision | null, revoked: boolean, expiresAt: string | null, now: Date): VerificationStatus {
  if (revoked || report?.revocation === 'REVOKED') return 'REVOKED';
  if (decision?.admitted) return 'TRUSTED';
  if (!report) return 'UNKNOWN';
  if (report.keyStatus === 'EXPIRED' || (expiresAt !== null && Date.parse(expiresAt) <= now.getTime())) return 'EXPIRED';
  if (report.schema === 'INVALID' || report.signature !== 'VALID' || report.issuer !== 'KNOWN') return 'TAMPERED';
  if (report.input === 'NOT_PROVIDED' || report.quality === 'NOT_ASSERTED' || report.fulfillment === 'NOT_ASSERTED') return 'INSUFFICIENT_EVIDENCE';
  if (report.quality === 'RECALCULATED_FAIL' || report.fulfillment === 'RECALCULATED_FAIL') return 'BUSINESS_FAILURE';
  const policyReasons = ['OUTCOME_', 'QUALITY_', 'FULFILLMENT_', 'RULE_VERSION', 'ISSUER_', 'ALLOWLIST_', 'BINDING_', 'REVOCATION_', 'KEY_', 'EXPECTED_'];
  if (report.reasons.some(reason => policyReasons.some(prefix => reason.startsWith(prefix)))) return 'POLICY_REJECTED';
  return 'UNKNOWN';
}

export async function loadVerifiedReputation(client: Pick<PoolClient, 'query'>, env: TrustEnvironment, options: { agentId?: string | null; role?: string | null; now?: Date } = {}): Promise<VerifiedReputation> {
  const empty: VerifiedReputation = {
    source: 'VERIFIED_ATTESTATION', trustEnabled: env.enabled,
    issuer: env.enabled ? { issuerId: env.issuerId, keyId: env.keyId, address: env.address, environment: env.environment, deployment: env.deployment } : null,
    policyDigest: null, verifications: [], byAgent: {},
  };
  if (!env.enabled) return empty;
  const query = evidenceQuery(options.agentId ?? null, options.role ?? null);
  const rows = (await client.query(query.text, query.values)).rows as EvidenceRow[];
  if (rows.length === 0) return empty;
  const now = options.now ?? new Date();
  const revocations = attestationRevocations(rows.filter(row => row.revoked_at !== null).map(row => ({
    attestationId: row.attestation_id, revokedAt: row.revoked_at as Date, reasonCode: row.reason_code ?? 'REVOKED',
  })), now);
  // 显式时钟同时约束策略新鲜度与实际核验时间，测试无需等待真实时间流逝。
  const policy = loadTrustPolicy({
    ...attestationTrustPolicy(env, revocations, now),
    freshness: { maxAllowlistAgeSeconds: 86_400, maxRevocationAgeSeconds: 3_600, now: now.toISOString() },
  });
  const evaluation = await verifyAndAggregateReputation({
    policy,
    candidates: rows.map(row => ({ attestation: row.document, inputContent: row.input_csv, deliveryContent: row.delivery_content })),
    now,
  });
  const decisions = new Map(evaluation.decisions.map(decision => [`${decision.attestationId}`, decision]));
  const documents = rows.map(row => displayableDocument(row.document));
  const verifications = rows.map((row, index) => {
    const decision = decisions.get(row.attestation_id) ?? null;
    const report = evaluation.evaluations[index]?.report ?? null;
    const document = documents[index];
    return {
      attestationId: row.attestation_id,
      taskId: row.task_id,
      agentId: row.agent_id,
      role: row.role,
      outcome: document?.reputation.outcome ?? row.outcome,
      issuedAt: document?.issuedAt ?? row.issued_at.toISOString(),
      expiresAt: document?.expiresAt ?? null,
      // 结构损坏的凭证只标记自身，不参与聚合，也不能让整个查询失败。
      status: document ? statusOf(report, decision, row.revoked_at !== null, document.expiresAt, now) : 'TAMPERED',
      evidenceLevel: document ? decision?.evidenceLevel ?? 'UNVERIFIED' : 'UNVERIFIED',
      reasons: document ? report?.reasons ?? [] : ['SCHEMA_INVALID'],
      digest: document?.integrity.digest ?? '',
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
