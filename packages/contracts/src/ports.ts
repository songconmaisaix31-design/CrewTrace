import type { Address, AgentProfile, ChainReceipt, Hash, Role, RoleReputation, SubmissionReceipt, Task } from "./schemas.ts";

export interface SnapshotRead {
  chainId: number;
  blockNumber: string;
}
export interface AgentRegistration {
  agentId: Address;
  roles: Role[];
  manifestURI: string;
  manifestHash: Hash;
}
export interface TaskAssignment {
  taskId: Hash;
  attempt: number;
  role: Role;
  assignee: Address;
  validator: Address;
  inputHash: Hash;
  criteriaHash: Hash;
}
export interface ArtifactSubmission {
  taskId: Hash;
  attempt: number;
  artifactHash: Hash;
  artifactURI: string;
}
export interface OutcomeSubmission {
  taskId: Hash;
  attempt: number;
  verdict: "PASS" | "FAIL";
  artifactHash: Hash;
  criteriaHash: Hash;
  evidenceHash: Hash;
  evidenceURI: string;
  validator: Address;
}
export interface ChainTask extends TaskAssignment {
  status: "ASSIGNED" | "SUBMITTED" | "VERIFIED_PASS" | "VERIFIED_FAIL";
  artifactHash: Hash | null;
}
export interface ChainPort {
  registerAgent(input: AgentRegistration): Promise<ChainReceipt>;
  assignTask(input: TaskAssignment): Promise<ChainReceipt>;
  submitArtifact(input: ArtifactSubmission): Promise<SubmissionReceipt>;
  recordOutcome(input: OutcomeSubmission): Promise<ChainReceipt>;
  getRoleReputation(input: SnapshotRead & { agentId: Address; role: Role }): Promise<RoleReputation>;
  getTask(input: SnapshotRead & { taskId: Hash }): Promise<ChainTask | null>;
  getReceipts(input: { taskId: Hash; attempt: number; snapshot?: SnapshotRead }): Promise<ChainReceipt[]>;
}
export interface AgentDirectoryPort {
  getAgent(agentId: Address): Promise<AgentProfile | null>;
}
export interface TaskDirectoryPort {
  getTask(taskId: Hash): Promise<Task | null>;
}
