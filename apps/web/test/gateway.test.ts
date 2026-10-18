import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { allowedPublicPath, gateway } from '../server/gateway.ts';

test('翻译接口拒绝跨站调用并明确报告缺少服务配置',async()=>{
  const previousKey=process.env.STEP_API_KEY,previousModel=process.env.STEP_MODEL;
  delete process.env.STEP_API_KEY;delete process.env.STEP_MODEL;
  const server=createServer(gateway);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert(address&&typeof address==='object');
  const url=`http://127.0.0.1:${address.port}/api/web?action=translate`;
  try{
    assert.equal((await fetch(url)).status,405);
    assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://example.org'}})).status,403);
    const unavailable=await fetch(url,{method:'POST'});
    assert.equal(unavailable.status,503);
    assert.deepEqual(await unavailable.json(),{error:'Translation is not configured yet.'});
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(previousKey===undefined)delete process.env.STEP_API_KEY;else process.env.STEP_API_KEY=previousKey;
    if(previousModel===undefined)delete process.env.STEP_MODEL;else process.env.STEP_MODEL=previousModel;
  }
});

test('代理只允许协作路径和方法，阻止演示路由、越权与路径穿越',()=>{
  for(const path of ['/api/collaboration/agents?limit=100&offset=0','/api/collaboration/agents/me','/api/collaboration/tasks','/api/collaboration/messages?after=0&limit=100','/api/collaboration/commitments?taskId=ba163ef9-42fc-4a94-a798-3078c05b4903','/api/collaboration/commitments/TASK%3Aba163ef9-42fc-4a94-a798-3078c05b4903%3A2']) assert.equal(allowedPublicPath('GET',path),true,path);
  for(const path of ['https://example.com','//example.com','/admin/nodes','/worker/jobs','/api/collaboration/tasks/../admin','/api/collaboration/tasks/%2e%2e','/api/collaboration/tasks/%2fadmin','/api/runs','/api/artifacts/artifact-1','/api/criteria','/health']) assert.equal(allowedPublicPath('GET',path),false,path);
  assert.equal(allowedPublicPath('DELETE','/api/collaboration/tasks'),false);
  assert.equal(allowedPublicPath('POST','/api/runs'),false);
});
test('真实 HTTP 服务关闭旧演示接口，仅公开协作配置且不暴露服务端密钥',async()=>{
  const names=['RUNTIME_URL','ADMIN_TOKEN','DEMO_ACCESS_CODE','VALIDATOR_ADDRESS'] as const;
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const name of names)delete process.env[name];
  const server=createServer((req,res)=>void gateway(req,res));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}/api/web`;
  try{
    const config=await fetch(`${base}?action=collaboration-config`);assert.deepEqual(await config.json(),{configured:false,mcpURL:null});
    const offline=await fetch(`${base}?path=${encodeURIComponent('/api/collaboration/tasks')}`);assert.equal(offline.status,503);
    process.env.RUNTIME_URL='http://127.0.0.1:1';
    process.env.ADMIN_TOKEN=randomBytes(32).toString('hex');
    process.env.DEMO_ACCESS_CODE=randomBytes(32).toString('hex');
    process.env.VALIDATOR_ADDRESS='0x'+'01'.repeat(20);
    const denied=await fetch(`${base}?path=%2Fapi%2Fruns`,{method:'POST',headers:{'X-Demo-Code':process.env.DEMO_ACCESS_CODE}});assert.equal(denied.status,405);
    const legacyStatus=await fetch(`${base}?action=status`);assert.equal(legacyStatus.status,405);
    for(const path of ['/api/runs/closed-entry','/api/artifacts/closed-entry','/api/template','/api/criteria']){const response=await fetch(`${base}?path=${encodeURIComponent(path)}`);assert.equal(response.status,405,path);}
    const publicStatus=await fetch(`${base}?action=collaboration-config`);const text=await publicStatus.text();assert(!text.includes(process.env.ADMIN_TOKEN));assert(!text.includes(process.env.DEMO_ACCESS_CODE));
    const collaborationConfig=await fetch(`${base}?action=collaboration-config`);assert.equal(collaborationConfig.status,200);assert.deepEqual(await collaborationConfig.json(),{configured:true,mcpURL:'https://mcp.davidwang.space/mcp'});
    const invalid=await fetch(`${base}?path=${encodeURIComponent('/admin/nodes')}`);assert.equal(invalid.status,405);
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  }
});
