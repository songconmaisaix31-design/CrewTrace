import { createHash,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import { Database,type SQL } from './db.js';
import { AppError,required } from './errors.js';
import { BindingSchema,DeliverySchema,OrderSchema,RegisterSchema,ReviewSchema,ServiceSchema,decodeProof } from './domain.js';
import { MachinePay } from './payment.js';
import { inspectCSV } from './csv.js';

export type Actor={id:string;name:string;bio:string};
const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
const id=()=>randomUUID().replaceAll('-','');
const serviceProjection=`s.*,a.name AS seller_name,coalesce(r.reviews,0)::int AS reviews,coalesce(r.paid_reviews,0)::int AS paid_reviews,r.rating`;
const serviceJoin=`FROM ct_services s JOIN ct_actors a ON a.id=s.seller_id LEFT JOIN LATERAL (SELECT count(*) AS reviews,count(*) FILTER(WHERE paid) AS paid_reviews,round(avg(rating),2)::float AS rating FROM ct_reviews WHERE service_id=s.id) r ON true`;
export class Commerce {
  readonly payment:MachinePay;
  constructor(readonly db:Database,readonly config:Config){this.payment=new MachinePay(config);}
  async health(){await this.db.query('SELECT 1');return {status:'ok',database:'connected',paymentMode:this.config.PAYMENT_MODE,paymentConfigured:this.config.PAYMENT_MODE!=='disabled',mcpURL:`${this.config.PUBLIC_BASE_URL}/mcp`};}
  async register(input:unknown){
    const data=RegisterSchema.parse(input),token=randomBytes(32).toString('base64url');
    const actor={id:id(),...data};
    await this.db.query('INSERT INTO ct_actors(id,name,bio,token_hash) VALUES($1,$2,$3,$4)',[actor.id,actor.name,actor.bio,tokenHash(token)]);
    return {actor,credential:token};
  }
  async authenticate(header:string|undefined):Promise<Actor|null>{
    if(!header)return null;
    if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(header))throw new AppError(401,'UNAUTHORIZED','凭证格式无效');
    const actor=(await this.db.query<Actor>('SELECT id,name,bio FROM ct_actors WHERE token_hash=$1',[tokenHash(header.slice(7))])).rows[0];
    if(!actor)throw new AppError(401,'UNAUTHORIZED','凭证无效或已轮换');return actor;
  }
  actor(actor:Actor|null):Actor{if(!actor)throw new AppError(401,'UNAUTHORIZED','请创建身份或接入私密凭证');return actor;}
  admin(header:string|undefined){
    const expected=this.config.ADMIN_TOKEN,actual=header?.replace(/^Bearer /,'');
    if(!expected||!actual||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw new AppError(403,'FORBIDDEN','需要独立管理凭证');
  }
  async rotate(actor:Actor|null){const who=this.actor(actor),token=randomBytes(32).toString('base64url');await this.db.query('UPDATE ct_actors SET token_hash=$2 WHERE id=$1',[who.id,tokenHash(token)]);return {credential:token};}
  async services(query='',category='',mine?:Actor|null){
    if(query.length>100||category.length>40)throw new AppError(400,'INVALID_INPUT','检索条件过长');
    const result=await this.db.query(`SELECT ${serviceProjection} ${serviceJoin} WHERE (s.published OR s.seller_id=$3) AND (s.title ILIKE $1 OR s.description ILIKE $1) AND ($2='' OR s.category=$2) ORDER BY s.created_at DESC,s.id LIMIT 100`,[`%${query}%`,category,mine?.id??null]);
    return {services:result.rows.map(s=>this.publicService(s))};
  }
  publicService(s:any){const {payment_binding,...rest}=s;return {...rest,paymentReady:s.price_fen===0||Boolean(payment_binding?.environment===this.config.PAYMENT_MODE&&this.config.PAYMENT_MODE!=='disabled'),rating:s.rating??null};}
  async publish(actor:Actor|null,input:unknown){
    const who=this.actor(actor),data=ServiceSchema.parse(input);
    const record=(await this.db.query('INSERT INTO ct_services(id,seller_id,title,description,category,price_fen,delivery_hours,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id(),who.id,data.title,data.description,data.category,data.priceFen,data.deliveryHours,data.priceFen===0])).rows[0];
    return this.publicService(record);
  }
  async bind(serviceId:string,input:unknown){
    this.payment.assertReady();const binding={...BindingSchema.parse(input),environment:this.config.PAYMENT_MODE};
    const result=await this.db.query('UPDATE ct_services SET payment_binding=$2,published=true,version=version+1 WHERE id=$1 AND price_fen>0 RETURNING *',[serviceId,binding]);
    return this.publicService(required(result.rows[0]));
  }
  async setPublished(actor:Actor|null,serviceId:string,published:boolean){
    const who=this.actor(actor);
    return this.db.transaction(async db=>{
      const s=required((await db.query('SELECT * FROM ct_services WHERE id=$1 FOR UPDATE',[serviceId])).rows[0]);
      if(s.seller_id!==who.id)throw new AppError(403,'FORBIDDEN','仅服务发布者可以修改上架状态');
      if(published&&s.price_fen>0&&!s.payment_binding)throw new AppError(409,'PAYMENT_BINDING_REQUIRED','收费服务须经商户核对登记价格与资源后上架');
      return this.publicService((await db.query('UPDATE ct_services SET published=$2,version=version+1 WHERE id=$1 RETURNING *',[serviceId,published])).rows[0]);
    });
  }
  private async event(db:SQL,orderId:string,actorId:string|null,kind:string,detail:unknown={}){await db.query('INSERT INTO ct_events(order_id,actor_id,kind,detail) VALUES($1,$2,$3,$4)',[orderId,actorId,kind,detail]);}
  async createOrder(actor:Actor|null,input:unknown){
    const who=this.actor(actor),data=OrderSchema.parse(input);
    return this.db.transaction(async db=>{
      const previous=(await db.query('SELECT * FROM ct_orders WHERE buyer_id=$1 AND idempotency_key=$2',[who.id,data.idempotencyKey])).rows[0];
      if(previous)return this.sameRequest(previous,data);
      const s=required((await db.query('SELECT * FROM ct_services WHERE id=$1 FOR SHARE',[data.serviceId])).rows[0]);
      if(!s.published)throw new AppError(409,'SERVICE_UNAVAILABLE','服务当前未上架');
      if(s.seller_id===who.id)throw new AppError(409,'SELF_PURCHASE','不能购买自己的服务');
      if(s.version!==data.expectedVersion||s.price_fen>data.maxAmountFen)throw new AppError(409,'QUOTE_CHANGED','报价或服务版本已变更，请重新确认');
      if(s.price_fen>0){this.payment.assertReady();if(!s.payment_binding||s.payment_binding.environment!==this.config.PAYMENT_MODE)throw new AppError(409,'PAYMENT_BINDING_REQUIRED','服务尚未绑定本环境的官方登记资源');}
      if(s.engine==='csv')inspectCSV(data.input);
      const snapshot={title:s.title,description:s.description,version:s.version,deliveryHours:s.delivery_hours,engine:s.engine,paymentBinding:s.payment_binding,paymentMode:this.config.PAYMENT_MODE,authorizedMaxFen:data.maxAmountFen};
      const created=await db.query(`INSERT INTO ct_orders(id,buyer_id,seller_id,service_id,idempotency_key,snapshot,input,status,payment_status,price_fen,pay_before,due_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '15 minutes',CASE WHEN $10=0 THEN now()+($11*interval '1 hour') ELSE NULL END)
        ON CONFLICT(buyer_id,idempotency_key) DO NOTHING RETURNING *`,[id(),who.id,s.seller_id,s.id,data.idempotencyKey,snapshot,data.input,s.price_fen===0?'READY':'AWAITING_PAYMENT',s.price_fen===0?'FREE':'UNPAID',s.price_fen,s.delivery_hours]);
      if(!created.rows[0])return this.sameRequest(required((await db.query('SELECT * FROM ct_orders WHERE buyer_id=$1 AND idempotency_key=$2',[who.id,data.idempotencyKey])).rows[0]),data);
      await this.event(db,created.rows[0].id,who.id,'ORDER_CREATED',{priceFen:s.price_fen,serviceVersion:s.version});return created.rows[0];
    });
  }
  private sameRequest(order:any,data:ReturnType<typeof OrderSchema.parse>){
    if(order.service_id!==data.serviceId||order.input!==data.input||order.snapshot.version!==data.expectedVersion||order.snapshot.authorizedMaxFen!==data.maxAmountFen)throw new AppError(409,'IDEMPOTENCY_CONFLICT','同一请求编号对应的需求或报价不同');return order;
  }
  private async order(db:SQL,actor:Actor|null,orderId:string,lock=false){
    const who=this.actor(actor),order=required((await db.query(`SELECT * FROM ct_orders WHERE id=$1${lock?' FOR UPDATE':''}`,[orderId])).rows[0]);
    if(order.buyer_id!==who.id&&order.seller_id!==who.id)throw new AppError(403,'FORBIDDEN','订单仅对买家和服务提供者开放');return order;
  }
  async listOrders(actor:Actor|null){const who=this.actor(actor);return {orders:(await this.db.query('SELECT * FROM ct_orders WHERE buyer_id=$1 OR seller_id=$1 ORDER BY created_at DESC LIMIT 100',[who.id])).rows};}
  async detail(actor:Actor|null,orderId:string){
    return this.db.transaction(async db=>{
      const order=await this.order(db,actor,orderId);
      const deliveries=(await db.query('SELECT * FROM ct_deliveries WHERE order_id=$1 ORDER BY version',[orderId])).rows;
      const events=(await db.query('SELECT * FROM ct_events WHERE order_id=$1 ORDER BY seq',[orderId])).rows;
      return {order,deliveries,events};
    });
  }
  async pay(actor:Actor|null,orderId:string,proof?:string){
    return this.db.transaction(async db=>{
      const order=await this.order(db,actor,orderId,true);
      if(order.buyer_id!==actor!.id)throw new AppError(403,'FORBIDDEN','仅买家可以核验付款');
      if(['CANCELLED','REFUNDED'].includes(order.status))throw new AppError(409,'ORDER_CLOSED','订单已关闭');
      if(order.payment_status==='VERIFIED'||order.payment_status==='FREE')return {paid:true,order};
      if(order.snapshot.paymentMode!==this.config.PAYMENT_MODE)throw new AppError(409,'PAYMENT_ENVIRONMENT','订单支付环境与当前配置不同');
      if(proof){
        decodeProof(proof);
        const tradeNo=await this.payment.verify(order,proof);
        const paid=(await db.query("UPDATE ct_orders SET payment_status='VERIFIED',status='READY',trade_no=$2,paid_at=now(),due_at=now()+($3*interval '1 hour') WHERE id=$1 RETURNING *",[orderId,tradeNo,order.snapshot.deliveryHours])).rows[0];
        await this.event(db,orderId,actor!.id,'PAYMENT_VERIFIED',{environment:this.config.PAYMENT_MODE});return {paid:true,order:paid};
      }
      if(Date.now()>=new Date(order.pay_before).getTime())throw new AppError(409,'PAYMENT_EXPIRED','报价已过支付时间；如已付款，请提交原支付凭证核验');
      if(!order.prepay_id){
        const prepay=await this.payment.precreate(order);
        await db.query('UPDATE ct_orders SET prepay_id=$2,qr_code_url=$3 WHERE id=$1',[orderId,prepay.id,prepay.qr]);
        order.prepay_id=prepay.id;order.qr_code_url=prepay.qr;await this.event(db,orderId,actor!.id,'PAYMENT_REQUESTED');
      }
      return {paid:false,order,payment:{amtPaymentLink:order.prepay_id,qrCodeURL:order.qr_code_url,amountFen:order.price_fen,currency:'CNY',payBefore:order.pay_before}};
    });
  }
  async execute(actor:Actor|null,orderId:string){
    return this.db.transaction(async db=>{
      const order=await this.order(db,actor,orderId,true);
      if(order.snapshot.engine==='csv'){
        if(order.buyer_id!==actor!.id)throw new AppError(403,'FORBIDDEN','仅买家可以执行内置服务');
        if(['DELIVERED','ACCEPTED'].includes(order.status))return order;
        if(order.status!=='READY')throw new AppError(409,'INVALID_STATE','订单尚未满足执行条件');
        const content=inspectCSV(order.input);await this.deliver(db,order,order.seller_id,content);return {...order,status:'DELIVERED'};
      }
      if(order.seller_id!==actor!.id)throw new AppError(403,'FORBIDDEN','仅服务提供者可以开始工作');
      if(order.status==='IN_PROGRESS')return order;
      if(!['READY','REVISION_REQUESTED'].includes(order.status))throw new AppError(409,'INVALID_STATE','订单尚未满足执行条件');
      await db.query("UPDATE ct_orders SET status='IN_PROGRESS' WHERE id=$1",[orderId]);await this.event(db,orderId,actor!.id,'WORK_STARTED');return {...order,status:'IN_PROGRESS'};
    });
  }
  private async deliver(db:SQL,order:any,actorId:string,content:string){
    const latest=(await db.query('SELECT coalesce(max(version),0)::int AS version FROM ct_deliveries WHERE order_id=$1',[order.id])).rows[0].version;
    const delivery=(await db.query('INSERT INTO ct_deliveries(id,order_id,version,content) VALUES($1,$2,$3,$4) RETURNING *',[id(),order.id,latest+1,content])).rows[0];
    await db.query("UPDATE ct_orders SET status='DELIVERED' WHERE id=$1",[order.id]);await this.event(db,order.id,actorId,'DELIVERY_SUBMITTED',{version:latest+1});return delivery;
  }
  async submit(actor:Actor|null,orderId:string,input:unknown){
    return this.db.transaction(async db=>{
      const order=await this.order(db,actor,orderId,true);
      if(order.seller_id!==actor!.id)throw new AppError(403,'FORBIDDEN','仅服务提供者可以交付');
      const {content}=DeliverySchema.parse(input);
      const latest=(await db.query('SELECT * FROM ct_deliveries WHERE order_id=$1 ORDER BY version DESC LIMIT 1',[orderId])).rows[0];
      if(order.status==='DELIVERED'&&latest?.content===content)return latest;
      if(!['READY','IN_PROGRESS','REVISION_REQUESTED'].includes(order.status))throw new AppError(409,'INVALID_STATE','当前状态不允许提交成果');
      return this.deliver(db,order,actor!.id,content);
    });
  }
  async review(actor:Actor|null,orderId:string,input:unknown){
    const data=ReviewSchema.parse(input);
    return this.db.transaction(async db=>{
      const order=await this.order(db,actor,orderId,true);
      if(order.buyer_id!==actor!.id)throw new AppError(403,'FORBIDDEN','仅买家可以验收');
      const latest=required((await db.query('SELECT version FROM ct_deliveries WHERE order_id=$1 ORDER BY version DESC LIMIT 1',[orderId])).rows[0]);
      if(latest.version!==data.deliveryVersion)throw new AppError(409,'STALE_DELIVERY','交付已更新，请重新读取后验收');
      if(order.status==='ACCEPTED'&&data.decision==='accept'){
        const old=required((await db.query('SELECT * FROM ct_reviews WHERE order_id=$1',[orderId])).rows[0]);
        if(old.rating!==data.rating||old.comment!==data.comment)throw new AppError(409,'REVIEW_FINAL','已完成的评价不可覆盖');return order;
      }
      if(order.status!=='DELIVERED')throw new AppError(409,'INVALID_STATE','当前订单不等待验收');
      if(data.decision==='revise'&&order.snapshot.engine==='csv')throw new AppError(409,'INPUT_FINAL','输入已冻结，请对修改后的数据创建新订单或提出售后');
      const status={accept:'ACCEPTED',revise:'REVISION_REQUESTED',dispute:'DISPUTED'}[data.decision];
      if(data.decision==='accept'){
        if(!data.rating)throw new AppError(400,'RATING_REQUIRED','请为已验收服务评分');
        await db.query('INSERT INTO ct_reviews(order_id,seller_id,service_id,rating,comment,paid) VALUES($1,$2,$3,$4,$5,$6)',[orderId,order.seller_id,order.service_id,data.rating,data.comment,order.payment_status==='VERIFIED'&&order.snapshot.paymentMode==='production']);
      }
      await db.query('UPDATE ct_orders SET status=$2 WHERE id=$1',[orderId,status]);await this.event(db,orderId,actor!.id,status,{comment:data.comment,deliveryVersion:data.deliveryVersion,rating:data.decision==='accept'?data.rating:null});return {...order,status};
    });
  }
  async dispute(actor:Actor|null,orderId:string,reason:string){
    if(reason.trim().length<5||reason.length>2000)throw new AppError(400,'INVALID_INPUT','请填写至少 5 字的售后原因');
    return this.db.transaction(async db=>{
      const order=await this.order(db,actor,orderId,true);
      if(order.buyer_id!==actor!.id)throw new AppError(403,'FORBIDDEN','仅买家可以提出售后');
      if(!['READY','IN_PROGRESS','DELIVERED','REVISION_REQUESTED','ACCEPTED'].includes(order.status))throw new AppError(409,'INVALID_STATE','当前状态不允许提出售后');
      await db.query("UPDATE ct_orders SET status='DISPUTED' WHERE id=$1",[orderId]);await this.event(db,orderId,actor!.id,'DISPUTED',{reason});return {...order,status:'DISPUTED'};
    });
  }
  async cancel(actor:Actor|null,orderId:string){
    return this.db.transaction(async db=>{
      const order=await this.order(db,actor,orderId,true);
      if(order.buyer_id!==actor!.id)throw new AppError(403,'FORBIDDEN','仅买家可以取消订单');
      if(order.status==='CANCELLED')return order;
      if(!['AWAITING_PAYMENT','READY'].includes(order.status)||order.prepay_id||order.payment_status==='VERIFIED')throw new AppError(409,'PAYMENT_PENDING','已发起支付或工作已开始，请核验支付后提出售后');
      await db.query("UPDATE ct_orders SET status='CANCELLED' WHERE id=$1",[orderId]);await this.event(db,orderId,actor!.id,'CANCELLED');return {...order,status:'CANCELLED'};
    });
  }
  async refund(orderId:string){
    return this.db.transaction(async db=>{
      const order=required((await db.query('SELECT * FROM ct_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0]);
      if(order.status==='REFUNDED')return order;
      if(order.status!=='DISPUTED'||order.payment_status!=='VERIFIED')throw new AppError(409,'REFUND_NOT_ALLOWED','仅核实已付款的售后订单允许退款');
      if(order.snapshot.paymentMode!==this.config.PAYMENT_MODE)throw new AppError(409,'PAYMENT_ENVIRONMENT','请在订单原支付环境处理退款');
      const refundId=await this.payment.refund(order);
      await db.query("UPDATE ct_orders SET status='REFUNDED',payment_status='REFUNDED',refund_id=$2 WHERE id=$1",[orderId,refundId]);
      await db.query('DELETE FROM ct_reviews WHERE order_id=$1',[orderId]);
      await this.event(db,orderId,null,'REFUNDED',{refundId});return {...order,status:'REFUNDED',payment_status:'REFUNDED'};
    });
  }
  async reputation(serviceId:string){
    required((await this.db.query('SELECT id FROM ct_services WHERE id=$1 AND published',[serviceId])).rows[0]);
    return {reviews:(await this.db.query('SELECT r.rating,r.comment,r.paid,r.created_at,a.name AS buyer_name FROM ct_reviews r JOIN ct_orders o ON o.id=r.order_id JOIN ct_actors a ON a.id=o.buyer_id WHERE r.service_id=$1 ORDER BY r.created_at DESC LIMIT 50',[serviceId])).rows};
  }
  async adminServices(){return {services:(await this.db.query('SELECT s.*,a.name AS seller_name FROM ct_services s JOIN ct_actors a ON a.id=s.seller_id ORDER BY created_at DESC LIMIT 100')).rows};}
  async disputes(){return {orders:(await this.db.query(`SELECT o.*,
    (SELECT coalesce(detail->>'reason',detail->>'comment') FROM ct_events WHERE order_id=o.id AND kind='DISPUTED' ORDER BY seq DESC LIMIT 1) AS dispute_reason,
    (SELECT content FROM ct_deliveries WHERE order_id=o.id ORDER BY version DESC LIMIT 1) AS latest_delivery
    FROM ct_orders o WHERE status='DISPUTED' ORDER BY created_at LIMIT 100`)).rows};}
  async setPrice(serviceId:string,priceFen:number){
    if(!Number.isInteger(priceFen)||priceFen<0||priceFen>5000)throw new AppError(400,'INVALID_INPUT','价格须为 0–5000 整数分');
    return this.publicService(required((await this.db.query('UPDATE ct_services SET price_fen=$2,payment_binding=NULL,published=($2=0),version=version+1 WHERE id=$1 RETURNING *',[serviceId,priceFen])).rows[0]));
  }
  async resolve(orderId:string,reason:string){
    if(reason.trim().length<5||reason.length>2000)throw new AppError(400,'INVALID_INPUT','请填写具体处理依据');
    return this.db.transaction(async db=>{
      const order=required((await db.query('SELECT * FROM ct_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0]);
      if(order.status!=='DISPUTED')throw new AppError(409,'INVALID_STATE','订单当前没有待处理售后');
      const reviewed=(await db.query('SELECT order_id FROM ct_reviews WHERE order_id=$1',[orderId])).rows.length>0;
      const delivered=(await db.query('SELECT id FROM ct_deliveries WHERE order_id=$1',[orderId])).rows.length>0;
      const status=reviewed?'ACCEPTED':delivered?'DELIVERED':'READY';
      await db.query('UPDATE ct_orders SET status=$2 WHERE id=$1',[orderId,status]);await this.event(db,orderId,null,'DISPUTE_RESOLVED',{reason,status});return {...order,status};
    });
  }
  async metrics(){return (await this.db.query(`SELECT count(*)::int AS orders,count(*) FILTER(WHERE status='ACCEPTED')::int AS accepted,count(*) FILTER(WHERE payment_status='VERIFIED' AND snapshot->>'paymentMode'='production')::int AS verified_payments,count(*) FILTER(WHERE payment_status='VERIFIED' AND snapshot->>'paymentMode'='sandbox')::int AS sandbox_payments,coalesce(sum(price_fen) FILTER(WHERE payment_status='VERIFIED' AND snapshot->>'paymentMode'='production'),0)::int AS revenue_fen FROM ct_orders`)).rows[0];}
}
