import { z } from 'zod';
export const ConfigSchema = z.object({configured:z.boolean(),creationConfigured:z.boolean()});
export const HealthSchema = z.object({status:z.string(),database:z.string(),chain:z.object({configured:z.boolean()}),validator:z.object({configured:z.boolean()})});
export const endpoint = (path:string) => `/api/web?path=${encodeURIComponent(path)}`;
export async function request(path:string, init?:RequestInit) {
  const response = await fetch(path, {...init, signal:init?.signal ?? AbortSignal.timeout(16000)});
  if (!response.ok) {
    const content = await response.text();
    let message = `请求失败（${response.status}）`;
    try { const parsed = JSON.parse(content); message = parsed.error?.message ?? message; } catch { /* 非 JSON 网关错误仅显示状态码。 */ }
    throw new Error(message);
  }
  return response;
}
export async function read<T>(path:string, schema:z.ZodType<T>, signal?:AbortSignal) {
  const response = await request(endpoint(path),{signal});
  return schema.parse(await response.json());
}
