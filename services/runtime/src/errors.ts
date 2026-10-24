import { ZodError } from 'zod';
export class AppError extends Error {
  constructor(readonly status:number,readonly code:string,message:string){super(message);}
}
export function required<T>(value:T|null|undefined):T{
  if(value==null)throw new AppError(404,'NOT_FOUND','记录不存在');
  return value;
}
export function errorBody(error:unknown){
  if(error instanceof AppError)return {status:error.status,error:{code:error.code,message:error.message}};
  if(error instanceof ZodError || error instanceof SyntaxError)return {status:400,error:{code:'INVALID_INPUT',message:'请求格式或字段不符合要求'}};
  if(error && typeof error==='object' && 'code' in error && error.code==='23505')return {status:409,error:{code:'CONFLICT',message:'记录已存在，请刷新后重试'}};
  console.error(JSON.stringify({event:'operation_failed',type:error instanceof Error?error.name:'UnknownError'}));
  return {status:503,error:{code:'SERVICE_UNAVAILABLE',message:'操作未完成，请保留订单并重试'}};
}
