import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Hex } from 'viem';
import {
  anchorAttestation, makeChainReader, scanCommitments,
} from '../src/chain.js';
import { verifyAttestation } from '../src/verify.js';
import { issueFixture, resign } from './helpers.js';

const CONFIG_PATH = resolve('.local/attestation/config.json');
const config = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : null;
const skip = config ? false : 'LOCAL_CHAIN_CONFIG_MISSING';

function loadConfig() {
  return {
    rpcUrl: config.rpcUrl as string,
    chainId: config.chainId as number,
    contract: config.contract as `0x${string}`,
    deploymentBlock: BigInt(config.deploymentBlock),
    issuerKey: readFileSync(resolve('.local/attestation/keys/issuer.key'), 'utf8').trim() as Hex,
    recorderKey: readFileSync(resolve('.local/attestation/keys/recorder.key'), 'utf8').trim() as Hex,
    allowlistPath: resolve('.local/attestation/allowlist.json'),
    revocationsPath: resolve('.local/attestation/revocations.json'),
  };
}

test('用例 2：带链上承诺的凭证核验通过', { skip }, async () => {
  const c = loadConfig();
  const issued = await issueFixture({
    privateKey: c.issuerKey,
    chain: { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey },
  });
  assert.ok(issued.attestation.chain?.receipt);
  const reader = makeChainReader({ rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract });
  const report = await verifyAttestation({
    attestation: issued.attestation, allowlist: issued.allowlist, revocations: issued.revocations,
    deliveryContent: issued.delivery, chain: reader,
  });
  assert.equal(report.chainCommitment, 'PRESENT_MATCH');
  assert.equal(report.quality, 'RECALCULATED_PASS');
  assert.equal(report.outcome, 'VERIFIED');

  const dir = resolve('.local/attestation/chain-evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'attestation.json'), `${JSON.stringify(issued.attestation, null, 2)}\n`);
  writeFileSync(resolve(dir, 'allowlist.json'), `${JSON.stringify(issued.allowlist, null, 2)}\n`);
  writeFileSync(resolve(dir, 'revocations.json'), `${JSON.stringify(issued.revocations, null, 2)}\n`);
  writeFileSync(resolve(dir, 'delivery.csv'), issued.delivery);
  writeFileSync(resolve(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
});

test('用例 9：链节点不可用时降级为离线核验', { skip }, async () => {
  const c = loadConfig();
  const issued = await issueFixture({
    privateKey: c.issuerKey,
    chain: { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey },
  });
  const report = await verifyAttestation({
    attestation: issued.attestation, allowlist: issued.allowlist, revocations: issued.revocations,
    deliveryContent: issued.delivery, chain: null,
  });
  assert.equal(report.chainCommitment, 'UNAVAILABLE');
  assert.equal(report.outcome, 'VERIFIED_OFFLINE');
  assert.ok(report.reasons.includes('CHAIN_NOT_VERIFIED'));
});

test('用例 8：链上摘要与凭证不一致时拒绝', { skip }, async () => {
  const c = loadConfig();
  const plain = await issueFixture({ privateKey: c.issuerKey });
  const anchored = await anchorAttestation({
    rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey,
    attestationId: plain.attestation.attestationId, digest: plain.attestation.integrity.digest as `0x${string}`,
  });
  const mismatched = await resign(plain.attestation, c.issuerKey, (copy) => {
    copy.chain = {
      chainId: c.chainId, contract: c.contract, mappingKind: 4,
      recordId: anchored.recordId, version: 1, commitmentKey: anchored.commitmentKey,
      receipt: { ...anchored.receipt, signer: anchored.receipt.signer.toLowerCase() },
    };
  });
  const reader = makeChainReader({ rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract });
  const report = await verifyAttestation({
    attestation: mismatched, allowlist: plain.allowlist, revocations: plain.revocations,
    deliveryContent: plain.delivery, chain: reader,
  });
  assert.equal(report.chainCommitment, 'PRESENT_MISMATCH');
  assert.equal(report.outcome, 'REJECTED');
});

test('跨网络与跨合约不得重放', { skip }, async () => {
  const c = loadConfig();
  const issued = await issueFixture({
    privateKey: c.issuerKey,
    chain: { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey },
  });
  const otherNetwork = makeChainReader({ rpcUrl: c.rpcUrl, chainId: 1, contract: c.contract });
  const networkReport = await verifyAttestation({
    attestation: issued.attestation, allowlist: issued.allowlist, revocations: issued.revocations,
    chain: otherNetwork,
  });
  assert.equal(networkReport.chainCommitment, 'PRESENT_MISMATCH');
  assert.equal(networkReport.outcome, 'REJECTED');

  const otherContract = makeChainReader({
    rpcUrl: c.rpcUrl, chainId: c.chainId, contract: '0x0000000000000000000000000000000000000001',
  });
  const contractReport = await verifyAttestation({
    attestation: issued.attestation, allowlist: issued.allowlist, revocations: issued.revocations,
    chain: otherContract,
  });
  assert.equal(contractReport.chainCommitment, 'PRESENT_MISMATCH');
  assert.equal(contractReport.outcome, 'REJECTED');
});

test('同一凭证不得重复写入链上承诺', { skip }, async () => {
  const c = loadConfig();
  const issued = await issueFixture({ privateKey: c.issuerKey });
  const args = {
    rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey,
    attestationId: issued.attestation.attestationId, digest: issued.attestation.integrity.digest as `0x${string}`,
  };
  await anchorAttestation(args);
  await assert.rejects(() => anchorAttestation(args));
});

test('公开链上记录不含私有数据', { skip }, async () => {
  const c = loadConfig();
  const records = await scanCommitments({
    rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, fromBlock: c.deploymentBlock,
  });
  assert.ok(records.length >= 1);
  const serialized = JSON.stringify(records);
  const forbidden = [
    'record_id,date', 'mcp-a', 'e1d9e295', '82d7c1ba', 'ea2dbb8a',
    'alipay', 'providerTradeNo', 'proofHash', 'PAYMENT_',
  ];
  for (const marker of forbidden) {
    assert.equal(serialized.includes(marker), false, `链上记录包含禁止内容: ${marker}`);
  }
  for (const record of records) {
    assert.match(record.recordId, /^0x[0-9a-f]{64}$/);
    assert.match(record.contentHash, /^0x[0-9a-f]{64}$/);
    assert.match(record.uri, /^urn:ct:attestation:[0-9a-f-]{36}$/);
  }
});

test('独立验证器命令行不依赖数据库与环境令牌', { skip }, async () => {
  const c = loadConfig();
  const dir = resolve('.local/attestation/chain-evidence');
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', 'packages/attestation/cli/verify.ts',
    '--attestation', resolve(dir, 'attestation.json'),
    '--allowlist', resolve(dir, 'allowlist.json'),
    '--revocations', resolve(dir, 'revocations.json'),
    '--delivery', resolve(dir, 'delivery.csv'),
    '--rpc', c.rpcUrl,
    '--chain-id', String(c.chainId),
    '--contract', c.contract,
  ], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'VERIFIED');
  assert.equal(report.quality, 'RECALCULATED_PASS');
});
