import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Hex } from 'viem';
import { issueAttestation, IssueFactsSchema } from '../src/issue.js';

const { values } = parseArgs({
  options: {
    facts: { type: 'string' },
    salts: { type: 'string' },
    key: { type: 'string' },
    'key-id': { type: 'string' },
    'issuer-id': { type: 'string' },
    environment: { type: 'string', default: 'local' },
    deployment: { type: 'string', default: 'experiment-local' },
    out: { type: 'string' },
    journal: { type: 'string' },
    'attestation-id': { type: 'string' },
    rpc: { type: 'string' },
    'chain-id': { type: 'string' },
    contract: { type: 'string' },
    'recorder-key': { type: 'string' },
  },
});

function required(name: string): string {
  const value = values[name as keyof typeof values];
  if (typeof value !== 'string' || !value) throw new Error(`MISSING_ARGUMENT:${name}`);
  return value;
}

const factsPath = required('facts');
const facts = IssueFactsSchema.parse(JSON.parse(readFileSync(factsPath, 'utf8')));
const salts = JSON.parse(readFileSync(required('salts'), 'utf8')) as { order: string; buyer: string };
const privateKey = readFileSync(required('key'), 'utf8').trim() as Hex;
const base = dirname(resolve(factsPath));

const chain = values.rpc ? {
  rpcUrl: values.rpc,
  chainId: Number(required('chain-id')),
  contract: required('contract') as `0x${string}`,
  recorderKey: readFileSync(required('recorder-key'), 'utf8').trim() as Hex,
} : undefined;

const attestation = await issueAttestation({
  facts,
  inputContent: readFileSync(resolve(base, facts.input.path), 'utf8'),
  deliveryContent: readFileSync(resolve(base, facts.delivery.path), 'utf8'),
  privateKey,
  issuerId: required('issuer-id'),
  keyId: required('key-id'),
  environment: values.environment as 'local' | 'staging' | 'production',
  deployment: values.deployment as string,
  salts,
  chain,
  journalPath: values.journal,
  attestationId: values['attestation-id'],
});

writeFileSync(required('out'), `${JSON.stringify(attestation, null, 2)}\n`);
console.log(JSON.stringify({
  attestationId: attestation.attestationId,
  digest: attestation.integrity.digest,
  chain: attestation.chain?.receipt ?? null,
  out: resolve(required('out')),
}, null, 2));
