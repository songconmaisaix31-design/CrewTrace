import { z } from 'zod';
import { CountSchema, HashSchema, IdSchema, TimestampSchema } from './schemas.ts';
import { CollaborationIdSchema, CollaborationCredentialSchema, CollaborationVersionSchema } from './collaboration.ts';

export const CommerceServiceIdSchema = z.string().min(1).max(80);
export const CommerceCurrencySchema = z.literal('CNY');
export const CommerceEngineSchema = z.literal('csv-clean-verify');
export const PaymentModeSchema = z.enum(['disabled', 'sandbox', 'production', 'simulated']);
export const PaymentProviderSchema = z.enum(['free', 'alipay', 'simulated']);
export const PaymentStatusSchema = z.enum(['NOT_REQUIRED', 'UNPAID', 'PENDING', 'VERIFIED', 'FAILED', 'EXPIRED']);
export const CommerceOrderStatusSchema = z.enum([
  'AWAITING_PAYMENT', 'READY', 'IN_PROGRESS', 'DELIVERED', 'ACCEPTED', 'DECLINED', 'FAILED', 'EXPIRED', 'CANCELLED',
]);
export const AcceptanceDecisionSchema = z.enum(['ACCEPTED', 'DECLINED']);

export const ServiceQuoteSchema = z.strictObject({
  serviceId: CommerceServiceIdSchema,
  serviceVersion: CountSchema.min(1),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  priceFen: CountSchema,
  currency: CommerceCurrencySchema,
  engine: CommerceEngineSchema,
  workflowVersion: IdSchema,
  deliveryMinutes: CountSchema.min(1),
  roles: z.array(z.string().min(1).max(100)).length(3),
});
export const CommerceServiceSchema = ServiceQuoteSchema.extend({ active: z.boolean() });
export const CommerceServicesResponseSchema = z.strictObject({
  services: z.array(CommerceServiceSchema),
  paymentMode: PaymentModeSchema,
  officialPayment: z.boolean(),
});
export const CommerceServiceQuerySchema = z.strictObject({
  serviceId: CommerceServiceIdSchema,
  expectedServiceVersion: CountSchema.min(1),
});

export const CreateOrderRequestSchema = z.strictObject({
  serviceId: CommerceServiceIdSchema,
  expectedServiceVersion: CountSchema.min(1),
  idempotencyKey: z.string().min(8).max(128),
  inputCsv: z.string().min(1).max(2_000_000),
  maxAmountFen: CountSchema.optional(),
});

export const PaymentSummarySchema = z.strictObject({
  paymentId: CollaborationIdSchema.nullable(),
  mode: PaymentModeSchema,
  provider: PaymentProviderSchema.nullable(),
  status: PaymentStatusSchema,
  amountFen: CountSchema,
  currency: CommerceCurrencySchema,
  payable: z.boolean(),
  expiresAt: TimestampSchema.nullable(),
  verifiedAt: TimestampSchema.nullable(),
  providerTradeNo: z.string().max(128).nullable(),
});

export const ExecutionSummarySchema = z.strictObject({
  taskId: CollaborationIdSchema.nullable(),
  workflowVersion: IdSchema.nullable(),
  status: z.enum(['NOT_STARTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']),
  steps: z.array(z.strictObject({
    role: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'FAILED']),
    agentId: CollaborationIdSchema.nullable(),
    attempt: CountSchema.nullable(),
  })),
  failure: z.strictObject({ code: IdSchema, message: z.string().max(2000) }).nullable(),
});

export const DeliveryEvidenceSchema = z.strictObject({
  role: z.string().min(1),
  agentId: CollaborationIdSchema,
  claimId: CollaborationIdSchema,
  handoffId: CollaborationIdSchema,
  contentHash: HashSchema,
});

export const DeliverySchema = z.strictObject({
  deliveryId: CollaborationIdSchema,
  orderId: CollaborationIdSchema,
  version: CountSchema.min(1),
  taskId: CollaborationIdSchema,
  contentHash: HashSchema,
  cleanedCsv: z.string(),
  report: z.record(z.string(), z.unknown()),
  evidence: z.array(DeliveryEvidenceSchema),
  createdAt: TimestampSchema,
});

export const AcceptanceReputationLinkSchema = z.strictObject({
  role: z.string().min(1),
  agentId: CollaborationIdSchema,
  claimId: CollaborationIdSchema,
  outcome: z.enum(['PASS', 'FAIL']).nullable(),
  source: z.enum(['DETERMINISTIC_REVIEW', 'NOT_TRACKED']),
});

export const AcceptanceSchema = z.strictObject({
  acceptanceId: CollaborationIdSchema,
  orderId: CollaborationIdSchema,
  decision: AcceptanceDecisionSchema,
  rating: CountSchema.min(1).max(5).nullable(),
  comment: z.string().max(2000).nullable(),
  reputation: z.array(AcceptanceReputationLinkSchema),
  createdAt: TimestampSchema,
});
export const AcceptanceRequestSchema = z.strictObject({
  decision: AcceptanceDecisionSchema,
  rating: CountSchema.min(1).max(5).nullable().default(null),
  comment: z.string().max(2000).nullable().default(null),
});

