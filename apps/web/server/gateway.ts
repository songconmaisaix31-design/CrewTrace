import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { keccak256, toBytes } from 'viem';
import { z } from 'zod';
import { CreateRunWithInputRequestSchema } from '../vendor/contracts/schemas.ts';

const inputs = {
  'round-1': readFileSync(new URL('../src/data/round-1.csv', import.meta.url), 'utf8'),
  'round-2': readFileSync(new URL('../src/data/round-2.csv', import.meta.url), 'utf8'),
};
const criteria = readFileSync(new URL('../src/data/criteria.json', import.meta.url), 'utf8');
const CreateSchema = z.object({ runId: z.string().uuid(), sample: z.enum(['round-1', 'round-2']) });
const readRoutes = [
  /^\/health$/, /^\/api\/agents$/,
  /^\/api\/runs\/[^/?]+(?:\/input|\/events\?after=\d+)?$/,
  /^\/api\/artifacts\/[^/?]+(?:\/metadata)?$/,
  /^\/api\/decisions\/[^/?]+$/,
  /^\/api\/tasks\/[^/?]+\/assessments\/\d+\/evidence$/,
  /^\/api\/(?:announcements|notes)\?runId=[^&]+$/,
];
export function allowedReadPath(path: string) {
  return !/%2f|%5c|%2e|\.\.|\\/i.test(path) && readRoutes.some(rule => rule.test(path));
}
function authorized(value: string | string[] | undefined, secret: string | undefined) {
  if (typeof value !== 'string' || !secret || secret.length < 16) return false;
  const a = Buffer.from(value), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function gateway(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
  const config = process.env;
  const ready = Boolean(config.RUNTIME_URL && config.ADMIN_TOKEN && config.VALIDATOR_ADDRESS && config.DEMO_ACCESS_CODE && config.DEMO_ACCESS_CODE.length >= 16);
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.searchParams.get('action') === 'status') {
      json(200, { configured: Boolean(config.RUNTIME_URL), creationConfigured: ready }); return;
    }
    if (!config.RUNTIME_URL) { json(503, {error:{message:'任务服务尚未配置',code:'NOT_CONFIGURED'}}); return; }
    const base = new URL(config.RUNTIME_URL);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('服务地址协议无效');
    const path = url.searchParams.get('path') ?? '';
    let body: string | undefined;
    const headers: Record<string,string> = {};
    if (req.method === 'POST' && path === '/api/runs') {
      if (!ready || !authorized(req.headers['x-demo-code'], config.DEMO_ACCESS_CODE)) {
        json(403, {error:{message:'需要有效的演示授权码',code:'UNAUTHORIZED'}}); return;
      }
      let parsed: unknown = (req as IncomingMessage & {body?:unknown}).body;
      if (parsed === undefined) {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > 4096) { json(413,{error:{message:'请求过大'}}); return; }
          chunks.push(Buffer.from(chunk));
        }
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } else if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      const input = CreateSchema.parse(parsed);
      const content = inputs[input.sample];
      body = JSON.stringify(CreateRunWithInputRequestSchema.parse({runId:input.runId,inputContent:content,inputHash:keccak256(toBytes(content)),criteriaHash:keccak256(toBytes(criteria)),validator:config.VALIDATOR_ADDRESS}));
      headers.Authorization = `Bearer ${config.ADMIN_TOKEN}`;
      headers['Content-Type'] = 'application/json';
    } else if (req.method !== 'GET' || !allowedReadPath(path)) {
      json(405,{error:{message:'不支持的操作'}}); return;
    }
    const upstream = await fetch(new URL(path, base), {method:req.method,headers,body,signal:AbortSignal.timeout(12000),redirect:'error'});
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'text/plain; charset=utf-8');
    const disposition = upstream.headers.get('Content-Disposition');
    if (disposition) res.setHeader('Content-Disposition', disposition);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) json(400,{error:{message:'请求字段或服务配置不符合接口约定'}});
    else json(502,{error:{message:'任务服务暂时无法访问，请稍后重试；创建请求可能已送达，请先查询原运行 ID。'}});
  }
}
