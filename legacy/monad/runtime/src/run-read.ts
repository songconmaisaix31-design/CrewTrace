import { RunSchema, TaskSchema } from '../../../packages/contracts/src/index.ts';
import { deriveRunStatus } from './domain/workflow.ts';

const taskRecords = `ARRAY(
  SELECT jsonb_build_object('document',t.document,'runtime_status',t.runtime_status,'runtime_reason',t.runtime_reason)
  FROM tasks t WHERE t.run_id=r.id ORDER BY t.id
) AS tasks`;

export const RUN_QUERY = `SELECT r.document,r.runtime_status,${taskRecords} FROM runs r WHERE r.id=$1`;

// 所有部分共享同一条语句的 PostgreSQL 快照，原始 bytea 由官方驱动解析。
export const RUN_DETAILS_QUERY = `SELECT r.document,r.runtime_status,${taskRecords},
  ARRAY(SELECT document FROM decisions WHERE run_id=r.id ORDER BY id) AS decisions,
  ARRAY(SELECT raw_bytes FROM decisions WHERE run_id=r.id ORDER BY id) AS decision_bytes,
  ARRAY(SELECT document FROM handoffs WHERE run_id=r.id ORDER BY id) AS handoffs,
  ARRAY(SELECT document FROM artifacts WHERE run_id=r.id ORDER BY created_at) AS artifacts,
  ARRAY(SELECT a.document FROM assessments a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=r.id ORDER BY a.task_id,a.attempt) AS assessments,
  ARRAY(SELECT jsonb_build_object('taskId',c.task_id,'attempt',c.attempt,'operation',c.operation,'receipt',c.receipt)
    FROM chain_receipts c JOIN tasks t ON t.id=c.task_id WHERE t.run_id=r.id ORDER BY c.task_id,c.operation) AS task_receipts
  FROM runs r WHERE r.id=$1`;

interface RunRecord {
  document: object;
  runtime_status: string;
  tasks: { document: unknown; runtime_status: string; runtime_reason: string | null }[];
}

export function parseRunRecord(record: RunRecord) {
  const tasks = record.tasks.map(row => TaskSchema.parse(row.document));
  const run = RunSchema.parse({ ...record.document,tasks,status: deriveRunStatus(tasks) });
  return { ...run,runtimeStatus: record.runtime_status,taskRuntime: record.tasks.map((row,index) => ({ taskId: tasks[index]!.taskId,status: row.runtime_status,reason: row.runtime_reason })) };
}
