import { z } from 'zod';

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const signaturePattern = /^0x[0-9a-fA-F]{130}$/;

export const HashSchema = z.string().regex(hashPattern, '哈希必须为 32 字节十六进制').transform((value) => value.toLowerCase());
export const AddressSchema = z.string().regex(addressPattern, '地址必须为 20 字节十六进制').transform((value) => value.toLowerCase());
export const IsoTimeSchema = z.string().regex(isoPattern, '时间必须为带时区的 ISO-8601');
export const UuidSchema = z.string().regex(uuidPattern, '标识必须为 UUID');
export const SignatureSchema = z.string().regex(signaturePattern, '签名必须为 65 字节十六进制');

export const IssuerSchema = z.strictObject({
  issuerId: z.string().min(1).max(64),
  keyId: z.string().min(1).max(64),
  signerAddress: AddressSchema,
});

export const SubjectSchema = z.strictObject({
  agentId: UuidSchema,
  identity: z.strictObject({
    namespace: z.enum(['ct-local', 'eip155']),
    value: z.string().min(1).max(128),
  }),
  signingAddress: AddressSchema.nullable(),
  role: z.string().min(1).max(64),
  serviceId: z.string().min(1).max(64),
  serviceVersion: z.number().int().positive(),
});

export const TaskSchema = z.strictObject({
  taskId: UuidSchema,
  attempt: z.number().int().positive(),
  workflowVersion: z.string().min(1).max(64),
});

export const OrderRefSchema = z.strictObject({
  orderRef: HashSchema,
  buyerRef: HashSchema.nullable(),
}).nullable();

export const InputSchema = z.strictObject({
  contentHash: HashSchema,
  rowCount: z.number().int().nonnegative(),
  schemaVersion: z.string().min(1).max(64),
});

export const DeliverySchema = z.strictObject({
  contentHash: HashSchema,
  deliveryVersion: z.number().int().positive(),
  rowCount: z.number().int().nonnegative(),
});

export const ValidationSchema = z.strictObject({
  // verifierId 为新增可选字段，缺省时以 ruleId 作为验证器标识，V0.1 凭证无需改写。
  verifierId: z.string().min(1).max(64).optional(),
  ruleId: z.string().min(1).max(64),
  ruleVersion: z.string().min(1).max(64),
  result: z.enum(['PASS', 'FAIL', 'UNRESOLVED']),
  checkCodes: z.array(z.string().min(1).max(128)).max(256),
  checksDigest: HashSchema,
});

// 代码交付任务的可验证证据摘要。凭证只保存摘要与执行环境标识，原始证据由持有方按需提供。
export const CodeArtifactEvidenceSchema = z.strictObject({
  kind: z.literal('code-artifact-test-v1'),
  taskSpec: z.strictObject({
    contentHash: HashSchema,
    schemaVersion: z.string().min(1).max(64),
  }),
  testSuite: z.strictObject({
    contentHash: HashSchema,
    testCount: z.number().int().positive(),
    ruleVersion: z.string().min(1).max(64),
  }),
  artifact: z.strictObject({
    entrypoint: z.string().min(1).max(128),
    files: z.array(z.strictObject({
      path: z.string().min(1).max(256),
      contentHash: HashSchema,
    })).min(1).max(64),
  }),
  testRun: z.strictObject({
    reportDigest: HashSchema,
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    exitCode: z.number().int(),
  }),
  environment: z.strictObject({
    runnerId: z.string().min(1).max(128),
    nodeVersion: z.string().min(1).max(32),
    isolation: z.literal('child-process-vm'),
  }),
});

export const ReviewSchema = z.strictObject({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  reviewerId: z.string().min(1).max(128),
  reviewerAddress: AddressSchema.nullable(),
  reviewedAt: IsoTimeSchema,
});

export const ReputationSchema = z.strictObject({
  eventId: z.string().min(1).max(128),
  outcome: z.enum(['PASS', 'FAIL']),
  source: z.literal('DETERMINISTIC_REVIEW'),
});

export const PaymentSchema = z.strictObject({
  status: z.enum(['NOT_REQUIRED', 'UNPAID', 'VERIFIED']),
});

export const ChainReceiptSchema = z.strictObject({
  txHash: HashSchema,
  blockNumber: z.string().regex(/^\d+$/, '区块号必须为十进制字符串'),
  signer: AddressSchema,
});

export const ChainBindingSchema = z.strictObject({
  chainId: z.number().int().positive(),
  contract: AddressSchema,
  mappingKind: z.literal(4),
  recordId: HashSchema,
  version: z.literal(1),
  commitmentKey: HashSchema,
  receipt: ChainReceiptSchema.nullable(),
});

export const BindingSchema = z.strictObject({
  environment: z.enum(['local', 'staging', 'production']),
  deployment: z.string().min(1).max(128),
});

export const IntegritySchema = z.strictObject({
  canonicalization: z.literal('ct-canonical-json-v1'),
  digest: HashSchema,
  signature: z.string().regex(signaturePattern, '签名必须为 65 字节十六进制'),
});

export const FulfillmentAttestationSchema = z.strictObject({
  attestationVersion: z.literal('ct-attestation-v1'),
  attestationId: UuidSchema,
  issuedAt: IsoTimeSchema,
  expiresAt: IsoTimeSchema.nullable(),
  binding: BindingSchema,
  issuer: IssuerSchema,
  subject: SubjectSchema,
  task: TaskSchema,
  order: OrderRefSchema,
  input: InputSchema,
  delivery: DeliverySchema,
  validation: ValidationSchema,
  // 任务专用证据为可选字段，CSV 凭证不包含该字段，V0.1 凭证继续通过同一结构校验。
  evidence: CodeArtifactEvidenceSchema.optional(),
  review: ReviewSchema,
  reputation: ReputationSchema,
  payment: PaymentSchema,
  chain: ChainBindingSchema.nullable(),
  integrity: IntegritySchema,
});

export type FulfillmentAttestation = z.infer<typeof FulfillmentAttestationSchema>;
export type CodeArtifactEvidence = z.infer<typeof CodeArtifactEvidenceSchema>;
export type ChainBinding = z.infer<typeof ChainBindingSchema>;

export const IssuerEntrySchema = z.strictObject({
  issuerId: z.string().min(1).max(64),
  keyId: z.string().min(1).max(64),
  address: AddressSchema,
  validFrom: IsoTimeSchema,
  validTo: IsoTimeSchema.nullable(),
  revokedAt: IsoTimeSchema.nullable(),
});

export const IssuerAllowlistSchema = z.strictObject({
  version: z.literal('ct-issuer-allowlist-v1'),
  issuedAt: IsoTimeSchema.optional(),
  expiresAt: IsoTimeSchema.nullable().optional(),
  issuers: z.array(IssuerEntrySchema).min(1),
});

export const RevocationEntrySchema = z.strictObject({
  attestationId: UuidSchema,
  revokedAt: IsoTimeSchema,
  reasonCode: z.string().min(1).max(64),
});

export const RevocationListSchema = z.strictObject({
  version: z.literal('ct-revocation-list-v1'),
  issuedAt: IsoTimeSchema.optional(),
  expiresAt: IsoTimeSchema.nullable().optional(),
  entries: z.array(RevocationEntrySchema),
});

export type IssuerAllowlist = z.infer<typeof IssuerAllowlistSchema>;
export type RevocationList = z.infer<typeof RevocationListSchema>;
