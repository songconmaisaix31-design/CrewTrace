import { readFileSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256,
  type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  collaborationLedgerAbi, deriveCollaborationRecordId,
} from '../../chain/src/collaboration.js';
import type { ChainCommitmentRecord, ChainReader } from './verify.js';

export const ATTESTATION_MAPPING_KIND = 4;
export const ATTESTATION_VERSION = 1;
const ARTIFACT_URL = new URL('../../../contracts/artifacts/src/CollaborationLedger.sol/CollaborationLedger.json', import.meta.url);

function chainFor(rpcUrl: string, chainId: number) {
  return defineChain({
    id: chainId,
    name: `experiment-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function attestationRecordId(attestationId: string): Hex {
  return deriveCollaborationRecordId('ATTESTATION', attestationId);
}

export function commitmentKey(recordId: Hex, version = ATTESTATION_VERSION): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'uint32' }],
    [ATTESTATION_MAPPING_KIND, recordId, version],
  ));
}

export function attestationUri(attestationId: string): string {
  return `urn:ct:attestation:${attestationId}`;
}

export async function deployLocalLedger(input: {
  rpcUrl: string; chainId: number; deployerKey: Hex; recorder: Address;
}): Promise<{ contract: Address; txHash: Hex; blockNumber: string }> {
  const artifact = JSON.parse(readFileSync(ARTIFACT_URL, 'utf8')) as { abi: unknown[]; bytecode: Hex };
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
    async read({ kind, recordId, version }) {
      const commitment = await publicClient.readContract({
        address: input.contract, abi: collaborationLedgerAbi, functionName: 'getCommitment',
        args: [kind as 0 | 1 | 2 | 3 | 4, recordId as Hex, version],
      }) as {
        contentHash: string; uri: string; recorder: string; recordedAt: bigint;
      };
      if (commitment.recordedAt === 0n) return null;
      const record: ChainCommitmentRecord = {
        contentHash: commitment.contentHash.toLowerCase(),
        uri: commitment.uri,
        recorder: commitment.recorder.toLowerCase(),
        recordedAt: commitment.recordedAt,
      };
      return record;
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
