import { z } from 'zod';
export const ConfigSchema = z.object({configured:z.boolean(),creationConfigured:z.boolean()});
export const HealthSchema = z.object({status:z.string(),database:z.string(),chain:z.object({configured:z.boolean()}),validator:z.object({configured:z.boolean()})});
export const endpoint = (path:string) => `/api/web?path=${encodeURIComponent(path)}`;
class RequestError extends Error {}
export function userMessage(error:unknown):string {
  if(error instanceof RequestError)return error.message;
  if(error instanceof z.ZodError || error instanceof SyntaxError)return '暂时无法读取分析内容，请稍后重试。';
  if(error instanceof Error && error.name==='TimeoutError')return '等待响应超时，请稍后重试。';
  if(error instanceof TypeError)return '连接中断，请检查网络后重试。';
  if(error instanceof Error && error.message==='请输入另一份分析的编号')return error.message;
  return '暂时无法完成此操作，请稍后重试。';
}
export async function request(path:string, init?:RequestInit) {
  const timeout=AbortSignal.timeout(16000);
  const response = await fetch(path, {...init, signal:init?.signal ? AbortSignal.any([init.signal,timeout]) : timeout});
  if (!response.ok) {
    const messages:Record<number,string> = {
      400:'提交内容有误，请检查后重试。',
      401:'访问授权已失效，请重新输入访问码。',
      403:'暂时没有操作权限，请检查访问码或联系活动负责人。',
      404:'未找到这份记录，请检查编号是否正确。',
      409:'这次提交可能已存在，请先查看上次提交结果。',
      429:'操作较频繁，请稍后再试。',
    };
    throw new RequestError(messages[response.status] ?? '服务暂时不可用，请稍后重试。');
  }
  return response;
}
export async function read<T>(path:string, schema:z.ZodType<T>, signal?:AbortSignal) {
  const response = await request(endpoint(path),{signal});
  return schema.parse(await response.json());
}
