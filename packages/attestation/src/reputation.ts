import type { Hex } from 'viem';
import { attestationDigest } from './canonical.js';
import { lookupVerification, type SealedVerification } from './verified-registry.js';
import type { FulfillmentAttestation } from './schema.js';
import type { VerificationReport } from './verify.js';

export type EvidenceLevel =
  | 'UNVERIFIED' | 'SIGNATURE_ONLY' | 'CONTENT_RECALCULATED'
  | 'FULFILLMENT_RECALCULATED' | 'CHAIN_CONFIRMED';

// 对外公开的验证等级与内部证据等级一致，避免出现第二套含义。
export type VerificationLevel = EvidenceLevel;

export interface VerifiedAttestation {
  attestation: FulfillmentAttestation;
  report: VerificationReport | null;
}

export interface ReputationAdmissionPolicy {
  acceptedOutcomes: Array<'VERIFIED' | 'VERIFIED_OFFLINE'>;
  allowOffline: boolean;
  minOfflineEvidence: EvidenceLevel;
  requireQuality: boolean;
  requireFulfillment: boolean;
  requireFreshRevocationList: boolean;
  requireFreshAllowlist: boolean;
}

export const DEFAULT_REPUTATION_POLICY: ReputationAdmissionPolicy = {
  acceptedOutcomes: ['VERIFIED'],
  allowOffline: false,
  minOfflineEvidence: 'FULFILLMENT_RECALCULATED',
  requireQuality: true,
  requireFulfillment: true,
  requireFreshRevocationList: true,
  requireFreshAllowlist: false,
};

const EVIDENCE_ORDER: EvidenceLevel[] = [
  'UNVERIFIED', 'SIGNATURE_ONLY', 'CONTENT_RECALCULATED', 'FULFILLMENT_RECALCULATED', 'CHAIN_CONFIRMED',
];

export function evidenceLevelOf(report: VerificationReport): EvidenceLevel {
  if (report.signature !== 'VALID' || report.issuer !== 'KNOWN' || report.keyStatus !== 'ACTIVE') return 'UNVERIFIED';
  if (report.chainCommitment === 'PRESENT_MATCH' && report.fulfillment === 'RECALCULATED_PASS') return 'CHAIN_CONFIRMED';
  if (report.fulfillment === 'RECALCULATED_PASS') return 'FULFILLMENT_RECALCULATED';
  if (report.quality === 'RECALCULATED_PASS') return 'CONTENT_RECALCULATED';
  return 'SIGNATURE_ONLY';
}

// 主体身份命名空间与取值共同构成主体键，避免不同外部平台复用的 Agent ID 被合并。
export function reputationSubjectKey(attestation: FulfillmentAttestation): string {
  const { namespace, value } = attestation.subject.identity;
  return `${namespace}:${value.toLowerCase()}`;
}

// 事件身份同时受签发来源与主体身份命名空间约束。
export function reputationEventKey(attestation: FulfillmentAttestation): string {
  return `${attestation.issuer.issuerId}|${reputationSubjectKey(attestation)}|${attestation.reputation.eventId}`;
}

export interface ReputationBucket {
  issuerId: string;
  subjectNamespace: string;
  subjectValue: string;
  agentId: string;
  role: string;
  serviceId: string;
  serviceVersion: number;
  environment: string;
  deployment: string;
  ruleVersion: string;
  pass: number;
  fail: number;
  sampleSize: number;
  qualityVerified: number;
  fulfillmentVerified: number;
  chainVerified: number;
  attestationIds: string[];
}

export interface AdmissionDecision {
  attestationId: string;
  eventKey: string;
  admitted: boolean;
  reasons: string[];
  evidenceLevel: EvidenceLevel;
  outcome: VerificationReport['outcome'] | null;
  authenticity: 'VERIFIED' | 'UNVERIFIED';
  quality: VerificationReport['quality'];
  fulfillment: VerificationReport['fulfillment'];
  chainCommitment: VerificationReport['chainCommitment'];
  reportDigest: Hex | null;
  attestationDigest: Hex | null;
  verificationPolicyDigest: Hex | null;
}

export interface AggregationResult {
  buckets: ReputationBucket[];
  ignored: Array<{ attestationId: string; reason: string }>;
  decisions: AdmissionDecision[];
}

type ResolvedReport =
  | { report: VerificationReport; sealed: SealedVerification }
  | { untrustedReason: string };

function resolveReport(entry: VerifiedAttestation): ResolvedReport {
  const { attestation, report } = entry;
  if (!report) return { untrustedReason: 'NOT_VERIFIED' };
  const sealed = lookupVerification(report);
  if (!sealed) return { untrustedReason: 'UNTRUSTED_REPORT' };
  if (sealed.attestationId !== null && sealed.attestationId !== attestation.attestationId) {
    return { untrustedReason: 'REPORT_ATTESTATION_MISMATCH' };
  }
  let digest: Hex;
  try {
    digest = attestationDigest(attestation as unknown as Record<string, unknown>);
  } catch {
    return { untrustedReason: 'REPORT_ATTESTATION_MISMATCH' };
  }
  if (!sealed.attestationDigest || sealed.attestationDigest.toLowerCase() !== digest.toLowerCase()) {
    return { untrustedReason: 'REPORT_ATTESTATION_MISMATCH' };
  }
  return { report: sealed.reportSnapshot, sealed };
}

