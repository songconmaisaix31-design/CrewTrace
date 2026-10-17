import { z } from "zod";

export const RoleSchema = z.enum(["DATA", "ANALYSIS", "REPORT"]);
export const TaskStatusSchema = z.enum(["OPEN", "ASSIGNED", "RUNNING", "SUBMITTED", "VERIFIED_PASS", "VERIFIED_FAIL"]);
export const TransactionStatusSchema = z.enum(["PENDING", "CONFIRMED", "FAILED"]);
export const HandoffStatusSchema = z.enum(["PENDING", "ACCEPTED", "RETURNED"]);
export const VerdictSchema = z.enum(["PASS", "FAIL", "UNRESOLVED"]);
export const RunModeSchema = z.enum(["LIVE", "REPLAY"]);
export const RunStatusSchema = z.enum(["OPEN", "RUNNING", "VERIFIED_PASS", "VERIFIED_FAIL"]);
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value.toLowerCase() as `0x${string}`);
export const HashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase() as `0x${string}`);
export const IdSchema = z.string().min(1).max(200);
export const TimestampSchema = z.iso.datetime({ offset: true });
export const BlockNumberSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const AttemptSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const UriSchema = z.string().min(1).max(2048);
export const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const AgentProfileSchema = z.strictObject({
  agentId: AddressSchema,
  roles: z.array(RoleSchema).min(1),
  manifestURI: UriSchema,
  manifestHash: HashSchema,
  runtimeId: IdSchema,
  lastSeenAt: TimestampSchema.nullable(),
  activeTasks: CountSchema,
  maxConcurrency: CountSchema.min(1),
  admitted: z.boolean(),
  conditionsAccepted: z.boolean(),
});

const receiptFields = {
  chainId: z.number().int().positive(),
  contract: AddressSchema,
  txHash: HashSchema,
  blockNumber: BlockNumberSchema.nullable(),
  status: TransactionStatusSchema,
  signer: AddressSchema,
};
function validReceipt(value: { status: string; blockNumber: string | null }): boolean {
  return value.status === "CONFIRMED" ? value.blockNumber !== null : true;
}
export const ChainReceiptSchema = z.strictObject(receiptFields).refine(validReceipt, "已确认交易必须包含区块号");
export const SubmissionReceiptSchema = z.strictObject({
  ...receiptFields,
  taskId: HashSchema,
  attempt: AttemptSchema,
  artifactHash: HashSchema,
}).refine(validReceipt, "已确认交易必须包含区块号");

export const TaskSchema = z.strictObject({
  runId: IdSchema,
  taskId: HashSchema,
  role: RoleSchema,
  dependsOn: z.array(HashSchema),
  attempt: AttemptSchema,
  assignee: AddressSchema.nullable(),
  inputHash: HashSchema,
  criteriaHash: HashSchema,
  status: TaskStatusSchema,
  validator: AddressSchema,
}).refine(task => task.status === "OPEN" ? task.assignee === null : task.assignee !== null, "任务状态与 assignee 不一致");
export const RunSchema = z.strictObject({
  runId: IdSchema,
  templateVersion: z.literal("csv-analysis-v1"),
  mode: RunModeSchema,
  inputHash: HashSchema,
  criteriaHash: HashSchema,
  validator: AddressSchema,
  status: RunStatusSchema,
  tasks: z.array(TaskSchema).length(3),
  createdAt: TimestampSchema,
});

export const ExclusionReasonSchema = z.enum(["ROLE_MISMATCH", "HEARTBEAT_MISSING", "HEARTBEAT_EXPIRED", "HEARTBEAT_IN_FUTURE", "BUSY", "NOT_ADMITTED", "CONDITIONS_NOT_ACCEPTED"]);
export const RoleReputationSchema = z.strictObject({
  agentId: AddressSchema,
  role: RoleSchema,
  passCount: CountSchema,
  failCount: CountSchema,
  blockNumber: BlockNumberSchema,
  confirmed: z.literal(true),
});
export const CandidateScoreSchema = z.strictObject({
  agentId: AddressSchema,
  role: RoleSchema,
  passCount: CountSchema,
  failCount: CountSchema,
  sampleSize: CountSchema,
  reputation: z.number().min(0).max(1),
  availability: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
  activeTasks: CountSchema,
  maxConcurrency: CountSchema.min(1),
});
export const ExcludedCandidateSchema = z.strictObject({ agentId: AddressSchema, reasons: z.array(ExclusionReasonSchema).min(1) });
export const DecisionInputSchema = z.strictObject({
  decisionId: IdSchema,
  taskId: HashSchema,
  attempt: AttemptSchema,
  role: RoleSchema,
  policyVersion: z.literal("role-rep-v1"),
  repBlockNumber: BlockNumberSchema,
  evaluatedAt: TimestampSchema,
  agents: z.array(AgentProfileSchema),
  reputations: z.array(RoleReputationSchema),
});
export const AssignmentDecisionSchema = z.strictObject({
  decisionId: IdSchema,
  taskId: HashSchema,
  attempt: AttemptSchema,
  role: RoleSchema,
  policyVersion: z.literal("role-rep-v1"),
  repBlockNumber: BlockNumberSchema,
  evaluatedAt: TimestampSchema,
  agents: z.array(AgentProfileSchema),
  reputations: z.array(RoleReputationSchema),
  candidateScores: z.array(CandidateScoreSchema),
  excludedReasons: z.array(ExcludedCandidateSchema),
  selectedAgentId: AddressSchema.nullable(),
  selectionReason: z.string().min(1),
  decisionHash: HashSchema,
});

