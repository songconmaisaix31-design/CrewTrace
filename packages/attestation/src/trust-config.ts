import { readFileSync } from 'node:fs';
import { keccak256, toBytes, type Hex } from 'viem';
import { z } from 'zod';
import { canonicalJson } from './canonical-json.js';
import { ERROR_CODES, TrustSdkError } from './errors.js';
import {
  AddressSchema, HashSchema, IsoTimeSchema, IssuerAllowlistSchema, RevocationListSchema,
  SignatureSchema,
} from './schema.js';
import { recoverDigestSigner, signDigest } from './sign.js';
import type { IssuerAllowlist, RevocationList } from './schema.js';

// 可验证信任配置。信任根公钥必须由验证方通过独立于凭证与配置本身的渠道
// 预先获得；配置带有有效签名只说明它由该信任根签发，不代表名单内签发者
// 已经获得任何独立认证或真实组织背书。
export const TRUST_CONFIG_FORMAT = 'ct-trust-config-v1';
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const trustConfigPayloadSchema = z.strictObject({
  format: z.literal(TRUST_CONFIG_FORMAT),
  configVersion: z.number().int().positive(),
  issuedAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
  trustRoot: z.strictObject({
    keyId: z.string().min(1).max(64),
    publicKey: AddressSchema,
  }),
  allowlist: IssuerAllowlistSchema,
  revocations: RevocationListSchema,
});

export const TrustConfigSchema = trustConfigPayloadSchema.extend({
  digest: HashSchema,
  signature: SignatureSchema,
});

export type TrustConfigPayload = z.infer<typeof trustConfigPayloadSchema>;
export type TrustConfig = z.infer<typeof TrustConfigSchema>;

export interface LoadedTrustConfig {
  configVersion: number;
  configDigest: Hex;
  trustRoot: { keyId: string; publicKey: string };
  allowlist: IssuerAllowlist;
  revocations: RevocationList;
}

export function trustConfigDigest(payload: TrustConfigPayload): Hex {
  return keccak256(toBytes(`${TRUST_CONFIG_FORMAT}:${canonicalJson(payload)}`));
}

export async function signTrustConfig(input: {
  payload: TrustConfigPayload;
  rootKey: Hex;
}): Promise<TrustConfig> {
  const payload = trustConfigPayloadSchema.parse(input.payload);
  const digest = trustConfigDigest(payload);
  const signature = await signDigest(digest, input.rootKey);
  return { ...payload, digest, signature };
}

function fail(code: keyof typeof ERROR_CODES, message: string): never {
  throw new TrustSdkError(ERROR_CODES[code], message);
}

export async function loadTrustConfig(input: {
  source: string | unknown;
  trustedRootAddress: string;
  minConfigVersion?: number;
  expectedDigest?: Hex;
  now?: Date;
}): Promise<LoadedTrustConfig> {
  let raw: unknown = input.source;
  if (typeof input.source === 'string') {
    try {
      raw = JSON.parse(readFileSync(input.source, 'utf8'));
    } catch (error) {
      fail('TRUST_CONFIG_UNREADABLE', error instanceof Error ? error.message : '无法读取信任配置');
    }
  }
  const parsed = TrustConfigSchema.safeParse(raw);
  if (!parsed.success) {
    fail('TRUST_CONFIG_INVALID', parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const config = parsed.data;
  const { digest, signature, ...payload } = config;
  const recomputed = trustConfigDigest(payload);
  if (recomputed !== digest) fail('TRUST_CONFIG_DIGEST_MISMATCH', '配置摘要与内容不一致');
  const trustedRoot = input.trustedRootAddress.toLowerCase();
  if (config.trustRoot.publicKey !== trustedRoot) {
    fail('TRUST_CONFIG_ROOT_MISMATCH', '配置信任根与本地预置公钥不一致');
  }
  let signer: string;
  try {
    signer = await recoverDigestSigner(recomputed, signature as Hex);
  } catch {
    fail('TRUST_CONFIG_SIGNATURE_MISMATCH', '配置签名无法恢复签发者');
  }
  if (signer !== trustedRoot) fail('TRUST_CONFIG_SIGNATURE_MISMATCH', '配置签名者与信任根不一致');

  const now = input.now ?? new Date();
  const issuedAt = new Date(config.issuedAt).getTime();
  const expiresAt = new Date(config.expiresAt).getTime();
  if (issuedAt > now.getTime() + CLOCK_SKEW_MS) fail('TRUST_CONFIG_NOT_YET_VALID', '配置尚未生效');
  if (expiresAt <= now.getTime()) fail('TRUST_CONFIG_EXPIRED', '配置已过期');
  if (input.minConfigVersion !== undefined && config.configVersion < input.minConfigVersion) {
    fail('TRUST_CONFIG_ROLLBACK', `配置版本 ${config.configVersion} 低于本地已接受下限 ${input.minConfigVersion}`);
  }
  if (input.expectedDigest && input.expectedDigest.toLowerCase() !== recomputed) {
    fail('TRUST_CONFIG_DIGEST_MISMATCH', '配置摘要与本地固定摘要不一致');
  }

  const allowlistIssuedAt = config.allowlist.issuedAt;
  const allowlistExpiresAt = config.allowlist.expiresAt;
  if (!allowlistIssuedAt || !allowlistExpiresAt) {
    fail('TRUST_CONFIG_SCOPE_MISMATCH', '签发者名单必须带有签发时间与有效期');
  }
  if (new Date(allowlistIssuedAt).getTime() > now.getTime() + CLOCK_SKEW_MS) {
    fail('TRUST_CONFIG_SCOPE_MISMATCH', '签发者名单签发时间晚于当前时间');
  }
  if (new Date(allowlistExpiresAt).getTime() > expiresAt) {
    fail('TRUST_CONFIG_SCOPE_MISMATCH', '签发者名单有效期超出配置有效期');
  }
  const revocationsIssuedAt = config.revocations.issuedAt;
  const revocationsExpiresAt = config.revocations.expiresAt;
  if (!revocationsIssuedAt || !revocationsExpiresAt) {
    fail('TRUST_CONFIG_REVOCATION_INTEGRITY', '撤销列表必须带有签发时间与有效期');
  }
  if (new Date(revocationsIssuedAt).getTime() > now.getTime() + CLOCK_SKEW_MS) {
    fail('TRUST_CONFIG_REVOCATION_INTEGRITY', '撤销列表签发时间晚于当前时间');
  }
  if (new Date(revocationsExpiresAt).getTime() > expiresAt) {
    fail('TRUST_CONFIG_REVOCATION_INTEGRITY', '撤销列表有效期超出配置有效期');
  }
  for (const entry of config.revocations.entries) {
    if (new Date(entry.revokedAt).getTime() > now.getTime() + CLOCK_SKEW_MS) {
      fail('TRUST_CONFIG_REVOCATION_INTEGRITY', `撤销时间晚于当前时间: ${entry.attestationId}`);
    }
  }

  return {
    configVersion: config.configVersion,
    configDigest: recomputed,
    trustRoot: { keyId: config.trustRoot.keyId, publicKey: config.trustRoot.publicKey },
    allowlist: config.allowlist,
    revocations: config.revocations,
  };
}
