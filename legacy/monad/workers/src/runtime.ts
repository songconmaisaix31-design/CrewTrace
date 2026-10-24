import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { ArtifactSchema, AttemptSchema, HashSchema, ChainReceiptSchema, ChainTaskSchema, SubmissionReceiptSchema, type Address, type Artifact } from "../../packages/contracts/src/index.ts";
import { loadWorkerChain, saveSubmission, waitForTransaction, type WorkerChain } from "./chain.ts";
import { loadWorkerConfig } from "./config.ts";
import { contentHash, exact, jsonBytes, utf8 } from "./content.ts";
import { requireValue } from "./errors.ts";
import { executeAnalysis, executeData, executeReport, type ExecutionContext } from "./executor.ts";
import { WorkerHttp, type WorkerJob } from "./http.ts";
import { ModelBudget, StepModel } from "./model.ts";
import { WorkerBoard } from "./mcp.ts";
import { fileBytes, productBytes, readProduct, validateProduct, type VerifiedParent } from "./product.ts";
import { validateAnalysis, validateData } from "./validator.ts";
import { CRITERIA_HASH } from "./criteria.ts";

async function loadParents(job: WorkerJob, http: WorkerHttp): Promise<VerifiedParent[]> {
  const parents: VerifiedParent[] = [];
  for (const task of job.run.tasks) {
    if (task.role === job.task.role || task.status !== "VERIFIED_PASS") continue;
    const artifacts = job.run.artifacts.filter(artifact => artifact.taskId === task.taskId && artifact.attempt === task.attempt && artifact.schemaVersion === "worker-output-v1");
    requireValue(artifacts.length === 1, "DEPENDENCY_NOT_READY", "已验收上游主产物缺失或存在歧义");
    const artifact = artifacts[0];
    const bytes = await http.download(artifact.URI);
    exact(contentHash(bytes), artifact.contentHash, "下载的上游产物原始摘要不符");
    parents.push({ task, artifact, content: utf8(bytes) });
  }
  return parents;
}

async function ensureAssignment(chain: WorkerChain, job: WorkerJob, agentId: `0x${string}`, signal: AbortSignal) {
  const task = job.task;
  signal.throwIfAborted();
  const chainId = Number(process.env.CHAIN_ID);
  const decision = job.run.decisions.find(decision => decision.taskId === task.taskId && decision.attempt === task.attempt);
  requireValue(decision, "CHAIN_DATA_MISSING", "缺少已保存指派决策");
  const bindings = job.run.taskReceipts.filter(binding => binding.taskId === task.taskId && binding.attempt === task.attempt && binding.operation === "ASSIGN");
  requireValue(bindings.length === 1, "CHAIN_DATA_MISSING", "已保存真实指派回执缺失或存在歧义");
  const reference = bindings[0].receipt;
  const receipts = (await chain.getReceipts({ txHash: reference.txHash })).map(receipt => ChainReceiptSchema.parse(receipt));
  const confirmed = receipts.filter(receipt => receipt.status === "CONFIRMED" && receipt.chainId === chainId && receipt.contract === process.env.CHAIN_CONTRACT_ADDRESS!.toLowerCase() && receipt.blockNumber !== null);
  requireValue(confirmed.length > 0, "CHAIN_PENDING", "指派尚无真实已确认回执");
  requireValue(process.env.CHAIN_COORDINATOR_ADDRESS, "CHAIN_NOT_CONFIGURED", "缺少真实部署协调者地址");
  chain.assertAssignmentReceipt(confirmed[0], {
    runId: task.runId, taskId: task.taskId, attempt: task.attempt, role: task.role, assignee: agentId,
    validator: task.validator, inputHash: task.inputHash, criteriaHash: task.criteriaHash, decisionHash: decision.decisionHash,
    chainId, contract: process.env.CHAIN_CONTRACT_ADDRESS as Address, coordinator: process.env.CHAIN_COORDINATOR_ADDRESS as Address,
  });
  const blockNumber = confirmed.reduce((maximum, receipt) => BigInt(receipt.blockNumber!) > BigInt(maximum) ? receipt.blockNumber! : maximum, "0");
  const result = await chain.getTask({ taskId: task.taskId, chainId, blockNumber });
  requireValue(result, "CHAIN_DATA_MISSING", "真实链未找到指派任务");
  const assigned = ChainTaskSchema.parse(result);
  exact(assigned.assignee, agentId, "链上指派签名地址不符");
  exact(assigned.attempt, task.attempt, "链上 attempt 不符");
  exact(assigned.inputHash, task.inputHash, "链上输入摘要不符");
  exact(assigned.criteriaHash, task.criteriaHash, "链上规则摘要不符");
  exact(assigned.role, task.role, "链上角色不符");
  exact(assigned.validator, task.validator, "链上验收方不符");
  exact(assigned.decisionHash, decision.decisionHash, "链上决策摘要不符");
  exact(assigned.chainRunId, chain.toChainRunId(task.runId), "链上运行标识不符");
  requireValue(assigned.status === "ASSIGNED", "INVALID_STATE", "链上任务不处于可执行状态");
}

