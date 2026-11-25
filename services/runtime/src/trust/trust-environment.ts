import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { Config } from '../config.js';
import {
  DEFAULT_REPUTATION_POLICY, type IssuerAllowlist, type RevocationList, type TrustPolicy,
} from '../../../../packages/attestation/src/index.ts';

export interface TrustEnvironment {
  enabled: boolean;
  issuerId: string;
  keyId: string;
  issuerValidFrom: string;
  address: `0x${string}` | null;
  privateKey: Hex | null;
  environment: 'local';
  deployment: string;
  orderSalt: string;
  buyerSalt: string;
  maxAttempts: number;
}

export const DEFAULT_ISSUER_VALID_FROM = '2026-01-01T00:00:00.000Z';

export function loadTrustEnvironment(config: Config): TrustEnvironment {
  const issuerValidFrom = config.TRUST_ISSUER_VALID_FROM ?? DEFAULT_ISSUER_VALID_FROM;
  if (!config.TRUST_ATTESTATION_ENABLED) return {
    enabled: false, issuerId: config.TRUST_ISSUER_ID, keyId: config.TRUST_KEY_ID, issuerValidFrom,
    address: null, privateKey: null,
    environment: config.TRUST_ENVIRONMENT, deployment: config.TRUST_DEPLOYMENT,
    orderSalt: '', buyerSalt: '', maxAttempts: config.TRUST_ATTESTATION_MAX_ATTEMPTS,
  };
  const privateKey = config.TRUST_ISSUER_PRIVATE_KEY as Hex;
  const account = privateKeyToAccount(privateKey);
  return {
    enabled: true, issuerId: config.TRUST_ISSUER_ID, keyId: config.TRUST_KEY_ID, issuerValidFrom,
    address: account.address, privateKey,
    environment: config.TRUST_ENVIRONMENT, deployment: config.TRUST_DEPLOYMENT,
    orderSalt: config.TRUST_ORDER_SALT as string, buyerSalt: config.TRUST_BUYER_SALT as string,
    maxAttempts: config.TRUST_ATTESTATION_MAX_ATTEMPTS,
  };
}

export function attestationAllowlist(env: TrustEnvironment, now: Date): IssuerAllowlist {
  if (!env.enabled || !env.address) throw new Error('信任环境未启用，不能构造签发者白名单');
  // 签发密钥使用稳定的历史生效时间；白名单自身的刷新时间与密钥有效期分开处理，
  // 避免白名单每次重建时把 validFrom 向前滑动而排除一分钟前签发的合法凭证。
  const validFrom = env.issuerValidFrom;
  return {
    version: 'ct-issuer-allowlist-v1',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    issuers: [{
      issuerId: env.issuerId, keyId: env.keyId, address: env.address,
      validFrom, validTo: null, revokedAt: null,
    }],
  };
}

export function attestationRevocations(rows: { attestationId: string; revokedAt: Date | string; reasonCode: string }[], now: Date): RevocationList {
  return {
    version: 'ct-revocation-list-v1',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    entries: rows.map(row => ({
      attestationId: row.attestationId,
      revokedAt: (row.revokedAt instanceof Date ? row.revokedAt : new Date(row.revokedAt)).toISOString(),
      reasonCode: row.reasonCode,
    })),
  };
}

export function attestationTrustPolicy(env: TrustEnvironment, revocations: RevocationList, now: Date): TrustPolicy {
  return {
    version: 'ct-trust-policy-v1',
    trustRoot: {
      kind: 'CONTROLLED_LOCAL_CONFIG',
      issuerSource: 'LOCAL_UNSIGNED_JSON',
      revocationSource: 'LOCAL_UNSIGNED_JSON',
      independentlyCertified: false,
      notes: 'Runtime 本地实验信任根，只包含实验签发者，不代表公共链或生产部署。',
    },
    allowlist: attestationAllowlist(env, now),
    revocations,
    requireRevocations: true,
    freshness: { maxAllowlistAgeSeconds: 86_400, maxRevocationAgeSeconds: 3_600 },
    recognizedRuleVersions: ['csv-ledger-v1'],
    expectedBinding: { environment: env.environment, deployment: env.deployment },
    // 本轮不要求链上承诺，本地实验凭证以离线复算作为可信证据，链上承诺存在时另行记录。
    reputation: { ...DEFAULT_REPUTATION_POLICY, acceptedOutcomes: ['VERIFIED', 'VERIFIED_OFFLINE'], allowOffline: true },
  };
}
