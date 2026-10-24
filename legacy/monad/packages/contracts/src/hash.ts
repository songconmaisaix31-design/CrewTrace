import { keccak256, toBytes } from "viem";
import { AddressSchema, IdSchema, RoleSchema, type Address, type Hash, type Role } from "./schemas.ts";

export function hashUtf8(content: string | Uint8Array): Hash {
  const bytes = typeof content === "string" ? toBytes(content) : content;
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return keccak256(bytes);
}

export function deriveTaskId(runId: string, role: Role): Hash {
  return hashUtf8(`co-vibe:csv-analysis-v1:${IdSchema.parse(runId)}:${RoleSchema.parse(role)}`);
}

export function nodeBindingMessage(input: { agentId: Address; runtimeId: string }): string {
  return `co-vibe node binding\nagentId:${AddressSchema.parse(input.agentId)}\nruntimeId:${IdSchema.parse(input.runtimeId)}`;
}
