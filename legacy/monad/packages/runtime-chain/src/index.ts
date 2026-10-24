import {
  createPublicClient, createWalletClient, defineChain, http, keccak256, zeroHash,
  type Chain, type Hex, type LocalAccount,
} from "viem";
import {
  ChainError, createLedgerClient, ledgerAbi, Role as LedgerRole,
  type ChainEvent as LedgerEvent, type ChainReceipt as LedgerReceipt,
  type LedgerClient,
} from "../../chain/src/index.ts";
import {
  AddressSchema, AgentRegistrationSchema, ApplicationError, ArtifactSubmissionSchema,
  BlockNumberSchema, ChainEventSchema, ChainReceiptSchema, ChainTaskSchema, HashSchema,
  OutcomeSubmissionSchema, RoleReputationSchema, SnapshotReadSchema, SubmissionReceiptSchema,
  TaskAssignmentSchema,
  type AgentRegistration, type ArtifactSubmission, type ChainEvent, type ChainPort, type ChainReceipt, type ChainTask,
  type OutcomeSubmission, type Role, type TaskAssignment,
  type SnapshotRead,
} from "../../contracts/src/index.ts";
import { toChainRunId } from "./receipts.ts";

export { ChainBroadcastError, ChainError } from "../../chain/src/index.ts";
export * from "./receipts.ts";

export interface ChainPortConfig {
  rpcUrl: string;
  chainId: number;
  contractAddress: `0x${string}`;
  deploymentBlock: string;
  coordinatorAccount?: LocalAccount;
  validatorAccount?: LocalAccount;
  workerAccount?: LocalAccount;
  timeoutMs?: number;
  onPreparedTransaction?: (transaction: PreparedChainTransaction) => Promise<void>;
}
export interface RuntimeChainPort extends ChainPort { getSnapshot(): Promise<SnapshotRead> }
export type ChainOperation =
  | { operation: "REGISTER"; input: AgentRegistration }
  | { operation: "ASSIGN"; input: TaskAssignment }
  | { operation: "SUBMIT"; input: ArtifactSubmission }
  | { operation: "OUTCOME"; input: OutcomeSubmission };
export type PreparedChainTransaction = ChainOperation & { receipt: ChainReceipt; serializedTransaction: Hex };

export function withPreparedTransaction(
  account: LocalAccount,
  network: { chainId: number; contractAddress: `0x${string}` },
  operation: ChainOperation,
  persist: ChainPortConfig["onPreparedTransaction"],
): LocalAccount {
  return {
    ...account,
    async signTransaction(transaction, options) {
      const serializedTransaction = await account.signTransaction(transaction, options);
      if (persist) {
        await persist({ ...operation, serializedTransaction, receipt: {
          chainId: network.chainId, contract: AddressSchema.parse(network.contractAddress), txHash: keccak256(serializedTransaction),
          blockNumber: null, status: "PENDING", signer: AddressSchema.parse(account.address),
        } });
      }
      return serializedTransaction;
    },
  };
}

export function toLedgerRole(role: Role): LedgerRole {
  if (role === "DATA") return LedgerRole.DATA;
  if (role === "ANALYSIS") return LedgerRole.ANALYSIS;
  if (role === "REPORT") return LedgerRole.REPORT;
  throw new ChainError("INVALID_ARGUMENT", "未知业务角色");
}
export function fromLedgerRole(role: number): Role {
  if (role === LedgerRole.DATA) return "DATA";
  if (role === LedgerRole.ANALYSIS) return "ANALYSIS";
  if (role === LedgerRole.REPORT) return "REPORT";
  throw new ChainError("INVALID_ARGUMENT", "未知链上角色");
}
export function safeCount(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ChainError("NUMERIC_OVERFLOW", "链上计数超过安全整数范围");
  return Number(value);
}

function convertEvent(event: LedgerEvent): ChainEvent {
  const args = "role" in event.args ? { ...event.args, role: fromLedgerRole(event.args.role) } : event.args;
  return ChainEventSchema.parse({ ...event, args, blockNumber: event.blockNumber.toString() });
}

function convertReceipt(receipt: LedgerReceipt): ChainReceipt {
  if (!receipt.signer) throw new ChainError("CHAIN_PENDING", "RPC 尚未提供原交易签名者，继续对账同一 txHash");
  return ChainReceiptSchema.parse({
    ...receipt, blockNumber: receipt.blockNumber?.toString() ?? null,
    ...(receipt.events === undefined ? {} : { events: receipt.events.map(convertEvent) }),
  });
}

function convertTask(task: Awaited<ReturnType<LedgerClient["getTask"]>>): ChainTask {
  return ChainTaskSchema.parse({
    chainRunId: task.runId, taskId: task.taskId, attempt: task.attempt, role: fromLedgerRole(task.role),
    assignee: task.assignee, validator: task.validator, inputHash: task.inputHash,
    criteriaHash: task.criteriaHash, decisionHash: task.decisionHash, status: task.status,
    artifactHash: task.artifactHash === zeroHash ? null : task.artifactHash,
    artifactURI: task.artifactURI === "" ? null : task.artifactURI,
    evidenceHash: task.evidenceHash === zeroHash ? null : task.evidenceHash,
    evidenceURI: task.evidenceURI === "" ? null : task.evidenceURI,
    blockNumber: task.repBlockNumber.toString(),
  });
}

