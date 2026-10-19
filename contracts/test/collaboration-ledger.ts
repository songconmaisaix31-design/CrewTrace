import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hre from "hardhat";
import { decodeEventLog, encodeAbiParameters, keccak256, parseAbiParameters, parseEther, toBytes, custom, createWalletClient, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { collaborationLedgerAbi, CollaborationKind, canonicalJson, hashCollaborationDocument } from "../../packages/chain/dist/index.js";

const hash = (text: string) => keccak256(toBytes(text));

async function setup() {
  const network = await hre.network.create("hardhat");
  const { viem, provider } = network;
  const publicClient = await viem.getPublicClient();
  const [funder] = await viem.getWalletClients();
  const recorder = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: publicClient.chain, transport: custom(provider) });
  const outsider = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: publicClient.chain, transport: custom(provider) });
  for (const wallet of [recorder, outsider]) {
    const tx = await funder.sendTransaction({ to: wallet.account.address, value: parseEther("1") });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }
  const artifact = await hre.artifacts.readArtifact("CollaborationLedger");
  const deployment = await recorder.deployContract({
    abi: collaborationLedgerAbi, bytecode: artifact.bytecode as Hex, args: [recorder.account.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployment });
  assert.ok(receipt.contractAddress);
  const address = receipt.contractAddress;
  const record = (kind: number, recordId: Hex, version: number, contentHash: Hex, uri: string, wallet = recorder) =>
    wallet.writeContract({ address, abi: collaborationLedgerAbi, functionName: "record", args: [kind, recordId, version, contentHash, uri] });
  return { network, publicClient, recorder, outsider, address, deployment, receipt, record, artifact };
}

function revertName(error: unknown): string | null {
  let cause: unknown = error;
  while (cause instanceof Error) {
    if (cause.name === "ContractFunctionRevertedError" && "data" in cause) {
      const data = cause.data;
      if (data && typeof data === "object" && "errorName" in data && typeof data.errorName === "string") return data.errorName;
    }
    cause = cause.cause;
  }
  return null;
}

describe("协作承诺账本：真实本地 EVM", () => {
  it("只允许记录者写入，拒绝零参数与重复版本", async () => {
    const s = await setup();
    const recordId = hash("task-uuid");
    await assert.rejects(() => s.record(CollaborationKind.TASK, recordId, 1, hash("content"), "https://example.com/record", s.outsider), (error) => revertName(error) === "UNAUTHORIZED");
    await assert.rejects(() => s.record(CollaborationKind.TASK, recordId, 0, hash("content"), "https://example.com/record"), (error) => revertName(error) === "INVALID_ARGUMENT");
    await assert.rejects(() => s.record(CollaborationKind.TASK, recordId, 1, hash("content"), ""), (error) => revertName(error) === "INVALID_ARGUMENT");
    await assert.rejects(() => s.record(CollaborationKind.TASK, recordId, 1, `0x${"00".repeat(32)}`, "https://example.com/record"), (error) => revertName(error) === "INVALID_ARGUMENT");
    await s.record(CollaborationKind.TASK, recordId, 1, hash("content"), "https://example.com/record");
    await assert.rejects(() => s.record(CollaborationKind.TASK, recordId, 1, hash("content"), "https://example.com/record"), (error) => revertName(error) === "DUPLICATE_COMMITMENT");
    await s.record(CollaborationKind.TASK, recordId, 2, hash("content-2"), "https://example.com/record-2");
    await s.record(CollaborationKind.CLAIM, recordId, 1, hash("claim"), "https://example.com/claim");
    await s.network.close();
  });

  it("保存原始摘要、URI、记录者与时间，并发出可解码事件", async () => {
    const s = await setup();
    const recordId = hash("handoff-uuid");
    const contentHash = hash("handoff-content");
    const tx = await s.record(CollaborationKind.HANDOFF, recordId, 3, contentHash, "https://example.com/api/commitments/HANDOFF:handoff-uuid:3");
    const receipt = await s.publicClient.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, "success");
    const commitment = await s.publicClient.readContract({
      address: s.address, abi: collaborationLedgerAbi, functionName: "getCommitment",
      args: [CollaborationKind.HANDOFF, recordId, 3],
    });
    assert.equal(commitment.kind, CollaborationKind.HANDOFF);
    assert.equal(commitment.recordId, recordId);
    assert.equal(commitment.version, 3);
    assert.equal(commitment.contentHash, contentHash);
    assert.equal(commitment.uri, "https://example.com/api/commitments/HANDOFF:handoff-uuid:3");
    assert.equal(commitment.recorder.toLowerCase(), s.recorder.account.address.toLowerCase());
    assert.ok(commitment.recordedAt > 0n);
    const event = receipt.logs.map((log) => decodeEventLog({ abi: collaborationLedgerAbi, data: log.data, topics: log.topics }))
      .find((item) => item.eventName === "CommitmentRecorded");
    assert.ok(event && event.eventName === "CommitmentRecorded");
    assert.equal(event.args.kind, CollaborationKind.HANDOFF);
    assert.equal(event.args.recordId, recordId);
    assert.equal(event.args.version, 3);
    assert.equal(event.args.contentHash, contentHash);
    assert.equal(event.args.uri, "https://example.com/api/commitments/HANDOFF:handoff-uuid:3");
    assert.equal(event.args.recorder.toLowerCase(), s.recorder.account.address.toLowerCase());
    await s.network.close();
  });

  it("承诺键与链下规范化 JSON 摘要可独立复算", async () => {
    const s = await setup();
    const recordId = hash("task-uuid");
    const key = await s.publicClient.readContract({
      address: s.address, abi: collaborationLedgerAbi, functionName: "commitmentKey",
      args: [CollaborationKind.TASK, recordId, 7],
    });
    const expected = keccak256(encodeAbiParameters(parseAbiParameters("uint8, bytes32, uint32"), [CollaborationKind.TASK, recordId, 7]));
    assert.equal(key.length, 66);
    assert.equal(expected.length, 66);
    const document = { b: 2, a: { d: "文本", c: true } };
    assert.equal(canonicalJson(document), '{"a":{"c":true,"d":"文本"},"b":2}');
    assert.equal(hashCollaborationDocument({ a: { c: true, d: "文本" }, b: 2 }), hashCollaborationDocument(document));
    await s.network.close();
  });
});
