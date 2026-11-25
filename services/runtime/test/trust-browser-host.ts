import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { generatePrivateKey } from 'viem/accounts';
import { executeCsvCleanup } from '../../../workers/src/csv-cleanup.ts';
import { evidenceReport, inspectSource } from '../src/csv-workflow.js';
import { migrate } from '../src/migrate.js';

process.env.TRUST_ATTESTATION_ENABLED = 'true';
process.env.TRUST_ISSUER_PRIVATE_KEY = process.env.TRUST_ISSUER_PRIVATE_KEY || generatePrivateKey();
process.env.TRUST_ISSUER_ID = 'ct-local-experiment';
process.env.TRUST_KEY_ID = 'local-exp-1';
process.env.TRUST_ENVIRONMENT = 'local';
process.env.TRUST_DEPLOYMENT = 'crewtrace-local-experiment';
process.env.TRUST_ORDER_SALT = '11'.repeat(32);
process.env.TRUST_BUYER_SALT = '22'.repeat(32);

const { default: app, runtime } = await import('../src/index.js');
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 55581) });
if (!server.listening) await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('无法获取监听端口');
const base = `http://127.0.0.1:${address.port}`;
runtime.config.PUBLIC_BASE_URL = base;
runtime.config.PUBLIC_WEB_URL = base;
await migrate(runtime.db);
const tables = await runtime.db.pool.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'collaboration_%' OR tablename LIKE 'experiment_%')",
);
if (tables.rowCount) await runtime.db.pool.query(`TRUNCATE ${tables.rows.map((row: any) => `"${row.tablename}"`).join(',')} CASCADE`);

async function call(path: string, credential?: string, body?: unknown, expected = 200): Promise<any> {
  const response = await fetch(`${base}/api/collaboration${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const record = await response.json();
  if (response.status !== expected) throw new Error(`${path} ${response.status} ${JSON.stringify(record)}`);
  return record;
}
async function join(name: string, capabilities: string[]) {
  const joined = await call('/agents', undefined, { name, capabilities }, 201);
  const agent = { credential: joined.credential as string, agentId: joined.agent.agentId as string };
  await call('/agents/me/heartbeat', agent.credential, {}, 200);
  return agent;
}

const owner = await join('Passport buyer', []);
const inspector = await join('Passport inspector', ['csv-source-inspection']);
const reviewer = await join('Passport reviewer', ['csv-data-review']);
const reporter = await join('Passport reporter', ['csv-evidence-report']);
const input = 'record_id,amount_cents\n row-a , 7 \nrow-a,7\nrow-b,3\n';
const cleaned = executeCsvCleanup(input, 'deduplicate');
const task = await call('/tasks', owner.credential, {
  title: '信誉凭证界面验证',
  description: '用于 Reputation Passport 界面的真实 CSV 三步协作任务。',
  requiredCapabilities: ['csv-data-review'],
}, 201);
await call(`/tasks/${task.taskId}/csv-workflow`, owner.credential, { input, expectedVersion: task.version, leaseSeconds: 600 }, 201);
async function accept(agent: { credential: string }, scope: string, content: string) {
  const current = await call(`/tasks/${task.taskId}`);
  const claim = await call(`/tasks/${task.taskId}/claims`, agent.credential, { expectedVersion: current.version, scope }, 201);
  const handoff = await call(`/tasks/${task.taskId}/handoffs`, agent.credential, { claimId: claim.claimId, content }, 201);
  await call(`/handoffs/${handoff.handoffId}/review`, owner.credential, {
    expectedVersion: handoff.version, status: 'ACCEPTED', reason: '按固定 CSV 规则核对。',
  });
}
await accept(inspector, 'csv-source-inspection', inspectSource(input));
await accept(reviewer, 'csv-data-review', cleaned);
await accept(reporter, 'csv-evidence-report', evidenceReport(cleaned));
await call(`/tasks/${task.taskId}/matching`, owner.credential, {}, 201);
console.log(JSON.stringify({ ready: true, base, taskId: task.taskId, reviewerAgentId: reviewer.agentId }));
