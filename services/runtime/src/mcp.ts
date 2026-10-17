import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Principal } from './auth.js';
import type { Application } from './service.js';
import { errorBody } from './errors.js';

export async function mcpResponse(app: Application, _principal: Principal, request: Request) {
  const server = new McpServer({ name: 'co-vibe-runtime', version: '0.1.0' }, { maxToolInputElements: 1000 });
  server.registerTool('health', { description: '读取 PostgreSQL 和链适配器依赖状态', inputSchema: {} }, async () => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await app.health()) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorBody(error)) }] }; }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close(); }
}
