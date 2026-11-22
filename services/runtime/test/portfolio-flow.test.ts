import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { verifyCsvDelivery } from '../../../workers/src/csv-delivery.ts';
import { executeCsvCleanup } from '../../../workers/src/csv-cleanup.ts';
import { migrate } from '../src/migrate.js';
import { inspectSource, evidenceReport } from '../src/csv-workflow.js';
import { dependencies } from '../src/dependencies.js';

test('真实 PostgreSQL + HTTP + MCP：验证、验收与下一次排名', async () => {
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.pathname, '/crewtrace_v2_test');
  const socket = database.searchParams.get('host');
  assert.ok(socket ? socket.endsWith('/CrewTrace-reputation-v2/.local/pg-data') : database.hostname === '127.0.0.1');
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
    await assert.rejects(dependencies({...runtime.config,CHAIN_ADAPTER_MODULE:'runtime-chain'},runtime.db),/默认关闭链上执行/);
    await assert.rejects(dependencies({...runtime.config,CHAIN_ADAPTER_MODULE:'runtime-chain',CHAIN_ID:143,EXPERIMENT_CHAIN_WRITES:'TESTNET'},runtime.db),/仅接受 Monad Testnet/);
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
    const content = executeCsvCleanup('record_id,amount_cents\n"order,1",120\norder-2,0\norder-2,0\n','deduplicate');
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
    assert.deepEqual(await api(`/tasks/${next.taskId}/matching`), ranked);
    const readBack = await call('get_collaboration_task', { taskId: task.taskId });
    assert.equal(readBack.handoffs.find((value: {handoffId: string})=>value.handoffId===good.handoffId).status, 'ACCEPTED');
    const source = 'record_id,amount_cents\nthird-review, 13 \n';
    const peerClaim = await api(`/tasks/${next.taskId}/claims`,peer.credential,{
      expectedVersion:next.version,scope:'csv-data-review',proposalId:null,
    },201);
    const peerDelivery = await api(`/tasks/${next.taskId}/handoffs`,peer.credential,{
      claimId:peerClaim.claimId,content:executeCsvCleanup(source,'normalize'),
    },201);
    await review(peerDelivery,'ACCEPTED');

    const inspector = await call('join_collaboration', { name: 'V2 source inspector', capabilities: ['csv-source-inspection'] });
    const reporter = await call('join_collaboration', { name: 'V2 evidence reporter', capabilities: ['csv-evidence-report'] });
    const planTask = await create('Three-agent CSV workflow');
    const workflowPath = `/tasks/${planTask.taskId}/csv-workflow`;
    const workflowInput = 'record_id,amount_cents\n row-a , 7 \nrow-a,7\n';
    await api(workflowPath, peer.credential, { input:workflowInput,expectedVersion:planTask.version },403);
    const plan = await api(workflowPath,owner.credential,{input:workflowInput,expectedVersion:planTask.version,leaseSeconds:5},201);
    assert.deepEqual(plan.steps.map((step:{role:string})=>step.role),['csv-source-inspection','csv-data-review','csv-evidence-report']);
    const workflowClaim = async (actor:string, scope:string, status=201) => {
      const current = await api(`/tasks/${planTask.taskId}`);
      return api(`/tasks/${planTask.taskId}/claims`,actor,{scope,expectedVersion:current.version},status);
    };
    const workflowDelivery = (actor:string, claimId:string, content:string, status=201) =>
      api(`/tasks/${planTask.taskId}/handoffs`,actor,{claimId,content},status);
    await workflowClaim(worker.credential,'csv-data-review',409);
    const elapsed = await workflowClaim(inspector.credential,'csv-source-inspection');
    await delay(5100);
    await workflowDelivery(inspector.credential,elapsed.claimId,inspectSource(workflowInput),409);
    await api(`/claims/${elapsed.claimId}/expire-csv`,owner.credential,{expectedVersion:elapsed.version});
    const first = await workflowClaim(inspector.credential,'csv-source-inspection');
    await review(await workflowDelivery(inspector.credential,first.claimId,inspectSource(workflowInput)),'ACCEPTED');
    const second = await workflowClaim(worker.credential,'csv-data-review');
    await workflowDelivery(worker.credential,second.claimId,'record_id,amount_cents\nwrong-id,7\n',422);
    const cleaned = executeCsvCleanup(workflowInput,'deduplicate');
    await review(await workflowDelivery(worker.credential,second.claimId,cleaned),'ACCEPTED');
    const third = await workflowClaim(reporter.credential,'csv-evidence-report');
    await review(await workflowDelivery(reporter.credential,third.claimId,evidenceReport(cleaned)),'ACCEPTED');
    const state = await api(workflowPath);
    assert.deepEqual(await call('get_csv_collaboration_workflow',{taskId:planTask.taskId}),state);
    assert.ok(state.steps.every((step:{acceptedContent:string|null})=>step.acceptedContent!==null));
    assert.deepEqual(state.attempts.filter((attempt:{step:string})=>attempt.step==='csv-source-inspection').map((attempt:{status:string})=>attempt.status),['TIMED_OUT','COMPLETED']);
    assert.equal(new Set(state.attempts.filter((attempt:{status:string})=>attempt.status==='COMPLETED').map((attempt:{agentId:string})=>attempt.agentId)).size,3);
  } finally {
    await mcp.close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await runtime.db.close();
  }
});
