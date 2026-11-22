import type { Hono } from 'hono';
import { CollaborationIdSchema, OrderQuerySchema } from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import type { Principal } from './auth.js';
import type { Commerce } from './commerce.js';
import { AppError } from './errors.js';

export function mountCommerce(http: Hono<{ Variables: { principal: Principal } }>, app: Application, commerce: Commerce) {
  const prefix = '/api/commerce';
  const id = (value: string) => CollaborationIdSchema.parse(value);
  http.get(prefix, c => c.json({
    status: 'ok', paymentMode: commerce.payments.mode, officialPayment: commerce.payments.official,
    simulatedPayment: commerce.payments.simulated,
  }));
  http.get(`${prefix}/services`, async c => c.json(await commerce.services()));
  http.post(`${prefix}/orders`, async c => c.json(await commerce.createOrder(c.get('principal'), await c.req.json()), 201));
  http.get(`${prefix}/orders`, async c => c.json(await commerce.listOrders(c.get('principal'), OrderQuerySchema.parse(c.req.query()))));
  http.get(`${prefix}/orders/:id`, async c => c.json(await commerce.getOrder(c.get('principal'), id(c.req.param('id')))));
  http.post(`${prefix}/orders/:id/payment`, async c => c.json(await commerce.requestPayment(c.get('principal'), id(c.req.param('id')))));
  http.post(`${prefix}/orders/:id/payment-proof`, async c => {
    const header = c.req.header('Payment-Proof');
    if (!header) throw new AppError(400, 'INVALID_PROOF', '需要 Payment-Proof 请求头');
    return c.json(await commerce.submitPaymentProof(c.get('principal'), id(c.req.param('id')), header));
  });
  http.post(`${prefix}/orders/:id/acceptance`, async c => c.json(await commerce.acceptDelivery(c.get('principal'), id(c.req.param('id')), await c.req.json()), 201));
  http.get(`${prefix}/orders/:id/delivery`, async c => c.json(await commerce.delivery(c.get('principal'), id(c.req.param('id')))) );
  http.get(`${prefix}/orders/:id/execution`, async c => c.json(await commerce.execution(c.get('principal'), id(c.req.param('id')))));
}
