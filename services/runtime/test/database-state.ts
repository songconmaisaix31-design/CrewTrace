import { Database } from '../src/db.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
const db = new Database(process.env.DATABASE_URL);
try {
  const records = await db.pool.query("SELECT document->>'type' AS type,created_at FROM events ORDER BY seq DESC LIMIT 10");
  const sessions = await db.pool.query("SELECT state,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()");
  console.log(JSON.stringify({ events: records.rows,sessions: sessions.rows }));
} finally { await db.close(); }
