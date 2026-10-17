import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, type TransactionSerialized } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ledgerAbi } from "../../chain/src/index.ts";
import { withPreparedTransaction } from "../src/index.ts";

const deployment = JSON.parse(await readFile(new URL("../../../deployments/monad-testnet.json", import.meta.url), "utf8"));
const network = { chainId: deployment.chainId, contractAddress: deployment.contractAddress };
const agent = privateKeyToAccount(generatePrivateKey());
const history = JSON.parse(await readFile(new URL("./fixtures/a-smoke-testnet.json", import.meta.url), "utf8"));
const manifest = history.receipts[0].events[0].args;
const operation = {
  operation: "REGISTER" as const,
  input: { agentId: agent.address, roles: ["DATA" as const], manifestURI: manifest.manifestURI, manifestHash: manifest.manifestHash },
};
const transaction = {
  type: "eip1559" as const, chainId: network.chainId, nonce: 0, gas: 300_000n,
  maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, to: network.contractAddress, value: 0n,
  data: encodeFunctionData({ abi: ledgerAbi, functionName: "registerAgent", args: [[0], manifest.manifestURI, manifest.manifestHash] }),
};

test("真实本地签名在返回前持久化原始交易和相同hash", async () => {
  const directory = new URL("../.local/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const caseDirectory = await mkdtemp(fileURLToPath(new URL("signature-", directory)));
  const output = `${caseDirectory}/prepared.json`;
  try {
    const wrapped = withPreparedTransaction(agent, network, operation, prepared => writeFile(output, JSON.stringify(prepared), { flag: "wx" }));
    const serializedTransaction = await wrapped.signTransaction(transaction);
    const saved = JSON.parse(await readFile(output, "utf8"));
    assert.equal(saved.serializedTransaction, serializedTransaction);
    assert.equal(saved.receipt.txHash, keccak256(serializedTransaction));
    assert.equal(saved.receipt.signer, agent.address.toLowerCase());
    assert.equal(saved.receipt.status, "PENDING");
    assert.equal(saved.operation, "REGISTER");
    assert.equal((await recoverTransactionAddress({ serializedTransaction: serializedTransaction as TransactionSerialized })).toLowerCase(), agent.address.toLowerCase());
    assert.equal(parseTransaction(serializedTransaction).chainId, network.chainId);
  } finally {
    await unlink(output);
    await rmdir(caseDirectory);
  }
});

test("真实持久化失败立即终止签名返回", async () => {
  const directory = new URL("../.local/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const caseDirectory = await mkdtemp(fileURLToPath(new URL("signature-", directory)));
  try {
    const wrapped = withPreparedTransaction(agent, network, operation, prepared => writeFile(`${caseDirectory}/missing/prepared.json`, JSON.stringify(prepared)));
    await assert.rejects(wrapped.signTransaction(transaction), { code: "ENOENT" });
  } finally {
    await rmdir(caseDirectory);
  }
});
