import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadAllowlist, loadRevocations } from '../src/allowlist.js';
import { makeChainReader } from '../src/chain.js';
import { verifyAttestation } from '../src/verify.js';

const { values } = parseArgs({
  options: {
    attestation: { type: 'string' },
    allowlist: { type: 'string' },
    revocations: { type: 'string' },
    delivery: { type: 'string' },
    rpc: { type: 'string' },
    'chain-id': { type: 'string' },
    contract: { type: 'string' },
    out: { type: 'string' },
    environment: { type: 'string' },
    deployment: { type: 'string' },
  },
});

function required(name: string): string {
  const value = values[name as keyof typeof values];
  if (typeof value !== 'string' || !value) throw new Error(`MISSING_ARGUMENT:${name}`);
  return value;
}

const attestation = JSON.parse(readFileSync(required('attestation'), 'utf8'));
const allowlist = loadAllowlist(required('allowlist'));
const revocations = values.revocations ? loadRevocations(values.revocations) : null;
const deliveryContent = values.delivery ? readFileSync(values.delivery, 'utf8') : null;
const chain = values.rpc && values['chain-id'] && values.contract
  ? makeChainReader({
    rpcUrl: values.rpc, chainId: Number(values['chain-id']),
    contract: values.contract as `0x${string}`,
  })
  : null;

const report = await verifyAttestation({
  attestation, allowlist, revocations, deliveryContent, chain,
  expectedBinding: values.environment && values.deployment
    ? { environment: values.environment as 'local' | 'staging' | 'production', deployment: values.deployment }
    : undefined,
});
const output = `${JSON.stringify(report, null, 2)}\n`;
if (values.out) writeFileSync(required('out'), output);
process.stdout.write(output);
process.exit(report.outcome === 'VERIFIED' || report.outcome === 'VERIFIED_OFFLINE' ? 0 : report.outcome === 'INDETERMINATE' ? 1 : 2);
