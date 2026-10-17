import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@neondatabase/serverless';
import type { z } from 'zod';
import type { Application } from './application.js';
import type { Principal } from './auth.js';
import { AppError,requireValue } from './errors.js';

type Table = 'collaboration_agents' | 'collaboration_tasks' | 'collaboration_notes' | 'collaboration_proposals' | 'collaboration_claims' | 'collaboration_handoffs';

export function collaborator(principal: Principal) {
  if (principal.kind!=='collaborator') throw new AppError(403,'UNAUTHORIZED','需要公开协作 Agent 凭证');
  return principal;
}

export function expectedVersion(actual: number,expected: number) {
  if (actual!==expected) throw new AppError(409,'VERSION_CONFLICT','记录版本已变化，请读取当前版本');
}

export function sameCollaborator(actual: string,expected: string) {
  if (actual!==expected) throw new AppError(403,'UNAUTHORIZED','当前 Agent 无权修改该记录');
}

export class CollaborationStore {
  constructor(readonly app: Application) {}

  async record<T>(table: Table,id: string,schema: z.ZodType<T>,client: Pick<PoolClient,'query'> = this.app.db.pool): Promise<T> {
    const row = requireValue((await client.query(`SELECT document FROM ${table} WHERE id=$1`,[id])).rows[0]);
    return schema.parse(row.document);
  }

  async write<T>(principal: Principal,operation: (client: PoolClient,agentId: string)=>Promise<T>): Promise<T> {
    const actor=collaborator(principal);
    return this.app.store.write(async client=>{
      const credential=(await client.query('SELECT agent_id FROM collaboration_credentials WHERE token_hash=$1 AND revoked_at IS NULL',[actor.credentialId])).rows[0];
      if (!credential || credential.agent_id!==actor.agentId) throw new AppError(401,'UNAUTHORIZED','Agent 凭证已撤销');
      return operation(client,actor.agentId);
    });
  }

  async event(client: PoolClient,type: string,actor: string,taskId: string | null,data: unknown) {
    const eventId=randomUUID(),createdAt=new Date().toISOString();
    const document={eventId,type,actorAgentId:actor,taskId,data,createdAt};
    const row=(await client.query('INSERT INTO collaboration_events(event_id,actor_id,task_id,document) VALUES($1,$2,$3,$4) RETURNING seq',[eventId,actor,taskId,document])).rows[0];
    return {...document,seq:Number(row.seq)};
  }
}
