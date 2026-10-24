import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import type { Actor,Commerce } from './service.js';
import { AppError,errorBody } from './errors.js';
import { guide,mcpResponse } from './mcp.js';

export function createHttp(app:Commerce){
  const http=new Hono<{Variables:{actor:Actor|null}}>();
  const allowed=new Set([new URL(app.config.PUBLIC_BASE_URL).origin,...app.config.ALLOWED_ORIGINS.split(',').map(s=>s.trim()).filter(Boolean)]);
  http.use('*',secureHeaders());
  http.use('*',bodyLimit({maxSize:300000,onError:c=>c.json({error:{code:'PAYLOAD_TOO_LARGE',message:'输入超过 300KB'}},413)}));
  http.use('*',async(c,next)=>{c.header('Cache-Control','no-store');const origin=c.req.header('Origin');if(origin&&!allowed.has(origin))throw new AppError(403,'ORIGIN_DENIED','请求来源未获准');await next();});
  http.use('*',cors({origin:origin=>allowed.has(origin)?origin:undefined,allowMethods:['GET','POST','PATCH','OPTIONS'],allowHeaders:['Content-Type','Authorization','Payment-Proof','MCP-Protocol-Version'],exposeHeaders:['amtPaymentLink'],maxAge:600}));
  http.onError((e,c)=>{const {status,error}=errorBody(e);return c.json({error},status as 400);});
  http.get('/health',async c=>c.json(await app.health()));
  http.get('/api/guide',c=>c.text(guide(app.config.PUBLIC_BASE_URL)));
  http.post('/api/identities',async c=>c.json(await app.register(await c.req.json()),201));
  http.use('/api/*',async(c,next)=>{
    if(c.req.path.startsWith('/api/admin/')){app.admin(c.req.header('Authorization'));c.set('actor',null);}
    else c.set('actor',await app.authenticate(c.req.header('Authorization')));
    await next();
  });
  http.get('/api/me',c=>c.json(app.actor(c.get('actor'))));
  http.post('/api/me/rotate',async c=>c.json(await app.rotate(c.get('actor'))));
  http.get('/api/services',async c=>c.json(await app.services(c.req.query('q'),c.req.query('category'),c.get('actor'))));
  http.post('/api/services',async c=>c.json(await app.publish(c.get('actor'),await c.req.json()),201));
  http.patch('/api/services/:id',async c=>{const {published}=z.strictObject({published:z.boolean()}).parse(await c.req.json());return c.json(await app.setPublished(c.get('actor'),c.req.param('id'),published));});
  http.get('/api/services/:id/reputation',async c=>c.json(await app.reputation(c.req.param('id'))));
  http.post('/api/orders',async c=>c.json(await app.createOrder(c.get('actor'),await c.req.json()),201));
  http.get('/api/orders',async c=>c.json(await app.listOrders(c.get('actor'))));
  http.get('/api/orders/:id',async c=>c.json(await app.detail(c.get('actor'),c.req.param('id'))));
  const pay=async(c:any)=>{
    const result=await app.pay(c.get('actor'),c.req.param('id'),c.req.header('Payment-Proof'));
    if(!result.paid){c.header('amtPaymentLink',String(result.payment!.amtPaymentLink));return c.json(result,402);}
    return c.json(result);
  };
  http.post('/api/orders/:id/payment',pay);
  http.get('/api/orders/:id/resource',async c=>{
    const result=await app.pay(c.get('actor'),c.req.param('id'),c.req.header('Payment-Proof'));
    if(!result.paid){c.header('amtPaymentLink',String(result.payment!.amtPaymentLink));return c.json(result,402);}
    if(result.order.snapshot.engine==='csv'&&result.order.status==='READY')await app.execute(c.get('actor'),c.req.param('id'));
    const detail=await app.detail(c.get('actor'),c.req.param('id'));return c.json(detail,detail.deliveries.length?200:202);
  });
  http.post('/api/orders/:id/execute',async c=>c.json(await app.execute(c.get('actor'),c.req.param('id'))));
  http.post('/api/orders/:id/deliveries',async c=>c.json(await app.submit(c.get('actor'),c.req.param('id'),await c.req.json()),201));
  http.post('/api/orders/:id/review',async c=>c.json(await app.review(c.get('actor'),c.req.param('id'),await c.req.json())));
  http.post('/api/orders/:id/cancel',async c=>c.json(await app.cancel(c.get('actor'),c.req.param('id'))));
  http.post('/api/orders/:id/dispute',async c=>{const {reason}=z.strictObject({reason:z.string()}).parse(await c.req.json());return c.json(await app.dispute(c.get('actor'),c.req.param('id'),reason));});
  http.post('/api/admin/services/:id/binding',async c=>c.json(await app.bind(c.req.param('id'),await c.req.json())));
  http.post('/api/admin/orders/:id/refund',async c=>c.json(await app.refund(c.req.param('id'))));
  http.get('/api/admin/metrics',async c=>c.json({...await app.metrics(),environment:app.config.PAYMENT_MODE}));
  http.get('/api/admin/services',async c=>c.json(await app.adminServices()));
  http.patch('/api/admin/services/:id/price',async c=>{const {priceFen}=z.strictObject({priceFen:z.number().int().min(0).max(5000)}).parse(await c.req.json());return c.json(await app.setPrice(c.req.param('id'),priceFen));});
  http.get('/api/admin/disputes',async c=>c.json(await app.disputes()));
  http.post('/api/admin/orders/:id/resolve',async c=>{const {reason}=z.strictObject({reason:z.string()}).parse(await c.req.json());return c.json(await app.resolve(c.req.param('id'),reason));});
  http.post('/mcp',async c=>mcpResponse(app,await app.authenticate(c.req.header('Authorization')),c.req.raw));
  http.get('/mcp',c=>c.json({error:{code:'METHOD_NOT_ALLOWED',message:'请使用 Streamable HTTP POST'}},405));
  return http;
}
