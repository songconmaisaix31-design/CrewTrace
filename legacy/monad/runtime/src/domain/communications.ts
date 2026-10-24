import {
  AddressSchema, AgentNoteSchema, AnnouncementCreateSchema, AnnouncementSchema, ApplicationError,
  AuthenticatedAgentSchema, NoteCreateSchema, NoteUpdateSchema, TaskSchema, TimestampSchema,
  type AgentNote, type Announcement, type AnnouncementCreate, type AuthenticatedAgent,
  type NoteCreate, type NoteUpdate, type Task,
} from "../../../../packages/contracts/src/index.ts";

function assertScope(input: { runId: string; taskId: string }, task: Task): void {
  const checked = TaskSchema.parse(task);
  if (input.runId !== checked.runId || input.taskId !== checked.taskId) {
    throw new ApplicationError("INVALID_INPUT", "公告或便签绑定的 runId 与 taskId 不一致");
  }
}

function assertActor(actor: AuthenticatedAgent): AuthenticatedAgent {
  const checked = AuthenticatedAgentSchema.safeParse(actor);
  if (!checked.success) throw new ApplicationError("UNAUTHORIZED", "发言需要已登记且通过节点凭证认证的 Agent");
  return checked.data;
}

export function createAnnouncement(input: AnnouncementCreate, actor: AuthenticatedAgent, task: Task, meta: { announcementId: string; createdAt: string }): Announcement {
  const author = assertActor(actor).agentId;
  const request = AnnouncementCreateSchema.parse(input);
  assertScope(request, task);
  return AnnouncementSchema.parse({ ...request, ...meta, author });
}

export function createAgentNote(input: NoteCreate, actor: AuthenticatedAgent, task: Task, meta: { noteId: string; createdAt: string }): AgentNote {
  const author = assertActor(actor).agentId;
  const request = NoteCreateSchema.parse(input);
  assertScope(request, task);
  return AgentNoteSchema.parse({ ...request, ...meta, author, version: 1, updatedAt: meta.createdAt });
}

export function updateAgentNote(note: AgentNote, input: NoteUpdate, actor: AuthenticatedAgent, updatedAt: string): AgentNote {
  const identity = assertActor(actor);
  const current = AgentNoteSchema.parse(note);
  const request = NoteUpdateSchema.parse(input);
  const time = TimestampSchema.parse(updatedAt);
  if (AddressSchema.parse(identity.agentId) !== current.author) throw new ApplicationError("UNAUTHORIZED", "只有作者可以更新自己的便签");
  if (request.expectedVersion !== current.version) {
    throw new ApplicationError("VERSION_CONFLICT", "便签版本已变化，请读取当前版本", { expectedVersion: request.expectedVersion, currentVersion: current.version });
  }
  if (Date.parse(time) < Date.parse(current.updatedAt)) throw new ApplicationError("INVALID_INPUT", "更新时间不能早于当前便签时间");
  return AgentNoteSchema.parse({ ...current, body: request.body, topic: request.topic, artifactIds: request.artifactIds, version: current.version + 1, updatedAt: time });
}