export const ArtifactSchema = z.strictObject({
  artifactId: IdSchema,
  taskId: HashSchema,
  attempt: AttemptSchema,
  parentArtifactIds: z.array(IdSchema),
  URI: UriSchema,
  contentHash: HashSchema,
  schemaVersion: IdSchema,
  producer: AddressSchema,
  limitations: z.array(z.string().min(1)),
});
export const HandoffSchema = z.strictObject({
  handoffId: IdSchema,
  runId: IdSchema,
  artifactId: IdSchema,
  fromTaskId: HashSchema,
  toTaskId: HashSchema,
  status: HandoffStatusSchema,
  reason: z.string().min(1),
  contentHash: HashSchema,
  schemaVersion: IdSchema,
  createdAt: TimestampSchema,
});
export const AssessmentCheckSchema = z.strictObject({
  checkId: IdSchema,
  passed: z.boolean(),
  message: z.string().min(1),
});
export const AssessmentSchema = z.strictObject({
  taskId: HashSchema,
  attempt: AttemptSchema,
  verdict: VerdictSchema,
  checks: z.array(AssessmentCheckSchema),
  evidenceURI: UriSchema,
  evidenceHash: HashSchema,
  validator: AddressSchema,
  receipt: ChainReceiptSchema.nullable(),
});
export const QualityRecordSchema = z.strictObject({
  taskId: HashSchema,
  attempt: AttemptSchema,
  assignee: AddressSchema,
  role: RoleSchema,
  criteriaHash: HashSchema,
  artifactHash: HashSchema,
  verdict: z.enum(["PASS", "FAIL"]),
  evidenceURI: UriSchema,
  evidenceHash: HashSchema,
  validator: AddressSchema,
  receipt: ChainReceiptSchema.refine(receipt => receipt.status === "CONFIRMED", "质量记录需要已确认回执"),
});
export const OutcomeRecordSchema = QualityRecordSchema.extend({
  verdict: VerdictSchema,
  receipt: ChainReceiptSchema.nullable(),
  cancelled: z.boolean().optional(),
});
export const RuntimeEventSchema = z.strictObject({
  eventId: IdSchema,
  seq: CountSchema.min(1),
  runId: IdSchema,
  taskId: HashSchema.nullable(),
  attempt: AttemptSchema.nullable(),
  type: IdSchema,
  createdAt: TimestampSchema,
  receipt: ChainReceiptSchema.nullable(),
  data: z.record(z.string(), z.unknown()),
});

