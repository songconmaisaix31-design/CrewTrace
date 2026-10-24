import {
  AddressSchema, ArtifactSubmissionSchema, ChainReceiptSchema, OutcomeSubmissionSchema,
  SubmissionReceiptSchema, TaskAssignmentSchema,
  type Address, type ArtifactSubmission, type ChainEvent, type ChainReceipt, type Hash,
  type OutcomeSubmission, type Role, type SubmissionReceipt, type TaskAssignment,
} from "../../contracts/src/index.ts";
import { ChainError } from "../../chain/src/index.ts";
import { keccak256, toBytes } from "viem";

export function toChainRunId(runId: string): Hash {
  if (typeof runId !== "string" || runId.length === 0) throw new ChainError("INVALID_ARGUMENT", "runId 不能为空");
  return keccak256(toBytes(runId));
}

export interface ReceiptExpectation { chainId: number; contract: Address }

function equal(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) throw new ChainError("RECEIPT_MISMATCH", `链上事件绑定不一致：${field}`);
}

function eventFor<N extends ChainEvent["eventName"]>(
  receipt: ChainReceipt, expected: ReceiptExpectation, eventName: N, signer: Address,
): Extract<ChainEvent, { eventName: N }> {
  const checked = ChainReceiptSchema.parse(receipt);
  equal(checked.chainId, expected.chainId, "chainId");
  equal(checked.contract, AddressSchema.parse(expected.contract), "contract");
  if (checked.status === "PENDING") throw new ChainError("CHAIN_PENDING", "原交易等待 finalized 确认");
  if (checked.status === "FAILED") throw new ChainError("INVALID_STATE", "原交易已失败");
  equal(checked.signer, AddressSchema.parse(signer), "signer");
  const events = checked.events?.filter(event => event.eventName === eventName);
  if (!events || events.length !== 1) throw new ChainError("RECEIPT_MISMATCH", `回执必须包含唯一 ${eventName} 事件`);
  const event = events[0]!;
  equal(event.txHash, checked.txHash, "event.txHash");
  equal(event.blockNumber, checked.blockNumber, "event.blockNumber");
  equal(event.eventId, `${checked.chainId}:${checked.txHash}:${event.logIndex}`, "eventId");
  return event as Extract<ChainEvent, { eventName: N }>;
}

export function assertAssignmentReceipt(
  receipt: ChainReceipt, input: TaskAssignment & ReceiptExpectation & { coordinator: Address },
): ChainReceipt {
  const { chainId, contract, coordinator, ...assignment } = input;
  const expected = TaskAssignmentSchema.parse(assignment);
  const event = eventFor(receipt, { chainId, contract }, "TaskAssigned", coordinator);
  const { runId, ...fields } = expected;
  equal(event.args.runId, toChainRunId(runId), "runId");
  for (const [field, value] of Object.entries(fields)) equal(event.args[field as keyof typeof event.args], value, field);
  return ChainReceiptSchema.parse(receipt);
}

export function assertSubmissionReceipt(
  receipt: ChainReceipt, input: ArtifactSubmission & ReceiptExpectation & { producer: Address; chainRunId?: Hash },
): SubmissionReceipt {
  const { chainId, contract, producer, chainRunId, ...submission } = input;
  const expected = ArtifactSubmissionSchema.parse(submission);
  const event = eventFor(receipt, { chainId, contract }, "ArtifactSubmitted", producer);
  equal(event.args.producer, AddressSchema.parse(producer), "producer");
  if (chainRunId !== undefined) equal(event.args.runId, chainRunId, "runId");
  for (const [field, value] of Object.entries(expected)) equal(event.args[field as keyof typeof event.args], value, field);
  return SubmissionReceiptSchema.parse({ ...receipt, taskId: expected.taskId, attempt: expected.attempt, artifactHash: expected.artifactHash });
}

export function assertOutcomeReceipt(
  receipt: ChainReceipt,
  input: OutcomeSubmission & ReceiptExpectation & { assignee: Address; role: Role; chainRunId: Hash },
): ChainReceipt {
  const { chainId, contract, assignee, role, chainRunId, ...submission } = input;
  const expected = OutcomeSubmissionSchema.parse(submission);
  const event = eventFor(receipt, { chainId, contract }, "OutcomeRecorded", expected.validator);
  equal(event.args.runId, chainRunId, "runId");
  equal(event.args.assignee, AddressSchema.parse(assignee), "assignee");
  equal(event.args.role, role, "role");
  equal(event.args.passed, expected.verdict === "PASS", "passed");
  const { verdict: _verdict, criteriaHash: _criteriaHash, ...fields } = expected;
  for (const [field, value] of Object.entries(fields)) equal(event.args[field as keyof typeof event.args], value, field);
  return ChainReceiptSchema.parse(receipt);
}
