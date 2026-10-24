import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {
  JoinCollaborationAgentResponseSchema, CollaborationAgentSchema, CollaborationTaskSchema,
  CollaborationTaskDetailSchema, CollaborationClaimSchema, CollaborationHandoffSchema,
  CollaborationMessageSchema, CollaborationEventsResponseSchema, CollaborationToolSchemas,
  RotateCollaborationCredentialResponseSchema,
} from '../src/collaboration.ts';

test('真实 MCP 匿名起名、原连接协作、凭证边界与成果完成', { timeout: 180_000 }, async () => {
  assert.ok(process.env.COLLABORATION_MCP_URL, '需要实际 COLLABORATION_MCP_URL');
  assert.ok(process.env.COLLABORATION_BASE_URL, '需要实际 COLLABORATION_BASE_URL');
  const mcpURL = new URL(process.env.COLLABORATION_MCP_URL);
  const base = process.env.COLLABORATION_BASE_URL;
  const marker = randomUUID();
  const directory = resolve('.local/web-flow', `mcp-join-${marker}`);
  await mkdir(directory, { recursive: true });
  const clients: Client[] = [];
  const audit: unknown[] = [];
  const credentials: string[] = [];
  const connect = async (credential?: string) => {
    const client = new Client({ name: `public-mcp-join-${clients.length}`, version: '1.0.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(mcpURL, credential ? { requestInit: { headers: { Authorization: `Bearer ${credential}` } } } : undefined));
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown>, expectedError?: string) => {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as { type: string; text?: string }[]).find(item => item.type === 'text')?.text;
    assert.ok(content, `${name} 缺少结果`);
    const value = JSON.parse(content);
    audit.push({ name, isError: Boolean(result.isError), code: value.error?.code, observedAt: new Date().toISOString() });
    if (expectedError) {
      assert.equal(result.isError, true, `${name} 应拒绝请求`);
      assert.equal(value.error.code, expectedError);
    } else assert.notEqual(result.isError, true, `${name} 返回 ${value.error?.code}`);
    return value;
  };
  const request = async (path: string) => {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  try {
    const ownerClient = await connect();
    const workerClient = await connect();
    const listed = await ownerClient.listTools();
    const names = Object.keys(CollaborationToolSchemas).sort();
    assert.deepEqual(listed.tools.filter(item => names.includes(item.name)).map(item => item.name).sort(), names);
    const joinTool = listed.tools.find(item => item.name === 'join_collaboration');
    assert.ok(joinTool);
    assert.deepEqual(joinTool.inputSchema.required, ['name']);
    for (const name of names) assert.ok(listed.tools.find(item => item.name === name)?.inputSchema.properties?.credential, `${name} 缺少 credential 参数`);

    const name = `MCP起名独立验收 ${marker.slice(0, 8)}`;
    const owner = JoinCollaborationAgentResponseSchema.parse(await call(ownerClient, 'join_collaboration', { name }));
    const worker = JoinCollaborationAgentResponseSchema.parse(await call(workerClient, 'join_collaboration', { name }));
    credentials.push(owner.credential, worker.credential);
    await writeFile(resolve(directory, 'private-identities.json'), JSON.stringify({ owner, worker }, null, 2), { flag: 'wx', mode: 0o600 });
    assert.notEqual(owner.agent.agentId, worker.agent.agentId);
    assert.ok(owner.credential !== worker.credential, '两个独立身份的凭证必须不同');
    for (const [client, joined] of [[ownerClient, owner], [workerClient, worker]] as const) {
      assert.ok(joined.onboarding.nextCall.arguments.credential === joined.credential, '下一次调用必须使用本人的凭证');
      assert.ok(joined.onboarding.authorizationHeader === `Authorization: Bearer ${joined.credential}`, '请求头说明必须使用本人的凭证');
      assert.equal(joined.onboarding.mcpURL, mcpURL.href);
      const identity = CollaborationAgentSchema.parse(await call(client, joined.onboarding.nextCall.name, joined.onboarding.nextCall.arguments));
      assert.equal(identity.agentId, joined.agent.agentId);
    }
    await call(ownerClient, 'get_collaboration_identity', {}, 'UNAUTHORIZED');
    const headerClient = await connect(owner.credential);
    await call(headerClient, 'get_collaboration_identity', { credential: worker.credential }, 'UNAUTHORIZED');
    assert.equal(CollaborationAgentSchema.parse(await call(headerClient, 'get_collaboration_identity', { credential: owner.credential })).agentId, owner.agent.agentId);

    const task = CollaborationTaskSchema.parse(await call(ownerClient, 'create_collaboration_task', {
      credential: owner.credential,
      request: { title: name, description: '独立实际核对当前公开 MCP 工具目录，使用起名加入返回的凭证完成交接。', bountyMON: '0.01' },
    }));
    await writeFile(resolve(directory, 'created.json'), JSON.stringify({ base, mcpURL: mcpURL.href, taskId: task.taskId, owner: owner.agent.agentId, worker: worker.agent.agentId }, null, 2));
    console.log(JSON.stringify({ event: 'mcp_join_task_created', taskId: task.taskId, evidenceDirectory: directory }));
    const message = CollaborationMessageSchema.parse(await call(workerClient, 'publish_collaboration_message', {
      credential: worker.credential, request: { taskId: task.taskId, kind: 'CHAT', body: '已通过匿名 MCP 起名加入，将核对实际工具目录并交接。' },
    }));
    assert.equal(message.author, worker.agent.agentId);
    const messages = await call(ownerClient, 'list_collaboration_messages', { credential: owner.credential, taskId: task.taskId });
    assert.ok(messages.messages.some((item: { messageId: string }) => item.messageId === message.messageId));
    const claim = CollaborationClaimSchema.parse(await call(workerClient, 'claim_collaboration_task', {
      credential: worker.credential, taskId: task.taskId, request: { expectedVersion: task.version, scope: '核对公开 MCP 工具名称和起名输入要求' },
    }));
    const observed = await workerClient.listTools();
    const product = { source: mcpURL.href, observedAt: new Date().toISOString(), tools: observed.tools.filter(item => names.includes(item.name)).map(item => item.name).sort(), joinRequired: observed.tools.find(item => item.name === 'join_collaboration')!.inputSchema.required };
    const handoff = CollaborationHandoffSchema.parse(await call(workerClient, 'submit_collaboration_handoff', {
      credential: worker.credential, taskId: task.taskId, request: { claimId: claim.claimId, content: JSON.stringify(product), artifactURI: new URL('/api/collaboration/tools', base).href },
    }));
    const independentlyRead = await ownerClient.listTools();
    assert.deepEqual(product.tools, independentlyRead.tools.filter(item => names.includes(item.name)).map(item => item.name).sort());
    assert.deepEqual(product.joinRequired, independentlyRead.tools.find(item => item.name === 'join_collaboration')!.inputSchema.required);
    await call(workerClient, 'review_collaboration_handoff', { credential: worker.credential, handoffId: handoff.handoffId, request: { expectedVersion: handoff.version, status: 'ACCEPTED' } }, 'UNAUTHORIZED');
    await call(ownerClient, 'review_collaboration_handoff', { credential: owner.credential, handoffId: handoff.handoffId, request: { expectedVersion: handoff.version, status: 'ACCEPTED', reason: '独立连接实际读取工具目录，名称和起名输入要求均一致。' } });
    const afterHandoff = CollaborationTaskDetailSchema.parse(await call(ownerClient, 'get_collaboration_task', { credential: owner.credential, taskId: task.taskId }));
    await call(ownerClient, 'update_collaboration_task', { credential: owner.credential, taskId: task.taskId, request: { expectedVersion: afterHandoff.version, status: 'COMPLETED' } });

    const rotated = RotateCollaborationCredentialResponseSchema.parse(await call(workerClient, 'rotate_collaboration_credential', { credential: worker.credential }));
    credentials.push(rotated.credential);
    await writeFile(resolve(directory, 'private-rotated.json'), JSON.stringify(rotated), { flag: 'wx', mode: 0o600 });
    await call(workerClient, 'get_collaboration_identity', { credential: worker.credential }, 'UNAUTHORIZED');
    assert.equal(CollaborationAgentSchema.parse(await call(workerClient, 'get_collaboration_identity', { credential: rotated.credential })).agentId, worker.agent.agentId);
    const final = CollaborationTaskDetailSchema.parse(await request(`/api/collaboration/tasks/${task.taskId}`));
    assert.equal(final.status, 'COMPLETED');
    assert.equal(final.claims[0].status, 'COMPLETED');
    assert.equal(final.handoffs[0].status, 'ACCEPTED');
    assert.equal(final.bountyMode, 'MOCK');
    assert.deepEqual(JSON.parse(final.handoffs[0].content), product);
    const taskEvents = CollaborationEventsResponseSchema.parse(await request(`/api/collaboration/events?taskId=${task.taskId}&limit=100`));
    const events = [];
    let after = 0;
    for (;;) {
      const page = CollaborationEventsResponseSchema.parse(await request(`/api/collaboration/events?after=${after}&limit=100`));
      events.push(...page.events.filter(event => event.actorAgentId === owner.agent.agentId || event.actorAgentId === worker.agent.agentId));
      if (!page.hasMore) break;
      assert.ok(page.nextAfter > after);
      after = page.nextAfter;
    }
    assert.deepEqual(events.filter(event => event.taskId === task.taskId), taskEvents.events);
    assert.equal(events.filter(event => event.type === 'AGENT_REGISTERED').length, 2);
    const publicText = JSON.stringify({ final, events, messages });
    for (const credential of credentials) assert.equal(publicText.includes(credential), false, '公开记录包含私密凭证');
    await writeFile(resolve(directory, 'summary.json'), JSON.stringify({ base, mcpURL: mcpURL.href, marker, task: final, events, owner: owner.agent.agentId, worker: worker.agent.agentId, sameNameDifferentIdentities: true, sameConnectionCredentialCalls: true, headerConflictRejected: true, credentialRotationVerified: true, publicCredentialLeak: false, actualTools: product.tools, audit }, null, 2));
    console.log(JSON.stringify({ event: 'mcp_join_passed', taskId: task.taskId, events: events.length, tools: product.tools.length, evidenceDirectory: directory }));
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await writeFile(resolve(directory, 'audit.json'), JSON.stringify(audit, null, 2));
  }
});
