import { z } from 'zod';
import { AppError } from './errors.js';
export const RegisterSchema=z.strictObject({name:z.string().trim().min(2).max(40),bio:z.string().trim().max(500).default('')});
export const ServiceSchema=z.strictObject({title:z.string().trim().min(2).max(32),description:z.string().trim().min(20).max(3000),category:z.enum(['数据分析','研究检索','代码审查','内容创作','其他']),priceFen:z.number().int().min(0).max(5000),deliveryHours:z.number().int().min(1).max(168)});
export const OrderSchema=z.strictObject({serviceId:z.string().min(1).max(80),input:z.string().min(5).max(100000).refine(value=>value.trim().length>=5),idempotencyKey:z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),expectedVersion:z.number().int().positive(),maxAmountFen:z.number().int().min(0).max(5000)});
export const DeliverySchema=z.strictObject({content:z.string().trim().min(20).max(200000)});
export const ReviewSchema=z.strictObject({decision:z.enum(['accept','revise','dispute']),deliveryVersion:z.number().int().positive(),rating:z.number().int().min(1).max(5).optional(),comment:z.string().trim().min(5).max(2000)});
export const BindingSchema=z.strictObject({serviceId:z.string().min(1).max(32),resourceId:z.string().min(1).max(32)});
export const money=(fen:number)=>(fen/100).toFixed(2);
export function amountFen(value:unknown):number{
  if(typeof value!=='string'||!/^\d{1,5}(\.\d{1,2})?$/.test(value))throw new AppError(502,'PAYMENT_AMOUNT_INVALID','支付宝金额格式异常');
  const [yuan,cents='']=value.split('.');return Number(yuan)*100+Number(cents.padEnd(2,'0'));
}
export const ProofSchema=z.object({protocol:z.object({payment_proof:z.string().length(64),trade_no:z.string().min(1).max(32)}),method:z.object({client_session:z.string().min(1).max(1024)})});
export function decodeProof(header:string){
  if(header.length>8192||!z.base64().safeParse(header).success)throw new AppError(400,'INVALID_PROOF','Payment-Proof 必须为 Base64 JSON');
  return ProofSchema.parse(JSON.parse(Buffer.from(header,'base64').toString('utf8')));
}
export function verifyBinding(result:Record<string,unknown>,order:{id:string;price_fen:number;snapshot:any},tradeNo:string){
  if(result.active!==true || result.trade_no!==tradeNo || result.out_trade_no!==order.id ||
    result.resource_id!==order.snapshot.paymentBinding.resourceId || amountFen(result.amount)!==order.price_fen)
    throw new AppError(402,'PAYMENT_MISMATCH','支付凭证与本订单、服务或金额不匹配');
}
