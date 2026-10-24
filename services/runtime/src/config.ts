import { z } from 'zod';

export const ConfigSchema = z.object({
  DATABASE_URL: z.string().default('pglite://.local/crewtrace'),
  PUBLIC_BASE_URL: z.url().default('http://127.0.0.1:3000'),
  ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:5173'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  PAYMENT_MODE: z.enum(['disabled','sandbox','production']).default('disabled'),
  ADMIN_TOKEN: z.string().min(32).optional(),
  ALIPAY_APP_ID: z.string().optional(),
  ALIPAY_PRIVATE_KEY: z.string().optional(),
  ALIPAY_PUBLIC_KEY: z.string().optional(),
  ALIPAY_KEY_TYPE: z.enum(['PKCS1','PKCS8']).default('PKCS8'),
  ALIPAY_GATEWAY: z.url().optional(),
  ALIPAY_SELLER_ID: z.string().optional(),
}).superRefine((c,ctx)=>{
  if(c.PAYMENT_MODE!=='disabled'){
    for(const key of ['ALIPAY_APP_ID','ALIPAY_PRIVATE_KEY','ALIPAY_PUBLIC_KEY','ALIPAY_SELLER_ID','ADMIN_TOKEN'] as const)
      if(!c[key]) ctx.addIssue({code:'custom',path:[key],message:'启用支付必须配置此项'});
    const gateway=c.PAYMENT_MODE==='production'?'https://openapi.alipay.com/gateway.do':'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
    if(c.ALIPAY_GATEWAY && c.ALIPAY_GATEWAY!==gateway)ctx.addIssue({code:'custom',path:['ALIPAY_GATEWAY'],message:'支付环境与官方网关不一致'});
  }
  if(c.PAYMENT_MODE==='production' && (!c.PUBLIC_BASE_URL.startsWith('https://') || c.DATABASE_URL.startsWith('pglite:')))
    ctx.addIssue({code:'custom',message:'正式支付要求 HTTPS 与独立 PostgreSQL'});
});
export type Config=z.infer<typeof ConfigSchema>;
export const loadConfig=()=>ConfigSchema.parse(process.env);
