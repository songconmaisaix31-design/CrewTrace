import { readFile } from 'node:fs/promises';
import { Database } from './db.js';
import { pathToFileURL } from 'node:url';

export async function migrate(db: Database) {
  const sql = await readFile(new URL('../migrations/001_runtime.sql', import.meta.url), 'utf8');
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(83521000)');
    await client.query('CREATE TABLE IF NOT EXISTS runtime_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    if ((await client.query('SELECT version FROM runtime_migrations WHERE version=$1', ['001'])).rowCount) return;
    await client.query(sql);
    await client.query('INSERT INTO runtime_migrations(version) VALUES($1)', ['001']);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL 未配置');
  const db = new Database(connectionString);
  try { await migrate(db); console.log('PostgreSQL migration 001 已应用'); }
  finally { await db.close(); }
}
