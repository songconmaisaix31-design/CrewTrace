import { keccak256, toBytes, type Hex } from 'viem';
import { canonicalJson } from './canonical-json.js';
import type { VerificationReport, VerifyInput } from './verify.js';

// 核验结果密封表：只有 verifyAttestation 真正返回过的报告才登记在这里。
// 信誉聚合只信任登记表中的快照，调用者自行构造、替换或事后修改的报告无法进入可信计算。
export interface SealedVerification {
  attestationId: string | null;
  attestationDigest: Hex | null;
  reportSnapshot: VerificationReport;
  reportDigest: Hex;
  verificationPolicyDigest: Hex;
  verifiedAt: number;
}

const registry = new WeakMap<object, SealedVerification>();

export function reportDigestOf(report: VerificationReport): Hex {
  return keccak256(toBytes(canonicalJson(report)));
}

export function verificationPolicyDigestOf(input: VerifyInput): Hex {
  return keccak256(toBytes(canonicalJson({
    allowlist: input.allowlist ?? null,
    revocations: input.revocations ?? null,
    recognizedRuleVersions: input.recognizedRuleVersions ?? null,
    expectedBinding: input.expectedBinding ?? null,
    chainPolicy: input.chainPolicy ?? null,
    chainReader: input.chain
      ? { chainId: input.chain.chainId, contract: input.chain.contract.toLowerCase() }
      : null,
  })));
}

export function registerVerification(input: VerifyInput, report: VerificationReport): void {
  const raw = input.attestation as { attestationId?: unknown } | null;
  const attestationId = raw && typeof raw === 'object' && typeof raw.attestationId === 'string'
    ? raw.attestationId
    : null;
  const snapshot = structuredClone(report);
  registry.set(report, Object.freeze({
    attestationId,
    attestationDigest: (report.digest as Hex | null),
    reportSnapshot: snapshot,
    reportDigest: reportDigestOf(snapshot),
    verificationPolicyDigest: verificationPolicyDigestOf(input),
    verifiedAt: Date.now(),
  }));
}

export function lookupVerification(report: unknown): SealedVerification | null {
  if (!report || typeof report !== 'object') return null;
  return registry.get(report) ?? null;
}