function admissionReasons(
  attestation: FulfillmentAttestation,
  report: VerificationReport,
  policy: ReputationAdmissionPolicy,
): string[] {
  const reasons: string[] = [];
  if (report.schema !== 'VALID' || report.signature !== 'VALID') reasons.push('AUTHENTICITY_FAILED');
  if (report.outcome === 'REJECTED') reasons.push('OUTCOME_REJECTED');
  else if (report.outcome === 'INDETERMINATE') reasons.push('OUTCOME_INDETERMINATE');
  else if (!policy.acceptedOutcomes.includes(report.outcome)) reasons.push('OUTCOME_NOT_ACCEPTED');
  if (report.issuer !== 'KNOWN') reasons.push('ISSUER_NOT_KNOWN');
  if (report.keyStatus !== 'ACTIVE') reasons.push('KEY_NOT_ACTIVE');
  if (report.revocation !== 'CLEAR') reasons.push('REVOCATION_NOT_CLEAR');
  if (policy.requireFreshRevocationList && report.revocationFreshness !== 'FRESH') {
    reasons.push('REVOCATION_FRESHNESS_UNVERIFIED');
  }
  if (policy.requireFreshAllowlist && report.allowlist !== 'FRESH') reasons.push('ALLOWLIST_FRESHNESS_UNVERIFIED');
  if (policy.requireQuality && report.quality !== 'RECALCULATED_PASS') reasons.push('QUALITY_NOT_RECALCULATED');
  if (policy.requireFulfillment && report.fulfillment !== 'RECALCULATED_PASS') reasons.push('FULFILLMENT_NOT_RECALCULATED');
  if (report.outcome === 'VERIFIED_OFFLINE') {
    if (!policy.allowOffline) reasons.push('OFFLINE_NOT_ALLOWED');
    const actualLevel = evidenceLevelOf(report);
    if (EVIDENCE_ORDER.indexOf(actualLevel) < EVIDENCE_ORDER.indexOf(policy.minOfflineEvidence)) {
      reasons.push('OFFLINE_EVIDENCE_INSUFFICIENT');
    }
  }
  if (attestation.review.decision !== 'ACCEPTED') reasons.push('REVIEW_NOT_ACCEPTED');
  if (attestation.validation.result === 'UNRESOLVED') reasons.push('VALIDATION_UNRESOLVED');
  return [...new Set(reasons)];
}

function eventFingerprint(attestation: FulfillmentAttestation): string {
  return [
    attestation.validation.result,
    attestation.review.decision,
    attestation.reputation.outcome,
    attestation.input.contentHash,
    attestation.delivery.contentHash,
  ].join('|');
}

