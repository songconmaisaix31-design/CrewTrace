import type { Hex } from 'viem';
import { canonicalJson } from '../../chain/src/collaboration.js';
import { attestationDigest, contentDigest } from './canonical.js';
import { evaluateCsv } from './csv.js';
import { findIssuer } from './allowlist.js';
import { recoverDigestSigner } from './sign.js';
import {
  FulfillmentAttestationSchema,
  type FulfillmentAttestation,
  type IssuerAllowlist,
  type RevocationList,
} from './schema.js';

export interface ChainCommitmentRecord {
  contentHash: string;
  uri: string;
  recorder: string;
  recordedAt: bigint;
}

export interface ChainReader {
  chainId: number;
  contract: string;
  read(input: { chainId: number; contract: string; kind: number; recordId: string; version: number }): Promise<ChainCommitmentRecord | null>;
}

export interface VerifyInput {
  attestation: unknown;
  allowlist: IssuerAllowlist | null;
  revocations: RevocationList | null;
  deliveryContent?: string | null;
  chain?: ChainReader | null;
  now?: Date;
  recognizedRuleVersions?: string[];
  expectedBinding?: { environment: 'local' | 'staging' | 'production'; deployment: string };
}

export interface VerificationReport {
  schema: 'VALID' | 'INVALID';
  signature: 'VALID' | 'INVALID';
  digest: string | null;
  issuer: 'KNOWN' | 'UNKNOWN' | 'KEY_MISMATCH';
  keyStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'NOT_YET_VALID' | 'UNKNOWN';
  revocation: 'NOT_CHECKED' | 'CLEAR' | 'REVOKED';
  ruleVersion: 'RECOGNIZED' | 'UNKNOWN';
  chainCommitment: 'NOT_BOUND' | 'PRESENT_MATCH' | 'PRESENT_MISMATCH' | 'ABSENT' | 'UNAVAILABLE';
  content: 'NOT_PROVIDED' | 'MATCH' | 'MISMATCH';
  quality: 'NOT_ASSERTED' | 'RECALCULATED_PASS' | 'RECALCULATED_FAIL';
  outcome: 'VERIFIED' | 'VERIFIED_OFFLINE' | 'INDETERMINATE' | 'REJECTED';
  reasons: string[];
}

const DEFAULT_RULES = ['csv-ledger-v1'];

function baseReport(): VerificationReport {
  return {
    schema: 'INVALID', signature: 'INVALID', digest: null, issuer: 'UNKNOWN', keyStatus: 'UNKNOWN',
    revocation: 'NOT_CHECKED', ruleVersion: 'UNKNOWN', chainCommitment: 'NOT_BOUND',
    content: 'NOT_PROVIDED', quality: 'NOT_ASSERTED', outcome: 'REJECTED', reasons: [],
  };
}

