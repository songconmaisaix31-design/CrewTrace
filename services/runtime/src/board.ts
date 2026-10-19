import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@neondatabase/serverless';
import {
  AnnouncementCreateSchema, AnnouncementSchema, NoteCreateSchema, NoteUpdateSchema, AgentNoteSchema, AuthenticatedAgentSchema,
} from '../../../packages/contracts/src/index.ts';
import { createAnnouncement,createAgentNote,updateAgentNote } from './domain/communications.ts';
import type { Application } from './application.js';
import { node, sameAgent, type Principal } from './auth.js';
import { AppError, requireValue } from './errors.js';

export class Board {
  constructor(readonly app: Application) {}
  async context(client: PoolClient,runId: string,taskId: string,artifactIds: string[] = []) {
    const task = await this.app.task(taskId,client);
    if (task.runId !== runId) throw new AppError(409,'INVALID_INPUT','任务与 runId 不匹配');
    for (const id of artifactIds) {
      const row = requireValue((await client.query('SELECT run_id FROM artifacts WHERE id=$1',[id])).rows[0]);
      if (row.run_id !== runId) throw new AppError(409,'ARTIFACT_MISMATCH','便签关联产物属于其他运行');
      await this.app.artifact(id,client);
    }
    return task;
  }
  async publish(principal: Principal,input: unknown) {
    const identity = node(principal);
    const request = AnnouncementCreateSchema.parse(input);
    return this.app.store.write(async client => {
      const task = await this.context(client,request.runId,request.taskId);
      const announcement = createAnnouncement(request,AuthenticatedAgentSchema.parse({ agentId: identity.agentId,runtimeId: identity.runtimeId,credentialId: identity.credentialId,registered: true,authenticated: true }),task,{ announcementId: randomUUID(),createdAt: new Date().toISOString() });
      await client.query('INSERT INTO announcements(id,author,run_id,task_id,document) VALUES($1,$2,$3,$4,$5)',[announcement.announcementId,announcement.author,announcement.runId,announcement.taskId,announcement]);
      await this.app.store.event(client,'ANNOUNCEMENT_PUBLISHED',announcement.runId,announcement.taskId,null,{ announcementId: announcement.announcementId });
      return announcement;
    });
  }
  async announcements(runId?: string,taskId?: string) {
    const rows = await this.app.db.pool.query('SELECT document FROM announcements WHERE ($1::text IS NULL OR run_id=$1) AND ($2::text IS NULL OR task_id=$2) ORDER BY created_at,id LIMIT 500',[runId??null,taskId??null]);
    return { announcements: rows.rows.map(row=>AnnouncementSchema.parse(row.document)) };
  }
  async createNote(principal: Principal,input: unknown) {
    const identity = node(principal);
    const request = NoteCreateSchema.parse(input);
    return this.app.store.write(async client => {
      const task = await this.context(client,request.runId,request.taskId,request.artifactIds);
      const now = new Date().toISOString();
      const note = createAgentNote(request,AuthenticatedAgentSchema.parse({ agentId: identity.agentId,runtimeId: identity.runtimeId,credentialId: identity.credentialId,registered: true,authenticated: true }),task,{ noteId: randomUUID(),createdAt: now });
      await client.query('INSERT INTO notes(id,author,run_id,task_id,version,document) VALUES($1,$2,$3,$4,$5,$6)',[note.noteId,note.author,note.runId,note.taskId,note.version,note]);
      await client.query('INSERT INTO note_versions(note_id,version,document) VALUES($1,$2,$3)',[note.noteId,note.version,note]);
      await this.app.store.event(client,'NOTE_CREATED',note.runId,note.taskId,null,{ noteId: note.noteId,version: 1 });
      return note;
    });
  }
  async updateNote(principal: Principal,noteId: string,input: unknown) {
    const identity = node(principal);
    const request = NoteUpdateSchema.parse(input);
    return this.app.store.write(async client => {
      const current = AgentNoteSchema.parse(requireValue((await client.query('SELECT document FROM notes WHERE id=$1 FOR UPDATE',[noteId])).rows[0]).document);
      await this.context(client,current.runId,current.taskId,request.artifactIds);
      const note = updateAgentNote(current,request,AuthenticatedAgentSchema.parse({ agentId: identity.agentId,runtimeId: identity.runtimeId,credentialId: identity.credentialId,registered: true,authenticated: true }),new Date().toISOString());
      const result = await client.query('UPDATE notes SET document=$2,version=$3 WHERE id=$1 AND version=$4',[noteId,note,note.version,request.expectedVersion]);
      if (result.rowCount !== 1) throw new AppError(409,'VERSION_CONFLICT','便签已被其他请求更新');
      await client.query('INSERT INTO note_versions(note_id,version,document) VALUES($1,$2,$3)',[note.noteId,note.version,note]);
      await this.app.store.event(client,'NOTE_UPDATED',note.runId,note.taskId,null,{ noteId: note.noteId,version: note.version });
      return note;
    });
  }
  async notes(runId?: string,taskId?: string) {
    const rows = await this.app.db.pool.query('SELECT document FROM notes WHERE ($1::text IS NULL OR run_id=$1) AND ($2::text IS NULL OR task_id=$2) ORDER BY created_at,id LIMIT 500',[runId??null,taskId??null]);
    return { notes: rows.rows.map(row=>AgentNoteSchema.parse(row.document)) };
  }
  async note(noteId: string) {
    const current = AgentNoteSchema.parse(requireValue((await this.app.db.pool.query('SELECT document FROM notes WHERE id=$1',[noteId])).rows[0]).document);
    const versions = await this.app.db.pool.query('SELECT document FROM note_versions WHERE note_id=$1 ORDER BY version',[noteId]);
    return { ...current,versions: versions.rows.map(row=>AgentNoteSchema.parse(row.document)) };
  }
}
