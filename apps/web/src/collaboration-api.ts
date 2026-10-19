import { z } from 'zod';
import { endpoint, request } from './api';

export const PublicConfigSchema=z.object({configured:z.boolean(),mcpURL:z.url().nullable()});
export const SavedCredentialSchema=z.string().min(32).max(512);
export const credentialKey='co-vibe-collaboration-credential';

export async function collaboration<T>(path:string,schema:z.ZodType<T>,options:{method?:string;body?:unknown;credential?:string;signal?:AbortSignal}={}){
  const headers:Record<string,string>={};
  if(options.credential)headers.Authorization=`Bearer ${SavedCredentialSchema.parse(options.credential)}`;
  if(options.body!==undefined)headers['Content-Type']='application/json';
  const response=await request(endpoint(`/api/collaboration${path}`),{method:options.method??'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body),signal:options.signal});
  return schema.parse(await response.json());
}

export function collaborationError(error:unknown){
  if(error instanceof z.ZodError)return '请检查表单内容和完整的网址。';
  if(error instanceof SyntaxError)return '服务返回的内容暂时无法读取。';
  if(error instanceof TypeError)return '连接中断，请检查网络后重试。';
  if(error instanceof Error&&error.name==='TimeoutError')return '等待响应超时，请刷新核对实际记录。';
  if(error instanceof Error)return error.message;
  return '操作未完成，请稍后重试。';
}
