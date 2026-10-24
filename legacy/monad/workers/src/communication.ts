import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { HashSchema } from "../../packages/contracts/src/index.ts";
import { loadWorkerConfig } from "./config.ts";
import { exact, jsonBytes } from "./content.ts";
import { WorkerHttp } from "./http.ts";
import { WorkerBoard } from "./mcp.ts";

export async function communicate(runId: string, taskIdInput: string, signal: AbortSignal) {
  const taskId = HashSchema.parse(taskIdInput);
  const config = loadWorkerConfig();
  const http = new WorkerHttp(config.serviceURL, config.nodeCredential, signal);
  const board = new WorkerBoard(config.serviceURL, config.nodeCredential, signal);
  const tools = await board.connect();
  const output = join(config.outputDirectory, `communication-${Date.now()}`);
  await mkdir(output, { recursive: true });
  const audit: unknown[] = [{ event: "mcp_connected", pid: process.pid, agentId: config.agentId, runtimeId: config.runtimeId, tools, createdAt: new Date().toISOString() }];
  const save = async () => writeFile(join(output, "communication.json"), jsonBytes(audit));
  try {
    const profile = await http.heartbeat({ runtimeId: config.runtimeId, activeTasks: 0, maxConcurrency: 1 });
    exact(profile.agentId, config.agentId, "节点凭证与签名地址不符");
    const jobs = await http.jobs();
    audit.push({ event: "http_jobs", count: jobs.length, createdAt: new Date().toISOString() });
    const health = await http.health();
    audit.push({ event: "service_health", health, createdAt: new Date().toISOString() });
    const dependencyMessage = health.chain.configured ? "任务服务已配置链适配器；本次连接诊断未执行链提交。" : `任务服务缺少链适配器：${health.chain.code}；链提交尚未执行。`;
    const announcement = await board.announce({ runId, taskId, topic: `${config.role} 节点在线`, type: health.chain.configured ? "PROGRESS" : "BLOCKER", body: `独立 Worker 已通过真实 MCP 连接。${dependencyMessage}` });
    const note = await board.createNote({ runId, taskId, topic: `${config.role} 执行条件`, artifactIds: [], body: dependencyMessage });
    const updated = await board.updateNote(note.noteId, { expectedVersion: note.version, topic: note.topic, artifactIds: [], body: `已发布节点进度，正在读取其他 Agent 的公告。${dependencyMessage}` });
    exact(updated.version, note.version + 1, "便签更新版本不符");
    audit.push({ event: "mcp_published", announcement, note: updated, createdAt: new Date().toISOString() });
    await save();
    console.log(JSON.stringify({ event: "worker_communicating", pid: process.pid, agentId: config.agentId, noteId: updated.noteId, noteVersion: updated.version, output }));
    while (!signal.aborted) {
      const [announcements, notes] = await Promise.all([board.announcements(runId), board.notes(runId)]);
      const peers = announcements.announcements.filter(item => item.author !== config.agentId);
      audit.push({ event: "mcp_read", announcementIds: announcements.announcements.map(item => item.announcementId), peerAuthors: [...new Set(peers.map(item => item.author))], noteIds: notes.notes.map(item => item.noteId), createdAt: new Date().toISOString() });
      await save();
      await http.heartbeat({ runtimeId: config.runtimeId, activeTasks: 0, maxConcurrency: 1 });
      console.log(JSON.stringify({ event: "peer_messages_read", agentId: config.agentId, peerCount: peers.length, notesCount: notes.notes.length }));
      await setTimeout(10_000, undefined, { signal });
    }
  } finally {
    audit.push({ event: "worker_stopped", pid: process.pid, createdAt: new Date().toISOString(), signal: signal.aborted });
    await save();
    await board.close();
  }
}
