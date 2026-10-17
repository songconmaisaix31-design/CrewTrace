import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { CreateRunWithInputRequestSchema, RunSchema } from "../../packages/contracts/src/index.ts";
import { CRITERIA_HASH } from "../src/criteria.ts";
import { contentHash, jsonBytes, utf8 } from "../src/content.ts";
import { requireValue } from "../src/errors.ts";

requireValue(process.env.ADMIN_TOKEN, "ADMIN_NOT_CONFIGURED", "需要真实管理凭证");
const baseURL = "http://127.0.0.1:3400";
const output = new URL("../.local/communication-run.json", import.meta.url);
if (process.argv.includes("--cancel")) {
  const run = RunSchema.parse(JSON.parse(await readFile(output, "utf8")));
  const response = await fetch(`${baseURL}/admin/runs/${run.runId}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } });
  requireValue(response.ok, "CANCEL_FAILED", `取消实际测试运行 HTTP ${response.status}`);
  console.log(JSON.stringify({ runId: run.runId, cancelled: true }));
} else {
  const source = await readFile(new URL("../fixtures/round-1.csv", import.meta.url));
  const identities = JSON.parse(await readFile(new URL("../identities.json", import.meta.url), "utf8"));
  const validator = identities.identities.find((identity: { name: string }) => identity.name === "report").agentId;
  const request = CreateRunWithInputRequestSchema.parse({ runId: `worker-communication-${randomUUID()}`, inputHash: contentHash(source), inputContent: utf8(source), criteriaHash: CRITERIA_HASH, validator });
  const response = await fetch(`${baseURL}/api/runs`, { method: "POST", headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
  requireValue(response.ok, "CREATE_RUN_FAILED", `创建实际测试运行 HTTP ${response.status}`);
  const run = RunSchema.parse(await response.json());
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await writeFile(output, jsonBytes(run));
  console.log(JSON.stringify({ runId: run.runId, taskId: run.tasks.find(task => task.role === "DATA")!.taskId, status: run.status }));
}
