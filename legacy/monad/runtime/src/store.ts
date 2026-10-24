import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@neondatabase/serverless';
import type { Database } from './db.js';
import { requireValue } from './errors.js';
import { EventsResponseSchema } from '../../../packages/contracts/src/index.ts';

export class Store {
  constructor(readonly db: Database) {}
  async write<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    // 写入顺序与事件提交顺序一致，BEGIN 与取锁共享一次往返。
    return this.db.transaction(operation,true);
  }
  async event(client: PoolClient, type: string, runId: string | null, taskId: string | null, attempt: number | null, data: unknown) {
    const eventId = randomUUID();
    const createdAt = new Date().toISOString();
    const receipt = data && typeof data==='object' && 'receipt' in data ? data.receipt : null;
    const { rows } = await client.query('INSERT INTO events(event_id,run_id,task_id,document) VALUES($1,$2,$3,$4) RETURNING seq', [eventId, runId, taskId, { eventId, runId, taskId, attempt, type, createdAt, receipt, data }]);
    return Number(rows[0].seq);
  }
  async events(runId: string, after: number) {
    const result = await this.db.pool.query(`SELECT e.seq,e.document FROM runs r LEFT JOIN LATERAL (
      SELECT seq,document FROM events WHERE run_id=r.id AND seq>$2 ORDER BY seq LIMIT 500
    ) e ON true WHERE r.id=$1 ORDER BY e.seq`, [runId, after]);
    requireValue(result.rows[0]);
    const rows = result.rows.filter(row => row.seq !== null);
    return EventsResponseSchema.parse({ events: rows.map(row => ({ ...row.document, seq: Number(row.seq) })), nextAfter: rows.length ? Number(rows[rows.length - 1].seq) : after });
  }
}
