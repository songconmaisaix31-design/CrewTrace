import { ZodError } from 'zod';
import { ApplicationError } from '../../../packages/contracts/src/index.ts';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function errorBody(error: unknown) {
  if (error instanceof ApplicationError) return { status: error.status, error: error.toJSON() };
  if (error instanceof AppError) return { status: error.status, error: { code: error.code, message: error.message } };
  if (error instanceof ZodError) return { status: 400, error: { code: 'INVALID_INPUT', message: error.message } };
  if (error instanceof SyntaxError) return { status: 400, error: { code: 'INVALID_JSON', message: error.message } };
  if (error instanceof Error && (['Connection terminated unexpectedly','Connection terminated due to connection timeout','timeout exceeded when trying to connect'].includes(error.message) || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND'].includes(String((error as NodeJS.ErrnoException).code)))) {
    return { status: 503,error: { code: 'DATABASE_UNAVAILABLE',message: 'PostgreSQL 连接不可用，操作已失败' } };
  }
  console.error(error instanceof Error ? error.name : 'UnknownError');
  return { status: 500, error: { code: 'INTERNAL_ERROR', message: '服务操作失败' } };
}

export function requireValue<T>(value: T | undefined | null, code = 'NOT_FOUND'): T {
  if (value === undefined || value === null) throw new AppError(code==='CHAIN_DATA_MISSING' ? 503 : code==='DEPENDENCY_NOT_READY' ? 409 : 404, code, '请求的记录不存在');
  return value;
}
