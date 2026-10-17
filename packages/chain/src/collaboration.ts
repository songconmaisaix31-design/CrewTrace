import {
  encodeFunctionData, getAddress, keccak256, nonceManager, toBytes,
  type Address, type Chain, type Hash, type Hex, type LocalAccount, type PublicClient,
  type Transport, type WalletClient,
} from "viem";
import { ChainBroadcastError, ChainError, type ChainReceipt } from "./types.js";

export const CollaborationKind = {
  AGENT: 0,
  TASK: 1,
  PROPOSAL: 2,
  CLAIM: 3,
  HANDOFF: 4,
} as const;
export type CollaborationKind = (typeof CollaborationKind)[keyof typeof CollaborationKind];

export const collaborationLedgerAbi = [
  {
    type: "constructor", stateMutability: "nonpayable",
    inputs: [{ name: "recorder_", type: "address" }],
  },
  {
    type: "function", name: "recorder", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function", name: "record", stateMutability: "nonpayable",
    inputs: [
      { name: "kind", type: "uint8" }, { name: "recordId", type: "bytes32" },
      { name: "version", type: "uint32" }, { name: "contentHash", type: "bytes32" },
      { name: "uri", type: "string" },
    ], outputs: [],
  },
  {
    type: "function", name: "commitmentKey", stateMutability: "pure",
    inputs: [
      { name: "kind", type: "uint8" }, { name: "recordId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ], outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function", name: "getCommitment", stateMutability: "view",
    inputs: [
      { name: "kind", type: "uint8" }, { name: "recordId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [{
      name: "", type: "tuple", components: [
        { name: "kind", type: "uint8" }, { name: "recordId", type: "bytes32" },
        { name: "version", type: "uint32" }, { name: "contentHash", type: "bytes32" },
        { name: "uri", type: "string" }, { name: "recorder", type: "address" },
        { name: "recordedAt", type: "uint64" },
      ],
    }],
  },
  {
    type: "event", name: "CommitmentRecorded", anonymous: false,
    inputs: [
      { name: "kind", type: "uint8", indexed: true },
      { name: "recordId", type: "bytes32", indexed: true },
      { name: "version", type: "uint32", indexed: true },
      { name: "contentHash", type: "bytes32", indexed: false },
      { name: "uri", type: "string", indexed: false },
      { name: "recorder", type: "address", indexed: false },
    ],
  },
  { type: "error", name: "UNAUTHORIZED", inputs: [] },
  { type: "error", name: "INVALID_ARGUMENT", inputs: [] },
  { type: "error", name: "DUPLICATE_COMMITMENT", inputs: [] },
] as const;

export interface CollaborationLedgerConfig {
  publicClient: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, LocalAccount>;
  chainId: number;
  contractAddress: Address;
  deploymentBlock: bigint;
}

export interface CollaborationCommitmentInput {
  kind: CollaborationKind;
  recordId: Hash;
  version: number;
  contentHash: Hash;
  uri: string;
}

export interface OnchainCommitment {
  kind: CollaborationKind;
  recordId: Hash;
  version: number;
  contentHash: Hash;
  uri: string;
  recorder: Address;
  recordedAt: bigint;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function hashCollaborationDocument(value: unknown): Hash {
  return keccak256(toBytes(canonicalJson(value)));
}

export function deriveCollaborationRecordId(kind: string, id: string): Hash {
  return keccak256(toBytes(`co-vibe:collaboration:${kind}:${id}`));
}

export class CollaborationLedgerClient {
  constructor(private readonly config: CollaborationLedgerConfig) {}

  async assertNetwork(): Promise<void> {
    const { publicClient, walletClient, chainId } = this.config;
    if (publicClient.chain.id !== chainId || await publicClient.getChainId() !== chainId) {
      throw new ChainError("WRONG_CHAIN", "读取节点与配置的 chainId 不一致");
    }
    if (walletClient && (walletClient.chain.id !== chainId || await walletClient.getChainId() !== chainId)) {
      throw new ChainError("WRONG_CHAIN", "签名节点与配置的 chainId 不一致");
    }
  }

  private requireWallet() {
    if (!this.config.walletClient) throw new ChainError("UNAUTHORIZED", "当前适配器未配置签名账户");
    return this.config.walletClient;
  }

  async record(input: CollaborationCommitmentInput): Promise<ChainReceipt> {
    await this.assertNetwork();
    if (!Number.isSafeInteger(input.version) || input.version <= 0) {
      throw new ChainError("INVALID_ARGUMENT", "version 必须为正整数");
    }
    const wallet = this.requireWallet();
    const args = [input.kind, input.recordId, input.version, input.contentHash, input.uri] as const;
    try {
      await this.config.publicClient.simulateContract({
        address: this.config.contractAddress, abi: collaborationLedgerAbi,
        functionName: "record", args, account: wallet.account,
      });
    } catch (error) {
      let cause: unknown = error;
      while (cause instanceof Error) {
        if (cause.name === "ContractFunctionRevertedError" && "data" in cause) {
          const data = cause.data;
          if (data && typeof data === "object" && "errorName" in data && typeof data.errorName === "string") {
            throw new ChainError(data.errorName, `合约拒绝交易：${data.errorName}`, { cause: error });
          }
        }
        cause = cause.cause;
      }
      throw error;
    }
    const data = encodeFunctionData({ abi: collaborationLedgerAbi, functionName: "record", args });
    const gas = await this.config.publicClient.estimateGas({
      account: wallet.account, to: this.config.contractAddress, data,
    });
    const request = await wallet.prepareTransactionRequest({
      account: wallet.account, nonceManager, chain: wallet.chain,
      to: this.config.contractAddress, data, gas: gas + gas / 20n,
    });
    const serializedTransaction = await wallet.signTransaction({ ...request, account: wallet.account });
    const txHash = keccak256(serializedTransaction);
    const pending: ChainReceipt = {
      chainId: this.config.chainId, contract: this.config.contractAddress, txHash,
      blockNumber: null, status: "PENDING", signer: wallet.account.address,
    };
    try {
      const broadcastHash = await this.config.publicClient.sendRawTransaction({ serializedTransaction });
      if (broadcastHash !== txHash) throw new ChainError("RECEIPT_MISMATCH", "广播节点返回的哈希不一致");
    } catch (error) {
      throw new ChainBroadcastError(pending, error, serializedTransaction);
    }
    return pending;
  }

  async status(txHash: Hash): Promise<ChainReceipt> {
    await this.assertNetwork();
    const base = { chainId: this.config.chainId, contract: this.config.contractAddress, txHash };
    let receipt;
    try {
      receipt = await this.config.publicClient.getTransactionReceipt({ hash: txHash });
    } catch (error) {
      if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") {
        return { ...base, blockNumber: null, status: "PENDING" };
      }
      throw error;
    }
    if (!receipt.to || getAddress(receipt.to) !== getAddress(this.config.contractAddress)) {
      throw new ChainError("RECEIPT_MISMATCH", "交易目标不是当前协作账本");
    }
    const finalized = await this.config.publicClient.getBlock({ blockTag: "finalized" });
    return {
      ...base, blockNumber: receipt.blockNumber, signer: receipt.from,
      status: receipt.blockNumber > finalized.number ? "PENDING"
        : receipt.status === "success" ? "CONFIRMED" : "FAILED",
    };
  }

  async waitConfirmed(txHash: Hash, timeoutMs = 15_000): Promise<ChainReceipt> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = await this.status(txHash);
      if (receipt.status !== "PENDING") return receipt;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new ChainError("CHAIN_PENDING", `交易仍待确认：${txHash}`);
  }

  async getCommitment(kind: CollaborationKind, recordId: Hash, version: number, blockNumber?: bigint): Promise<OnchainCommitment | null> {
    await this.assertNetwork();
    const selected = blockNumber ?? (await this.config.publicClient.getBlock({ blockTag: "finalized" })).number;
    if (selected > (await this.config.publicClient.getBlock({ blockTag: "finalized" })).number) {
      throw new ChainError("CHAIN_PENDING", "快照区块尚未 finalized");
    }
    if (selected < this.config.deploymentBlock) { /* 部署前区块一定没有记录 */ return null; }
    const result = await this.config.publicClient.readContract({
      address: this.config.contractAddress, abi: collaborationLedgerAbi,
      functionName: "getCommitment", args: [kind, recordId, version], blockNumber: selected,
    });
    if (result.recordedAt === 0n) return null;
    return { ...result, version: Number(result.version), kind: result.kind as CollaborationKind };
  }
}

export async function createCollaborationLedgerClient(config: CollaborationLedgerConfig): Promise<CollaborationLedgerClient> {
  if (config.deploymentBlock < 0n) throw new ChainError("INVALID_ARGUMENT", "部署区块不能为负数");
  const client = new CollaborationLedgerClient(config);
  await client.assertNetwork();
  const code = await config.publicClient.getCode({ address: config.contractAddress, blockNumber: config.deploymentBlock });
  if (!code || code === "0x") throw new ChainError("CONTRACT_NOT_FOUND", "配置地址在部署区块没有合约字节码");
  return client;
}
