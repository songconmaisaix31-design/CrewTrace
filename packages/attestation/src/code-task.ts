import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { keccak256, toBytes, type Hex } from 'viem';
import { z } from 'zod';
import { checksDigest, contentDigest } from './canonical.js';
import { canonicalJson } from './canonical-json.js';
import { finalizeAttestation, type ChainWriteConfig } from './builder.js';
import {
  AddressSchema, HashSchema, IsoTimeSchema, UuidSchema,
  type CodeArtifactEvidence, type FulfillmentAttestation,
} from './schema.js';
import type { VerifierEvaluation, VerifierEvaluationInput } from './verifier.js';

export const CODE_VERIFIER_ID = 'code-artifact-test';
export const CODE_VERIFIER_RULE_VERSION = 'code-artifact-test-v1';
export const CODE_RUNNER_ID = 'ct-code-runner-v1';
export const CODE_RUNNER_ISOLATION = 'child-process-vm';

const SUITE_FORMAT = 'ct-code-test-suite-v1';
const REPORT_FORMAT = 'ct-code-test-report-v1';
// 单次测试执行的兜底时间上限，避免受控样本在校验阶段无限占用进程。
const DEFAULT_TOTAL_TIMEOUT_MS = 15_000;

export const CodeScalarSchema = z.union([z.string().max(256), z.number(), z.boolean()]);

export const CodeTestSuiteSchema = z.strictObject({
  format: z.literal(SUITE_FORMAT),
  ruleVersion: z.string().min(1).max(64),
  entrypoint: z.string().min(1).max(128),
  exportName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, '导出名必须为合法标识符'),
  caseTimeoutMs: z.number().int().min(50).max(5_000).optional(),
  cases: z.array(z.strictObject({
    name: z.string().min(1).max(64),
    input: z.union([CodeScalarSchema, z.array(CodeScalarSchema).max(16)]),
    expected: CodeScalarSchema,
  })).min(1).max(64),
});
export type CodeTestSuite = z.infer<typeof CodeTestSuiteSchema>;

export const CodeTestReportSchema = z.strictObject({
  format: z.literal(REPORT_FORMAT),
  suiteDigest: HashSchema,
  taskSpecDigest: HashSchema,
  artifactDigest: HashSchema,
  environmentId: z.string().min(1).max(128),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  exitCode: z.number().int(),
  cases: z.array(z.strictObject({
    name: z.string().min(1).max(64),
    status: z.enum(['PASS', 'FAIL', 'ERROR']),
    detail: z.string().max(200).nullable(),
  })).min(1).max(64),
});
export type CodeTestReport = z.infer<typeof CodeTestReportSchema>;

export interface CodeVerificationEvidence {
  taskSpec: string;
  testSuite: string;
  artifactFiles: Array<{ path: string; content: string }>;
  testReport: string;
  totalTimeoutMs?: number;
}

// 受控执行器：测试用例固定为数据，交付代码在独立子进程的 vm 上下文中执行。
// 该组件不下载、不读取凭证携带的模块路径，也不在宿主机主进程内执行交付代码。
const CODE_HARNESS_SOURCE = String.raw`
const vm = require('node:vm');
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    process.exit(2);
  }
  const report = {
    format: 'ct-code-test-report-v1',
    suiteDigest: payload.suiteDigest,
    taskSpecDigest: payload.taskSpecDigest,
    artifactDigest: payload.artifactDigest,
    environmentId: payload.environmentId,
    total: payload.suite.cases.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    exitCode: 0,
    cases: [],
  };
  const finish = () => {
    report.exitCode = report.failed === 0 && report.total > 0 ? 0 : 1;
    process.stdout.write(JSON.stringify(report));
  };
  let context;
  try {
    const sandbox = {
      module: { exports: {} },
      exports: {},
      console: { log: function () {}, error: function () {}, warn: function () {} },
    };
    context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(payload.artifactSource, context, { timeout: payload.loadTimeoutMs });
  } catch (error) {
    report.failed = report.total;
    report.cases = payload.suite.cases.map(function (item) {
      return { name: item.name, status: 'ERROR', detail: 'ARTIFACT_LOAD_FAILED' };
    });
    finish();
    return;
  }
  for (const item of payload.suite.cases) {
    let status = 'PASS';
    let detail = null;
    try {
      context.__caseInput = JSON.stringify(item.input);
      const actual = vm.runInContext(
        '(function () { const fn = module.exports[' + JSON.stringify(payload.suite.exportName) + '];'
        + ' if (typeof fn !== "function") { throw new Error("EXPORT_MISSING"); }'
        + ' return fn(JSON.parse(__caseInput)); })()',
        context,
        { timeout: payload.caseTimeoutMs },
      );
      if (actual !== item.expected) {
        status = 'FAIL';
        detail = 'VALUE_MISMATCH';
      }
    } catch (error) {
      status = 'ERROR';
      detail = String(error && error.message ? error.message : error).slice(0, 160);
    }
    if (status === 'PASS') report.passed += 1;
    else report.failed += 1;
    report.cases.push({ name: item.name, status: status, detail: detail });
  }
  finish();
});
`;

