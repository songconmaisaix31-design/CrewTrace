import { existsSync, readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { signTrustConfig, trustConfigDigest } from '../../packages/attestation/src/index.js';
import {
  CONFIG_EXPIRES_AT, CONFIG_ISSUED_AT, argument, readJson, write, writeJson,
} from './common.js';

// 受控模拟的验证方信任根。信任根私钥只保存在本地信任目录，公钥通过独立文件
// 交给核验进程。签发者名单与撤销列表由该信任根签名，配置带有有效签名只说明
// 它由该信任根签发，不代表名单内签发者获得独立认证。

interface IssuerPublicKey {
  keyId: string;
  address: string;
  validFrom: string;
  validTo: string | null;
}

interface IssuerPublic {
  issuerId: string;
  keys: IssuerPublicKey[];
}

async function main(): Promise<void> {
  const issuers = argument('--issuers').split(',').map((path) => path.trim()).filter(Boolean);
  const out = argument('--out');
  const file = argument('--file', 'config.json');
  const version = Number(argument('--version', '1'));
  const only = argument('--only', '');
  const revokedAttestations = argument('--revoke', '').split(',').filter(Boolean);
  const revokedKeys = argument('--revoke-key', '').split(',').filter(Boolean);
  const expired = process.argv.includes('--expired');
  const tamper = process.argv.includes('--tamper-allowlist');

  const rootKeyPath = `${out}/root.key`;
  const rootKey = (existsSync(rootKeyPath) ? readFileSync(rootKeyPath, 'utf8').trim() : generatePrivateKey()) as Hex;
  if (!existsSync(rootKeyPath)) write(rootKeyPath, `${rootKey}\n`);
  const rootAddress = privateKeyToAccount(rootKey).address;

  const issuerFiles = issuers.map((path) => readJson<IssuerPublic>(path));
  const allowlistIssuers = issuerFiles
    .filter((issuer) => !only || issuer.issuerId === only)
    .flatMap((issuer) => issuer.keys.map((key) => ({
      issuerId: issuer.issuerId,
      keyId: key.keyId,
      address: key.address,
      validFrom: key.validFrom,
      validTo: key.validTo,
      revokedAt: revokedKeys.includes(`${issuer.issuerId}:${key.keyId}`) ? '2026-11-24T06:00:00.000Z' : null,
    })));

  const payload = {
    format: 'ct-trust-config-v1' as const,
    configVersion: version,
    issuedAt: expired ? '2025-01-01T00:00:00.000Z' : CONFIG_ISSUED_AT,
    expiresAt: expired ? '2026-01-01T00:00:00.000Z' : CONFIG_EXPIRES_AT,
    trustRoot: { keyId: 'multi-issuer-root-1', publicKey: rootAddress },
    allowlist: {
      version: 'ct-issuer-allowlist-v1',
      issuedAt: expired ? '2025-01-01T00:00:00.000Z' : CONFIG_ISSUED_AT,
      expiresAt: expired ? '2026-01-01T00:00:00.000Z' : CONFIG_EXPIRES_AT,
      issuers: allowlistIssuers,
    },
    revocations: {
      version: 'ct-revocation-list-v1',
      issuedAt: expired ? '2025-01-01T00:00:00.000Z' : CONFIG_ISSUED_AT,
      expiresAt: expired ? '2026-01-01T00:00:00.000Z' : CONFIG_EXPIRES_AT,
      entries: revokedAttestations.map((attestationId) => ({
        attestationId,
        revokedAt: '2026-11-24T06:00:00.000Z',
        reasonCode: 'EXPERIMENT_REVOKED',
      })),
    },
  };

  const config = await signTrustConfig({ payload, rootKey });
  if (tamper) {
    config.allowlist.issuers[0].address = '0x00000000000000000000000000000000000000ff';
  }
  writeJson(`${out}/${file}`, config);
  writeJson(`${out}/root.pub.json`, {
    keyId: 'multi-issuer-root-1',
    publicKey: rootAddress,
    distribution: 'SEPARATE_TRUST_CHANNEL',
  });
  console.log(JSON.stringify({
    configVersion: version,
    digest: tamper ? trustConfigDigest(payload) : config.digest,
    tampered: tamper,
    expired,
    issuers: allowlistIssuers.map((issuer) => `${issuer.issuerId}:${issuer.keyId}`),
    revocations: revokedAttestations.length,
    revokedKeys: revokedKeys.length,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
