import hre from "hardhat";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { encodeDeployData, getAddress, getContractAddress, keccak256, type Hex } from "viem";
import { collaborationLedgerAbi, ChainError } from "../../packages/chain/dist/index.js";
import { addressEnv, assertTestnet, reportFailure, saveJSON, walletFromEnv } from "./env.js";

async function main() {
  const output = new URL("../../deployments/collaboration-monad-testnet.json", import.meta.url);
  if (existsSync(output)) throw new ChainError("ALREADY_DEPLOYED", "已存在协作账本部署记录，请直接使用该记录");
  const pendingFile = new URL("../.local/collaboration-deployment-pending.json", import.meta.url);
  const rpc = await assertTestnet();
  const wallet = walletFromEnv("DEPLOYER_PRIVATE_KEY");
  const recorder = addressEnv("COLLABORATION_RECORDER_ADDRESS");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const artifact = await hre.artifacts.readArtifact("CollaborationLedger");
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await mkdir(new URL("../../deployments/", import.meta.url), { recursive: true });
  let pending: { txHash: Hex; contractAddress: Hex; sourceCommit: string; serializedTransaction: Hex };
  if (existsSync(pendingFile)) {
    pending = JSON.parse(await readFile(pendingFile, "utf8"));
  } else {
    const data = encodeDeployData({ abi: collaborationLedgerAbi, bytecode: artifact.bytecode as Hex, args: [recorder] });
    const gas = await rpc.estimateGas({ account: wallet.account, data });
    const request = await wallet.prepareTransactionRequest({ data, gas: gas + gas / 20n });
    const serializedTransaction = await wallet.signTransaction(request);
    const txHash = keccak256(serializedTransaction);
    pending = { txHash, contractAddress: getContractAddress({ from: wallet.account.address, nonce: BigInt(request.nonce) }), sourceCommit, serializedTransaction };
    await saveJSON(pendingFile, pending);
    console.log(`部署交易：${txHash}`);
  }
  try {
    await rpc.getTransaction({ hash: pending.txHash });
  } catch (error) {
    if (!(error instanceof Error && error.name === "TransactionNotFoundError")) throw error;
    await rpc.sendRawTransaction({ serializedTransaction: pending.serializedTransaction });
  }
  console.log(`核对部署交易：${pending.txHash}`);
  const receipt = await rpc.waitForTransactionReceipt({ hash: pending.txHash, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress
    || getAddress(receipt.contractAddress) !== getAddress(pending.contractAddress)) {
    throw new ChainError("CHAIN_FAILED", "部署回执失败或地址不一致");
  }
  const deadline = Date.now() + 120_000;
  while ((await rpc.getBlock({ blockTag: "finalized" })).number < receipt.blockNumber) {
    if (Date.now() >= deadline) throw new ChainError("CHAIN_PENDING", `部署仍待确认：${pending.txHash}`);
    await setTimeout(1_000);
  }
  const canonical = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash !== receipt.blockHash) throw new ChainError("RECEIPT_MISMATCH", "部署回执不在当前规范链");
  const actualRecorder = await rpc.readContract({ address: receipt.contractAddress, abi: collaborationLedgerAbi, functionName: "recorder" });
  if (getAddress(actualRecorder) !== recorder) throw new ChainError("DEPLOYMENT_CONFIG", "记录者与部署配置不一致");
  const code = await rpc.getCode({ address: receipt.contractAddress, blockNumber: receipt.blockNumber });
  if (!code) throw new ChainError("CONTRACT_NOT_FOUND", "部署地址没有字节码");
  await saveJSON(output, {
    chainId: 10143, contractAddress: receipt.contractAddress, deploymentTx: pending.txHash,
    deploymentBlock: receipt.blockNumber.toString(), explorer: "https://testnet.monadscan.com",
    version: "collaboration-ledger-v1", sourceCommit: pending.sourceCommit, recorder, codeHash: keccak256(code),
  });
  console.log(`已确认协作账本：${receipt.contractAddress}，区块：${receipt.blockNumber}`);
}

await main().catch(reportFailure);