export const OrderEventSchema = z.strictObject({
  seq: CountSchema.min(1),
  orderId: CollaborationIdSchema,
  type: IdSchema,
  actor: z.enum(['BUYER', 'SYSTEM', 'PAYMENT']),
  detail: z.record(z.string(), z.unknown()),
  createdAt: TimestampSchema,
});

export const OrderFailureSchema = z.strictObject({
  code: IdSchema,
  message: z.string().max(2000),
  at: TimestampSchema,
});

export const OrderSchema = z.strictObject({
  orderId: CollaborationIdSchema,
  buyerAgentId: CollaborationIdSchema,
  status: CommerceOrderStatusSchema,
  quote: ServiceQuoteSchema,
  payment: PaymentSummarySchema,
  execution: ExecutionSummarySchema,
  taskId: CollaborationIdSchema.nullable(),
  inputHash: HashSchema,
  inputRows: CountSchema.min(1),
  deliveryId: CollaborationIdSchema.nullable(),
  deliveryVersion: CountSchema.min(1).nullable(),
  acceptance: AcceptanceSchema.nullable(),
  failure: OrderFailureSchema.nullable(),
  paidAt: TimestampSchema.nullable(),
  deliveredAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: CollaborationVersionSchema,
});
export const OrderDetailSchema = OrderSchema.extend({ history: z.array(OrderEventSchema).max(100) });
export const OrdersResponseSchema = z.strictObject({ orders: z.array(OrderSchema) });
export const OrderQuerySchema = z.strictObject({ limit: CountSchema.min(1).max(50).default(20) });

export const PrepaySchema = z.strictObject({
  prepayId: z.string().min(1).max(512),
  qrCodeUrl: z.string().min(1).max(4096).nullable(),
  providerTradeNo: z.string().min(1).max(128).nullable(),
  expiresAt: TimestampSchema,
});
export const PaymentRequestResponseSchema = z.strictObject({
  orderId: CollaborationIdSchema,
  mode: PaymentModeSchema,
  official: z.boolean(),
  simulated: z.boolean(),
  amountFen: CountSchema,
  currency: CommerceCurrencySchema,
  status: PaymentStatusSchema,
  prepay: PrepaySchema.nullable(),
  paymentProofHeader: z.literal('Payment-Proof'),
  instruction: z.string().min(1).max(2000),
  simulatedProof: z.string().max(20000).nullable(),
});
export const PaymentProofResponseSchema = z.strictObject({
  orderId: CollaborationIdSchema,
  status: PaymentStatusSchema,
  official: z.boolean(),
  simulated: z.boolean(),
  providerTradeNo: z.string().max(128).nullable(),
  verifiedAt: TimestampSchema.nullable(),
});
export const PaymentProofHeaderSchema = z.string().min(16).max(20000);

export const DeliveryDownloadSchema = z.strictObject({
  orderId: CollaborationIdSchema,
  version: CountSchema.min(1),
  contentHash: HashSchema,
  content: z.string(),
});

const mcpCredential = {
  credential: CollaborationCredentialSchema.optional().describe('买家自己的 Agent 凭证；匿名 MCP 连接可逐次传入。不得写入公开正文。'),
};
export const CommerceToolSchemas = {
  list_service_catalog: z.strictObject({ ...mcpCredential }),
  create_service_order: z.strictObject({ request: CreateOrderRequestSchema, ...mcpCredential }),
  get_service_order: z.strictObject({ orderId: CollaborationIdSchema, ...mcpCredential }),
  list_service_orders: OrderQuerySchema.extend(mcpCredential),
  accept_service_delivery: z.strictObject({ orderId: CollaborationIdSchema, request: AcceptanceRequestSchema, ...mcpCredential }),
  get_service_delivery: z.strictObject({ orderId: CollaborationIdSchema, ...mcpCredential }),
} as const;

export type CommerceService = z.infer<typeof CommerceServiceSchema>;
export type ServiceQuote = z.infer<typeof ServiceQuoteSchema>;
export type PaymentMode = z.infer<typeof PaymentModeSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type CommerceOrderStatus = z.infer<typeof CommerceOrderStatusSchema>;
export type CommerceOrder = z.infer<typeof OrderSchema>;
export type CommerceOrderDetail = z.infer<typeof OrderDetailSchema>;
export type OrderEvent = z.infer<typeof OrderEventSchema>;
export type CommerceDelivery = z.infer<typeof DeliverySchema>;
export type CommerceAcceptance = z.infer<typeof AcceptanceSchema>;
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
export type AcceptanceRequest = z.infer<typeof AcceptanceRequestSchema>;
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;
export type PaymentRequestResponse = z.infer<typeof PaymentRequestResponseSchema>;
export type PaymentProofResponse = z.infer<typeof PaymentProofResponseSchema>;
