import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { AddressSchema, NodeEnrollmentRequestSchema, RoleSchema, nodeBindingMessage } from "../../packages/contracts/src/index.ts";
import { contentHash } from "./content.ts";
import { requireValue, WorkerError } from "./errors.ts";

export async function enrollIdentity(configPath: string, manifestPath: string, manifestURI: string, signal?: AbortSignal) {
  const config = parseEnv(await readFile(configPath, "utf8"));
  requireValue(config.WORKER_PRIVATE_KEY && config.WORKER_RUNTIME_ID && config.WORKER_ROLE && config.WORKER_SERVICE_URL, "INVALID_CONFIG", "节点私有配置缺少钱包、runtimeId、角色或服务地址");
  requireValue(!config.WORKER_NODE_CREDENTIAL, "ALREADY_ENROLLED", "配置已有节点凭证，请使用服务端凭证轮换流程");
  requireValue(process.env.ADMIN_TOKEN, "ADMIN_NOT_CONFIGURED", "登记节点需要私有 ADMIN_TOKEN");
  const endpoint = new URL("/admin/nodes", config.WORKER_SERVICE_URL);
  requireValue(endpoint.protocol === "https:" || (endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname)), "INVALID_SERVICE_URL", "登记仅允许 HTTPS 或本机 HTTP");
  const account = privateKeyToAccount(config.WORKER_PRIVATE_KEY as `0x${string}`);
  const agentId = AddressSchema.parse(account.address);
  const profile = {
    agentId, roles: [RoleSchema.parse(config.WORKER_ROLE)], manifestURI, manifestHash: contentHash(await readFile(manifestPath)),
    runtimeId: config.WORKER_RUNTIME_ID, lastSeenAt: null, activeTasks: 0, maxConcurrency: 1, admitted: true, conditionsAccepted: true,
  };
  const signature = await account.signMessage({ message: nodeBindingMessage(profile) });
  const request = NodeEnrollmentRequestSchema.parse({ profile, signature });
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(request), signal, redirect: "error" });
  if (!response.ok) throw new WorkerError("ENROLLMENT_FAILED", `真实节点登记 HTTP ${response.status}`);
  const enrolled = z.object({ agentId: AddressSchema, runtimeId: z.string(), token: z.string().min(16) }).parse(await response.json());
  requireValue(enrolled.agentId === agentId && enrolled.runtimeId === config.WORKER_RUNTIME_ID, "UNAUTHORIZED", "服务登记身份与实际签名钱包不符");
  config.WORKER_NODE_CREDENTIAL = enrolled.token;
  await writeFile(configPath, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
  return { agentId, runtimeId: enrolled.runtimeId, role: config.WORKER_ROLE, enrolled: true };
}
