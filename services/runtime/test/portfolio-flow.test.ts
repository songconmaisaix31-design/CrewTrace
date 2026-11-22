import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { verifyCsvDelivery } from '../../../workers/src/csv-delivery.ts';
import { migrate } from '../src/migrate.js';

test('真实 PostgreSQL + HTTP + MCP：验证、验收与下一次排名', async () => {
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.pathname, '/crewtrace_v2_test');
  assert.ok(database.searchParams.get('host')?.endsWith('/CrewTrace-reputation-v2/.local/pg-data'));
  assert.ok(!process.env.CHAIN_ADAPTER_MODULE && !process.env.COLLABORATION_CHAIN_CONTRACT);
  const { default: app, runtime } = await import('../src/index.js');
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = `http://127.0.0.1:${addr.port}`;
  runtime.config.PUBLIC_BASE_URL = base;
  runtime.config.PUBLIC_WEB_URL = base;
  const mcp = new Client({ name: 'portfolio-flow-test', version: '1.0.0' });
  try {
    await migrate(runtime.db);
    await migrate(runtime.db);
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp', base)));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await mcp.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true);
      const content = (result.content as { type: string; text?: string }[]).find(item => item.type === 'text');
      return JSON.parse(content!.text!);
    };
    const api = async (path: string, credential?: string, body?: unknown, expected = 200) => {
      const response = await fetch(`${base}/api/collaboration${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(credential && { Authorization: `Bearer ${credential}` }), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const record = await response.json();
      assert.equal(response.status, expected, JSON.stringify(record));
      return record;
    };
    const owner = await call('join_collaboration', { name: 'V2 test coordinator' });
    const worker = await call('join_collaboration', { name: 'V2 CSV worker', capabilities: ['csv-data-review'] });
    const peer = await call('join_collaboration', { name: 'V2 CSV peer', capabilities: ['csv-data-review'] });
    await api('/agents/me/heartbeat', worker.credential, {});
    await api('/agents/me/heartbeat', peer.credential, {});
    const create = (title: string) => api('/tasks', owner.credential, {
      title, description: 'Validate a real inline CSV from the test input.', requiredCapabilities: ['csv-data-review'],
    }, 201);
    const task = await create('Validation and reputation');
    const before = await api(`/tasks/${task.taskId}/matching`, owner.credential, {}, 201);
    assert.equal(before.candidates.find((a: { agentId: string }) => a.agentId === worker.agent.agentId).sampleSize, 0);
    await api(`/tasks/${task.taskId}/matching`, peer.credential, {}, 403);
    const claim = await api(`/tasks/${task.taskId}/claims`, worker.credential, { expectedVersion: task.version, scope: 'csv-data-review', proposalId: null }, 201);
    const submit = (content: string, credential = worker.credential, expected = 201) => api(`/tasks/${task.taskId}/handoffs`, credential, { claimId: claim.claimId, content }, expected);
    const invalid = await submit('record_id,amount_cents\na,12\na,1.2\n');
    await submit('record_id,amount_cents\na,12\n', peer.credential, 403);
    const review = (handoff: { handoffId: string; version: number }, status: string, expected = 200, credential = owner.credential) =>
      api(`/handoffs/${handoff.handoffId}/review`, credential, { expectedVersion: handoff.version, status, reason: 'Checked against the fixed CSV rule.' }, expected);
    await review(invalid, 'ACCEPTED', 409);
    await review(invalid, 'RETURNED');
    const content = 'record_id,amount_cents\n"order,1",120\norder-2,0\n';
    const good = await submit(content);
    await review(good, 'ACCEPTED', 403, peer.credential);
    await review(good, 'ACCEPTED');
    await review(good, 'ACCEPTED', 409);
    const { records } = await api(`/tasks/${task.taskId}/evidence`);
    assert.equal(records.length, 2);
    assert.equal(records.find((r: { handoffId: string })=>r.handoffId===invalid.handoffId).reputationOutcome, null);
    const accepted = records.find((r: { handoffId: string })=>r.handoffId===good.handoffId);
    assert.equal(accepted.reputationOutcome, 'PASS');
    assert.deepEqual(accepted.result, verifyCsvDelivery(content));
    const next = await create('Next matching round');
    const ranked = await api(`/tasks/${next.taskId}/matching`, owner.credential, {}, 201);
    assert.equal(ranked.candidates[0].agentId, worker.agent.agentId);
    assert.equal(ranked.candidates[0].sampleSize, 1);
    assert.equal(ranked.candidates.find((a: {agentId: string})=>a.agentId===peer.agent.agentId).sampleSize, 0);
    const stored = await runtime.db.pool.query('SELECT document FROM experiment_matching_decisions WHERE id=$1',[ranked.id]);
    assert.deepEqual(stored.rows[0].document, ranked);
    const readBack = await call('get_collaboration_task', { taskId: task.taskId });
    assert.equal(readBack.handoffs.find((value: {handoffId: string})=>value.handoffId===good.handoffId).status, 'ACCEPTED');
  } finally {
    await mcp.close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await runtime.db.close();
  }
});
