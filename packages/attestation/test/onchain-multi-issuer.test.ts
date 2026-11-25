import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  HARDHAT_ACCOUNTS, anchorAttestation, makeChainReader, scanCommitments,
} from '../src/chain.js';
import { issueAttestation, IssueFactsSchema } from '../src/issue.js';
import { verifyAttestation } from '../src/verify.js';
import { resign } from './helpers.js';

// 本地隔离 Hardhat 上的多签发主体链上实验。两个签发主体使用各自密钥签发凭证，
// 链上承诺由同一个受控记录账户写入。链上记录只包含凭证摘要与公开标识，
// 不包含交付内容或任何私有数据。

const CONFIG_PATH = resolve('.local/attestation/config.json');
const config = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : null;
const skip = config ? false : 'LOCAL_CHAIN_CONFIG_MISSING';
const NOW = new Date('2026-11-25T00:00:00.000Z');

function loadConfig() {
  return {
    rpcUrl: config.rpcUrl as string,
    chainId: config.chainId as number,
    contract: config.contract as `0x${string}`,
    recorder: config.recorder as string,
    recorderKey: readFileSync(resolve('.local/attestation/keys/recorder.key'), 'utf8').trim() as Hex,
  };
}

function fixture(name: string): string {
  return readFileSync(resolve('experiments/verifiable-trust/fixtures', name), 'utf8');
}

interface Issued {
  attestation: Awaited<ReturnType<typeof issueAttestation>>;
  privateKey: Hex;
  address: string;
  input: string;
  delivery: string;
}

async function issueFor(input: {
  issuerId: string;
  keyId: string;
  eventId: string;
  privateKey?: Hex;
  chain?: { rpcUrl: string; chainId: number; contract: `0x${string}`; recorderKey: Hex };
}): Promise<Issued> {
  const facts = IssueFactsSchema.parse(JSON.parse(fixture('facts.json')));
  const privateKey = input.privateKey ?? generatePrivateKey();
  const source = fixture('input.csv');
  const delivery = fixture('delivery.csv');
  const attestation = await issueAttestation({
    facts: {
      ...facts,
      subject: {
        ...facts.subject,
        identity: { namespace: 'ct-local', value: `${input.issuerId}:agent` },
      },
      reputation: { ...facts.reputation, eventId: input.eventId },
    },
    inputContent: source,
    deliveryContent: delivery,
    privateKey,
    issuerId: input.issuerId,
    keyId: input.keyId,
    environment: 'local',
    deployment: 'multi-issuer-experiment',
    salts: { order: 'aa'.repeat(32), buyer: 'bb'.repeat(32) },
    now: NOW,
    chain: input.chain,
  });
  return {
    attestation,
    privateKey,
    address: privateKeyToAccount(privateKey).address,
    input: source,
    delivery,
  };
}

function allowlistFor(entries: Array<{ issuerId: string; keyId: string; address: string }>) {
  return {
    version: 'ct-issuer-allowlist-v1' as const,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    issuers: entries.map((entry) => ({
      ...entry,
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
    })),
  };
}

const revocations = {
  version: 'ct-revocation-list-v1' as const,
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-12-31T23:59:59.000Z',
  entries: [],
};

