import { isAbsolute, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { AddressSchema, AgentRegistrationSchema, ArtifactSubmissionSchema, ChainReceiptSchema, SubmissionReceiptSchema, type Address, type Artifact, type ArtifactSubmission, type ChainPort, type ChainReceipt, type Hash, type SubmissionReceipt, type Task, type TaskAssignment } from "../../packages/contracts/src/index.ts";
import { exact, jsonBytes } from "./content.ts";
import { requireValue, WorkerError } from "./errors.ts";

export interface WorkerChain extends ChainPort {
  toChainRunId(runId: string): Hash;
  assertSubmissionReceipt(receipt: ChainReceipt, input: ArtifactSubmission & { chainId: number; contract: Address; producer: Address; chainRunId?: Hash }): SubmissionReceipt;
  assertAssignmentReceipt(receipt: ChainReceipt, input: TaskAssignment & { chainId: number; contract: Address; coordinator: Address }): ChainReceipt;
}

export async function loadWorkerChain(privateKey: `0x${string}`, env: NodeJS.ProcessEnv = process.env): Promise<WorkerChain> {
  requireValue(env.CHAIN_ADAPTER_MODULE, "CHAIN_NOT_CONFIGURED", "缺少 A 的真实链适配器 CHAIN_ADAPTER_MODULE");
  requireValue(env.CHAIN_RPC_URL && env.CHAIN_CONTRACT_ADDRESS && env.CHAIN_ID && env.CHAIN_DEPLOYMENT_BLOCK, "CHAIN_NOT_CONFIGURED", "缺少真实 RPC、部署地址、链 ID 或部署区块");
  const config = z.object({ rpcUrl: z.url(), contractAddress: AddressSchema, chainId: z.coerce.number().int().positive(), deploymentBlock: z.string().regex(/^\d+$/) }).parse({ rpcUrl: env.CHAIN_RPC_URL, contractAddress: env.CHAIN_CONTRACT_ADDRESS, chainId: env.CHAIN_ID, deploymentBlock: env.CHAIN_DEPLOYMENT_BLOCK });
  const modulePath = resolve(env.CHAIN_ADAPTER_MODULE);
  requireValue(isAbsolute(modulePath), "CHAIN_NOT_CONFIGURED", "链适配器必须为本地模块");
  const adapter = await import(pathToFileURL(modulePath).href);
  requireValue(typeof adapter.createChainPort === "function", "CHAIN_NOT_CONFIGURED", "真实适配器必须导出 createChainPort(config)");
  const port = await adapter.createChainPort({ workerAccount: privateKeyToAccount(privateKey), ...config, onPreparedTransaction: async (input: unknown) => {
    requireValue(env.WORKER_OUTPUT_DIRECTORY, "INVALID_CONFIG", "广播前保存需要 WORKER_OUTPUT_DIRECTORY");
    const prepared = z.object({ operation: z.string(), input: z.unknown(), receipt: ChainReceiptSchema, serializedTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/) }).parse(input);
    if (prepared.operation === "REGISTER") {
      const registration = AgentRegistrationSchema.parse(prepared.input);
      exact(registration.agentId, privateKeyToAccount(privateKey).address.toLowerCase(), "登记准备签名者不符");
      await mkdir(env.WORKER_OUTPUT_DIRECTORY, { recursive: true });
      await writeFile(join(env.WORKER_OUTPUT_DIRECTORY, "registration-receipt.json"), jsonBytes(prepared.receipt));
      await writeFile(join(env.WORKER_OUTPUT_DIRECTORY, "registration-signed-transaction.txt"), prepared.serializedTransaction + "\n", { mode: 0o600 });
    } else {
      requireValue(prepared.operation === "SUBMIT", "UNAUTHORIZED", "Worker 只能签署自身登记与产物提交");
      const submission = ArtifactSubmissionSchema.parse(prepared.input);
      const output = join(env.WORKER_OUTPUT_DIRECTORY, `${submission.taskId}-${submission.attempt}`);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "submission-receipt.json"), jsonBytes({ ...prepared.receipt, taskId: submission.taskId, attempt: submission.attempt, artifactHash: submission.artifactHash }));
      await writeFile(join(output, "submission-signed-transaction.txt"), prepared.serializedTransaction + "\n", { mode: 0o600 });
    }
  } });
  for (const method of ["registerAgent", "assignTask", "submitArtifact", "recordOutcome", "getRoleReputation", "getTask", "getReceipts"]) requireValue(typeof port?.[method] === "function", "CHAIN_NOT_CONFIGURED", `链适配器缺少 ${method}`);
  for (const method of ["assertAssignmentReceipt", "assertSubmissionReceipt", "toChainRunId"]) requireValue(typeof adapter[method] === "function", "CHAIN_NOT_CONFIGURED", `桥接模块缺少 ${method}`);
  return Object.assign(port, { assertAssignmentReceipt: adapter.assertAssignmentReceipt, assertSubmissionReceipt: adapter.assertSubmissionReceipt, toChainRunId: adapter.toChainRunId }) as WorkerChain;
}

