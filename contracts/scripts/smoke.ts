import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createWalletClient, getAddress, keccak256, toBytes, type Hash } from "viem";
import { monadTestnet } from "viem/chains";
import {
  ChainBroadcastError, ChainError, createLedgerClient, hashFileBytes, Role,
  type ChainReceipt,
} from "../../packages/chain/dist/index.js";
import {
  addressEnv, agentAccounts, assertTestnet, connection, coordinatorWallet, json,
  readDeployment, reportFailure, saveJSON, waitConfirmed, walletFromEnv,
} from "./env.js";

async function main() {
  const deployment = await readDeployment();
  const rpc = await assertTestnet();
  const coordinator = coordinatorWallet();
  const validator = walletFromEnv("VALIDATOR_PRIVATE_KEY");
  const accounts = agentAccounts();
  assert.equal(getAddress(coordinator.account.address), getAddress(deployment.coordinator), "协调者不匹配");
  assert.equal(getAddress(validator.account.address), getAddress(deployment.validator), "验收方不匹配");
  assert.equal(getAddress(validator.account.address), addressEnv("VALIDATOR_ADDRESS"), "验收配置不匹配");
  assert.equal(new Set(accounts.map((account) => getAddress(account.address))).size, 4, "需要四个独立 Agent");
  assert.ok(accounts.every((account) => getAddress(account.address) !== getAddress(validator.account.address)), "验收方不能自评");
  const code = await rpc.getCode({ address: deployment.contractAddress });
  assert.ok(code && keccak256(code) === deployment.codeHash, "合约字节码不匹配");
  const common = {
    publicClient: rpc, chainId: 10143, contractAddress: deployment.contractAddress,
    deploymentBlock: BigInt(deployment.deploymentBlock),
  };
  const coordinatorClient = await createLedgerClient({ ...common, walletClient: coordinator });
  const validatorClient = await createLedgerClient({ ...common, walletClient: validator });
  const reader = await createLedgerClient(common);
  const agents = await Promise.all(accounts.map((account) => createLedgerClient({ ...common,
    walletClient: createWalletClient({ account, chain: monadTestnet, transport: connection().transport }),
  })));
  const baseURI = `https://raw.githubusercontent.com/songconmaisaix31-design/co-vibe/${deployment.sourceCommit}/contracts/fixtures`;
  const fixtures = new Map<string, { hash: Hash; uri: string }>();
  for (const name of ["manifest", "input", "criteria", "artifact", "evidence"]) {
    const bytes = await readFile(new URL(`../fixtures/${name}.json`, import.meta.url));
    const uri = `${baseURI}/${name}.json`;
    const response = await fetch(uri);
    if (!response.ok) throw new ChainError("ARTIFACT_UNAVAILABLE", `公开夹具不可读取：${name}`);
    assert.equal(hashFileBytes(new Uint8Array(await response.arrayBuffer())), hashFileBytes(bytes), `公开夹具摘要不一致：${name}`);
    fixtures.set(name, { hash: hashFileBytes(bytes), uri });
  }
  const fixture = (name: string) => {
    const value = fixtures.get(name);
    assert.ok(value);
    return value;
  };
  const output = new URL("../../deployments/a-smoke-testnet.json", import.meta.url);
  const report: { mode: string; scope: string; status: string; contract: string; runIds: Hash[];
    receipts: ChainReceipt[]; snapshots: unknown[]; completedAt?: string } = {
    mode: "DEV_FIXTURE", scope: "A 链端口独立验证；未执行真实 Worker、模型或业务验收",
    status: "RUNNING", contract: deployment.contractAddress, runIds: [], receipts: [], snapshots: [],
  };
  await saveJSON(output, report);
  const persist = async () => writeFile(output, json(report));
  const write = async (action: () => Promise<ChainReceipt>) => {
    let pending: ChainReceipt;
    try {
      pending = await action();
    } catch (error) {
      if (error instanceof ChainBroadcastError) {
        report.receipts.push(error.receipt);
        report.status = "CHAIN_PENDING";
        await persist();
      }
      throw error;
    }
    report.receipts.push(pending);
    await persist();
    const confirmed = await waitConfirmed(reader, pending.txHash);
    report.receipts[report.receipts.length - 1] = confirmed;
    await persist();
    return confirmed;
  };
  const roles = [Role.DATA, Role.DATA, Role.ANALYSIS, Role.REPORT] as const;
  for (const [index, agent] of agents.entries()) {
    await write(() => agent.registerAgent({
      roles: [roles[index]], manifestURI: fixture("manifest").uri, manifestHash: fixture("manifest").hash,
    }));
  }
  const baseline = await reader.getRoleReputation(accounts[0].address, Role.DATA);
  report.snapshots.push({ stage: "BEFORE_ROUND_1", ...baseline });
  const token = randomUUID();
  for (let round = 1; round <= 2; round++) {
    const runId = keccak256(toBytes(`DEV_FIXTURE:${token}:round:${round}`));
    report.runIds.push(runId);
    const beforeRound = await reader.getRoleReputation(accounts[0].address, Role.DATA);
    assert.equal(beforeRound.passCount, baseline.passCount + BigInt(round - 1));
    report.snapshots.push({ stage: `BEFORE_ROUND_${round}`, ...beforeRound });
    for (const index of [0, 2, 3]) {
      const taskId = keccak256(toBytes(`DEV_FIXTURE:${token}:round:${round}:agent:${index}`));
      await write(() => coordinatorClient.assignTask({
        runId, taskId, attempt: 1, role: roles[index], assignee: accounts[index].address,
        inputHash: fixture("input").hash, criteriaHash: fixture("criteria").hash,
        decisionHash: hashFileBytes(toBytes(`DEV_FIXTURE:${token}:${round}:${index}`)),
        validator: validator.account.address,
      }));
      await write(() => agents[index].submitArtifact({
        taskId, attempt: 1, artifactHash: fixture("artifact").hash, artifactURI: fixture("artifact").uri,
      }));
      const receipt = await write(() => validatorClient.recordOutcome({
        taskId, attempt: 1, verdict: "PASS", artifactHash: fixture("artifact").hash,
        evidenceHash: fixture("evidence").hash, evidenceURI: fixture("evidence").uri,
      }));
      assert.equal((await reader.getTask(taskId, receipt.blockNumber!)).status, "VERIFIED_PASS");
      assert.ok(receipt.events?.some((event) => event.eventName === "OutcomeRecorded"));
    }
    console.log(`A 链端口第 ${round} 轮已确认，runId：${runId}`);
  }
  const final = await reader.getRoleReputation(accounts[0].address, Role.DATA);
  assert.equal(final.passCount, baseline.passCount + 2n);
  const old = await reader.getRoleReputation(accounts[0].address, Role.DATA, baseline.repBlockNumber);
  assert.equal(old.passCount, baseline.passCount);
  report.snapshots.push({ stage: "AFTER_ROUND_2", ...final });
  report.status = "CONFIRMED";
  report.completedAt = new Date().toISOString();
  await persist();
  console.log("A 独立验证通过；结果已保存到 deployments/a-smoke-testnet.json。");
}

await main().catch(reportFailure);
