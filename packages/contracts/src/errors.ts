import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "WRONG_CHAIN", "UNAUTHORIZED", "STALE_ATTEMPT", "DUPLICATE_OUTCOME", "ARTIFACT_MISMATCH", "CHAIN_PENDING",
  "CHAIN_NOT_CONFIGURED", "CHAIN_DATA_MISSING", "INVALID_STATE", "INVALID_INPUT", "NOT_FOUND",
  "VERSION_CONFLICT", "DEPENDENCY_NOT_READY", "BUDGET_EXCEEDED", "NO_ELIGIBLE_AGENT",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ApplicationErrorSchema = z.strictObject({ code: ErrorCodeSchema, message: z.string().min(1), details: z.record(z.string(), z.unknown()) });
const statuses: Record<ErrorCode, number> = {
  WRONG_CHAIN: 409, UNAUTHORIZED: 403, STALE_ATTEMPT: 409, DUPLICATE_OUTCOME: 409, ARTIFACT_MISMATCH: 409,
  CHAIN_PENDING: 409, CHAIN_NOT_CONFIGURED: 503, CHAIN_DATA_MISSING: 503, INVALID_STATE: 409,
  INVALID_INPUT: 400, NOT_FOUND: 404, VERSION_CONFLICT: 409, DEPENDENCY_NOT_READY: 409,
  BUDGET_EXCEEDED: 429, NO_ELIGIBLE_AGENT: 409,
};
export class ApplicationError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApplicationError";
    this.status = statuses[code];
  }
  toJSON(): z.infer<typeof ApplicationErrorSchema> {
    return { code: this.code, message: this.message, details: this.details };
  }
}
