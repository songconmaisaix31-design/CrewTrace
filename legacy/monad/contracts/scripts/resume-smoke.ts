import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { createWalletClient, encodeFunctionData, getAddress, keccak256, parseEther, parseTransaction, recoverTransactionAddress, toBytes, type Hash, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import { ChainBroadcastError, ChainError, createLedgerClient, hashFileBytes, ledgerAbi, Role, type ChainReceipt } from "../../packages/chain/dist/index.js";
import { agentAccounts, assertTestnet, connection, coordinatorWallet, json, readDeployment, reportFailure, saveJSON, waitConfirmed, walletFromEnv } from "./env.js";

async function main() {
  const checkOnly = process.argv.includes("--check");
  const deployment = await readDeployment();
  const output = new URL("../../deployments/a-smoke-testnet.json", import.meta.url);
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(report.contract, deployment.contractAddress);
  if (report.status === "CONFIRMED") { console.log("两轮验证已确认，无需转账或重放。"); return; }
  assert.equal(report.status, "CHAIN_PENDING");
  assert.equal(report.runIds.length, 2);
  const rpc = await assertTestnet();
  const coordinator = coordinatorWallet();
  const validator = walletFromEnv("VALIDATOR_PRIVATE_KEY");
  assert.equal(getAddress(validator.account.address), getAddress(deployment.validator));
  const accounts = agentAccounts();
  const common = { publicClient: rpc, chainId: 10143, contractAddress: deployment.contractAddress,
    deploymentBlock: BigInt(deployment.deploymentBlock) };
  const reader = await createLedgerClient(common);
  const coordinatorClient = await createLedgerClient({ ...common, walletClient: coordinator });
  const validatorClient = await createLedgerClient({ ...common, walletClient: validator });
  const fixtures = new Map<string, { hash: Hash; uri: string }>();
  for (const name of ["input", "criteria", "artifact", "evidence"]) {
    const bytes = await readFile(new URL(`../fixtures/${name}.json`, import.meta.url));
    fixtures.set(name, { hash: hashFileBytes(bytes), uri: `data:application/json;base64,${bytes.toString("base64")}` });
  }
  const fixture = (name: string) => { const value = fixtures.get(name); assert.ok(value); return value; };
  const persist = () => writeFile(output, json(report));
  const known = async (hash: Hash) => {
    try { await rpc.getTransaction({ hash }); return true; }
    catch (error) {
      if (error instanceof Error && error.name === "TransactionNotFoundError") return false;
      throw error;
    }
  };
  const pending: ChainReceipt = report.receipts.at(-1);
  const [original] = await reader.getReceipts({ txHash: pending.txHash });
  if (original.status === "PENDING" && !await known(pending.txHash)) {
    const specific = new URL(`../.local/smoke-broadcast-${pending.txHash}.json`, import.meta.url);
    const saved = new URL("../.local/smoke-broadcast-pending.json", import.meta.url);
    let serializedTransaction: Hex;
    if (existsSync(specific) || existsSync(saved)) {
      const record = JSON.parse(await readFile(existsSync(specific) ? specific : saved, "utf8"));
      assert.equal(record.txHash, pending.txHash);
      serializedTransaction = record.serializedTransaction;
    } else {
      const previous: ChainReceipt = report.receipts.at(-2);
      const submitted = previous.events?.find((event) => event.eventName === "ArtifactSubmitted");
      assert.ok(submitted && submitted.eventName === "ArtifactSubmitted");
      const task = await reader.getTask(submitted.args.taskId);
      assert.equal(task.status, "SUBMITTED");
      const data = encodeFunctionData({ abi: ledgerAbi, functionName: "recordOutcome", args: [
        task.taskId, task.attempt, true, task.artifactHash, fixture("evidence").hash, fixture("evidence").uri,
      ] });
      const gas = await rpc.estimateGas({ account: validator.account, to: deployment.contractAddress, data });
      const request = await validator.prepareTransactionRequest({ to: deployment.contractAddress, data, gas: gas + gas / 20n });
      serializedTransaction = await validator.signTransaction(request);
      assert.equal(keccak256(serializedTransaction), pending.txHash, "重建签名交易必须与原哈希完全相同");
      await saveJSON(saved, { txHash: pending.txHash, serializedTransaction });
    }
    assert.equal(keccak256(serializedTransaction), pending.txHash);
    assert.ok(serializedTransaction.startsWith("0x02"), "只恢复本次 EIP-1559 签名交易");
    const signedTransaction = serializedTransaction as `0x02${string}`;
    const transaction = parseTransaction(signedTransaction);
    assert.equal(transaction.chainId, 10143);
    assert.ok(transaction.to && pending.signer);
    assert.equal(getAddress(transaction.to), getAddress(deployment.contractAddress));
    assert.equal(getAddress(await recoverTransactionAddress({ serializedTransaction: signedTransaction })), getAddress(pending.signer));
    assert.equal(transaction.value ?? 0n, 0n);
    assert.ok(transaction.gas && transaction.maxFeePerGas);
    const needsFunding = await rpc.getBalance({ address: pending.signer }) < transaction.gas * transaction.maxFeePerGas;
    if (checkOnly) {
      console.log(`原交易哈希核对通过：${pending.txHash}`);
      console.log(`待确认操作：从部署钱包向验收钱包 ${validator.account.address} 补充 0.1 测试 MON，然后广播同一签名交易。`);
      return;
    }
    if (needsFunding) {
      assert.equal(getAddress(pending.signer), getAddress(validator.account.address), "本次授权只允许补充验收方 Gas");
      const fundingFile = new URL("../../deployments/a-smoke-funding-testnet.json", import.meta.url);
      const fundingRawFile = new URL("../.local/smoke-funding-raw.json", import.meta.url);
      if (!existsSync(fundingFile)) {
        if (!existsSync(fundingRawFile)) {
          const payer = walletFromEnv("DEPLOYER_PRIVATE_KEY");
          const request = await payer.prepareTransactionRequest({ to: validator.account.address, value: parseEther("0.1"), gas: 21_000n });
          const raw = await payer.signTransaction(request);
          await saveJSON(fundingRawFile, {
            chainId: 10143, from: payer.account.address, to: validator.account.address,
            amountMON: "0.1", purpose: "A DEV_FIXTURE 验收 Gas", txHash: keccak256(raw), status: "PENDING",
            beforeBalance: await rpc.getBalance({ address: validator.account.address, blockTag: "finalized" }), serializedTransaction: raw,
          });
        }
        const { serializedTransaction: raw, ...record } = JSON.parse(await readFile(fundingRawFile, "utf8"));
        assert.equal(keccak256(raw), record.txHash);
        await saveJSON(fundingFile, record);
      }
      const funding = JSON.parse(await readFile(fundingFile, "utf8"));
      assert.equal(getAddress(funding.to), getAddress(validator.account.address));
      assert.equal(funding.amountMON, "0.1");
      if (!await known(funding.txHash)) {
        const raw = JSON.parse(await readFile(fundingRawFile, "utf8")).serializedTransaction;
        assert.equal(keccak256(raw), funding.txHash);
        await rpc.sendRawTransaction({ serializedTransaction: raw });
      }
      const fundingReceipt = await rpc.waitForTransactionReceipt({ hash: funding.txHash });
      assert.equal(fundingReceipt.status, "success");
      const deadline = Date.now() + 120_000;
      while ((await rpc.getBlock({ blockTag: "finalized" })).number < fundingReceipt.blockNumber
        || await rpc.getBalance({ address: validator.account.address, blockTag: "finalized" }) < BigInt(funding.beforeBalance) + parseEther("0.1")) {
        if (Date.now() >= deadline) throw new ChainError("CHAIN_PENDING", `Gas 补充仍待确认：${funding.txHash}`);
        await setTimeout(1_000);
      }
      assert.equal((await rpc.getBlock({ blockNumber: fundingReceipt.blockNumber })).hash, fundingReceipt.blockHash);
      funding.status = "CONFIRMED";
      funding.blockNumber = fundingReceipt.blockNumber;
      await writeFile(fundingFile, json(funding));
      console.log(`验收 Gas 已补充，交易：${funding.txHash}`);
    }
    const hash = await rpc.sendRawTransaction({ serializedTransaction });
    assert.equal(hash, pending.txHash);
  }
  if (checkOnly) { console.log(`原交易状态：${original.status}`); return; }
  report.receipts[report.receipts.length - 1] = await waitConfirmed(reader, pending.txHash);
  await persist();
  const runId: Hash = report.runIds[1];
  const write = async (action: () => Promise<ChainReceipt>) => {
    let receipt: ChainReceipt;
    try { receipt = await action(); }
    catch (error) {
      if (error instanceof ChainBroadcastError) {
        await saveJSON(new URL(`../.local/smoke-broadcast-${error.receipt.txHash}.json`, import.meta.url), {
          txHash: error.receipt.txHash, serializedTransaction: error.serializedTransaction,
        });
        report.receipts.push(error.receipt);
        report.status = "CHAIN_PENDING";
        await persist();
      }
      throw error;
    }
    report.receipts.push(receipt);
    await persist();
    report.receipts[report.receipts.length - 1] = await waitConfirmed(reader, receipt.txHash);
    await persist();
  };
  for (const [index, role] of [[0, Role.DATA], [2, Role.ANALYSIS], [3, Role.REPORT]] as const) {
    const events = (report.receipts as ChainReceipt[]).flatMap((receipt) => receipt.events ?? []);
    const assigned = events.find((event) => event.eventName === "TaskAssigned"
      && event.args.runId === runId && event.args.role === role);
    const taskId = assigned?.eventName === "TaskAssigned" ? assigned.args.taskId : hashFileBytes(toBytes(`DEV_FIXTURE:${runId}:${role}`));
    const agent = await createLedgerClient({ ...common, walletClient: createWalletClient({
      account: accounts[index], chain: monadTestnet, transport: connection().transport,
    }) });
    if (!assigned) await write(() => coordinatorClient.assignTask({ runId, taskId, attempt: 1, role,
      assignee: accounts[index].address, validator: validator.account.address, inputHash: fixture("input").hash,
      criteriaHash: fixture("criteria").hash, decisionHash: hashFileBytes(toBytes(`DEV_FIXTURE:${runId}:${role}`)),
    }));
    if ((await reader.getTask(taskId)).status === "ASSIGNED") await write(() => agent.submitArtifact({
      taskId, attempt: 1, artifactHash: fixture("artifact").hash, artifactURI: fixture("artifact").uri,
    }));
    if ((await reader.getTask(taskId)).status === "SUBMITTED") await write(() => validatorClient.recordOutcome({
      taskId, attempt: 1, verdict: "PASS", artifactHash: fixture("artifact").hash,
      evidenceHash: fixture("evidence").hash, evidenceURI: fixture("evidence").uri,
    }));
    assert.equal((await reader.getTask(taskId)).status, "VERIFIED_PASS");
    assert.equal((await reader.getRoleReputation(accounts[index].address, role)).passCount, 2n);
  }
  const baseline = report.snapshots.find((snapshot: { stage: string }) => snapshot.stage === "BEFORE_ROUND_1");
  const final = await reader.getRoleReputation(accounts[0].address, Role.DATA);
  assert.equal((await reader.getRoleReputation(accounts[0].address, Role.DATA, BigInt(baseline.repBlockNumber))).passCount, BigInt(baseline.passCount));
  report.snapshots.push({ stage: "AFTER_ROUND_2", ...final });
  report.status = "CONFIRMED";
  report.completedAt = new Date().toISOString();
  await persist();
  console.log("两轮 A 链端口验证已全部确认，原交易哈希保持不变。");
}

await main().catch(reportFailure);
