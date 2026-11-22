import { z } from 'zod';

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
    if (!value.PAYMENT_SIMULATION_SECRET) {
      context.addIssue({ code: 'custom', path: ['PAYMENT_SIMULATION_SECRET'], message: 'simulated 支付模式需要至少 32 位的本地签名密钥' });
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
