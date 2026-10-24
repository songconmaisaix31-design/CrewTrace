import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnnouncementCreateSchema, ApplicationError, NoteCreateSchema, hashUtf8,
  type AuthenticatedAgent, type Task,
} from "../../../../packages/contracts/src/index.ts";
import { createAgentNote, createAnnouncement, createFixedRun, updateAgentNote } from "../../src/domain/index.ts";

const author = "0x0000000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";
const now = "2026-10-17T08:00:00.000Z";
const actor: AuthenticatedAgent = { agentId: author, runtimeId: "policy-example", credentialId: "credential-from-node-authentication", registered: true, authenticated: true };
const run = createFixedRun({ runId: "communication-example", inputHash: hashUtf8("公开政策输入"), criteriaHash: hashUtf8("公开政策规则"), validator: other }, now);
const task: Task = run.tasks[0]!;
const input = { runId: run.runId, taskId: task.taskId, body: "数据规范化完成，等待正式验收。", topic: "任务进度", artifactIds: [] };
function errorCode(code: string): (error: unknown) => boolean {
  return error => error instanceof ApplicationError && error.code === code;
}

test("公告和便签作者仅来自节点认证上下文，文字不改变任务状态", () => {
  const before = structuredClone(task);
  const { artifactIds: omitted, ...announcementInput } = input;
  assert.equal(omitted.length, 0);
  const announcement = createAnnouncement({ ...announcementInput, type: "PROGRESS" }, actor, task, { announcementId: "announcement-1", createdAt: now });
  const note = createAgentNote(input, actor, task, { noteId: "note-1", createdAt: now });
  assert.equal(announcement.author, author);
  assert.equal(note.author, author);
  assert.equal(note.version, 1);
  assert.deepEqual(task, before);
  assert.equal(AnnouncementCreateSchema.safeParse({ ...announcementInput, type: "RESULT", author: other }).success, false);
  assert.equal(NoteCreateSchema.safeParse({ ...input, author: other }).success, false);
});

test("未登记、未认证与跨运行绑定均拒绝", () => {
  assert.throws(() => createAgentNote(input, { ...actor, authenticated: false } as unknown as AuthenticatedAgent, task, { noteId: "note-1", createdAt: now }), errorCode("UNAUTHORIZED"));
  assert.throws(() => createAgentNote(input, { ...actor, registered: false } as unknown as AuthenticatedAgent, task, { noteId: "note-1", createdAt: now }), errorCode("UNAUTHORIZED"));
  assert.throws(() => createAgentNote({ ...input, runId: "another-run" }, actor, task, { noteId: "note-1", createdAt: now }), errorCode("INVALID_INPUT"));
});

test("便签乐观并发检查、作者权限与固定绑定", () => {
  const note = createAgentNote(input, actor, task, { noteId: "note-1", createdAt: now });
  const update = { expectedVersion: 1, body: "请下游读取已验收版本。", topic: "成果交接", artifactIds: ["artifact-1"] };
  const updated = updateAgentNote(note, update, actor, "2026-10-17T08:00:01.000Z");
  assert.equal(updated.version, 2);
  assert.equal(updated.runId, note.runId);
  assert.equal(updated.taskId, note.taskId);
  assert.equal(updated.author, author);
  assert.equal(updated.createdAt, now);
  assert.equal(note.version, 1);
  assert.throws(() => updateAgentNote(updated, update, actor, "2026-10-17T08:00:02.000Z"), errorCode("VERSION_CONFLICT"));
  assert.throws(() => updateAgentNote(note, update, { ...actor, agentId: other }, now), errorCode("UNAUTHORIZED"));
});
