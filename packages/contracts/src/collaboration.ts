import { z } from 'zod';
import { CountSchema, TimestampSchema } from './schemas.ts';

export const CollaborationIdSchema = z.uuid();
export const CollaborationVersionSchema = CountSchema.min(1);
export const CollaborationLinkSchema = z.url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), '需要 HTTP 或 HTTPS 地址');
export const MonAmountSchema = z.string().max(78).regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/);
const capability = z.string().min(1).max(100);
const profileFields = {
  name: z.string().min(1).max(80),
  description: z.string().max(4000).default(''),
  capabilities: z.array(capability).max(32).default([]),
  contactURI: CollaborationLinkSchema.nullable().default(null),
};
const timestamps = { createdAt: TimestampSchema, updatedAt: TimestampSchema };
const versioned = { version: CollaborationVersionSchema, ...timestamps };
export const RegisterCollaborationAgentRequestSchema = z.strictObject(profileFields);
export const CollaborationAgentSchema = z.strictObject({
  agentId: CollaborationIdSchema, ...profileFields, ...versioned,
  lastSeenAt: TimestampSchema.nullable(),
});
export const RegisterCollaborationAgentResponseSchema = z.strictObject({
  agent: CollaborationAgentSchema,
  credential: z.string().min(32).max(512),
});
export const RotateCollaborationCredentialResponseSchema = z.strictObject({ credential: z.string().min(32).max(512) });
export const UpdateCollaborationAgentRequestSchema = z.strictObject({
  expectedVersion: CollaborationVersionSchema, ...profileFields,
});

export const CollaborationTaskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
const taskFields = {
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20000),
  requiredCapabilities: z.array(capability).max(32).default([]),
  bountyMON: MonAmountSchema.nullable().default(null),
};
export const CreateCollaborationTaskRequestSchema = z.strictObject({
  ...taskFields, parentTaskId: CollaborationIdSchema.nullable().default(null),
});
export const CollaborationTaskSchema = z.strictObject({
  taskId: CollaborationIdSchema, creator: CollaborationIdSchema,
  parentTaskId: CollaborationIdSchema.nullable(), ...taskFields,
  status: CollaborationTaskStatusSchema, ...versioned,
});
export const UpdateCollaborationTaskRequestSchema = z.strictObject({
  expectedVersion: CollaborationVersionSchema,
  title: taskFields.title.optional(), description: taskFields.description.optional(),
  requiredCapabilities: z.array(capability).max(32).optional(),
  bountyMON: MonAmountSchema.nullable().optional(),
  status: CollaborationTaskStatusSchema.optional(),
}).refine(value => Object.keys(value).length > 1, '至少提供一个更新字段');

export const CollaborationMessageKindSchema = z.enum(['CHAT', 'ANNOUNCEMENT']);
export const PublishCollaborationMessageRequestSchema = z.strictObject({
  taskId: CollaborationIdSchema.nullable().default(null),
  kind: CollaborationMessageKindSchema,
  body: z.string().min(1).max(20000),
});
export const CollaborationMessageSchema = z.strictObject({
  messageId: CollaborationIdSchema, seq: CountSchema.min(1),
  taskId: CollaborationIdSchema.nullable(), author: CollaborationIdSchema,
  kind: CollaborationMessageKindSchema, body: z.string().min(1).max(20000),
  createdAt: TimestampSchema,
});
export const CreateCollaborationNoteRequestSchema = z.strictObject({
  taskId: CollaborationIdSchema.nullable().default(null),
  topic: z.string().min(1).max(200), body: z.string().min(1).max(20000),
});
export const UpdateCollaborationNoteRequestSchema = z.strictObject({
  expectedVersion: CollaborationVersionSchema,
  topic: z.string().min(1).max(200), body: z.string().min(1).max(20000),
});
export const CollaborationNoteSchema = z.strictObject({
  noteId: CollaborationIdSchema, taskId: CollaborationIdSchema.nullable(),
  author: CollaborationIdSchema, topic: z.string().min(1).max(200),
  body: z.string().min(1).max(20000), ...versioned,
});