async function processJob(job: WorkerJob, http: WorkerHttp, board: WorkerBoard, chain: WorkerChain, config: ReturnType<typeof loadWorkerConfig>, model: StepModel, signal: AbortSignal) {
  const task = job.task;
  requireValue(task.assignee === config.agentId && task.role === config.role, "UNAUTHORIZED", "任务身份或角色不符");
  exact(task.criteriaHash, CRITERIA_HASH, "任务规则摘要与当前执行器不符");
  requireValue(task.status === "ASSIGNED", "INVALID_STATE", "已运行任务需要显式恢复，不重新执行模型");
  await ensureAssignment(chain, job, config.agentId, signal);
  const sourceBytes = await http.download(job.run.inputURI);
  exact(contentHash(sourceBytes), task.inputHash, "原始 CSV 下载摘要不符");
  const parents = await loadParents(job, http);
  for (const parent of parents) {
    const product = readProduct(parent.content);
    if (parent.task.role === "DATA") validateData(sourceBytes, fileBytes(product, "data.csv"), fileBytes(product, "data-plan.json"));
    if (parent.task.role === "ANALYSIS") {
      const dataParent = parents.find(candidate => candidate.task.role === "DATA");
      requireValue(dataParent, "DEPENDENCY_NOT_READY", "缺少 ANALYSIS 的 DATA 原始父产物");
      validateAnalysis(sourceBytes, fileBytes(readProduct(dataParent.content), "data.csv"), fileBytes(product, "metrics.json"));
    }
  }
  for (const dependencyId of task.dependsOn) {
    const parent = parents.find(parent => parent.task.taskId === dependencyId);
    requireValue(parent, "DEPENDENCY_NOT_READY", "缺少直接父产物");
    const handoffs = job.run.handoffs.filter(handoff => handoff.fromTaskId === dependencyId && handoff.toTaskId === task.taskId && handoff.artifactId === parent.artifact.artifactId);
    requireValue(handoffs.length === 1, "DEPENDENCY_NOT_READY", "当前版本交接缺失或存在歧义");
    const handoff = handoffs[0];
    exact(handoff.contentHash, parent.artifact.contentHash, "交接原始字节摘要不符");
    exact(handoff.schemaVersion, parent.artifact.schemaVersion, "交接 schema 不符");
    if (handoff.status === "PENDING") await http.acceptHandoff(handoff.handoffId);
    else requireValue(handoff.status === "ACCEPTED", "DEPENDENCY_NOT_READY", "上游交接已退回");
  }
  const output = join(config.outputDirectory, `${task.taskId}-${task.attempt}`);
  await mkdir(config.outputDirectory, { recursive: true });
  await mkdir(output, { recursive: false });
  await http.accept(task.taskId, task.attempt);
  await board.announcements(task.runId);
  await board.notes(task.runId);
  await board.announce({ runId: task.runId, taskId: task.taskId, topic: `${task.role} 执行进度`, type: "PROGRESS", body: "已确认真实链上指派，正在执行角色工具与模型。" });
  const note = await board.createNote({ runId: task.runId, taskId: task.taskId, topic: `${task.role} 成果交接`, body: "正在处理已确认的原始输入与上游版本。", artifactIds: [] });
  const budget = new ModelBudget();
  const context: ExecutionContext = {
    model, budget, signal,
    beforeCall: async () => { await http.reserveModelCall(task.taskId, task.attempt); },
    onAudit: async () => { await writeFile(join(output, "model-calls.json"), jsonBytes(budget.calls)); },
  };
  let bytes: Buffer;
  let immediateParents: Artifact[];
  if (task.role === "DATA") {
    const result = await executeData(sourceBytes, context);
    immediateParents = [];
    bytes = productBytes(task.role, sourceBytes, { "data.csv": result.dataBytes, "data-plan.json": result.planBytes }, immediateParents);
  } else {
    const dataParent = parents.find(parent => parent.task.role === "DATA");
    requireValue(dataParent, "DEPENDENCY_NOT_READY", "缺少已验收 DATA 父产物");
    const dataBytes = fileBytes(readProduct(dataParent.content), "data.csv");
    if (task.role === "ANALYSIS") {
      const result = await executeAnalysis(sourceBytes, dataBytes, context);
      immediateParents = [dataParent.artifact];
      bytes = productBytes(task.role, sourceBytes, { "metrics.json": result.metricsBytes }, immediateParents);
    } else {
      const analysisParent = parents.find(parent => parent.task.role === "ANALYSIS");
      requireValue(analysisParent, "DEPENDENCY_NOT_READY", "缺少已验收 ANALYSIS 父产物");
      const metricsBytes = fileBytes(readProduct(analysisParent.content), "metrics.json");
      const result = await executeReport(sourceBytes, dataBytes, metricsBytes, context);
      immediateParents = [analysisParent.artifact];
      bytes = productBytes(task.role, sourceBytes, { "report.json": result.reportBytes, "report.md": result.markdownBytes }, immediateParents);
    }
  }
  const product = readProduct(utf8(bytes));
  const artifactId = `${task.taskId}-${task.attempt}`;
  const artifact = await http.upload({ taskId: task.taskId, attempt: task.attempt, artifactId, parentArtifactIds: immediateParents.map(parent => parent.artifactId), schemaVersion: "worker-output-v1", limitations: product.limitations, content: utf8(bytes), contentHash: contentHash(bytes) });
  validateProduct({ task, artifact, content: utf8(bytes), inputContent: utf8(sourceBytes), parents });
  await writeFile(join(output, "product.json"), bytes);
  await writeFile(join(output, "artifact.json"), jsonBytes(artifact));
  const original = await saveSubmission(chain, task, artifact, config.agentId, output);
  const confirmed = await waitForTransaction(chain, original, signal, async receipt => {
    await writeFile(join(output, "submission-receipt.json"), jsonBytes({ ...receipt, taskId: task.taskId, attempt: task.attempt, artifactHash: artifact.contentHash }));
  });
  const receipt = chain.assertSubmissionReceipt(confirmed, { taskId: task.taskId, attempt: task.attempt, artifactHash: artifact.contentHash, artifactURI: artifact.URI, producer: config.agentId, chainId: original.chainId, contract: original.contract, chainRunId: chain.toChainRunId(task.runId) });
  await http.submit(task.taskId, { attempt: task.attempt, artifactId, receipt });
  const body = `产物 ${artifactId} 已提交，原始字节摘要 ${artifact.contentHash}；schema worker-output-v1；父产物 ${artifact.parentArtifactIds.join(", ") || "无"}；限制：${artifact.limitations.join("；")}。等待独立验收确认。`;
  await board.updateNote(note.noteId, { expectedVersion: note.version, body, topic: `${task.role} 成果交接`, artifactIds: [artifactId] });
  await board.announce({ runId: task.runId, taskId: task.taskId, topic: `${task.role} 已交付`, type: "HANDOFF", body });
  console.log(JSON.stringify({ event: "artifact_submitted", agentId: config.agentId, taskId: task.taskId, artifactId, callCount: budget.calls.length }));
}