test('两个签发主体的凭证分别形成链上承诺并可由独立读者回读', { skip }, async () => {
  const c = loadConfig();
  const chain = { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey };
  const a = await issueFor({ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', eventId: 'onchain-a:csv-data-review:PASS', chain });
  const b = await issueFor({ issuerId: 'issuer-b', keyId: 'issuer-b-key-1', eventId: 'onchain-b:csv-data-review:PASS', chain });

  assert.ok(a.attestation.chain?.receipt);
  assert.ok(b.attestation.chain?.receipt);
  assert.notEqual(a.attestation.issuer.signerAddress, c.recorder);
  assert.notEqual(a.attestation.issuer.signerAddress, b.attestation.issuer.signerAddress);

  const reader = makeChainReader({ rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract });
  const records = await scanCommitments({
    rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract,
    fromBlock: BigInt(config.deploymentBlock),
  });
  for (const issued of [a, b]) {
    const record = records.find((item) => item.uri === `urn:ct:attestation:${issued.attestation.attestationId}`);
    assert.ok(record, '链上记录缺失');
    assert.equal(record.contentHash, issued.attestation.integrity.digest);
    assert.equal(record.recorder.toLowerCase(), c.recorder.toLowerCase());
    assert.equal(record.uri.includes(issued.attestation.issuer.issuerId), false);
    const evidence = await reader.inspect({ attestationId: issued.attestation.attestationId, version: 1 });
    assert.equal(evidence.commitment?.contentHash, issued.attestation.integrity.digest);
  }

  const allowlist = allowlistFor([
    { issuerId: 'issuer-a', keyId: 'issuer-a-key-1', address: a.address },
    { issuerId: 'issuer-b', keyId: 'issuer-b-key-1', address: b.address },
  ]);
  for (const issued of [a, b]) {
    const report = await verifyAttestation({
      attestation: issued.attestation,
      allowlist,
      revocations,
      inputContent: issued.input,
      deliveryContent: issued.delivery,
      chain: reader,
      chainPolicy: { authorizedRecorders: [c.recorder], minConfirmations: 1 },
    });
    assert.equal(report.chainCommitment, 'PRESENT_MATCH');
    assert.equal(report.outcome, 'VERIFIED');
  }
});

test('未授权签发者的链上承诺存在也不能通过信任策略', { skip }, async () => {
  const c = loadConfig();
  const chain = { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey };
  const a = await issueFor({ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', eventId: 'onchain-a2:csv-data-review:PASS' });
  const x = await issueFor({ issuerId: 'issuer-x', keyId: 'issuer-x-key-1', eventId: 'onchain-x:csv-data-review:PASS', chain });
  const allowlist = allowlistFor([{ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', address: a.address }]);
  const report = await verifyAttestation({
    attestation: x.attestation,
    allowlist,
    revocations,
    inputContent: x.input,
    deliveryContent: x.delivery,
    chain: makeChainReader({ rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract }),
    chainPolicy: { authorizedRecorders: [c.recorder], minConfirmations: 1 },
  });
  assert.equal(report.chainCommitment, 'PRESENT_MATCH');
  assert.equal(report.issuer, 'UNKNOWN');
  assert.equal(report.outcome, 'REJECTED');
});

test('未授权记录账户不能通过链上核验，非记录账户不能写入', { skip }, async () => {
  const c = loadConfig();
  const chain = { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey };
  const a = await issueFor({ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', eventId: 'onchain-a3:csv-data-review:PASS', chain });
  const allowlist = allowlistFor([{ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', address: a.address }]);
  const report = await verifyAttestation({
    attestation: a.attestation,
    allowlist,
    revocations,
    inputContent: a.input,
    deliveryContent: a.delivery,
    chain: makeChainReader({ rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract }),
    chainPolicy: { authorizedRecorders: ['0x00000000000000000000000000000000000000ff'], minConfirmations: 1 },
  });
  assert.equal(report.chainCommitment, 'PRESENT_MISMATCH');
  assert.ok(report.reasons.includes('CHAIN_RECORDER_UNAUTHORIZED'));
  assert.equal(report.outcome, 'REJECTED');

  const plain = await issueFor({ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', eventId: 'onchain-a4:csv-data-review:PASS' });
  await assert.rejects(() => anchorAttestation({
    rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract,
    recorderKey: HARDHAT_ACCOUNTS.deployer,
    attestationId: plain.attestation.attestationId,
    digest: plain.attestation.integrity.digest as Hex,
  }));
});

test('凭证撤销后链上历史承诺仍存在，但信任策略拒绝该凭证', { skip }, async () => {
  const c = loadConfig();
  const chain = { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey };
  const a = await issueFor({ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', eventId: 'onchain-a5:csv-data-review:PASS', chain });
  const allowlist = allowlistFor([{ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', address: a.address }]);
  const revoked = {
    ...revocations,
    entries: [{
      attestationId: a.attestation.attestationId,
      revokedAt: '2026-11-24T06:00:00.000Z',
      reasonCode: 'EXPERIMENT_REVOKED',
    }],
  };
  const reader = makeChainReader({ rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract });
  const report = await verifyAttestation({
    attestation: a.attestation,
    allowlist,
    revocations: revoked,
    inputContent: a.input,
    deliveryContent: a.delivery,
    chain: reader,
    chainPolicy: { authorizedRecorders: [c.recorder], minConfirmations: 1 },
  });
  assert.equal(report.chainCommitment, 'PRESENT_MATCH');
  assert.equal(report.revocation, 'REVOKED');
  assert.equal(report.outcome, 'REJECTED');
  const evidence = await reader.inspect({ attestationId: a.attestation.attestationId, version: 1 });
  assert.equal(evidence.commitment?.contentHash, a.attestation.integrity.digest);
});

test('签名凭证内容改变后与链上承诺不一致', { skip }, async () => {
  const c = loadConfig();
  const chain = { rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract, recorderKey: c.recorderKey };
  const a = await issueFor({ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', eventId: 'onchain-a6:csv-data-review:PASS', chain });
  const changed = await resign(a.attestation, a.privateKey, (copy) => {
    copy.delivery.contentHash = `0x${'77'.repeat(32)}`;
  });
  const allowlist = allowlistFor([{ issuerId: 'issuer-a', keyId: 'issuer-a-key-1', address: a.address }]);
  const report = await verifyAttestation({
    attestation: changed,
    allowlist,
    revocations,
    inputContent: a.input,
    deliveryContent: a.delivery,
    chain: makeChainReader({ rpcUrl: c.rpcUrl, chainId: c.chainId, contract: c.contract }),
    chainPolicy: { authorizedRecorders: [c.recorder], minConfirmations: 1 },
  });
  assert.equal(report.signature, 'VALID');
  assert.equal(report.chainCommitment, 'PRESENT_MISMATCH');
  assert.ok(report.reasons.includes('CHAIN_COMMITMENT_MISMATCH'));
  assert.equal(report.outcome, 'REJECTED');
});
