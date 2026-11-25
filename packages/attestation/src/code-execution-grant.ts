import { keccak256, toBytes, type Hex } from 'viem';
import { z } from 'zod';
import { canonicalJson } from './canonical-json.js';
import { contentDigest } from './canonical.js';
import { recoverDigestSigner, signDigest } from './sign.js';
import {
  HashSchema, IsoTimeSchema, SignatureSchema, UuidSchema,
} from './schema.js';
import { CODE_RUNNER_ID, artifactBundleDigest } from './code-task.js';

// 代码执行授权与履约凭证签名相互独立。验证方在执行任何提交的代码前，必须
// 持有一份由本地预置审批公钥签名的授权，且授权绑定的交付摘要、测试集合摘要
// 与执行器标识必须与本次证据一致。授权缺失、签名者不受信或已过期时不得执行。
export const CODE_EXECUTION_GRANT_FORMAT = 'ct-code-execution-grant-v1';
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const grantPayloadSchema = z.strictObject({
  format: z.literal(CODE_EXECUTION_GRANT_FORMAT),
  grantId: UuidSchema,
  runnerId: z.literal(CODE_RUNNER_ID),
  artifactDigest: HashSchema,
  suiteDigest: HashSchema,
  issuedAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema,
});

export const CodeExecutionGrantSchema = grantPayloadSchema.extend({
  signature: SignatureSchema,
});

export type CodeExecutionGrant = z.infer<typeof CodeExecutionGrantSchema>;
export type CodeExecutionGrantPayload = z.infer<typeof grantPayloadSchema>;

export function codeExecutionGrantDigest(payload: CodeExecutionGrantPayload): Hex {
  return keccak256(toBytes(`${CODE_EXECUTION_GRANT_FORMAT}:${canonicalJson(payload)}`));
}

export async function signCodeExecutionGrant(input: {
  grantId: string;
  artifactDigest: Hex;
  suiteDigest: Hex;
  issuedAt: Date;
  expiresAt: Date;
  approverKey: Hex;
}): Promise<CodeExecutionGrant> {
  const payload: CodeExecutionGrantPayload = {
    format: CODE_EXECUTION_GRANT_FORMAT,
    grantId: input.grantId,
    runnerId: CODE_RUNNER_ID,
    artifactDigest: input.artifactDigest.toLowerCase(),
    suiteDigest: input.suiteDigest.toLowerCase(),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  };
  if (new Date(payload.expiresAt).getTime() <= new Date(payload.issuedAt).getTime()) {
    throw new Error('CODE_EXECUTION_GRANT_EXPIRY_INVALID');
  }
  const signature = await signDigest(codeExecutionGrantDigest(payload), input.approverKey);
  return { ...payload, signature };
}

// 审批方在看到完整交付与固定测试集合后签发授权。调用方自行决定有效期。
export async function authorizeCodeExecution(input: {
  grantId: string;
  artifactFiles: Array<{ path: string; content: string }>;
  testSuiteContent: string;
  issuedAt: Date;
  expiresAt: Date;
  approverKey: Hex;
}): Promise<CodeExecutionGrant> {
  return signCodeExecutionGrant({
    grantId: input.grantId,
    artifactDigest: artifactBundleDigest(input.artifactFiles),
    suiteDigest: contentDigest(input.testSuiteContent),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    approverKey: input.approverKey,
  });
}

export interface CodeExecutionGrantVerification {
  authorized: boolean;
  reasons: string[];
}

export async function verifyCodeExecutionGrant(input: {
  grant: unknown;
  artifactDigest: Hex;
  suiteDigest: Hex;
  trustedApproverAddresses: string[];
  now: Date;
}): Promise<CodeExecutionGrantVerification> {
  const reasons: string[] = [];
  if (input.grant === null || input.grant === undefined) {
    return { authorized: false, reasons: ['CODE_EXECUTION_GRANT_MISSING'] };
  }
  const parsed = CodeExecutionGrantSchema.safeParse(input.grant);
  if (!parsed.success) {
    return { authorized: false, reasons: ['CODE_EXECUTION_GRANT_INVALID'] };
  }
  const grant = parsed.data;
  if (grant.runnerId !== CODE_RUNNER_ID
    || grant.artifactDigest !== input.artifactDigest.toLowerCase()
    || grant.suiteDigest !== input.suiteDigest.toLowerCase()) {
    reasons.push('CODE_EXECUTION_GRANT_MISMATCH');
  }
  const issuedAt = new Date(grant.issuedAt).getTime();
  const expiresAt = new Date(grant.expiresAt).getTime();
  if (issuedAt > input.now.getTime() + CLOCK_SKEW_MS) reasons.push('CODE_EXECUTION_GRANT_NOT_YET_VALID');
  if (expiresAt <= input.now.getTime()) reasons.push('CODE_EXECUTION_GRANT_EXPIRED');
  if (expiresAt <= issuedAt) reasons.push('CODE_EXECUTION_GRANT_INVALID');

  const trusted = input.trustedApproverAddresses.map((address) => address.toLowerCase());
  if (trusted.length === 0) {
    reasons.push('CODE_EXECUTION_GRANT_SIGNER_UNTRUSTED');
  } else {
    let signer: string | null = null;
    try {
      const { signature, ...payload } = grant;
      signer = await recoverDigestSigner(codeExecutionGrantDigest(payload), signature as Hex);
    } catch {
      reasons.push('CODE_EXECUTION_GRANT_INVALID');
    }
    if (!signer || !trusted.includes(signer)) {
      reasons.push('CODE_EXECUTION_GRANT_SIGNER_UNTRUSTED');
    }
  }
  return { authorized: reasons.length === 0, reasons: [...new Set(reasons)] };
}
