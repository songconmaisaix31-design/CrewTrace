import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { Actor,Commerce } from './service.js';
import { DeliverySchema,OrderSchema,RegisterSchema,ReviewSchema,ServiceSchema } from './domain.js';
import { AppError,errorBody } from './errors.js';

export const guide=(base:string)=>`CrewTrace：发现专业 Agent 服务、确认价格与需求、支付宝按次付款、交付验收。\n1. 使用 list_services 查找服务及实际履历。没有评价表示能力尚未验证；免费评价与正式实付评价分开。\n2. 使用 join_collaboration 创建身份，妥善保存返回的 credential。后续使用 Authorization: Bearer 或工具 credential 参数。\n3. 取得用户对服务、固定报价、需求与金额上限的明确同意，再调用 create_order；用稳定 idempotencyKey 重试。同一 key 不可改变输入。\n4. request_payment 返回支付宝 amtPaymentLink 和 HTTP 资源地址。通过支付宝官方支付能力由用户确认付款。将官方 Payment-Proof 传给 verify_payment 或订单 HTTP 资源端点，不编造凭证。\n5. 内置服务 execute_order 执行真实 CSV 检查；外部 Agent 用 list_orders 找到分配给自己的工作，execute_order 开始，submit_delivery 交付完整 Markdown。\n6. 买家读取 get_order 检查原文，review_delivery 接受、退回重交或提出售后。仅已验收订单产生评价；验收与支付宝资金托管无关。\n7. 免费订单可直接执行。支付未配置时收费不可用，禁止宣称已付款。平台当前单商户收款，服务上架须商户核对登记资源与价格，不提供自动分账。\nREST: ${base}/api；MCP: ${base}/mcp。原始需求和交付仅订单双方可读。`;

export async function mcpResponse(app:Commerce,principal:Actor|null,request:Request){
  const server=new McpServer({name:'crewtrace',version:'0.2.0'},{instructions:guide(app.config.PUBLIC_BASE_URL)});
  server.registerPrompt('crewtrace_collaboration',{description:'CrewTrace 支付与履约流程'},async()=>({messages:[{role:'user',content:{type:'text',text:guide(app.config.PUBLIC_BASE_URL)}}]}));
  const identity=async(credential?:string)=>{
    if(!credential)return principal;
    const actor=await app.authenticate(`Bearer ${credential}`);
    if(principal&&principal.id!==actor?.id)throw new AppError(403,'IDENTITY_MISMATCH','连接凭证与工具凭证必须对应同一身份');return actor;
  };
  function tool(name:string,description:string,schema:z.ZodObject<any>,readOnly:boolean,fn:(input:any)=>Promise<unknown>){
    server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:!readOnly}},async input=>{
      try{return {content:[{type:'text',text:JSON.stringify(await fn(input))}]};}
      catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify(errorBody(e))}]};}
    });
  }
  const auth={credential:z.string().min(1).max(100).optional()},order={orderId:z.string().length(32),...auth};
  tool('get_collaboration_guide','读取真实支付与服务使用说明',z.strictObject({}),true,async()=>({text:guide(app.config.PUBLIC_BASE_URL)}));
  tool('join_collaboration','创建 Agent 身份，凭证仅返回一次',RegisterSchema,false,input=>app.register(input));
  tool('list_services','检索上架服务、人民币价格和已验收评价',z.strictObject({query:z.string().max(100).default(''),category:z.string().max(40).default('')}),true,input=>app.services(input.query,input.category));
  tool('publish_service','发布真实服务；收费服务经商户确认登记后可上架',ServiceSchema.extend(auth),false,async({credential,...input})=>app.publish(await identity(credential),input));
  tool('create_order','确认用户授权后创建订单，冻结价格、需求与服务版本',OrderSchema.extend(auth),false,async({credential,...input})=>app.createOrder(await identity(credential),input));
  tool('list_orders','读取自己购买或负责交付的订单',z.strictObject(auth),true,async input=>app.listOrders(await identity(input.credential)));
  tool('get_order','读取订单、历次交付和事件原文',z.strictObject(order),true,async input=>app.detail(await identity(input.credential),input.orderId));
  tool('request_payment','创建官方预下单；此操作不会代替用户付款',z.strictObject(order),false,async input=>({...await app.pay(await identity(input.credential),input.orderId),resourceURL:`${app.config.PUBLIC_BASE_URL}/api/orders/${input.orderId}/resource`}));
  tool('verify_payment','提交支付宝返回的 Base64 Payment-Proof 并由服务端验付',z.strictObject({...order,paymentProof:z.string().max(8192)}),false,async input=>app.pay(await identity(input.credential),input.orderId,input.paymentProof));
  tool('execute_order','执行内置 CSV 服务，或由服务提供者开始处理订单',z.strictObject(order),false,async input=>app.execute(await identity(input.credential),input.orderId));
  tool('submit_delivery','服务提供者交付完整 Markdown，支持退回后重交',DeliverySchema.extend(order),false,async input=>app.submit(await identity(input.credential),input.orderId,{content:input.content}));
  tool('review_delivery','买家对当前版本验收，接受后登记一次真实评价',ReviewSchema.extend(order),false,async({credential,orderId,...input})=>app.review(await identity(credential),orderId,input));
  tool('cancel_order','取消尚未发起支付且未开始工作的订单',z.strictObject(order),false,async input=>app.cancel(await identity(input.credential),input.orderId));
  tool('open_dispute','买家提出售后，商户核实后处理',z.strictObject({...order,reason:z.string().min(5).max(2000)}),false,async input=>app.dispute(await identity(input.credential),input.orderId,input.reason));
  tool('get_reputation','查看服务验收记录，区分免费与正式实付评价',z.strictObject({serviceId:z.string().max(80)}),true,input=>app.reputation(input.serviceId));
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try{return await transport.handleRequest(request);}finally{await server.close();}
}
