import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hre from "hardhat";
import { createWalletClient, custom, encodeFunctionData, parseEther, toBytes, toFunctionSignature, toEventSignature, type Abi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ChainError, createLedgerClient, hashFileBytes, ledgerAbi, Role,
  type AssignTask, type LedgerConfig, type RecordOutcome,
} from "../../packages/chain/dist/index.js";

const hash = (text: string) => hashFileBytes(toBytes(text));

async function setup() {
  const network = await hre.network.create("hardhat");
  const { viem, provider } = network;
  const rpc = await viem.getPublicClient();
  const [funder] = await viem.getWalletClients();
  const wallets = Array.from({ length: 6 }, () => createWalletClient({
    account: privateKeyToAccount(generatePrivateKey()), chain: rpc.chain, transport: custom(provider),
  }));
  for (const wallet of wallets) {
    const tx = await funder.sendTransaction({ to: wallet.account.address, value: parseEther("1") });
    await rpc.waitForTransactionReceipt({ hash: tx });
  }
  const [coordinator, validator, dataA, dataB, analyst, reporter] = wallets;
  const artifact = await hre.artifacts.readArtifact("AgentLedger");
  const deployment = await coordinator.deployContract({
    abi: ledgerAbi, bytecode: artifact.bytecode as Hex, args: [coordinator.account.address],
  });
  const deploymentReceipt = await rpc.waitForTransactionReceipt({ hash: deployment });
  assert.ok(deploymentReceipt.contractAddress);
  const config: LedgerConfig = {
    publicClient: rpc, chainId: rpc.chain.id,
    contractAddress: deploymentReceipt.contractAddress, deploymentBlock: deploymentReceipt.blockNumber,
  };
  const client = async (walletClient?: LedgerConfig["walletClient"]) => createLedgerClient({ ...config, walletClient });
  const [coordinatorClient, validatorClient, dataAClient, dataBClient, analystClient, reporterClient, reader] =
    await Promise.all([...wallets.map((wallet) => client(wallet)), client()]);
  const settle = async () => provider.request({ method: "hardhat_mine", params: ["0x40"] });
  for (const [agent, role] of [[dataAClient, Role.DATA], [dataBClient, Role.DATA],
    [analystClient, Role.ANALYSIS], [reporterClient, Role.REPORT]] as const) {
    await agent.registerAgent({ roles: [role], manifestURI: "dev-fixture://manifest", manifestHash: hash(`manifest-${role}`) });
  }
  await settle();
  const assignment = (label: string, role: Role = Role.DATA, assignee = dataA.account.address): AssignTask => ({
    runId: hash(`run-${label}`), taskId: hash(`task-${label}`), attempt: 1,
    role, assignee, inputHash: hash("DEV_FIXTURE input"), criteriaHash: hash("DEV_FIXTURE criteria"),
    decisionHash: hash("DEV_FIXTURE decision"), validator: validator.account.address,
  });
  const submission = (task: AssignTask) => ({
    taskId: task.taskId, attempt: task.attempt, artifactHash: hash("DEV_FIXTURE artifact"), artifactURI: "dev-fixture://artifact",
  });
  const outcome = (task: AssignTask, verdict: "PASS" | "FAIL" = "PASS"): RecordOutcome => ({
    ...submission(task), verdict, evidenceHash: hash("DEV_FIXTURE evidence"), evidenceURI: "dev-fixture://evidence",
  });
  return { network, rpc, provider, wallets, coordinator, validator, dataA, dataB, analyst, reporter,
    coordinatorClient, validatorClient, dataAClient, dataBClient, analystClient, reporterClient, reader,
    config, client, settle, assignment, submission, outcome, artifact };
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof ChainError && error.code === code;
}

