import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  loadTrustConfig, signTrustConfig,
} from '../src/trust-config.js';
import { TrustSdkError } from '../src/errors.js';
import type { TrustConfigPayload } from '../src/trust-config.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');

function payload(overrides: Partial<TrustConfigPayload> = {}): TrustConfigPayload {
  return {
    format: 'ct-trust-config-v1',
    configVersion: 3,
    issuedAt: '2026-11-24T00:00:00.000Z',
    expiresAt: '2026-11-25T00:00:00.000Z',
    trustRoot: { keyId: 'root-2026-11', publicKey: '0x0000000000000000000000000000000000000000' },
    allowlist: {
      version: 'ct-issuer-allowlist-v1',
      issuedAt: '2026-11-24T00:00:00.000Z',
      expiresAt: '2026-11-24T23:00:00.000Z',
      issuers: [{
        issuerId: 'issuer-a',
        keyId: 'a-key-1',
        address: '0x1111111111111111111111111111111111111111',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: null,
        revokedAt: null,
      }],
    },
    revocations: {
      version: 'ct-revocation-list-v1',
      issuedAt: '2026-11-24T00:00:00.000Z',
      expiresAt: '2026-11-24T23:00:00.000Z',
      entries: [],
    },
    ...overrides,
  };
}

async function signed(overrides: Partial<TrustConfigPayload> = {}) {
  const rootKey = generatePrivateKey();
  const rootAddress = privateKeyToAccount(rootKey).address;
  const base = payload(overrides);
  const config = await signTrustConfig({
    payload: { ...base, trustRoot: { ...base.trustRoot, publicKey: rootAddress } },
    rootKey,
  });
  return { config, rootAddress, rootKey };
}

