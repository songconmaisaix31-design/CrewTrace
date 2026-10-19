import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import {
  AgentNoteSchema, AnnouncementCreateSchema, AnnouncementSchema, NoteCreateSchema, NoteUpdateSchema,
  type AnnouncementCreate, type NoteCreate, type NoteUpdate,
} from "../../packages/contracts/src/index.ts";
import { requireValue, WorkerError } from "./errors.ts";

export class WorkerBoard {
  private readonly client = new Client({ name: "co-vibe-worker", version: "1.0.0" });
  private readonly transport: StreamableHTTPClientTransport;

  constructor(baseURL: string, credential: string, signal: AbortSignal) {
    const endpoint = new URL("/mcp", baseURL);
    this.transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${credential}` }, redirect: "error", signal },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      fetch: async (input, init) => {
        const url = new URL(input);
        requireValue(url.origin === endpoint.origin, "UNAUTHORIZED", "禁止向其他源发送 MCP 凭证");
        const signals = [signal, AbortSignal.timeout(20_000)];
        if (init?.signal) signals.push(init.signal);
        return fetch(input, { ...init, redirect: "error", signal: AbortSignal.any(signals) });
      },
    });
  }

  async connect() {
    await this.client.connect(this.transport);
    const tools = await this.client.listTools();
    for (const name of ["publish_announcement", "list_announcements", "create_note", "list_notes", "get_note", "update_note"]) requireValue(tools.tools.some(tool => tool.name === name), "MCP_TOOL_MISSING", `MCP 未提供 ${name}`);
    return tools.tools.map(tool => tool.name);
  }

  async close() { await this.client.close(); }

  private async call<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const result = await this.client.callTool({ name, arguments: args });
    requireValue(Array.isArray(result.content) && result.content.length === 1 && result.content[0].type === "text", "MCP_RESULT_INVALID", "MCP 必须返回单个 JSON 文本");
    const data = JSON.parse(result.content[0].text as string);
    if (result.isError) {
      const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(data);
      throw new WorkerError(error.error.code, error.error.message);
    }
    return schema.parse(data);
  }

  announce(input: AnnouncementCreate) { return this.call("publish_announcement", AnnouncementCreateSchema.parse(input), AnnouncementSchema); }
  announcements(runId: string, taskId?: string) { return this.call("list_announcements", { runId, ...(taskId ? { taskId } : {}) }, z.object({ announcements: z.array(AnnouncementSchema) })); }
  createNote(input: NoteCreate) { return this.call("create_note", NoteCreateSchema.parse(input), AgentNoteSchema); }
  notes(runId: string, taskId?: string) { return this.call("list_notes", { runId, ...(taskId ? { taskId } : {}) }, z.object({ notes: z.array(AgentNoteSchema) })); }
  note(noteId: string) { return this.call("get_note", { noteId }, AgentNoteSchema.extend({ versions: z.array(AgentNoteSchema) })); }
  updateNote(noteId: string, request: NoteUpdate) { return this.call("update_note", { noteId, request: NoteUpdateSchema.parse(request) }, AgentNoteSchema); }
}
