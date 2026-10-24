import { AlipaySdk } from 'alipay-sdk';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { amountFen,decodeProof,money,verifyBinding } from './domain.js';

export class MachinePay {
  private readonly sdk:AlipaySdk|null;
  constructor(readonly config:Config){
    this.sdk=config.PAYMENT_MODE==='disabled'?null:new AlipaySdk({appId:config.ALIPAY_APP_ID!,privateKey:config.ALIPAY_PRIVATE_KEY!.replace(/\\n/g,'\n'),alipayPublicKey:config.ALIPAY_PUBLIC_KEY!.replace(/\\n/g,'\n'),keyType:config.ALIPAY_KEY_TYPE,signType:'RSA2',camelcase:false,timeout:8000,gateway:config.ALIPAY_GATEWAY??(config.PAYMENT_MODE==='production'?'https://openapi.alipay.com/gateway.do':'https://openapi-sandbox.dl.alipaydev.com/gateway.do')});
  }
  assertReady(){if(!this.sdk)throw new AppError(503,'PAYMENT_NOT_CONFIGURED','支付宝支付尚未开通，订单不会扣款');}
  private async call(method:string,bizContent:Record<string,unknown>){
    this.assertReady();
    // Machine Pay 官方目前发布的是 v2 方法名，使用 SDK 的 v2 调用并强制验签。
    const result=await this.sdk!.exec(method,{bizContent},{validateSign:true});
    if(result.code!=='10000')throw new AppError(502,'ALIPAY_REJECTED','支付宝未确认本次请求，请保留订单后重试');
    return result;
  }
  async precreate(order:any){
    const result=await this.call('alipay.aipay.agent.payment.precreate',{out_trade_no:order.id,service_id:order.snapshot.paymentBinding.serviceId,goods_name:order.snapshot.title,amount:money(order.price_fen),currency:'CNY',pay_before:new Date(order.pay_before).toISOString()});
    if(typeof result.amt_pre_pay_id!=='string'||!result.amt_pre_pay_id)throw new AppError(502,'INVALID_PREPAY','支付宝未返回预下单号');
    const qr=typeof result.qr_code_url==='string'&&result.qr_code_url.startsWith('https://')?result.qr_code_url:null;
    return {id:result.amt_pre_pay_id,qr};
  }
  async verify(order:any,header:string){
    const {protocol,method}=decodeProof(header);
    const result=await this.call('alipay.aipay.agent.payment.verify',{trade_no:protocol.trade_no,payment_proof:protocol.payment_proof,client_session:method.client_session});
    verifyBinding(result,order,protocol.trade_no);
    return protocol.trade_no;
  }
  async refund(order:any){
    const result=await this.call('alipay.trade.refund',{out_trade_no:order.id,trade_no:order.trade_no,out_request_no:`R${order.id}`,refund_amount:money(order.price_fen),refund_reason:'CrewTrace 订单售后退款'});
    if(result.trade_no!==order.trade_no || result.out_trade_no!==order.id || amountFen(result.refund_fee)!==order.price_fen)throw new AppError(502,'REFUND_UNCONFIRMED','退款结果尚未核实，请使用同一订单重试');
    if(result.fund_change!=='Y'){
      const query=await this.call('alipay.trade.fastpay.refund.query',{out_trade_no:order.id,trade_no:order.trade_no,out_request_no:`R${order.id}`});
      if(query.refund_status!=='REFUND_SUCCESS'||query.trade_no!==order.trade_no||query.out_trade_no!==order.id||query.out_request_no!==`R${order.id}`||amountFen(query.refund_amount)!==order.price_fen)throw new AppError(502,'REFUND_UNCONFIRMED','退款尚未确认，请等待至少 10 秒后使用同一订单重试');
    }
    return `R${order.id}`;
  }
}
