import { readFile } from 'node:fs/promises';
import { Database } from './db.js';
import { pathToFileURL } from 'node:url';

export async function migrate(db: Database) {
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(83521000)');
    await client.query('CREATE TABLE IF NOT EXISTS runtime_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const [version,file] of [['001','001_runtime.sql'],['002','002_execution.sql'],['003','003_chain_evidence.sql'],['004','004_chain_recovery.sql'],['005','005_agent_capacity.sql'],['006','006_public_collaboration.sql'],['007','007_collaboration_claims.sql']]) {
      if ((await client.query('SELECT version FROM runtime_migrations WHERE version=$1', [version])).rowCount) continue;
      await client.query(await readFile(new URL(`../migrations/${file}`, import.meta.url),'utf8'));
      await client.query('INSERT INTO runtime_migrations(version) VALUES($1)', [version]);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL 未配置');
  const db = new Database(connectionString);
  try { await migrate(db); console.log('PostgreSQL migrations 已应用'); }
  finally { await db.close(); }
}