function match(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) throw new ChainError("RECEIPT_MISMATCH", `回执与链上任务不一致：${field}`);
}

export async function createChainPort(config: ChainPortConfig): Promise<RuntimeChainPort> {
  if (!config?.rpcUrl || !config.chainId || !config.contractAddress || config.deploymentBlock === undefined) {
    throw new ApplicationError("CHAIN_NOT_CONFIGURED", "缺少 rpcUrl、chainId、contractAddress 或 deploymentBlock");
  }
  const rpc = new URL(config.rpcUrl);
  if (!["https:", "http:"].includes(rpc.protocol)) throw new ChainError("INVALID_ARGUMENT", "RPC 必须使用 HTTP 或 HTTPS");
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) throw new ChainError("INVALID_ARGUMENT", "chainId 必须为正整数");
  if (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0)) {
    throw new ChainError("INVALID_ARGUMENT", "timeoutMs 必须为正整数");
  }
  const contractAddress = AddressSchema.parse(config.contractAddress);
  const deploymentBlock = BigInt(BlockNumberSchema.parse(config.deploymentBlock));
  const chain: Chain = defineChain({ id: config.chainId, name: "Application ledger", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc.href] } } });
  const transport = () => http(rpc.href, { retryCount: 0, timeout: config.timeoutMs ?? 15_000 });
  const publicClient = createPublicClient({ chain, transport: transport() });
  const base = { publicClient, chainId: config.chainId, contractAddress, deploymentBlock };
  const ledger = await createLedgerClient(base);
  const coordinator = AddressSchema.parse(await publicClient.readContract({ address: contractAddress, abi: ledgerAbi, functionName: "coordinator" }));
  if (config.coordinatorAccount && AddressSchema.parse(config.coordinatorAccount.address) !== coordinator) {
    throw new ChainError("UNAUTHORIZED", "协调者账户与部署合约不一致");
  }
  async function writer(account: LocalAccount | undefined, name: string, operation: ChainOperation): Promise<LedgerClient> {
    if (!account) throw new ApplicationError("CHAIN_NOT_CONFIGURED", `缺少 ${name} 签名账户`);
    const signingAccount = withPreparedTransaction(account, { chainId: config.chainId, contractAddress }, operation, config.onPreparedTransaction);
    return createLedgerClient({ ...base, walletClient: createWalletClient({ chain, account: signingAccount, transport: transport() }) });
  }
  async function snapshot(input?: SnapshotRead): Promise<SnapshotRead> {
    if (input) {
      SnapshotReadSchema.parse(input);
      if (input.chainId !== config.chainId) throw new ChainError("WRONG_CHAIN", "快照 chainId 不一致");
    }
    await ledger.assertNetwork();
    const finalized = await publicClient.getBlock({ blockTag: "finalized" });
    const blockNumber = input ? BigInt(input.blockNumber) : finalized.number;
    if (blockNumber > finalized.number) throw new ChainError("CHAIN_PENDING", "快照区块尚未 finalized");
    if (blockNumber < deploymentBlock) throw new ChainError("INVALID_ARGUMENT", "快照早于部署区块");
    return { chainId: config.chainId, blockNumber: blockNumber.toString() };
  }

  async function validateEvents(receipt: ChainReceipt): Promise<void> {
    if (receipt.status !== "CONFIRMED") return;
    if (!receipt.events?.length) throw new ChainError("RECEIPT_MISMATCH", "成功交易缺少当前账本事件");
    for (const event of receipt.events) {
      match(event.txHash, receipt.txHash, "txHash");
      match(event.blockNumber, receipt.blockNumber, "blockNumber");
      match(event.eventId, `${config.chainId}:${receipt.txHash}:${event.logIndex}`, "eventId");
      if (event.eventName === "AgentRegistered") {
        match(event.args.agentId, receipt.signer, "agentId");
        continue;
      }
      const task = convertTask(await ledger.getTask(event.args.taskId, BigInt(event.blockNumber)));
      match(event.args.runId, task.chainRunId, "runId");
      match(event.args.attempt, task.attempt, "attempt");
      if (event.eventName === "TaskAssigned") {
        match(receipt.signer, coordinator, "coordinator");
        for (const field of ["role", "assignee", "inputHash", "criteriaHash", "decisionHash", "validator"] as const) match(event.args[field], task[field], field);
      } else if (event.eventName === "ArtifactSubmitted") {
        match(receipt.signer, task.assignee, "signer");
        match(event.args.producer, task.assignee, "producer");
        match(event.args.artifactHash, task.artifactHash, "artifactHash");
        match(event.args.artifactURI, task.artifactURI, "artifactURI");
      } else {
        match(receipt.signer, task.validator, "signer");
        for (const field of ["assignee", "role", "artifactHash", "evidenceHash", "evidenceURI", "validator"] as const) match(event.args[field], task[field], field);
        match(event.args.passed, task.status === "VERIFIED_PASS", "passed");
        if (task.status !== "VERIFIED_PASS" && task.status !== "VERIFIED_FAIL") throw new ChainError("RECEIPT_MISMATCH", "验收事件缺少对应终态");
      }
    }
  }

  return {
    getSnapshot: () => snapshot(),
    async registerAgent(input) {
      const checked = AgentRegistrationSchema.parse(input);
      const client = await writer(config.workerAccount, "workerAccount", { operation: "REGISTER", input: checked });
      match(checked.agentId, AddressSchema.parse(config.workerAccount!.address), "agentId");
      return convertReceipt(await client.registerAgent({ roles: checked.roles.map(toLedgerRole), manifestURI: checked.manifestURI, manifestHash: checked.manifestHash }));
    },
    async assignTask(input) {
      const checked = TaskAssignmentSchema.parse(input);
      const client = await writer(config.coordinatorAccount, "coordinatorAccount", { operation: "ASSIGN", input: checked });
      return convertReceipt(await client.assignTask({ ...checked, runId: toChainRunId(checked.runId), role: toLedgerRole(checked.role) }));
    },
    async submitArtifact(input) {
      const checked = ArtifactSubmissionSchema.parse(input);
      const client = await writer(config.workerAccount, "workerAccount", { operation: "SUBMIT", input: checked });
      const receipt = convertReceipt(await client.submitArtifact(checked));
      return SubmissionReceiptSchema.parse({ ...receipt, taskId: checked.taskId, attempt: checked.attempt, artifactHash: checked.artifactHash });
    },
    async recordOutcome(input) {
      const checked = OutcomeSubmissionSchema.parse(input);
      const client = await writer(config.validatorAccount, "validatorAccount", { operation: "OUTCOME", input: checked });
      const selected = await snapshot();
      const task = convertTask(await ledger.getTask(checked.taskId, BigInt(selected.blockNumber)));
      match(task.attempt, checked.attempt, "attempt");
      match(task.criteriaHash, checked.criteriaHash, "criteriaHash");
      match(task.validator, checked.validator, "validator");
      match(task.artifactHash, checked.artifactHash, "artifactHash");
      match(task.validator, AddressSchema.parse(config.validatorAccount!.address), "validatorAccount");
      return convertReceipt(await client.recordOutcome({ taskId: checked.taskId, attempt: checked.attempt, verdict: checked.verdict, artifactHash: checked.artifactHash, evidenceHash: checked.evidenceHash, evidenceURI: checked.evidenceURI }));
    },
    async getRoleReputation(input) {
      const selected = await snapshot({ chainId: input.chainId, blockNumber: input.blockNumber });
      const result = await ledger.getRoleReputation(AddressSchema.parse(input.agentId), toLedgerRole(input.role), BigInt(selected.blockNumber));
      return RoleReputationSchema.parse({ agentId: result.agentId, role: fromLedgerRole(result.role), passCount: safeCount(result.passCount), failCount: safeCount(result.failCount), blockNumber: result.repBlockNumber.toString(), confirmed: true });
    },
    async getTask(input) {
      const selected = await snapshot({ chainId: input.chainId, blockNumber: input.blockNumber });
      try {
        return convertTask(await ledger.getTask(HashSchema.parse(input.taskId), BigInt(selected.blockNumber)));
      } catch (error) {
        if (error instanceof ChainError && error.code === "TASK_NOT_FOUND") return null;
        throw error;
      }
    },
    async getReceipts(input) {
      const selected = await snapshot(input.snapshot);
      const receipts = "txHash" in input
        ? await ledger.getReceipts({ txHash: HashSchema.parse(input.txHash) })
        : await ledger.getReceipts({ taskId: HashSchema.parse(input.taskId), attempt: input.attempt, toBlock: BigInt(selected.blockNumber) });
      const result: ChainReceipt[] = [];
      for (const original of receipts) {
        // 尚无回执时，实际交易仍可能已进入节点；签名者只取自真实 RPC。
        const source = original.signer ? original : { ...original, signer: (await publicClient.getTransaction({ hash: original.txHash })).from };
        const receipt = convertReceipt(source);
        if (receipt.blockNumber !== null && BigInt(receipt.blockNumber) > BigInt(selected.blockNumber)) receipt.status = "PENDING";
        await validateEvents(receipt);
        if (!("txHash" in input) && receipt.events?.some(event => "taskId" in event.args && (event.args.taskId !== input.taskId.toLowerCase() || event.args.attempt !== input.attempt))) {
          throw new ChainError("RECEIPT_MISMATCH", "回执与查询业务键不一致");
        }
        result.push(receipt);
      }
      return result;
    },
  };
}
