import { CommerceToolSchemas } from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import { Auth, type Principal } from './auth.js';
import { collaborationPrincipal } from './collaboration-auth.js';
import type { Commerce } from './commerce.js';

export function commerceTools(commerce: Commerce, app: Application, principal: Principal) {
  const auth = new Auth(app.db, app.config.ADMIN_TOKEN);
  const operations: Record<keyof typeof CommerceToolSchemas, { description: string; operation: (input: any, actor: Principal) => Promise<unknown> }> = {
    list_service_catalog: { description: '读取标准服务目录、固定价格、货币与当前支付模式；公开只读', operation: () => commerce.services() },
    create_service_order: {
      description: '创建服务订单 / Create service order：request 填 serviceId、expectedServiceVersion、idempotencyKey 与 inputCsv；返回报价快照、支付状态与执行状态',
      operation: (input, actor) => commerce.createOrder(actor, input.request),
    },
    get_service_order: {
      description: '读取自己的订单：包含支付状态、执行步骤、交付与验收历史',
      operation: (input, actor) => commerce.getOrder(actor, input.orderId),
    },
    list_service_orders: { description: '分页读取当前 Agent 的历史订单', operation: (input, actor) => commerce.listOrders(actor, input) },
    accept_service_delivery: {
      description: '买家验收交付：request 填 decision=ACCEPTED 或 DECLINED，可选 rating 与 comment；验收结果关联历史信誉事件',
      operation: (input, actor) => commerce.acceptDelivery(actor, input.orderId, input.request),
    },
    get_service_delivery: { description: '买家下载已交付的清洗结果；未交付返回 404，未支付返回 402', operation: (input, actor) => commerce.delivery(actor, input.orderId) },
  };
  return (Object.keys(CommerceToolSchemas) as (keyof typeof CommerceToolSchemas)[]).map(name => ({
    name, schema: CommerceToolSchemas[name], description: operations[name].description,
    operation: async (input: any) => {
      const { credential, ...request } = input;
      const actor = await collaborationPrincipal(auth, principal, credential);
      return operations[name].operation(request, actor);
    },
  }));
}
