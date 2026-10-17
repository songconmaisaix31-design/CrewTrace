import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from './db.js';
import { requireValue } from './errors.js';

export class Store {
  constructor(readonly db: Database) {}
  async write<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.db.transaction(async client => {
      // 写入顺序与事件提交顺序一致，增量读取不会跳过较早提交。
      await client.query('SELECT pg_advisory_xact_lock(83521001)');
      return operation(client);
    });
  }
  async event(client: PoolClient, type: string, runId: string | null, taskId: string | null, attempt: number | null, data: unknown) {
    const eventId = randomUUID();
    const createdAt = new Date().toISOString();
    const { rows } = await client.query('INSERT INTO events(event_id,run_id,task_id,document) VALUES($1,$2,$3,$4) RETURNING seq', [eventId, runId, taskId, { eventId, runId, taskId, attempt, type, createdAt, data }]);
    return Number(rows[0].seq);
  }
  async events(runId: string, after: number) {
    requireValue((await this.db.pool.query('SELECT id FROM runs WHERE id=$1', [runId])).rows[0]);
    const { rows } = await this.db.pool.query('SELECT seq, document FROM events WHERE run_id=$1 AND seq>$2 ORDER BY seq LIMIT 500', [runId, after]);
    return { events: rows.map(row => ({ ...row.document, seq: Number(row.seq) })), nextAfter: rows.length ? Number(rows[rows.length - 1].seq) : after };
  }
}
