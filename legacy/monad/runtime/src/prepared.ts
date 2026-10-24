import { keccak256 } from 'viem';
import type { PreparedChainTransaction } from '../../../packages/runtime-chain/src/index.ts';
import { ChainReceiptSchema,TaskSchema } from '../../../packages/contracts/src/index.ts';
import type { Database } from './db.js';
import { AppError,requireValue } from './errors.js';

export async function persistPrepared(db: Database,transaction: PreparedChainTransaction) {
  if (transaction.operation==='REGISTER') throw new AppError(403,'UNAUTHORIZED','节点链上登记由该节点独立签名');
  const receipt = ChainReceiptSchema.parse(transaction.receipt);
  if (keccak256(transaction.serializedTransaction)!==receipt.txHash) throw new AppError(409,'ARTIFACT_MISMATCH','待广播签名交易与原始哈希不匹配');
  await db.transaction(async client=>{
    const task = TaskSchema.parse(requireValue((await client.query('SELECT document FROM tasks WHERE id=$1',[transaction.input.taskId])).rows[0]).document);
    if (task.attempt!==transaction.input.attempt) throw new AppError(409,'STALE_ATTEMPT','待广播业务 attempt 已失效');
    const run = requireValue((await client.query('SELECT runtime_status FROM runs WHERE id=$1',[task.runId])).rows[0]);
    if (run.runtime_status!=='ACTIVE') throw new AppError(409,'INVALID_STATE','运行当前禁止广播新交易');
    const current = (await client.query('SELECT receipt FROM chain_receipts WHERE task_id=$1 AND attempt=$2 AND operation=$3 FOR UPDATE',[task.taskId,task.attempt,transaction.operation])).rows[0];
    if (current && current.receipt.txHash!==receipt.txHash) throw new AppError(409,'INVALID_STATE','已持久化的原交易不可替换');
    await client.query('INSERT INTO chain_receipts(task_id,attempt,operation,receipt,serialized_transaction,broadcast_unknown) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(task_id,attempt,operation) DO UPDATE SET serialized_transaction=excluded.serialized_transaction',[task.taskId,task.attempt,transaction.operation,receipt,transaction.serializedTransaction]);
  });
}