export function codeRunEnvironmentId(nodeVersion = process.versions.node): string {
  return `${CODE_RUNNER_ID}:node-${nodeVersion}:${CODE_RUNNER_ISOLATION}`;
}

export function codeReportDigest(report: CodeTestReport): Hex {
  return keccak256(toBytes(canonicalJson(report)));
}

export function artifactBundleDigest(files: Array<{ path: string; content: string }>): Hex {
  const manifest = files
    .map((file) => ({ path: file.path, contentHash: contentDigest(file.content) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return keccak256(toBytes(canonicalJson(manifest)));
}

export interface CodeTestRun {
  report: CodeTestReport | null;
  failure: 'TEST_RUN_TIMEOUT' | 'TEST_RUN_FAILED' | 'HARNESS_OUTPUT_INVALID' | null;
  detail: string | null;
}

export function runFixedTestSuite(input: {
  suite: CodeTestSuite;
  artifactSource: string;
  taskSpecDigest: string;
  suiteDigest: string;
  artifactDigest: string;
  totalTimeoutMs?: number;
}): CodeTestRun {
  const environmentId = codeRunEnvironmentId();
  const result = spawnSync(process.execPath, ['-e', CODE_HARNESS_SOURCE], {
    input: JSON.stringify({
      suite: input.suite,
      artifactSource: input.artifactSource,
      suiteDigest: input.suiteDigest,
      taskSpecDigest: input.taskSpecDigest,
      artifactDigest: input.artifactDigest,
      environmentId,
      loadTimeoutMs: input.suite.caseTimeoutMs ?? 1_000,
      caseTimeoutMs: input.suite.caseTimeoutMs ?? 1_000,
    }),
    encoding: 'utf8',
    timeout: input.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '' },
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { report: null, failure: 'TEST_RUN_TIMEOUT', detail: '子进程超过总时间上限' };
  }
  if (result.error) return { report: null, failure: 'TEST_RUN_FAILED', detail: result.error.message };
  if (result.status !== 0) {
    return { report: null, failure: 'TEST_RUN_FAILED', detail: `子进程退出码 ${result.status ?? 'null'}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { report: null, failure: 'HARNESS_OUTPUT_INVALID', detail: '测试执行器输出不是合法 JSON' };
  }
  const report = CodeTestReportSchema.safeParse(parsed);
  if (!report.success) {
    return { report: null, failure: 'HARNESS_OUTPUT_INVALID', detail: '测试执行器输出结构不符合约定' };
  }
  return { report: report.data, failure: null, detail: null };
}

function codeCheckCodes(suiteDigest: Hex, report: CodeTestReport): string[] {
  return [
    `VERIFIER:${CODE_VERIFIER_ID}@${CODE_VERIFIER_RULE_VERSION}`,
    `SUITE:${suiteDigest}`,
    `RESULT:${report.passed === report.total ? 'PASS' : 'FAIL'}`,
    ...report.cases.map((item, index) => `CASE:c${index}:${item.status}`),
  ];
}

function emptyEvaluation(ruleVersion: string): VerifierEvaluation {
  return {
    verifierId: CODE_VERIFIER_ID,
    ruleVersion,
    taskType: 'code-artifact-test',
    result: 'UNRESOLVED',
    reasons: [],
    checkCodes: [],
    evidenceDigest: checksDigest([]),
    input: 'NOT_PROVIDED',
    content: 'NOT_PROVIDED',
    transformation: 'NOT_ASSERTED',
    outputFormat: 'NOT_ASSERTED',
    fulfillment: 'NOT_ASSERTED',
  };
}

function finalize(evaluation: VerifierEvaluation): VerifierEvaluation {
  if (evaluation.reasons.length > 0) evaluation.result = 'FAIL';
  else if (evaluation.outputFormat === 'RECALCULATED_PASS' && evaluation.fulfillment === 'RECALCULATED_PASS') {
    evaluation.result = 'PASS';
  } else evaluation.result = 'UNRESOLVED';
  evaluation.evidenceDigest = checksDigest(evaluation.checkCodes);
  return evaluation;
}

// 代码任务验证器：绑定任务规范、固定测试集合、交付文件与测试报告摘要，
// 并在独立子进程重新执行固定测试集合，与凭证声明逐项比对。
export function evaluateCodeVerification(input: VerifierEvaluationInput): VerifierEvaluation {
  const { attestation, codeEvidence } = input;
  const evaluation = emptyEvaluation(attestation.validation.ruleVersion);
  const evidence = attestation.evidence;

  if (!evidence || evidence.kind !== 'code-artifact-test-v1') {
    evaluation.reasons.push('CODE_EVIDENCE_MISSING');
    return finalize(evaluation);
  }
  if (attestation.validation.ruleId !== CODE_VERIFIER_ID) {
    evaluation.reasons.push('VERIFIER_TASK_MISMATCH');
    return finalize(evaluation);
  }
  if (!codeEvidence) {
    evaluation.reasons.push('CODE_EVIDENCE_NOT_PROVIDED');
    return finalize(evaluation);
  }

  if (contentDigest(codeEvidence.taskSpec) !== evidence.taskSpec.contentHash
    || evidence.taskSpec.contentHash !== attestation.input.contentHash) {
    evaluation.input = 'MISMATCH';
    evaluation.reasons.push('TASK_SPEC_DIGEST_MISMATCH');
  } else {
    evaluation.input = 'MATCH';
    if (evidence.taskSpec.schemaVersion !== attestation.input.schemaVersion) {
      evaluation.reasons.push('TASK_SPEC_SCHEMA_MISMATCH');
    }
  }

  if (evidence.testSuite.ruleVersion !== attestation.validation.ruleVersion) {
    evaluation.reasons.push('RULE_VERSION_BINDING_MISMATCH');
  }
  const suiteDigest = contentDigest(codeEvidence.testSuite);
  if (suiteDigest !== evidence.testSuite.contentHash) {
    evaluation.reasons.push('TEST_SUITE_DIGEST_MISMATCH');
  }
  let suite: CodeTestSuite | null = null;
  try {
    suite = CodeTestSuiteSchema.parse(JSON.parse(codeEvidence.testSuite));
  } catch {
    evaluation.reasons.push('TEST_SUITE_INVALID');
  }
  if (suite) {
    if (suite.ruleVersion !== attestation.validation.ruleVersion) {
      evaluation.reasons.push('RULE_VERSION_BINDING_MISMATCH');
    }
    if (suite.cases.length !== evidence.testSuite.testCount) {
      evaluation.reasons.push('TEST_SUITE_COUNT_MISMATCH');
    }
    if (suite.entrypoint !== evidence.artifact.entrypoint) {
      evaluation.reasons.push('ENTRYPOINT_MISMATCH');
    }
  }

  const artifactDigest = artifactBundleDigest(codeEvidence.artifactFiles);
  if (artifactDigest !== attestation.delivery.contentHash) {
    evaluation.content = 'MISMATCH';
    evaluation.reasons.push('ARTIFACT_HASH_MISMATCH');
  } else {
    evaluation.content = 'MATCH';
  }
  const declaredFiles = new Map(evidence.artifact.files.map((file) => [file.path, file.contentHash]));
  const actualFiles = new Map(codeEvidence.artifactFiles.map((file) => [file.path, contentDigest(file.content)]));
  for (const [path, hash] of declaredFiles) {
    const actual = actualFiles.get(path);
    if (actual === undefined) evaluation.reasons.push('ARTIFACT_FILE_MISSING');
    else if (actual !== hash) evaluation.reasons.push('ARTIFACT_FILE_DIGEST_MISMATCH');
  }
  for (const path of actualFiles.keys()) {
    if (!declaredFiles.has(path)) evaluation.reasons.push('ARTIFACT_FILE_UNEXPECTED');
  }
  const entrySource = codeEvidence.artifactFiles.find((file) => file.path === evidence.artifact.entrypoint);
  if (!entrySource) evaluation.reasons.push('ENTRYPOINT_MISSING');

  let declaredReport: CodeTestReport | null = null;
  try {
    declaredReport = CodeTestReportSchema.parse(JSON.parse(codeEvidence.testReport));
  } catch {
    evaluation.reasons.push('TEST_REPORT_INVALID');
  }
  if (declaredReport) {
    if (codeReportDigest(declaredReport) !== evidence.testRun.reportDigest) {
      evaluation.reasons.push('TEST_REPORT_DIGEST_MISMATCH');
    }
    if (declaredReport.total !== evidence.testRun.total
      || declaredReport.passed !== evidence.testRun.passed
      || declaredReport.failed !== evidence.testRun.failed
      || declaredReport.skipped !== evidence.testRun.skipped
      || declaredReport.exitCode !== evidence.testRun.exitCode) {
      evaluation.reasons.push('TEST_REPORT_EVIDENCE_MISMATCH');
    }
    evaluation.checkCodes = codeCheckCodes(suiteDigest, declaredReport);
  }

  if (evidence.testRun.total !== evidence.testSuite.testCount) {
    evaluation.reasons.push('TESTS_NOT_FULLY_EXECUTED');
  }

  if (codeEvidence.taskSpec && suite && entrySource
    && evaluation.reasons.length === 0) {
    const run = runFixedTestSuite({
      suite,
      artifactSource: entrySource.content,
      taskSpecDigest: evidence.taskSpec.contentHash,
      suiteDigest,
      artifactDigest,
      totalTimeoutMs: codeEvidence.totalTimeoutMs,
    });
    if (run.failure) {
      evaluation.reasons.push(run.failure);
      evaluation.outputFormat = 'RECALCULATED_FAIL';
      evaluation.fulfillment = 'RECALCULATED_FAIL';
      return finalize(evaluation);
    }
    const recomputed = run.report!;
    if (recomputed.environmentId !== codeRunEnvironmentId(evidence.environment.nodeVersion)
      || evidence.environment.isolation !== CODE_RUNNER_ISOLATION
      || evidence.environment.runnerId !== CODE_RUNNER_ID) {
      evaluation.reasons.push('ENVIRONMENT_MISMATCH');
      return finalize(evaluation);
    }
    if (codeReportDigest(recomputed) !== evidence.testRun.reportDigest) {
      evaluation.reasons.push('TEST_RESULT_MISMATCH');
      evaluation.outputFormat = 'RECALCULATED_FAIL';
    } else {
      evaluation.outputFormat = 'RECALCULATED_PASS';
    }
    if (recomputed.total !== evidence.testSuite.testCount) {
      evaluation.reasons.push('TESTS_NOT_FULLY_EXECUTED');
    }
    if (recomputed.passed !== recomputed.total || recomputed.exitCode !== 0) {
      evaluation.reasons.push('TESTS_FAILED');
      evaluation.fulfillment = 'RECALCULATED_FAIL';
      evaluation.transformation = 'MISMATCH';
    } else {
      evaluation.fulfillment = 'RECALCULATED_PASS';
      evaluation.transformation = 'MATCH';
    }
  }

  return finalize(evaluation);
}

export const CodeIssueSchema = z.strictObject({
  subject: z.strictObject({
    agentId: UuidSchema,
    identity: z.strictObject({
      namespace: z.enum(['ct-local', 'eip155']),
      value: z.string().min(1).max(128),
    }),
    signingAddress: AddressSchema.nullable(),
    role: z.string().min(1).max(64),
    serviceId: z.string().min(1).max(64),
    serviceVersion: z.number().int().positive(),
  }),
  task: z.strictObject({
    taskId: UuidSchema,
    attempt: z.number().int().positive(),
    workflowVersion: z.string().min(1).max(64),
  }),
  review: z.strictObject({
    decision: z.enum(['ACCEPTED', 'REJECTED']),
    reviewerId: z.string().min(1).max(128),
    reviewerAddress: AddressSchema.nullable(),
    reviewedAt: IsoTimeSchema,
  }),
  reputation: z.strictObject({
    eventId: z.string().min(1).max(128),
    outcome: z.enum(['PASS', 'FAIL']),
  }),
  payment: z.strictObject({ status: z.enum(['NOT_REQUIRED', 'UNPAID', 'VERIFIED']) }),
});

export type CodeIssueFacts = z.infer<typeof CodeIssueSchema>;

export interface CodeIssueInput {
  facts: CodeIssueFacts;
  taskSpec: { content: string; schemaVersion: string };
  testSuite: { content: string };
  artifact: { entrypoint: string; files: Array<{ path: string; content: string }> };
  privateKey: Hex;
  issuerId: string;
  keyId: string;
  environment: 'local' | 'staging' | 'production';
  deployment: string;
  now?: Date;
  attestationId?: string;
  chain?: ChainWriteConfig;
  totalTimeoutMs?: number;
}

// 代码任务签发：验证器执行固定测试集合，凭证只携带摘要、计数与执行环境标识。
export async function issueCodeAttestation(input: CodeIssueInput): Promise<FulfillmentAttestation> {
  const facts = CodeIssueSchema.parse(input.facts);
  const suite = CodeTestSuiteSchema.parse(JSON.parse(input.testSuite.content));
  if (suite.ruleVersion !== CODE_VERIFIER_RULE_VERSION) throw new Error('RULE_VERSION_NOT_REGISTERED');

  const taskSpecDigest = contentDigest(input.taskSpec.content);
  const suiteDigest = contentDigest(input.testSuite.content);
  const artifactDigest = artifactBundleDigest(input.artifact.files);
  const entry = input.artifact.files.find((file) => file.path === input.artifact.entrypoint);
  if (!entry) throw new Error('ENTRYPOINT_MISSING');

  const run = runFixedTestSuite({
    suite,
    artifactSource: entry.content,
    taskSpecDigest,
    suiteDigest,
    artifactDigest,
    totalTimeoutMs: input.totalTimeoutMs,
  });
  if (!run.report) throw new Error(run.failure ?? 'TEST_RUN_FAILED');
  const report = run.report;
  if (report.total !== suite.cases.length) throw new Error('TEST_SUITE_COUNT_MISMATCH');

  const checkCodes = codeCheckCodes(suiteDigest, report);
  const attestationId = input.attestationId ?? randomUUID();
  const now = input.now ?? new Date();
  const evidence: CodeArtifactEvidence = {
    kind: 'code-artifact-test-v1',
    taskSpec: { contentHash: taskSpecDigest, schemaVersion: input.taskSpec.schemaVersion },
    testSuite: { contentHash: suiteDigest, testCount: suite.cases.length, ruleVersion: suite.ruleVersion },
    artifact: {
      entrypoint: input.artifact.entrypoint,
      files: input.artifact.files
        .map((file) => ({ path: file.path, contentHash: contentDigest(file.content) }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    },
    testRun: {
      reportDigest: codeReportDigest(report),
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
      exitCode: report.exitCode,
    },
    environment: {
      runnerId: CODE_RUNNER_ID,
      nodeVersion: process.versions.node,
      isolation: CODE_RUNNER_ISOLATION,
    },
  };

  const payload: Record<string, unknown> = {
    attestationVersion: 'ct-attestation-v1',
    attestationId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    binding: { environment: input.environment, deployment: input.deployment },
    issuer: { issuerId: input.issuerId, keyId: input.keyId, signerAddress: '' },
    subject: facts.subject,
    task: facts.task,
    order: null,
    input: { contentHash: taskSpecDigest, rowCount: 0, schemaVersion: input.taskSpec.schemaVersion },
    delivery: { contentHash: artifactDigest, deliveryVersion: 1, rowCount: 0 },
    validation: {
      verifierId: CODE_VERIFIER_ID,
      ruleId: CODE_VERIFIER_ID,
      ruleVersion: suite.ruleVersion,
      result: report.passed === report.total ? 'PASS' : 'FAIL',
      checkCodes,
      checksDigest: checksDigest(checkCodes),
    },
    evidence,
    review: facts.review,
    reputation: { ...facts.reputation, source: 'DETERMINISTIC_REVIEW' },
    payment: facts.payment,
    chain: input.chain ? {
      chainId: input.chain.chainId,
      contract: input.chain.contract.toLowerCase(),
      mappingKind: 4,
      recordId: '',
      version: 1,
      commitmentKey: '',
      receipt: null,
    } : null,
  };

  const { attestation } = await finalizeAttestation({
    payload, privateKey: input.privateKey, chain: input.chain,
  });
  return attestation;
}
