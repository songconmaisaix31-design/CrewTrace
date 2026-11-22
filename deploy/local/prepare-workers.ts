import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../services/runtime/src/config.js';
import { Database } from '../../services/runtime/src/db.js';
import { Application } from '../../services/runtime/src/application.js';
import { Collaboration } from '../../services/runtime/src/collaboration.js';
import { tokenHash } from '../../services/runtime/src/auth.js';

/** 复用或创建三个独立 CSV Worker 身份，凭证只写入 .local（已被 .gitignore 排除）。 */

const ROLES = ['csv-source-inspection', 'csv-data-review', 'csv-evidence-report'] as const;
type Worker = { role: string; agentId: string; credential: string };

const localDir = resolve(import.meta.dirname, '../../.local');
const statePath = resolve(localDir, 'workers.json');
mkdirSync(localDir, { recursive: true });

const config = loadConfig();
const db = new Database(config.DATABASE_URL);
try {
  const app = new Application(db, config);
  const collaboration = new Collaboration(app);
  const saved: Worker[] = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as Worker[] : [];
  const workers: Worker[] = [];
  for (const role of ROLES) {
    const existing = saved.find(worker => worker.role === role);
    if (existing) {
      const alive = await db.pool.query(
        'SELECT 1 FROM collaboration_credentials WHERE token_hash=$1 AND agent_id=$2 AND revoked_at IS NULL',
        [tokenHash(existing.credential), existing.agentId],
      );
      if (alive.rowCount) { workers.push(existing); continue; }
    }
    const { agent, credential } = await collaboration.register({ name: `Local Demo Worker · ${role}`, capabilities: [role] });
    workers.push({ role, agentId: agent.agentId, credential });
  }
  const temporary = `${statePath}.tmp`;
  writeFileSync(temporary, JSON.stringify(workers, null, 2), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, statePath);
  const envPath = resolve(localDir, 'workers.env');
  const envTemporary = `${envPath}.tmp`;
  const envBody = [
    `WORKER_AGENT_IDS=${workers.map(worker => worker.agentId).join(',')}`,
    ...workers.map((worker, index) => `WORKER_${index + 1}_CREDENTIAL=${worker.credential}`),
    '',
  ].join('\n');
  writeFileSync(envTemporary, envBody, { mode: 0o600 });
  chmodSync(envTemporary, 0o600);
  renameSync(envTemporary, envPath);
  console.log(envBody);
} finally {
  await db.close();
}