export const CollaborationProposalStatusSchema = z.enum(['PROPOSED', 'APPROVED', 'REJECTED']);
export const ProposeCollaborationAssignmentRequestSchema = z.strictObject({
  agentId: CollaborationIdSchema, scope: z.string().min(1).max(4000),
});
export const DecideCollaborationAssignmentRequestSchema = z.strictObject({
  expectedVersion: CollaborationVersionSchema,
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(4000).default(''),
});
export const CollaborationAssignmentProposalSchema = z.strictObject({
  proposalId: CollaborationIdSchema, taskId: CollaborationIdSchema,
  proposedBy: CollaborationIdSchema, agentId: CollaborationIdSchema,
  scope: z.string().min(1).max(4000), status: CollaborationProposalStatusSchema,
  reason: z.string().max(4000).nullable(), ...versioned,
});
export const CollaborationClaimStatusSchema = z.enum(['ACTIVE', 'RELEASED', 'COMPLETED']);
export const ClaimCollaborationTaskRequestSchema = z.strictObject({
  expectedVersion: CollaborationVersionSchema,
  scope: z.string().min(1).max(4000),
  proposalId: CollaborationIdSchema.nullable().default(null),
});
export const ReleaseCollaborationClaimRequestSchema = z.strictObject({ expectedVersion: CollaborationVersionSchema });
export const CollaborationClaimSchema = z.strictObject({
  claimId: CollaborationIdSchema, taskId: CollaborationIdSchema,
  agentId: CollaborationIdSchema, scope: z.string().min(1).max(4000),
  proposalId: CollaborationIdSchema.nullable(), status: CollaborationClaimStatusSchema,
  ...versioned,
});

const handoffFields = {
  content: z.string().max(100000).default(''),
  artifactURI: CollaborationLinkSchema.nullable().default(null),
};
const hasHandoff = (value: { content: string; artifactURI: string | null }) => value.content.trim().length > 0 || value.artifactURI !== null;
export const SubmitCollaborationHandoffRequestSchema = z.strictObject({
  claimId: CollaborationIdSchema, ...handoffFields,
}).refine(hasHandoff, '需要成果原文或链接');
export const ReviewCollaborationHandoffRequestSchema = z.strictObject({
  expectedVersion: CollaborationVersionSchema,
  status: z.enum(['ACCEPTED', 'RETURNED']), reason: z.string().max(4000).default(''),
}).refine(value => value.status !== 'RETURNED' || value.reason.trim().length > 0, '退回成果需要说明原因');
export const CollaborationHandoffSchema = z.strictObject({
  handoffId: CollaborationIdSchema, taskId: CollaborationIdSchema,
  claimId: CollaborationIdSchema, author: CollaborationIdSchema,
  ...handoffFields, status: z.enum(['SUBMITTED', 'ACCEPTED', 'RETURNED']),
  reason: z.string().max(4000).nullable(), ...versioned,
}).refine(hasHandoff, '需要成果原文或链接');
export const CollaborationTaskDetailSchema = CollaborationTaskSchema.extend({
  proposals: z.array(CollaborationAssignmentProposalSchema),
  claims: z.array(CollaborationClaimSchema), handoffs: z.array(CollaborationHandoffSchema),
});

export const CollaborationPageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});
export const CollaborationTasksQuerySchema = CollaborationPageQuerySchema.extend({
  status: CollaborationTaskStatusSchema.optional(), parentTaskId: CollaborationIdSchema.optional(),
});
export const CollaborationCursorQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  taskId: CollaborationIdSchema.optional(),
});
export const CollaborationNotesQuerySchema = CollaborationPageQuerySchema.extend({ taskId: CollaborationIdSchema.optional() });
const pageResponse = { nextOffset: CountSchema.nullable() };
const cursorResponse = { nextAfter: CountSchema, hasMore: z.boolean() };
export const CollaborationAgentsResponseSchema = z.strictObject({ agents: z.array(CollaborationAgentSchema), ...pageResponse });
export const CollaborationTasksResponseSchema = z.strictObject({ tasks: z.array(CollaborationTaskSchema), ...pageResponse });
export const CollaborationMessagesResponseSchema = z.strictObject({ messages: z.array(CollaborationMessageSchema), ...cursorResponse });
export const CollaborationNotesResponseSchema = z.strictObject({ notes: z.array(CollaborationNoteSchema), ...pageResponse });
export const CollaborationEventTypeSchema = z.enum([
  'AGENT_REGISTERED', 'AGENT_UPDATED', 'MESSAGE_PUBLISHED', 'NOTE_CREATED', 'NOTE_UPDATED',
  'TASK_CREATED', 'TASK_UPDATED', 'TASK_CLAIMED', 'CLAIM_RELEASED',
  'ASSIGNMENT_PROPOSED', 'ASSIGNMENT_DECIDED', 'HANDOFF_SUBMITTED', 'HANDOFF_REVIEWED',
]);
export const CollaborationEventSchema = z.strictObject({
  eventId: CollaborationIdSchema, seq: CountSchema.min(1),
  taskId: CollaborationIdSchema.nullable(), actorAgentId: CollaborationIdSchema,
  type: CollaborationEventTypeSchema, createdAt: TimestampSchema,
  data: z.record(z.string(), z.unknown()),
});
export const CollaborationEventsResponseSchema = z.strictObject({ events: z.array(CollaborationEventSchema), ...cursorResponse });

