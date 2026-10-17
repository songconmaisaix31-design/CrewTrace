import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function errorBody(error: unknown) {
  if (error instanceof AppError) return { status: error.status, error: { code: error.code, message: error.message } };
  if (error instanceof ZodError) return { status: 400, error: { code: 'INVALID_INPUT', message: error.message } };
  if (error instanceof SyntaxError) return { status: 400, error: { code: 'INVALID_JSON', message: error.message } };
  console.error(error instanceof Error ? error.name : 'UnknownError');
  return { status: 500, error: { code: 'INTERNAL_ERROR', message: '服务操作失败' } };
}

export function requireValue<T>(value: T | undefined | null, code = 'NOT_FOUND'): T {
  if (value === undefined || value === null) throw new AppError(404, code, '请求的记录不存在');
  return value;
}
