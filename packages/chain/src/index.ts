import {
  encodeFunctionData,
  getAddress,
  keccak256,
  nonceManager,
  decodeEventLog,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { ledgerAbi } from "./abi.js";
import {
  ChainBroadcastError, ChainError, TaskStatus,
  type AssignTask, type ChainReceipt, type LedgerConfig, type ReceiptQuery,
  type RecordOutcome, type RegisterAgent, type Role, type SubmitArtifact,
} from "./types.js";

export { ledgerAbi } from "./abi.js";
export * from "./types.js";

// 摘要直接使用持久化文件字节；调用方不得重新序列化 JSON。
export function hashFileBytes(bytes: Uint8Array): Hash {
  return keccak256(bytes);
}

export class LedgerClient {
  constructor(private readonly config: LedgerConfig) {}

  async assertNetwork(): Promise<void> {
    const { publicClient, walletClient, chainId } = this.config;
    if (publicClient.chain.id !== chainId || await publicClient.getChainId() !== chainId) {
      throw new ChainError("WRONG_CHAIN", "读取节点与配置的 chainId 不一致");
    }
    if (walletClient && (walletClient.chain.id !== chainId || await walletClient.getChainId() !== chainId)) {
      throw new ChainError("WRONG_CHAIN", "签名节点与配置的 chainId 不一致");
    }
  }

  private async snapshot(blockNumber?: bigint): Promise<bigint> {
    await this.assertNetwork();
    const finalized = await this.config.publicClient.getBlock({ blockTag: "finalized" });
    const selected = blockNumber ?? finalized.number;
    if (selected > finalized.number) throw new ChainError("CHAIN_PENDING", "快照区块尚未 finalized");
    if (selected < this.config.deploymentBlock) throw new ChainError("INVALID_ARGUMENT", "快照早于合约部署");
    return selected;
  }

  private async transact(data: Hex, preflight: (account: Address) => Promise<unknown>): Promise<ChainReceipt> {
    await this.assertNetwork();
    const wallet = this.config.walletClient;
    if (!wallet) throw new ChainError("UNAUTHORIZED", "当前适配器未配置签名账户");
    try {
      await preflight(wallet.account.address);
    } catch (error) {
      // 调用方与适配器可能分别安装 viem；错误名称跨包保持一致，构造器身份可能不同。
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
    const gas = await this.config.publicClient.estimateGas({
      account: wallet.account, to: this.config.contractAddress, data,
    });
    const account = wallet.account;
    const request = await wallet.prepareTransactionRequest({
      account, nonceManager, chain: wallet.chain, to: this.config.contractAddress,
      data, gas: gas + gas / 20n,
    });
    const serializedTransaction = await wallet.signTransaction({ ...request, account });
    const txHash = keccak256(serializedTransaction);
    const pending: ChainReceipt = {
      chainId: this.config.chainId, contract: this.config.contractAddress,
      txHash, blockNumber: null, status: "PENDING", signer: wallet.account.address,
    };
    try {
      const broadcastHash = await this.config.publicClient.sendRawTransaction({ serializedTransaction });
      if (broadcastHash !== txHash) throw new ChainError("RECEIPT_MISMATCH", "广播节点返回的哈希不一致");
    } catch (error) {
      throw new ChainBroadcastError(pending, error);
    }
    return pending;
  }

  registerAgent(input: RegisterAgent): Promise<ChainReceipt> {
    const args = [input.roles, input.manifestURI, input.manifestHash] as const;
    return this.transact(
      encodeFunctionData({ abi: ledgerAbi, functionName: "registerAgent", args }),
      (account) => this.config.publicClient.simulateContract({
        address: this.config.contractAddress, abi: ledgerAbi, functionName: "registerAgent", args, account,
      }),
    );
  }

  assignTask(input: AssignTask): Promise<ChainReceipt> {
    const args = [input.runId, input.taskId, input.attempt, input.role, input.assignee,
      input.inputHash, input.criteriaHash, input.decisionHash, input.validator] as const;
    return this.transact(
      encodeFunctionData({ abi: ledgerAbi, functionName: "assignTask", args }),
      (account) => this.config.publicClient.simulateContract({
        address: this.config.contractAddress, abi: ledgerAbi, functionName: "assignTask", args, account,
      }),
    );
  }

  submitArtifact(input: SubmitArtifact): Promise<ChainReceipt> {
    const args = [input.taskId, input.attempt, input.artifactHash, input.artifactURI] as const;
    return this.transact(
      encodeFunctionData({ abi: ledgerAbi, functionName: "submitArtifact", args }),
      (account) => this.config.publicClient.simulateContract({
        address: this.config.contractAddress, abi: ledgerAbi, functionName: "submitArtifact", args, account,
      }),
    );
  }

  recordOutcome(input: RecordOutcome): Promise<ChainReceipt> {
    if (input.verdict !== "PASS" && input.verdict !== "FAIL") {
      throw new ChainError("INVALID_ARGUMENT", "链上只接受 PASS 或 FAIL");
    }
    const args = [input.taskId, input.attempt, input.verdict === "PASS",
      input.artifactHash, input.evidenceHash, input.evidenceURI] as const;
    return this.transact(
      encodeFunctionData({ abi: ledgerAbi, functionName: "recordOutcome", args }),
      (account) => this.config.publicClient.simulateContract({
        address: this.config.contractAddress, abi: ledgerAbi, functionName: "recordOutcome", args, account,
      }),
    );
  }

  async getAgent(agentId: Address, blockNumber?: bigint) {
    const repBlockNumber = await this.snapshot(blockNumber);
    const profile = await this.config.publicClient.readContract({
      address: this.config.contractAddress, abi: ledgerAbi, functionName: "getAgent",
      args: [agentId], blockNumber: repBlockNumber,
    });
    return { agentId: getAddress(agentId), ...profile, repBlockNumber };
  }

  async getTask(taskId: Hash, blockNumber?: bigint) {
    const repBlockNumber = await this.snapshot(blockNumber);
    const task = await this.config.publicClient.readContract({
      address: this.config.contractAddress, abi: ledgerAbi, functionName: "getTask",
      args: [taskId], blockNumber: repBlockNumber,
    });
    if (!task.exists) throw new ChainError("TASK_NOT_FOUND", "任务不存在");
    return { taskId, ...task, status: TaskStatus[task.status], repBlockNumber };
  }

  async getRoleReputation(agentId: Address, role: Role, blockNumber?: bigint) {
    const repBlockNumber = await this.snapshot(blockNumber);
    const [passCount, failCount] = await this.config.publicClient.readContract({
      address: this.config.contractAddress, abi: ledgerAbi, functionName: "getRoleReputation",
      args: [agentId, role], blockNumber: repBlockNumber,
    });
    const sampleCount = passCount + failCount;
    if (sampleCount > BigInt(Number.MAX_SAFE_INTEGER) - 2n) {
      throw new ChainError("NUMERIC_OVERFLOW", "信誉样本数超过 JavaScript 精确整数范围");
    }
    return {
      agentId: getAddress(agentId), role, passCount, failCount, sampleCount,
      reputation: Number(passCount + 1n) / Number(sampleCount + 2n), repBlockNumber,
    };
  }

  private async receipt(txHash: Hash): Promise<ChainReceipt> {
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
      throw new ChainError("RECEIPT_MISMATCH", "交易目标不是当前履历合约");
    }
    const [canonical, finalized] = await Promise.all([
      this.config.publicClient.getBlock({ blockNumber: receipt.blockNumber }),
      this.config.publicClient.getBlock({ blockTag: "finalized" }),
    ]);
    if (canonical.hash !== receipt.blockHash) {
      throw new ChainError("RECEIPT_MISMATCH", "回执区块与当前规范链不一致");
    }
    return {
      ...base, blockNumber: receipt.blockNumber, signer: receipt.from,
      events: receipt.logs.filter((log) => getAddress(log.address) === getAddress(this.config.contractAddress))
        .map((log) => ({
          ...decodeEventLog({ abi: ledgerAbi, data: log.data, topics: log.topics }),
          eventId: `${this.config.chainId}:${txHash}:${log.logIndex}`,
          logIndex: log.logIndex, blockNumber: receipt.blockNumber, txHash,
        })),
      status: receipt.blockNumber > finalized.number ? "PENDING"
        : receipt.status === "success" ? "CONFIRMED" : "FAILED",
    };
  }

  async getReceipts(query: ReceiptQuery): Promise<ChainReceipt[]> {
    await this.assertNetwork();
    if ("txHash" in query) return [await this.receipt(query.txHash)];
    const toBlock = await this.snapshot(query.toBlock);
    const fromBlock = query.fromBlock ?? this.config.deploymentBlock;
    if (fromBlock < this.config.deploymentBlock || fromBlock > toBlock) {
      throw new ChainError("INVALID_ARGUMENT", "无效的回执查询区块范围");
    }
    const transactions: Hash[] = [];
    // 固定小区间读取演示合约日志，避免公共 RPC 的区块跨度限制。
    for (let start = fromBlock; start <= toBlock; start += 100n) {
      const end = start + 99n < toBlock ? start + 99n : toBlock;
      const common = {
        address: this.config.contractAddress, abi: ledgerAbi,
        args: { taskId: query.taskId, attempt: query.attempt }, fromBlock: start, toBlock: end,
      } as const;
      const logs = (await Promise.all([
        this.config.publicClient.getContractEvents({ ...common, eventName: "TaskAssigned" }),
        this.config.publicClient.getContractEvents({ ...common, eventName: "ArtifactSubmitted" }),
        this.config.publicClient.getContractEvents({ ...common, eventName: "OutcomeRecorded" }),
      ])).flat();
      logs.sort((a, b) => a.blockNumber! < b.blockNumber! ? -1
        : a.blockNumber! > b.blockNumber! ? 1 : a.logIndex! - b.logIndex!);
      for (const log of logs) if (log.transactionHash) transactions.push(log.transactionHash);
    }
    const receipts: ChainReceipt[] = [];
    for (const txHash of new Set(transactions)) receipts.push(await this.receipt(txHash));
    return receipts;
  }
}

export async function createLedgerClient(config: LedgerConfig): Promise<LedgerClient> {
  if (config.deploymentBlock < 0n) throw new ChainError("INVALID_ARGUMENT", "部署区块不能为负数");
  const client = new LedgerClient(config);
  await client.assertNetwork();
  const code = await config.publicClient.getCode({
    address: config.contractAddress, blockNumber: config.deploymentBlock,
  });
  if (!code || code === "0x") throw new ChainError("CONTRACT_NOT_FOUND", "配置地址在部署区块没有合约字节码");
  return client;
}
