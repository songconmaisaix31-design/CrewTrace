import { z } from "zod";
import {
  AddressSchema, AttemptSchema, BlockNumberSchema, HashSchema, RoleSchema, UriSchema,
  type Address, type AgentProfile, type ChainReceipt, type Hash, type Role, type RoleReputation, type SubmissionReceipt, type Task,
} from "./schemas.ts";

export const SnapshotReadSchema = z.strictObject({ chainId: z.number().int().positive(), blockNumber: BlockNumberSchema });
export const AgentRegistrationSchema = z.strictObject({ agentId: AddressSchema, roles: z.array(RoleSchema).min(1), manifestURI: UriSchema, manifestHash: HashSchema });
export const TaskAssignmentSchema = z.strictObject({ taskId: HashSchema, attempt: AttemptSchema, role: RoleSchema, assignee: AddressSchema, validator: AddressSchema, inputHash: HashSchema, criteriaHash: HashSchema });
export const ArtifactSubmissionSchema = z.strictObject({ taskId: HashSchema, attempt: AttemptSchema, artifactHash: HashSchema, artifactURI: UriSchema });
export const OutcomeSubmissionSchema = z.strictObject({ taskId: HashSchema, attempt: AttemptSchema, verdict: z.enum(["PASS", "FAIL"]), artifactHash: HashSchema, criteriaHash: HashSchema, evidenceHash: HashSchema, evidenceURI: UriSchema, validator: AddressSchema });
export const ChainTaskSchema = TaskAssignmentSchema.extend({ status: z.enum(["ASSIGNED", "SUBMITTED", "VERIFIED_PASS", "VERIFIED_FAIL"]), artifactHash: HashSchema.nullable() });

export type SnapshotRead = z.infer<typeof SnapshotReadSchema>;
export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;
export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;
export type ArtifactSubmission = z.infer<typeof ArtifactSubmissionSchema>;
export type OutcomeSubmission = z.infer<typeof OutcomeSubmissionSchema>;
export type ChainTask = z.infer<typeof ChainTaskSchema>;
export interface ChainPort {
  registerAgent(input: AgentRegistration): Promise<ChainReceipt>;
  assignTask(input: TaskAssignment): Promise<ChainReceipt>;
  submitArtifact(input: ArtifactSubmission): Promise<SubmissionReceipt>;
  recordOutcome(input: OutcomeSubmission): Promise<ChainReceipt>;
  getRoleReputation(input: SnapshotRead & { agentId: Address; role: Role }): Promise<RoleReputation>;
  getTask(input: SnapshotRead & { taskId: Hash }): Promise<ChainTask | null>;
  getReceipts(input: { taskId: Hash; attempt: number; snapshot?: SnapshotRead }): Promise<ChainReceipt[]>;
  getSnapshot?(): Promise<SnapshotRead>;
}
export interface AgentDirectoryPort {
  getAgent(agentId: Address): Promise<AgentProfile | null>;
}
export interface TaskDirectoryPort {
  getTask(taskId: Hash): Promise<Task | null>;
}
