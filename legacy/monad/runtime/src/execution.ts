import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@neondatabase/serverless';
import {
  AddressSchema, ArtifactSchema, ArtifactUploadRequestSchema, AssessmentCheckSchema, AssessmentSchema,
  AssignmentDecisionSchema, ChainReceiptSchema, HandoffSchema, RoleReputationSchema, SubmitTaskRequestSchema,
  hashUtf8, type AssignTaskRequest, type Artifact, type AssignmentDecision, type ChainReceipt, type Hash, type Task,
} from '../../../packages/contracts/src/index.ts';
import { transitionTask, validateHandoff, assertArtifactBinding, assertUpstreamVerified, type VerifiedDependency } from './domain/tasks.ts';
import { assertConfirmedReceipt } from './domain/chain.ts';
import { candidateExclusions,rankCandidates,serializeDecisionBody } from './domain/policy.ts';
import { assertExecutionBudget } from './domain/workflow.ts';
import type { Application } from './application.js';
import { admin, node, sameAgent, type Principal } from './auth.js';
import { AppError, requireValue } from './errors.js';
import { encodeUtf8 } from './content.js';
import { assertAssignmentReceipt,assertSubmissionReceipt,assertOutcomeReceipt,toChainRunId } from '../../../packages/runtime-chain/src/index.ts';
import { ChainState,type ChainOperation } from './chain-state.js';