export async function startWorker(signal: AbortSignal) {
  const config = loadWorkerConfig();
  const model = new StepModel();
  const chain = await loadWorkerChain(config.privateKey);
  await model.assertAvailable(signal);
  const loopController = new AbortController();
  const loopSignal = AbortSignal.any([signal, loopController.signal]);
  const http = new WorkerHttp(config.serviceURL, config.nodeCredential, loopSignal);
  const board = new WorkerBoard(config.serviceURL, config.nodeCredential, loopSignal);
  await board.connect();
  let activeTasks = 0;
  const heartbeats = (async () => {
    while (!loopSignal.aborted) {
      const profile = await http.heartbeat({ runtimeId: config.runtimeId, activeTasks, maxConcurrency: 1 });
      exact(profile.agentId, config.agentId, "节点凭证与签名地址不符");
      requireValue(profile.roles.includes(config.role), "UNAUTHORIZED", "登记角色不符");
      console.log(JSON.stringify({ event: "heartbeat", agentId: config.agentId, runtimeId: config.runtimeId, activeTasks }));
      await setTimeout(10_000, undefined, { signal: loopSignal });
    }
  })();
  const jobs = (async () => {
    while (!loopSignal.aborted) {
      await http.progress();
      const jobs = await http.jobs();
      requireValue(jobs.length <= 1, "INVALID_STATE", "节点并发指派超过已登记槽位");
      for (const job of jobs) {
        activeTasks = 1;
        await processJob(job, http, board, chain, config, model, loopSignal);
        activeTasks = 0;
      }
      await setTimeout(2_000, undefined, { signal: loopSignal });
    }
  })();
  try {
    await Promise.all([heartbeats, jobs]);
  } finally {
    loopController.abort();
    await Promise.allSettled([heartbeats, jobs]);
    await board.close();
  }
}

