export class WorkerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "WorkerError";
  }
}

export function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new WorkerError(code, message);
}