export async function verifyAttestation(input: VerifyInput): Promise<VerificationReport> {
  const report = baseReport();
  const raw = input.attestation;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    report.reasons.push('SCHEMA_INVALID');
    return report;
  }
  const parsed = FulfillmentAttestationSchema.safeParse(raw);
  if (!parsed.success) {
    report.reasons.push('SCHEMA_INVALID');
    for (const issue of parsed.error.issues) report.reasons.push(`SCHEMA:${issue.path.join('.')}:${issue.code}`);
    return report;
  }
  const attestation: FulfillmentAttestation = parsed.data;
  report.schema = 'VALID';

  let computed: Hex;
  try {
    computed = attestationDigest(raw as Record<string, unknown>);
  } catch {
    report.reasons.push('CANONICALIZATION_FAILED');
    return report;
  }
  report.digest = computed;

  let recovered: string | null = null;
  try {
    recovered = await recoverDigestSigner(computed, attestation.integrity.signature as Hex);
  } catch {
    report.reasons.push('SIGNATURE_MALFORMED');
  }
  const digestMatches = attestation.integrity.digest === computed;
  const signerMatches = recovered === attestation.issuer.signerAddress;
  if (!digestMatches) report.reasons.push('DIGEST_MISMATCH');
  if (!signerMatches) report.reasons.push('SIGNER_MISMATCH');
  report.signature = digestMatches && signerMatches ? 'VALID' : 'INVALID';

  const entry = input.allowlist ? findIssuer(input.allowlist, attestation.issuer.issuerId, attestation.issuer.keyId) : null;
  if (!entry) {
    report.issuer = 'UNKNOWN';
    report.keyStatus = 'UNKNOWN';
    report.reasons.push('ISSUER_UNKNOWN');
  } else if (entry.address.toLowerCase() !== attestation.issuer.signerAddress
    || entry.address.toLowerCase() !== recovered) {
    report.issuer = 'KEY_MISMATCH';
    report.keyStatus = 'UNKNOWN';
    report.reasons.push('KEY_ID_ADDRESS_MISMATCH');
  } else {
    report.issuer = 'KNOWN';
    const issuedAt = new Date(attestation.issuedAt).getTime();
    const from = new Date(entry.validFrom).getTime();
    const to = entry.validTo ? new Date(entry.validTo).getTime() : Number.POSITIVE_INFINITY;
    if (entry.revokedAt) {
      report.keyStatus = 'REVOKED';
      report.reasons.push('KEY_REVOKED');
    } else if (issuedAt < from) {
      report.keyStatus = 'NOT_YET_VALID';
      report.reasons.push('KEY_NOT_YET_VALID');
    } else if (issuedAt > to) {
      report.keyStatus = 'EXPIRED';
      report.reasons.push('KEY_EXPIRED');
    } else {
      report.keyStatus = 'ACTIVE';
    }
  }

  if (attestation.expiresAt && (input.now ?? new Date()).getTime() > new Date(attestation.expiresAt).getTime()) {
    report.reasons.push('ATTESTATION_EXPIRED');
  }

  if (!input.revocations) {
    report.revocation = 'NOT_CHECKED';
  } else if (input.revocations.entries.some((item) => item.attestationId === attestation.attestationId)) {
    report.revocation = 'REVOKED';
    report.reasons.push('ATTESTATION_REVOKED');
  } else {
    report.revocation = 'CLEAR';
  }

  const recognized = input.recognizedRuleVersions ?? DEFAULT_RULES;
  report.ruleVersion = recognized.includes(attestation.validation.ruleVersion) ? 'RECOGNIZED' : 'UNKNOWN';
  if (report.ruleVersion === 'UNKNOWN') report.reasons.push('RULE_VERSION_UNKNOWN');

  if (input.deliveryContent != null) {
    const contentHash = contentDigest(input.deliveryContent);
    if (contentHash !== attestation.delivery.contentHash) {
      report.content = 'MISMATCH';
      report.reasons.push('DELIVERY_HASH_MISMATCH');
    } else {
      report.content = 'MATCH';
      if (attestation.validation.ruleId === 'csv-ledger') {
        const evaluated = evaluateCsv(input.deliveryContent);
        const same = evaluated.ruleVersion === attestation.validation.ruleVersion
          && evaluated.result === attestation.validation.result
          && evaluated.checksDigest === attestation.validation.checksDigest
          && canonicalJson(evaluated.checkCodes) === canonicalJson(attestation.validation.checkCodes)
          && evaluated.rowCount === attestation.delivery.rowCount;
        report.quality = same
          ? (evaluated.result === 'PASS' ? 'RECALCULATED_PASS' : 'RECALCULATED_FAIL')
          : 'RECALCULATED_FAIL';
        if (!same) report.reasons.push('QUALITY_MISMATCH');
      } else {
        report.reasons.push('RULE_NOT_IMPLEMENTED');
      }
    }
  }

  if (attestation.review.reviewerId === attestation.subject.agentId) {
    report.reasons.push('SELF_REVIEW');
  }
  if (input.expectedBinding && (input.expectedBinding.environment !== attestation.binding.environment
    || input.expectedBinding.deployment !== attestation.binding.deployment)) {
    report.reasons.push('DEPLOYMENT_MISMATCH');
  }
  if (attestation.review.reviewerAddress && attestation.subject.signingAddress
    && attestation.review.reviewerAddress === attestation.subject.signingAddress) {
    report.reasons.push('REVIEWER_IS_SUBJECT');
  }
  if (attestation.subject.identity.namespace === 'eip155' && attestation.subject.signingAddress
    && attestation.subject.identity.value.toLowerCase() !== attestation.subject.signingAddress) {
    report.reasons.push('IDENTITY_SIGNER_MISMATCH');
  }

  if (!attestation.chain) {
    report.chainCommitment = 'NOT_BOUND';
  } else if (!attestation.chain.receipt) {
    report.chainCommitment = 'ABSENT';
    report.reasons.push('CHAIN_RECEIPT_MISSING');
  } else if (!input.chain) {
    report.chainCommitment = 'UNAVAILABLE';
  } else if (input.chain.chainId !== attestation.chain.chainId || input.chain.contract !== attestation.chain.contract) {
    report.chainCommitment = 'PRESENT_MISMATCH';
    report.reasons.push('CHAIN_NETWORK_MISMATCH');
  } else {
    let record: ChainCommitmentRecord | null = null;
    try {
      record = await input.chain.read({
        chainId: attestation.chain.chainId, contract: attestation.chain.contract,
        kind: attestation.chain.mappingKind, recordId: attestation.chain.recordId,
        version: attestation.chain.version,
      });
    } catch {
      report.chainCommitment = 'UNAVAILABLE';
      report.reasons.push('CHAIN_READ_FAILED');
    }
    if (record) {
      const matches = record.contentHash.toLowerCase() === computed
        && record.uri === `urn:ct:attestation:${attestation.attestationId}`;
      report.chainCommitment = matches ? 'PRESENT_MATCH' : 'PRESENT_MISMATCH';
      if (!matches) report.reasons.push('CHAIN_COMMITMENT_MISMATCH');
    } else if (report.chainCommitment === 'NOT_BOUND') {
      report.chainCommitment = 'ABSENT';
      report.reasons.push('CHAIN_RECORD_NOT_FOUND');
    }
  }

  const fatal = new Set([
    'DIGEST_MISMATCH', 'SIGNER_MISMATCH', 'SIGNATURE_MALFORMED', 'CANONICALIZATION_FAILED',
    'ISSUER_UNKNOWN', 'KEY_ID_ADDRESS_MISMATCH', 'KEY_REVOKED', 'KEY_EXPIRED', 'KEY_NOT_YET_VALID',
    'ATTESTATION_REVOKED', 'ATTESTATION_EXPIRED', 'DELIVERY_HASH_MISMATCH', 'QUALITY_MISMATCH',
    'SELF_REVIEW', 'REVIEWER_IS_SUBJECT', 'IDENTITY_SIGNER_MISMATCH', 'DEPLOYMENT_MISMATCH',
    'CHAIN_NETWORK_MISMATCH', 'CHAIN_COMMITMENT_MISMATCH', 'CHAIN_RECORD_NOT_FOUND',
  ]);
  const hasFatal = report.reasons.some((reason) => fatal.has(reason));

  if (hasFatal) {
    report.outcome = 'REJECTED';
  } else if (report.revocation === 'NOT_CHECKED') {
    report.outcome = 'INDETERMINATE';
    report.reasons.push('REVOCATION_STATUS_UNKNOWN');
  } else if (report.ruleVersion === 'UNKNOWN') {
    report.outcome = 'INDETERMINATE';
  } else if (attestation.chain && !attestation.chain.receipt) {
    report.outcome = 'INDETERMINATE';
  } else if (attestation.chain && report.chainCommitment === 'UNAVAILABLE') {
    report.outcome = 'VERIFIED_OFFLINE';
    report.reasons.push('CHAIN_NOT_VERIFIED');
  } else if (attestation.chain && report.chainCommitment === 'PRESENT_MATCH') {
    report.outcome = 'VERIFIED';
  } else {
    report.outcome = 'VERIFIED_OFFLINE';
  }
  return report;
}
