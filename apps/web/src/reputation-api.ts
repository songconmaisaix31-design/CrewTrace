import { z } from 'zod';
import { endpoint, request } from './api';
import { collaboration } from './collaboration-api';

export const VerifiedRecordSchema = z.object({
  attestationId: z.string(), taskId: z.string(), agentId: z.string(), role: z.string(),
  outcome: z.enum(['PASS', 'FAIL']), issuedAt: z.string(), expiresAt: z.string().nullable(),
  status: z.enum(['TRUSTED', 'BUSINESS_FAILURE', 'REVOKED', 'EXPIRED', 'TAMPERED', 'INSUFFICIENT_EVIDENCE', 'POLICY_REJECTED', 'UNKNOWN']),
  evidenceLevel: z.string(), reasons: z.array(z.string()), digest: z.string(),
});
export const AgentReputationResponseSchema = z.object({
  agentId: z.string(), role: z.string().nullable(), roles: z.array(z.string()),
  verified: z.object({
    source: z.literal('VERIFIED_ATTESTATION'), trustEnabled: z.boolean(),
    issuer: z.object({
      issuerId: z.string(), keyId: z.string(), address: z.string().nullable(),
      environment: z.string(), deployment: z.string(),
    }).nullable(),
    policyDigest: z.string().nullable(),
    sampleSize: z.number(), pass: z.number(), fail: z.number(), coldStart: z.boolean(),
    attestationIds: z.array(z.string()), verificationLevels: z.array(z.string()),
    records: z.array(VerifiedRecordSchema),
  }),
  runtimeHistorical: z.object({
    source: z.literal('RUNTIME_HISTORICAL_EVENTS'),
    pass: z.number(), fail: z.number(), sampleSize: z.number(), note: z.string(),
  }),
  chain: z.object({ status: z.string(), note: z.string() }),
});
export const AttestationDetailSchema = z.object({
  summary: z.object({
    attestationId: z.string(), claimId: z.string(), taskId: z.string(), agentId: z.string(), role: z.string(),
    outcome: z.enum(['PASS', 'FAIL']), issuerId: z.string(), keyId: z.string(),
    environment: z.string(), deployment: z.string(), ruleId: z.string(), ruleVersion: z.string(),
    issuedAt: z.string(), expiresAt: z.string().nullable(), digest: z.string(),
    status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']),
    revokedAt: z.string().nullable(), revokeReason: z.string().nullable(),
  }),
  verification: z.object({ status: z.string(), evidenceLevel: z.string(), reasons: z.array(z.string()) }),
  authorized: z.boolean(),
  attestation: z.record(z.string(), z.unknown()).nullable(),
});

export type AgentReputationResponse = z.infer<typeof AgentReputationResponseSchema>;

export function agentReputationPath(agentId: string, role: string | null) {
  return `/agents/${encodeURIComponent(agentId)}/reputation${role ? `?role=${encodeURIComponent(role)}` : ''}`;
}

export function loadAgentReputation(agentId: string, role: string | null, signal?: AbortSignal) {
  return collaboration(agentReputationPath(agentId, role), AgentReputationResponseSchema, { signal });
}

export function loadAttestation(attestationId: string, credential: string | undefined, signal?: AbortSignal) {
  return collaboration(`/attestations/${encodeURIComponent(attestationId)}`, AttestationDetailSchema, { credential, signal });
}

// 导出走浏览器下载，Authorization 与页面保持一致，不把凭证写进网址。
export async function downloadAttestation(attestationId: string, credential: string) {
  const response = await request(endpoint(`/api/collaboration/attestations/${encodeURIComponent(attestationId)}/export`), {
    headers: { Authorization: `Bearer ${credential}` },
  });
  const body = await response.text();
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${attestationId}.ct-attestation.json`;
  link.click();
  URL.revokeObjectURL(url);
}
