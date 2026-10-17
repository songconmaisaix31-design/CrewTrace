import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { Application } from '../src/service.js';
import { createHttp } from '../src/http.js';
import type { Config } from '../src/config.js';

test('真实 PostgreSQL、HTTP 与官方 MCP Client', async () => {
  assert.ok(process.env.DATABASE_URL, '真实 DATABASE_URL 必须配置');
  const db = new Database(process.env.DATABASE_URL);
  await migrate(db);
  const config: Config = { DATABASE_URL: process.env.DATABASE_URL, ADMIN_TOKEN: randomBytes(32).toString('hex'), PUBLIC_BASE_URL: 'http://127.0.0.1:3000', PORT: 0, ALLOWED_ORIGINS: '' };
  const http = createHttp(new Application(db,config));
  const server = serve({ fetch: http.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  config.PUBLIC_BASE_URL = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'co-vibe-official-client-test',version: '1.0.0' });
  try {
    const response = await fetch(`${config.PUBLIC_BASE_URL}/health`);
    assert.equal(response.status,200);
    assert.equal((await response.json()).database,'connected');
    await client.connect(new StreamableHTTPClientTransport(new URL(`${config.PUBLIC_BASE_URL}/mcp`)));
    assert.equal(client.getServerVersion()?.name,'co-vibe-runtime');
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === 'health'));
    const result = await client.callTool({ name: 'health',arguments: {} });
    assert.notEqual(result.isError,true);
  } finally {
    await client.close();
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  }
});