export class Execution {
  constructor(readonly app: Application) {}
  context() {
    this.app.requireChain();
    if (!this.app.config.CHAIN_CONTRACT || !this.app.config.CHAIN_COORDINATOR) throw new AppError(503,'CHAIN_NOT_CONFIGURED','链合约与协调者配置缺失');
    return { chainId: this.app.config.CHAIN_ID,contract: AddressSchema.parse(this.app.config.CHAIN_CONTRACT),coordinator: AddressSchema.parse(this.app.config.CHAIN_COORDINATOR) };
  }
  async snapshot() {
    const chain = this.app.requireChain();
    if (!chain.getSnapshot) throw new AppError(503,'CHAIN_DATA_MISSING','真实链适配器缺少 getSnapshot');
    const snapshot = await chain.getSnapshot();
    if (snapshot.chainId !== this.context().chainId) throw new AppError(409,'WRONG_CHAIN','快照网络与服务配置不一致');
    return snapshot;
  }
  async dependencies(task: Task,client: PoolClient): Promise<VerifiedDependency[]> {
    const result: VerifiedDependency[] = [];
    for (const taskId of task.dependsOn) {
      const upstream = await this.app.task(taskId,client);
      const record = requireValue((await client.query('SELECT artifact_id,document FROM assessments WHERE task_id=$1 AND attempt=$2',[taskId,upstream.attempt])).rows[0],'DEPENDENCY_NOT_READY');
      const { artifact } = await this.app.artifact(record.artifact_id,client);
      const handoff = HandoffSchema.parse(requireValue((await client.query("SELECT document FROM handoffs WHERE document->>'fromTaskId'=$1 AND document->>'toTaskId'=$2 AND document->>'artifactId'=$3",[taskId,task.taskId,artifact.artifactId])).rows[0],'DEPENDENCY_NOT_READY').document);
      result.push({ task: upstream,artifact,assessment: AssessmentSchema.parse(record.document),handoff });
    }
    return result;
  }
  async saveReceipt(client: PoolClient,task: Task,operation: ChainOperation,receipt: ChainReceipt) {
    await new ChainState(this.app).save(client,task,operation,receipt);
  }
  pending(receipt: ChainReceipt) {
    assertConfirmedReceipt(receipt,this.context());
  }
  async assign(principal: Principal,taskId: string,options?: AssignTaskRequest) {
    admin(principal);
    const chain = this.app.requireChain();
    const context = this.context();
    if (options && options.chainId!==context.chainId) throw new AppError(409,'WRONG_CHAIN','请求网络与配置网络不一致');
    const decision = await this.app.store.write(async client => {
      const task = await this.app.task(taskId,client);
      if (task.status !== 'OPEN') throw new AppError(409,'INVALID_STATE','任务已被指派');
      if ((await this.app.run(task.runId,client)).runtimeStatus!=='ACTIVE') throw new AppError(409,'INVALID_STATE','运行当前不能指派任务');
      assertUpstreamVerified(task,await this.dependencies(task,client),context);
      const previous = (await client.query("SELECT document,raw_bytes FROM decisions WHERE task_id=$1 AND document->>'attempt'=$2 ORDER BY document->>'evaluatedAt' DESC,id DESC LIMIT 1",[taskId,String(task.attempt)])).rows[0];
      if (previous?.document.selectedAgentId) {
        const decision = AssignmentDecisionSchema.parse(previous.document);
        if (!previous.raw_bytes || hashUtf8(previous.raw_bytes) !== decision.decisionHash) throw new AppError(409,'ARTIFACT_MISMATCH','已保存决策摘要不匹配');
        return decision;
      }
      const latest = await this.snapshot();
      if (options?.blockNumber && BigInt(options.blockNumber)>BigInt(latest.blockNumber)) throw new AppError(400,'INVALID_INPUT','请求的快照区块尚不存在');
      const snapshot = { ...latest,blockNumber: options?.blockNumber ?? latest.blockNumber };
      const agents = await this.app.agents(client);
      const reputations = await Promise.all(agents.filter(a=>a.roles.includes(task.role)).map(a=>chain.getRoleReputation({ ...snapshot,agentId: a.agentId,role: task.role }).then(value=>RoleReputationSchema.parse(value))));
      const decision = rankCandidates({ decisionId: randomUUID(),taskId: task.taskId,attempt: task.attempt,role: task.role,policyVersion: 'role-rep-v1',repBlockNumber: snapshot.blockNumber,evaluatedAt: new Date().toISOString(),agents,reputations });
      const { decisionHash } = decision;
      const bytes = Buffer.from(serializeDecisionBody(decision),'utf8');
      if (hashUtf8(bytes) !== decisionHash) throw new AppError(409,'ARTIFACT_MISMATCH','决策摘要原文不匹配');
      await client.query('INSERT INTO decisions(id,run_id,task_id,document,raw_bytes) VALUES($1,$2,$3,$4,$5)',[decision.decisionId,task.runId,task.taskId,decision,bytes]);
      await this.app.store.event(client,'ASSIGNMENT_DECIDED',task.runId,task.taskId,task.attempt,{ decisionId: decision.decisionId,decisionHash });
      return decision;
    });
    if (!decision.selectedAgentId) throw new AppError(409,'NO_ELIGIBLE_AGENT','没有符合当前政策的候选节点');
    const state = new ChainState(this.app);
    const result = await state.exclusive(async () => {
      const task = await this.app.task(taskId);
      if (task.status !== 'OPEN') throw new AppError(409,'INVALID_STATE','任务已被指派');
      const run = await this.app.run(task.runId);
      if (run.runtimeStatus!=='ACTIVE') throw new AppError(409,'INVALID_STATE','运行当前不能指派任务');
      const assignment = { runId: task.runId,taskId: task.taskId,attempt: task.attempt,role: task.role,assignee: decision.selectedAgentId!,validator: task.validator,inputHash: task.inputHash,criteriaHash: task.criteriaHash,decisionHash: decision.decisionHash };
      const tracked = await state.tracked(task,'ASSIGN');
      let receipt: ChainReceipt;
      if (tracked) {
        receipt = await state.read(tracked);
      } else {
        const existing = await chain.getTask({ ...await this.snapshot(),taskId: task.taskId });
        if (existing) throw new AppError(503,'CHAIN_DATA_MISSING','链上已有指派但缺少原交易哈希，需要显式对账');
        const selected = requireValue((await this.app.agents(this.app.db.pool,task.taskId)).find(agent=>agent.agentId===decision.selectedAgentId));
        if (candidateExclusions(selected,task.role,new Date().toISOString()).length) throw new AppError(409,'NO_ELIGIBLE_AGENT','冻结决策中的节点当前不满足在线与容量条件');
        receipt = await state.send(task,'ASSIGN',()=>chain.assignTask(assignment));
      }
      if (receipt.status==='CONFIRMED') assertAssignmentReceipt(receipt,{ ...assignment,...context });
      return this.app.store.write(async client=>{
        const current = await this.app.task(taskId,client);
        const dependencies = await this.dependencies(current,client);
        await this.saveReceipt(client,current,'ASSIGN',receipt);
        await client.query('UPDATE decisions SET receipt=$2 WHERE id=$1',[decision.decisionId,receipt]);
        if (receipt.status!=='CONFIRMED') return { receipt,task: current };
        const next = transitionTask(current,'ASSIGNED',{ ...context,attempt: current.attempt,assignee: decision.selectedAgentId!,receipt,dependencies });
        await this.app.saveTask(client,next);
        await this.app.store.event(client,'TASK_ASSIGNED',current.runId,current.taskId,current.attempt,{ decisionId: decision.decisionId,assignee: next.assignee });
        return { receipt,task: next };
      });
    });
    this.pending(result.receipt);
    return { ...result,decision };
  }
  async accept(principal: Principal,taskId: string,attempt: number) {
    const context = this.context();
    return this.app.store.write(async client => {
      const task = await this.app.assignedTask(principal,taskId,attempt,client);
      const next = transitionTask(task,'RUNNING',{ ...context,attempt,actor: node(principal).agentId as Hash,dependencies: await this.dependencies(task,client) });
      await this.app.saveTask(client,next);
      await this.app.store.event(client,'TASK_RUNNING',task.runId,task.taskId,attempt,{});
      return next;
    });
  }
  async upload(principal: Principal,input: unknown) {
    const request = ArtifactUploadRequestSchema.parse(input);
    return this.app.store.write(async client => {
      const task = await this.app.assignedTask(principal,request.taskId,request.attempt,client);
      if (task.status !== 'RUNNING') throw new AppError(409,'INVALID_STATE','产物上传需要 RUNNING 任务');
      if (hashUtf8(request.content) !== request.contentHash) throw new AppError(409,'ARTIFACT_MISMATCH','原始 UTF-8 产物摘要不匹配');
      const dependencies = await this.dependencies(task,client);
      const requiredParents = dependencies.map(d=>d.artifact.artifactId).sort();
      if (JSON.stringify([...request.parentArtifactIds].sort()) !== JSON.stringify(requiredParents)) throw new AppError(409,'ARTIFACT_MISMATCH','产物父版本与固定流程上游不一致');
      for (const parent of request.parentArtifactIds) await this.app.artifact(parent,client);
      if ((await client.query('SELECT id FROM artifacts WHERE id=$1',[request.artifactId])).rowCount) throw new AppError(409,'INVALID_STATE','artifactId 已存在');
      const artifact = ArtifactSchema.parse({ artifactId: request.artifactId,taskId: request.taskId,attempt: request.attempt,parentArtifactIds: request.parentArtifactIds,schemaVersion: request.schemaVersion,limitations: request.limitations,contentHash: request.contentHash,producer: node(principal).agentId,URI: `${this.app.config.PUBLIC_BASE_URL}/api/artifacts/${encodeURIComponent(request.artifactId)}` });
      await client.query('INSERT INTO artifacts(id,run_id,task_id,document,raw_bytes) VALUES($1,$2,$3,$4,$5)',[artifact.artifactId,task.runId,task.taskId,artifact,encodeUtf8(request.content)]);
      await this.app.store.event(client,'ARTIFACT_STORED',task.runId,task.taskId,task.attempt,{ artifactId: artifact.artifactId,contentHash: artifact.contentHash });
      return artifact;
    });
  }
  async submit(principal: Principal,taskId: string,input: unknown) {
    node(principal);
    return this.finalizeSubmission(principal,taskId,input);
  }
  private async finalizeSubmission(principal: Principal | null,taskId: string,input: unknown) {
    const request = SubmitTaskRequestSchema.parse(input);
    const context = this.context();
    const chain = this.app.requireChain();
    const result = await this.app.store.write(async client => {
      const task = principal
        ? await this.app.assignedTask(principal,taskId,request.attempt,client)
        : await this.app.task(taskId,client);
      this.app.assertAttempt(task,request.attempt);
      if ((await this.app.run(task.runId,client)).runtimeStatus!=='ACTIVE') throw new AppError(409,'INVALID_STATE','运行当前不能恢复提交');
      const { artifact } = await this.app.artifact(request.artifactId,client);
      assertArtifactBinding(task,artifact);
      const actual = requireValue((await chain.getReceipts({ txHash: request.receipt.txHash })).find(r=>r.txHash===request.receipt.txHash),'CHAIN_DATA_MISSING');
      if (actual.signer!==task.assignee) throw new AppError(403,'UNAUTHORIZED','真实提交签名者与指派节点不匹配');
      if (actual.chainId!==context.chainId || actual.contract!==context.contract) throw new AppError(409,'WRONG_CHAIN','真实提交回执网络或合约不匹配');
      const { taskId: _receiptTaskId,attempt: _receiptAttempt,artifactHash: _receiptArtifactHash,...baseReceipt } = request.receipt;
      const claimed = ChainReceiptSchema.parse(baseReceipt);
      if (actual.chainId!==claimed.chainId || actual.contract!==claimed.contract || actual.signer!==claimed.signer || (claimed.blockNumber!==null && actual.blockNumber!==claimed.blockNumber)) throw new AppError(409,'ARTIFACT_MISMATCH','提交回执与真实链读取不一致');
      const submissionReceipt = { ...actual,taskId: task.taskId,attempt: task.attempt,artifactHash: artifact.contentHash };
      if (request.receipt.taskId !== task.taskId || request.receipt.attempt !== task.attempt || request.receipt.artifactHash !== artifact.contentHash) throw new AppError(409,'ARTIFACT_MISMATCH','回执业务字段不匹配');
      if (actual.status!=='CONFIRMED') {
        await client.query('UPDATE tasks SET submitted_artifact_id=$2,submission_receipt=$3 WHERE id=$1',[task.taskId,artifact.artifactId,submissionReceipt]);
        await this.saveReceipt(client,task,'SUBMIT',actual);
        return { task,receipt: actual };
      }
      const actualTask = requireValue(await chain.getTask({ chainId: actual.chainId,blockNumber: requireValue(actual.blockNumber,'CHAIN_DATA_MISSING'),taskId: task.taskId }),'CHAIN_DATA_MISSING');
      if (actualTask.assignee!==task.assignee || actualTask.attempt!==task.attempt || actualTask.inputHash!==task.inputHash || actualTask.criteriaHash!==task.criteriaHash || actualTask.validator!==task.validator || actualTask.role!==task.role || actualTask.artifactHash!==artifact.contentHash || !['SUBMITTED','VERIFIED_PASS','VERIFIED_FAIL'].includes(actualTask.status)) throw new AppError(409,'ARTIFACT_MISMATCH','链上提交与任务、节点、产物不匹配');
      assertSubmissionReceipt(actual,{ chainId: context.chainId,contract: context.contract,taskId: task.taskId,attempt: task.attempt,artifactHash: artifact.contentHash,artifactURI: artifact.URI,producer: requireValue(task.assignee),chainRunId: toChainRunId(task.runId) });
      const next = transitionTask(task,'SUBMITTED',{ ...context,attempt: task.attempt,actor: actual.signer,artifact,submissionReceipt });
      await client.query('UPDATE tasks SET submitted_artifact_id=$2,submission_receipt=$3 WHERE id=$1',[task.taskId,artifact.artifactId,submissionReceipt]);
      await this.app.saveTask(client,next);
      await this.saveReceipt(client,task,'SUBMIT',actual);
      await this.app.store.event(client,'TASK_SUBMITTED',task.runId,task.taskId,task.attempt,{ artifactId: artifact.artifactId });
      return { task: next,receipt: actual };
    });
    this.pending(result.receipt);
    return result.task;
  }
  async reconcileSubmission(taskId: string) {
    const row = requireValue((await this.app.db.pool.query('SELECT document,submitted_artifact_id,submission_receipt FROM tasks WHERE id=$1',[taskId])).rows[0]);
    if (!row.submission_receipt || !row.submitted_artifact_id) throw new AppError(409,'CHAIN_DATA_MISSING','没有已授权并持久化的待确认提交');
    return this.finalizeSubmission(null,taskId,{ attempt: row.document.attempt,artifactId: row.submitted_artifact_id,receipt: row.submission_receipt });
  }
  async reserveModelCall(principal: Principal,taskId: string,attempt: number) {
    const result = await this.app.store.write(async client => {
      const task = await this.app.assignedTask(principal,taskId,attempt,client);
      if (task.status !== 'RUNNING') throw new AppError(409,'INVALID_STATE','模型调用需要 RUNNING 任务');
      const modelCalls = Number((await client.query('SELECT count(*) FROM model_calls WHERE run_id=$1',[task.runId])).rows[0].count);
      const stepCalls = Number((await client.query('SELECT count(*) FROM model_calls WHERE task_id=$1',[task.taskId])).rows[0].count);
      if (modelCalls >= 6 || stepCalls >= 2) {
        await client.query("UPDATE runs SET runtime_status='WAITING_MANUAL' WHERE id=$1",[task.runId]);
        await client.query("UPDATE tasks SET runtime_status='WAITING_MANUAL',runtime_reason='BUDGET_EXCEEDED' WHERE id=$1",[taskId]);
        await this.app.store.event(client,'BUDGET_EXCEEDED',task.runId,taskId,attempt,{ modelCalls,stepCalls });
        return { blocked: true as const,modelCalls,stepCalls };
      }
      assertExecutionBudget({ operation: 'MODEL_CALL',activeRuns: 1,modelCalls,stepCalls });
      const callId = randomUUID();
      await client.query('INSERT INTO model_calls(id,task_id,run_id,agent_id,attempt) VALUES($1,$2,$3,$4,$5)',[callId,taskId,task.runId,node(principal).agentId,attempt]);
      await this.app.store.event(client,'MODEL_CALL_RESERVED',task.runId,taskId,attempt,{ callId,modelCalls: modelCalls+1,stepCalls: stepCalls+1 });
      return { blocked: false as const,callId,modelCalls: modelCalls+1,stepCalls: stepCalls+1 };
    });
    if (result.blocked) throw new AppError(429,'BUDGET_EXCEEDED','模型预算耗尽，等待人工操作');
    return { callId: result.callId,modelCalls: result.modelCalls,stepCalls: result.stepCalls };
  }
  async interrupt(principal: Principal,taskId: string,attempt: number,reason: string) {
    return this.app.store.write(async client => {
      const task = await this.app.assignedTask(principal,taskId,attempt,client);
      await client.query("UPDATE tasks SET runtime_status='INTERRUPTED',runtime_reason=$2 WHERE id=$1",[taskId,reason]);
      await client.query("UPDATE runs SET runtime_status='WAITING_MANUAL' WHERE id=$1",[task.runId]);
      await this.app.store.event(client,'RUNTIME_INTERRUPTED',task.runId,taskId,attempt,{ reason });
      return { taskId,runtimeStatus: 'INTERRUPTED',qualityChanged: false };
    });
  }
  async control(principal: Principal,runId: string,action: 'pause'|'resume'|'cancel') {
    admin(principal);
    return this.app.store.write(async client => {
      const run = await this.app.run(runId,client);
      if (run.runtimeStatus==='CANCELLED') throw new AppError(409,'INVALID_STATE','已取消的运行不能重新启动');
      const state = action==='pause' ? 'PAUSED' : action==='cancel' ? 'CANCELLED' : 'ACTIVE';
      await client.query('UPDATE runs SET runtime_status=$2 WHERE id=$1',[runId,state]);
      if (action==='resume') await client.query("UPDATE tasks SET runtime_status='ACTIVE',runtime_reason=NULL WHERE run_id=$1",[runId]);
      if (action==='cancel') {
        await client.query("UPDATE tasks SET runtime_status='CANCELLED' WHERE run_id=$1",[runId]);
        for (const task of run.tasks) await this.app.saveTask(client,task);
      }
      await this.app.store.event(client,`RUN_${action.toUpperCase()}`,runId,null,null,{ runtimeStatus: state });
      return { runId,runtimeStatus: state };
    });
  }
  async assess(principal: Principal,taskId: string) {
    admin(principal);
    const context = this.context();
    const chain = this.app.requireChain();
    if (!this.app.validator) throw new AppError(503,'VALIDATOR_NOT_CONFIGURED','确定性验收模块未配置');
    const prepared = await this.app.store.write(async client => {
      const task = await this.app.task(taskId,client);
      if (task.status === 'VERIFIED_PASS' || task.status === 'VERIFIED_FAIL') throw new AppError(409,'DUPLICATE_OUTCOME','当前 attempt 已有最终结果');
      if (task.status !== 'SUBMITTED') throw new AppError(409,'INVALID_STATE','仅可验收已提交任务');
      const existing = (await client.query('SELECT document,evidence_bytes,artifact_id FROM assessments WHERE task_id=$1 AND attempt=$2',[taskId,task.attempt])).rows[0];
      if (existing) {
        if (hashUtf8(existing.evidence_bytes) !== existing.document.evidenceHash) throw new AppError(409,'ARTIFACT_MISMATCH','验收证据摘要不匹配');
        return { task,artifact: (await this.app.artifact(existing.artifact_id,client)).artifact,assessment: AssessmentSchema.parse(existing.document) };
      }
      const artifactId = requireValue((await client.query('SELECT submitted_artifact_id FROM tasks WHERE id=$1',[taskId])).rows[0]).submitted_artifact_id;
      const { artifact,bytes } = await this.app.artifact(artifactId,client);
      assertArtifactBinding(task,artifact);
      const inputContent = (await this.app.input(task.runId,client)).toString('utf8');
      const parents: { task: Task; artifact: Artifact; content: string }[] = [];
      const visited = new Set<string>();
      const visit = async (current: Task) => {
        for (const dependencyId of current.dependsOn) {
          if (visited.has(dependencyId)) continue;
          visited.add(dependencyId);
          const dependency = await this.app.task(dependencyId,client);
          if (dependency.status !== 'VERIFIED_PASS') throw new AppError(409,'DEPENDENCY_NOT_READY','验收依赖尚未确认通过');
          await visit(dependency);
          const record = requireValue((await client.query('SELECT artifact_id FROM assessments WHERE task_id=$1 AND attempt=$2',[dependencyId,dependency.attempt])).rows[0]);
          const parent = await this.app.artifact(record.artifact_id,client);
          parents.push({ task: dependency,artifact: parent.artifact,content: parent.bytes.toString('utf8') });
        }
      };
      await visit(task);
      const checks = AssessmentCheckSchema.array().min(1).parse(await this.app.validator!({ task,artifact,content: bytes.toString('utf8'),inputContent,parents }));
      const verdict = checks.every(check=>check.passed) ? 'PASS' : 'FAIL';
      const evidenceContent = JSON.stringify({ version: 'deterministic-assessment-v1',taskId: task.taskId,attempt: task.attempt,inputHash: task.inputHash,criteriaHash: task.criteriaHash,artifactHash: artifact.contentHash,validator: task.validator,verdict,checks,createdAt: new Date().toISOString() });
      const evidenceHash = hashUtf8(evidenceContent);
      const assessment = AssessmentSchema.parse({ taskId,attempt: task.attempt,verdict,checks,evidenceURI: `${this.app.config.PUBLIC_BASE_URL}/api/tasks/${taskId}/assessments/${task.attempt}/evidence`,evidenceHash,validator: task.validator,receipt: null });
      await client.query('INSERT INTO assessments(task_id,attempt,document,evidence_bytes,artifact_id) VALUES($1,$2,$3,$4,$5)',[taskId,task.attempt,assessment,Buffer.from(evidenceContent,'utf8'),artifact.artifactId]);
      await this.app.store.event(client,'ASSESSMENT_READY',task.runId,taskId,task.attempt,{ verdict,evidenceHash });
      return { task,artifact,assessment };
    });
    const state = new ChainState(this.app);
    const result = await state.exclusive(async () => {
      const task = await this.app.task(taskId);
      if (task.status !== 'SUBMITTED') throw new AppError(409,'DUPLICATE_OUTCOME','任务已记录结论');
      const outcome = { taskId: task.taskId,attempt: task.attempt,verdict: prepared.assessment.verdict as 'PASS'|'FAIL',artifactHash: prepared.artifact.contentHash,criteriaHash: task.criteriaHash,evidenceHash: prepared.assessment.evidenceHash,evidenceURI: prepared.assessment.evidenceURI,validator: task.validator };
      const tracked = await state.tracked(task,'OUTCOME');
      let receipt: ChainReceipt;
      if (tracked) {
        receipt = await state.read(tracked);
      } else {
        const onChain = await chain.getTask({ ...await this.snapshot(),taskId: task.taskId });
        if (onChain?.status==='VERIFIED_PASS' || onChain?.status==='VERIFIED_FAIL') throw new AppError(503,'CHAIN_DATA_MISSING','链上已有结论但缺少可核对的原始交易，等待人工对账');
        receipt = await state.send(task,'OUTCOME',()=>chain.recordOutcome(outcome));
      }
      if (receipt.status==='CONFIRMED') assertOutcomeReceipt(receipt,{ ...outcome,chainId: context.chainId,contract: context.contract,assignee: requireValue(task.assignee),role: task.role,chainRunId: toChainRunId(task.runId) });
      return this.app.store.write(async client=>{
        const current = await this.app.task(taskId,client);
        if (current.status!=='SUBMITTED') throw new AppError(409,'DUPLICATE_OUTCOME','当前任务已记录验收结论');
        const assessment = AssessmentSchema.parse({ ...prepared.assessment,receipt });
        await client.query('UPDATE assessments SET document=$3 WHERE task_id=$1 AND attempt=$2',[taskId,current.attempt,assessment]);
        await this.saveReceipt(client,current,'OUTCOME',receipt);
        if (receipt.status !== 'CONFIRMED') return { receipt,assessment };
        const next = transitionTask(current,assessment.verdict==='PASS' ? 'VERIFIED_PASS' : 'VERIFIED_FAIL',{ ...context,attempt: current.attempt,artifact: prepared.artifact,assessment });
        await this.app.saveTask(client,next);
        if (assessment.verdict==='PASS') {
          const downstream = (await this.app.run(task.runId,client)).tasks.filter(item=>item.dependsOn.includes(taskId as Hash));
          for (const target of downstream) {
            const handoff = HandoffSchema.parse({ handoffId: randomUUID(),runId: task.runId,artifactId: prepared.artifact.artifactId,fromTaskId: task.taskId,toTaskId: target.taskId,status: 'PENDING',reason: '上游已通过确定性验收，等待下游核对原始文件与交接说明',contentHash: prepared.artifact.contentHash,schemaVersion: prepared.artifact.schemaVersion,createdAt: new Date().toISOString() });
            await client.query('INSERT INTO handoffs(id,run_id,document) VALUES($1,$2,$3)',[handoff.handoffId,task.runId,handoff]);
          }
        }
        await this.app.store.event(client,`TASK_${next.status}`,task.runId,task.taskId,task.attempt,{ evidenceHash: assessment.evidenceHash,receipt });
        return { receipt,assessment };
      });
    });
    this.pending(result.receipt);
    return result.assessment;
  }
  async evidence(taskId: string,attempt: number) {
    const row = requireValue((await this.app.db.pool.query('SELECT document,evidence_bytes FROM assessments WHERE task_id=$1 AND attempt=$2',[taskId,attempt])).rows[0]);
    if (!row.evidence_bytes || hashUtf8(row.evidence_bytes)!==row.document.evidenceHash) throw new AppError(409,'ARTIFACT_MISMATCH','验收证据摘要不匹配');
    return row.evidence_bytes as Buffer;
  }
  async decisionBytes(decisionId: string) {
    const row = requireValue((await this.app.db.pool.query('SELECT document,raw_bytes FROM decisions WHERE id=$1',[decisionId])).rows[0]);
    if (!row.raw_bytes || hashUtf8(row.raw_bytes)!==row.document.decisionHash) throw new AppError(409,'ARTIFACT_MISMATCH','决策原文摘要不匹配');
    return { bytes: row.raw_bytes as Buffer,contentHash: row.document.decisionHash as string };
  }
  async handoff(principal: Principal,handoffId: string,status: 'ACCEPTED'|'RETURNED',reason: string) {
    const identity = node(principal);
    if (status!=='ACCEPTED' && status!=='RETURNED') throw new AppError(400,'INVALID_INPUT','下游只能接受或退回交接');
    const context = this.context();
    return this.app.store.write(async client => {
      const handoff = HandoffSchema.parse(requireValue((await client.query('SELECT document FROM handoffs WHERE id=$1 FOR UPDATE',[handoffId])).rows[0]).document);
      const downstream = await this.app.task(handoff.toTaskId,client);
      sameAgent(identity.agentId,requireValue(downstream.assignee));
      if (handoff.status!=='PENDING') throw new AppError(409,'INVALID_STATE','交接已经处理');
      const upstream = await this.app.task(handoff.fromTaskId,client);
      const { artifact,bytes } = await this.app.artifact(handoff.artifactId,client);
      const assessment = AssessmentSchema.parse(requireValue((await client.query('SELECT document FROM assessments WHERE task_id=$1 AND attempt=$2',[upstream.taskId,upstream.attempt])).rows[0]).document);
      validateHandoff({ ...context,upstream,downstream,artifact,assessment,content: bytes,expectedSchemaVersion: handoff.schemaVersion });
      const updated = HandoffSchema.parse({ ...handoff,status,reason });
      await client.query('UPDATE handoffs SET document=$2 WHERE id=$1',[handoffId,updated]);
      await this.app.store.event(client,`HANDOFF_${status}`,handoff.runId,downstream.taskId,downstream.attempt,{ handoffId,reason });
      return updated;
    });
  }
}
