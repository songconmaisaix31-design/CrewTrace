import { readFileSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, defineChain, http, keccak256,
  type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { collaborationLedgerAbi } from './ledger-abi.js';
import {
  ATTESTATION_MAPPING_KIND, ATTESTATION_VERSION, attestationRecordId, attestationUri,
  commitmentKey, type ChainEvidence, type ChainEvidenceRecord, type ChainReader,
} from './chain-verify.js';

export { ATTESTATION_MAPPING_KIND, ATTESTATION_VERSION, attestationRecordId, attestationUri, commitmentKey };
export type { ChainEvidence, ChainReader };

const LOCAL_EXPERIMENT_CHAIN_ID = 31337;

export function assertLocalExperimentChain(chainId: number): void {
  if (chainId !== LOCAL_EXPERIMENT_CHAIN_ID) {
    throw new Error(`NON_LOCAL_CHAIN_FORBIDDEN:${chainId}`);
  }
}

function chainFor(rpcUrl: string, chainId: number) {
  return defineChain({
    id: chainId,
    name: `experiment-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export async function deployLocalLedger(input: {
  rpcUrl: string; chainId: number; deployerKey: Hex; recorder: Address; artifactPath: string;
}): Promise<{ contract: Address; txHash: Hex; blockNumber: string }> {
  assertLocalExperimentChain(input.chainId);
  const artifact = JSON.parse(readFileSync(input.artifactPath, 'utf8')) as { abi: unknown[]; bytecode: Hex };
  const chain = chainFor(input.rpcUrl, input.chainId);
  const account = privateKeyToAccount(input.deployerKey);
  const publicClient = createPublicClient({ chain, transport: http(input.rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(input.rpcUrl), account });
  if (await publicClient.getChainId() !== input.chainId) throw new Error('RPC_CHAIN_ID_MISMATCH');
  const txHash = await walletClient.deployContract({
    abi: artifact.abi as never, bytecode: artifact.bytecode, args: [input.recorder],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (!receipt.contractAddress) throw new Error('DEPLOYMENT_FAILED');
  return { contract: receipt.contractAddress, txHash, blockNumber: receipt.blockNumber.toString() };
}

export async function anchorAttestation(input: {
  rpcUrl: string; chainId: number; contract: Address; recorderKey: Hex; attestationId: string; digest: Hex;
}): Promise<{
  recordId: Hex; commitmentKey: Hex; uri: string;
  receipt: { txHash: Hex; blockNumber: string; signer: Address };
}> {
  assertLocalExperimentChain(input.chainId);
  const chain = chainFor(input.rpcUrl, input.chainId);
  const account = privateKeyToAccount(input.recorderKey);
  const publicClient = createPublicClient({ chain, transport: http(input.rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(input.rpcUrl), account });
  if (await publicClient.getChainId() !== input.chainId) throw new Error('RPC_CHAIN_ID_MISMATCH');
  const recordId = attestationRecordId(input.attestationId);
  const key = commitmentKey(recordId);
  const uri = attestationUri(input.attestationId);
  const args = [ATTESTATION_MAPPING_KIND, recordId, ATTESTATION_VERSION, input.digest, uri] as const;
  await publicClient.simulateContract({
    address: input.contract, abi: collaborationLedgerAbi, functionName: 'record', args, account,
  });
  const txHash = await walletClient.writeContract({
    address: input.contract, abi: collaborationLedgerAbi, functionName: 'record', args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error('ANCHOR_TRANSACTION_FAILED');
  return {
    recordId, commitmentKey: key, uri,
    receipt: { txHash, blockNumber: receipt.blockNumber.toString(), signer: account.address },
  };
}

export function makeChainReader(input: { rpcUrl: string; chainId: number; contract: Address }): ChainReader {
  const chain = chainFor(input.rpcUrl, input.chainId);
  const publicClient = createPublicClient({ chain, transport: http(input.rpcUrl) });
  return {
    chainId: input.chainId,
    contract: input.contract.toLowerCase(),
    async inspect({ attestationId, version }) {
      const rpcChainId = await publicClient.getChainId();
      const recordId = attestationRecordId(attestationId);
      const commitment = await publicClient.readContract({
        address: input.contract, abi: collaborationLedgerAbi, functionName: 'getCommitment',
        args: [ATTESTATION_MAPPING_KIND, recordId, version],
      }) as {
        kind: number; recordId: string; version: number; contentHash: string; uri: string;
        recorder: string; recordedAt: bigint;
      };
      const latestBlock = Number(await publicClient.getBlockNumber());
      const record = commitment.recordedAt === 0n ? null : {
        kind: Number(commitment.kind), recordId: commitment.recordId,
        version: Number(commitment.version), contentHash: commitment.contentHash.toLowerCase(),
        uri: commitment.uri, recorder: commitment.recorder.toLowerCase(),
        recordedAt: commitment.recordedAt, blockNumber: 0, txHash: '',
      } satisfies ChainEvidenceRecord;
      const evidence: ChainEvidence = {
        rpcChainId, contract: input.contract.toLowerCase(), commitment: record,
        receipt: null, event: null, latestBlock,
      };
      if (!record) return evidence;
      const events = await publicClient.getContractEvents({
        address: input.contract, abi: collaborationLedgerAbi, eventName: 'CommitmentRecorded',
        args: { recordId }, fromBlock: 0n,
      });
      const matched = events.filter((event) => Number(event.args.version) === version);
      if (matched.length !== 1) {
        if (matched.length > 1) throw new Error('DUPLICATE_COMMITMENT_EVENTS');
        return evidence;
      }
      const event = matched[0];
      const txHash = event.transactionHash;
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      const eventRecord: ChainEvidenceRecord = {
        kind: Number(event.args.kind), recordId: String(event.args.recordId),
        version: Number(event.args.version), contentHash: String(event.args.contentHash).toLowerCase(),
        uri: String(event.args.uri), recorder: String(event.args.recorder).toLowerCase(),
        recordedAt: 0n, blockNumber: Number(event.blockNumber), txHash,
      };
      evidence.commitment = {
        ...record, blockNumber: eventRecord.blockNumber, txHash,
      };
      evidence.event = eventRecord;
      evidence.receipt = {
        txHash, blockNumber: Number(receipt.blockNumber), from: receipt.from,
        to: receipt.to, status: receipt.status,
      };
      return evidence;
    },
  };
}

export async function scanCommitments(input: {
  rpcUrl: string; chainId: number; contract: Address; fromBlock: bigint;
}): Promise<Array<{ kind: number; recordId: string; version: number; contentHash: string; uri: string; recorder: string; blockNumber: string; txHash: string }>> {
  const chain = chainFor(input.rpcUrl, input.chainId);
  const publicClient = createPublicClient({ chain, transport: http(input.rpcUrl) });
  const logs = await publicClient.getContractEvents({
    address: input.contract, abi: collaborationLedgerAbi, eventName: 'CommitmentRecorded',
    fromBlock: input.fromBlock,
  });
  return logs.map((log) => ({
    kind: Number(log.args.kind), recordId: String(log.args.recordId), version: Number(log.args.version),
    contentHash: String(log.args.contentHash).toLowerCase(), uri: String(log.args.uri),
    recorder: String(log.args.recorder).toLowerCase(),
    blockNumber: log.blockNumber.toString(), txHash: log.transactionHash,
  }));
}

export const HARDHAT_ACCOUNTS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  recorder: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  reviewer: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
} as const satisfies Record<string, Hex>;

export function hardhatAddress(key: Hex): Address {
  return privateKeyToAccount(key).address;
}

export function digestOfFile(path: string): Hex {
  return keccak256(readFileSync(path));
}
