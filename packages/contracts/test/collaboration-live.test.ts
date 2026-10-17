import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {
  RegisterCollaborationAgentResponseSchema, CollaborationTaskSchema, CollaborationTaskDetailSchema,
  CollaborationNoteSchema, CollaborationAssignmentProposalSchema, CollaborationClaimSchema,
  CollaborationHandoffSchema, CollaborationEventsResponseSchema, CollaborationMessagesResponseSchema,
  RotateCollaborationCredentialResponseSchema,
} from '../src/collaboration.ts';
import { hashUtf8 } from '../src/hash.ts';

test('真实公开协作、两个独立 MCP 进程、分工交接与权限', { timeout: 240_000 }, async () => {
  assert.ok(process.env.COLLABORATION_BASE_URL, '需要实际 COLLABORATION_BASE_URL');
  const base = process.env.COLLABORATION_BASE_URL;
  const marker = randomUUID();
  const directory = resolve('.local/web-flow', `collaboration-${marker}`);
  await mkdir(directory, { recursive: true });
  const audit: unknown[] = [];
  const request = async (path: string, method = 'GET', body?: unknown, credential?: string, expected = 200) => {
    const response = await fetch(new URL(path, base), { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    const result = await response.json();
    audit.push({ path, method, status: response.status, observedAt: new Date().toISOString() });
    assert.equal(response.status, expected, `${method} ${path}，错误码 ${result.error?.code ?? '无'}`);
    return result;
  };
  const clients: Client[] = [];
  const peers: { pid: number | undefined; child: ReturnType<typeof spawn>; exited: Promise<unknown> }[] = [];
  const processAudit: unknown[] = [];
  try {
    const owner = RegisterCollaborationAgentResponseSchema.parse(await request('/api/collaboration/agents', 'POST', { name: `公开验证发布者 ${marker.slice(0, 8)}`, description: '实际公开协作验证的任务发布与结果核对身份。', capabilities: ['输入核对', '成果验收'] }, undefined, 201));
    const worker = RegisterCollaborationAgentResponseSchema.parse(await request('/api/collaboration/agents', 'POST', { name: `公开验证执行者 ${marker.slice(0, 8)}`, description: '实际独立 MCP 接入与公开 CSV 摘要核对身份。', capabilities: ['原始字节核对'] }, undefined, 201));
    assert.ok(owner.agent.agentId !== worker.agent.agentId && owner.credential !== worker.credential);
    const sourceURI = 'https://raw.githubusercontent.com/songconmaisaix31-design/co-vibe/4af89ea/workers/fixtures/round-1.csv';
    const source = await readFile('workers/fixtures/round-1.csv');
    const createTask = { title: `复核固定 CSV 原始字节 ${marker.slice(0, 8)}`, description: `读取项目公开输入 ${sourceURI}，交付原始字节长度及 keccak256。此记录用于真实公开接入验证。`, requiredCapabilities: ['原始字节核对'], bountyMON: '0.01', parentTaskId: null };
    await request('/api/collaboration/tasks', 'POST', createTask, undefined, 403);
    const task = CollaborationTaskSchema.parse(await request('/api/collaboration/tasks', 'POST', createTask, owner.credential, 201));
    await writeFile(resolve(directory, 'created.json'), JSON.stringify({ base, marker, task, owner: owner.agent, worker: worker.agent }, null, 2));
    console.log(JSON.stringify({ event: 'real_collaboration_created', taskId: task.taskId, owner: owner.agent.agentId, worker: worker.agent.agentId, evidenceDirectory: directory }));
    for (const [index, identity] of [owner, worker].entries()) {
      const other = index === 0 ? worker : owner;
      const config = { BASE_URL: base, CREDENTIAL: identity.credential, AGENT_ID: identity.agent.agentId, PEER_ID: other.agent.agentId, TASK_ID: task.taskId, MARKER: marker, OUTPUT: resolve(directory, `peer-${index + 1}.json`) };
      const file = resolve(directory, `peer-${index + 1}.env`);
      await writeFile(file, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
      const log = await open(resolve(directory, `peer-${index + 1}.log`), 'w');
      const child = spawn(process.execPath, ['--import', './services/runtime/node_modules/tsx/dist/loader.mjs', 'packages/contracts/test/collaboration-peer.ts', file], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
      await log.close();
      const exited = new Promise((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
          processAudit.push({ pid: child.pid, event: 'process_exited', code, signal, observedAt: new Date().toISOString() });
          resolveExit({ code, signal });
        });
      });
      peers.push({ pid: child.pid, child, exited });
      processAudit.push({ event: 'process_started', pid: child.pid, agentId: identity.agent.agentId, startedAt: new Date().toISOString(), windowsHide: true });
    }
    assert.equal(new Set(peers.map(peer => peer.pid)).size, 2);
    const exits = await Promise.all(peers.map(peer => peer.exited));
    assert.ok(exits.every((exit: any) => exit.code === 0 && exit.signal === null), '独立 MCP 进程失败，请检查私有目录日志');
    const connect = async (credential: string) => {
      const client = new Client({ name: `collaboration-live-${clients.length}`, version: '1.0.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { Authorization: `Bearer ${credential}` } } }));
      return client;
    };
    const ownerClient = await connect(owner.credential);
    const workerClient = await connect(worker.credential);
    const call = async (client: Client, name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, `实际 MCP ${name} 返回错误`);
      const text = (result.content as { type: string; text?: string }[]).find(item => item.type === 'text')?.text;
      assert.ok(text);
      return JSON.parse(text);
    };
    const note = CollaborationNoteSchema.parse(await call(workerClient, 'create_collaboration_note', { request: { taskId: task.taskId, topic: '实际输入核对', body: '将下载原始 CSV 并核对已发布字节摘要。' } }));
    await request(`/api/collaboration/notes/${note.noteId}`, 'PATCH', { expectedVersion: note.version, topic: note.topic, body: '作者身份检查' }, owner.credential, 403);
    const noteUpdate = { expectedVersion: note.version, topic: note.topic, body: '实际并发更新，应仅接受一次。' };
    const concurrent = await Promise.all([workerClient.callTool({ name: 'update_collaboration_note', arguments: { noteId: note.noteId, request: noteUpdate } }), workerClient.callTool({ name: 'update_collaboration_note', arguments: { noteId: note.noteId, request: noteUpdate } })]);
    assert.equal(concurrent.filter(result => result.isError === true).length, 1);
    const conflict = concurrent.find(result => result.isError === true)!;
    const conflictText = (conflict.content as { type: string; text?: string }[]).find(item => item.type === 'text')?.text;
    assert.ok(conflictText);
    const conflictBody = JSON.parse(conflictText);
    assert.equal(conflictBody.status, 409);
    assert.equal(conflictBody.error.code, 'VERSION_CONFLICT');
    const proposal = CollaborationAssignmentProposalSchema.parse(await call(workerClient, 'propose_collaboration_assignment', { taskId: task.taskId, request: { agentId: worker.agent.agentId, scope: '核对固定 CSV 原始字节和摘要' } }));
    await request(`/api/collaboration/proposals/${proposal.proposalId}/decision`, 'POST', { expectedVersion: proposal.version, status: 'APPROVED' }, worker.credential, 403);
    const approved = CollaborationAssignmentProposalSchema.parse(await call(ownerClient, 'decide_collaboration_assignment', { proposalId: proposal.proposalId, request: { expectedVersion: proposal.version, status: 'APPROVED' } }));
    assert.equal(approved.status, 'APPROVED');
    const beforeClaim = CollaborationTaskDetailSchema.parse(await request(`/api/collaboration/tasks/${task.taskId}`));
    assert.equal(beforeClaim.claims.length, 0);
    const claimRequest = { expectedVersion: beforeClaim.version, scope: proposal.scope, proposalId: proposal.proposalId };
    const claim = CollaborationClaimSchema.parse(await call(workerClient, 'claim_collaboration_task', { taskId: task.taskId, request: claimRequest }));
    assert.equal(claim.agentId, worker.agent.agentId);
    assert.equal(claim.status, 'ACTIVE');
    await request(`/api/collaboration/tasks/${task.taskId}/claims`, 'POST', claimRequest, owner.credential, 409);
    const active = CollaborationTaskDetailSchema.parse(await request(`/api/collaboration/tasks/${task.taskId}`));
    await request(`/api/collaboration/tasks/${task.taskId}`, 'PATCH', { expectedVersion: active.version, status: 'COMPLETED' }, worker.credential, 403);
    const publishedSource = await fetch(sourceURI, { signal: AbortSignal.timeout(30_000) });
    assert.equal(publishedSource.status, 200);
    const actualSource = Buffer.from(await publishedSource.arrayBuffer());
    assert.deepEqual(actualSource, source);
    const actualProduct = { sourceURI, byteLength: actualSource.byteLength, keccak256: hashUtf8(actualSource) };
    const handoff = CollaborationHandoffSchema.parse(await call(workerClient, 'submit_collaboration_handoff', { taskId: task.taskId, request: { claimId: claim.claimId, content: JSON.stringify(actualProduct), artifactURI: sourceURI } }));
    assert.deepEqual(JSON.parse(handoff.content), actualProduct);
    assert.equal(actualProduct.keccak256, hashUtf8(source));
    const accepted = CollaborationHandoffSchema.parse(await call(ownerClient, 'review_collaboration_handoff', { handoffId: handoff.handoffId, request: { expectedVersion: handoff.version, status: 'ACCEPTED', reason: '实际下载字节与项目固定输入一致。' } }));
    assert.equal(accepted.status, 'ACCEPTED');
    const afterHandoff = CollaborationTaskDetailSchema.parse(await request(`/api/collaboration/tasks/${task.taskId}`));
    assert.equal(afterHandoff.claims.find(item => item.claimId === claim.claimId)?.status, 'COMPLETED');
    const completed = CollaborationTaskSchema.parse(await request(`/api/collaboration/tasks/${task.taskId}`, 'PATCH', { expectedVersion: afterHandoff.version, status: 'COMPLETED' }, owner.credential));
    assert.equal(completed.status, 'COMPLETED');
    const mcpDetail = CollaborationTaskDetailSchema.parse(await call(workerClient, 'get_collaboration_task', { taskId: task.taskId }));
    const httpDetail = CollaborationTaskDetailSchema.parse(await request(`/api/collaboration/tasks/${task.taskId}`));
    assert.deepEqual(mcpDetail, httpDetail);
    assert.equal(httpDetail.bountyMON, '0.01');
    assert.equal(httpDetail.bountyMode, 'MOCK');
    const messages = CollaborationMessagesResponseSchema.parse(await request(`/api/collaboration/messages?taskId=${task.taskId}&after=0&limit=100`));
    assert.ok([owner.agent.agentId, worker.agent.agentId].every(id => messages.messages.some(message => message.author === id && message.body.includes(marker))));
    const events = [];
    let after = 0;
    for (;;) {
      const page = CollaborationEventsResponseSchema.parse(await request(`/api/collaboration/events?taskId=${task.taskId}&after=${after}&limit=2`));
      for (const event of page.events) { assert.ok(event.seq > after); after = event.seq; events.push(event); }
      assert.equal(after, page.nextAfter);
      if (!page.hasMore) break;
    }
    assert.ok(events.some(event => event.type === 'HANDOFF_REVIEWED') && events.some(event => event.type === 'TASK_CLAIMED'));
    const next = CollaborationEventsResponseSchema.parse(await call(workerClient, 'get_collaboration_events', { taskId: task.taskId, after, limit: 2 }));
    assert.equal(next.events.length, 0);
    assert.equal(next.nextAfter, after);
    await request('/api/collaboration/messages', 'POST', { taskId: task.taskId, kind: 'CHAT', body: '作者冒充检查', author: owner.agent.agentId }, worker.credential, 400);
    const rotated = RotateCollaborationCredentialResponseSchema.parse(await request('/api/collaboration/credentials/rotate', 'POST', {}, worker.credential));
    await request('/api/collaboration/agents/me', 'GET', undefined, worker.credential, 401);
    assert.equal((await request('/api/collaboration/agents/me', 'GET', undefined, rotated.credential)).agentId, worker.agent.agentId);
    await writeFile(resolve(directory, 'rotated.env'), `CREDENTIAL=${JSON.stringify(rotated.credential)}\n`, { flag: 'wx', mode: 0o600 });
    const summary = { base, marker, taskId: task.taskId, owner: owner.agent.agentId, worker: worker.agent.agentId, processes: processAudit, independentMcpProcessesReadEachOther: true, proposalApprovalThenSelfClaim: true, rawInput: actualProduct, acceptedHandoff: accepted, task: httpDetail, eventIds: events.map(event => ({ eventId: event.eventId, seq: event.seq })), noteConcurrentConflict: true, unauthorizedWritesRejected: true, credentialRotationVerified: true, bountyIsDeclaredAmountOnly: true, audit };
    await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ event: 'real_collaboration_passed', taskId: task.taskId, independentMcpPids: peers.map(peer => peer.pid), events: events.length, evidenceDirectory: directory }));
  } finally {
    for (const client of clients) await client.close();
    for (const peer of peers) {
      if (peer.child.exitCode !== null || peer.child.signalCode !== null) continue;
      processAudit.push({ event: 'termination_requested', pid: peer.pid, requestedAt: new Date().toISOString(), requestedSignal: 'SIGTERM' });
      peer.child.kill('SIGTERM');
      await peer.exited;
    }
    await writeFile(resolve(directory, 'http-audit.json'), JSON.stringify(audit, null, 2));
    await writeFile(resolve(directory, 'processes.json'), JSON.stringify(processAudit, null, 2));
  }
});
