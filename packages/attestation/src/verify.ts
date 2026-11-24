import type { Hex } from 'viem';
import { canonicalJson } from './canonical-json.js';
import { attestationDigest, contentDigest } from './canonical.js';
import { evaluateCsv } from './csv.js';
import { findIssuer } from './allowlist.js';
import { recoverDigestSigner } from './sign.js';
import { compareCsvTransformation } from './transform.js';
import { verifyChainEvidence, type ChainReader, type ChainVerificationPolicy } from './chain-verify.js';
import { registerVerification } from './verified-registry.js';
import {
  FulfillmentAttestationSchema,
  type FulfillmentAttestation,
  type IssuerAllowlist,
  type RevocationList,
} from './schema.js';

export type { ChainReader };

export interface VerifyInput {
  attestation: unknown;
  allowlist: IssuerAllowlist | null;
  revocations: RevocationList | null;
  inputContent?: string | null;
  deliveryContent?: string | null;
  chain?: ChainReader | null;
  chainPolicy?: ChainVerificationPolicy;
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
  allowlist: 'FRESH' | 'STALE' | 'UNVERIFIED' | 'NOT_PROVIDED';
  revocation: 'NOT_CHECKED' | 'CLEAR' | 'REVOKED' | 'STALE';
  revocationFreshness: 'FRESH' | 'STALE' | 'UNVERIFIED' | 'NOT_PROVIDED';
  ruleVersion: 'RECOGNIZED' | 'UNKNOWN';
  chainCommitment: 'NOT_BOUND' | 'PRESENT_MATCH' | 'PRESENT_MISMATCH' | 'ABSENT' | 'UNAVAILABLE';
  input: 'NOT_PROVIDED' | 'MATCH' | 'MISMATCH';
  content: 'NOT_PROVIDED' | 'MATCH' | 'MISMATCH';
  transformation: 'NOT_ASSERTED' | 'MATCH' | 'MISMATCH';
  quality: 'NOT_ASSERTED' | 'RECALCULATED_PASS' | 'RECALCULATED_FAIL';
  fulfillment: 'NOT_ASSERTED' | 'RECALCULATED_PASS' | 'RECALCULATED_FAIL';
  outcome: 'VERIFIED' | 'VERIFIED_OFFLINE' | 'INDETERMINATE' | 'REJECTED';
  reasons: string[];
}

const DEFAULT_RULES = ['csv-ledger-v1'];
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function baseReport(): VerificationReport {
  return {
    schema: 'INVALID', signature: 'INVALID', digest: null, issuer: 'UNKNOWN', keyStatus: 'UNKNOWN',
    allowlist: 'NOT_PROVIDED', revocation: 'NOT_CHECKED', revocationFreshness: 'NOT_PROVIDED',
    ruleVersion: 'UNKNOWN', chainCommitment: 'NOT_BOUND',
    input: 'NOT_PROVIDED', content: 'NOT_PROVIDED', transformation: 'NOT_ASSERTED',
    quality: 'NOT_ASSERTED', fulfillment: 'NOT_ASSERTED', outcome: 'REJECTED', reasons: [],
  };
}

function freshness(expiresAt: string | null | undefined, now: Date): 'FRESH' | 'STALE' | 'UNVERIFIED' {
  if (!expiresAt) return 'UNVERIFIED';
  return now.getTime() > new Date(expiresAt).getTime() ? 'STALE' : 'FRESH';
}