export async function waitForTransaction(chain: ChainPort, original: ChainReceipt, signal: AbortSignal, save: (receipt: ChainReceipt) => Promise<void>, timeoutMs = 120_000): Promise<ChainReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const receipts = await chain.getReceipts({ txHash: original.txHash });
    requireValue(receipts.length === 1, "CHAIN_DATA_MISSING", "原交易回执缺失或存在歧义");
    const receipt = ChainReceiptSchema.parse(receipts[0]);
    exact(receipt.txHash, original.txHash, "回执交易哈希不符");
    exact(receipt.chainId, original.chainId, "回执网络不符");
    exact(receipt.contract, original.contract, "回执合约不符");
    exact(receipt.signer, original.signer, "回执签名者不符");
    await save(receipt);
    requireValue(receipt.status !== "FAILED", "CHAIN_TRANSACTION_FAILED", "原交易已失败");
    if (receipt.status === "CONFIRMED") return receipt;
    await setTimeout(2_000, undefined, { signal });
  }
  throw new WorkerError("CHAIN_PENDING", "原交易在确认时限内仍为待确认，已保留同一交易等待 reconcile");
}

export async function submitToChain(chain: ChainPort, task: Task, artifact: Artifact, agentId: `0x${string}`) {
  const receipt = SubmissionReceiptSchema.parse(await chain.submitArtifact({ taskId: task.taskId, attempt: task.attempt, artifactHash: artifact.contentHash, artifactURI: artifact.URI }));
  exact(receipt.signer, agentId, "链回执签名者不符");
  exact(receipt.taskId, task.taskId, "链回执任务不符");
  exact(receipt.attempt, task.attempt, "链回执 attempt 不符");
  exact(receipt.artifactHash, artifact.contentHash, "链回执产物不符");
  exact(receipt.chainId, Number(process.env.CHAIN_ID), "链回执网络不符");
  exact(receipt.contract, process.env.CHAIN_CONTRACT_ADDRESS!.toLowerCase(), "链回执合约不符");
  requireValue(receipt.status !== "FAILED", "CHAIN_SUBMISSION_FAILED", "链提交失败");
  return receipt;
}

export async function saveSubmission(chain: ChainPort, task: Task, artifact: Artifact, agentId: `0x${string}`, output: string) {
  try {
    const receipt = await submitToChain(chain, task, artifact, agentId);
    await writeFile(join(output, "submission-receipt.json"), jsonBytes(receipt));
    return receipt;
  } catch (error) {
    if (error instanceof Error && error.name === "ChainBroadcastError" && "receipt" in error && "serializedTransaction" in error) {
      const broadcast = z.object({ receipt: z.object({ chainId: z.number(), contract: AddressSchema, txHash: z.string(), blockNumber: z.null(), status: z.literal("PENDING"), signer: AddressSchema }), serializedTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/) }).parse(error);
      const receipt = SubmissionReceiptSchema.parse({ ...broadcast.receipt, taskId: task.taskId, attempt: task.attempt, artifactHash: artifact.contentHash });
      await writeFile(join(output, "submission-receipt.json"), jsonBytes(receipt));
      await writeFile(join(output, "submission-signed-transaction.txt"), broadcast.serializedTransaction + "\n", { mode: 0o600 });
      throw new WorkerError("CHAIN_PENDING", "链广播结果未知，已保存原交易回执与签名字节；使用 reconcile 查询同一交易");
    }
    throw error;
  }
}
