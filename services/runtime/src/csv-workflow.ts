import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { CSV_ROLE, verifyCsvDelivery } from '../../../workers/src/csv-delivery.ts';
import { CsvError,executeCsvCleanup } from '../../../workers/src/csv-cleanup.ts';
import { AppError } from './errors.js';

export const CSV_WORKFLOW_VERSION = 'csv-workflow-v1';
export const CSV_STEPS = [
  {role:'csv-source-inspection',dependsOn:null},
  {role:CSV_ROLE,dependsOn:'csv-source-inspection'},
  {role:'csv-evidence-report',dependsOn:CSV_ROLE},
] as const;
export const csvWorkflowInput = z.strictObject({
  input: z.string().min(1).max(80000),
  expectedVersion: z.number().int().positive(),
  leaseSeconds: z.number().int().min(5).max(3600).default(300),
});

export async function workflow(client: Pick<PoolClient,'query'>, taskId: string) {
  const row = (await client.query('SELECT input_csv, lease_seconds, version FROM experiment_csv_workflows WHERE task_id=$1',[taskId])).rows[0];
  return row ? { input: z.string().parse(row.input_csv), leaseSeconds: z.number().parse(row.lease_seconds), version: z.literal(CSV_WORKFLOW_VERSION).parse(row.version) } : null;
}

export function inspectSource(input: string) {
  return JSON.stringify({inputHash:createHash('sha256').update(input,'utf8').digest('hex'),bytes:Buffer.byteLength(input,'utf8')});
}
export function evidenceReport(content: string) {
  const {ruleVersion,contentHash,rowCount}=verifyCsvDelivery(content);
  return JSON.stringify({ruleVersion,contentHash,rowCount});
}
export function normalizedDelivery(input: string) {
  let normalized: string;
  try {
    normalized=executeCsvCleanup(input,'deduplicate');
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    throw new AppError(422,'INVALID_INPUT','不能解析 CSV 输入');
  }
  if(verifyCsvDelivery(normalized).status!=='PASS') throw new AppError(422,'INVALID_INPUT','CSV 输入须能按固定规则规范化');
  return normalized;
}

export async function acceptedStep(client: Pick<PoolClient,'query'>, taskId: string, role: string) {
  return (await client.query(`
    SELECT h.document->>'content' AS content
    FROM collaboration_claims c JOIN collaboration_handoffs h ON h.claim_id=c.id
    JOIN experiment_csv_attempts a ON a.claim_id=c.id
    WHERE c.task_id=$1 AND c.scope=$2 AND c.document->>'status'='COMPLETED'
    AND h.document->>'status'='ACCEPTED'
    LIMIT 1`,[taskId,role])).rows[0]?.content as string|undefined;
}

export function sameDelivery(content: string, expected: string, role: string) {
  const matches = role===CSV_ROLE ? content===expected : equivalentJson(content,expected);
  if (!matches) throw new AppError(422,'INVALID_INPUT','交付与当前步骤的固定输入或约定输出不一致');
}

function equivalentJson(content: string, expected: string) {
  const target: Record<string,unknown>=JSON.parse(expected);
  try {
    const sample: unknown=JSON.parse(content);
    if (!sample || typeof sample!=='object' || Array.isArray(sample)) return false;
    const actual=sample as Record<string,unknown>;
    return Object.keys(actual).length===Object.keys(target).length &&
      Object.entries(target).every(([key,value])=>Object.hasOwn(actual,key)&&actual[key]===value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return false;
  }
}
