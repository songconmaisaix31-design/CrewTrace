import { readFileSync } from 'node:fs';
import { keccak256, toBytes, type Hex } from 'viem';
import { z } from 'zod';
import { canonicalJson } from './canonical-json.js';
import { ERROR_CODES, TrustSdkError } from './errors.js';
import {
  AddressSchema, BindingSchema, IsoTimeSchema, IssuerAllowlistSchema, RevocationListSchema,
} from './schema.js';

const EvidenceLevelSchema = z.enum([
  'UNVERIFIED', 'SIGNATURE_ONLY', 'CONTENT_RECALCULATED', 'FULFILLMENT_RECALCULATED', 'CHAIN_CONFIRMED',
]);

const ReputationPolicySchema = z.strictObject({
  acceptedOutcomes: z.array(z.enum(['VERIFIED', 'VERIFIED_OFFLINE'])).min(1),
  allowOffline: z.boolean(),
  minOfflineEvidence: EvidenceLevelSchema,
  requireQuality: z.boolean(),
  requireFulfillment: z.boolean(),
  requireFreshRevocationList: z.boolean(),
  requireFreshAllowlist: z.boolean(),
});

export const TrustPolicySchema = z.strictObject({
  version: z.literal('ct-trust-policy-v1'),
  trustRoot: z.strictObject({
    kind: z.literal('CONTROLLED_LOCAL_CONFIG'),
    issuerSource: z.enum(['LOCAL_UNSIGNED_JSON', 'CALLER_SUPPLIED_UNSIGNED', 'SIGNED_CONFIG_WITH_PINNED_ROOT']),
    revocationSource: z.enum(['LOCAL_UNSIGNED_JSON', 'CALLER_SUPPLIED_UNSIGNED', 'SIGNED_CONFIG_WITH_PINNED_ROOT']),
    independentlyCertified: z.literal(false),
    notes: z.string().min(1).max(2000),
  }),
  allowlist: IssuerAllowlistSchema,
  revocations: RevocationListSchema.nullable(),
  requireRevocations: z.boolean(),
  freshness: z.strictObject({
    now: IsoTimeSchema.optional(),
    maxAllowlistAgeSeconds: z.number().int().positive(),
    maxRevocationAgeSeconds: z.number().int().positive(),
  }),
  recognizedRuleVersions: z.array(z.string().min(1).max(64)).min(1),
  expectedBinding: BindingSchema.optional(),
  chain: z.strictObject({
    authorizedRecorders: z.array(AddressSchema).min(1),
    minConfirmations: z.number().int().positive(),
  }).optional(),
  // 代码任务的执行审批地址集合。缺省为空，表示策略不允许触发任何代码执行。
  codeExecution: z.strictObject({
    trustedGrantSigners: z.array(AddressSchema).min(1),
  }).optional(),
  reputation: ReputationPolicySchema,
});

export type TrustPolicy = z.infer<typeof TrustPolicySchema>;

export interface LoadedTrustPolicy {
  policy: TrustPolicy;
  now: Date;
  fingerprints: {
    policy: Hex;
    allowlist: Hex;
    revocations: Hex | null;
  };
  warnings: string[];
}

const CLOCK_SKEW_MS = 5 * 60 * 1000;

function fingerprint(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

function assertListFreshness(input: {
  label: 'ALLOWLIST' | 'REVOCATION_LIST';
  issuedAt: string | undefined;
  expiresAt: string | null | undefined;
  maxAgeSeconds: number;
  now: Date;
}): void {
  const { label, issuedAt, expiresAt, maxAgeSeconds, now } = input;
  const missing = label === 'ALLOWLIST' ? ERROR_CODES.ALLOWLIST_MISSING_METADATA : ERROR_CODES.REVOCATION_LIST_MISSING_METADATA;
  const future = label === 'ALLOWLIST' ? ERROR_CODES.ALLOWLIST_FUTURE_DATED : ERROR_CODES.REVOCATION_LIST_FUTURE_DATED;
  const stale = label === 'ALLOWLIST' ? ERROR_CODES.ALLOWLIST_STALE : ERROR_CODES.REVOCATION_LIST_STALE;
  if (!issuedAt || !expiresAt) throw new TrustSdkError(missing, `${label} 必须同时声明 issuedAt 与 expiresAt`);
  const issued = new Date(issuedAt).getTime();
  const expires = new Date(expiresAt).getTime();
  if (issued > now.getTime() + CLOCK_SKEW_MS) throw new TrustSdkError(future, `${label} issuedAt 晚于当前时间`);
  if (expires <= now.getTime()) throw new TrustSdkError(stale, `${label} 已过期`);
  if (now.getTime() - issued > maxAgeSeconds * 1000) throw new TrustSdkError(stale, `${label} 超过最大允许年龄`);
}

export function loadTrustPolicy(source: string | TrustPolicy): LoadedTrustPolicy {
  let raw: unknown;
  if (typeof source === 'string') {
    try {
      raw = JSON.parse(readFileSync(source, 'utf8'));
    } catch (error) {
      throw new TrustSdkError(ERROR_CODES.POLICY_UNREADABLE, `无法读取信任策略 ${source}: ${(error as Error).message}`);
    }
  } else {
    raw = source;
  }
  const parsed = TrustPolicySchema.safeParse(raw);
  if (!parsed.success) {
    throw new TrustSdkError(
      ERROR_CODES.POLICY_INVALID,
      parsed.error.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`).join(','),
    );
  }
  const policy = parsed.data;
  if (!policy.recognizedRuleVersions.length) throw new TrustSdkError(ERROR_CODES.RULE_VERSION_EMPTY, '至少声明一个可识别规则版本');
  const now = policy.freshness.now ? new Date(policy.freshness.now) : new Date();
  const warnings: string[] = [];

  assertListFreshness({
    label: 'ALLOWLIST', issuedAt: policy.allowlist.issuedAt, expiresAt: policy.allowlist.expiresAt,
    maxAgeSeconds: policy.freshness.maxAllowlistAgeSeconds, now,
  });
  if (!policy.revocations) {
    if (policy.requireRevocations) throw new TrustSdkError(ERROR_CODES.REVOCATION_LIST_REQUIRED, '策略要求撤销列表');
    warnings.push('REVOCATION_LIST_NOT_PROVIDED');
  } else {
    assertListFreshness({
      label: 'REVOCATION_LIST', issuedAt: policy.revocations.issuedAt, expiresAt: policy.revocations.expiresAt,
      maxAgeSeconds: policy.freshness.maxRevocationAgeSeconds, now,
    });
  }

  return {
    policy,
    now,
    fingerprints: {
      policy: fingerprint(policy),
      allowlist: fingerprint(policy.allowlist),
      revocations: policy.revocations ? fingerprint(policy.revocations) : null,
    },
    warnings,
  };
}