async function runVerification(input: VerifyInput): Promise<VerificationReport> {
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
  const now = input.now ?? new Date();

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

  if (input.allowlist) {
    report.allowlist = freshness(input.allowlist.expiresAt, now);
    if (report.allowlist === 'STALE') report.reasons.push('ALLOWLIST_STALE');
  }
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

  const issuedAtMs = new Date(attestation.issuedAt).getTime();
  const reviewedAtMs = new Date(attestation.review.reviewedAt).getTime();
  if (issuedAtMs > now.getTime() + CLOCK_SKEW_MS) report.reasons.push('ISSUED_IN_FUTURE');
  if (reviewedAtMs > issuedAtMs) report.reasons.push('REVIEW_AFTER_ISSUE');
  if (attestation.expiresAt && new Date(attestation.expiresAt).getTime() <= issuedAtMs) {
    report.reasons.push('EXPIRY_BEFORE_ISSUE');
  }
  if (attestation.expiresAt && now.getTime() > new Date(attestation.expiresAt).getTime()) {
    report.reasons.push('ATTESTATION_EXPIRED');
  }

  if (!input.revocations) {
    report.revocation = 'NOT_CHECKED';
    report.revocationFreshness = 'NOT_PROVIDED';
  } else {
    report.revocationFreshness = freshness(input.revocations.expiresAt, now);
    if (report.revocationFreshness === 'STALE') {
      report.revocation = 'STALE';
      report.reasons.push('REVOCATION_LIST_STALE');
    } else if (input.revocations.entries.some((item) => item.attestationId === attestation.attestationId)) {
      report.revocation = 'REVOKED';
      report.reasons.push('ATTESTATION_REVOKED');
    } else {
      report.revocation = 'CLEAR';
    }
  }

  const recognized = input.recognizedRuleVersions ?? DEFAULT_RULES;
  report.ruleVersion = recognized.includes(attestation.validation.ruleVersion) ? 'RECOGNIZED' : 'UNKNOWN';
  if (report.ruleVersion === 'UNKNOWN') report.reasons.push('RULE_VERSION_UNKNOWN');

  if (input.inputContent != null) {
    const inputHash = contentDigest(input.inputContent);
    if (inputHash !== attestation.input.contentHash) {
      report.input = 'MISMATCH';
      report.reasons.push('INPUT_HASH_MISMATCH');
    } else {
      report.input = 'MATCH';
      const evaluatedInput = evaluateCsv(input.inputContent);
      if (evaluatedInput.rowCount !== attestation.input.rowCount) {
        report.reasons.push('INPUT_ROW_COUNT_MISMATCH');
      }
    }
  }

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

  if (input.inputContent != null && input.deliveryContent != null && report.input === 'MATCH' && report.content === 'MATCH') {
    if (attestation.validation.ruleVersion === 'csv-ledger-v1') {
      const comparison = compareCsvTransformation(input.inputContent, input.deliveryContent);
      report.transformation = comparison.status;
      if (comparison.status === 'MISMATCH') report.reasons.push('TRANSFORM_MISMATCH', ...comparison.reasons);
      if (comparison.status === 'NOT_ASSERTED') report.reasons.push(...comparison.reasons);
      if (comparison.status === 'MATCH' && report.quality === 'RECALCULATED_PASS'
        && attestation.validation.result === 'PASS') {
        report.fulfillment = 'RECALCULATED_PASS';
      } else {
        report.fulfillment = 'RECALCULATED_FAIL';
      }
    } else {
      report.reasons.push('TRANSFORM_RULE_NOT_IMPLEMENTED');
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
  } else if (input.chain.chainId !== attestation.chain.chainId
    || input.chain.contract.toLowerCase() !== attestation.chain.contract.toLowerCase()) {
    report.chainCommitment = 'PRESENT_MISMATCH';
    report.reasons.push('CHAIN_NETWORK_MISMATCH');
  } else if (!input.chainPolicy || input.chainPolicy.authorizedRecorders.length === 0) {
    report.chainCommitment = 'PRESENT_MISMATCH';
    report.reasons.push('CHAIN_RECORDER_POLICY_MISSING');
  } else {
    try {
      const evidence = await input.chain.inspect({
        attestationId: attestation.attestationId, version: attestation.chain.version,
      });
      const result = verifyChainEvidence({
        attestationId: attestation.attestationId,
        binding: attestation.chain,
        digest: computed,
        policy: {
          authorizedRecorders: input.chainPolicy.authorizedRecorders,
          minConfirmations: input.chainPolicy.minConfirmations,
        },
        evidence,
      });
      report.chainCommitment = result.status;
      report.reasons.push(...result.reasons);
    } catch {
      report.chainCommitment = 'UNAVAILABLE';
      report.reasons.push('CHAIN_READ_FAILED');
    }
  }

  const fatal = new Set([
    'DIGEST_MISMATCH', 'SIGNER_MISMATCH', 'SIGNATURE_MALFORMED', 'CANONICALIZATION_FAILED',
    'ISSUER_UNKNOWN', 'KEY_ID_ADDRESS_MISMATCH', 'KEY_REVOKED', 'KEY_EXPIRED', 'KEY_NOT_YET_VALID',
    'ATTESTATION_REVOKED', 'ATTESTATION_EXPIRED', 'EXPIRY_BEFORE_ISSUE', 'REVIEW_AFTER_ISSUE',
    'DELIVERY_HASH_MISMATCH', 'INPUT_HASH_MISMATCH', 'INPUT_ROW_COUNT_MISMATCH',
    'QUALITY_MISMATCH', 'TRANSFORM_MISMATCH',
    'OUTPUT_HEADER_MISMATCH', 'OUTPUT_PARSE_FAILED', 'OUTPUT_ROW_INVALID', 'OUTPUT_MISSING_RECORDS',
    'OUTPUT_EXTRA_RECORDS', 'OUTPUT_DUPLICATE_RECORDS', 'OUTPUT_VALUE_MISMATCH', 'OUTPUT_ORDER_MISMATCH',
    'INPUT_DUPLICATE_CONFLICT', 'INPUT_ROW_SHAPE_INVALID', 'INPUT_HEADER_MISMATCH', 'INPUT_NO_VALID_ROWS',
    'INPUT_PARSE_FAILED',
    'SELF_REVIEW', 'REVIEWER_IS_SUBJECT', 'IDENTITY_SIGNER_MISMATCH', 'DEPLOYMENT_MISMATCH',
    'CHAIN_NETWORK_MISMATCH', 'CHAIN_CONTRACT_MISMATCH', 'CHAIN_RECORD_ID_MISMATCH',
    'CHAIN_COMMITMENT_KEY_MISMATCH', 'CHAIN_KIND_MISMATCH', 'CHAIN_VERSION_MISMATCH',
    'CHAIN_COMMITMENT_MISMATCH', 'CHAIN_URI_MISMATCH', 'CHAIN_RECORDER_UNAUTHORIZED',
    'CHAIN_RECORDER_POLICY_MISSING', 'CHAIN_RECEIPT_MISSING', 'CHAIN_RECEIPT_MISMATCH',
    'CHAIN_RECEIPT_SIGNER_MISMATCH', 'CHAIN_TX_FAILED', 'CHAIN_BLOCK_MISMATCH',
    'CHAIN_NOT_FINAL', 'CHAIN_EVENT_MISSING', 'CHAIN_EVENT_MISMATCH', 'CHAIN_RECORD_NOT_FOUND',
  ]);
  const hasFatal = report.reasons.some((reason) => fatal.has(reason) || reason.startsWith('INPUT_PARSE_FAILED'));

  if (hasFatal) {
    report.outcome = 'REJECTED';
  } else if (report.revocation === 'NOT_CHECKED' || report.revocation === 'STALE') {
    report.outcome = 'INDETERMINATE';
    if (report.revocation === 'NOT_CHECKED') report.reasons.push('REVOCATION_STATUS_UNKNOWN');
  } else if (report.allowlist === 'STALE') {
    report.outcome = 'INDETERMINATE';
  } else if (report.ruleVersion === 'UNKNOWN') {
    report.outcome = 'INDETERMINATE';
  } else if (report.reasons.includes('TRANSFORM_RULE_NOT_IMPLEMENTED')) {
    report.outcome = 'INDETERMINATE';
  } else if (report.reasons.includes('ISSUED_IN_FUTURE')) {
    report.outcome = 'INDETERMINATE';
  } else if (attestation.chain && !attestation.chain.receipt) {
    report.outcome = 'INDETERMINATE';
  } else if (attestation.chain && report.chainCommitment === 'UNAVAILABLE') {
    report.outcome = 'VERIFIED_OFFLINE';
    report.reasons.push('CHAIN_NOT_VERIFIED');
  } else if (attestation.chain && report.chainCommitment === 'PRESENT_MATCH') {
    report.outcome = 'VERIFIED';
  } else if (attestation.chain && report.chainCommitment === 'PRESENT_MISMATCH') {
    report.outcome = 'REJECTED';
  } else {
    report.outcome = 'VERIFIED_OFFLINE';
  }
  return report;
}

export async function verifyAttestation(input: VerifyInput): Promise<VerificationReport> {
  const report = await runVerification(input);
  registerVerification(input, report);
  return report;
}
