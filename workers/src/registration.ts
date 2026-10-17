import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ChainReceiptSchema, type ChainReceipt } from "../../packages/contracts/src/index.ts";
import { loadWorkerChain, waitForTransaction } from "./chain.ts";
import { loadWorkerConfig } from "./config.ts";
import { exact, jsonBytes, utf8 } from "./content.ts";
import { loadPublishedManifest } from "./enrollment.ts";
import { requireValue, WorkerError } from "./errors.ts";

export async function registerIdentity(manifestPath: string, manifestURI: string, reconcile: boolean, signal: AbortSignal) {
  const config = loadWorkerConfig();
  const chain = await loadWorkerChain(config.privateKey);
  const manifest = await loadPublishedManifest(manifestPath, manifestURI, signal);
  await mkdir(config.outputDirectory, { recursive: true });
  const path = join(config.outputDirectory, "registration-receipt.json");
  let original: ChainReceipt;
  if (reconcile) {
    original = ChainReceiptSchema.parse(JSON.parse(utf8(await readFile(path))));
  } else {
    requireValue(!(await readdir(config.outputDirectory)).includes("registration-receipt.json"), "CHAIN_PENDING", "已有登记回执，请使用 reconcile-registration 对账原交易");
    try {
      original = ChainReceiptSchema.parse(await chain.registerAgent({ agentId: config.agentId, roles: [config.role], ...manifest }));
    } catch (error) {
      if (error instanceof Error && error.name === "ChainBroadcastError" && "receipt" in error && "serializedTransaction" in error) {
        const receipt = ChainReceiptSchema.parse(error.receipt);
        const serialized = z.string().regex(/^0x[0-9a-fA-F]+$/).parse(error.serializedTransaction);
        await writeFile(path, jsonBytes(receipt));
        await writeFile(join(config.outputDirectory, "registration-signed-transaction.txt"), serialized + "\n", { mode: 0o600 });
        throw new WorkerError("CHAIN_PENDING", "登记广播结果未知，已保存原回执与签名字节；使用 reconcile-registration 查询同一交易");
      }
      throw error;
    }
    await writeFile(path, jsonBytes(original));
  }
  exact(original.signer, config.agentId, "登记回执签名者不符");
  exact(original.chainId, Number(process.env.CHAIN_ID), "登记回执网络不符");
  exact(original.contract, process.env.CHAIN_CONTRACT_ADDRESS!.toLowerCase(), "登记回执合约不符");
  const receipt = await waitForTransaction(chain, original, signal, async receipt => writeFile(path, jsonBytes(receipt)));
  const events = receipt.events?.filter(event => event.eventName === "AgentRegistered");
  requireValue(events?.length === 1, "ARTIFACT_MISMATCH", "登记回执必须包含唯一真实 AgentRegistered 事件");
  const event = events[0];
  exact(event.args.agentId, config.agentId, "登记事件签名地址不符");
  exact(event.args.roleMask, { DATA: 1, ANALYSIS: 2, REPORT: 4 }[config.role], "登记事件角色不符");
  exact(event.args.manifestURI, manifest.manifestURI, "登记事件角色说明 URI 不符");
  exact(event.args.manifestHash, manifest.manifestHash, "登记事件角色说明摘要不符");
  exact(event.eventId, `${receipt.chainId}:${receipt.txHash}:${event.logIndex}`, "登记真实事件标识不符");
  return { agentId: config.agentId, role: config.role, receipt };
}
