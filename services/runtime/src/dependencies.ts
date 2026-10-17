import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import type { ChainPort } from '../../../packages/contracts/src/index.ts';
import type { Config } from './config.js';
import type { Validator } from './application.js';
import { privateKeyToAccount } from 'viem/accounts';
import type { Database } from './db.js';
import { persistPrepared } from './prepared.js';
import type { PreparedChainTransaction } from '../../../packages/runtime-chain/src/index.ts';

function moduleSpecifier(value: string) { return value.startsWith('.') || isAbsolute(value) ? pathToFileURL(resolve(value)).href : value; }

export async function dependencies(config: Config,db: Database): Promise<{ chain: ChainPort | null; validator: Validator | null }> {
  let chain: ChainPort | null = null;
  let validator: Validator | null = null;
  if (config.CHAIN_ADAPTER_MODULE) {
    const module = config.CHAIN_ADAPTER_MODULE==='runtime-chain'
      ? await import('../../../packages/runtime-chain/src/index.ts')
      : await import(moduleSpecifier(config.CHAIN_ADAPTER_MODULE));
    if (typeof module.createChainPort !== 'function') throw new Error('链模块必须导出 createChainPort');
    if (!config.CHAIN_RPC_URL || !config.CHAIN_DEPLOYMENT_BLOCK || !config.CHAIN_CONTRACT) throw new Error('链模块需要真实 RPC、部署区块和合约配置');
    const coordinatorAccount = config.CHAIN_COORDINATOR_PRIVATE_KEY ? privateKeyToAccount(config.CHAIN_COORDINATOR_PRIVATE_KEY as `0x${string}`) : undefined;
    const validatorAccount = config.CHAIN_VALIDATOR_PRIVATE_KEY ? privateKeyToAccount(config.CHAIN_VALIDATOR_PRIVATE_KEY as `0x${string}`) : undefined;
    if (coordinatorAccount && coordinatorAccount.address.toLowerCase()!==config.CHAIN_COORDINATOR?.toLowerCase()) throw new Error('协调者私钥与配置地址不匹配');
    if (validatorAccount && validatorAccount.address.toLowerCase()!==config.CHAIN_VALIDATOR?.toLowerCase()) throw new Error('验收方私钥与配置地址不匹配');
    chain = await module.createChainPort({ rpcUrl: config.CHAIN_RPC_URL,chainId: config.CHAIN_ID,contractAddress: config.CHAIN_CONTRACT,deploymentBlock: config.CHAIN_DEPLOYMENT_BLOCK,coordinatorAccount,validatorAccount,timeoutMs: 10_000,onPreparedTransaction: (transaction: PreparedChainTransaction)=>persistPrepared(db,transaction) });
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
