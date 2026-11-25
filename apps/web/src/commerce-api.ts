import { z } from 'zod';
import { endpoint, request, RequestError } from './api';

export async function commerce<T>(path: string, schema: z.ZodType<T>, options: { method?: string; body?: unknown; credential?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.credential) headers.Authorization = `Bearer ${options.credential}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await request(endpoint(`/api/commerce${path}`), {
    method: options.method ?? 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
  });
  return schema.parse(await response.json());
}

export function commerceError(error: unknown) {
  if (error instanceof z.ZodError) return '订单数据格式不符合预期，请刷新后重试。';
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error && error.name === 'TimeoutError') return '等待响应超时，请刷新核对订单状态。';
  if (error instanceof Error) return error.message;
  return '订单操作未完成，请稍后重试。';
}
