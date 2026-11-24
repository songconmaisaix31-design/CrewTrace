import type { FulfillmentAttestation } from './schema.js';

export interface ReputationBucket {
  agentId: string;
  role: string;
  serviceId: string;
  ruleVersion: string;
  pass: number;
  fail: number;
  sampleSize: number;
  attestationIds: string[];
}

export interface AggregationResult {
  buckets: ReputationBucket[];
  ignored: Array<{ attestationId: string; reason: string }>;
}

export function aggregateReputation(
  attestations: FulfillmentAttestation[],
  options: { revokedIds?: Set<string>; consumedEventIds?: Set<string> } = {},
): AggregationResult {
  const seenEvents = new Set(options.consumedEventIds ?? []);
  const seenAttestations = new Set<string>();
  const buckets = new Map<string, ReputationBucket>();
  const ignored: AggregationResult['ignored'] = [];

  for (const attestation of attestations) {
    if (seenAttestations.has(attestation.attestationId)) {
      ignored.push({ attestationId: attestation.attestationId, reason: 'DUPLICATE_ATTESTATION' });
      continue;
    }
    seenAttestations.add(attestation.attestationId);
    if (options.revokedIds?.has(attestation.attestationId)) {
      ignored.push({ attestationId: attestation.attestationId, reason: 'REVOKED' });
      continue;
    }
    if (attestation.review.decision !== 'ACCEPTED') {
      ignored.push({ attestationId: attestation.attestationId, reason: 'REVIEW_NOT_ACCEPTED' });
      continue;
    }
    if (attestation.validation.result === 'UNRESOLVED') {
      ignored.push({ attestationId: attestation.attestationId, reason: 'VALIDATION_UNRESOLVED' });
      continue;
    }
    if (seenEvents.has(attestation.reputation.eventId)) {
      ignored.push({ attestationId: attestation.attestationId, reason: 'DUPLICATE_REPUTATION_EVENT' });
      continue;
    }
    seenEvents.add(attestation.reputation.eventId);
    const key = [
      attestation.subject.agentId, attestation.subject.role,
      attestation.subject.serviceId, attestation.validation.ruleVersion,
    ].join('|');
    const bucket = buckets.get(key) ?? {
      agentId: attestation.subject.agentId,
      role: attestation.subject.role,
      serviceId: attestation.subject.serviceId,
      ruleVersion: attestation.validation.ruleVersion,
      pass: 0,
      fail: 0,
      sampleSize: 0,
      attestationIds: [],
    };
    if (attestation.validation.result === 'PASS') bucket.pass += 1;
    else bucket.fail += 1;
    bucket.sampleSize += 1;
    bucket.attestationIds.push(attestation.attestationId);
    buckets.set(key, bucket);
  }
  return { buckets: [...buckets.values()], ignored };
}
