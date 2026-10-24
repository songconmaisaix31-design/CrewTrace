import type { PoolClient } from '@neondatabase/serverless';
import { ChainBroadcastError } from '../../../packages/runtime-chain/src/index.ts';
import { ChainReceiptSchema,ChainEventSchema,type ChainReceipt,type Task } from '../../../packages/contracts/src/index.ts';
import type { Application } from './application.js';
import { AppError,requireValue } from './errors.js';

export type ChainOperation = 'ASSIGN'|'SUBMIT'|'OUTCOME';

export class ChainState {
  constructor(readonly app: Application) {}
  async exclusive<T>(operation: ()=>Promise<T>): Promise<T> {
    return this.app.db.transaction(async client=>{
      const result = await client.query('SELECT pg_try_advisory_xact_lock(83521003) AS acquired');
      if (!result.rows[0].acquired) throw new AppError(409,'CHAIN_PENDING','另一项真实链操作正在进行');
      return operation();
    });
  }
  async tracked(task: Task,operation: ChainOperation) {
    const row = (await this.app.db.pool.query('SELECT receipt FROM chain_receipts WHERE task_id=$1 AND attempt=$2 AND operation=$3',[task.taskId,task.attempt,operation])).rows[0];
    return row ? ChainReceiptSchema.parse(row.receipt) : null;
  }
  async read(receipt: ChainReceipt) {
    try {
      return ChainReceiptSchema.parse(requireValue((await this.app.requireChain().getReceipts({ txHash: receipt.txHash })).find(item=>item.txHash===receipt.txHash),'CHAIN_DATA_MISSING'));
    } catch (error) {
      if (error instanceof Error && error.name==='TransactionNotFoundError') throw new AppError(409,'CHAIN_PENDING','已保存的原交易尚未被 RPC 找到，继续等待同一 txHash');
      throw error;
    }
  }
  async send(task: Task,operation: ChainOperation,send: ()=>Promise<ChainReceipt>) {
    try { return ChainReceiptSchema.parse(await send()); }
    catch (error) {
      if (!(error instanceof ChainBroadcastError)) throw error;
      const receipt = ChainReceiptSchema.parse(error.receipt);
      await this.app.db.transaction(async client=>{
        const current = (await client.query('SELECT receipt FROM chain_receipts WHERE task_id=$1 AND attempt=$2 AND operation=$3 FOR UPDATE',[task.taskId,task.attempt,operation])).rows[0];
        if (current && current.receipt.txHash!==receipt.txHash) throw new AppError(409,'INVALID_STATE','同一业务操作已有不同交易，禁止替换原交易');
        await client.query('INSERT INTO chain_receipts(task_id,attempt,operation,receipt,serialized_transaction,broadcast_unknown) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(task_id,attempt,operation) DO UPDATE SET receipt=excluded.receipt,serialized_transaction=excluded.serialized_transaction,broadcast_unknown=true',[task.taskId,task.attempt,operation,receipt,error.serializedTransaction]);
      });
      return receipt;
    }
  }
  async save(client: PoolClient,task: Task,operation: ChainOperation,input: ChainReceipt) {
    const receipt = ChainReceiptSchema.parse(input);
    const current = (await client.query('SELECT receipt FROM chain_receipts WHERE task_id=$1 AND attempt=$2 AND operation=$3',[task.taskId,task.attempt,operation])).rows[0];
    if (current && current.receipt.txHash!==receipt.txHash) throw new AppError(409,'INVALID_STATE','同一业务操作不能替换原交易');
    await client.query('INSERT INTO chain_receipts(task_id,attempt,operation,receipt) VALUES($1,$2,$3,$4) ON CONFLICT(task_id,attempt,operation) DO UPDATE SET receipt=excluded.receipt,broadcast_unknown=CASE WHEN excluded.receipt->>\'status\'=\'CONFIRMED\' THEN false ELSE chain_receipts.broadcast_unknown END',[task.taskId,task.attempt,operation,receipt]);
    if (!current || JSON.stringify(ChainReceiptSchema.parse(current.receipt))!==JSON.stringify(receipt)) await this.app.store.event(client,`CHAIN_${operation}_${receipt.status}`,task.runId,task.taskId,task.attempt,{ receipt });
    if (receipt.status==='CONFIRMED') await this.ingest(client,receipt,task);
  }
  async ingest(client: PoolClient,receipt: ChainReceipt,task?: Task) {
    if (receipt.status!=='CONFIRMED') throw new AppError(409,'CHAIN_PENDING','原生事件只在 finalized 确认后入库');
    for (const source of receipt.events ?? []) {
      const event = ChainEventSchema.parse(source);
      if (event.eventId!==`${receipt.chainId}:${receipt.txHash}:${event.logIndex}` || event.txHash!==receipt.txHash || event.blockNumber!==receipt.blockNumber) throw new AppError(409,'ARTIFACT_MISMATCH','真实链事件元数据不匹配');
      await client.query('INSERT INTO chain_events(event_id,chain_id,tx_hash,log_index,block_number,decoded) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO NOTHING',[event.eventId,receipt.chainId,event.txHash,event.logIndex,event.blockNumber,event]);
      const equal = (await client.query('SELECT decoded=$2::jsonb AS equal FROM chain_events WHERE event_id=$1',[event.eventId,event])).rows[0]?.equal;
      if (!equal) throw new AppError(409,'ARTIFACT_MISMATCH','同一原生 eventId 的记录发生冲突');
      if (task && 'taskId' in event.args && event.args.taskId===task.taskId && event.args.attempt===task.attempt) {
        const document = { eventId: event.eventId,runId: task.runId,taskId: task.taskId,attempt: task.attempt,type: event.eventName,createdAt: new Date().toISOString(),receipt,data: event.args };
        await client.query('INSERT INTO events(event_id,run_id,task_id,document) VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING',[event.eventId,task.runId,task.taskId,document]);
      }
    }
  }
}
