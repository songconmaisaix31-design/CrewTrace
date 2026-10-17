import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { verifyMessage } from 'viem';
import type { PoolClient } from '@neondatabase/serverless';
import {
  AgentProfileSchema, ArtifactSchema, AssignmentDecisionSchema, CreateRunWithInputRequestSchema, HeartbeatRequestSchema, TaskSchema, RunSchema,RunDetailSchema,WorkerJobsResponseSchema,
  hashUtf8, nodeBindingMessage, type AgentProfile, type Artifact, type AssessmentCheck, type ChainPort, type Task,
} from '../../../packages/contracts/src/index.ts';
import { createFixedRun, deriveRunStatus, assertExecutionBudget } from './domain/workflow.ts';
import { CRITERIA_BYTES, CRITERIA_HASH } from '../../../workers/src/criteria.ts';
import { FIXED_WORKFLOW,TEMPLATE_VERSION } from './domain/workflow.ts';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { Store } from './store.js';
import { admin, node, sameAgent, tokenHash, type Principal } from './auth.js';
import { AppError, requireValue } from './errors.js';
import { encodeUtf8 } from './content.js';

export interface ValidationInput {
  task: Task; artifact: Artifact; content: string; inputContent: string;
  parents: { task: Task; artifact: Artifact; content: string }[];
}
export type Validator = (input: ValidationInput) => AssessmentCheck[] | Promise<AssessmentCheck[]>;

