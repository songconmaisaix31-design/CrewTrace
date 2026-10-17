import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import type { ChainPort } from '../../../packages/contracts/src/index.ts';
import type { Config } from './config.js';
import type { Validator } from './application.js';

function moduleSpecifier(value: string) { return value.startsWith('.') || isAbsolute(value) ? pathToFileURL(resolve(value)).href : value; }

export async function dependencies(config: Config): Promise<{ chain: ChainPort | null; validator: Validator | null }> {
  let chain: ChainPort | null = null;
  let validator: Validator | null = null;
  if (config.CHAIN_ADAPTER_MODULE) {
    const module = await import(moduleSpecifier(config.CHAIN_ADAPTER_MODULE));
    if (typeof module.createChainPort !== 'function') throw new Error('链模块必须导出 createChainPort');
    chain = await module.createChainPort();
    for (const method of ['registerAgent','assignTask','submitArtifact','recordOutcome','getRoleReputation','getTask','getReceipts'] as const) {
      if (typeof chain?.[method] !== 'function') throw new Error(`链模块缺少 ${method}`);
    }
    if (!config.CHAIN_CONTRACT || !config.CHAIN_COORDINATOR) throw new Error('真实链模块需要 CHAIN_CONTRACT 和 CHAIN_COORDINATOR');
  }
  if (config.VALIDATOR_MODULE) {
    const module = config.VALIDATOR_MODULE==='workers'
      ? await import('../../../workers/src/product.ts')
      : await import(moduleSpecifier(config.VALIDATOR_MODULE));
    if (typeof module.validateArtifact !== 'function') throw new Error('验收模块必须导出 validateArtifact');
    validator = module.validateArtifact;
  }
  return { chain,validator };
}
