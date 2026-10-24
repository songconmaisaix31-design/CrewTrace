import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import hre from "hardhat";
import { encodeAbiParameters, encodeDeployData, getAddress, type Hex } from "viem";
import { ChainError, collaborationLedgerAbi } from "../../packages/chain/dist/index.js";
import { assertTestnet, reportFailure, saveJSON } from "./env.js";

async function main() {
  const deployment: { chainId: number; contractAddress: `0x${string}`; deploymentTx: `0x${string}`; recorder: `0x${string}` } =
    JSON.parse(await readFile(new URL("../../deployments/collaboration-monad-testnet.json", import.meta.url), "utf8"));
  const directory = new URL("../artifacts/build-info/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".output.json"));
  const candidates = [];
  for (const file of files) {
    const build = JSON.parse(await readFile(new URL(file, directory), "utf8"));
    for (const [sourceName, contracts] of Object.entries(build.output.contracts)) {
      if (contracts && typeof contracts === "object" && "CollaborationLedger" in contracts
        && contracts.CollaborationLedger && typeof contracts.CollaborationLedger === "object"
        && "metadata" in contracts.CollaborationLedger && typeof contracts.CollaborationLedger.metadata === "string") {
        candidates.push({ file, sourceName, contract: contracts.CollaborationLedger });
      }
    }
  }
  assert.equal(candidates.length, 1, "需要唯一的 CollaborationLedger 编译输出");
  const { file, sourceName, contract } = candidates[0];
  assert.ok(contract && typeof contract === "object" && "metadata" in contract && typeof contract.metadata === "string");
  const input = JSON.parse(await readFile(new URL(file.replace(".output.json", ".json"), directory), "utf8"));
  const artifact = await hre.artifacts.readArtifact("CollaborationLedger");
  const rpc = await assertTestnet();
  const deploymentTx = await rpc.getTransaction({ hash: deployment.deploymentTx });
  assert.equal(deploymentTx.input, encodeDeployData({ abi: collaborationLedgerAbi, bytecode: artifact.bytecode as Hex,
    args: [deployment.recorder] }), "验证源码必须产生与实际部署完全一致的创建字节码");
  const response = await fetch("https://agents.devnads.com/v1/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: deployment.chainId,
      contractAddress: deployment.contractAddress,
      contractName: `${sourceName}:CollaborationLedger`,
      compilerVersion: `v${input.solcLongVersion}`,
      standardJsonInput: input.input,
      foundryMetadata: JSON.parse(contract.metadata),
      constructorArgs: encodeAbiParameters([{ type: "address" }], [deployment.recorder]).slice(2),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const result: unknown = await response.json();
  await saveJSON(new URL("../../deployments/verification-collaboration-testnet.json", import.meta.url), {
    chainId: deployment.chainId, contractAddress: deployment.contractAddress,
    checkedAt: new Date().toISOString(), httpStatus: response.status, result,
  });
  console.log(JSON.stringify(result));
  if (!response.ok) throw new ChainError("VERIFICATION_FAILED", `验证 API 返回 HTTP ${response.status}`);
}

await main().catch(reportFailure);