export class Application {
  readonly store: Store;
  constructor(readonly db: Database, readonly config: Config, readonly chain: ChainPort | null = null, readonly validator: Validator | null = null) { this.store = new Store(db); }
  async health() {
    await this.db.pool.query('SELECT 1');
    const writable = Boolean(this.chain && this.config.CHAIN_COORDINATOR_PRIVATE_KEY && this.config.CHAIN_VALIDATOR_PRIVATE_KEY);
    return {
      status: writable && this.validator ? 'ok' : 'degraded', database: 'connected',
      chain: { configured: Boolean(this.chain),writable, code: writable ? null : 'CHAIN_NOT_CONFIGURED' },
      validator: { configured: Boolean(this.validator), code: this.validator ? null : 'VALIDATOR_NOT_CONFIGURED' },
    };
  }
  template() {
    return { templateVersion: TEMPLATE_VERSION,workflow: FIXED_WORKFLOW,criteriaHash: CRITERIA_HASH,criteriaURI: `${this.config.PUBLIC_BASE_URL}/api/criteria` };
  }
  criteria() { return CRITERIA_BYTES; }
  async progress(runId?: string) {
    const { FixedWorkflow } = await import('./workflow.ts');
    return new FixedWorkflow(this).advance(runId);
  }
  async advanceWork(principal: Principal,input: unknown) {
    node(principal);
    z.strictObject({}).parse(input);
    return this.progress();
  }
  requireChain() {
    if (!this.chain) throw new AppError(503,'CHAIN_NOT_CONFIGURED','A 的真实链适配器尚未配置');
    return this.chain;
  }
  async agents(client: Pick<PoolClient,'query'> = this.db.pool,excludingReservedTaskId: string | null = null): Promise<AgentProfile[]> {
    const { rows } = await client.query(`
      WITH task_load AS (
        SELECT CASE WHEN t.document->>'status'='OPEN' THEN d.document->>'selectedAgentId'
                    ELSE t.document->>'assignee' END AS agent_id,
               t.document->>'status'='OPEN' AS reserved
        FROM tasks t JOIN runs r ON r.id=t.run_id
        LEFT JOIN LATERAL (
          SELECT document FROM decisions
          WHERE task_id=t.id AND document->>'attempt'=t.document->>'attempt'
          ORDER BY document->>'evaluatedAt' DESC,id DESC LIMIT 1
        ) d ON t.document->>'status'='OPEN'
        WHERE r.runtime_status<>'CANCELLED' AND t.runtime_status<>'CANCELLED'
          AND t.document->>'status' IN ('OPEN','ASSIGNED','RUNNING','SUBMITTED')
          AND ($1::text IS NULL OR t.id<>$1 OR t.document->>'status'<>'OPEN')
      ), agent_load AS (
        SELECT agent_id,count(*) FILTER (WHERE reserved) AS reserved_tasks,
               count(*) FILTER (WHERE NOT reserved) AS assigned_tasks
        FROM task_load GROUP BY agent_id
      )
      SELECT a.profile,a.worker_reported_active_tasks,
             coalesce(l.reserved_tasks,0) AS reserved_tasks,coalesce(l.assigned_tasks,0) AS assigned_tasks
      FROM agents a LEFT JOIN agent_load l ON l.agent_id=a.id ORDER BY a.id
    `,[excludingReservedTaskId]);
    return rows.map(row => AgentProfileSchema.parse({
      ...row.profile,
      activeTasks: Number(row.reserved_tasks)+Math.max(Number(row.worker_reported_active_tasks),Number(row.assigned_tasks)),
    }));
  }
  async task(taskId: string, client: Pick<PoolClient,'query'> = this.db.pool): Promise<Task> {
    return TaskSchema.parse(requireValue((await client.query('SELECT document FROM tasks WHERE id=$1',[taskId])).rows[0]).document);
  }
  async run(runId: string, client: Pick<PoolClient,'query'> = this.db.pool) {
    const record = requireValue((await client.query('SELECT document,runtime_status FROM runs WHERE id=$1',[runId])).rows[0]);
    const tasks = (await client.query('SELECT document,runtime_status,runtime_reason FROM tasks WHERE run_id=$1 ORDER BY id',[runId])).rows;
    const parsed = tasks.map(row => TaskSchema.parse(row.document));
    const run = RunSchema.parse({ ...record.document,tasks: parsed,status: deriveRunStatus(parsed) });
    return { ...run,runtimeStatus: record.runtime_status,taskRuntime: tasks.map(row => ({ taskId: row.document.taskId,status: row.runtime_status,reason: row.runtime_reason })) };
  }
  async runDetails(runId: string) {
    const run = await this.run(runId);
    const decisions = await this.db.pool.query('SELECT document,raw_bytes,receipt FROM decisions WHERE run_id=$1 ORDER BY id',[runId]);
    const handoffs = await this.db.pool.query('SELECT document FROM handoffs WHERE run_id=$1 ORDER BY id',[runId]);
    const artifacts = await this.db.pool.query('SELECT document FROM artifacts WHERE run_id=$1 ORDER BY created_at',[runId]);
    const assessments = await this.db.pool.query('SELECT a.document FROM assessments a JOIN tasks t ON t.id=a.task_id WHERE t.run_id=$1 ORDER BY task_id,attempt',[runId]);
    const receipts = await this.db.pool.query('SELECT c.task_id,c.attempt,c.operation,c.receipt FROM chain_receipts c JOIN tasks t ON t.id=c.task_id WHERE t.run_id=$1 ORDER BY c.task_id,c.operation',[runId]);
    const snapshots = decisions.rows.map(row=>{
      if (!row.raw_bytes || hashUtf8(row.raw_bytes)!==row.document.decisionHash) throw new AppError(409,'ARTIFACT_MISMATCH','持久化决策摘要不匹配');
      return AssignmentDecisionSchema.parse({ ...JSON.parse(row.raw_bytes.toString('utf8')),decisionHash: row.document.decisionHash });
    });
    return RunDetailSchema.parse({ ...run,inputURI: `${this.config.PUBLIC_BASE_URL}/api/runs/${encodeURIComponent(runId)}/input`,decisions: snapshots,handoffs: handoffs.rows.map(r=>r.document),artifacts: artifacts.rows.map(r=>r.document),assessments: assessments.rows.map(r=>r.document),taskReceipts: receipts.rows.map(row=>({ taskId: row.task_id,attempt: row.attempt,operation: row.operation,receipt: row.receipt })) });
  }
  async input(runId: string,client: Pick<PoolClient,'query'> = this.db.pool) {
    const record = requireValue((await client.query('SELECT document,input_bytes FROM runs WHERE id=$1',[runId])).rows[0]);
    if (!record.input_bytes) throw new AppError(409,'ARTIFACT_MISMATCH','原始输入不存在');
    const bytes: Buffer = record.input_bytes;
    if (hashUtf8(bytes) !== record.document.inputHash) throw new AppError(409,'ARTIFACT_MISMATCH','持久化输入的摘要不匹配');
    return bytes;
  }
  async artifact(artifactId: string, client: Pick<PoolClient,'query'> = this.db.pool) {
    const record = requireValue((await client.query('SELECT document,raw_bytes FROM artifacts WHERE id=$1',[artifactId])).rows[0]);
    const artifact = ArtifactSchema.parse(record.document);
    const bytes: Buffer = record.raw_bytes;
    if (hashUtf8(bytes) !== artifact.contentHash) throw new AppError(409,'ARTIFACT_MISMATCH','持久化产物的摘要不匹配');
    return { artifact,bytes };
  }
  async enroll(principal: Principal, profileInput: unknown, signature: string) {
    admin(principal);
    const profile = AgentProfileSchema.parse(profileInput);
    const message = nodeBindingMessage(profile);
    if (!await verifyMessage({ address: profile.agentId,message,signature: signature as `0x${string}` })) throw new AppError(403,'UNAUTHORIZED','节点绑定签名无效');
    const token = randomBytes(32).toString('base64url');
    await this.store.write(async client => {
      if ((await client.query('SELECT id FROM agents WHERE id=$1',[profile.agentId])).rowCount) throw new AppError(409,'INVALID_STATE','节点已登记，请使用凭证轮换端点');
      await client.query('INSERT INTO agents(id,profile) VALUES($1,$2)',[profile.agentId,{ ...profile,lastSeenAt: null,activeTasks: 0 }]);
      await client.query('INSERT INTO node_credentials(token_hash,agent_id,runtime_id) VALUES($1,$2,$3)',[tokenHash(token),profile.agentId,profile.runtimeId]);
    });
    return { agentId: profile.agentId,runtimeId: profile.runtimeId,token,bindingMessage: message };
  }
  async rotateCredential(principal: Principal,agentId: string) {
    admin(principal);
    return this.store.write(async client => {
      const profile = requireValue((await client.query('SELECT profile FROM agents WHERE id=$1',[agentId])).rows[0]).profile;
      const token = randomBytes(32).toString('base64url');
      await client.query('UPDATE node_credentials SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL',[agentId]);
      await client.query('INSERT INTO node_credentials(token_hash,agent_id,runtime_id) VALUES($1,$2,$3)',[tokenHash(token),agentId,profile.runtimeId]);
      return { agentId,token };
    });
  }
  async registerChain(principal: Principal,agentId: string) {
    admin(principal);
    const chain = this.requireChain();
    const profile = requireValue((await this.agents()).find(a=>a.agentId===agentId));
    return chain.registerAgent({ agentId: profile.agentId,roles: profile.roles,manifestURI: profile.manifestURI,manifestHash: profile.manifestHash });
  }
  async heartbeat(principal: Principal,input: unknown) {
    const identity = node(principal);
    const request = HeartbeatRequestSchema.parse(input);
    if (request.runtimeId !== identity.runtimeId) throw new AppError(403,'UNAUTHORIZED','runtimeId 与凭证不匹配');
    const updated = await this.store.write(async client => {
      const profile = requireValue((await this.agents(client)).find(a=>a.agentId===identity.agentId));
      if (profile.maxConcurrency !== request.maxConcurrency) throw new AppError(409,'INVALID_INPUT','并发配置与登记值不匹配');
      const reported = AgentProfileSchema.parse({ ...profile,lastSeenAt: new Date().toISOString(),activeTasks: request.activeTasks });
      await client.query('UPDATE agents SET profile=$2,worker_reported_active_tasks=$3 WHERE id=$1',[identity.agentId,reported,request.activeTasks]);
      return requireValue((await this.agents(client)).find(a=>a.agentId===identity.agentId));
    });
    return updated;
  }
  async createRun(principal: Principal,input: unknown) {
    admin(principal);
    const request = CreateRunWithInputRequestSchema.parse(input);
    if (request.criteriaHash!==CRITERIA_HASH) throw new AppError(409,'ARTIFACT_MISMATCH','规则摘要与固定流程公开原文不一致');
    if (this.chain && this.config.CHAIN_VALIDATOR?.toLowerCase()!==request.validator) throw new AppError(403,'UNAUTHORIZED','运行必须使用已配置的可信验收地址');
    const inputContent = request.inputContent;
    const inputBytes = encodeUtf8(inputContent);
    if (hashUtf8(inputContent) !== request.inputHash) throw new AppError(409,'ARTIFACT_MISMATCH','输入字节与 inputHash 不匹配');
    const created = await this.store.write(async client => {
      const activeRuns = Number((await client.query("SELECT count(*) FROM runs WHERE document->>'status' IN ('OPEN','RUNNING') AND runtime_status <> 'CANCELLED'")).rows[0].count);
      assertExecutionBudget({ operation: 'CREATE_RUN',activeRuns,modelCalls: 0,stepCalls: 0 });
      if ((await client.query('SELECT id FROM runs WHERE id=$1',[request.runId])).rowCount) throw new AppError(409,'INVALID_STATE','runId 已存在');
      const run = createFixedRun(request,new Date().toISOString());
      await client.query('INSERT INTO runs(id,document,input_bytes) VALUES($1,$2,$3)',[run.runId,run,inputBytes]);
      for (const task of run.tasks) await client.query('INSERT INTO tasks(id,run_id,document) VALUES($1,$2,$3)',[task.taskId,run.runId,task]);
      await this.store.event(client,'RUN_CREATED',run.runId,null,null,{ inputHash: run.inputHash });
      return run;
    });
    const { runtimeStatus: _runtimeStatus,taskRuntime: _taskRuntime,...current } = await this.run(created.runId);
    return current;
  }
  async saveTask(client: PoolClient,task: Task) {
    TaskSchema.parse(task);
    await client.query('UPDATE tasks SET document=$2 WHERE id=$1',[task.taskId,task]);
    const run = await this.run(task.runId,client);
    await client.query("UPDATE runs SET document=jsonb_set(document,'{status}',$2::jsonb) WHERE id=$1",[task.runId,JSON.stringify(run.status)]);
  }
  assertAttempt(task: Task, attempt: number) {
    if (task.attempt !== attempt) throw new AppError(409,'STALE_ATTEMPT','请求 attempt 已过期');
  }
  async assignedTask(principal: Principal,taskId: string,attempt: number,client: PoolClient) {
    const identity = node(principal);
    const task = await this.task(taskId,client);
    this.assertAttempt(task,attempt);
    sameAgent(identity.agentId,requireValue(task.assignee));
    const run = await this.run(task.runId,client);
    if (run.runtimeStatus !== 'ACTIVE') throw new AppError(409,'INVALID_STATE','运行已暂停或等待人工操作');
    return task;
  }
  async jobs(principal: Principal) {
    const identity = node(principal);
    const records = await this.db.pool.query("SELECT t.document,t.runtime_status,t.runtime_reason FROM tasks t JOIN runs r ON r.id=t.run_id WHERE t.document->>'assignee'=$1 AND t.document->>'status' IN ('ASSIGNED','RUNNING') AND t.runtime_status='ACTIVE' AND r.runtime_status='ACTIVE' ORDER BY t.id",[identity.agentId]);
    return WorkerJobsResponseSchema.parse({ jobs: await Promise.all(records.rows.map(async row=>({ task: row.document,runtimeStatus: row.runtime_status,reason: row.runtime_reason,run: await this.runDetails(row.document.runId) }))) });
  }
}
