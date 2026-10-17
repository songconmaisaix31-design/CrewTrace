import { keccak256 } from "viem";
import { requireValue } from "./errors.ts";

export function contentHash(bytes: Uint8Array): `0x${string}` {
  return keccak256(bytes);
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function exact(actual: unknown, expected: unknown, message: string): void {
  requireValue(JSON.stringify(actual) === JSON.stringify(expected), "ARTIFACT_MISMATCH", message);
}
