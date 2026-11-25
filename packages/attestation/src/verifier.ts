import type { Hex } from 'viem';
import type { FulfillmentAttestation } from './schema.js';
import { evaluateCsvVerification } from './csv-verifier.js';
import { evaluateCodeVerification, type CodeVerificationEvidence } from './code-task.js';

// 通用履约验证器接口。任务规则只存在于验证器内，信任核心只负责凭证结构、签名、
// 策略、撤销、链上承诺与信誉准入。验证器来源限定为编译期内置列表，SDK 不从凭证
// 携带的 URL、模块名或代码执行任何动态加载。
export const TASK_TYPES = ['csv-data-review', 'code-artifact-test'] as const;
export type TaskType = typeof TASK_TYPES[number];

export type VerifierResult = 'PASS' | 'FAIL' | 'UNRESOLVED';

export interface VerifierEvaluationInput {
  attestation: FulfillmentAttestation;
  inputContent: string | null;
  deliveryContent: string | null;
  codeEvidence: CodeVerificationEvidence | null;
  // 代码任务必须在信任核心完成独立执行授权后才为 true。验证器自身以此为
  // 失败关闭条件，缺少授权的直接调用不会执行任何提交的代码。
  codeExecutionAuthorized: boolean;
  now: Date;
}

export interface VerifierEvaluation {
  verifierId: string;
  ruleVersion: string;
  taskType: TaskType;
  result: VerifierResult;
  reasons: string[];
  checkCodes: string[];
  evidenceDigest: Hex;
  input: 'NOT_PROVIDED' | 'MATCH' | 'MISMATCH';
  content: 'NOT_PROVIDED' | 'MATCH' | 'MISMATCH';
  transformation: 'NOT_ASSERTED' | 'MATCH' | 'MISMATCH';
  outputFormat: 'NOT_ASSERTED' | 'RECALCULATED_PASS' | 'RECALCULATED_FAIL';
  fulfillment: 'NOT_ASSERTED' | 'RECALCULATED_PASS' | 'RECALCULATED_FAIL';
}

export interface BuiltinVerifier {
  verifierId: string;
  ruleVersion: string;
  taskType: TaskType;
  evaluate(input: VerifierEvaluationInput): VerifierEvaluation;
}

// 注册表在模块初始化时深冻结。运行时无法替换内置验证器，也无法通过
// 取得的验证器对象改写执行逻辑；解析只按（标识，规则版本）精确匹配。
const BUILTIN_VERIFIERS: readonly BuiltinVerifier[] = Object.freeze([
  Object.freeze({
    verifierId: 'csv-ledger',
    ruleVersion: 'csv-ledger-v1',
    taskType: 'csv-data-review' as TaskType,
    evaluate: evaluateCsvVerification,
  }),
  Object.freeze({
    verifierId: 'code-artifact-test',
    ruleVersion: 'code-artifact-test-v1',
    taskType: 'code-artifact-test' as TaskType,
    evaluate: evaluateCodeVerification,
  }),
]);

export function resolveVerifier(verifierId: string, ruleVersion: string): BuiltinVerifier | null {
  return BUILTIN_VERIFIERS.find(
    (verifier) => verifier.verifierId === verifierId && verifier.ruleVersion === ruleVersion,
  ) ?? null;
}

export function verifierCatalogue(): Array<{ verifierId: string; ruleVersion: string; taskType: TaskType }> {
  return Object.freeze(BUILTIN_VERIFIERS.map(({ verifierId, ruleVersion, taskType }) => Object.freeze({
    verifierId, ruleVersion, taskType,
  }))) as unknown as Array<{ verifierId: string; ruleVersion: string; taskType: TaskType }>;
}

export function taskTypeOf(attestation: FulfillmentAttestation): TaskType | 'unknown' {
  const verifierId = attestation.validation.verifierId ?? attestation.validation.ruleId;
  return resolveVerifier(verifierId, attestation.validation.ruleVersion)?.taskType ?? 'unknown';
}