const communicationFields = {
  runId: IdSchema,
  taskId: HashSchema,
  body: z.string().min(1).max(20000),
};
export const AnnouncementCreateSchema = z.strictObject({
  ...communicationFields,
  topic: z.string().min(1).max(200),
  type: z.enum(["PROGRESS", "HANDOFF", "BLOCKER", "RESULT"]),
});
export const AnnouncementSchema = AnnouncementCreateSchema.extend({
  announcementId: IdSchema,
  author: AddressSchema,
  createdAt: TimestampSchema,
});
export const NoteCreateSchema = z.strictObject({
  ...communicationFields,
  topic: z.string().min(1).max(200),
  artifactIds: z.array(IdSchema),
});
export const NoteUpdateSchema = z.strictObject({
  expectedVersion: CountSchema.min(1),
  body: z.string().min(1).max(20000),
  topic: z.string().min(1).max(200),
  artifactIds: z.array(IdSchema),
});
export const AgentNoteSchema = NoteCreateSchema.extend({
  noteId: IdSchema,
  author: AddressSchema,
  version: CountSchema.min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const AuthenticatedAgentSchema = z.strictObject({
  agentId: AddressSchema,
  runtimeId: IdSchema,
  credentialId: IdSchema,
  registered: z.literal(true),
  authenticated: z.literal(true),
});

export const HeartbeatRequestSchema = z.strictObject({ runtimeId: IdSchema, activeTasks: CountSchema, maxConcurrency: CountSchema.min(1) });
export const CreateRunRequestSchema = z.strictObject({ runId: IdSchema, inputHash: HashSchema, criteriaHash: HashSchema, validator: AddressSchema, inputContent: z.string().min(1).optional() });
export const CreateRunWithInputRequestSchema = CreateRunRequestSchema.extend({ inputContent: z.string().min(1) });
export const NodeEnrollmentRequestSchema = z.strictObject({ profile: AgentProfileSchema, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });
export const AssignTaskRequestSchema = z.strictObject({ chainId: z.number().int().positive(), blockNumber: BlockNumberSchema.optional() });
export const ModelCallRequestSchema = z.strictObject({ attempt: AttemptSchema });
export const InterruptRequestSchema = z.strictObject({ attempt: AttemptSchema, reason: z.string().min(1) });
export const HandoffUpdateRequestSchema = z.strictObject({ status: HandoffStatusSchema, reason: z.string().min(1) });
export const AcceptTaskRequestSchema = z.strictObject({ attempt: AttemptSchema });
export const SubmitTaskRequestSchema = z.strictObject({ attempt: AttemptSchema, artifactId: IdSchema, receipt: SubmissionReceiptSchema });
export const ArtifactUploadRequestSchema = z.strictObject({
  taskId: HashSchema,
  attempt: AttemptSchema,
  artifactId: IdSchema,
  parentArtifactIds: z.array(IdSchema),
  schemaVersion: IdSchema,
  limitations: z.array(z.string().min(1)),
  content: z.string(),
  contentHash: HashSchema,
});

export const RuntimeStatusSchema = z.enum(["ACTIVE", "PAUSED", "CANCELLED", "WAITING_MANUAL", "INTERRUPTED"]);
export const TaskRuntimeSchema = z.strictObject({ taskId: HashSchema, status: RuntimeStatusSchema, reason: z.string().nullable() });
export const RunDetailSchema = RunSchema.extend({
  runtimeStatus: RuntimeStatusSchema,
  taskRuntime: z.array(TaskRuntimeSchema),
  inputURI: UriSchema,
  artifacts: z.array(ArtifactSchema),
  assessments: z.array(AssessmentSchema),
  handoffs: z.array(HandoffSchema),
  decisions: z.array(AssignmentDecisionSchema),
});
export const WorkerJobSchema = z.strictObject({ task: TaskSchema, runtimeStatus: RuntimeStatusSchema, reason: z.string().nullable(), run: RunDetailSchema });
export const WorkerJobsResponseSchema = z.strictObject({ jobs: z.array(WorkerJobSchema) });
export const AgentsResponseSchema = z.strictObject({ agents: z.array(AgentProfileSchema) });
export const EventsResponseSchema = z.strictObject({ events: z.array(RuntimeEventSchema), nextAfter: CountSchema });
export const AnnouncementsResponseSchema = z.strictObject({ announcements: z.array(AnnouncementSchema) });
export const NotesResponseSchema = z.strictObject({ notes: z.array(AgentNoteSchema) });
export const ModelCallReservationSchema = z.strictObject({ callId: IdSchema, modelCalls: CountSchema.min(1).max(6), stepCalls: CountSchema.min(1).max(2) });

export type Role = z.infer<typeof RoleSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type RunMode = z.infer<typeof RunModeSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type Hash = z.infer<typeof HashSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type ChainReceipt = z.infer<typeof ChainReceiptSchema>;
export type SubmissionReceipt = z.infer<typeof SubmissionReceiptSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Run = z.infer<typeof RunSchema>;
export type ExclusionReason = z.infer<typeof ExclusionReasonSchema>;
export type RoleReputation = z.infer<typeof RoleReputationSchema>;
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;
export type ExcludedCandidate = z.infer<typeof ExcludedCandidateSchema>;
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
export type AssignmentDecision = z.infer<typeof AssignmentDecisionSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
export type AssessmentCheck = z.infer<typeof AssessmentCheckSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
export type QualityRecord = z.infer<typeof QualityRecordSchema>;
export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type AnnouncementCreate = z.infer<typeof AnnouncementCreateSchema>;
export type Announcement = z.infer<typeof AnnouncementSchema>;
export type NoteCreate = z.infer<typeof NoteCreateSchema>;
export type NoteUpdate = z.infer<typeof NoteUpdateSchema>;
export type AgentNote = z.infer<typeof AgentNoteSchema>;
export type AuthenticatedAgent = z.infer<typeof AuthenticatedAgentSchema>;
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type CreateRunWithInputRequest = z.infer<typeof CreateRunWithInputRequestSchema>;
export type NodeEnrollmentRequest = z.infer<typeof NodeEnrollmentRequestSchema>;
export type AssignTaskRequest = z.infer<typeof AssignTaskRequestSchema>;
export type ModelCallRequest = z.infer<typeof ModelCallRequestSchema>;
export type InterruptRequest = z.infer<typeof InterruptRequestSchema>;
export type HandoffUpdateRequest = z.infer<typeof HandoffUpdateRequestSchema>;
export type AcceptTaskRequest = z.infer<typeof AcceptTaskRequestSchema>;
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;
export type ArtifactUploadRequest = z.infer<typeof ArtifactUploadRequestSchema>;
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
export type TaskRuntime = z.infer<typeof TaskRuntimeSchema>;
export type RunDetail = z.infer<typeof RunDetailSchema>;
export type WorkerJob = z.infer<typeof WorkerJobSchema>;
export type WorkerJobsResponse = z.infer<typeof WorkerJobsResponseSchema>;
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;
export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export type AnnouncementsResponse = z.infer<typeof AnnouncementsResponseSchema>;
export type NotesResponse = z.infer<typeof NotesResponseSchema>;
export type ModelCallReservation = z.infer<typeof ModelCallReservationSchema>;
