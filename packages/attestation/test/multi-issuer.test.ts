import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { issueAttestation } from '../src/issue.js';
import { verifyAttestation } from '../src/verify.js';
import { aggregateReputation, DEFAULT_REPUTATION_POLICY } from '../src/reputation.js';
import { IssueFactsSchema } from '../src/issue.js';
import type { FulfillmentAttestation, IssuerAllowlist, RevocationList } from '../src/schema.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-11-24T04:05:00.000Z');
const ISSUED_AT = new Date('2026-11-24T04:00:00.000Z');
const OFFLINE_POLICY = {
  ...DEFAULT_REPUTATION_POLICY,
  acceptedOutcomes: ['VERIFIED_OFFLINE' as const],
  allowOffline: true,
};

interface Issuer {
  issuerId: string;
  keyId: string;
  privateKey: Hex;
  address: `0x${string}`;
  namespace: 'ct-local';
  value: string;
}

function makeIssuer(issuerId: string, keyId: string, value: string, privateKey: Hex = generatePrivateKey()): Issuer {
  return {
    issuerId,
    keyId,
    privateKey,
    address: privateKeyToAccount(privateKey).address,
    namespace: 'ct-local',
    value,
  };
}

const ALPHA = makeIssuer('issuer-alpha', 'alpha-key-1', 'alpha-agent');
const BETA = makeIssuer('issuer-beta', 'beta-key-1', 'beta-agent');
const ROGUE = makeIssuer('issuer-rogue', 'rogue-key-1', 'rogue-agent');

async function issueFor(
  issuer: Issuer,
  options: { now?: Date; eventId?: string; attestationId?: string; agentId?: string } = {},
): Promise<FulfillmentAttestation> {
  const facts = IssueFactsSchema.parse(JSON.parse(fixture('facts.json')));
  facts.subject.agentId = options.agentId ?? randomUUID();
  facts.subject.identity = { namespace: issuer.namespace, value: issuer.value };
  facts.reputation.eventId = options.eventId ?? `${issuer.issuerId}:event-1`;
  return issueAttestation({
    facts,
    inputContent: fixture('input.csv'),
    deliveryContent: fixture('delivery.csv'),
    privateKey: issuer.privateKey,
    issuerId: issuer.issuerId,
    keyId: issuer.keyId,
    environment: 'local',
    deployment: 'multi-issuer-experiment',
    salts: { order: 'aa'.repeat(32), buyer: 'bb'.repeat(32) },
    now: options.now ?? ISSUED_AT,
    attestationId: options.attestationId,
  });
}

function allowlistOf(entries: Array<{
  issuer: Issuer; validFrom?: string; validTo?: string | null; revokedAt?: string | null;
}>): IssuerAllowlist {
  return {
    version: 'ct-issuer-allowlist-v1',
    issuedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    issuers: entries.map(({ issuer, validFrom, validTo, revokedAt }) => ({
      issuerId: issuer.issuerId,
      keyId: issuer.keyId,
      address: issuer.address,
      validFrom: validFrom ?? '2026-01-01T00:00:00.000Z',
      validTo: validTo ?? null,
      revokedAt: revokedAt ?? null,
    })),
  };
}

const EMPTY_REVOCATIONS: RevocationList = {
  version: 'ct-revocation-list-v1',
  issuedAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2026-12-31T00:00:00.000Z',
  entries: [],
};

async function verify(
  attestation: FulfillmentAttestation,
  allowlist: IssuerAllowlist,
  revocations: RevocationList = EMPTY_REVOCATIONS,
) {
  return verifyAttestation({
    attestation,
    allowlist,
    revocations,
    inputContent: fixture('input.csv'),
    deliveryContent: fixture('delivery.csv'),
    recognizedRuleVersions: ['csv-ledger-v1'],
    now: NOW,
  });
}

