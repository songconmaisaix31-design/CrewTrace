import { z } from 'zod';
import { parseTrustedProxies } from './proxy-trust.js';

const configSchema = z.object({
  DATABASE_URL: z.url(),
  ADMIN_TOKEN: z.string().min(32),
  PUBLIC_BASE_URL: z.url(),
  PUBLIC_MCP_URL: z.url().optional(),
  PUBLIC_WEB_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  EXPERIMENT_CHAIN_WRITES: z.enum(['OFF','TESTNET']).optional(),
  EXPERIMENT_WORKER_AGENT_IDS: z.string().regex(/^[0-9a-f-]{36}(?:,[0-9a-f-]{36})*$/i).optional(),
  CHAIN_ADAPTER_MODULE: z.string().min(1).optional(),
  CHAIN_ID: z.coerce.number().int().positive().default(10143),
  CHAIN_RPC_URL: z.url().optional(),
  CHAIN_DEPLOYMENT_BLOCK: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
  CHAIN_CONTRACT: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  CHAIN_COORDINATOR: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  CHAIN_VALIDATOR: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  CHAIN_COORDINATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  CHAIN_VALIDATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  COLLABORATION_CHAIN_ID: z.coerce.number().int().positive().default(10143),
  COLLABORATION_CHAIN_RPC_URL: z.url().optional(),
  COLLABORATION_CHAIN_DEPLOYMENT_BLOCK: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
  COLLABORATION_CHAIN_CONTRACT: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  COLLABORATION_CHAIN_RECORDER: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  COLLABORATION_CHAIN_RECORDER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  COLLABORATION_CHAIN_EXPLORER: z.url().default('https://testnet.monadscan.com'),
  COLLABORATION_CHAIN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  VALIDATOR_MODULE: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z.string().default(''),
  PAYMENT_MODE: z.enum(['disabled','sandbox','production','simulated']).default('disabled'),
  /** 独立部署环境标识，用于在不依赖 NODE_ENV 的情况下隔离模拟支付。 */
  DEPLOYMENT_ENV: z.enum(['local','test','staging','production']).default('local'),
  /** 公开部署必须显式为 true，模拟支付在该值为 true 时一律禁止。 */
  PUBLIC_DEPLOYMENT: z.enum(['true','false']).default('false').transform(value => value === 'true'),
  /** 模拟支付的双重确认，只允许在本地或测试环境填写 local-only。 */
  PAYMENT_SIMULATED_ACK: z.literal('local-only').optional(),
  /** 公开部署下每个客户端 IP 每分钟允许的 API 请求数，0 表示关闭。 */
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).max(10000).default(60),
  /** 公开部署下每个客户端 IP 每小时允许创建的订单数，0 表示关闭。 */
  PUBLIC_ORDER_LIMIT_PER_HOUR: z.coerce.number().int().min(0).max(10000).default(10),
  /** 代理信任模式：none 只使用 socket 地址，cidr 只信任指定代理转发的请求头。 */
  PROXY_TRUST_MODE: z.enum(['none','cidr']).default('none'),
  /** 可信反向代理 CIDR 列表，多个用逗号分隔。 */
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  /** 部署版本 SHA，公开部署必须提供，用于健康检查与日志追溯。 */
  DEPLOYMENT_SHA: z.string().regex(/^[0-9a-f]{40}$/i).optional(),
  /** 公开部署下每个客户端 IP 每分钟允许的协作与 MCP 请求数。 */
  PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).max(10000).default(30),
  /** 公开免费 Demo 单次输入字符上限。 */
  DEMO_MAX_INPUT_CHARS: z.coerce.number().int().min(100).max(200_000).default(80_000),
  /** 公开免费 Demo 单次输入行数上限。 */
  DEMO_MAX_INPUT_ROWS: z.coerce.number().int().min(1).max(5000).default(2000),
  /** 同时处于执行状态的订单上限。 */
  DEMO_MAX_ACTIVE_ORDERS: z.coerce.number().int().min(1).max(1000).default(10),
  /** 每日全局免费订单上限。 */
  DEMO_GLOBAL_ORDERS_PER_DAY: z.coerce.number().int().min(1).max(100_000).default(100),
  /** 每日单个客户端地址免费订单上限。 */
  DEMO_IP_ORDERS_PER_DAY: z.coerce.number().int().min(1).max(10_000).default(10),
  /** 每日单个 Agent 免费订单上限。 */
  DEMO_AGENT_ORDERS_PER_DAY: z.coerce.number().int().min(1).max(10_000).default(5),
  /** 每日单个客户端地址允许注册的 Agent 数量。 */
  DEMO_AGENT_REGISTRATIONS_PER_IP_DAY: z.coerce.number().int().min(1).max(100).default(5),
  /** 每日通过 HTTP 或 MCP 创建协作任务的上限。 */
  DEMO_DAILY_TASKS: z.coerce.number().int().min(1).max(100_000).default(100),
  /** CSV 任务最大失败重试尝试次数。 */
  DEMO_CSV_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  /** 公开 Demo 的 Worker 租约秒数，超时后允许重新领取。 */
  DEMO_WORKER_LEASE_SECONDS: z.coerce.number().int().min(60).max(600).default(300),
  PAYMENT_TTL_SECONDS: z.coerce.number().int().min(60).max(43200).default(900),
  PAYMENT_SIMULATION_SECRET: z.string().min(32).optional(),
  ALIPAY_APP_ID: z.string().min(1).optional(),
  ALIPAY_PRIVATE_KEY: z.string().min(1).optional(),
  ALIPAY_PUBLIC_KEY: z.string().min(1).optional(),
  ALIPAY_KEY_TYPE: z.enum(['PKCS1','PKCS8']).default('PKCS8'),
  ALIPAY_GATEWAY: z.url().optional(),
  /** 内部 serviceId 到支付宝按量付费后台 service_id 的 JSON 映射，两者不得混用。 */
  ALIPAY_SERVICE_IDS: z.string().min(2).optional(),
}).superRefine((value, context) => {
  if (value.PAYMENT_MODE === 'simulated') {
    if (process.env.NODE_ENV === 'production') {
      context.addIssue({ code: 'custom', path: ['PAYMENT_MODE'], message: 'simulated 支付模式禁止在生产环境启用' });
    }
    if (value.DEPLOYMENT_ENV !== 'local' && value.DEPLOYMENT_ENV !== 'test') {
      context.addIssue({ code: 'custom', path: ['PAYMENT_MODE'], message: 'simulated 支付模式只允许在 local 或 test 环境启用' });
    }
    if (value.PUBLIC_DEPLOYMENT) {
      context.addIssue({ code: 'custom', path: ['PAYMENT_MODE'], message: '公开部署禁止启用 simulated 支付模式' });
    }
    if (value.PAYMENT_SIMULATED_ACK !== 'local-only') {
      context.addIssue({ code: 'custom', path: ['PAYMENT_SIMULATED_ACK'], message: 'simulated 支付模式需要显式确认 PAYMENT_SIMULATED_ACK=local-only' });
    }
    if (!value.PAYMENT_SIMULATION_SECRET) {
      context.addIssue({ code: 'custom', path: ['PAYMENT_SIMULATION_SECRET'], message: 'simulated 支付模式需要至少 32 位的本地签名密钥' });
    }
  } else if (value.PAYMENT_SIMULATED_ACK) {
    context.addIssue({ code: 'custom', path: ['PAYMENT_SIMULATED_ACK'], message: 'PAYMENT_SIMULATED_ACK 只能在 simulated 支付模式下设置' });
  }
  if (value.DEPLOYMENT_ENV === 'production' && value.PAYMENT_MODE === 'sandbox') {
    context.addIssue({ code: 'custom', path: ['PAYMENT_MODE'], message: 'production 部署环境不得使用支付宝沙箱模式' });
  }
  if (value.PROXY_TRUST_MODE === 'cidr') {
    if (!value.TRUSTED_PROXY_CIDRS.trim()) {
      context.addIssue({ code: 'custom', path: ['TRUSTED_PROXY_CIDRS'], message: 'PROXY_TRUST_MODE=cidr 必须配置至少一个可信代理 CIDR' });
    } else {
      try { parseTrustedProxies(value.TRUSTED_PROXY_CIDRS); }
      catch (error) { context.addIssue({ code: 'custom', path: ['TRUSTED_PROXY_CIDRS'], message: error instanceof Error ? error.message : '可信代理 CIDR 无效' }); }
    }
  } else if (value.TRUSTED_PROXY_CIDRS.trim()) {
    context.addIssue({ code: 'custom', path: ['TRUSTED_PROXY_CIDRS'], message: 'TRUSTED_PROXY_CIDRS 只在 PROXY_TRUST_MODE=cidr 时生效' });
  }
  if (value.PUBLIC_DEPLOYMENT) {
    if (!process.env.PROXY_TRUST_MODE) {
      context.addIssue({ code: 'custom', path: ['PROXY_TRUST_MODE'], message: '公开部署必须显式设置 PROXY_TRUST_MODE' });
    }
    if (!value.DEPLOYMENT_SHA) {
      context.addIssue({ code: 'custom', path: ['DEPLOYMENT_SHA'], message: '公开部署必须提供部署版本 SHA' });
    }
    if (process.env.NODE_ENV !== 'production') {
      context.addIssue({ code: 'custom', path: ['PUBLIC_DEPLOYMENT'], message: '公开部署必须设置 NODE_ENV=production' });
    }
    if (!value.PUBLIC_BASE_URL.startsWith('https://')) {
      context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: '公开部署必须使用 HTTPS 的 PUBLIC_BASE_URL' });
    }
    if (!value.ALLOWED_ORIGINS.trim()) {
      context.addIssue({ code: 'custom', path: ['ALLOWED_ORIGINS'], message: '公开部署必须配置来源白名单' });
    }
    if (value.DEPLOYMENT_ENV !== 'staging' && value.DEPLOYMENT_ENV !== 'production') {
      context.addIssue({ code: 'custom', path: ['DEPLOYMENT_ENV'], message: '公开部署必须使用 staging 或 production 环境标识' });
    }
    if (value.PUBLIC_RATE_LIMIT_PER_MINUTE === 0 || value.PUBLIC_ORDER_LIMIT_PER_HOUR === 0) {
      context.addIssue({ code: 'custom', path: ['PUBLIC_RATE_LIMIT_PER_MINUTE'], message: '公开部署必须启用请求限额' });
    }
  }
  if (value.PAYMENT_MODE === 'sandbox' || value.PAYMENT_MODE === 'production') {
    for (const key of ['ALIPAY_APP_ID','ALIPAY_PRIVATE_KEY','ALIPAY_PUBLIC_KEY'] as const) {
      if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: '官方支付宝模式缺少必要配置' });
    }
    if (!value.ALIPAY_SERVICE_IDS) {
      context.addIssue({ code: 'custom', path: ['ALIPAY_SERVICE_IDS'], message: '官方支付宝模式必须配置内部 serviceId 到官方 service_id 的映射' });
    } else {
      let mapping: unknown;
      try { mapping = JSON.parse(value.ALIPAY_SERVICE_IDS); } catch {
        context.addIssue({ code: 'custom', path: ['ALIPAY_SERVICE_IDS'], message: 'ALIPAY_SERVICE_IDS 必须是合法 JSON' });
      }
      if (mapping !== undefined) {
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.keys(mapping).length) {
          context.addIssue({ code: 'custom', path: ['ALIPAY_SERVICE_IDS'], message: 'ALIPAY_SERVICE_IDS 必须是非空 JSON 对象' });
        } else {
          for (const [internal, official] of Object.entries(mapping)) {
            if (internal.length < 1 || internal.length > 80 || typeof official !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(official)) {
              context.addIssue({ code: 'custom', path: ['ALIPAY_SERVICE_IDS'], message: 'ALIPAY_SERVICE_IDS 的键或官方 service_id 不合法' });
            }
          }
        }
      }
    }
  }
});

export function loadConfig() { return configSchema.parse(process.env); }
export type Config = z.infer<typeof configSchema>;

export function publicMcpURL(config: Config) {
  return config.PUBLIC_MCP_URL ?? `${config.PUBLIC_BASE_URL}/mcp`;
}
