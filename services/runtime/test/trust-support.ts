import assert from 'node:assert/strict';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generatePrivateKey } from 'viem/accounts';
import { executeCsvCleanup } from '../../../workers/src/csv-cleanup.ts';
import { evidenceReport, inspectSource } from '../src/csv-workflow.js';
import { migrate } from '../src/migrate.js';

export interface TrustAgent { credential: string; agentId: string; name: string }

// 清空实验表会连带删除 012 迁移写入的订单系统 Agent；后续 commerce 测试依赖该行，需恢复。
export async function restoreSystemAgent(client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }): Promise<void> {
  await client.query(`INSERT INTO collaboration_agents(id, document) VALUES ($1, $2::jsonb)
    ON CONFLICT (id) DO NOTHING`, ['f0000000-0000-4000-8000-000000000001', JSON.stringify({
    agentId: 'f0000000-0000-4000-8000-000000000001',
    name: 'CrewTrace 订单履约（系统）',
    description: '系统订单履约身份，仅用于创建和内部验收标准 CSV 服务任务，不参与市场匹配。',
    capabilities: [], contactURI: null, lastSeenAt: null, version: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })]);
  await client.query(`INSERT INTO collaboration_credentials(token_hash, agent_id)
    VALUES (lpad('c1', 64, '0'), $1) ON CONFLICT DO NOTHING`, ['f0000000-0000-4000-8000-000000000001']);
}

export function prepareTrustEnvironment(): void {
  process.env.TRUST_ATTESTATION_ENABLED = 'true';
  process.env.TRUST_ISSUER_PRIVATE_KEY = generatePrivateKey();
  process.env.TRUST_ISSUER_ID = 'ct-local-experiment';
  process.env.TRUST_KEY_ID = 'local-exp-1';
  process.env.TRUST_ENVIRONMENT = 'local';
  process.env.TRUST_DEPLOYMENT = 'crewtrace-local-experiment';
  process.env.TRUST_ORDER_SALT = '11'.repeat(32);
  process.env.TRUST_BUYER_SALT = '22'.repeat(32);
  process.env.TRUST_ATTESTATION_MAX_ATTEMPTS = '3';
}

export async function startTrustRuntime() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.pathname, '/crewtrace_v2_test');
  const { default: app, runtime } = await import('../src/index.js');
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = `http://127.0.0.1:${addr.port}`;
  runtime.config.PUBLIC_BASE_URL = base;
  runtime.config.PUBLIC_WEB_URL = base;
  await migrate(runtime.db);
  const tables = await runtime.db.pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'collaboration_%' OR tablename LIKE 'experiment_%')",
  );
  if (tables.rowCount) {
    await runtime.db.pool.query(`TRUNCATE ${tables.rows.map(row => `"${row.tablename}"`).join(',')} CASCADE`);
  }
  await restoreSystemAgent(runtime.db.pool);
  const mcp = new Client({ name: 'trust-runtime-test', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp', base)));
  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await mcp.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    const content = (result.content as { type: string; text?: string }[]).find(item => item.type === 'text');
    return JSON.parse(content!.text!);
  };
  const api = async (path: string, credential?: string, body?: unknown, expected = 200): Promise<any> => {
    const response = await fetch(`${base}/api/collaboration${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(credential && { Authorization: `Bearer ${credential}` }), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const record = await response.json();
    assert.equal(response.status, expected, JSON.stringify(record));
    return record;
  };
  const join = async (name: string, capabilities: string[]): Promise<TrustAgent> => {
    const joined = await call('join_collaboration', { name, capabilities });
    return { credential: joined.credential, agentId: joined.agent.agentId, name };
  };
  const close = async () => {
    await mcp.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await runtime.db.close();
  };
  return { app, runtime, base, mcp, call, api, join, close, adminToken: runtime.config.ADMIN_TOKEN };
}

export interface CsvTaskResult {
  taskId: string;
  input: string;
  cleaned: string;
  claimIds: { inspection: string; review: string; report: string };
  attestationId: string;
}

export async function runCsvTask(options: {
  api: (path: string, credential?: string, body?: unknown, expected?: number) => Promise<any>;
  owner: TrustAgent;
  inspector: TrustAgent;
  reviewer: TrustAgent;
  reporter: TrustAgent;
  title: string;
  input?: string;
  leaseSeconds?: number;
}): Promise<CsvTaskResult> {
  const { api, owner } = options;
  const input = options.input ?? 'record_id,amount_cents\n row-a , 7 \nrow-a,7\nrow-b,3\n';
  const cleaned = executeCsvCleanup(input, 'deduplicate');
  const task = await api('/tasks', owner.credential, {
    title: options.title, description: '可信信誉测试使用的真实 CSV 任务。',
    requiredCapabilities: ['csv-data-review'],
  }, 201);
  await api(`/tasks/${task.taskId}/csv-workflow`, owner.credential, {
    input, expectedVersion: task.version, leaseSeconds: options.leaseSeconds ?? 600,
  }, 201);
  const claim = async (agent: TrustAgent, scope: string) => {
    const current = await api(`/tasks/${task.taskId}`);
    return api(`/tasks/${task.taskId}/claims`, agent.credential, { expectedVersion: current.version, scope }, 201);
  };
  const deliver = async (agent: TrustAgent, claimId: string, content: string) =>
    api(`/tasks/${task.taskId}/handoffs`, agent.credential, { claimId, content }, 201);
  const accept = async (handoff: any) => api(`/handoffs/${handoff.handoffId}/review`, owner.credential, {
    expectedVersion: handoff.version, status: 'ACCEPTED', reason: '按固定 CSV 规则核对。',
  });
  const inspection = await claim(options.inspector, 'csv-source-inspection');
  await accept(await deliver(options.inspector, inspection.claimId, inspectSource(input)));
  const review = await claim(options.reviewer, 'csv-data-review');
  await accept(await deliver(options.reviewer, review.claimId, cleaned));
  const report = await claim(options.reporter, 'csv-evidence-report');
  await accept(await deliver(options.reporter, report.claimId, evidenceReport(cleaned)));
  const issued = await api(`/agents/${options.reviewer.agentId}/attestations?role=csv-data-review`);
  assert.ok(issued.attestations.length >= 1);
  const latest = issued.attestations.find((entry: any) => entry.taskId === task.taskId) ?? issued.attestations[issued.attestations.length - 1];
  return {
    taskId: task.taskId, input, cleaned,
    claimIds: { inspection: inspection.claimId, review: review.claimId, report: report.claimId },
    attestationId: latest.attestationId,
  };
}
