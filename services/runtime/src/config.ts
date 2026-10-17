import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.url(),
  ADMIN_TOKEN: z.string().min(32),
  PUBLIC_BASE_URL: z.url(),
  PUBLIC_MCP_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  CHAIN_ADAPTER_MODULE: z.string().min(1).optional(),
  CHAIN_ID: z.coerce.number().int().positive().default(10143),
  CHAIN_RPC_URL: z.url().optional(),
  CHAIN_DEPLOYMENT_BLOCK: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
  CHAIN_CONTRACT: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  CHAIN_COORDINATOR: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  CHAIN_VALIDATOR: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  CHAIN_COORDINATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  CHAIN_VALIDATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  VALIDATOR_MODULE: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z.string().default(''),
});

export function loadConfig() { return configSchema.parse(process.env); }
export type Config = z.infer<typeof configSchema>;

export function publicMcpURL(config: Config) {
  return config.PUBLIC_MCP_URL ?? `${config.PUBLIC_BASE_URL}/mcp`;
}
