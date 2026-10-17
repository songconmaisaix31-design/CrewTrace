import {
  AddressSchema, ApplicationError, BlockNumberSchema, ChainReceiptSchema, OutcomeRecordSchema,
  QualityRecordSchema, RoleReputationSchema, RoleSchema,
  type Address, type ChainPort, type ChainReceipt, type OutcomeRecord, type QualityRecord,
  type Role, type RoleReputation,
} from "../../../../packages/contracts/src/index.ts";

export function requireChainPort(port: ChainPort | null | undefined): ChainPort {
  if (!port) throw new ApplicationError("CHAIN_NOT_CONFIGURED", "尚未配置 A 提供的真实链上适配器");
  return port;
}

export interface ChainExpectation {
  chainId: number;
  contract: Address;
}

export function assertConfirmedReceipt(receipt: ChainReceipt | null | undefined, expected: ChainExpectation): ChainReceipt {
  if (!receipt) throw new ApplicationError("CHAIN_DATA_MISSING", "缺少真实链上回执");
  const { chainId, contract, txHash, blockNumber, status, signer } = receipt;
  const checked = ChainReceiptSchema.parse({ chainId, contract, txHash, blockNumber, status, signer });
  if (checked.chainId !== expected.chainId || checked.contract !== AddressSchema.parse(expected.contract)) {
    throw new ApplicationError("WRONG_CHAIN", "回执网络或应用合约不匹配");
  }
  if (checked.status === "PENDING") throw new ApplicationError("CHAIN_PENDING", "交易等待链上确认", { txHash: checked.txHash });
  if (checked.status === "FAILED") throw new ApplicationError("INVALID_STATE", "链上交易已失败", { txHash: checked.txHash });
  return checked;
}

export interface QualityQuery extends ChainExpectation {
  agentId: Address;
  role: Role;
  blockNumber: string;
  validator: Address;
}

export function collectConfirmedQuality(records: readonly OutcomeRecord[] | null | undefined, query: QualityQuery): QualityRecord[] {
  if (!records) throw new ApplicationError("CHAIN_DATA_MISSING", "缺少指定快照区块的履约记录，不能假定为零历史");
  const block = BigInt(BlockNumberSchema.parse(query.blockNumber));
  const validator = AddressSchema.parse(query.validator);
  const contract = AddressSchema.parse(query.contract);
  const agentId = AddressSchema.parse(query.agentId);
  const role = RoleSchema.parse(query.role);
  const seen = new Set<string>();
  const result: QualityRecord[] = [];
  for (const value of records) {
    const record = OutcomeRecordSchema.parse(value);
    if (record.verdict === "UNRESOLVED" || record.receipt === null || record.receipt.status !== "CONFIRMED") continue;
    const receipt = assertConfirmedReceipt(record.receipt, { chainId: query.chainId, contract });
    if (receipt.blockNumber === null) throw new ApplicationError("CHAIN_DATA_MISSING", "已确认履约记录缺少区块号");
    if (BigInt(receipt.blockNumber) > block) continue;
    if (record.validator !== validator || receipt.signer !== validator) {
      throw new ApplicationError("UNAUTHORIZED", "履约记录必须由指定验收方确认");
    }
    const key = `${record.taskId}:${record.attempt}`;
    if (seen.has(key)) throw new ApplicationError("DUPLICATE_OUTCOME", "同一 taskId 与 attempt 出现重复结论", { key });
    seen.add(key);
    if (record.assignee === agentId && record.role === role) result.push(QualityRecordSchema.parse(record));
  }
  return result;
}

export function aggregateRoleReputation(records: readonly OutcomeRecord[] | null | undefined, query: QualityQuery): RoleReputation {
  const confirmed = collectConfirmedQuality(records, query);
  return RoleReputationSchema.parse({
    agentId: query.agentId, role: query.role, blockNumber: query.blockNumber, confirmed: true,
    passCount: confirmed.filter(record => record.verdict === "PASS").length,
    failCount: confirmed.filter(record => record.verdict === "FAIL").length,
  });
}
