import type { Address } from "viem";
import {
  CollaborationKind, CollaborationLedgerClient, ChainError,
  deriveCollaborationRecordId, hashCollaborationDocument,
} from "../../../packages/chain/src/index.ts";
import {
  CollaborationCommitmentKindSchema, CollaborationCommitmentSchema,
  CollaborationCommitmentDetailSchema, CollaborationCommitmentsResponseSchema,
  type CollaborationCommitment, type CollaborationCommitmentDetail, type CollaborationCommitmentKind,
} from "../../../packages/contracts/src/index.ts";
import type { Config } from "./config.js";
import type { Database } from "./db.js";

export interface CommitmentInput {
  kind: CollaborationCommitmentKind;
  recordId: string;
  taskId: string | null;
  version: number;
  document: Record<string, unknown>;
}

export class CollaborationChain {
  constructor(
    private readonly client: CollaborationLedgerClient | null,
    private readonly db: Database,
    private readonly config: Config,
  ) {}

  get configured(): boolean { return this.client !== null; }

  get info() {
    return {
      configured: this.configured,
      chainId: this.client ? this.config.COLLABORATION_CHAIN_ID : null,
      contract: this.config.COLLABORATION_CHAIN_CONTRACT?.toLowerCase() ?? null,
      explorer: this.client ? this.config.COLLABORATION_CHAIN_EXPLORER : null,
    };
  }

  private uri(recordKey: string): string {
    return `${this.config.PUBLIC_BASE_URL}/api/collaboration/commitments/${encodeURIComponent(recordKey)}`;
  }

  async commit(input: CommitmentInput): Promise<CollaborationCommitment> {
    const kind = CollaborationCommitmentKindSchema.parse(input.kind);
    const recordKey = `${kind}:${input.recordId}:${input.version}`;
    const contentHash = hashCollaborationDocument(input.document);
    const uri = this.uri(recordKey);
    await this.db.pool.query(
      `INSERT INTO collaboration_commitments
       (record_key,kind,record_id,task_id,version,content_hash,document,uri,status,chain_id,contract)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10)
       ON CONFLICT(record_key) DO NOTHING`,
      [recordKey, kind, input.recordId, input.taskId, input.version, contentHash, input.document, uri,
        this.client ? this.config.COLLABORATION_CHAIN_ID : null,
        this.config.COLLABORATION_CHAIN_CONTRACT?.toLowerCase() ?? null],
    );
    return this.anchor(recordKey);
  }

  async anchor(recordKey: string): Promise<CollaborationCommitment> {
    const row = (await this.db.pool.query('SELECT * FROM collaboration_commitments WHERE record_key=$1', [recordKey])).rows[0];
    if (!row) throw new ChainError("NOT_FOUND", "链上承诺记录不存在");
    if (row.status === 'CONFIRMED' || !this.client) return this.parse(row);
    const kind = row.kind as CollaborationCommitmentKind;
    const recordId = deriveCollaborationRecordId(kind, row.record_id);
    try {
      let receipt = row.tx_hash ? await this.client.status(row.tx_hash as Address) : null;
      if (!receipt || receipt.status === 'PENDING') {
        if (!receipt) {
          const pending = await this.client.record({
            kind: CollaborationKind[kind], recordId, version: Number(row.version),
            contentHash: row.content_hash, uri: row.uri,
          });
          await this.db.pool.query('UPDATE collaboration_commitments SET tx_hash=$2,attempts=attempts+1,error=NULL WHERE record_key=$1', [recordKey, pending.txHash]);
          receipt = await this.client.waitConfirmed(pending.txHash, this.config.COLLABORATION_CHAIN_TIMEOUT_MS);
        } else {
          receipt = await this.client.waitConfirmed(row.tx_hash, this.config.COLLABORATION_CHAIN_TIMEOUT_MS);
        }
      }
      if (receipt.status !== 'CONFIRMED') throw new ChainError("CHAIN_FAILED", `交易状态为 ${receipt.status}`);
      const updated = (await this.db.pool.query(
        `UPDATE collaboration_commitments SET status='CONFIRMED',chain_id=$2,contract=$3,tx_hash=$4,block_number=$5,
         confirmed_at=now(),error=NULL WHERE record_key=$1 RETURNING *`,
        [recordKey, receipt.chainId, receipt.contract, receipt.txHash, receipt.blockNumber?.toString() ?? null],
      )).rows[0];
      return this.parse(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : '链上写入失败';
      const failed = (await this.db.pool.query(
        `UPDATE collaboration_commitments SET status='FAILED',error=$2 WHERE record_key=$1 RETURNING *`,
        [recordKey, message],
      )).rows[0];
      return this.parse(failed);
    }
  }

  async list(taskId?: string | null): Promise<ReturnType<typeof CollaborationCommitmentsResponseSchema.parse>> {
    const rows = (await this.db.pool.query(
      `SELECT * FROM collaboration_commitments WHERE ($1::text IS NULL OR task_id=$1) ORDER BY created_at,record_key LIMIT 200`,
      [taskId ?? null],
    )).rows;
    return CollaborationCommitmentsResponseSchema.parse({
      commitments: rows.map((row) => this.parse(row)), chain: this.info,
    });
  }

  async detail(recordKey: string): Promise<ReturnType<typeof CollaborationCommitmentDetailSchema.parse>> {
    const row = (await this.db.pool.query('SELECT * FROM collaboration_commitments WHERE record_key=$1', [recordKey])).rows[0];
    if (!row) throw new ChainError("NOT_FOUND", "链上承诺记录不存在");
    return CollaborationCommitmentDetailSchema.parse({ ...this.parse(row), document: row.document });
  }

  async reconcile(limit = 10) {
    const rows = (await this.db.pool.query(
      `SELECT record_key FROM collaboration_commitments WHERE status<>'CONFIRMED' ORDER BY created_at LIMIT $1`,
      [Math.max(1, Math.min(50, limit))],
    )).rows;
    const results: CollaborationCommitment[] = [];
    for (const row of rows) results.push(await this.anchor(row.record_key));
    return { attempted: results.length, confirmed: results.filter((item) => item.status === 'CONFIRMED').length, commitments: results };
  }

  private parse(row: Record<string, unknown>): CollaborationCommitment {
    return CollaborationCommitmentSchema.parse({
      recordKey: row.record_key,
      kind: row.kind,
      recordId: row.record_id,
      taskId: row.task_id ?? null,
      version: Number(row.version),
      contentHash: row.content_hash,
      uri: row.uri,
      status: row.status,
      chainId: row.chain_id === null ? null : Number(row.chain_id),
      contract: row.contract ?? null,
      txHash: row.tx_hash ?? null,
      blockNumber: row.block_number === null ? null : String(row.block_number),
      createdAt: new Date(row.created_at as string).toISOString(),
      confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at as string).toISOString(),
    });
  }
}
