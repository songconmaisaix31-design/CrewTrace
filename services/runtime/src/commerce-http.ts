import type { Context, Hono, MiddlewareHandler } from 'hono';
import { CollaborationIdSchema, OrderQuerySchema } from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import type { Principal } from './auth.js';
import type { Commerce } from './commerce.js';
import { AppError } from './errors.js';
import { FixedWindowLimiter } from './rate-limit.js';

function clientAddress(c: Context): string {
  // 只信任反向代理覆写后的首个 X-Forwarded-For；Runtime 不应直接暴露在公网。
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded && forwarded.length <= 64) return forwarded;
  const real = c.req.header('x-real-ip')?.trim();
  if (real && real.length <= 64) return real;
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

export function mountCommerce(http: Hono<{ Variables: { principal: Principal } }>, app: Application, commerce: Commerce) {
  const prefix = '/api/commerce';
  const minuteLimiter = new FixedWindowLimiter(app.config.PUBLIC_RATE_LIMIT_PER_MINUTE, 60_000);
  const orderLimiter = new FixedWindowLimiter(app.config.PUBLIC_ORDER_LIMIT_PER_HOUR, 3_600_000);
  if (app.config.PUBLIC_DEPLOYMENT) {
    const limit: MiddlewareHandler<{ Variables: { principal: Principal } }> = async (c, next) => {
      if (c.get('principal').kind === 'admin') return next();
      const address = clientAddress(c);
      if (c.req.method === 'POST' && c.req.path === `${prefix}/orders`) {
        const order = orderLimiter.take(`order:${address}`);
        if (!order.allowed) {
          c.header('Retry-After', String(order.retryAfterSeconds));
          throw new AppError(429, 'RATE_LIMITED', '创建订单过于频繁，请稍后重试');
        }
      }
      const minute = minuteLimiter.take(`minute:${address}`);
      if (!minute.allowed) {
        c.header('Retry-After', String(minute.retryAfterSeconds));
        throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
      }
      await next();
    };
    http.use(`${prefix}/*`, limit);
  }
  const id = (value: string) => CollaborationIdSchema.parse(value);
  http.get(prefix, c => c.json({
    status: 'ok', paymentMode: commerce.payments.mode, officialPayment: commerce.payments.official,
    simulatedPayment: commerce.payments.simulated,
    deploymentEnv: app.config.DEPLOYMENT_ENV, publicDeployment: app.config.PUBLIC_DEPLOYMENT,
  }));
  http.get(`${prefix}/services`, async c => c.json(await commerce.services()));
  http.post(`${prefix}/orders`, async c => c.json(await commerce.createOrder(c.get('principal'), await c.req.json()), 201));
  http.get(`${prefix}/orders`, async c => c.json(await commerce.listOrders(c.get('principal'), OrderQuerySchema.parse(c.req.query()))));
  http.get(`${prefix}/orders/:id`, async c => c.json(await commerce.getOrder(c.get('principal'), id(c.req.param('id')))));
  http.post(`${prefix}/orders/:id/payment`, async c => {
    const payment = await commerce.requestPayment(c.get('principal'), id(c.req.param('id')));
    if (payment.paymentLink) c.header('amtPaymentLink', payment.paymentLink);
    return c.json(payment);
  });
  http.post(`${prefix}/orders/:id/payment/reconcile`, async c => c.json(
    await commerce.reconcilePayment(c.get('principal'), id(c.req.param('id')), await c.req.json()),
  ));
  http.post(`${prefix}/orders/:id/payment-proof`, async c => {
    const header = c.req.header('Payment-Proof');
    if (!header) throw new AppError(400, 'INVALID_PROOF', '需要 Payment-Proof 请求头');
    return c.json(await commerce.submitPaymentProof(c.get('principal'), id(c.req.param('id')), header));
  });
  http.post(`${prefix}/orders/:id/acceptance`, async c => c.json(await commerce.acceptDelivery(c.get('principal'), id(c.req.param('id')), await c.req.json()), 201));
  http.get(`${prefix}/orders/:id/delivery`, async c => c.json(
    await commerce.delivery(c.get('principal'), id(c.req.param('id')), c.req.header('Payment-Proof')),
  ));
  http.get(`${prefix}/orders/:id/execution`, async c => c.json(
    await commerce.execution(c.get('principal'), id(c.req.param('id')), c.req.header('Payment-Proof')),
  ));
}