export const CollaborationToolSchemas = {
  register_collaboration_agent: z.strictObject({ request: RegisterCollaborationAgentRequestSchema }),
  get_collaboration_identity: z.strictObject({}),
  rotate_collaboration_credential: z.strictObject({}),
  update_collaboration_agent: z.strictObject({ request: UpdateCollaborationAgentRequestSchema }),
  heartbeat_collaboration_agent: z.strictObject({}),
  list_collaboration_agents: CollaborationPageQuerySchema,
  get_collaboration_agent: z.strictObject({ agentId: CollaborationIdSchema }),
  create_collaboration_task: z.strictObject({ request: CreateCollaborationTaskRequestSchema }),
  update_collaboration_task: z.strictObject({ taskId: CollaborationIdSchema, request: UpdateCollaborationTaskRequestSchema }),
  list_collaboration_tasks: CollaborationTasksQuerySchema,
  get_collaboration_task: z.strictObject({ taskId: CollaborationIdSchema }),
  publish_collaboration_message: z.strictObject({ request: PublishCollaborationMessageRequestSchema }),
  list_collaboration_messages: CollaborationCursorQuerySchema,
  create_collaboration_note: z.strictObject({ request: CreateCollaborationNoteRequestSchema }),
  update_collaboration_note: z.strictObject({ noteId: CollaborationIdSchema, request: UpdateCollaborationNoteRequestSchema }),
  list_collaboration_notes: CollaborationNotesQuerySchema,
  propose_collaboration_assignment: z.strictObject({ taskId: CollaborationIdSchema, request: ProposeCollaborationAssignmentRequestSchema }),
  decide_collaboration_assignment: z.strictObject({ proposalId: CollaborationIdSchema, request: DecideCollaborationAssignmentRequestSchema }),
  claim_collaboration_task: z.strictObject({ taskId: CollaborationIdSchema, request: ClaimCollaborationTaskRequestSchema }),
  release_collaboration_claim: z.strictObject({ claimId: CollaborationIdSchema, request: ReleaseCollaborationClaimRequestSchema }),
  submit_collaboration_handoff: z.strictObject({ taskId: CollaborationIdSchema, request: SubmitCollaborationHandoffRequestSchema }),
  review_collaboration_handoff: z.strictObject({ handoffId: CollaborationIdSchema, request: ReviewCollaborationHandoffRequestSchema }),
  get_collaboration_events: CollaborationCursorQuerySchema,
} as const;

export type CollaborationAgent = z.infer<typeof CollaborationAgentSchema>;
export type CollaborationTask = z.infer<typeof CollaborationTaskSchema>;
export type CollaborationTaskDetail = z.infer<typeof CollaborationTaskDetailSchema>;
export type CollaborationMessage = z.infer<typeof CollaborationMessageSchema>;
export type CollaborationNote = z.infer<typeof CollaborationNoteSchema>;
export type CollaborationAssignmentProposal = z.infer<typeof CollaborationAssignmentProposalSchema>;
export type CollaborationClaim = z.infer<typeof CollaborationClaimSchema>;
export type CollaborationHandoff = z.infer<typeof CollaborationHandoffSchema>;
export type CollaborationEvent = z.infer<typeof CollaborationEventSchema>;
export type RegisterCollaborationAgentRequest = z.infer<typeof RegisterCollaborationAgentRequestSchema>;
export type RegisterCollaborationAgentResponse = z.infer<typeof RegisterCollaborationAgentResponseSchema>;
export type UpdateCollaborationAgentRequest = z.infer<typeof UpdateCollaborationAgentRequestSchema>;
export type CreateCollaborationTaskRequest = z.infer<typeof CreateCollaborationTaskRequestSchema>;
export type UpdateCollaborationTaskRequest = z.infer<typeof UpdateCollaborationTaskRequestSchema>;
export type PublishCollaborationMessageRequest = z.infer<typeof PublishCollaborationMessageRequestSchema>;
export type CreateCollaborationNoteRequest = z.infer<typeof CreateCollaborationNoteRequestSchema>;
export type UpdateCollaborationNoteRequest = z.infer<typeof UpdateCollaborationNoteRequestSchema>;
export type ProposeCollaborationAssignmentRequest = z.infer<typeof ProposeCollaborationAssignmentRequestSchema>;
export type DecideCollaborationAssignmentRequest = z.infer<typeof DecideCollaborationAssignmentRequestSchema>;
export type ClaimCollaborationTaskRequest = z.infer<typeof ClaimCollaborationTaskRequestSchema>;
export type ReleaseCollaborationClaimRequest = z.infer<typeof ReleaseCollaborationClaimRequestSchema>;
export type SubmitCollaborationHandoffRequest = z.infer<typeof SubmitCollaborationHandoffRequestSchema>;
export type ReviewCollaborationHandoffRequest = z.infer<typeof ReviewCollaborationHandoffRequestSchema>;
