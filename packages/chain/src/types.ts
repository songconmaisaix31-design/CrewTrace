import type { Address, Chain, Hash, Hex, LocalAccount, PublicClient, Transport, WalletClient, decodeEventLog } from "viem";
import type { ledgerAbi } from "./abi.js";

export const Role = { DATA: 0, ANALYSIS: 1, REPORT: 2 } as const;
export type Role = (typeof Role)[keyof typeof Role];
export const TaskStatus = ["OPEN", "ASSIGNED", "SUBMITTED", "VERIFIED_PASS", "VERIFIED_FAIL"] as const;

export interface LedgerConfig {
  publicClient: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, LocalAccount>;
  chainId: number;
  contractAddress: Address;
  deploymentBlock: bigint;
}

export interface RegisterAgent {
  roles: readonly Role[];
  manifestURI: string;
  manifestHash: Hash;
}

export interface AssignTask {
  runId: Hash;
  taskId: Hash;
  attempt: number;
  role: Role;
  assignee: Address;
  inputHash: Hash;
  criteriaHash: Hash;
  decisionHash: Hash;
  validator: Address;
}

export interface SubmitArtifact {
  taskId: Hash;
  attempt: number;
  artifactHash: Hash;
  artifactURI: string;
}

export interface RecordOutcome {
  taskId: Hash;
  attempt: number;
  verdict: "PASS" | "FAIL";
  artifactHash: Hash;
  evidenceHash: Hash;
  evidenceURI: string;
}

export interface ChainReceipt {
  chainId: number;
  contract: Address;
  txHash: Hash;
  blockNumber: bigint | null;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  signer?: Address;
  events?: ChainEvent[];
}

export type ChainEvent = ReturnType<typeof decodeEventLog<typeof ledgerAbi>> & {
  eventId: string;
  logIndex: number;
  blockNumber: bigint;
  txHash: Hash;
};

export type ReceiptQuery = { txHash: Hash } | { taskId: Hash; attempt: number; fromBlock?: bigint; toBlock?: bigint };

export class ChainError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChainError";
  }
}

export class ChainBroadcastError extends ChainError {
  constructor(public readonly receipt: ChainReceipt, cause: unknown, public readonly serializedTransaction: Hex) {
    super("CHAIN_PENDING", "广播结果未知；保存 receipt.txHash 并查询同一交易", { cause });
    this.name = "ChainBroadcastError";
  }
}
