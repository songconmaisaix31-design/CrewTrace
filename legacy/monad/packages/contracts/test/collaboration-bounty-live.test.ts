import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from '../../../services/runtime/node_modules/@hono/node-server/dist/index.mjs';
import { Client } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import app, { runtime } from '../../../services/runtime/src/index.ts';
import {
  JoinCollaborationAgentResponseSchema, CollaborationTaskSchema, CollaborationTaskDetailSchema,
  CollaborationClaimSchema, CollaborationHandoffSchema, CollaborationAssignmentProposalSchema,
  CollaborationEventsResponseSchema, CollaborationTasksResponseSchema, CollaborationToolSchemas, CollaborationGuideResponseSchema,
} from '../src/collaboration.ts';

test('真实测试数据库中的 MCP 悬赏发布、修改、退回重交和取消', { timeout: 240_000 }, async () => {
  const directory = resolve('.local/web-flow', `bounty-${randomUUID()}`);
  const clients: Client[] = [];
  const audit: unknown[] = [];
  let server: ReturnType<typeof serve> | undefined;
  await mkdir(directory, { recursive: true });
  try {
    const schema = (await runtime.db.pool.query('SELECT current_schema() AS schema')).rows[0].schema;
    assert.equal(schema, 'b_public_collaboration_test_20261017', '只允许既有独立测试 schema');
    const beforeSeq = Number((await runtime.db.pool.query('SELECT COALESCE(MAX(seq),0) AS seq FROM collaboration_events')).rows[0].seq);
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await new Promise(resolveReady => server!.once('listening', resolveReady));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    runtime.config.PUBLIC_BASE_URL = base;
    runtime.config.PUBLIC_MCP_URL = `${base}/mcp`;
    const connect = async (name: string) => {
      const client = new Client({ name, version: '1.0.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      return client;
    };
    const ownerClient = await connect('CrewTrace-bounty-author');
    const workerClient = await connect('CrewTrace-bounty-worker');
    const call = async (client: Client, name: string, args: Record<string, unknown>, failure?: { status: number; code: string }) => {
      const response = await client.callTool({ name, arguments: args });
      const text = (response.content as { type: string; text?: string }[]).find(item => item.type === 'text')?.text;
      assert.ok(text, `${name} 缺少业务响应`);
      const value = JSON.parse(text);
      audit.push({ name, failed: response.isError === true, observedAt: new Date().toISOString() });
      if (failure) {
        assert.equal(response.isError, true, `${name} 应拒绝操作`);
        assert.equal(value.status, failure.status);
        assert.equal(value.error.code, failure.code);
      } else assert.notEqual(response.isError, true, `${name} 失败：${value.error?.code ?? '未知错误'}`);
      return value;
    };
    const getHTTP = async (path: string) => {
      const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const prompt = await ownerClient.getPrompt({ name: 'crewtrace_collaboration' });
    const promptText = prompt.messages.map(message => message.content.type === 'text' ? message.content.text : '').join('\n');
    const guide = CollaborationGuideResponseSchema.parse(await call(ownerClient, 'get_collaboration_guide', {}));
    assert.equal(guide.text, promptText);
    for (const name of ['create_collaboration_task', 'list_collaboration_tasks', 'update_collaboration_task', 'claim_collaboration_task', 'release_collaboration_claim', 'submit_collaboration_handoff', 'review_collaboration_handoff']) {
      assert.ok(promptText.includes(name), `原生提示词缺少 ${name}`);
    }
    assert.ok(promptText.includes('CANCELLED'));
    const marker = randomUUID().slice(0, 8);
    const owner = JoinCollaborationAgentResponseSchema.parse(await call(ownerClient, 'join_collaboration', { name: `悬赏流程发布者 ${marker}` }));
    const worker = JoinCollaborationAgentResponseSchema.parse(await call(workerClient, 'join_collaboration', { name: `悬赏流程执行者 ${marker}` }));
    assert.ok(owner.credential !== worker.credential && owner.agent.agentId !== worker.agent.agentId);
    await writeFile(resolve(directory, 'private-identities.json'), JSON.stringify({ owner, worker }), { mode: 0o600 });
    const ownerCall = (name: string, args: Record<string, unknown>, failure?: { status: number; code: string }) => call(ownerClient, name, { ...args, credential: owner.credential }, failure);
    const workerCall = (name: string, args: Record<string, unknown>, failure?: { status: number; code: string }) => call(workerClient, name, { ...args, credential: worker.credential }, failure);
    await ownerCall(owner.onboarding.nextCall.name, {});
    await workerCall(worker.onboarding.nextCall.name, {});
    const detail = async (taskId: string) => CollaborationTaskDetailSchema.parse(await call(ownerClient, 'get_collaboration_task', { taskId }));
    const invalidState = { status: 409, code: 'INVALID_STATE' };
    const forbidden = { status: 403, code: 'UNAUTHORIZED' };

    const task = CollaborationTaskSchema.parse(await ownerCall('create_collaboration_task', { request: {
      title: `检查真实 MCP 工具目录 ${marker}`, description: '读取实际工具目录，先提交名称；按作者实际要求补充完整输入规则并交接。', bountyMON: '0.010000000000000001', bountyMode: 'MOCK',
    } }));
    assert.equal(task.bountyMON, '0.010000000000000001');
    const amended = CollaborationTaskSchema.parse(await ownerCall('update_collaboration_task', { taskId: task.taskId, request: { expectedVersion: task.version, bountyMON: '0.020000000000000001' } }));
    assert.equal(amended.bountyMON, '0.020000000000000001');
    assert.equal(amended.bountyMode, 'MOCK');
    await workerCall('update_collaboration_task', { taskId: task.taskId, request: { expectedVersion: amended.version, bountyMON: '1' } }, forbidden);
    await ownerCall('update_collaboration_task', { taskId: task.taskId, request: { expectedVersion: task.version, bountyMON: '1' } }, { status: 409, code: 'VERSION_CONFLICT' });
    let found = false, offset = 0;
    do {
      const page = CollaborationTasksResponseSchema.parse(await call(workerClient, 'list_collaboration_tasks', { status: 'OPEN', offset, limit: 100 }));
      found ||= page.tasks.some(item => item.taskId === task.taskId && item.bountyMON === amended.bountyMON);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    } while (!found);
    assert.ok(found, '公开列表没有实际发布的悬赏');
    const proposal = CollaborationAssignmentProposalSchema.parse(await workerCall('propose_collaboration_assignment', { taskId: task.taskId, request: { agentId: worker.agent.agentId, scope: '读取真实 MCP 工具并核对输入规则' } }));
    await ownerCall('decide_collaboration_assignment', { proposalId: proposal.proposalId, request: { expectedVersion: proposal.version, status: 'APPROVED' } });
    const claim = CollaborationClaimSchema.parse(await workerCall('claim_collaboration_task', { taskId: task.taskId, request: { expectedVersion: amended.version, scope: proposal.scope, proposalId: proposal.proposalId } }));
    let current = await detail(task.taskId);
    await ownerCall('update_collaboration_task', { taskId: task.taskId, request: { expectedVersion: current.version, status: 'CANCELLED' } }, invalidState);
    const tools = (await workerClient.listTools()).tools.filter(tool => tool.name in CollaborationToolSchemas);
    const names = tools.map(tool => tool.name).sort();
    const first = CollaborationHandoffSchema.parse(await workerCall('submit_collaboration_handoff', { taskId: task.taskId, request: { claimId: claim.claimId, content: JSON.stringify({ names }) } }));
    await workerCall('release_collaboration_claim', { claimId: claim.claimId, request: { expectedVersion: claim.version } }, invalidState);
    await workerCall('review_collaboration_handoff', { handoffId: first.handoffId, request: { expectedVersion: first.version, status: 'ACCEPTED' } }, forbidden);
    await ownerCall('review_collaboration_handoff', { handoffId: first.handoffId, request: { expectedVersion: first.version, status: 'RETURNED', reason: '请补充工具的实际 inputSchema，供独立客户端逐项核对。' } });
    const product = tools.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema })).sort((a, b) => a.name.localeCompare(b.name));
    const bytes = Buffer.from(JSON.stringify(product));
    await writeFile(resolve(directory, 'actual-tool-schemas.json'), bytes);
    const second = CollaborationHandoffSchema.parse(await workerCall('submit_collaboration_handoff', { taskId: task.taskId, request: { claimId: claim.claimId, content: bytes.toString('utf8') } }));
    const independentlyRead = (await ownerClient.listTools()).tools.filter(tool => tool.name in CollaborationToolSchemas).map(tool => ({ name: tool.name, inputSchema: tool.inputSchema })).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(JSON.parse(second.content), independentlyRead);
    await ownerCall('review_collaboration_handoff', { handoffId: second.handoffId, request: { expectedVersion: second.version, status: 'ACCEPTED', reason: '通过独立 MCP 连接重新读取目录，全部名称及输入规则一致。' } });
    current = await detail(task.taskId);
    assert.equal(current.claims.find(item => item.claimId === claim.claimId)?.status, 'COMPLETED');
    await ownerCall('update_collaboration_task', { taskId: task.taskId, request: { expectedVersion: current.version, status: 'COMPLETED' } });
    const completed = await detail(task.taskId);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.bountyMON, amended.bountyMON);
    assert.deepEqual(completed, CollaborationTaskDetailSchema.parse(await getHTTP(`/api/collaboration/tasks/${task.taskId}`)));

    const cancelledTask = CollaborationTaskSchema.parse(await ownerCall('create_collaboration_task', { request: { title: `检查悬赏退出流程 ${marker}`, description: '在独立测试 schema 实际检查认领释放及父子任务取消限制。', bountyMON: '0.03' } }));
    const cancelledClaim = CollaborationClaimSchema.parse(await workerCall('claim_collaboration_task', { taskId: cancelledTask.taskId, request: { expectedVersion: cancelledTask.version, scope: '检查取消所需状态' } }));
    const child = CollaborationTaskSchema.parse(await ownerCall('create_collaboration_task', { request: { parentTaskId: cancelledTask.taskId, title: `取消依赖检查 ${marker}`, description: '实际建立子任务，验证父任务只能在子任务结束后取消。' } }));
    current = await detail(cancelledTask.taskId);
    await ownerCall('update_collaboration_task', { taskId: cancelledTask.taskId, request: { expectedVersion: current.version, status: 'CANCELLED' } }, invalidState);
    await ownerCall('release_collaboration_claim', { claimId: cancelledClaim.claimId, request: { expectedVersion: cancelledClaim.version } }, forbidden);
    const released = CollaborationClaimSchema.parse(await workerCall('release_collaboration_claim', { claimId: cancelledClaim.claimId, request: { expectedVersion: cancelledClaim.version } }));
    assert.equal(released.status, 'RELEASED');
    current = await detail(cancelledTask.taskId);
    await ownerCall('update_collaboration_task', { taskId: cancelledTask.taskId, request: { expectedVersion: current.version, status: 'CANCELLED' } }, invalidState);
    await ownerCall('update_collaboration_task', { taskId: child.taskId, request: { expectedVersion: child.version, status: 'CANCELLED' } });
    await ownerCall('update_collaboration_task', { taskId: cancelledTask.taskId, request: { expectedVersion: current.version, status: 'CANCELLED' } });
    const cancelled = await detail(cancelledTask.taskId);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.deepEqual(cancelled, CollaborationTaskDetailSchema.parse(await getHTTP(`/api/collaboration/tasks/${cancelled.taskId}`)));
    await workerCall('claim_collaboration_task', { taskId: cancelled.taskId, request: { expectedVersion: cancelled.version, scope: '检查取消后拒绝认领' } }, invalidState);

    const actors = [owner.agent.agentId, worker.agent.agentId];
    const events = [];
    let after = beforeSeq;
    for (;;) {
      const page = CollaborationEventsResponseSchema.parse(await getHTTP(`/api/collaboration/events?after=${after}&limit=100`));
      events.push(...page.events.filter(event => actors.includes(event.actorAgentId)));
      after = page.nextAfter;
      if (!page.hasMore) break;
    }
    for (const event of events) {
      const actual = (await runtime.db.pool.query('SELECT seq,document FROM collaboration_events WHERE event_id=$1 AND seq=$2', [event.eventId, event.seq])).rows;
      assert.equal(actual.length, 1);
      const { seq, ...document } = event;
      assert.equal(Number(actual[0].seq), seq);
      assert.deepEqual(actual[0].document, document);
    }
    const storedEvents = (await runtime.db.pool.query('SELECT seq,document FROM collaboration_events WHERE actor_id=ANY($1::text[]) ORDER BY seq', [actors])).rows;
    assert.deepEqual(storedEvents.map(row => ({ ...row.document, seq: Number(row.seq) })), events);
    for (const final of [completed, cancelled, await detail(child.taskId)]) {
      const { proposals, claims, handoffs, ...document } = final;
      assert.deepEqual((await runtime.db.pool.query('SELECT document FROM collaboration_tasks WHERE id=$1', [final.taskId])).rows[0].document, document);
      for (const [table, records, key] of [
        ['collaboration_proposals', proposals, 'proposalId'], ['collaboration_claims', claims, 'claimId'], ['collaboration_handoffs', handoffs, 'handoffId'],
      ] as const) for (const record of records) {
        const id = (record as unknown as Record<string, unknown>)[key];
        assert.deepEqual((await runtime.db.pool.query(`SELECT document FROM ${table} WHERE id=$1`, [id])).rows[0].document, record);
      }
    }
    const publicResult = { schema, base, owner: owner.agent, worker: worker.agent, completed, cancelled, events, productSHA256: createHash('sha256').update(bytes).digest('hex'), modelCalls: 0, chainWrites: 0, realPayments: 0 };
    const serialized = JSON.stringify(publicResult, null, 2);
    assert.ok(!serialized.includes(owner.credential) && !serialized.includes(worker.credential), '公开证据含私密凭证');
    await writeFile(resolve(directory, 'summary.json'), serialized);
    console.log(JSON.stringify({ directory, schema, completedTask: completed.taskId, cancelledTask: cancelled.taskId, individuallyVerifiedEvents: events.length, realPayments: 0, chainWrites: 0 }));
  } finally {
    await writeFile(resolve(directory, 'audit.json'), JSON.stringify(audit, null, 2));
    for (const client of clients) await client.close();
    if (server) await new Promise<void>((resolveClosed, reject) => server!.close(error => error ? reject(error) : resolveClosed()));
    await runtime.db.close();
  }
});
