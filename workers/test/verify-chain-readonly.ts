import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ChainReceiptSchema } from "../../packages/contracts/src/index.ts";
import { loadWorkerChain, waitForTransaction } from "../src/chain.ts";
import { loadWorkerConfig } from "../src/config.ts";
import { jsonBytes } from "../src/content.ts";

const config = loadWorkerConfig();
const chain = await loadWorkerChain(config.privateKey);
const historical = JSON.parse(await readFile(new URL("../../packages/runtime-chain/test/fixtures/a-smoke-testnet.json", import.meta.url), "utf8"));
const source = historical.receipts[0];
const original = ChainReceiptSchema.parse({ chainId: source.chainId, contract: source.contract, txHash: source.txHash, blockNumber: source.blockNumber, status: source.status, signer: source.signer });
const output = new URL("../.local/chain-readonly.json", import.meta.url);
await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
const receipt = await waitForTransaction(chain, original, new AbortController().signal, async receipt => writeFile(output, jsonBytes(receipt)));
assert.equal(receipt.txHash, source.txHash);
assert.equal(receipt.status, "CONFIRMED");
assert.ok(receipt.events?.some(event => event.eventName === "AgentRegistered"));
console.log(JSON.stringify({ mode: "READONLY_REAL_CHAIN", sourceMode: historical.mode, txHash: receipt.txHash, status: receipt.status, eventIds: receipt.events?.map(event => event.eventId), workerTransactionsSent: 0 }));