describe("A 链端口：真实本地 EVM + DEV_FIXTURE 输入", () => {
  it("ABI 与编译产物的函数、事件和错误一致", async () => {
    const artifact = await hre.artifacts.readArtifact("AgentLedger");
    const keys = (abi: Abi) => abi.flatMap((item) => {
      if (item.type === "function") return [`function:${toFunctionSignature(item)}:${toFunctionSignature({ ...item, inputs: item.outputs })}:${item.stateMutability}`];
      if (item.type === "event") return [`event:${toEventSignature(item)}:${item.inputs.map((input) => !!input.indexed).join(",")}`];
      if (item.type === "error") return [`error:${toFunctionSignature({ ...item, type: "function", outputs: [], stateMutability: "nonpayable" })}`];
      return [];
    }).sort();
    assert.deepEqual(keys(ledgerAbi), keys(artifact.abi));
  });

  it("四个地址登记；零历史和角色隔离；独立快照读取", async () => {
    const s = await setup();
    const addresses = [s.dataA, s.dataB, s.analyst, s.reporter].map((wallet) => wallet.account.address);
    assert.equal(new Set(addresses).size, 4);
    for (const address of addresses) assert.equal((await s.reader.getAgent(address)).registered, true);
    const empty = await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA);
    assert.equal(empty.reputation, 0.5);
    assert.equal(empty.sampleCount, 0n);
    const task = s.assignment("report", Role.REPORT, s.reporter.account.address);
    await s.coordinatorClient.assignTask(task);
    await s.reporterClient.submitArtifact(s.submission(task));
    await s.validatorClient.recordOutcome(s.outcome(task));
    await s.settle();
    assert.equal((await s.reader.getRoleReputation(s.reporter.account.address, Role.REPORT)).passCount, 1n);
    assert.equal((await s.reader.getRoleReputation(s.reporter.account.address, Role.DATA)).passCount, 0n);
    assert.equal((await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA)).sampleCount, 0n);
    await s.network.close();
  });

  it("拒绝越权指派/提交/验收、角色不匹配、自评和错误 attempt", async () => {
    const s = await setup();
    const task = s.assignment("permissions");
    await assert.rejects(() => s.dataAClient.assignTask(task), errorCode("UNAUTHORIZED"));
    await assert.rejects(() => s.coordinatorClient.assignTask({ ...task, role: Role.REPORT }), errorCode("ROLE_MISMATCH"));
    await assert.rejects(() => s.coordinatorClient.assignTask({ ...task, validator: task.assignee }), errorCode("INVALID_ARGUMENT"));
    await assert.rejects(() => s.coordinatorClient.assignTask({ ...task, attempt: 2 }), errorCode("STALE_ATTEMPT"));
    await s.coordinatorClient.assignTask(task);
    await assert.rejects(() => s.dataBClient.submitArtifact(s.submission(task)), errorCode("UNAUTHORIZED"));
    await assert.rejects(() => s.dataAClient.submitArtifact({ ...s.submission(task), attempt: 2 }), errorCode("STALE_ATTEMPT"));
    await assert.rejects(() => s.validatorClient.recordOutcome(s.outcome(task)), errorCode("INVALID_STATE"));
    await s.dataAClient.submitArtifact(s.submission(task));
    await assert.rejects(() => s.dataAClient.recordOutcome(s.outcome(task)), errorCode("UNAUTHORIZED"));
    await assert.rejects(() => s.validatorClient.recordOutcome({ ...s.outcome(task), artifactHash: hash("changed") }), errorCode("ARTIFACT_MISMATCH"));
    await s.network.close();
  });

  it("产物只可提交一次；同一 attempt 只能有一个结论；FAIL 独立计数", async () => {
    const s = await setup();
    const task = s.assignment("once");
    await s.coordinatorClient.assignTask(task);
    await assert.rejects(() => s.coordinatorClient.assignTask(task), errorCode("TASK_EXISTS"));
    await s.dataAClient.submitArtifact(s.submission(task));
    await assert.rejects(() => s.dataAClient.submitArtifact(s.submission(task)), errorCode("INVALID_STATE"));
    await s.validatorClient.recordOutcome(s.outcome(task, "FAIL"));
    await assert.rejects(() => s.validatorClient.recordOutcome(s.outcome(task)), errorCode("DUPLICATE_OUTCOME"));
    await s.settle();
    const reputation = await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA);
    assert.equal(reputation.passCount, 0n);
    assert.equal(reputation.failCount, 1n);
    assert.equal(reputation.reputation, 1 / 3);
    const taskState = await s.reader.getTask(task.taskId);
    assert.equal(taskState.status, "VERIFIED_FAIL");
    assert.equal(taskState.artifactHash, s.submission(task).artifactHash);
    await s.network.close();
  });

  it("两轮三角色链端口调用；第二轮读取第一轮履历；旧快照保持不变", async () => {
    const s = await setup();
    const baseline = await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA);
    for (let round = 1; round <= 2; round++) {
      if (round === 2) {
        const current = await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA);
        assert.equal(current.passCount, 1n);
        assert.equal(current.reputation, 2 / 3);
      }
      for (const [role, wallet, client] of [
        [Role.DATA, s.dataA, s.dataAClient], [Role.ANALYSIS, s.analyst, s.analystClient],
        [Role.REPORT, s.reporter, s.reporterClient],
      ] as const) {
        const task = s.assignment(`round-${round}-${role}`, role, wallet.account.address);
        await s.coordinatorClient.assignTask(task);
        await client.submitArtifact(s.submission(task));
        await s.validatorClient.recordOutcome(s.outcome(task));
        await s.settle();
        const receipts = await s.reader.getReceipts({ taskId: task.taskId, attempt: 1 });
        assert.equal(receipts.length, 3);
        assert.ok(receipts.every((receipt) => receipt.status === "CONFIRMED"));
      }
    }
    assert.equal((await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA)).passCount, 2n);
    assert.equal((await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA, baseline.repBlockNumber)).passCount, 0n);
    assert.equal((await s.reader.getRoleReputation(s.dataB.account.address, Role.DATA)).reputation, 0.5);
    await s.network.close();
  });

  it("真实未入块交易不增加信誉；同一 hash 确认后只计一次", async () => {
    const s = await setup();
    const task = s.assignment("pending");
    await s.coordinatorClient.assignTask(task);
    await s.dataAClient.submitArtifact(s.submission(task));
    await s.settle();
    const before = await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA);
    await s.provider.request({ method: "evm_setAutomine", params: [false] });
    const pending = await s.validatorClient.recordOutcome(s.outcome(task));
    assert.equal(pending.status, "PENDING");
    assert.equal((await s.reader.getReceipts({ txHash: pending.txHash }))[0].status, "PENDING");
    assert.equal((await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA)).passCount, 0n);
    await s.provider.request({ method: "evm_mine", params: [] });
    const mined = (await s.reader.getReceipts({ txHash: pending.txHash }))[0];
    assert.ok(mined.blockNumber);
    assert.equal((await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA, before.repBlockNumber)).passCount, 0n);
    await s.settle();
    const confirmed = (await s.reader.getReceipts({ txHash: pending.txHash }))[0];
    assert.equal(confirmed.txHash, pending.txHash);
    assert.equal(confirmed.status, "CONFIRMED");
    assert.equal((await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA)).passCount, 1n);
    await assert.rejects(() => s.reader.getRoleReputation(s.dataA.account.address, Role.DATA, confirmed.blockNumber! + 1_000n), errorCode("CHAIN_PENDING"));
    await s.network.close();
  });

  it("同一协调者并发指派使用不同 nonce，均能确认", async () => {
    const s = await setup();
    await s.provider.request({ method: "evm_setAutomine", params: [false] });
    const tasks = [s.assignment("parallel-a"), s.assignment("parallel-b")];
    const pending = await Promise.all(tasks.map((task) => s.coordinatorClient.assignTask(task)));
    const transactions = await Promise.all(pending.map((receipt) => s.rpc.getTransaction({ hash: receipt.txHash })));
    assert.notEqual(transactions[0].nonce, transactions[1].nonce);
    await s.settle();
    for (const task of tasks) assert.equal((await s.reader.getTask(task.taskId)).status, "ASSIGNED");
    await s.network.close();
  });

  it("真实 reverted 交易返回 FAILED；错误网络与只读签名请求立即失败", async () => {
    const s = await setup();
    await assert.rejects(() => createLedgerClient({ ...s.config, chainId: 10143 }), errorCode("WRONG_CHAIN"));
    await assert.rejects(() => s.reader.assignTask(s.assignment("readonly")), errorCode("UNAUTHORIZED"));
    const task = s.assignment("reverted");
    await s.coordinatorClient.assignTask(task);
    await s.dataAClient.submitArtifact(s.submission(task));
    await s.validatorClient.recordOutcome(s.outcome(task));
    await s.provider.request({ method: "evm_setAutomine", params: [false] });
    const txHash = await s.validator.sendTransaction({
      to: s.config.contractAddress, gas: 300_000n,
      data: encodeFunctionData({ abi: ledgerAbi, functionName: "recordOutcome", args: [
        task.taskId, 1, true, s.outcome(task).artifactHash, s.outcome(task).evidenceHash, s.outcome(task).evidenceURI,
      ] }),
    });
    await s.provider.request({ method: "evm_mine", params: [] });
    await s.settle();
    const receipt = (await s.reader.getReceipts({ txHash }))[0];
    assert.equal(receipt.status, "FAILED");
    assert.equal((await s.reader.getRoleReputation(s.dataA.account.address, Role.DATA)).passCount, 1n);
    assert.notEqual(hashFileBytes(toBytes('{"a":1}\n')), hashFileBytes(toBytes('{"a":1}')));
    await s.network.close();
  });
});
