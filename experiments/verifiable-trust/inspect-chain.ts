import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createPublicClient, defineChain, encodeAbiParameters, http, keccak256, toBytes, toHex,
  type Hex,
} from 'viem';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    attestation: { type: 'string' },
    facts: { type: 'string' },
    input: { type: 'string' },
    delivery: { type: 'string' },
    out: { type: 'string' },
  },
});

function required(name: string): string {
  const value = values[name as keyof typeof values];
  if (typeof value !== 'string' || !value) throw new Error(`MISSING_ARGUMENT:${name}`);
  return value;
}

const config = JSON.parse(readFileSync(required('config'), 'utf8')) as {
  rpcUrl: string; chainId: number; contract: `0x${string}`; deploymentBlock: string; recorder: `0x${string}`;
};
const attestation = JSON.parse(readFileSync(required('attestation'), 'utf8'));
const facts = JSON.parse(readFileSync(required('facts'), 'utf8'));
const inputContent = readFileSync(required('input'), 'utf8');
const deliveryContent = readFileSync(required('delivery'), 'utf8');

const abi = [
  {
    type: 'function', name: 'getCommitment', stateMutability: 'view',
    inputs: [
      { name: 'kind', type: 'uint8' }, { name: 'recordId', type: 'bytes32' }, { name: 'version', type: 'uint32' },
    ],
    outputs: [{
      name: '', type: 'tuple', components: [
        { name: 'kind', type: 'uint8' }, { name: 'recordId', type: 'bytes32' },
        { name: 'version', type: 'uint32' }, { name: 'contentHash', type: 'bytes32' },
        { name: 'uri', type: 'string' }, { name: 'recorder', type: 'address' },
        { name: 'recordedAt', type: 'uint64' },
      ],
    }],
  },
  {
    type: 'event', name: 'CommitmentRecorded', anonymous: false,
    inputs: [
      { name: 'kind', type: 'uint8', indexed: true },
      { name: 'recordId', type: 'bytes32', indexed: true },
      { name: 'version', type: 'uint32', indexed: true },
      { name: 'contentHash', type: 'bytes32', indexed: false },
      { name: 'uri', type: 'string', indexed: false },
      { name: 'recorder', type: 'address', indexed: false },
    ],
  },
] as const;

const checks: Array<{ name: string; pass: boolean; expected?: unknown; actual?: unknown }> = [];
function check(name: string, pass: boolean, expected?: unknown, actual?: unknown) {
  checks.push({ name, pass, ...(expected === undefined ? {} : { expected }), ...(actual === undefined ? {} : { actual }) });
}

const chain = defineChain({
  id: config.chainId,
  name: `experiment-${config.chainId}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(config.rpcUrl) });

const chainId = await client.getChainId();
check('rpc_chain_id', chainId === config.chainId, config.chainId, chainId);

const bound = attestation.chain;
if (!bound || !bound.receipt) throw new Error('ATTESTATION_HAS_NO_CHAIN_RECEIPT');
check('attestation_chain_id', bound.chainId === chainId, chainId, bound.chainId);
check('attestation_contract', bound.contract.toLowerCase() === config.contract.toLowerCase(), config.contract.toLowerCase(), bound.contract);

const receipt = await client.getTransactionReceipt({ hash: bound.receipt.txHash as Hex });
const tx = await client.getTransaction({ hash: bound.receipt.txHash as Hex });
check('transaction_success', receipt.status === 'success', 'success', receipt.status);
check('transaction_target', receipt.to?.toLowerCase() === config.contract.toLowerCase(), config.contract.toLowerCase(), receipt.to);
check('transaction_block_matches', receipt.blockNumber.toString() === bound.receipt.blockNumber, bound.receipt.blockNumber, receipt.blockNumber.toString());
check('transaction_signer_matches', receipt.from.toLowerCase() === bound.receipt.signer.toLowerCase(), bound.receipt.signer, receipt.from);

const derivedRecordId = keccak256(toBytes(`co-vibe:collaboration:ATTESTATION:${attestation.attestationId}`));
check('record_id_derivation', derivedRecordId.toLowerCase() === bound.recordId.toLowerCase(), bound.recordId, derivedRecordId);
const expectedKey = keccak256(encodeAbiParameters(
  [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'uint32' }],
  [4, derivedRecordId, 1],
));
check('commitment_key_derivation', expectedKey.toLowerCase() === bound.commitmentKey.toLowerCase(), bound.commitmentKey, expectedKey);

const commitment = await client.readContract({
  address: config.contract, abi, functionName: 'getCommitment',
  args: [4, derivedRecordId, 1],
}) as {
  kind: number; recordId: string; version: number; contentHash: string; uri: string;
  recorder: string; recordedAt: bigint;
};
check('commitment_exists', commitment.recordedAt > 0n, 'recordedAt>0', commitment.recordedAt.toString());
check('commitment_content_hash', commitment.contentHash.toLowerCase() === attestation.integrity.digest.toLowerCase(), attestation.integrity.digest, commitment.contentHash);
check('commitment_uri', commitment.uri === `urn:ct:attestation:${attestation.attestationId}`, `urn:ct:attestation:${attestation.attestationId}`, commitment.uri);
check('commitment_recorder', commitment.recorder.toLowerCase() === config.recorder.toLowerCase(), config.recorder, commitment.recorder);

const events = await client.getContractEvents({
  address: config.contract, abi, eventName: 'CommitmentRecorded', fromBlock: BigInt(config.deploymentBlock),
});
const matched = events.filter((event) => String(event.args.recordId).toLowerCase() === derivedRecordId.toLowerCase());
check('event_count_for_record', matched.length === 1, 1, matched.length);
if (matched.length === 1) {
  check('event_block_matches', matched[0].blockNumber.toString() === bound.receipt.blockNumber, bound.receipt.blockNumber, matched[0].blockNumber.toString());
  check('event_hash_matches', String(matched[0].args.contentHash).toLowerCase() === attestation.integrity.digest.toLowerCase(), attestation.integrity.digest, matched[0].args.contentHash);
}

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
  input: tx.input,
  logs: receipt.logs.map((log) => ({ address: log.address, data: log.data, topics: log.topics })),
  uri: commitment.uri,
  events: events.map((event) => ({ uri: String(event.args.uri), hash: String(event.args.contentHash) })),
}).toLowerCase();
const leaks = sensitive.filter((value) => {
  if (typeof value !== 'string' || value.length < 4) return false;
  if (observation.includes(value.toLowerCase())) return true;
  return observation.includes(toHex(Buffer.from(value, 'utf8')).slice(2).toLowerCase());
});
check('public_chain_contains_no_private_fields', leaks.length === 0, [], leaks);

const report = {
  checkedAt: new Date().toISOString(),
  chainId,
  contract: config.contract,
  attestationId: attestation.attestationId,
  digest: attestation.integrity.digest,
  transaction: {
    txHash: bound.receipt.txHash, blockNumber: receipt.blockNumber.toString(), from: receipt.from,
    to: receipt.to, status: receipt.status, inputLength: tx.input.length,
  },
  commitment: {
    kind: commitment.kind, recordId: commitment.recordId, version: commitment.version,
    contentHash: commitment.contentHash, uri: commitment.uri, recorder: commitment.recorder,
    recordedAt: commitment.recordedAt.toString(),
  },
  checks,
  outcome: checks.every((item) => item.pass) ? 'CHAIN_MATCH' : 'CHAIN_MISMATCH',
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (values.out) writeFileSync(required('out'), output);
process.stdout.write(output);
process.exit(report.outcome === 'CHAIN_MATCH' ? 0 : 2);
