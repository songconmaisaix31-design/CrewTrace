import type { Hex } from 'viem';
import {
  aggregateReputation, type AdmissionDecision, type AggregationResult, type ReputationBucket,
  type VerifiedAttestation,
} from './reputation.js';
import { FulfillmentAttestationSchema } from './schema.js';
import { verificationPolicyDigestOf } from './verified-registry.js';
import { verifyAttestation, type VerificationReport } from './verify.js';
import type { ChainReader } from './chain-verify.js';
import { loadTrustPolicy, type LoadedTrustPolicy, type TrustPolicy } from './trust-policy.js';

export interface TrustEvaluationCandidate {
  attestation: unknown;
  inputContent?: string | null;
  deliveryContent?: string | null;
}

export interface TrustEvaluationOptions {
  policy: LoadedTrustPolicy | TrustPolicy;
  candidates: TrustEvaluationCandidate[];
  chain?: ChainReader | null;
  now?: Date;
}

export interface TrustEvaluationSummary {
  authenticity: { verified: number; unverified: number };
  outputFormat: { pass: number; fail: number; notAsserted: number };
  fulfillment: { pass: number; fail: number; notAsserted: number };
  chainCommitment: Record<string, number>;
  admission: { admitted: number; rejected: number };
}

export interface TrustEvaluation {
  verificationPolicyDigest: Hex;
  evaluations: Array<{
    attestationId: string | null;
    schemaValid: boolean;
    report: VerificationReport;
  }>;
  decisions: AdmissionDecision[];
  buckets: ReputationBucket[];
  ignored: AggregationResult['ignored'];
  summary: TrustEvaluationSummary;
}

function asLoaded(policy: LoadedTrustPolicy | TrustPolicy): LoadedTrustPolicy {
  return 'fingerprints' in policy ? policy : loadTrustPolicy(policy);
}

export async function verifyAndAggregateReputation(options: TrustEvaluationOptions): Promise<TrustEvaluation> {
  const loaded = asLoaded(options.policy);
  const { policy, now } = loaded;
  const chain = options.chain ?? null;
  const verificationPolicyDigest = verificationPolicyDigestOf({
    attestation: null,
    allowlist: policy.allowlist,
    revocations: policy.revocations,
    recognizedRuleVersions: policy.recognizedRuleVersions,
    expectedBinding: policy.expectedBinding,
    chainPolicy: policy.chain,
    chain,
  });

  const evaluations: TrustEvaluation['evaluations'] = [];
  const entries: VerifiedAttestation[] = [];
  for (const candidate of options.candidates) {
    const report = await verifyAttestation({
      attestation: candidate.attestation,
      allowlist: policy.allowlist,
      revocations: policy.revocations,
      inputContent: candidate.inputContent ?? null,
      deliveryContent: candidate.deliveryContent ?? null,
      chain,
      chainPolicy: policy.chain,
      now,
      recognizedRuleVersions: policy.recognizedRuleVersions,
      expectedBinding: policy.expectedBinding,
    });
    const parsed = FulfillmentAttestationSchema.safeParse(candidate.attestation);
    evaluations.push({
      attestationId: parsed.success ? parsed.data.attestationId : null,
      schemaValid: report.schema === 'VALID',
      report,
    });
    if (parsed.success) entries.push({ attestation: parsed.data, report });
  }

  const aggregated = aggregateReputation(entries, {
    policy: policy.reputation,
    expectedVerificationPolicyDigest: verificationPolicyDigest,
  });

  const summary: TrustEvaluationSummary = {
    authenticity: { verified: 0, unverified: 0 },
    outputFormat: { pass: 0, fail: 0, notAsserted: 0 },
    fulfillment: { pass: 0, fail: 0, notAsserted: 0 },
    chainCommitment: {},
    admission: {
      admitted: aggregated.decisions.filter((decision) => decision.admitted).length,
      rejected: evaluations.length - aggregated.decisions.filter((decision) => decision.admitted).length,
    },
  };
  for (const { report } of evaluations) {
    if (report.signature === 'VALID' && report.issuer === 'KNOWN') summary.authenticity.verified += 1;
    else summary.authenticity.unverified += 1;
    if (report.quality === 'RECALCULATED_PASS') summary.outputFormat.pass += 1;
    else if (report.quality === 'RECALCULATED_FAIL') summary.outputFormat.fail += 1;
    else summary.outputFormat.notAsserted += 1;
    if (report.fulfillment === 'RECALCULATED_PASS') summary.fulfillment.pass += 1;
    else if (report.fulfillment === 'RECALCULATED_FAIL') summary.fulfillment.fail += 1;
    else summary.fulfillment.notAsserted += 1;
    summary.chainCommitment[report.chainCommitment] = (summary.chainCommitment[report.chainCommitment] ?? 0) + 1;
  }

  return {
    verificationPolicyDigest,
    evaluations,
    decisions: aggregated.decisions,
    buckets: aggregated.buckets,
    ignored: aggregated.ignored,
    summary,
  };
}
