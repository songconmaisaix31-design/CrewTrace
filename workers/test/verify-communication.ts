import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { AnnouncementsResponseSchema, EventsResponseSchema, NotesResponseSchema, RunDetailSchema } from "../../packages/contracts/src/index.ts";
import { jsonBytes } from "../src/content.ts";

const evidence = new URL("../evidence/communication/", import.meta.url);
const original = JSON.parse(await readFile(new URL("run.json", evidence), "utf8"));
const base = "http://127.0.0.1:3400";
async function read(path: string) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200);
  return response.json();
}
const run = RunDetailSchema.parse(await read(`/api/runs/${original.runId}`));
const announcements = AnnouncementsResponseSchema.parse(await read(`/api/announcements?runId=${original.runId}`));
const notes = NotesResponseSchema.parse(await read(`/api/notes?runId=${original.runId}`));
const events = EventsResponseSchema.parse(await read(`/api/runs/${original.runId}/events?after=0`));
const logs = await Promise.all(["data-a.json", "analysis.json"].map(async name => JSON.parse(await readFile(new URL(name, evidence), "utf8"))));
const authors = logs.map(log => log[0].agentId);
assert.notEqual(authors[0], authors[1]);
assert.notEqual(logs[0][0].pid, logs[1][0].pid);
for (let index = 0; index < logs.length; index++) {
  const log = logs[index];
  const published = log.find((item: { event: string }) => item.event === "mcp_published");
  assert.deepEqual(announcements.announcements.find(item => item.announcementId === published.announcement.announcementId), published.announcement);
  assert.deepEqual(notes.notes.find(item => item.noteId === published.note.noteId), published.note);
  assert.equal(published.note.version, 2);
  assert.ok(log.some((item: { event: string; peerAuthors?: string[] }) => item.event === "mcp_read" && item.peerAuthors?.includes(authors[1 - index])));
  assert.equal(log.at(-1).event, "worker_stopped");
  assert.equal(log.at(-1).signal, true);
}
assert.ok(run.tasks.every(task => task.status === "OPEN"));
assert.equal(run.runtimeStatus, "CANCELLED");
assert.equal(run.assessments.length, 0);
assert.equal(run.artifacts.length, 0);
assert.ok(events.events.some(event => event.type === "ANNOUNCEMENT_PUBLISHED"));
assert.ok(events.events.some(event => event.type === "NOTE_UPDATED"));
await Promise.all([
  writeFile(new URL("run-detail.json", evidence), jsonBytes(run)), writeFile(new URL("announcements.json", evidence), jsonBytes(announcements)),
  writeFile(new URL("notes.json", evidence), jsonBytes(notes)), writeFile(new URL("events.json", evidence), jsonBytes(events)),
]);
console.log(JSON.stringify({ runId: original.runId, independentPids: logs.map(log => log[0].pid), announcements: announcements.announcements.length, notes: notes.notes.length, events: events.events.length, peerReadsVerified: true, independentlyStopped: true, runCancelled: true }));
