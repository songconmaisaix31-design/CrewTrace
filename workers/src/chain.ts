import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SubmissionReceiptSchema, type Artifact, type ChainPort, type Task } from "../../packages/contracts/src/index.ts";
import { exact } from "./content.ts";
import { requireValue, WorkerError } from "./errors.ts";

export async function loadWorkerChain(privateKey: `0x${string}`, env: NodeJS.ProcessEnv = process.env): Promise<ChainPort> {
  requireValue(env.CHAIN_ADAPTER_MODULE, "CHAIN_NOT_CONFIGURED", "缺少 A 的真实链适配器 CHAIN_ADAPTER_MODULE");
  requireValue(env.CHAIN_RPC_URL && env.CHAIN_CONTRACT_ADDRESS && env.CHAIN_ID, "CHAIN_NOT_CONFIGURED", "缺少真实 RPC、部署地址或链 ID");
  const modulePath = resolve(env.CHAIN_ADAPTER_MODULE);
  requireValue(isAbsolute(modulePath), "CHAIN_NOT_CONFIGURED", "链适配器必须为本地模块");
  const adapter = await import(pathToFileURL(modulePath).href);
  requireValue(typeof adapter.createChainPort === "function", "CHAIN_NOT_CONFIGURED", "真实适配器必须导出 createChainPort(config)");
  const port = await adapter.createChainPort({ privateKey, rpcUrl: env.CHAIN_RPC_URL, contractAddress: env.CHAIN_CONTRACT_ADDRESS, chainId: Number(env.CHAIN_ID) });
  for (const method of ["registerAgent", "assignTask", "submitArtifact", "recordOutcome", "getRoleReputation", "getTask", "getReceipts"]) requireValue(typeof port?.[method] === "function", "CHAIN_NOT_CONFIGURED", `链适配器缺少 ${method}`);
  return port as ChainPort;
}

export async function submitToChain(chain: ChainPort, task: Task, artifact: Artifact, agentId: `0x${string}`) {
  const receipt = SubmissionReceiptSchema.parse(await chain.submitArtifact({ taskId: task.taskId, attempt: task.attempt, artifactHash: artifact.contentHash, artifactURI: artifact.URI }));
  exact(receipt.signer, agentId, "链回执签名者不符");
  exact(receipt.taskId, task.taskId, "链回执任务不符");
  exact(receipt.attempt, task.attempt, "链回执 attempt 不符");
  exact(receipt.artifactHash, artifact.contentHash, "链回执产物不符");
  requireValue(receipt.status !== "FAILED", "CHAIN_SUBMISSION_FAILED", "链提交失败");
  return receipt;
}