export function aggregateReputation(
  inputs: VerifiedAttestation[],
  options: {
    policy?: Partial<ReputationAdmissionPolicy>;
    revokedIds?: Set<string>;
    revokedEventKeys?: Set<string>;
    consumedEventKeys?: Set<string>;
    expectedVerificationPolicyDigest?: Hex;
  } = {},
): AggregationResult {
  const policy: ReputationAdmissionPolicy = { ...DEFAULT_REPUTATION_POLICY, ...options.policy };
  const ordered = [...inputs].sort((a, b) => a.attestation.attestationId.localeCompare(b.attestation.attestationId));
  const consumed = new Set(options.consumedEventKeys ?? []);
  const buckets = new Map<string, ReputationBucket>();
  const ignored: AggregationResult['ignored'] = [];
  const decisions: AdmissionDecision[] = [];
  const admitted: Array<{
    attestation: FulfillmentAttestation;
    report: VerificationReport;
    decision: AdmissionDecision;
    eventKey: string;
    fingerprint: string;
  }> = [];

  // 第一阶段只做信任准入：报告必须来自 verifyAttestation 的密封登记，且与当前凭证摘要一致。
  for (const entry of ordered) {
    const { attestation } = entry;
    const eventKey = reputationEventKey(attestation);
    const decision: AdmissionDecision = {
      attestationId: attestation.attestationId,
      eventKey,
      admitted: false,
      reasons: [],
      evidenceLevel: 'UNVERIFIED',
      outcome: null,
      authenticity: 'UNVERIFIED',
      quality: 'NOT_ASSERTED',
      fulfillment: 'NOT_ASSERTED',
      chainCommitment: 'NOT_BOUND',
      reportDigest: null,
      attestationDigest: null,
      verificationPolicyDigest: null,
    };
    decisions.push(decision);
    const reject = (reason: string) => {
      decision.reasons.push(reason);
      ignored.push({ attestationId: attestation.attestationId, reason });
    };

    const resolved = resolveReport(entry);
    if ('untrustedReason' in resolved) {
      reject(resolved.untrustedReason);
      continue;
    }
    const { report, sealed } = resolved;
    decision.evidenceLevel = evidenceLevelOf(report);
    decision.outcome = report.outcome;
    decision.authenticity = report.signature === 'VALID' && report.issuer === 'KNOWN' ? 'VERIFIED' : 'UNVERIFIED';
    decision.quality = report.quality;
    decision.fulfillment = report.fulfillment;
    decision.chainCommitment = report.chainCommitment;
    decision.reportDigest = sealed.reportDigest;
    decision.attestationDigest = sealed.attestationDigest;
    decision.verificationPolicyDigest = sealed.verificationPolicyDigest;

    if (options.expectedVerificationPolicyDigest
      && sealed.verificationPolicyDigest !== options.expectedVerificationPolicyDigest) {
      reject('VERIFICATION_POLICY_MISMATCH');
      continue;
    }
    if (options.revokedIds?.has(attestation.attestationId)) { reject('REVOKED_ATTESTATION'); continue; }
    if (options.revokedEventKeys?.has(eventKey)) { reject('REVOKED_EVENT'); continue; }
    const reasons = admissionReasons(attestation, report, policy);
    if (reasons.length) {
      for (const reason of reasons) decision.reasons.push(reason);
      ignored.push({ attestationId: attestation.attestationId, reason: reasons[0] });
      continue;
    }
    decision.admitted = true;
    admitted.push({ attestation, report, decision, eventKey, fingerprint: eventFingerprint(attestation) });
  }

  // 第二阶段只在已经准入的凭证之间判断冲突，无效凭证不会影响合法凭证。
  const eventFingerprints = new Map<string, Set<string>>();
  const attestationDigests = new Map<string, Set<string>>();
  for (const item of admitted) {
    const set = eventFingerprints.get(item.eventKey) ?? new Set<string>();
    set.add(item.fingerprint);
    eventFingerprints.set(item.eventKey, set);
    const digests = attestationDigests.get(item.attestation.attestationId) ?? new Set<string>();
    digests.add(item.attestation.integrity.digest);
    attestationDigests.set(item.attestation.attestationId, digests);
  }
  const conflictedEvents = new Set([...eventFingerprints].filter(([, set]) => set.size > 1).map(([key]) => key));
  const conflictedAttestations = new Set(
    [...attestationDigests].filter(([, set]) => set.size > 1).map(([key]) => key),
  );

  // 第三阶段做重复与事件消费去重，最后写入 Bucket。
  const seenAttestations = new Set<string>();
  for (const item of admitted) {
    const { attestation, decision, eventKey } = item;
    const reject = (reason: string) => {
      decision.admitted = false;
      decision.reasons.push(reason);
      ignored.push({ attestationId: attestation.attestationId, reason });
    };
    if (conflictedEvents.has(eventKey)) { reject('CONFLICTING_EVENT'); continue; }
    if (conflictedAttestations.has(attestation.attestationId)) { reject('CONFLICTING_ATTESTATION'); continue; }
    if (seenAttestations.has(attestation.attestationId)) { reject('DUPLICATE_ATTESTATION'); continue; }
    seenAttestations.add(attestation.attestationId);
    if (consumed.has(eventKey)) { reject('CONSUMED_REPUTATION_EVENT'); continue; }
    consumed.add(eventKey);

    const key = [
      attestation.issuer.issuerId, reputationSubjectKey(attestation), attestation.subject.agentId,
      attestation.subject.role, attestation.subject.serviceId, String(attestation.subject.serviceVersion),
      attestation.binding.environment, attestation.binding.deployment, attestation.validation.ruleVersion,
    ].join('|');
    const bucket = buckets.get(key) ?? {
      issuerId: attestation.issuer.issuerId,
      subjectNamespace: attestation.subject.identity.namespace,
      subjectValue: attestation.subject.identity.value,
      agentId: attestation.subject.agentId,
      role: attestation.subject.role,
      serviceId: attestation.subject.serviceId,
      serviceVersion: attestation.subject.serviceVersion,
      environment: attestation.binding.environment,
      deployment: attestation.binding.deployment,
      ruleVersion: attestation.validation.ruleVersion,
      pass: 0, fail: 0, sampleSize: 0,
      qualityVerified: 0, fulfillmentVerified: 0, chainVerified: 0,
      attestationIds: [],
    };
    if (attestation.validation.result === 'PASS') bucket.pass += 1;
    else bucket.fail += 1;
    bucket.sampleSize += 1;
    if (decision.quality === 'RECALCULATED_PASS') bucket.qualityVerified += 1;
    if (decision.fulfillment === 'RECALCULATED_PASS') bucket.fulfillmentVerified += 1;
    if (decision.evidenceLevel === 'CHAIN_CONFIRMED') bucket.chainVerified += 1;
    bucket.attestationIds.push(attestation.attestationId);
    buckets.set(key, bucket);
  }
  return { buckets: [...buckets.values()], ignored, decisions };
}
