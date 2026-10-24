import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import {
  createPublicClient, createWalletClient, getAddress, http, isAddress, isHex,
  type Address, type Hash, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { ChainError, type ChainReceipt, type LedgerClient } from "../../packages/chain/dist/index.js";

config({ path: new URL("../.env", import.meta.url).pathname, quiet: true });

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ChainError("ENV_CONFIG", `缺少环境变量 ${name}`);
  return value;
}

export function addressEnv(name: string): Address {
  const value = required(name);
  if (!isAddress(value)) throw new ChainError("ENV_CONFIG", `${name} 必须是有效地址`);
  return getAddress(value);
}

export function accountFromKey(value: string, label: string) {
  if (!isHex(value, { strict: true }) || value.length !== 66) {
    throw new ChainError("ENV_CONFIG", `${label} 必须是 32 字节私钥`);
  }
  return privateKeyToAccount(value);
}

export function agentAccounts() {
  const value: unknown = JSON.parse(required("AGENT_PRIVATE_KEYS"));
  if (!Array.isArray(value) || value.length !== 4 || !value.every((key) => typeof key === "string")) {
    throw new ChainError("ENV_CONFIG", "AGENT_PRIVATE_KEYS 必须是包含四个私钥的 JSON 数组");
  }
  return value.map((key: string) => accountFromKey(key, "AGENT_PRIVATE_KEYS"));
}

export function coordinatorWallet() {
  const deployer = walletFromEnv("DEPLOYER_PRIVATE_KEY");
  const coordinator = addressEnv("COORDINATOR_ADDRESS");
  if (getAddress(deployer.account.address) === coordinator) return deployer;
  const signer = walletFromEnv("COORDINATOR_PRIVATE_KEY");
  if (getAddress(signer.account.address) !== coordinator) {
    throw new ChainError("ENV_CONFIG", "协调者私钥与 COORDINATOR_ADDRESS 不一致");
  }
  return signer;
}

// RPC 只使用显式配置；所有交易先核验实际 chainId。
export function connection() {
  const url = required("MONAD_RPC_URL");
  const transport = http(url, { retryCount: 0, timeout: 15_000 });
  return { publicClient: createPublicClient({ chain: monadTestnet, transport }), transport };
}

export function walletFromEnv(name: string) {
  const { transport } = connection();
  return createWalletClient({
    account: accountFromKey(required(name), name), chain: monadTestnet, transport,
  });
}

export async function assertTestnet() {
  const { publicClient } = connection();
  if (await publicClient.getChainId() !== 10143) throw new ChainError("WRONG_CHAIN", "RPC 必须连接 Monad Testnet 10143");
  return publicClient;
}

export async function waitConfirmed(client: LedgerClient, txHash: Hash): Promise<ChainReceipt> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const [receipt] = await client.getReceipts({ txHash });
    if (receipt.status === "FAILED") throw new ChainError("CHAIN_FAILED", `交易失败：${txHash}`);
    if (receipt.status === "CONFIRMED") return receipt;
    await setTimeout(1_000);
  }
  throw new ChainError("CHAIN_PENDING", `交易仍待确认，请继续查询同一哈希：${txHash}`);
}

export function json(value: unknown): string {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
}

export async function saveJSON(url: URL, value: unknown): Promise<void> {
  await writeFile(url, json(value), { flag: "wx" });
}

export interface Deployment {
  chainId: number;
  contractAddress: Address;
  deploymentTx: Hash;
  deploymentBlock: string;
  explorer: string;
  version: string;
  sourceCommit: string;
  coordinator: Address;
  validator: Address;
  codeHash: Hex;
}

export async function readDeployment(): Promise<Deployment> {
  const value: unknown = JSON.parse(await readFile(new URL("../../deployments/monad-testnet.json", import.meta.url), "utf8"));
  if (!value || typeof value !== "object") throw new ChainError("DEPLOYMENT_CONFIG", "部署记录格式错误");
  const record = value as Record<string, unknown>;
  if (record.chainId !== 10143 || typeof record.contractAddress !== "string" || !isAddress(record.contractAddress)
    || typeof record.deploymentBlock !== "string" || typeof record.sourceCommit !== "string"
    || typeof record.coordinator !== "string" || !isAddress(record.coordinator)
    || typeof record.validator !== "string" || !isAddress(record.validator)
    || typeof record.codeHash !== "string" || !isHex(record.codeHash)) {
    throw new ChainError("DEPLOYMENT_CONFIG", "部署记录缺少必要字段或网络错误");
  }
  return value as Deployment;
}

export function reportFailure(error: unknown): void {
  if (error instanceof ChainError) console.error(`${error.code}: ${error.message}`);
  else console.error(`运行失败（${error instanceof Error ? error.name : "未知错误"}）；请检查本机配置和节点状态。`);
  process.exitCode = 1;
}
