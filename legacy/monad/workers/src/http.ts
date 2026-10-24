import { z } from "zod";
import {
  AcceptTaskRequestSchema, AgentNoteSchema, AgentProfileSchema, AnnouncementCreateSchema, AnnouncementSchema,
  ArtifactSchema, ArtifactUploadRequestSchema, HeartbeatRequestSchema, NoteCreateSchema, NoteUpdateSchema,
  HandoffSchema, HandoffUpdateRequestSchema, ModelCallRequestSchema, ModelCallReservationSchema,
  WorkerJobsResponseSchema, SubmitTaskRequestSchema, TaskSchema, IdSchema, type WorkerJob,
  type AnnouncementCreate, type ArtifactUploadRequest, type HeartbeatRequest, type NoteCreate, type NoteUpdate,
  type SubmitTaskRequest,
} from "../../packages/contracts/src/index.ts";
import { requireValue, WorkerError } from "./errors.ts";

export type { WorkerJob } from "../../packages/contracts/src/index.ts";

const FAST_REQUEST_TIMEOUT_MS = 20_000;
const CHAIN_REQUEST_TIMEOUT_MS = 120_000;
const ProgressResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("PROGRESSED"), runs: z.array(z.strictObject({ runId: IdSchema, status: z.string().min(1) })).max(2) }),
  z.strictObject({ status: z.literal("PROGRESS_IN_FLIGHT") }),
]);

export class WorkerHttp {
  constructor(readonly baseURL: string, private readonly credential: string, private readonly signal?: AbortSignal) {}

  private async request(path: string, method = "GET", body?: unknown, timeoutMs = FAST_REQUEST_TIMEOUT_MS): Promise<Response> {
    const url = new URL(path, this.baseURL + "/");
    requireValue(url.origin === new URL(this.baseURL).origin, "UNAUTHORIZED", "禁止向其他源发送节点凭证");
    const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${this.credential}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: "error" });
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json());
      throw new WorkerError(error.error.code, `HTTP ${response.status}: ${error.error.message}`);
    }
    return response;
  }

  async heartbeat(input: HeartbeatRequest) {
    const result = await (await this.request("/worker/heartbeat", "POST", HeartbeatRequestSchema.parse(input))).json();
    return AgentProfileSchema.parse(result);
  }

  async progress() {
    return ProgressResponseSchema.parse(await (await this.request("/worker/progress", "POST", {}, CHAIN_REQUEST_TIMEOUT_MS)).json());
  }

  async health() {
    return z.object({ status: z.string(), database: z.string(), chain: z.object({ configured: z.boolean(), code: z.string().nullable() }), validator: z.object({ configured: z.boolean(), code: z.string().nullable() }) }).parse(await (await this.request("/health")).json());
  }

  async jobs() {
    return WorkerJobsResponseSchema.parse(await (await this.request("/worker/jobs")).json()).jobs;
  }

  async accept(taskId: string, attempt: number) {
    return this.request(`/worker/tasks/${taskId}/accept`, "POST", AcceptTaskRequestSchema.parse({ attempt }));
  }

  async reserveModelCall(taskId: string, attempt: number) {
    return ModelCallReservationSchema.parse(await (await this.request(`/worker/tasks/${taskId}/model-calls`, "POST", ModelCallRequestSchema.parse({ attempt }))).json());
  }

  async acceptHandoff(handoffId: string) {
    return HandoffSchema.parse(await (await this.request(`/worker/handoffs/${encodeURIComponent(handoffId)}`, "POST", HandoffUpdateRequestSchema.parse({ status: "ACCEPTED", reason: "已下载并检查相同版本的已验收上游文件、schema 与原始字节摘要。" }))).json());
  }

  async upload(input: ArtifactUploadRequest) {
    return ArtifactSchema.parse(await (await this.request("/worker/artifacts", "POST", ArtifactUploadRequestSchema.parse(input))).json());
  }

  async submit(taskId: string, input: SubmitTaskRequest) {
    return TaskSchema.parse(await (await this.request(`/worker/tasks/${taskId}/submit`, "POST", SubmitTaskRequestSchema.parse(input), CHAIN_REQUEST_TIMEOUT_MS)).json());
  }

  async download(uri: string): Promise<Buffer> {
    return Buffer.from(await (await this.request(uri)).arrayBuffer());
  }

  async announce(input: AnnouncementCreate) {
    return AnnouncementSchema.parse(await (await this.request("/api/announcements", "POST", AnnouncementCreateSchema.parse(input))).json());
  }

  async announcements(runId: string, taskId: string) {
    return z.object({ announcements: z.array(AnnouncementSchema) }).parse(await (await this.request(`/api/announcements?runId=${encodeURIComponent(runId)}&taskId=${taskId}`)).json()).announcements;
  }

  async createNote(input: NoteCreate) {
    return AgentNoteSchema.parse(await (await this.request("/api/notes", "POST", NoteCreateSchema.parse(input))).json());
  }

  async notes(runId: string, taskId: string) {
    return z.object({ notes: z.array(AgentNoteSchema) }).parse(await (await this.request(`/api/notes?runId=${encodeURIComponent(runId)}&taskId=${taskId}`)).json()).notes;
  }

  async updateNote(noteId: string, input: NoteUpdate) {
    return AgentNoteSchema.parse(await (await this.request(`/api/notes/${encodeURIComponent(noteId)}`, "PATCH", NoteUpdateSchema.parse(input))).json());
  }
}
