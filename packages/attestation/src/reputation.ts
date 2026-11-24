import type { FulfillmentAttestation } from './schema.js';
import type { VerificationReport } from './verify.js';

export type EvidenceLevel =
  | 'UNVERIFIED' | 'SIGNATURE_ONLY' | 'CONTENT_RECALCULATED'
  | 'FULFILLMENT_RECALCULATED' | 'CHAIN_CONFIRMED';

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

export function reputationEventKey(attestation: FulfillmentAttestation): string {
  return `${attestation.issuer.issuerId}|${attestation.reputation.eventId}`;
}

export interface ReputationBucket {
  agentId: string;
  role: string;
  serviceId: string;
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
}

export interface AggregationResult {
  buckets: ReputationBucket[];
  ignored: Array<{ attestationId: string; reason: string }>;
  decisions: AdmissionDecision[];
}

function admissionReasons(
  entry: VerifiedAttestation,
  policy: ReputationAdmissionPolicy,
): string[] {
  const { attestation, report } = entry;
  if (!report) return ['NOT_VERIFIED'];
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

export function aggregateReputation(
  inputs: VerifiedAttestation[],
  options: {
    policy?: Partial<ReputationAdmissionPolicy>;
    revokedIds?: Set<string>;
    revokedEventKeys?: Set<string>;
    consumedEventKeys?: Set<string>;
  } = {},
): AggregationResult {
  const policy: ReputationAdmissionPolicy = { ...DEFAULT_REPUTATION_POLICY, ...options.policy };
  const ordered = [...inputs].sort((a, b) => a.attestation.attestationId.localeCompare(b.attestation.attestationId));

  const eventFingerprints = new Map<string, Set<string>>();
  const attestationDigests = new Map<string, Set<string>>();
  for (const { attestation } of ordered) {
    const eventKey = reputationEventKey(attestation);
    const fingerprint = [
      attestation.validation.result, attestation.review.decision, attestation.reputation.outcome,
    ].join('|');
    const set = eventFingerprints.get(eventKey) ?? new Set<string>();
    set.add(fingerprint);
    eventFingerprints.set(eventKey, set);
    const digestSet = attestationDigests.get(attestation.attestationId) ?? new Set<string>();
    digestSet.add(attestation.integrity.digest);
    attestationDigests.set(attestation.attestationId, digestSet);
  }
  const conflictedEvents = new Set([...eventFingerprints].filter(([, set]) => set.size > 1).map(([key]) => key));
  const conflictedAttestations = new Set([...attestationDigests].filter(([, set]) => set.size > 1).map(([key]) => key));

  const consumed = new Set(options.consumedEventKeys ?? []);
  const seenAttestations = new Set<string>();
  const buckets = new Map<string, ReputationBucket>();
  const ignored: AggregationResult['ignored'] = [];
  const decisions: AdmissionDecision[] = [];

  for (const entry of ordered) {
    const { attestation, report } = entry;
    const eventKey = reputationEventKey(attestation);
    const decision: AdmissionDecision = {
      attestationId: attestation.attestationId,
      eventKey,
      admitted: false,
      reasons: [],
      evidenceLevel: report ? evidenceLevelOf(report) : 'UNVERIFIED',
      outcome: report?.outcome ?? null,
      authenticity: report?.signature === 'VALID' && report?.issuer === 'KNOWN' ? 'VERIFIED' : 'UNVERIFIED',
      quality: report?.quality ?? 'NOT_ASSERTED',
      fulfillment: report?.fulfillment ?? 'NOT_ASSERTED',
    };
    const reject = (reason: string) => {
      decision.reasons.push(reason);
      ignored.push({ attestationId: attestation.attestationId, reason });
      decisions.push(decision);
    };

    const conflicts: string[] = [];
    if (conflictedEvents.has(eventKey)) conflicts.push('CONFLICTING_EVENT');
    if (conflictedAttestations.has(attestation.attestationId)) conflicts.push('CONFLICTING_ATTESTATION');
    if (conflicts.length) {
      for (const reason of conflicts) {
        decision.reasons.push(reason);
        ignored.push({ attestationId: attestation.attestationId, reason });
      }
      decisions.push(decision);
      continue;
    }
    if (seenAttestations.has(attestation.attestationId)) { reject('DUPLICATE_ATTESTATION'); continue; }
    seenAttestations.add(attestation.attestationId);
    if (options.revokedIds?.has(attestation.attestationId)) { reject('REVOKED_ATTESTATION'); continue; }
    if (options.revokedEventKeys?.has(eventKey)) { reject('REVOKED_EVENT'); continue; }
    if (consumed.has(eventKey)) { reject('CONSUMED_REPUTATION_EVENT'); continue; }
    const reasons = admissionReasons(entry, policy);
    if (reasons.length) {
      for (const reason of reasons) decision.reasons.push(reason);
      ignored.push({ attestationId: attestation.attestationId, reason: reasons[0] });
      decisions.push(decision);
      continue;
    }

    consumed.add(eventKey);
    decision.admitted = true;
    const key = [
      attestation.subject.agentId, attestation.subject.role,
      attestation.subject.serviceId, attestation.validation.ruleVersion,
    ].join('|');
    const bucket = buckets.get(key) ?? {
      agentId: attestation.subject.agentId,
      role: attestation.subject.role,
      serviceId: attestation.subject.serviceId,
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
    decisions.push(decision);
  }
  return { buckets: [...buckets.values()], ignored, decisions };
}
