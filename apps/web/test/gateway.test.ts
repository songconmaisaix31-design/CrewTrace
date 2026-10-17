import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { allowedReadPath, gateway } from '../server/gateway.ts';

test('代理只允许公开读取路径，阻止越权路由与路径穿越',()=>{
  for(const path of ['/health','/api/agents','/api/runs/real-run/events?after=4','/api/artifacts/artifact-1','/api/announcements?runId=run-1']) assert.equal(allowedReadPath(path),true,path);
  for(const path of ['https://example.com','//example.com','/admin/nodes','/worker/jobs','/api/runs/../admin','/api/runs/%2e%2e','/api/runs/%2fadmin','/api/agents?token=secret']) assert.equal(allowedReadPath(path),false,path);
});
test('真实 HTTP 服务在未配置及未授权时拒绝创建，不暴露服务端密钥',async()=>{
  const names=['RUNTIME_URL','ADMIN_TOKEN','DEMO_ACCESS_CODE','VALIDATOR_ADDRESS'] as const;
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const name of names)delete process.env[name];
  const server=createServer((req,res)=>void gateway(req,res));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}/api/web`;
  try{
    const config=await fetch(`${base}?action=status`);assert.deepEqual(await config.json(),{configured:false,creationConfigured:false});
    const offline=await fetch(`${base}?path=%2Fapi%2Fruns`,{method:'POST'});assert.equal(offline.status,503);
    process.env.RUNTIME_URL='http://127.0.0.1:1';
    process.env.ADMIN_TOKEN=randomBytes(32).toString('hex');
    process.env.DEMO_ACCESS_CODE=randomBytes(32).toString('hex');
    process.env.VALIDATOR_ADDRESS='0x'+'01'.repeat(20);
    const denied=await fetch(`${base}?path=%2Fapi%2Fruns`,{method:'POST',headers:{'X-Demo-Code':'incorrect'}});assert.equal(denied.status,403);
    const publicStatus=await fetch(`${base}?action=status`);const text=await publicStatus.text();assert(!text.includes(process.env.ADMIN_TOKEN));assert(!text.includes(process.env.DEMO_ACCESS_CODE));
    const invalid=await fetch(`${base}?path=${encodeURIComponent('/admin/nodes')}`);assert.equal(invalid.status,405);
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  }
});
