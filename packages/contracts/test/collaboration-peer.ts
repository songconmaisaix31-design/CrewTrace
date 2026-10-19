import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { Client } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../../services/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { CollaborationMessagesResponseSchema, CollaborationToolSchemas } from '../src/collaboration.ts';

assert.ok(process.argv[2], '需要当前独立进程的私有配置');
const config = z.strictObject({ BASE_URL: z.url(), CREDENTIAL: z.string().min(32), AGENT_ID: z.uuid(), PEER_ID: z.uuid(), TASK_ID: z.uuid(), MARKER: z.uuid(), OUTPUT: z.string().min(1) }).parse(parseEnv(await readFile(process.argv[2], 'utf8')));
const client = new Client({ name: `public-collaboration-peer-${process.pid}`, version: '1.0.0' });
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `实际 MCP 工具 ${name} 返回错误`);
  const text = (result.content as { type: string; text?: string }[]).find(item => item.type === 'text')?.text;
  assert.ok(text);
  return JSON.parse(text);
};
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', config.BASE_URL), { requestInit: { headers: { Authorization: `Bearer ${config.CREDENTIAL}` } } }));
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of Object.keys(CollaborationToolSchemas)) assert.ok(tools.includes(name), `服务未提供 ${name}`);
  await call('heartbeat_collaboration_agent', {});
  const published = await call('publish_collaboration_message', { request: { taskId: config.TASK_ID, kind: 'ANNOUNCEMENT', body: `${config.MARKER} 独立 Agent ${config.AGENT_ID} 已通过真实 MCP 接入。` } });
  const deadline = Date.now() + 90_000;
  for (;;) {
    const messages = CollaborationMessagesResponseSchema.parse(await call('list_collaboration_messages', { taskId: config.TASK_ID, after: 0, limit: 100 }));
    const peer = messages.messages.find(message => message.author === config.PEER_ID && message.body.includes(config.MARKER));
    if (peer) {
      const evidence = { pid: process.pid, agentId: config.AGENT_ID, peerAgentId: config.PEER_ID, taskId: config.TASK_ID, observedAt: new Date().toISOString(), published, peerMessage: peer, tools };
      await writeFile(config.OUTPUT, JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify({ event: 'independent_peer_read', pid: process.pid, agentId: config.AGENT_ID, peerAgentId: config.PEER_ID, messageId: peer.messageId }));
      break;
    }
    assert.ok(Date.now() < deadline, '实际 MCP 同伴消息等待超时');
    await setTimeout(1000);
  }
} finally { await client.close(); }
