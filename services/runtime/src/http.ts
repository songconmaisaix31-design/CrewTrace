import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Auth, type Principal } from './auth.js';
import { AppError, errorBody } from './errors.js';
import type { Application } from './service.js';
import { mcpResponse } from './mcp.js';
import { Board } from './board.js';
import { Execution } from './execution.js';
import {
  AcceptTaskRequestSchema, AddressSchema, AssignTaskRequestSchema, CreateRunWithInputRequestSchema,
  HandoffUpdateRequestSchema, InterruptRequestSchema, ModelCallRequestSchema, NodeEnrollmentRequestSchema,
} from '../../../packages/contracts/src/index.ts';

export function createHttp(app: Application) {
  const http = new Hono<{ Variables: { principal: Principal } }>();
  const auth = new Auth(app.db, app.config.ADMIN_TOKEN);
  const board = new Board(app);
  const execution = new Execution(app);
  const origins = app.config.ALLOWED_ORIGINS.split(',').filter(Boolean);
  const ownOrigin = new URL(app.config.PUBLIC_BASE_URL).origin;
  http.use('*', cors({ origin: origins, allowHeaders: ['Authorization', 'Content-Type', 'mcp-protocol-version'], allowMethods: ['GET','POST','PATCH','DELETE','OPTIONS'] }));
  http.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => { throw new AppError(413, 'BODY_TOO_LARGE', '请求内容超过 2 MiB'); } }));
  http.use('*', async (c, next) => {
    c.header('Cache-Control','no-store');
    const origin = c.req.header('Origin');
    if (origin && origin !== ownOrigin && !origins.includes(origin)) throw new AppError(403, 'ORIGIN_REJECTED', '请求来源未获授权');
    if (c.req.path === '/mcp' && new URL(c.req.url).host !== new URL(app.config.PUBLIC_BASE_URL).host) throw new AppError(403, 'HOST_REJECTED', 'MCP Host 不匹配');
    c.set('principal', await auth.authenticate(c.req.header('Authorization')));
    await next();
  });
  http.onError((error,c) => { const body = errorBody(error); return c.json({ error: body.error }, body.status as 400); });
  http.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: '端点不存在' } },404));
  http.get('/health', async c => c.json(await app.health()));
  http.get('/api/agents',async c=>c.json({ agents: await app.agents() }));
  http.post('/api/runs',async c=>c.json(await app.createRun(c.get('principal'),CreateRunWithInputRequestSchema.parse(await c.req.json())),201));
  http.get('/api/runs/:id',async c=>c.json(await app.runDetails(c.req.param('id'))));
  http.get('/api/runs/:id/input',async c=>new Response(new Uint8Array(await app.input(c.req.param('id'))),{ headers: { 'Content-Type': 'text/csv; charset=utf-8','Content-Disposition': 'attachment; filename="input.csv"' } }));
  http.get('/api/runs/:id/events', async c => c.json(await app.store.events(c.req.param('id'), z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(c.req.query('after') ?? 0))));
  http.get('/api/artifacts/:id',async c=>{
    const { artifact,bytes } = await app.artifact(c.req.param('id'));
    return new Response(new Uint8Array(bytes),{ headers: { 'Content-Type': 'text/plain; charset=utf-8','X-Content-Hash': artifact.contentHash,'Content-Disposition': `attachment; filename="${encodeURIComponent(artifact.artifactId)}"` } });
  });
  http.get('/api/artifacts/:id/metadata',async c=>c.json((await app.artifact(c.req.param('id'))).artifact));
  http.get('/api/tasks/:id',async c=>c.json(await app.task(c.req.param('id'))));
  http.get('/api/decisions/:id',async c=>{
    const result = await execution.decisionBytes(c.req.param('id'));
    return new Response(new Uint8Array(result.bytes),{ headers: { 'Content-Type': 'application/json; charset=utf-8','X-Content-Hash': result.contentHash } });
  });
  http.get('/api/tasks/:id/assessments/:attempt/evidence',async c=>new Response(new Uint8Array(await execution.evidence(c.req.param('id'),z.coerce.number().int().positive().parse(c.req.param('attempt')))),{ headers: { 'Content-Type':'application/json; charset=utf-8' } }));
  http.post('/admin/nodes',async c=>{
    const request = NodeEnrollmentRequestSchema.parse(await c.req.json());
    return c.json(await app.enroll(c.get('principal'),request.profile,request.signature),201);
  });
  http.post('/admin/nodes/:id/rotate',async c=>c.json(await app.rotateCredential(c.get('principal'),AddressSchema.parse(c.req.param('id')))));
  http.post('/admin/nodes/:id/register',async c=>c.json(await app.registerChain(c.get('principal'),AddressSchema.parse(c.req.param('id')))));
  http.post('/admin/tasks/:id/assign',async c=>{
    const request = AssignTaskRequestSchema.parse(await c.req.json());
    return c.json(await execution.assign(c.get('principal'),c.req.param('id'),request));
  });
  http.post('/admin/tasks/:id/assess',async c=>c.json(await execution.assess(c.get('principal'),c.req.param('id'))));
  http.post('/admin/runs/:id/:action',async c=>c.json(await execution.control(c.get('principal'),c.req.param('id'),z.enum(['pause','resume','cancel']).parse(c.req.param('action')))));
  http.post('/worker/heartbeat',async c=>c.json(await app.heartbeat(c.get('principal'),await c.req.json())));
  http.get('/worker/jobs',async c=>c.json(await app.jobs(c.get('principal'))));
  http.post('/worker/tasks/:id/accept',async c=>c.json(await execution.accept(c.get('principal'),c.req.param('id'),AcceptTaskRequestSchema.parse(await c.req.json()).attempt)));
  http.post('/worker/artifacts',async c=>c.json(await execution.upload(c.get('principal'),await c.req.json()),201));
  http.post('/worker/tasks/:id/submit',async c=>c.json(await execution.submit(c.get('principal'),c.req.param('id'),await c.req.json())));
  http.post('/worker/tasks/:id/model-calls',async c=>c.json(await execution.reserveModelCall(c.get('principal'),c.req.param('id'),ModelCallRequestSchema.parse(await c.req.json()).attempt)));
  http.post('/worker/tasks/:id/interrupt',async c=>{
    const request = InterruptRequestSchema.parse(await c.req.json());
    return c.json(await execution.interrupt(c.get('principal'),c.req.param('id'),request.attempt,request.reason));
  });
  http.post('/worker/handoffs/:id',async c=>{
    const request = HandoffUpdateRequestSchema.parse(await c.req.json());
    return c.json(await execution.handoff(c.get('principal'),c.req.param('id'),request.status as 'ACCEPTED'|'RETURNED',request.reason));
  });
  http.get('/api/announcements',async c=>c.json(await board.announcements(c.req.query('runId'),c.req.query('taskId'))));
  http.post('/api/announcements',async c=>c.json(await board.publish(c.get('principal'),await c.req.json()),201));
  http.get('/api/notes',async c=>c.json(await board.notes(c.req.query('runId'),c.req.query('taskId'))));
  http.post('/api/notes',async c=>c.json(await board.createNote(c.get('principal'),await c.req.json()),201));
  http.get('/api/notes/:id',async c=>c.json(await board.note(c.req.param('id'))));
  http.patch('/api/notes/:id',async c=>c.json(await board.updateNote(c.get('principal'),c.req.param('id'),await c.req.json())));
  http.all('/mcp', c => mcpResponse(app,c.get('principal'),c.req.raw));
  return http;
}