async function signedPayload(mutate: (draft: TrustConfigPayload) => void) {
  const rootKey = generatePrivateKey();
  const rootAddress = privateKeyToAccount(rootKey).address;
  const base = payload();
  base.trustRoot.publicKey = rootAddress;
  mutate(base);
  const config = await signTrustConfig({ payload: base, rootKey });
  return { config, rootAddress };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TrustSdkError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

test('签名信任配置在本地信任根匹配时被接受', async () => {
  const { config, rootAddress } = await signed();
  const loaded = await loadTrustConfig({
    source: config,
    trustedRootAddress: rootAddress,
    minConfigVersion: 2,
    now: NOW,
  });
  assert.equal(loaded.configVersion, 3);
  assert.equal(loaded.allowlist.issuers[0].issuerId, 'issuer-a');
  assert.equal(loaded.configDigest, config.digest);
});

test('签发者名单被篡改时摘要校验失败', async () => {
  const { config, rootAddress } = await signed();
  const tampered = structuredClone(config);
  tampered.allowlist.issuers.push({
    issuerId: 'issuer-injected',
    keyId: 'injected-key',
    address: '0x2222222222222222222222222222222222222222',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    revokedAt: null,
  });
  await expectCode(loadTrustConfig({ source: tampered, trustedRootAddress: rootAddress, now: NOW }), 'TRUST_CONFIG_DIGEST_MISMATCH');
});

test('撤销列表被篡改时摘要校验失败', async () => {
  const { config, rootAddress } = await signed();
  const tampered = structuredClone(config);
  tampered.revocations.entries.push({
    attestationId: '99999999-9999-4999-8999-999999999999',
    revokedAt: '2026-11-24T01:00:00.000Z',
    reasonCode: 'COMPROMISED',
  });
  await expectCode(loadTrustConfig({ source: tampered, trustedRootAddress: rootAddress, now: NOW }), 'TRUST_CONFIG_DIGEST_MISMATCH');
});

test('签名被替换时拒绝加载', async () => {
  const { config, rootAddress } = await signed();
  const tampered = structuredClone(config);
  tampered.signature = `0x${'ab'.repeat(65)}`;
  await expectCode(loadTrustConfig({ source: tampered, trustedRootAddress: rootAddress, now: NOW }), 'TRUST_CONFIG_SIGNATURE_MISMATCH');
});

test('本地信任根与配置声明不一致时拒绝加载', async () => {
  const { config } = await signed();
  await expectCode(loadTrustConfig({
    source: config,
    trustedRootAddress: '0x3333333333333333333333333333333333333333',
    now: NOW,
  }), 'TRUST_CONFIG_ROOT_MISMATCH');
});

test('配置过期或尚未生效时拒绝加载', async () => {
  const { config, rootAddress } = await signed();
  await expectCode(loadTrustConfig({
    source: config,
    trustedRootAddress: rootAddress,
    now: new Date('2026-11-26T00:00:00.000Z'),
  }), 'TRUST_CONFIG_EXPIRED');
  await expectCode(loadTrustConfig({
    source: config,
    trustedRootAddress: rootAddress,
    now: new Date('2026-11-23T00:00:00.000Z'),
  }), 'TRUST_CONFIG_NOT_YET_VALID');
});

test('低于本地已接受版本的回滚配置被拒绝', async () => {
  const { config, rootAddress } = await signed();
  await expectCode(loadTrustConfig({
    source: config,
    trustedRootAddress: rootAddress,
    minConfigVersion: 4,
    now: NOW,
  }), 'TRUST_CONFIG_ROLLBACK');
});

test('本地固定摘要不一致时拒绝加载', async () => {
  const { config, rootAddress } = await signed();
  await expectCode(loadTrustConfig({
    source: config,
    trustedRootAddress: rootAddress,
    expectedDigest: `0x${'cd'.repeat(32)}`,
    now: NOW,
  }), 'TRUST_CONFIG_DIGEST_MISMATCH');
});

test('名单缺少有效期或撤销列表超出配置有效期时拒绝加载', async () => {
  const noMetadata = await signedPayload((draft) => {
    delete draft.allowlist.issuedAt;
  });
  await expectCode(loadTrustConfig({
    source: noMetadata.config,
    trustedRootAddress: noMetadata.rootAddress,
    now: NOW,
  }), 'TRUST_CONFIG_SCOPE_MISMATCH');

  const longRevocations = await signedPayload((draft) => {
    draft.revocations.expiresAt = '2026-12-31T00:00:00.000Z';
  });
  await expectCode(loadTrustConfig({
    source: longRevocations.config,
    trustedRootAddress: longRevocations.rootAddress,
    now: NOW,
  }), 'TRUST_CONFIG_REVOCATION_INTEGRITY');
});

test('未来时间的撤销记录被视为完整性失败', async () => {
  const future = await signedPayload((draft) => {
    draft.revocations.entries.push({
      attestationId: '99999999-9999-4999-8999-999999999999',
      revokedAt: '2026-11-24T13:00:00.000Z',
      reasonCode: 'COMPROMISED',
    });
  });
  await expectCode(loadTrustConfig({
    source: future.config,
    trustedRootAddress: future.rootAddress,
    now: NOW,
  }), 'TRUST_CONFIG_REVOCATION_INTEGRITY');
});

test('信任配置可以从独立文件读取并按同一规则校验', async () => {
  const { config, rootAddress } = await signed();
  const directory = mkdtempSync(join(tmpdir(), 'crewtrace-trust-config-'));
  const path = join(directory, 'trust-config.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  const loaded = await loadTrustConfig({ source: path, trustedRootAddress: rootAddress, now: NOW });
  assert.equal(loaded.configVersion, 3);

  const tampered = structuredClone(config);
  tampered.allowlist.issuers[0].address = '0x4444444444444444444444444444444444444444';
  writeFileSync(path, JSON.stringify(tampered, null, 2));
  await expectCode(loadTrustConfig({ source: path, trustedRootAddress: rootAddress, now: NOW }), 'TRUST_CONFIG_DIGEST_MISMATCH');
});