export async function reconcileSubmission(taskId: string, attempt: number, signal: AbortSignal) {
  HashSchema.parse(taskId);
  AttemptSchema.parse(attempt);
  const config = loadWorkerConfig();
  const chain = await loadWorkerChain(config.privateKey);
  const http = new WorkerHttp(config.serviceURL, config.nodeCredential, signal);
  const output = join(config.outputDirectory, `${taskId}-${attempt}`);
  const [artifactFile, receiptFile] = await Promise.all([readFile(join(output, "artifact.json")), readFile(join(output, "submission-receipt.json"))]);
  const artifact = ArtifactSchema.parse(JSON.parse(utf8(artifactFile)));
  const original = SubmissionReceiptSchema.parse(JSON.parse(utf8(receiptFile)));
  exact(original.taskId, taskId, "待对账交易任务不符");
  exact(original.attempt, attempt, "待对账交易 attempt 不符");
  exact(original.signer, config.agentId, "待对账交易签名者不符");
  exact(original.artifactHash, artifact.contentHash, "待对账交易产物不符");
  exact(original.chainId, Number(process.env.CHAIN_ID), "待对账交易网络不符");
  exact(original.contract, process.env.CHAIN_CONTRACT_ADDRESS!.toLowerCase(), "待对账交易合约不符");
  const confirmed = await waitForTransaction(chain, original, signal, async receipt => writeFile(join(output, "submission-receipt.json"), jsonBytes({ ...receipt, taskId: original.taskId, attempt, artifactHash: artifact.contentHash })));
  requireValue(confirmed.blockNumber, "CHAIN_PENDING", "同一提交交易尚未确认，保持等待");
  exact(confirmed.signer, config.agentId, "已确认交易签名者不符");
  exact(confirmed.chainId, original.chainId, "已确认交易网络不符");
  exact(confirmed.contract, original.contract, "已确认交易合约不符");
  const chainTask = await chain.getTask({ taskId: original.taskId, chainId: confirmed.chainId, blockNumber: confirmed.blockNumber });
  requireValue(chainTask && chainTask.artifactHash === artifact.contentHash && chainTask.assignee === config.agentId && chainTask.attempt === attempt, "ARTIFACT_MISMATCH", "链上产物或签名者不符");
  const receipt = chain.assertSubmissionReceipt(confirmed, { taskId: original.taskId, attempt, artifactHash: artifact.contentHash, artifactURI: artifact.URI, producer: config.agentId, chainId: original.chainId, contract: original.contract });
  await writeFile(join(output, "submission-receipt.json"), jsonBytes(receipt));
  await http.submit(taskId, { attempt, artifactId: artifact.artifactId, receipt });
  return { taskId, attempt, artifactId: artifact.artifactId, txHash: receipt.txHash, status: receipt.status };
}
