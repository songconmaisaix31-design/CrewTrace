import { ZodError } from 'zod';
import { ApplicationError,ErrorCodeSchema } from '../../../packages/contracts/src/index.ts';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error!=='object' || !('code' in error) || typeof error.code!=='string') return null;
  return /^(?:[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)$/.test(error.code) ? error.code : null;
}

export function errorBody(error: unknown) {
  if (error instanceof ApplicationError) return { status: error.status, error: error.toJSON() };
  if (error instanceof AppError) return { status: error.status, error: { code: error.code, message: error.message } };
  if (error instanceof Error && error.name==='ChainError' && 'code' in error) {
    const parsed = ErrorCodeSchema.safeParse(error.code);
    if (parsed.success) {
      const mapped = new ApplicationError(parsed.data,'链操作未完成，请查看对应交易与业务状态');
      return { status: mapped.status,error: mapped.toJSON() };
    }
    if (error.code==='RECEIPT_MISMATCH') return { status: 409,error: { code: 'ARTIFACT_MISMATCH',message: '真实链事件与当前业务内容不一致' } };
    return { status: 503,error: { code: 'CHAIN_OPERATION_FAILED',message: '真实链操作失败，等待人工处理' } };
  }
  if (error instanceof ZodError) return { status: 400, error: { code: 'INVALID_INPUT', message: error.message } };
  if (error instanceof SyntaxError) return { status: 400, error: { code: 'INVALID_JSON', message: '请求 JSON 无效' } };
  const databaseCode = databaseErrorCode(error);
  if (error instanceof Error && (['Connection terminated unexpectedly','Connection terminated due to connection timeout','timeout exceeded when trying to connect'].includes(error.message) || databaseCode && /^(?:08|28|53|57P0[123]$|ECONNRESET$|ECONNREFUSED$|ETIMEDOUT$|ENOTFOUND$)/.test(databaseCode))) {
    console.error(JSON.stringify({ event: 'database_unavailable',code: databaseCode }));
    return { status: 503,error: { code: 'DATABASE_UNAVAILABLE',message: 'PostgreSQL 连接不可用，操作已失败' } };
  }
  console.error(error instanceof Error ? error.name : 'UnknownError');
  return { status: 500, error: { code: 'INTERNAL_ERROR', message: '服务操作失败' } };
}

export function requireValue<T>(value: T | undefined | null, code = 'NOT_FOUND'): T {
  if (value === undefined || value === null) throw new AppError(code==='CHAIN_DATA_MISSING' ? 503 : code==='DEPENDENCY_NOT_READY' ? 409 : 404, code, '请求的记录不存在');
  return value;
}
