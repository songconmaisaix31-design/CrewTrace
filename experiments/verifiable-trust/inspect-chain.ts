import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createPublicClient, defineChain, http, toHex } from 'viem';
import { makeChainReader } from '../../packages/attestation/src/chain.js';
import { verifyChainEvidence } from '../../packages/attestation/src/chain-verify.js';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    attestation: { type: 'string' },
    facts: { type: 'string' },
    input: { type: 'string' },
    delivery: { type: 'string' },
    recorder: { type: 'string', multiple: true },
    'min-confirmations': { type: 'string' },
    out: { type: 'string' },
  },
});

function required(name: string): string {
  const value = values[name as keyof typeof values];
  if (typeof value !== 'string' || !value) throw new Error(`MISSING_ARGUMENT:${name}`);
  return value;
}

const config = JSON.parse(readFileSync(required('config'), 'utf8')) as {
  rpcUrl: string; chainId: number; contract: `0x${string}`; recorder: `0x${string}`;
};
const attestation = JSON.parse(readFileSync(required('attestation'), 'utf8'));
const facts = JSON.parse(readFileSync(required('facts'), 'utf8'));
const inputContent = readFileSync(required('input'), 'utf8');
const deliveryContent = readFileSync(required('delivery'), 'utf8');
if (!attestation.chain?.receipt) throw new Error('ATTESTATION_HAS_NO_CHAIN_RECEIPT');

const reader = makeChainReader({
  rpcUrl: config.rpcUrl, chainId: config.chainId, contract: config.contract,
});
const evidence = await reader.inspect({
  attestationId: attestation.attestationId, version: attestation.chain.version,
});
const policy = {
  authorizedRecorders: values.recorder?.length ? values.recorder : [config.recorder],
  minConfirmations: Number(values['min-confirmations'] ?? 1),
};
const verification = verifyChainEvidence({
  attestationId: attestation.attestationId,
  binding: attestation.chain,
  digest: attestation.integrity.digest,
  policy,
  evidence,
});

const chain = defineChain({
  id: config.chainId,
  name: `experiment-${config.chainId}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const rawInput = evidence.receipt
  ? (await publicClient.getTransaction({ hash: attestation.chain.receipt.txHash })).input
  : null;

const sensitive = [
  facts.source.orderId,
  facts.source.buyerAgentId,
  facts.source.taskId,
  facts.subject.agentId,
  'amount_cents',
  'record_id',
  ...deliveryContent.split(/\r?\n/).filter((line) => line.trim().length > 0),
  ...inputContent.split(/\r?\n/).filter((line) => line.trim().length > 0),
];
const observation = JSON.stringify({
  input: rawInput,
  commitment: evidence.commitment ? { ...evidence.commitment, recordedAt: '0' } : null,
  event: evidence.event ? { ...evidence.event, recordedAt: '0' } : null,
}).toLowerCase();
const leaks = sensitive.filter((value) => {
  if (typeof value !== 'string' || value.length < 4) return false;
  if (observation.includes(value.toLowerCase())) return true;
  return observation.includes(toHex(Buffer.from(value, 'utf8')).slice(2).toLowerCase());
});

const report = {
  checkedAt: new Date().toISOString(),
  chainId: evidence.rpcChainId,
  contract: evidence.contract,
  attestationId: attestation.attestationId,
  digest: attestation.integrity.digest,
  receipt: evidence.receipt,
  commitment: evidence.commitment
    ? { ...evidence.commitment, recordedAt: evidence.commitment.recordedAt.toString() }
    : null,
  event: evidence.event ? { ...evidence.event, recordedAt: '0' } : null,
  latestBlock: evidence.latestBlock,
  policy,
  verification,
  privacy: { checkedFields: sensitive.length, leaks },
  outcome: verification.status === 'PRESENT_MATCH' && leaks.length === 0 ? 'CHAIN_MATCH' : 'CHAIN_MISMATCH',
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (values.out) writeFileSync(required('out'), output);
process.stdout.write(output);
process.exit(report.outcome === 'CHAIN_MATCH' ? 0 : 2);
