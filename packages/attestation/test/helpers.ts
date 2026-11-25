import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { signDigest } from '../src/sign.js';
import { attestationDigest } from '../src/canonical.js';
import { issueAttestation, IssueFactsSchema, type IssueFacts } from '../src/issue.js';
import {
  FulfillmentAttestationSchema, type FulfillmentAttestation, type IssuerAllowlist, type RevocationList,
} from '../src/schema.js';

const FIXTURE = new URL('../../../experiments/verifiable-trust/fixtures/', import.meta.url);

export function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE), 'utf8');
}

export interface IssuedFixture {
  attestation: FulfillmentAttestation;
  allowlist: IssuerAllowlist;
  revocations: RevocationList;
  privateKey: Hex;
  address: `0x${string}`;
  input: string;
  delivery: string;
  facts: IssueFacts;
}

export async function issueFixture(options: {
  facts?: Partial<IssueFacts>;
  inputContent?: string;
  deliveryContent?: string;
  now?: Date;
  attestationId?: string;
  journalPath?: string;
  privateKey?: Hex;
  chain?: { rpcUrl: string; chainId: number; contract: `0x${string}`; recorderKey: Hex };
  keyValidFrom?: string;
  keyValidTo?: string | null;
  keyRevokedAt?: string | null;
} = {}): Promise<IssuedFixture> {
  const facts = IssueFactsSchema.parse(JSON.parse(fixture('facts.json')));
  const merged = { ...facts, ...options.facts } as IssueFacts;
  const input = options.inputContent ?? fixture('input.csv');
  const delivery = options.deliveryContent ?? fixture('delivery.csv');
  const privateKey = options.privateKey ?? generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const allowlist: IssuerAllowlist = {
    version: 'ct-issuer-allowlist-v1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    issuers: [{
      issuerId: 'crewtrace-experiment',
      keyId: 'issuer-2026-11',
      address,
      validFrom: options.keyValidFrom ?? '2020-01-01T00:00:00.000Z',
      validTo: options.keyValidTo ?? null,
      revokedAt: options.keyRevokedAt ?? null,
    }],
  };
  const revocations: RevocationList = {
    version: 'ct-revocation-list-v1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    entries: [],
  };
  const attestation = await issueAttestation({
    facts: merged,
    inputContent: input,
    deliveryContent: delivery,
    privateKey,
    issuerId: 'crewtrace-experiment',
    keyId: 'issuer-2026-11',
    environment: 'local',
    deployment: 'experiment-local',
    salts: { order: 'aa'.repeat(32), buyer: 'bb'.repeat(32) },
    now: options.now ?? new Date('2026-11-24T04:00:00.000Z'),
    attestationId: options.attestationId,
    journalPath: options.journalPath,
    chain: options.chain,
  });
  return { attestation, allowlist, revocations, privateKey, address, input, delivery, facts: merged };
}

export async function resign(
  attestation: FulfillmentAttestation,
  privateKey: Hex,
  mutate?: (copy: FulfillmentAttestation) => void,
): Promise<FulfillmentAttestation> {
  const copy = structuredClone(attestation) as FulfillmentAttestation;
  delete (copy as { integrity?: unknown }).integrity;
  mutate?.(copy);
  copy.integrity = {
    canonicalization: 'ct-canonical-json-v1',
    digest: `0x${'00'.repeat(32)}`,
    signature: `0x${'00'.repeat(65)}`,
  };
  const normalized = FulfillmentAttestationSchema.parse(copy);
  delete (normalized as { integrity?: unknown }).integrity;
  const digest = attestationDigest(normalized as unknown as Record<string, unknown>);
  normalized.integrity = {
    canonicalization: 'ct-canonical-json-v1',
    digest,
    signature: await signDigest(digest, privateKey),
  };
  return FulfillmentAttestationSchema.parse(normalized);
}