test('两个签发主体的身份与信誉分桶相互独立', async () => {
  const alphaAttestation = await issueFor(ALPHA);
  const betaAttestation = await issueFor(BETA);
  const allowlist = allowlistOf([{ issuer: ALPHA }, { issuer: BETA }]);
  const alphaReport = await verify(alphaAttestation, allowlist);
  const betaReport = await verify(betaAttestation, allowlist);
  assert.equal(alphaReport.outcome, 'VERIFIED_OFFLINE');
  assert.equal(betaReport.outcome, 'VERIFIED_OFFLINE');

  const result = aggregateReputation([
    { attestation: alphaAttestation, report: alphaReport },
    { attestation: betaAttestation, report: betaReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 2);
  const alphaBucket = result.buckets.find((bucket) => bucket.issuerId === ALPHA.issuerId);
  const betaBucket = result.buckets.find((bucket) => bucket.issuerId === BETA.issuerId);
  assert.equal(alphaBucket?.sampleSize, 1);
  assert.equal(betaBucket?.sampleSize, 1);
  assert.notEqual(alphaBucket?.agentId, betaBucket?.agentId);
  assert.equal(alphaBucket?.subjectValue, ALPHA.value);
  assert.equal(betaBucket?.subjectValue, BETA.value);
  assert.equal(alphaBucket?.pass, 1);
  assert.equal(betaBucket?.pass, 1);
});

test('验证方可以只信任其中一个签发主体', async () => {
  const alphaAttestation = await issueFor(ALPHA);
  const betaAttestation = await issueFor(BETA);
  const alphaOnly = allowlistOf([{ issuer: ALPHA }]);
  const alphaReport = await verify(alphaAttestation, alphaOnly);
  const betaReport = await verify(betaAttestation, alphaOnly);
  assert.equal(alphaReport.outcome, 'VERIFIED_OFFLINE');
  assert.equal(betaReport.outcome, 'REJECTED');
  assert.ok(betaReport.reasons.includes('ISSUER_UNKNOWN'));

  const result = aggregateReputation([
    { attestation: alphaAttestation, report: alphaReport },
    { attestation: betaAttestation, report: betaReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].issuerId, ALPHA.issuerId);
  assert.equal(result.decisions.find((decision) => !decision.admitted)?.attestationId, betaAttestation.attestationId);
});

test('未授权签发主体的凭证被拒绝且不进入信誉聚合', async () => {
  const rogueAttestation = await issueFor(ROGUE);
  const allowlist = allowlistOf([{ issuer: ALPHA }, { issuer: BETA }]);
  const report = await verify(rogueAttestation, allowlist);
  assert.equal(report.outcome, 'REJECTED');
  assert.equal(report.issuer, 'UNKNOWN');
  assert.ok(report.reasons.includes('ISSUER_UNKNOWN'));
  const result = aggregateReputation([{ attestation: rogueAttestation, report }], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 0);
  assert.equal(result.decisions[0].admitted, false);
});

test('密钥轮换后历史凭证仍按签发时间核验，撤销旧密钥后历史凭证被拒绝', async () => {
  const oldKey = generatePrivateKey();
  const alphaOld = makeIssuer('issuer-alpha', 'alpha-key-1', 'alpha-agent', oldKey);
  const newKey = generatePrivateKey();
  const alphaNew = makeIssuer('issuer-alpha', 'alpha-key-2', 'alpha-agent', newKey);
  const historical = await issueFor(alphaOld);
  const current = await issueFor(alphaNew, { now: new Date('2026-11-24T04:03:00.000Z') });

  const rotated = allowlistOf([
    { issuer: alphaOld, validTo: '2026-11-24T04:02:00.000Z' },
    { issuer: alphaNew, validFrom: '2026-11-24T04:02:00.000Z' },
  ]);
  const historicalReport = await verify(historical, rotated);
  const currentReport = await verify(current, rotated);
  assert.equal(historicalReport.outcome, 'VERIFIED_OFFLINE');
  assert.equal(historicalReport.keyStatus, 'ACTIVE');
  assert.equal(currentReport.outcome, 'VERIFIED_OFFLINE');
  assert.equal(currentReport.keyStatus, 'ACTIVE');

  const revoked = allowlistOf([
    { issuer: alphaOld, validTo: '2026-11-24T04:02:00.000Z', revokedAt: '2026-11-24T04:04:00.000Z' },
    { issuer: alphaNew, validFrom: '2026-11-24T04:02:00.000Z' },
  ]);
  const revokedReport = await verify(historical, revoked);
  assert.equal(revokedReport.outcome, 'REJECTED');
  assert.equal(revokedReport.keyStatus, 'REVOKED');
  assert.ok(revokedReport.reasons.includes('KEY_REVOKED'));
  const result = aggregateReputation([{ attestation: historical, report: revokedReport }], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 0);
});

test('已撤销凭证不影响同签发主体其他凭证', async () => {
  const alphaA = await issueFor(ALPHA, { eventId: 'alpha:event-1' });
  const alphaB = await issueFor(ALPHA, { eventId: 'alpha:event-2' });
  const allowlist = allowlistOf([{ issuer: ALPHA }]);
  const revocations: RevocationList = {
    ...EMPTY_REVOCATIONS,
    entries: [{
      attestationId: alphaA.attestationId,
      revokedAt: '2026-11-24T04:04:00.000Z',
      reasonCode: 'COMPROMISED',
    }],
  };
  const revokedReport = await verify(alphaA, allowlist, revocations);
  const validReport = await verify(alphaB, allowlist, revocations);
  assert.equal(revokedReport.outcome, 'REJECTED');
  assert.ok(revokedReport.reasons.includes('ATTESTATION_REVOKED'));
  assert.equal(validReport.outcome, 'VERIFIED_OFFLINE');

  const result = aggregateReputation([
    { attestation: alphaA, report: revokedReport },
    { attestation: alphaB, report: validReport },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].sampleSize, 1);
  assert.equal(result.buckets[0].pass, 1);
});

test('不同签发主体不会因相同事件标识而互相去重', async () => {
  const sharedEvent = 'shared-event-id';
  const alphaAttestation = await issueFor(ALPHA, { eventId: sharedEvent });
  const betaAttestation = await issueFor(BETA, { eventId: sharedEvent });
  const allowlist = allowlistOf([{ issuer: ALPHA }, { issuer: BETA }]);
  const result = aggregateReputation([
    { attestation: alphaAttestation, report: await verify(alphaAttestation, allowlist) },
    { attestation: betaAttestation, report: await verify(betaAttestation, allowlist) },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 2);
  assert.equal(result.ignored.length, 0);
  assert.deepEqual(
    result.buckets.map((bucket) => bucket.issuerId).sort(),
    [ALPHA.issuerId, BETA.issuerId],
  );
});

test('同一签发主体的重复凭证只计一次', async () => {
  const attestation = await issueFor(ALPHA);
  const allowlist = allowlistOf([{ issuer: ALPHA }]);
  const report = await verify(attestation, allowlist);
  const result = aggregateReputation([
    { attestation, report },
    { attestation, report },
  ], { policy: OFFLINE_POLICY });
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].sampleSize, 1);
  assert.ok(result.ignored.some((item) => item.reason === 'DUPLICATE_ATTESTATION'));
});
