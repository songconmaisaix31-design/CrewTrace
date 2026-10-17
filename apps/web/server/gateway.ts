import type { IncomingMessage, ServerResponse } from 'node:http';
const publicRoutes:Record<string,RegExp[]>={
  GET:[/^\/api\/collaboration\/(?:agents|tasks|messages|notes|events)(?:\?[^#]*)?$/,/^\/api\/collaboration\/(?:agents|tasks|notes)\/[^/?#]+$/],
  POST:[/^\/api\/collaboration\/(?:agents|tasks|messages|notes|credentials\/rotate)$/,/^\/api\/collaboration\/agents\/me\/heartbeat$/,/^\/api\/collaboration\/tasks\/[^/?#]+\/(?:claims|proposals|handoffs)$/,/^\/api\/collaboration\/claims\/[^/?#]+\/release$/,/^\/api\/collaboration\/proposals\/[^/?#]+\/decision$/,/^\/api\/collaboration\/handoffs\/[^/?#]+\/review$/],
  PATCH:[/^\/api\/collaboration\/(?:agents\/me|tasks\/[^/?#]+|notes\/[^/?#]+)$/],
};
export function allowedPublicPath(method:string,path:string){return !/%2f|%5c|%2e|\.\.|\\|#/i.test(path)&&Boolean(publicRoutes[method]?.some(rule=>rule.test(path)));}
export async function gateway(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
  const config = process.env;
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if(req.method==='GET'&&url.searchParams.get('action')==='collaboration-config'){
      if(!config.RUNTIME_URL){json(200,{configured:false,mcpURL:null});return;}
      const base=new URL(config.RUNTIME_URL);
      if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('服务地址无效');
      json(200,{configured:true,mcpURL:'https://mcp.davidwang.space/mcp'});return;
    }
    const path = url.searchParams.get('path') ?? '';
    if(!allowedPublicPath(req.method??'',path)){json(405,{error:{code:'METHOD_NOT_ALLOWED',message:'不支持的协作操作'}});return;}
    if (!config.RUNTIME_URL) { json(503, {error:{message:'任务服务尚未配置',code:'NOT_CONFIGURED'}}); return; }
    const base = new URL(config.RUNTIME_URL);
    if (!['http:', 'https:'].includes(base.protocol)||base.username||base.password) throw new Error('服务地址无效');
    let body: string | undefined;
    const headers: Record<string,string> = {};
    if(req.headers.authorization)headers.Authorization=req.headers.authorization;
    if(req.method!=='GET'){
      let parsed:unknown=(req as IncomingMessage&{body?:unknown}).body;
      if(parsed===undefined){
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>2*1024*1024){json(413,{error:{code:'BODY_TOO_LARGE',message:'请求内容过大'}});return;}chunks.push(Buffer.from(chunk));}
        parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }else if(typeof parsed==='string')parsed=JSON.parse(parsed);
      body=JSON.stringify(parsed);headers['Content-Type']='application/json';
    }
    const upstream = await fetch(new URL(path, base), {method:req.method,headers,body,signal:AbortSignal.timeout(20000),redirect:'error'});
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'text/plain; charset=utf-8');
    const disposition = upstream.headers.get('Content-Disposition');
    if (disposition) res.setHeader('Content-Disposition', disposition);
    const contentHash = upstream.headers.get('X-Content-Hash');
    if(contentHash)res.setHeader('X-Content-Hash',contentHash);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (error instanceof SyntaxError) json(400,{error:{message:'请求字段不符合接口约定'}});
    else json(502,{error:{message:'协作服务暂时无法访问，请稍后重试；提交可能已送达，请先查询最新记录。'}});
  }
}
