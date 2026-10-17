import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Auth, type Principal } from './auth.js';
import { AppError, errorBody } from './errors.js';
import type { Application } from './service.js';
import { mcpResponse } from './mcp.js';

export function createHttp(app: Application) {
  const http = new Hono<{ Variables: { principal: Principal } }>();
  const auth = new Auth(app.db, app.config.ADMIN_TOKEN);
  const origins = app.config.ALLOWED_ORIGINS.split(',').filter(Boolean);
  const ownOrigin = new URL(app.config.PUBLIC_BASE_URL).origin;
  http.use('*', cors({ origin: origins, allowHeaders: ['Authorization', 'Content-Type', 'mcp-protocol-version'], allowMethods: ['GET','POST','PATCH','DELETE','OPTIONS'] }));
  http.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => { throw new AppError(413, 'BODY_TOO_LARGE', '请求内容超过 2 MiB'); } }));
  http.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && origin !== ownOrigin && !origins.includes(origin)) throw new AppError(403, 'ORIGIN_REJECTED', '请求来源未获授权');
    if (c.req.path === '/mcp' && new URL(c.req.url).host !== new URL(app.config.PUBLIC_BASE_URL).host) throw new AppError(403, 'HOST_REJECTED', 'MCP Host 不匹配');
    c.set('principal', await auth.authenticate(c.req.header('Authorization')));
    await next();
  });
  http.onError((error,c) => { const body = errorBody(error); return c.json({ error: body.error }, body.status as 400); });
  http.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: '端点不存在' } },404));
  http.get('/health', async c => c.json(await app.health()));
  http.get('/api/runs/:id/events', async c => c.json(await app.store.events(c.req.param('id'), z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(c.req.query('after') ?? 0))));
  http.all('/mcp', c => mcpResponse(app,c.get('principal'),c.req.raw));
  return http;
}
