import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import { it } from "node:test";
import hre from "hardhat";
import { createPublicClient, createTestClient, createWalletClient, http, keccak256, parseEther, toBytes, type Hex } from "viem";
import { hardhat } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ChainBroadcastError, createLedgerClient, hashFileBytes, ledgerAbi, Role } from "../../packages/chain/dist/index.js";

it("真实 HTTP 广播响应超时后，使用预计算哈希对账同一笔交易", async () => {
  const server = await hre.network.createServer("hardhat", "127.0.0.1", 0);
  const location = await server.listen();
  const upstream = `http://127.0.0.1:${location.port}`;
  let broadcastCount = 0;
  // 请求和响应原样转发，只延迟广播响应；执行结果全部来自真实 Hardhat 节点。
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const message = JSON.parse(body.toString("utf8"));
      const result = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body });
      const bytes = Buffer.from(await result.arrayBuffer());
      if (message.method === "eth_sendRawTransaction") {
        broadcastCount++;
        await setTimeout(750);
      }
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(bytes);
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error("代理转发失败"));
    }
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  try {
    const proxyAddress = proxy.address();
    assert.ok(proxyAddress && typeof proxyAddress === "object");
    const rpc = createPublicClient({ chain: hardhat, transport: http(upstream, { retryCount: 0 }) });
    const unlocked = createWalletClient({ chain: hardhat, transport: http(upstream) });
    const [funderAddress] = await unlocked.getAddresses();
    const funder = createWalletClient({ account: funderAddress, chain: hardhat, transport: http(upstream) });
    const account = privateKeyToAccount(generatePrivateKey());
    await rpc.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: account.address, value: parseEther("1") }) });
    const wallet = createWalletClient({ account, chain: hardhat, transport: http(upstream, { retryCount: 0 }) });
    const artifact = await hre.artifacts.readArtifact("AgentLedger");
    const deployment = await wallet.deployContract({ abi: ledgerAbi, bytecode: artifact.bytecode as Hex, args: [account.address] });
    const deployed = await rpc.waitForTransactionReceipt({ hash: deployment });
    assert.ok(deployed.contractAddress);
    const delayed = createPublicClient({ chain: hardhat,
      transport: http(`http://127.0.0.1:${proxyAddress.port}`, { timeout: 250, retryCount: 0 }),
    });
    const common = { chainId: hardhat.id, contractAddress: deployed.contractAddress, deploymentBlock: deployed.blockNumber };
    const client = await createLedgerClient({ ...common, publicClient: delayed, walletClient: wallet });
    let unknown: ChainBroadcastError | undefined;
    try {
      await client.registerAgent({ roles: [Role.DATA], manifestURI: "dev-fixture://timeout",
        manifestHash: hashFileBytes(toBytes("DEV_FIXTURE timeout")) });
    } catch (error) {
      assert.ok(error instanceof ChainBroadcastError);
      unknown = error;
    }
    assert.ok(unknown, "必须出现真实 HTTP timeout");
    assert.equal(unknown.receipt.status, "PENDING");
    assert.equal(keccak256(unknown.serializedTransaction), unknown.receipt.txHash);
    await createTestClient({ mode: "hardhat", chain: hardhat, transport: http(upstream) }).mine({ blocks: 64 });
    const reader = await createLedgerClient({ ...common, publicClient: rpc });
    const [receipt] = await reader.getReceipts({ txHash: unknown.receipt.txHash });
    assert.equal(receipt.status, "CONFIRMED");
    assert.equal(receipt.events?.[0].eventName, "AgentRegistered");
    assert.equal((await reader.getAgent(account.address)).registered, true);
    assert.equal(broadcastCount, 1);
    assert.equal(await rpc.getTransactionCount({ address: account.address }), 2);
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
    await server.close();
  }
});
