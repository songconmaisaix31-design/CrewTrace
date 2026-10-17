import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { RoleSchema } from "../../packages/contracts/src/index.ts";
import { requireValue } from "./errors.ts";

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  const values = z.strictObject({
    serviceURL: z.url(),
    nodeCredential: z.string().min(16),
    privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    runtimeId: z.string().min(1),
    role: RoleSchema,
    model: z.string().min(1),
    outputDirectory: z.string().min(1),
  }).parse({
    serviceURL: env.WORKER_SERVICE_URL,
    nodeCredential: env.WORKER_NODE_CREDENTIAL,
    privateKey: env.WORKER_PRIVATE_KEY,
    runtimeId: env.WORKER_RUNTIME_ID,
    role: env.WORKER_ROLE,
    model: env.STEP_MODEL,
    outputDirectory: env.WORKER_OUTPUT_DIRECTORY,
  });
  const url = new URL(values.serviceURL);
  requireValue(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)), "INVALID_SERVICE_URL", "节点凭证只能发送给 HTTPS 或本机 HTTP 服务");
  requireValue(!url.username && !url.password && !url.search && !url.hash, "INVALID_SERVICE_URL", "服务地址禁止包含凭证、查询或片段");
  const account = privateKeyToAccount(values.privateKey as `0x${string}`);
  return { ...values, privateKey: values.privateKey as `0x${string}`, agentId: account.address.toLowerCase() as `0x${string}`, serviceURL: values.serviceURL.replace(/\/$/, "") };
}

export async function initializeIdentities(directory: string, model: string, serviceURL: string) {
  const output = resolve(directory);
  requireValue(isAbsolute(output) && output.split(/[\\/]/).includes(".local"), "PRIVATE_CONFIG_PATH", "身份配置必须写入被忽略的 .local 目录");
  requireValue(!/[\r\n]/.test(model + serviceURL), "INVALID_CONFIG", "配置值不能包含换行");
  await mkdir(output, { recursive: true });
  const identities = [];
  for (const [name, role] of [["data-a", "DATA"], ["data-b", "DATA"], ["analysis", "ANALYSIS"], ["report", "REPORT"]] as const) {
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address.toLowerCase();
    const runtimeId = `${name}-${randomUUID()}`;
    await writeFile(join(output, `${name}.env`), [
      `WORKER_PRIVATE_KEY=${privateKey}`, `WORKER_RUNTIME_ID=${runtimeId}`,
      `WORKER_ROLE=${role}`, `STEP_MODEL=${model}`, `WORKER_SERVICE_URL=${serviceURL}`,
      `WORKER_OUTPUT_DIRECTORY=${JSON.stringify(join(output, name).replaceAll("\\", "/"))}`, "",
    ].join("\n"), { flag: "wx", mode: 0o600 });
    identities.push({ name, agentId: address, role, runtimeId, configPath: join(output, `${name}.env`) });
  }
  await writeFile(join(output, "public-identities.json"), JSON.stringify(identities, null, 2) + "\n", { flag: "wx" });
  return identities;
}
