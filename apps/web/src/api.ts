import { z } from 'zod';
export const ConfigSchema = z.object({configured:z.boolean(),creationConfigured:z.boolean()});
export const HealthSchema = z.object({status:z.string(),database:z.string(),chain:z.object({configured:z.boolean(),writable:z.boolean(),code:z.string().nullable()}),validator:z.object({configured:z.boolean(),code:z.string().nullable()})});
export const endpoint = (path:string) => `/api/web?path=${encodeURIComponent(path)}`;
export class RequestError extends Error { constructor(message:string,readonly status:number,readonly code?:string){super(message);} }
export function userMessage(error:unknown):string {
  if(error instanceof RequestError)return error.message;
  if(error instanceof z.ZodError || error instanceof SyntaxError)return '暂时无法读取分析内容，请稍后重试。';
  if(error instanceof Error && error.name==='TimeoutError')return '等待响应超时，请稍后重试。';
  if(error instanceof TypeError)return '连接中断，请检查网络后重试。';
  if(error instanceof Error && error.message==='请输入另一份分析的编号')return error.message;
  return '暂时无法完成此操作，请稍后重试。';
}
export async function request(path:string, init?:RequestInit) {
  const response = await fetch(path, {...init, signal:init?.signal ?? AbortSignal.timeout(45000)});
  if (!response.ok) {
    const errorBody = z.object({error:z.object({code:z.string().optional()})}).safeParse(await response.json());
    const code = errorBody.success ? errorBody.data.error.code : undefined;
    const reasons:Record<string,string> = {
      CHAIN_NOT_CONFIGURED:'记录验证暂不可用，本次分析尚不能继续执行。',
      VALIDATOR_NOT_CONFIGURED:'结果检查暂不可用，本次分析尚不能完成验收。',
      ARTIFACT_MISMATCH:'输入或成果的校验值与服务记录不一致，请联系活动负责人。',
      CRITERIA_UNAVAILABLE:'暂时无法读取验收规则，请稍后重试。',
      DATABASE_UNAVAILABLE:'分析服务的数据库暂时无法访问，请稍后重试。',
      BUDGET_EXCEEDED:'当前分析名额已用完，请等待已有任务结束。',
      INVALID_STATE:'当前记录状态不支持此操作，请先查询原分析编号。',
      NOT_CONFIGURED:'任务服务尚未配置。',
    };
    const messages:Record<number,string> = {
      400:'提交内容有误，请检查后重试。',
      401:'访问授权已失效，请重新输入访问码。',
      403:'暂时没有操作权限，请检查访问码或联系活动负责人。',
      404:'未找到这份记录，请检查编号是否正确。',
      409:'这次提交可能已存在，请先查看上次提交结果。',
      429:'操作较频繁，请稍后再试。',
    };
    throw new RequestError((code&&reasons[code]) || messages[response.status] || '服务暂时不可用，请稍后重试。',response.status,code);
  }
  return response;
}
export async function read<T>(path:string, schema:z.ZodType<T>, signal?:AbortSignal) {
  const response = await request(endpoint(path),{signal});
  return schema.parse(await response.json());
}
