export type Actor={id:string;name:string;bio:string};
export type Service={id:string;seller_id:string;seller_name:string;title:string;description:string;category:string;price_fen:number;delivery_hours:number;engine:string;published:boolean;version:number;paymentReady:boolean;reviews:number;paid_reviews:number;rating:number|null};
export type Order={id:string;buyer_id:string;seller_id:string;service_id:string;input:string;status:string;payment_status:string;price_fen:number;created_at:string;due_at:string|null;pay_before:string;snapshot:{title:string;description:string;engine:string;paymentMode:string};prepay_id:string|null;qr_code_url:string|null;dispute_reason?:string;latest_delivery?:string};
export type Detail={order:Order;deliveries:{id:string;version:number;content:string;created_at:string}[];events:{seq:string;kind:string;detail:{comment?:string;reason?:string};created_at:string}[]};
export type Health={status:string;paymentMode:string;paymentConfigured:boolean;mcpURL:string};
const base=(import.meta.env.VITE_API_BASE_URL??'').replace(/\/$/,'');
export async function api<T>(path:string,token='',body?:unknown,method?:string,headers?:Record<string,string>):Promise<T>{
  const response=await fetch(`${base}${path}`,{method:method??(body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok&&!(response.status===402&&data.payment))throw new Error(data.error?.message??`服务请求失败 (${response.status})`);
  return data;
}
export const money=(fen:number)=>fen===0?'免费':`¥${(fen/100).toFixed(2)}`;
export const time=(date:string)=>new Date(date).toLocaleString('zh-CN',{hour12:false});
export const status:Record<string,string>={AWAITING_PAYMENT:'等待付款',READY:'等待执行',IN_PROGRESS:'正在交付',DELIVERED:'等待验收',REVISION_REQUESTED:'等待修改',ACCEPTED:'验收完成',DISPUTED:'售后处理中',CANCELLED:'已取消',REFUNDED:'已退款'};
export const eventNames:Record<string,string>={ORDER_CREATED:'确认需求与报价',PAYMENT_REQUESTED:'取得支付宝预下单',PAYMENT_VERIFIED:'支付宝核验付款',WORK_STARTED:'服务开始执行',DELIVERY_SUBMITTED:'提交交付成果',ACCEPTED:'买家验收通过',REVISION_REQUESTED:'买家要求修改',DISPUTED:'提交售后申请',DISPUTE_RESOLVED:'商户记录售后处理',CANCELLED:'取消订单',REFUNDED:'支付宝确认退款'};
