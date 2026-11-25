import { z } from 'zod';
import type { Application } from '../application.js';
import { admin, type Principal } from '../auth.js';
import { AppError } from '../errors.js';
import type { FulfillmentAttestation } from '../../../../packages/attestation/src/index.ts';
import { processAttestationJobs, resetFailedAttestationJobs } from './attestation-issuer.js';
import { loadVerifiedReputation } from './verified-reputation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AttestationIdSchema = z.string().regex(UUID, '凭证标识必须为 UUID');
export const RevokeAttestationSchema = z.strictObject({ reasonCode: z.string().min(1).max(64) });
export const ProcessAttestationJobsSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).default(10),
  reset: z.boolean().default(false),
});

interface AttestationRecord {
  attestation_id: string;
  claim_id: string;
  task_id: string;
  agent_id: string;
  role: string;
  issuer_id: string;
  key_id: string;
  environment: string;
  deployment: string;
  rule_id: string;
  rule_version: string;
  outcome: 'PASS' | 'FAIL';
  digest: string;
  document: FulfillmentAttestation;
  issued_at: Date;
  revoked_at: Date | null;
  reason_code: string | null;
}

async function findAttestation(app: Application, attestationId: string): Promise<AttestationRecord> {
  const row = (await app.db.pool.query(`
    SELECT a.attestation_id, a.claim_id, a.task_id, a.agent_id, a.role, a.issuer_id, a.key_id, a.environment,
           a.deployment, a.rule_id, a.rule_version, a.outcome, a.digest, a.document, a.issued_at,
           r.revoked_at, r.reason_code
    FROM experiment_attestations a
    LEFT JOIN experiment_attestation_revocations r ON r.attestation_id=a.attestation_id
    WHERE a.attestation_id=$1`, [attestationId])).rows[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '未找到履约凭证');
  return row as AttestationRecord;
}

async function isAuthorized(app: Application, principal: Principal, record: AttestationRecord): Promise<boolean> {
  if (principal.kind === 'admin') return true;
  if (principal.kind !== 'collaborator' && principal.kind !== 'node') return false;
  if (principal.agentId === record.agent_id) return true;
  const task = (await app.db.pool.query('SELECT document FROM collaboration_tasks WHERE id=$1', [record.task_id])).rows[0];
  return task?.document?.creator === principal.agentId;
}

function summaryOf(record: AttestationRecord, now: Date) {
  const revoked = record.revoked_at !== null;
  const expired = !revoked && record.document.expiresAt !== null && Date.parse(record.document.expiresAt) <= now.getTime();
  return {
    attestationId: record.attestation_id, claimId: record.claim_id, taskId: record.task_id,
    agentId: record.agent_id, role: record.role, outcome: record.outcome,
    issuerId: record.issuer_id, keyId: record.key_id, environment: record.environment, deployment: record.deployment,
    ruleId: record.rule_id, ruleVersion: record.rule_version,
    issuedAt: record.document.issuedAt, expiresAt: record.document.expiresAt, digest: record.digest,
    status: revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE',
    revokedAt: record.revoked_at?.toISOString() ?? null, revokeReason: record.reason_code ?? null,
  };
}

async function verificationOf(app: Application, record: AttestationRecord) {
  if (!app.trustEnvironment.enabled) return { status: 'UNKNOWN', evidenceLevel: 'UNVERIFIED', reasons: ['TRUST_DISABLED'] as string[] };
  const reputation = await loadVerifiedReputation(app.db.pool, app.trustEnvironment, { agentId: record.agent_id, role: record.role });
  const match = reputation.verifications.find(item => item.attestationId === record.attestation_id);
  return match ? { status: match.status, evidenceLevel: match.evidenceLevel, reasons: match.reasons } : { status: 'UNKNOWN', evidenceLevel: 'UNVERIFIED', reasons: ['NOT_EVALUATED'] };
}

export async function getAttestation(app: Application, principal: Principal, rawId: string) {
  const attestationId = AttestationIdSchema.parse(rawId);
  const record = await findAttestation(app, attestationId);
  const authorized = await isAuthorized(app, principal, record);
  const summary = summaryOf(record, new Date());
  const verification = await verificationOf(app, record);
  return { summary, verification, authorized, attestation: authorized ? record.document : null };
}

export async function exportAttestation(app: Application, principal: Principal, rawId: string) {
  const attestationId = AttestationIdSchema.parse(rawId);
  const record = await findAttestation(app, attestationId);
  if (!await isAuthorized(app, principal, record)) throw new AppError(403, 'UNAUTHORIZED', '需要主体 Agent、任务创建者或管理凭证才能导出');
  return { filename: `${attestationId}.ct-attestation.json`, document: record.document, summary: summaryOf(record, new Date()) };
}

export async function listAgentAttestations(app: Application, agentId: string, role: string | null) {
  const rows = (await app.db.pool.query(`
    SELECT a.attestation_id, a.claim_id, a.task_id, a.agent_id, a.role, a.issuer_id, a.key_id, a.environment,
           a.deployment, a.rule_id, a.rule_version, a.outcome, a.digest, a.document, a.issued_at,
           r.revoked_at, r.reason_code
    FROM experiment_attestations a
    LEFT JOIN experiment_attestation_revocations r ON r.attestation_id=a.attestation_id
    WHERE a.agent_id=$1 AND ($2::text IS NULL OR a.role=$2)
    ORDER BY a.issued_at DESC, a.attestation_id`, [agentId, role])).rows as AttestationRecord[];
  const now = new Date();
  return { agentId, role, attestations: rows.map(row => summaryOf(row, now)) };
}

export async function revokeAttestation(app: Application, principal: Principal, rawId: string, input: unknown) {
  admin(principal);
  const attestationId = AttestationIdSchema.parse(rawId);
  const { reasonCode } = RevokeAttestationSchema.parse(input);
  await findAttestation(app, attestationId);
  const row = (await app.db.pool.query(`
    INSERT INTO experiment_attestation_revocations(attestation_id,reason_code) VALUES($1,$2)
    ON CONFLICT (attestation_id) DO UPDATE SET reason_code=EXCLUDED.reason_code, revoked_at=now()
    RETURNING revoked_at`, [attestationId, reasonCode])).rows[0];
  return { attestationId, reasonCode, revokedAt: (row.revoked_at as Date).toISOString() };
}

export async function processAttestationJobQueue(app: Application, principal: Principal, input: unknown) {
  admin(principal);
  const request = ProcessAttestationJobsSchema.parse(input ?? {});
  const reset = request.reset ? await resetFailedAttestationJobs(app) : 0;
  const result = await processAttestationJobs(app, request.limit);
  return { reset, ...result };
}
