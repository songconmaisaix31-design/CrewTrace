import type { MiddlewareHandler } from 'hono';
import type { Application } from './application.js';
import type { Principal } from './auth.js';
import { requestClientAddress } from './client-address.js';
import { AppError } from './errors.js';
import { FixedWindowLimiter } from './rate-limit.js';

const HIGH_COST_WRITES: { method: string; pattern: RegExp }[] = [
  { method: 'POST', pattern: /^\/api\/runs$/ },
  { method: 'POST', pattern: /^\/api\/collaboration\/tasks$/ },
  { method: 'PATCH', pattern: /^\/api\/collaboration\/tasks\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/collaboration\/tasks\/[^/]+\/(matching|csv-workflow|proposals|claims|handoffs)$/ },
  { method: 'POST', pattern: /^\/api\/collaboration\/(proposals|claims|handoffs)\/[^/]+\/(decision|release|review|expire-csv|worker-failure)$/ },
];

function highCostWrite(method: string, path: string): boolean {
  return HIGH_COST_WRITES.some(rule => rule.method === method && rule.pattern.test(path));
}

/**
 * 公开部署的入口保护：请求频率、高成本写入与 Agent 注册额度。
 *
 * 单进程固定窗口只用于快速拦截突发流量，真正的订单与任务额度由数据库共享计数负责。
 */
export function publicDemoGuard(app: Application): MiddlewareHandler<{ Variables: { principal: Principal } }> {
  const collabLimiter = new FixedWindowLimiter(app.config.PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE, 60_000);
  const configuredWorkers = new Set((app.config.EXPERIMENT_WORKER_AGENT_IDS ?? '').split(',').filter(Boolean));
  return async (c, next) => {
    const principal = c.get('principal');
    if (principal.kind === 'admin') return next();
    const trustedWorker = 'agentId' in principal && configuredWorkers.has(principal.agentId);
    const path = c.req.path;
    if (path.startsWith('/api/collaboration') || path === '/mcp') {
      const address = requestClientAddress(c, app.config);
      if (!trustedWorker) {
        const limit = collabLimiter.take(`collab:${address}`);
        if (!limit.allowed) {
          c.header('Retry-After', String(limit.retryAfterSeconds));
          throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
        }
      }
      if (!trustedWorker && highCostWrite(c.req.method, path)) {
        throw new AppError(403, 'PUBLIC_DEMO_READ_ONLY', '公开免费 Demo 不允许创建或修改协作任务，请使用免费清洗服务下单');
      }
      if (!trustedWorker && c.req.method === 'POST' && path === '/api/collaboration/agents') {
        const address = requestClientAddress(c, app.config);
        await app.store.write(client => app.demo.reserveRegistration(client, address));
      }
    }
    await next();
  };
}
