export { SDK_PACKAGE_NAME, SDK_VERSION, VERIFICATION_LEVELS, EVIDENCE_DIMENSIONS, ADMISSION_REASONS } from './contract.js';
export type { VerificationLevelName, EvidenceDimension, AdmissionReason } from './contract.js';
export { ERROR_CODES, TrustSdkError } from './errors.js';
export type { SdkErrorCode } from './errors.js';

export { loadAllowlist, loadRevocations, findIssuer } from './allowlist.js';
export { loadTrustPolicy, TrustPolicySchema } from './trust-policy.js';
export type { TrustPolicy, LoadedTrustPolicy } from './trust-policy.js';

export { issueAttestation, IssueFactsSchema } from './issue.js';
export type { IssueFacts, IssueInput } from './issue.js';

export { verifyAttestation } from './verify.js';
export type { VerifyInput, VerificationReport } from './verify.js';

export { verifyAndAggregateReputation } from './evaluate.js';
export type {
  TrustEvaluationCandidate, TrustEvaluationOptions, TrustEvaluation, TrustEvaluationSummary,
} from './evaluate.js';

export {
  aggregateReputation, evidenceLevelOf, reputationEventKey, reputationSubjectKey,
  DEFAULT_REPUTATION_POLICY,
} from './reputation.js';
export type {
  AdmissionDecision, AggregationResult, EvidenceLevel, ReputationAdmissionPolicy,
  ReputationBucket, VerificationLevel, VerifiedAttestation,
} from './reputation.js';

export { verifyChainEvidence, attestationRecordId, commitmentKey, attestationUri } from './chain-verify.js';
export type {
  ChainEvidence, ChainEvidenceRecord, ChainReader, ChainVerificationPolicy, ChainVerificationResult,
} from './chain-verify.js';
export { makeChainReader } from './chain.js';

export { evaluateCsv, CSV_RULE_ID } from './csv.js';
export type { CsvEvaluation } from './csv.js';
export { transformCsv, compareCsvTransformation, CSV_TRANSFORM_RULE_ID, CSV_TRANSFORM_RULE_VERSION } from './transform.js';
export type { CsvTransformResult, CsvTransformComparison } from './transform.js';
export {
  executeCsvCleanup, verifyCsvDelivery, CsvError, CsvConflictError, CSV_ROLE, CSV_RULE_VERSION,
} from './runtime-csv.js';
export type { CsvWorkerMode } from './runtime-csv.js';

export { attestationDigest, contentDigest, checksDigest } from './canonical.js';
export type {
  FulfillmentAttestation, IssuerAllowlist, RevocationList, ChainBinding,
} from './schema.js';
